/**
 * 业务规则中心（单一数据源）
 *
 * 设计要点：
 *  1) 所有模块的写操作（直接改）与变更审批（申请改）必须调用同一批函数，
 *     杜绝"两套规则"漂移造成的审批绕过问题。
 *  2) 每个校验统一返回 { error, warnings, code }：
 *       error    —— 硬校验，阻断写入
 *       warnings —— 软警告，允许写入但必须提示使用者
 *       code     —— 建议的 HTTP 状态码（默认 400）
 *  3) 跨模块一致性规则（金额链路、状态联动、工期嵌套）集中在此处维护。
 */
const V = require('./validate');
const { db, isDate, isMissing, norm, toNum, isNum, money, today } = V;

const PAY_STAGES = ['预付款', '进度款', '结算款', '质保金'];
const TERMINAL_PROJECT_STATUS = ['已完工', '已验收'];

const fail = (error, code = 400) => ({ error, warnings: [], code });
const failCode = (error, code) => ({ error, warnings: [], code });
const ok = (warnings = []) => ({ error: null, warnings, code: 200 });

/* ============================ 项目 ============================ */
function validateProject(row, opts = {}) {
  const { id = null, old = null } = opts;
  const w = [];

  for (const [f, label] of [['start_date', '开工日期'], ['end_date', '完工日期']]) {
    if (!isMissing(row[f]) && !isDate(row[f])) return fail(`${label}格式不正确`);
  }
  if (row.start_date && row.end_date && String(row.start_date) > String(row.end_date)) {
    return fail('开工日期不能晚于完工日期');
  }
  if (!isMissing(row.budget)) {
    const n = toNum(row.budget);
    if (!isNum(n) || n < 0) return fail('总投资不能为负数');
  }

  const pid = id != null ? Number(id) : null;
  const proj = pid != null ? db.prepare('SELECT * FROM projects WHERE id=?').get(pid) : null;

  // 【跨模块一致】项目状态不得在有"履行中"合同的情况下倒退到招标前阶段
  if (proj && old && row.status && old.status !== row.status) {
    const running = db.prepare(
      "SELECT c.name FROM contracts c WHERE c.project_id=? AND c.status='履行中' LIMIT 1").get(pid);
    if (running && ['筹备中', '招标中'].includes(row.status)) {
      return fail(`该项目下已有"履行中"的合同《${running.name}》，不能将项目退回"${row.status}"；如需退回请先终止相关合同`);
    }
  }

  const status = !isMissing(row.status) ? row.status : (proj ? proj.status : null);
  if (TERMINAL_PROJECT_STATUS.includes(status)) {
    const latest = pid != null
      ? db.prepare('SELECT percent FROM progress_records WHERE project_id=? ORDER BY record_date DESC,id DESC LIMIT 1')
        .get(pid)?.percent : null;
    if (latest == null) w.push(`项目已标记为${status}，但尚无进度填报`);
    else if (latest < 100) w.push(`项目已标记为${status}，但最新进度填报仅 ${latest}%`);

    const runningCt = pid != null
      ? db.prepare("SELECT name FROM contracts WHERE project_id=? AND status='履行中' LIMIT 1").get(pid) : null;
    if (runningCt) w.push(`项目已标记为${status}，但合同《${runningCt.name}》仍为"履行中"，请核对合同状态`);
  }
  return ok(w);
}

/* ============================ 招标 ============================ */
function validateBid(row, opts = {}) {
  const { id = null } = opts;

  const project = isMissing(row.project_id)
    ? null : db.prepare('SELECT * FROM projects WHERE id=?').get(row.project_id);
  if (!project) return fail('所属项目不存在，请刷新后重新选择');

  for (const f of ['publish_date', 'signup_deadline', 'bid_open_date']) {
    if (!isMissing(row[f]) && !isDate(row[f])) return fail('招标日期格式不正确');
  }
  if (row.publish_date && row.signup_deadline && row.publish_date > row.signup_deadline) {
    return fail('发布日期不能晚于报名截止日期');
  }
  if (row.signup_deadline && row.bid_open_date && row.signup_deadline > row.bid_open_date) {
    return fail('报名截止日期不能晚于开标日期');
  }
  for (const f of ['budget', 'win_amount']) {
    if (!isMissing(row[f])) {
      const n = toNum(row[f]);
      if (!isNum(n) || n < 0) return fail('金额不能为负数');
    }
  }

  // 【金额链路】中标价不得高于招标控制价（超过最高限价应为废标）
  const budget = toNum(row.budget);
  const winAmount = toNum(row.win_amount);
  if (isNum(budget) && isNum(winAmount) && money(winAmount) > money(budget)) {
    return fail(`中标金额（${winAmount} 万元）不能高于招标控制价（${budget} 万元）`);
  }

  // 【状态一致】已定标必须带中标结果
  if (row.status === '已定标') {
    if (isMissing(row.winner)) return fail('状态为"已定标"时必须填写中标单位');
    if (isMissing(row.win_amount)) return fail('状态为"已定标"时必须填写中标金额');
  }

  // 编号唯一性
  if (!isMissing(row.bid_no)) {
    const dup = db.prepare('SELECT id,title FROM bids WHERE bid_no=? AND id IS NOT ? LIMIT 1')
      .get(String(row.bid_no).trim(), id ?? 0);
    if (dup) return fail(`招标编号"${row.bid_no}"已被《${dup.title}》使用`);
  }

  const w = [];
  if (row.bid_open_date && project.start_date && row.bid_open_date > project.start_date) {
    w.push(`开标日期晚于项目计划开工日期（${project.start_date}），可能影响开工`);
  }
  return ok(w);
}

/* ============================ 合同 ============================ */
function validateContract(row, opts = {}) {
  const { id = null } = opts;

  const project = isMissing(row.project_id)
    ? null : db.prepare('SELECT * FROM projects WHERE id=?').get(row.project_id);
  if (!project) return fail('所属项目不存在，请刷新后重新选择');

  let bid = null;
  if (!isMissing(row.bid_id) && row.bid_id !== null) {
    bid = db.prepare('SELECT * FROM bids WHERE id=?').get(row.bid_id);
    if (!bid) return fail('关联招标不存在');
    if (bid.project_id !== project.id) return fail('关联招标与合同不属于同一项目');
  }

  if (!isMissing(row.amount)) {
    const n = toNum(row.amount);
    if (!isNum(n) || n < 0) return fail('合同金额不能为负数');
  }
  for (const [f, label] of [['sign_date', '签订日期'], ['start_date', '合同开始日期'], ['end_date', '合同结束日期']]) {
    if (!isMissing(row[f]) && !isDate(row[f])) return fail(`${label}格式不正确`);
  }
  if (row.start_date && row.end_date && row.start_date > row.end_date) {
    return fail('合同开始日期不能晚于结束日期');
  }

  if (!isMissing(row.contract_no)) {
    const dup = db.prepare('SELECT id,name FROM contracts WHERE contract_no=? AND id IS NOT ? LIMIT 1')
      .get(String(row.contract_no).trim(), id ?? 0);
    if (dup) return fail(`合同编号"${row.contract_no}"已被《${dup.name}》使用`);
  }

  const w = [];
  // 【金额链路】合同额应等于中标额
  const amount = toNum(row.amount);
  if (bid && isNum(amount) && bid.win_amount != null && !isMissing(bid.win_amount)) {
    if (Math.abs(money(amount) - money(bid.win_amount)) > 0.005) {
      w.push(`合同金额（${amount} 万元）与所属招标的中标金额（${bid.win_amount} 万元）不一致，请确认是否为补充协议`);
    }
  }
  // 【金额链路】同一项目下的合同总额不得超过项目总投资
  if (isNum(amount) && project.budget != null && Number(project.budget) > 0) {
    const others = db.prepare(
      'SELECT COALESCE(SUM(amount),0) s FROM contracts WHERE project_id=? AND id IS NOT ?'
    ).get(project.id, id ?? 0).s;
    const total = money(others + amount);
    if (total > money(project.budget) + 0.005) {
      w.push(`本项目合同总额累计 ${total} 万元，已超过项目总投资 ${money(project.budget)} 万元，请核实是否为追加投资`);
    }
  }
  // 【状态一致】履行中合同应有签订日期
  if (row.status === '履行中' && isMissing(row.sign_date)) {
    w.push('合同状态为"履行中"但未填写签订日期，不利于台账追溯与归档');
  }
  // 【时间线】签订日期不应早于所属招标的开标日期
  if (bid && !isMissing(row.sign_date) && !isMissing(bid.bid_open_date) && row.sign_date < bid.bid_open_date) {
    w.push(`合同签订日期（${row.sign_date}）早于所属招标的开标日期（${bid.bid_open_date}），请确认时间线是否正确`);
  }
  // 工期嵌套
  if (row.start_date && project.start_date && row.start_date < project.start_date) {
    w.push(`合同开始日期早于项目计划开工日期（${project.start_date}）`);
  }
  if (row.end_date && project.end_date && row.end_date > project.end_date) {
    w.push(`合同结束日期晚于项目计划完工日期（${project.end_date}），请确认是否为质保/监理收尾期`);
  }
  return ok(w);
}

/* ============================ 付款 ============================ */
function validatePayment(fields, opts = {}) {
  const { contractId = null, excludeId = null } = opts;

  const contract = contractId == null
    ? null : db.prepare('SELECT * FROM contracts WHERE id=?').get(contractId);
  if (!contract) return failCode('合同不存在，无法登记付款', 404);

  const w = [];
  if (isMissing(fields.amount)) return fail('付款金额必填');
  const n = toNum(fields.amount);
  if (!isNum(n) || n <= 0) return fail('付款金额必须大于 0');
  if (!isMissing(fields.pay_date) && !isDate(fields.pay_date)) return fail('付款日期格式不正确');
  if (!isMissing(fields.stage) && !PAY_STAGES.includes(fields.stage)) {
    w.push(`付款阶段"${fields.stage}"不在标准阶段（${PAY_STAGES.join('/')}）范围内，请确认`);
  }

  // 【金额链路】累计付款不得突破合同金额
  const paid = db.prepare(
    'SELECT COALESCE(SUM(amount),0) s FROM contract_payments WHERE contract_id=? AND id IS NOT ?'
  ).get(contract.id, excludeId ?? 0).s;
  const total = money(paid + n);
  const ceiling = money(contract.amount);
  if (total > ceiling + 0.005) {
    return fail(`本次付款后累计付款为 ${total} 万元，已超过合同金额 ${ceiling} 万元（已付 ${money(paid)} 万元）`);
  }

  if (!isMissing(fields.pay_date) && contract.sign_date && fields.pay_date < contract.sign_date) {
    w.push(`付款日期（${fields.pay_date}）早于合同签订日期（${contract.sign_date}）`);
  }
  return ok(w);
}

/* ============================ 进度填报 ============================ */
function validateRecord(row, opts = {}) {
  const { excludeId = null, mode = 'create' } = opts;

  const project = isMissing(row.project_id)
    ? null : db.prepare('SELECT * FROM projects WHERE id=?').get(row.project_id);
  if (!project) return fail('所属项目不存在，请刷新后重新选择');

  if (isMissing(row.record_date) || !isDate(row.record_date)) return fail('请选择正确的填报日期');

  const pct = row.percent;
  if (!isNum(pct) || !Number.isInteger(pct) || pct < 0 || pct > 100) {
    return fail('累计进度必须是 0-100 之间的整数');
  }

  // 【终态保护】已完工/已验收的项目不再接受新的进度填报
  if (mode === 'create' && TERMINAL_PROJECT_STATUS.includes(project.status)) {
    return fail(`项目已处于"${project.status}"状态，不允许新增进度填报；如需补录请先通过项目变更调整状态`);
  }

  const exId = excludeId ?? 0;
  // 【数据冲突】同一项目同一天只能有一条填报（累计百分比是状态量，不是增量）
  const dup = db.prepare(
    'SELECT id,percent FROM progress_records WHERE project_id=? AND record_date=? AND id IS NOT ? LIMIT 1'
  ).get(project.id, row.record_date, exId);
  if (dup) {
    return fail(`该项目在 ${row.record_date} 已填报过 ${dup.percent}%，请直接修改该记录或选择其他填报日期`);
  }
  // 【数据冲突】同一报告期不允许重复填报（同一期出现两份互相矛盾的季报会导致统计口径不稳）
  if (!isMissing(row.period)) {
    const dupPeriod = db.prepare(
      'SELECT id,record_date,percent FROM progress_records WHERE project_id=? AND period=? AND id IS NOT ? LIMIT 1'
    ).get(project.id, row.period, exId);
    if (dupPeriod) {
      return fail(`该项目已填报过报告期"${row.period}"（${dupPeriod.record_date}，${dupPeriod.percent}%），请直接修改该条记录`);
    }
  }
  // 【数据冲突】累计序列必须按时间单调递增：下界（不低于更早报告期）
  const prev = db.prepare(`SELECT record_date, percent FROM progress_records
    WHERE project_id=? AND id IS NOT ? AND record_date<? AND percent>?
    ORDER BY record_date DESC, id DESC LIMIT 1`).get(project.id, exId, row.record_date, pct);
  if (prev) {
    return fail(`累计进度不能低于更早报告期（${prev.record_date}）已填报的 ${prev.percent}%`);
  }
  // 【数据冲突】累计序列必须按时间单调递增：上界（不高于更晚报告期）
  const next = db.prepare(`SELECT record_date, percent FROM progress_records
    WHERE project_id=? AND id IS NOT ? AND record_date>? AND percent<?
    ORDER BY record_date ASC, id ASC LIMIT 1`).get(project.id, exId, row.record_date, pct);
  if (next) {
    return fail(`累计进度不能高于更晚报告期（${next.record_date}）已填报的 ${next.percent}%`);
  }

  const w = [];
  if (project.start_date && row.record_date < project.start_date) {
    w.push(`填报日期早于项目计划开工日期（${project.start_date}）`);
  }
  if (project.end_date && row.record_date > project.end_date) {
    w.push(`填报日期晚于项目计划完工日期（${project.end_date}）`);
  }
  if (pct >= 100 && !TERMINAL_PROJECT_STATUS.includes(project.status)) {
    w.push('进度已达 100%，请及时将项目状态更新为"已完工"并完善竣工验收信息');
  }
  return ok(w);
}

/* ============================ 里程碑 ============================ */
function validateMilestone(row, opts = {}) {
  void opts;
  const project = isMissing(row.project_id)
    ? null : db.prepare('SELECT * FROM projects WHERE id=?').get(row.project_id);
  if (!project) return fail('所属项目不存在，请刷新后重新选择');

  if (!isMissing(row.plan_date) && !isDate(row.plan_date)) return fail('计划日期格式不正确');
  if (!isMissing(row.actual_date) && !isDate(row.actual_date)) return fail('实际完成日期格式不正确');
  if (row.status === '已完成' && isMissing(row.actual_date)) {
    return fail('状态为"已完成"时必须填写实际完成日期');
  }
  if (!isMissing(row.actual_date) && row.status !== '已完成') {
    return fail('已填写实际完成日期，状态必须为"已完成"');
  }
  if (!isMissing(row.actual_date) && row.actual_date > today()) {
    return fail('实际完成日期不能晚于今天');
  }

  const w = [];
  if (row.plan_date && project.start_date && row.plan_date < project.start_date) {
    w.push(`里程碑计划日期早于项目计划开工日期（${project.start_date}）`);
  }
  if (row.plan_date && project.end_date && row.plan_date > project.end_date) {
    w.push(`里程碑计划日期晚于项目计划完工日期（${project.end_date}）`);
  }
  if (row.actual_date && project.start_date && row.actual_date < project.start_date) {
    w.push(`里程碑实际完成日期早于项目计划开工日期（${project.start_date}）`);
  }
  return ok(w);
}

/* ============================ 计划 ============================ */
function validatePlan(row, opts = {}) {
  void opts;
  const w = [];
  // 计划必须关联所属项目（直接新增/编辑与变更审批共用此规则，避免审批绕过）
  if (isMissing(row.project_id)) return fail('计划必须选择所属项目');
  const project = db.prepare('SELECT * FROM projects WHERE id=?').get(row.project_id);
  if (!project) return fail('所属项目不存在，请刷新后重新选择');
  if (row.start_date && project.start_date && row.start_date < project.start_date) {
    w.push(`计划开始日期早于项目计划开工日期（${project.start_date}）`);
  }
  if (row.end_date && project.end_date && row.end_date > project.end_date) {
    w.push(`计划结束日期晚于项目计划完工日期（${project.end_date}）`);
  }
  if (!isMissing(row.start_date) && !isDate(row.start_date)) return fail('计划开始日期格式不正确');
  if (!isMissing(row.end_date) && !isDate(row.end_date)) return fail('计划结束日期格式不正确');
  if (row.start_date && row.end_date && row.start_date > row.end_date) {
    return fail('计划开始日期不能晚于结束日期');
  }
  return ok(w);
}

/* ============================ 计划任务 ============================ */
function validateTask(row, opts = {}) {
  const { planId = null, excludeId = null } = opts;

  const weight = toNum(row.weight);
  if (isMissing(row.weight) || !isNum(weight) || weight < 0 || weight > 100) {
    return fail('权重必须是 0-100 之间的数字');
  }
  for (const f of ['start_date', 'end_date', 'actual_start', 'actual_end']) {
    if (!isMissing(row[f]) && !isDate(row[f])) return fail('日期格式不正确');
  }
  if (row.start_date && row.end_date && row.start_date > row.end_date) {
    return fail('计划开始日期不能晚于计划完成日期');
  }
  if (row.actual_start && row.actual_end && row.actual_start > row.actual_end) {
    return fail('实际开始日期不能晚于实际完成日期');
  }
  if (row.status === '已完成' && isMissing(row.actual_end)) {
    return fail('任务状态为"已完成"时必须填写实际完成日期');
  }
  if (!isMissing(row.actual_end) && row.status !== '已完成') {
    return fail('已填写实际完成日期，任务状态必须为"已完成"');
  }
  if (!isMissing(row.actual_end) && row.actual_end > today()) {
    return fail('实际完成日期不能晚于今天');
  }

  // 【权重一致性】同一计划下所有任务权重合计不得超过 100%
  if (planId != null) {
    const used = db.prepare('SELECT COALESCE(SUM(weight),0) s FROM plan_tasks WHERE plan_id=? AND id IS NOT ?')
      .get(planId, excludeId ?? 0).s;
    const total = money(used + weight);
    if (total > 100.005) {
      return fail(`本计划已有任务的权重合计为 ${money(used)}%，再加本任务的 ${weight}% 将达到 ${total}%，超过 100%；请先调整其他任务权重`);
    }
  }

  const w = [];
  if (planId != null) {
    const plan = db.prepare('SELECT start_date,end_date FROM plans WHERE id=?').get(planId);
    if (plan) {
      if (row.start_date && plan.start_date && row.start_date < plan.start_date) {
        w.push(`任务开始日期早于计划周期开始（${plan.start_date}）`);
      }
      if (row.end_date && plan.end_date && row.end_date > plan.end_date) {
        w.push(`任务完成日期晚于计划周期结束（${plan.end_date}），跨年任务请确认已纳入相应计划`);
      }
    }
  }
  return ok(w);
}

module.exports = {
  PAY_STAGES, TERMINAL_PROJECT_STATUS,
  validateProject, validateBid, validateContract, validatePayment,
  validateRecord, validateMilestone, validatePlan, validateTask,
  fail, ok, norm
};
