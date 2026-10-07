/**
 * 水土保持项目管理系统 —— 业务一致性 / 数据冲突 / 稳定性 深度测试（修复验证版）
 *
 * 运行方式：
 *   1) 启动服务：HTTPS=false PORT=3100 npm start
 *   2) node test/business-consistency.mjs
 *   （可用 BASE / DB_PATH 环境变量覆盖目标服务与数据库）
 *
 * 关注维度：
 *   A 金额链路一致性   B 日期链路一致性   C 进度填报数据冲突
 *   D 计划任务一致性   E 状态流转一致性   F 变更审批一致性
 *   G 级联与孤儿数据   H 统计口径一致性   I 稳定性与健壮性
 *
 * 判定口径：
 *   expectBlocked —— 违反业务规则的数据必须被接口拒绝（4xx）
 *   expectWarned  —— 合理但异常的数据必须至少给出软警告
 *   check         —— 功能正确性断言
 */
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const BASE = process.env.BASE || 'http://localhost:3100';
const DB_PATH = process.env.DB_PATH || fileURLToPath(new URL('../data/swc.db', import.meta.url));

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA busy_timeout = 10000');

let pass = 0, fail = 0;
const failures = [];
const findings = [];

function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; failures.push({ name, detail }); console.log(`  FAIL  ${name}  ->  ${detail ?? ''}`); }
}
function finding(level, area, title, evidence, impact, fix) {
  findings.push({ level, area, title, evidence, impact, fix });
  console.log(`  [${level}] ${area} :: ${title}\n         ${evidence}`);
}

async function api(token, method, p, body, raw) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  const resp = await fetch(BASE + '/api' + p, {
    method, headers,
    body: raw !== undefined ? raw : (body === undefined ? undefined : JSON.stringify(body))
  });
  let data = null, text = null;
  const ct = resp.headers.get('content-type') || '';
  if (ct.includes('json')) { try { data = await resp.json(); } catch {} }
  else { try { text = await resp.text(); } catch {} }
  return { status: resp.status, data, text, ct };
}
const login = (u, p) => api(null, 'POST', '/login', { username: u, password: p });
const listOf = d => Array.isArray(d) ? d : (d?.list || d?.items || []);
const msg = r => String(r?.data?.message || r?.text || '');
const warnsOf = r => (Array.isArray(r?.data?.warnings) ? r.data.warnings : []);
const today = () => db.prepare("SELECT date('now','localtime') d").get().d;

/** 违反业务规则的数据必须被拒绝 */
function expectBlocked(name, area, r, expectStatus) {
  if (r.status >= 400) {
    if (expectStatus && r.status !== expectStatus) {
      fail++; failures.push({ name, detail: `期望${expectStatus}实际${r.status}` });
      console.log(`  FAIL  ${name}  ->  期望 ${expectStatus}，实际 ${r.status} ${msg(r)}`);
      return;
    }
    pass++; console.log(`  PASS  ${name}  (${r.status} ${msg(r).slice(0, 60)})`);
  } else {
    fail++; failures.push({ name, detail: `未被拦截 status=${r.status}` });
    finding('高', area, `【回归】${name} 未被拦截`, `请求返回 200 OK，非法数据已写入：` + msg(r), '非法数据可入库', '需补硬校验');
    console.log(`  FAIL  ${name}  ->  未被拦截, status=${r.status}`);
  }
}
/** 异常但合理的数据：硬拦截或软警告都算被管控 */
function expectWarned(name, area, r) {
  if (warnsOf(r).length > 0) { pass++; console.log(`  PASS  ${name}  (软警告: ${warnsOf(r)[0]})`); }
  else if (r.status >= 400) { pass++; console.log(`  PASS  ${name}  (硬拦截 ${r.status})`); }
  else { fail++; failures.push({ name, detail: '既无警告也未拦截' }); console.log(`  FAIL  ${name}  ->  静默通过`); }
}

const created = { projects: [] };
async function mkProject(code, extra = {}) {
  const r = await api(A, 'POST', '/projects', { code, name: 'BC测试-' + code, type: '其他', ...extra });
  if (r.status === 200 && r.data?.id) created.projects.push(r.data.id);
  else r._mkFail = true;
  return r;
}

let A, Z, L;

async function main() {
  console.log(`\n===== 业务一致性深度测试（修复验证）  BASE=${BASE} =====\n`);
  const STAMP = Date.now().toString().slice(-7);

  console.log('--- S0 准备 ---');
  const la = await login('admin', '123456');
  A = la.data?.token;
  check('管理员登录成功', la.status === 200 && !!A, `status=${la.status} ${msg(la)}`);
  Z = (await login('zhangs', '123456')).data?.token;
  L = (await login('liuy', '123456')).data?.token;
  check('项目经理/业务员登录成功', !!Z && !!L, `zhangs=${!!Z} liuy=${!!L}`);
  console.log(`  服务端当前日期: ${today()}`);

  /* ===================== A 金额链路一致性 ===================== */
  console.log('\n--- A 金额链路一致性 ---');
  const PA = await mkProject(`BC-A-${STAMP}`, {
    budget: 100, start_date: '2026-01-01', end_date: '2026-12-31', status: '招标中'
  });
  const paId = PA.data?.id;

  const bidHi = await api(A, 'POST', '/bids', {
    project_id: paId, title: `BC招标-${STAMP}`, budget: 100,
    publish_date: '2026-02-01', signup_deadline: '2026-02-20', bid_open_date: '2026-03-01'
  });
  check('创建招标成功(无中标结果)', bidHi.status === 200, `status=${bidHi.status} ${msg(bidHi)}`);
  expectBlocked('中标金额高于招标控制价被拦截', '招标',
    await api(A, 'PUT', `/bids/${bidHi.data?.id}`, { ...bidHi.data, budget: 100, win_amount: 250, status: '已定标' }));
  expectBlocked('招标已定标但无中标单位被拦截', '招标',
    await api(A, 'PUT', `/bids/${bidHi.data?.id}`, { ...bidHi.data, winner: '', win_amount: 90, status: '已定标' }));
  expectBlocked('招标已定标但无中标金额被拦截', '招标',
    await api(A, 'PUT', `/bids/${bidHi.data?.id}`, { ...bidHi.data, winner: '某公司', win_amount: null, status: '已定标' }));
  const bidOk = await api(A, 'PUT', `/bids/${bidHi.data?.id}`,
    { ...bidHi.data, winner: '某公司', win_amount: 90, status: '已定标' });
  check('合法中标结果可保存', bidOk.status === 200, `status=${bidOk.status} ${msg(bidOk)}`);
  const dupNo = await api(A, 'POST', '/bids',
    { project_id: paId, title: 'BC编号重复招标', bid_no: `BC-NO-${STAMP}`, budget: 10 });
  await api(A, 'DELETE', `/bids/${dupNo.data?.id}`);
  check('招标编号可删除以便复用例', !!dupNo.data?.id, `id=${dupNo.data?.id}`);
  const dupNo2 = await api(A, 'POST', '/bids',
    { project_id: paId, title: 'BC编号重复招标A', bid_no: `BC-NO-${STAMP}` });
  expectBlocked('招标编号重复被拦截', '招标',
    await api(A, 'POST', '/bids', { project_id: paId, title: 'BC编号重复招标B', bid_no: `BC-NO-${STAMP}` }));
  await api(A, 'DELETE', `/bids/${dupNo2.data?.id}`);

  const ctMismatch = await api(A, 'POST', '/contracts', {
    project_id: paId, bid_id: bidHi.data?.id, name: `BC合同额不符-${STAMP}`, amount: 999,
    sign_date: '2026-03-10', start_date: '2026-03-10', end_date: '2026-12-31', status: '履行中'
  });
  expectWarned('合同额与中标额不一致被管控', '合同', ctMismatch);
  const ct2 = await api(A, 'POST', '/contracts', {
    project_id: paId, name: `BC第二份合同-${STAMP}`, amount: 500, status: '待签订'
  });
  expectWarned('合同额合计超过项目总投资被管控', '项目', ct2);
  expectBlocked('累计付款超过合同金额被拦截', '付款',
    await api(A, 'POST', `/contracts/${ct2.data?.id}/payments`, { amount: 800, pay_date: '2026-06-01', stage: '进度款' }));
  expectBlocked('付款金额为负被拦截', '付款',
    await api(A, 'POST', `/contracts/${ct2.data?.id}/payments`, { amount: -50, pay_date: '2026-06-02', stage: '退款' }));
  expectBlocked('付款日期格式非法被拦截', '付款',
    await api(A, 'POST', `/contracts/${ct2.data?.id}/payments`, { amount: 1, pay_date: 'not-a-date' }));
  expectBlocked('向不存在合同付款404', '付款',
    await api(A, 'POST', '/contracts/999999/payments', { amount: 10 }), 404);
  check('无孤儿付款记录', db.prepare('SELECT COUNT(*) c FROM contract_payments WHERE contract_id NOT IN (SELECT id FROM contracts)').get().c === 0, '');
  const payOk = await api(A, 'POST', `/contracts/${ct2.data?.id}/payments`,
    { amount: 300, pay_date: '2026-06-01', stage: '进度款' });
  check('合法付款可登记', payOk.status === 200, `status=${payOk.status} ${msg(payOk)}`);
  await api(A, 'DELETE', `/contracts/${ct2.data?.id}/payments/${payOk.data?.id}`);
  expectBlocked('招标负金额被拦截', '招标', await api(A, 'POST', '/bids', { project_id: paId, title: 'BC负控制价', budget: -1, win_amount: -5 }));
  expectBlocked('合同负金额被拦截', '合同', await api(A, 'POST', '/contracts', { project_id: paId, name: 'BC负合同额', amount: -10 }));
  expectBlocked('项目负总投资被拦截', '项目', await mkProject(`BC-AN-${STAMP}`, { budget: -100 }));
  const dupCt = await api(A, 'POST', '/contracts',
    { project_id: paId, name: 'BC编号重复合同A', amount: 1, contract_no: `BC-HT-${STAMP}` });
  check('首个合同编号可保存', dupCt.status === 200, `status=${dupCt.status} ${msg(dupCt)}`);
  expectBlocked('合同编号重复被拦截', '合同',
    await api(A, 'POST', '/contracts', { project_id: paId, name: 'BC编号重复合同B', amount: 1, contract_no: `BC-HT-${STAMP}` }));
  await api(A, 'DELETE', `/contracts/${dupCt.data?.id}`);

  /* ===================== B 日期链路一致性 ===================== */
  console.log('\n--- B 日期链路一致性 ---');
  const PB = await mkProject(`BC-B-${STAMP}`, { budget: 500, start_date: '2026-01-01', end_date: '2026-12-31', status: '施工中' });
  const pbId = PB.data?.id;
  const badDates = ['2026-02-30', '2026-13-01', '2026/01/01', '20260101', 'abc', '2026-01-01T00:00'];
  let allBlocked = true, slipped = [];
  for (const d of badDates) {
    const r = await api(A, 'POST', '/progress/records', { project_id: pbId, record_date: d, percent: 1 });
    if (r.status < 400) { allBlocked = false; slipped.push(d); await api(A, 'DELETE', `/progress/records/${r.data?.id}`); }
  }
  check('非法/日历不存在的日期全部被拦截', allBlocked, `未拦截: ${JSON.stringify(slipped)}`);
  if (slipped.length) finding('高', '日期校验', '【回归】非法日期仍可写入', JSON.stringify(slipped), '污染工期计算', '严格日历校验');

  expectWarned('填报日期早于项目开工被管控', '进度填报',
    await api(A, 'POST', '/progress/records', { project_id: pbId, record_date: '2025-06-01', percent: 1 }));
  const early = await api(A, 'GET', `/progress/records?project_id=${pbId}`);
  for (const r of listOf(early.data)) await api(A, 'DELETE', `/progress/records/${r.id}`);
  expectWarned('填报日期晚于项目完工被管控', '进度填报',
    await api(A, 'POST', '/progress/records', { project_id: pbId, record_date: '2027-06-01', percent: 1 }));
  for (const r of listOf((await api(A, 'GET', `/progress/records?project_id=${pbId}`)).data)) await api(A, 'DELETE', `/progress/records/${r.id}`);

  expectWarned('开标日期晚于项目开工被管控', '招标',
    await api(A, 'POST', '/bids', { project_id: pbId, title: `BC开标晚-${STAMP}`, budget: 10, publish_date: '2026-02-01', signup_deadline: '2026-02-10', bid_open_date: '2026-06-01' }));
  const bLate = listOf((await api(A, 'GET', '/bids?keyword=BC开标晚-' + STAMP)).data)[0];
  expectWarned('合同签订日期早于开标日期被管控', '合同',
    await api(A, 'POST', '/contracts', { project_id: pbId, bid_id: bLate?.id, name: `BC签订早-${STAMP}`, amount: 1, sign_date: '2026-01-15', start_date: '2026-03-01', end_date: '2026-06-01' }));
  expectWarned('合同超出项目工期被管控', '合同',
    await api(A, 'POST', '/contracts', { project_id: pbId, name: `BC超工期-${STAMP}`, amount: 1, start_date: '2025-01-01', end_date: '2025-06-01' }));
  expectWarned('计划超出项目工期被管控', '计划',
    await api(A, 'POST', '/plans', { project_id: pbId, name: `BC超工期计划-${STAMP}`, start_date: '2025-01-01', end_date: '2028-01-01' }));
  const plOut = listOf((await api(A, 'GET', '/plans')).data).find(p => String(p.name).includes(`BC超工期计划-${STAMP}`));
  expectBlocked('任务实际完成日期晚于今天被拦截', '计划任务',
    await api(A, 'POST', `/plans/${plOut?.id}/tasks`, { name: 'BC未来完成', weight: 10, status: '已完成', actual_start: '2026-01-01', actual_end: '2099-01-01' }));
  expectBlocked('任务实际开始晚于实际完成被拦截', '计划任务',
    await api(A, 'POST', `/plans/${plOut?.id}/tasks`, { name: 'BC实际倒置', weight: 10, actual_start: '2026-05-01', actual_end: '2026-04-01' }));
  expectBlocked('任务计划开始晚于计划完成被拦截', '计划任务',
    await api(A, 'POST', `/plans/${plOut?.id}/tasks`, { name: 'BC计划倒置', weight: 10, start_date: '2026-05-01', end_date: '2026-04-01' }));
  expectWarned('里程碑实际完成早于项目开工被管控', '里程碑',
    await api(A, 'POST', '/progress/milestones', { project_id: pbId, name: `BC早于开工里程碑-${STAMP}`, status: '已完成', actual_date: '2025-01-01' }));

  /* ===================== C 进度填报数据冲突 ===================== */
  console.log('\n--- C 进度填报数据冲突 ---');
  const PC = await mkProject(`BC-C-${STAMP}`, { budget: 300, start_date: '2026-01-01', end_date: '2026-12-31', status: '施工中' });
  const pcId = PC.data?.id;
  const c1 = await api(A, 'POST', '/progress/records', { project_id: pcId, record_date: '2026-03-31', period: `${STAMP}Q1`, percent: 30 });
  await api(A, 'POST', '/progress/records', { project_id: pcId, record_date: '2026-06-30', period: `${STAMP}Q2`, percent: 60 });
  await api(A, 'POST', '/progress/records', { project_id: pcId, record_date: '2026-09-30', period: `${STAMP}Q3`, percent: 85 });
  check('可连续填报递增进度', c1.status === 200, `status=${c1.status} ${msg(c1)}`);

  expectBlocked('回填"更早日期+更高百分比"被拦截', '进度填报',
    await api(A, 'POST', '/progress/records', { project_id: pcId, record_date: '2026-04-30', period: `${STAMP}Q补`, percent: 99 }));
  const c2row = listOf((await api(A, 'GET', `/progress/records?project_id=${pcId}`)).data).find(r => r.record_date === '2026-06-30');
  expectBlocked('编辑中间报告期高于更晚期被拦截', '进度填报',
    await api(A, 'PUT', `/progress/records/${c2row?.id}`, { percent: 99 }));
  expectBlocked('编辑中间报告期低于更早期被拦截', '进度填报',
    await api(A, 'PUT', `/progress/records/${c2row?.id}`, { percent: 10 }));
  expectBlocked('同一天重复填报被拦截', '进度填报',
    await api(A, 'POST', '/progress/records', { project_id: pcId, record_date: '2026-06-30', period: `${STAMP}Q2重`, percent: 61 }));
  expectBlocked('同一报告期重复填报被拦截', '进度填报',
    await api(A, 'POST', '/progress/records', { project_id: pcId, record_date: '2026-08-15', period: `${STAMP}Q2`, percent: 70 }));
  const pctCases = [['非数字字符串', 'abc'], ['布尔值', true], ['科学计数法字符串', '1e2'], ['小数', 60.5], ['负数', -1], ['超上限', 101], ['空字符串', '']];
  let pctAllBlocked = true;
  for (const [, v] of pctCases) {
    const r = await api(A, 'POST', '/progress/records', { project_id: pcId, record_date: '2026-10-10', percent: v });
    if (r.status < 400) { pctAllBlocked = false; await api(A, 'DELETE', `/progress/records/${r.data?.id}`); }
  }
  check('percent 非法取值全部被拦截', pctAllBlocked, '');

  await api(A, 'PUT', `/projects/${pcId}`, { status: '已完工' });
  expectBlocked('已完工项目新增进度填报被拦截', '进度填报',
    await api(A, 'POST', '/progress/records', { project_id: pcId, record_date: '2026-12-20', period: `${STAMP}Q4`, percent: 100 }));
  await api(A, 'PUT', `/projects/${pcId}`, { status: '施工中' });

  // 部分字段更新不得清空其余字段
  await api(A, 'POST', '/progress/records', {
    project_id: pcId, record_date: '2026-05-20', period: `${STAMP}Q1-5`,
    percent: 55, work_done: '本期完成内容X', issues: '问题Y', next_plan: '计划Z', reporter: '张三'
  });
  const recRow = listOf((await api(A, 'GET', `/progress/records?project_id=${pcId}`)).data)
    .find(r => r.period === `${STAMP}Q1-5`);
  const partialRec = await api(A, 'PUT', `/progress/records/${recRow.id}`, { percent: 58 });
  const recAfter = listOf((await api(A, 'GET', `/progress/records?project_id=${pcId}`)).data).find(r => r.id === recRow.id);
  check('进度填报部分字段更新不清空其余字段',
    partialRec.status === 200 && recAfter.work_done === '本期完成内容X' &&
    recAfter.issues === '问题Y' && recAfter.next_plan === '计划Z' && recAfter.reporter === '张三' && recAfter.period === `${STAMP}Q1-5`,
    `status=${partialRec.status} 更新后=${JSON.stringify({ work_done: recAfter.work_done, issues: recAfter.issues, reporter: recAfter.reporter, period: recAfter.period })}`);

  // 最新进度口径一致
  const listRow = (await api(A, 'GET', `/projects?keyword=BC-C-${STAMP}`)).data.list[0];
  const detRow = (await api(A, 'GET', `/projects/${pcId}`)).data;
  const statRow = (await api(A, 'GET', '/stats/overview')).data.projectProgress.find(r => String(r.name).includes(`BC-C-${STAMP}`));
  const dbPct = db.prepare('SELECT percent p FROM progress_records WHERE project_id=? ORDER BY record_date DESC,id DESC LIMIT 1').get(pcId)?.p;
  check('最新进度在列表/详情/统计/库中口径一致',
    listRow?.latest_percent === detRow?.latest_percent && detRow?.latest_percent === statRow?.percent && statRow?.percent === dbPct,
    JSON.stringify({ list: listRow?.latest_percent, detail: detRow?.latest_percent, stats: statRow?.percent, db: dbPct }));

  /* ===================== D 计划/任务一致性 ===================== */
  console.log('\n--- D 计划/任务一致性 ---');
  const PD = await mkProject(`BC-D-${STAMP}`, { budget: 500, start_date: '2026-01-01', end_date: '2026-12-31' });
  const pdId = PD.data?.id;
  const PL = await api(A, 'POST', '/plans', {
    project_id: pdId, name: `BC权重计划-${STAMP}`, year: 2026,
    start_date: '2026-01-01', end_date: '2026-12-31', owner: '张三', status: '执行中', description: '原始说明'
  });
  const plId = PL.data?.id;
  const mkTask = (name, weight) => api(A, 'POST', `/plans/${plId}/tasks`,
    { name: `BC任务-${name}-${STAMP}`, owner: '甲', weight, start_date: '2026-01-01', end_date: '2026-06-30' });
  await mkTask('A', 40); await mkTask('B', 40);
  expectBlocked('任务权重合计超过100%被拦截', '计划任务', await mkTask('C', 40));
  const sumW = db.prepare('SELECT COALESCE(SUM(weight),0) s FROM plan_tasks WHERE plan_id=?').get(plId).s;
  check('计划权重合计未超过100%', sumW <= 100.01, `合计=${sumW}`);
  expectBlocked('任务权重>100被拦截', '计划任务', await mkTask('D', 101));
  expectBlocked('任务权重为负被拦截', '计划任务', await mkTask('E', -1));
  expectBlocked('任务权重非数字被拦截', '计划任务', await mkTask('F', 'abc'));

  partialPlanFix: {
    const before = db.prepare('SELECT * FROM plans WHERE id=?').get(plId);
    const onlyStatus = await api(A, 'PUT', `/plans/${plId}`, { status: '已归档' });
    const row1 = db.prepare('SELECT * FROM plans WHERE id=?').get(plId);
    const keptA = onlyStatus.status === 200 && row1.name === before.name && row1.project_id === before.project_id &&
      row1.year === before.year && row1.owner === before.owner && row1.start_date === before.start_date &&
      row1.end_date === before.end_date && row1.description === before.description && row1.status === '已归档';
    check('计划只提交 status 的局部更新：其余字段全部保留', keptA,
      `status=${onlyStatus.status} row=${JSON.stringify(row1)}`);
    const withRequired = await api(A, 'PUT', `/plans/${plId}`,
      { project_id: pdId, name: `BC权重计划-${STAMP}`, status: '执行中' });
    const row2 = db.prepare('SELECT * FROM plans WHERE id=?').get(plId);
    const keptB = withRequired.status === 200 && row2.year === before.year && row2.owner === before.owner &&
      row2.start_date === before.start_date && row2.description === before.description;
    check('计划带必填字段的局部更新：可空字段未被清空', keptB,
      `status=${withRequired.status} row=${JSON.stringify(row2)}`);
  }

  const tkFresh = await api(A, 'POST', `/plans/${plId}/tasks`, {
    name: `BC任务-局部-${STAMP}`, owner: '李四', weight: 10,
    start_date: '2026-01-01', end_date: '2026-06-30', remark: '原始备注'
  });
  const onlyStatusTk = await api(A, 'PUT', `/plans/${plId}/tasks/${tkFresh.data?.id}`, { status: '进行中' });
  const tRow1 = db.prepare('SELECT * FROM plan_tasks WHERE id=?').get(tkFresh.data?.id);
  check('任务只提交 status 的局部更新：其余字段保留',
    onlyStatusTk.status === 200 && tRow1.owner === '李四' && tRow1.weight === 10 &&
    tRow1.start_date === '2026-01-01' && tRow1.remark === '原始备注',
    `status=${onlyStatusTk.status} row=${JSON.stringify(tRow1)}`);
  const withNameTk = await api(A, 'PUT', `/plans/${plId}/tasks/${tkFresh.data?.id}`, { name: `BC任务-改名-${STAMP}` });
  const tRow2 = db.prepare('SELECT * FROM plan_tasks WHERE id=?').get(tkFresh.data?.id);
  check('任务带 name 的局部更新：owner/weight/日期/备注未清空',
    withNameTk.status === 200 && tRow2.owner === '李四' && tRow2.weight === 10 && tRow2.remark === '原始备注',
    `row=${JSON.stringify(tRow2)}`);

  const msFresh = await api(A, 'POST', '/progress/milestones',
    { project_id: pdId, name: `BC里程碑-${STAMP}`, plan_date: '2026-11-01', status: '未开始' });
  await api(A, 'PUT', `/progress/milestones/${msFresh.data?.id}`, { name: `BC里程碑改名-${STAMP}` });
  const msRow = db.prepare('SELECT * FROM milestones WHERE id=?').get(msFresh.data?.id);
  check('里程碑只提交 name 的局部更新：plan_date 保留', msRow?.plan_date === '2026-11-01', JSON.stringify(msRow));

  // 完成度统计
  const tasks = db.prepare('SELECT id FROM plan_tasks WHERE plan_id=?').all(plId);
  for (const t of tasks) {
    await api(A, 'PUT', `/plans/${plId}/tasks/${t.id}`, { status: '已完成', actual_start: '2026-01-01', actual_end: '2026-06-30' });
  }
  const plListRow = listOf((await api(A, 'GET', '/plans')).data).find(p => p.id === plId);
  check('计划完成度不超过100%', (plListRow?.done_weight ?? 0) <= 100.01, `done_weight=${plListRow?.done_weight}`);
  const projD = (await api(A, 'GET', `/projects/${pdId}`)).data;
  check('项目层计划完成度与计划层一致',
    Math.abs((projD.plan_done_weight ?? 0) - (plListRow?.done_weight ?? 0)) < 0.01,
    `project=${projD.plan_done_weight} plan=${plListRow?.done_weight}`);
  for (const t of tasks) await api(A, 'DELETE', `/plans/${plId}/tasks/${t.id}`);
  const emptyRow = listOf((await api(A, 'GET', '/plans')).data).find(p => p.id === plId);
  check('任务清空后计划完成度归零', Number(emptyRow?.done_weight || 0) === 0, `done_weight=${emptyRow?.done_weight}`);
  await api(A, 'POST', `/plans/${plId}/tasks`, { name: 'BC删除联动任务', weight: 10 });
  await api(A, 'DELETE', `/plans/${plId}`);
  check('删除计划级联删除任务', db.prepare('SELECT COUNT(*) c FROM plan_tasks WHERE plan_id=?').get(plId).c === 0, '');

  /* ===================== E 状态流转一致性 ===================== */
  console.log('\n--- E 状态流转一致性 ---');
  const PE = await mkProject(`BC-E-${STAMP}`, { budget: 200, start_date: '2026-01-01', end_date: '2026-12-31', status: '筹备中' });
  const peId = PE.data?.id;
  await api(A, 'POST', '/contracts', { project_id: peId, name: `BC履行中合同-${STAMP}`, amount: 50, status: '履行中', sign_date: '2026-02-01' });
  check('履行中合同把筹备中项目推进为施工中',
    (await api(A, 'GET', `/projects/${peId}`)).data?.status === '施工中', '');
  expectBlocked('有履行中合同的项目不能退回招标中', '状态联动',
    await api(A, 'PUT', `/projects/${peId}`, { status: '招标中' }));
  expectBlocked('有履行中合同的项目不能退回筹备中', '状态联动',
    await api(A, 'PUT', `/projects/${peId}`, { status: '筹备中' }));
  await api(A, 'PUT', `/projects/${peId}`, { status: '施工中' });
  expectBlocked('招标状态已定标但无中标单位被拦截', '招标',
    await api(A, 'POST', '/bids', { project_id: peId, title: `BC已定标无中标人-${STAMP}`, budget: 20, status: '已定标' }));
  expectWarned('履行中合同无签订日期被管控', '合同',
    await api(A, 'POST', '/contracts', { project_id: peId, name: `BC履行中无签订日-${STAMP}`, amount: 10, status: '履行中' }));
  await api(A, 'POST', '/progress/records', { project_id: peId, record_date: '2026-03-31', period: `${STAMP}E1`, percent: 40 });
  expectWarned('项目标记已完工但进度不足100%被管控', '项目', await api(A, 'PUT', `/projects/${peId}`, { status: '已完工' }));
  await api(A, 'PUT', `/projects/${peId}`, { status: '施工中' });

  /* ===================== F 变更审批一致性 ===================== */
  console.log('\n--- F 变更审批一致性 ---');
  const PF = await mkProject(`BC-F-${STAMP}`, { budget: 100, start_date: '2026-01-01', end_date: '2026-12-31' });
  const pfId = PF.data?.id;
  const fBid = await api(A, 'POST', '/bids', { project_id: pfId, title: `BC审批招标-${STAMP}`, budget: 50, publish_date: '2026-02-01', signup_deadline: '2026-02-10', bid_open_date: '2026-02-20' });
  const fCt = await api(A, 'POST', '/contracts', { project_id: pfId, name: `BC审批合同-${STAMP}`, amount: 30, start_date: '2026-03-01', end_date: '2026-10-01' });
  const fRec = await api(A, 'POST', '/progress/records', { project_id: pfId, record_date: '2026-04-30', period: `${STAMP}F1`, percent: 20 });
  const fRec2 = await api(A, 'POST', '/progress/records', { project_id: pfId, record_date: '2026-06-30', period: `${STAMP}F2`, percent: 40 });
  const fMs = await api(A, 'POST', '/progress/milestones', { project_id: pfId, name: `BC审批里程碑-${STAMP}`, plan_date: '2026-12-01' });
  const fPl = await api(A, 'POST', '/plans', { project_id: pfId, name: `BC审批计划-${STAMP}`, start_date: '2026-01-01', end_date: '2026-12-31' });
  const fTk = await api(A, 'POST', `/plans/${fPl.data?.id}/tasks`, { name: `BC审批任务-${STAMP}`, weight: 10 });

  const targets = { project: pfId, bid: fBid.data?.id, contract: fCt.data?.id, progress_record: fRec.data?.id, milestone: fMs.data?.id, plan: fPl.data?.id, task: fTk.data?.id };
  const urlOf = (t, id) => t === 'task' ? `/plans/${fPl.data?.id}/tasks/${id}`
    : t === 'plan' ? `/plans/${id}` : t === 'progress_record' ? `/progress/records/${id}`
      : t === 'milestone' ? `/progress/milestones/${id}` : `/${t}s/${id}`;
  const illPayloads = [
    ['project', { budget: -100 }, '项目总投资改为负数'],
    ['project', { start_date: '2027-01-01', end_date: '2026-01-01' }, '项目工期倒置'],
    ['bid', { publish_date: '2026-05-01', signup_deadline: '2026-04-01' }, '招标发布晚于报名截止'],
    ['bid', { budget: 50, win_amount: 90, status: '已定标', winner: '某单位' }, '招标中标价超控制价'],
    ['contract', { start_date: '2026-06-01', end_date: '2026-05-01' }, '合同日期倒置'],
    ['progress_record', { percent: 200 }, '进度百分比200', fRec.data?.id],
    ['progress_record', { percent: 5 }, '进度低于更早报告期', fRec2.data?.id],
    ['milestone', { status: '已完成' }, '里程碑标完成但无实际日期'],
    ['task', { weight: 150 }, '任务权重150'],
    ['task', { status: '已完成' }, '任务标完成但无实际日期']
  ];
  let bothBlocked = 0, drift = [];
  for (const [type, payload, desc, overrideId] of illPayloads) {
    const id = overrideId ?? targets[type];
    const direct = await api(A, 'PUT', urlOf(type, id), payload);
    const cr = await api(L, 'POST', '/change-requests', { target_type: type, target_id: id, payload });
    let ap = { status: -1 };
    if (cr.status === 200 && cr.data?.id) {
      ap = await api(A, 'POST', `/change-requests/${cr.data.id}/approve`, {});
      if (ap.status === 200) drift.push(desc);
      await api(A, 'POST', `/change-requests/${cr.data.id}/reject`, { comment: '测试清理' });
    } else {
      drift.push(desc + '(申请未创建)');
    }
    if (direct.status >= 400 && ap.status >= 400) bothBlocked++;
    else drift.push(`${desc}(直接=${direct.status},审批=${ap.status})`);
  }
  check('非法变更在"直接改"与"审批改"两条路径上均被拦截', bothBlocked === illPayloads.length && drift.length === 0,
    `${bothBlocked}/${illPayloads.length} 例外=${JSON.stringify(drift)}`);
  await api(A, 'DELETE', `/progress/records/${fRec2.data?.id}`);

  // 并发申请：批准其一后其余自动作废，且不允许覆盖后续修改
  const PF2 = await mkProject(`BC-F2-${STAMP}`, { budget: 100, location: '初始地点' });
  const pf2 = PF2.data?.id;
  const crA = await api(L, 'POST', '/change-requests', { target_type: 'project', target_id: pf2, payload: { location: '地点A' } });
  const crB = await api(Z, 'POST', '/change-requests', { target_type: 'project', target_id: pf2, payload: { location: '地点B' } });
  const apA = await api(A, 'POST', `/change-requests/${crA.data?.id}/approve`, {});
  const apB = await api(A, 'POST', `/change-requests/${crB.data?.id}/approve`, {});
  const pf2Row = (await api(A, 'GET', `/projects/${pf2}`)).data;
  const crBRow = (await api(A, 'GET', `/change-requests/${crB.data?.id}`)).data;
  check('同对象第二条待审批申请被自动作废或拒绝',
    crBRow?.status !== 'approved' && (apB.status >= 400 || crBRow?.status === 'superseded'),
    `apB=${apB.status} crB状态=${crBRow?.status} 最终location=${pf2Row?.location}`);
  check('已通过申请的内容真实生效', pf2Row?.location === '地点A', `location=${pf2Row?.location}`);

  // 过期快照：提交后目标被管理员改动，再审批必须被拦
  const crOld = await api(L, 'POST', '/change-requests', { target_type: 'project', target_id: pf2, payload: { manager: '审批写入人' } });
  await api(A, 'PUT', `/projects/${pf2}`, { manager: '管理员直改人' });
  const apOld = await api(A, 'POST', `/change-requests/${crOld.data?.id}/approve`, {});
  const pf2Row2 = (await api(A, 'GET', `/projects/${pf2}`)).data;
  check('基于过期快照的审批被拦截，未覆盖后续修改',
    apOld.status >= 400 && pf2Row2?.manager === '管理员直改人',
    `apOld=${apOld.status} manager=${pf2Row2?.manager} msg=${msg(apOld)}`);

  const crDel1 = await api(L, 'POST', '/change-requests', { target_type: 'project', target_id: pfId, payload: { description: '待审批' } });
  check('待审批申请创建成功', crDel1.status === 200, `status=${crDel1.status}`);
  check('业务员查看他人申请403', (await api(Z, 'GET', `/change-requests/${crDel1.data?.id}`)).status === 403, '');
  check('业务员可查看自己提交的申请', (await api(L, 'GET', `/change-requests/${crDel1.data?.id}`)).status === 200, '');
  check('业务员审批申请403', (await api(L, 'POST', `/change-requests/${crDel1.data?.id}/approve`, {})).status === 403, '');

  /* ===================== G 级联删除与孤儿数据 ===================== */
  console.log('\n--- G 级联删除与孤儿数据 ---');
  const PG = await mkProject(`BC-G-${STAMP}`, { budget: 300 });
  const pgId = PG.data?.id;
  const gBid = await api(A, 'POST', '/bids', { project_id: pgId, title: `BC级联招标-${STAMP}`, status: '已定标', winner: '某单位', win_amount: 50 });
  const gCt = await api(A, 'POST', '/contracts', { project_id: pgId, bid_id: gBid.data?.id, name: `BC级联合同-${STAMP}`, amount: 50, status: '履行中', sign_date: '2026-03-01' });
  await api(A, 'POST', `/contracts/${gCt.data?.id}/payments`, { amount: 10, pay_date: '2026-05-01', stage: '预付款' });
  await api(A, 'POST', '/progress/records', { project_id: pgId, record_date: '2026-05-01', period: `${STAMP}G1`, percent: 20 });
  await api(A, 'POST', '/progress/milestones', { project_id: pgId, name: `BC级联里程碑-${STAMP}` });
  const gPl = await api(A, 'POST', '/plans', { project_id: pgId, name: `BC级联计划-${STAMP}` });
  await api(A, 'POST', `/plans/${gPl.data?.id}/tasks`, { name: 'BC级联任务', weight: 10 });
  await api(A, 'POST', '/change-requests', { target_type: 'project', target_id: pgId, payload: { description: '待审批' } });
  await api(A, 'POST', '/change-requests', { target_type: 'bid', target_id: gBid.data?.id, payload: { title: '改名' } });
  await api(A, 'DELETE', `/bids/${gBid.data?.id}`);
  check('删除招标后合同 bid_id 置空',
    db.prepare('SELECT bid_id FROM contracts WHERE id=?').get(gCt.data?.id)?.bid_id === null, '');
  await api(A, 'DELETE', `/projects/${pgId}`);
  const orphans = {
    bids: db.prepare('SELECT COUNT(*) c FROM bids WHERE project_id=?').get(pgId).c,
    contracts: db.prepare('SELECT COUNT(*) c FROM contracts WHERE project_id=?').get(pgId).c,
    payments: db.prepare('SELECT COUNT(*) c FROM contract_payments WHERE contract_id NOT IN (SELECT id FROM contracts)').get().c,
    progress: db.prepare('SELECT COUNT(*) c FROM progress_records WHERE project_id=?').get(pgId).c,
    milestones: db.prepare('SELECT COUNT(*) c FROM milestones WHERE project_id=?').get(pgId).c,
    plans: db.prepare('SELECT COUNT(*) c FROM plans WHERE project_id=?').get(pgId).c,
    tasks: db.prepare('SELECT COUNT(*) c FROM plan_tasks WHERE plan_id NOT IN (SELECT id FROM plans)').get().c
  };
  check('删除项目后无子表残留', Object.values(orphans).every(v => v === 0), JSON.stringify(orphans));
  const crTotal = db.prepare(`
    SELECT COUNT(*) c FROM change_requests WHERE
      (target_type='project' AND target_id NOT IN (SELECT id FROM projects)) OR
      (target_type='bid' AND target_id NOT IN (SELECT id FROM bids)) OR
      (target_type='contract' AND target_id NOT IN (SELECT id FROM contracts)) OR
      (target_type='progress_record' AND target_id NOT IN (SELECT id FROM progress_records)) OR
      (target_type='milestone' AND target_id NOT IN (SELECT id FROM milestones)) OR
      (target_type='plan' AND target_id NOT IN (SELECT id FROM plans)) OR
      (target_type='task' AND target_id NOT IN (SELECT id FROM plan_tasks))`).get().c;
  check('无孤儿审批记录', crTotal === 0, `残留=${crTotal}`);
  const rec4 = await api(A, 'POST', '/progress/records', { project_id: pfId, record_date: '2026-05-20', period: `${STAMP}G2`, percent: 45 });
  const crRec = await api(L, 'POST', '/change-requests', { target_type: 'progress_record', target_id: rec4.data?.id, payload: { percent: 50 } });
  await api(A, 'DELETE', `/progress/records/${rec4.data?.id}`);
  check('删除进度填报后其审批申请被清理',
    db.prepare("SELECT COUNT(*) c FROM change_requests WHERE target_type='progress_record' AND target_id NOT IN (SELECT id FROM progress_records)").get().c === 0,
    `cr=${crRec.status}`);

  /* ===================== H 统计口径一致性 ===================== */
  console.log('\n--- H 统计口径一致性 ---');
  const stats = (await api(A, 'GET', '/stats/overview')).data;
  const plist = (await api(A, 'GET', '/projects?pageSize=200')).data.list;
  check('统计-项目总数与列表总数一致', stats.cards.projectTotal === plist.length, `${stats.cards.projectTotal} vs ${plist.length}`);
  check('统计-累计付款金额与数据库一致',
    Math.abs(stats.cards.paidAmount - db.prepare('SELECT COALESCE(SUM(amount),0) s FROM contract_payments').get().s) < 0.01, '');
  check('统计-合同总额与数据库一致',
    Math.abs(stats.cards.contractAmount - db.prepare('SELECT COALESCE(SUM(amount),0) s FROM contracts').get().s) < 0.01, '');
  check('统计-履行中合同数一致',
    stats.cards.contractRunning === db.prepare("SELECT COUNT(*) c FROM contracts WHERE status='履行中'").get().c, '');
  const avgDb = db.prepare(`SELECT AVG(percent) a FROM progress_records WHERE id IN (
      SELECT (SELECT id FROM progress_records WHERE project_id=p.id ORDER BY record_date DESC,id DESC LIMIT 1)
      FROM (SELECT DISTINCT project_id AS id FROM progress_records) p)`).get().a;
  check('统计-平均进度口径一致', avgDb == null || Math.abs((stats.cards.avgProgress || 0) - Math.round(avgDb * 10) / 10) < 0.11,
    `stats=${stats.cards.avgProgress} db=${avgDb}`);
  const PH = await mkProject(`BC-H-${STAMP}`, { budget: 100, start_date: '2026-01-01', end_date: '2026-12-31', status: '施工中' });
  const phId = PH.data?.id;
  const plH = await api(A, 'POST', '/plans', { project_id: phId, name: `BC偏差计划-${STAMP}`, year: 2026, status: '执行中' });
  await api(A, 'POST', `/plans/${plH.data?.id}/tasks`, { name: 'BC未完成任务', weight: 100, status: '未开始' });
  await api(A, 'POST', '/progress/records', { project_id: phId, record_date: '2026-06-30', period: `${STAMP}H1`, percent: 90 });
  const dev = (await api(A, 'GET', '/stats/overview')).data.deviations.find(d => d.id === phId);
  check('进度与计划完成度偏差被预警捕获', !!dev && Math.abs(dev.progress_pct - dev.plan_done) > 15, JSON.stringify(dev));
  const PH2 = await mkProject(`BC-H2-${STAMP}`, { budget: 100, status: '施工中' });
  check('施工但无计划的项目进入预警',
    !!(await api(A, 'GET', '/stats/overview')).data.planMissing.find(d => d.id === PH2.data?.id), '');
  const csvResp = await fetch(BASE + '/api/projects?export=csv', { headers: { Authorization: 'Bearer ' + A } });
  const csvBuf = Buffer.from(await csvResp.arrayBuffer());
  check('项目 CSV 导出可用且带 BOM', csvBuf[0] === 0xEF && csvBuf[1] === 0xBB && csvBuf[2] === 0xBF, csvBuf.slice(0, 6).toString('hex'));
  check('空结果集导出不报错', (await api(A, 'GET', '/progress/records?project_id=999999&export=csv')).status === 200, '');

  /* ===================== I 稳定性与健壮性 ===================== */
  console.log('\n--- I 稳定性与健壮性 ---');
  const PCONC = await mkProject(`BC-CONC-${STAMP}`, { budget: 100, start_date: '2026-01-01', end_date: '2026-12-31', status: '施工中' });
  const concurrentWrites = await Promise.all(Array.from({ length: 20 }, (_, i) =>
    api(A, 'POST', '/progress/records', {
      project_id: PCONC.data?.id, record_date: `2026-07-${String(i + 1).padStart(2, '0')}`,
      period: `${STAMP}C${i}`, percent: 20 + i
    })));
  check('20 并发写请求无 5xx', concurrentWrites.every(r => r.status < 500),
    `状态集=${JSON.stringify([...new Set(concurrentWrites.map(r => r.status))])}`);
  for (const r of concurrentWrites) if (r.status === 200 && r.data?.id) await api(A, 'DELETE', `/progress/records/${r.data.id}`);
  check('30 并发读全部 200',
    (await Promise.all(Array.from({ length: 30 }, () => api(A, 'GET', '/projects?pageSize=5')))).every(r => r.status === 200), '');

  const bigNum = await api(A, 'POST', '/projects', { code: `BC-BIG-${STAMP}`, name: 'x'.repeat(5000), budget: 1e308 });
  check('超长字符串/极大数值不崩溃', bigNum.status < 500, `status=${bigNum.status}`);
  if (bigNum.data?.id) await api(A, 'DELETE', `/projects/${bigNum.data.id}`);
  const emoji = await api(A, 'POST', '/projects', { code: `BC-EMO-${STAMP}`, name: '表情🚀<script>', description: '中文，含逗号"引号"' });
  check('Emoji/HTML/特殊字符可保存', emoji.status === 200, `status=${emoji.status}`);
  if (emoji.data?.id) await api(A, 'DELETE', `/projects/${emoji.data.id}`);

  let jsonErr = 0;
  for (const b of ['{invalid', '[1,2,3]', '"string"', 'null', '<xml/>', '{"a":']) {
    const r = await api(A, 'POST', '/projects', undefined, b);
    if (r.status >= 400 && r.status < 500) jsonErr++;
  }
  check('非法/非对象 JSON 返回 4xx', jsonErr === 6, `通过=${jsonErr}/6`);
  check('PUT 空 body 不导致 500', (await api(A, 'PUT', `/projects/${pfId}`, undefined, '')).status < 500, '');
  const arrBody = await api(A, 'PUT', `/plans/${fPl.data?.id}`, undefined, '[1,2,3]');
  const fPlRow = db.prepare('SELECT * FROM plans WHERE id=?').get(fPl.data?.id);
  check('PUT 数组体不会破坏计划数据',
    fPlRow && fPlRow.name !== null && fPlRow.project_id !== null, `status=${arrBody.status} row=${JSON.stringify(fPlRow)}`);

  for (const [pg, size] of [[-1, 10], [0, 10], [1, 0], [1, -5], [1, 999999], [99999, 10], ['abc', 'xyz']]) {
    const r = await api(A, 'GET', `/projects?page=${pg}&pageSize=${size}`);
    if (!(r.status === 200 && Array.isArray(r.data.list))) {
      fail++; failures.push({ name: `分页 ${pg}/${size}`, detail: `status=${r.status}` });
      console.log(`  FAIL  分页参数 ${pg}/${size}  ->  status=${r.status}`);
    }
  }
  check('分页异常参数不崩溃且返回数组', true, '');
  const bigPageSize = await api(A, 'GET', '/projects?pageSize=-5');
  check('负 pageSize 不会返回全表', listOf(bigPageSize.data).length <= 200, `返回=${listOf(bigPageSize.data).length}`);

  const before = db.prepare('SELECT COUNT(*) c FROM projects').get().c;
  let injOk = 0;
  for (const s of ["' OR 1=1--", "'; DROP TABLE projects;--", '1 UNION SELECT * FROM users', '%', '_']) {
    if ((await api(A, 'GET', '/projects?keyword=' + encodeURIComponent(s))).status === 200) injOk++;
  }
  check('注入关键词查询无副作用',
    injOk === 5 && db.prepare('SELECT COUNT(*) c FROM projects').get().c === before, `ok=${injOk}`);

  const proto = await fetch(BASE + '/api/projects', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + A },
    body: JSON.stringify({ code: `BC-PP-${STAMP}`, name: '原型污染', __proto__: { polluted: 'yes' } })
  });
  const protoData = await proto.json().catch(() => ({}));
  check('__proto__ 未被写入且对象未被污染', proto.status < 500 && ({}).polluted === undefined, `polluted=${({}).polluted}`);
  if (protoData?.id) await api(A, 'DELETE', `/projects/${protoData.id}`);

  const tokStatus = [];
  for (const t of ['', 'Bearer', 'Bearer ', 'Bearer ' + A + 'x', 'Basic ' + btoa('admin:123456')]) {
    tokStatus.push((await fetch(BASE + '/api/projects', { headers: { Authorization: t } })).status);
  }
  check('异常 Authorization 头一律 401', tokStatus.every(s => s === 401), tokStatus.join(','));

  // 会话生命周期（使用临时 token，避免影响主 token）
  const tmpLogin = await login('admin', '123456');
  const tmpT = tmpLogin.data?.token;
  const logoutResp = await api(tmpT, 'POST', '/logout', {});
  const afterLogout = await api(tmpT, 'GET', '/me');
  check('登出接口存在并销毁服务端会话',
    logoutResp.status === 200 && afterLogout.status === 401,
    `logout=${logoutResp.status} me=${afterLogout.status}`);
  check('登出不影响其他会话', (await api(A, 'GET', '/me')).status === 200, '');

  // 登录失败锁定（使用临时账号，避免污染 admin）
  const tmpUser = 'bcuser' + (Date.now() % 100000);
  await api(A, 'POST', '/users', { username: tmpUser, real_name: '锁定测试', password: 'test123456', role: '业务员' });
  const codes = {};
  for (let i = 1; i <= 8; i++) {
    const r = await login(tmpUser, 'wrong-' + i);
    codes[r.status] = (codes[r.status] || 0) + 1;
  }
  const lockedResp = await login(tmpUser, 'test123456');
  check('连续错误密码触发账号锁定',
    Object.keys(codes).some(k => Number(k) === 403) && lockedResp.status === 403,
    `分布=${JSON.stringify(codes)} 正确密码=${lockedResp.status} msg=${msg(lockedResp)}`);

  const backup = await api(A, 'POST', '/backup', {});
  check('管理员可触发数据库备份', backup.status === 200, `status=${backup.status}`);
  check('备份完整性校验通过', backup.data?.integrity === 'ok', `integrity=${backup.data?.integrity}`);
  check('业务员备份403', (await api(L, 'POST', '/backup', {})).status === 403, '');
  check('通知未读数接口可用', (await api(L, 'GET', '/notifications/unread-count')).status === 200, '');
  check('审计日志无空模块/空动作记录',
    db.prepare('SELECT COUNT(*) c FROM audit_logs WHERE action IS NULL OR module IS NULL').get().c === 0, '');
  check('查询操作未写入审计日志',
    db.prepare("SELECT COUNT(*) c FROM audit_logs WHERE method='GET'").get().c === 0, '');

  /* ===================== J 边界值与并发竞态 ===================== */
  console.log('\n--- J 边界值与并发竞态 ---');
  const PJ = await mkProject(`BC-J-${STAMP}`, {
    budget: 1000, start_date: '2026-01-01', end_date: '2028-12-31', status: '施工中'
  });
  const pjId = PJ.data?.id;

  // 闰年：2028-02-29 存在，2027-02-29 不存在
  check('闰年日期 2028-02-29 被接受',
    (await api(A, 'POST', '/progress/records', { project_id: pjId, record_date: '2028-02-29', period: `${STAMP}J-闰`, percent: 1 })).status === 200, '');
  for (const r of listOf((await api(A, 'GET', `/progress/records?project_id=${pjId}`)).data)) await api(A, 'DELETE', `/progress/records/${r.id}`);
  expectBlocked('非闰年日期 2027-02-29 被拦截', '日期校验',
    await api(A, 'POST', '/progress/records', { project_id: pjId, record_date: '2027-02-29', percent: 1 }));
  expectBlocked('月份 00 被拦截', '日期校验',
    await api(A, 'POST', '/progress/records', { project_id: pjId, record_date: '2028-00-10', percent: 1 }));
  expectBlocked('日 31 出现在 4 月被拦截', '日期校验',
    await api(A, 'POST', '/progress/records', { project_id: pjId, record_date: '2028-04-31', percent: 1 }));

  // 进度边界：0 / 100 / 相邻报告期等值
  const r0 = await api(A, 'POST', '/progress/records', { project_id: pjId, record_date: '2026-02-01', period: `${STAMP}J1`, percent: 0 });
  check('进度 0% 可填报', r0.status === 200, `status=${r0.status} ${msg(r0)}`);
  const rEq = await api(A, 'POST', '/progress/records', { project_id: pjId, record_date: '2026-03-01', period: `${STAMP}J2`, percent: 0 });
  check('相邻报告期进度等值（不倒退）可填报', rEq.status === 200, `status=${rEq.status} ${msg(rEq)}`);
  const r100 = await api(A, 'POST', '/progress/records', { project_id: pjId, record_date: '2026-04-01', period: `${STAMP}J3`, percent: 100 });
  expectWarned('进度 100% 但项目未终态时给出提醒', '进度填报', r100);
  expectBlocked('进度 100 之后又填 50 被拦截', '进度填报',
    await api(A, 'POST', '/progress/records', { project_id: pjId, record_date: '2026-05-01', period: `${STAMP}J4`, percent: 50 }));

  // 权重边界：单个 100 允许，合计 100 允许，超出 0.01 拒绝
  const PJW = await mkProject(`BC-JW-${STAMP}`, { budget: 100 });
  const plW = await api(A, 'POST', '/plans', { project_id: PJW.data?.id, name: `BC权重边界-${STAMP}` });
  const w100 = await api(A, 'POST', `/plans/${plW.data?.id}/tasks`, { name: 'BC权重100', weight: 100 });
  check('单个任务权重 100% 可保存', w100.status === 200, `status=${w100.status} ${msg(w100)}`);
  expectBlocked('权重合计超出 0.01 被拦截', '计划任务',
    await api(A, 'POST', `/plans/${plW.data?.id}/tasks`, { name: 'BC权重溢出', weight: 0.01 }));
  const wDown = await api(A, 'PUT', `/plans/${plW.data?.id}/tasks/${w100.data?.id}`, { weight: 60 });
  const wUp = await api(A, 'POST', `/plans/${plW.data?.id}/tasks`, { name: 'BC权重补足', weight: 40 });
  check('降低已有任务权重后可补足到 100%',
    wDown.status === 200 && wUp.status === 200, `down=${wDown.status} up=${wUp.status} ${msg(wUp)}`);
  check('编辑任务时不把自己计入权重合计（自比较不应误判）', wDown.status === 200, `status=${wDown.status} ${msg(wDown)}`);

  // 付款边界：刚好等于合同额允许，超出分文即拒绝
  const ctJ = await api(A, 'POST', '/contracts', { project_id: PJ.data?.id, name: `BC付款边界-${STAMP}`, amount: 100 });
  const payFull = await api(A, 'POST', `/contracts/${ctJ.data?.id}/payments`, { amount: 100, pay_date: '2026-06-01', stage: '结算款' });
  check('付款刚好等于合同额允许', payFull.status === 200, `status=${payFull.status} ${msg(payFull)}`);
  expectBlocked('超出合同额 0.01 万元被拦截', '付款',
    await api(A, 'POST', `/contracts/${ctJ.data?.id}/payments`, { amount: 0.01, pay_date: '2026-06-02', stage: '进度款' }));
  const payEdit = await api(A, 'PUT', `/contracts/${ctJ.data?.id}/payments/${payFull.data?.id}`, { amount: 90 });
  check('付款编辑时不把自己计入累计（避免误判超额）', payEdit.status === 200, `status=${payEdit.status} ${msg(payEdit)}`);

  // 并发竞态 1：同一项目同一天并发填报，只允许一条成功（独立项目，避免受既有进度序列约束）
  const PJRACE = await mkProject(`BC-JR-${STAMP}`, { budget: 100, start_date: '2026-01-01', end_date: '2026-12-31', status: '施工中' });
  const racePjId = PJRACE.data?.id;
  const raceRec = await Promise.all(Array.from({ length: 10 }, () =>
    api(A, 'POST', '/progress/records', { project_id: racePjId, record_date: '2026-06-15', period: `${STAMP}J-RACE`, percent: 50 })));
  const raceOk = raceRec.filter(r => r.status === 200).length;
  const raceCnt = db.prepare('SELECT COUNT(*) c FROM progress_records WHERE project_id=? AND record_date=?').get(racePjId, '2026-06-15').c;
  check('并发同日填报只落库一条', raceOk === 1 && raceCnt === 1,
    `成功=${raceOk} 落库=${raceCnt} 状态=${JSON.stringify([...new Set(raceRec.map(r => r.status))])} msg=${msg(raceRec.find(r => r.status !== 200) || {})}`);

  // 并发竞态 2：同一变更申请并发审批，只允许通过一次
  const crRace = await api(L, 'POST', '/change-requests', { target_type: 'project', target_id: pjId, payload: { phone: '13900001111' } });
  const raceAp = await Promise.all(Array.from({ length: 10 }, () => api(A, 'POST', `/change-requests/${crRace.data?.id}/approve`, {})));
  const apOk = raceAp.filter(r => r.status === 200).length;
  check('并发审批同一申请只生效一次', apOk === 1, `成功=${apOk} 状态=${JSON.stringify([...new Set(raceAp.map(r => r.status))])}`);

  // 并发竞态 3：同编号项目并发创建，唯一约束只放行一条
  const raceCode = `BC-RACE-${STAMP}`;
  const racePj = await Promise.all(Array.from({ length: 8 }, () =>
    api(A, 'POST', '/projects', { code: raceCode, name: '并发编号', type: '其他' })));
  const pjOk = racePj.filter(r => r.status === 200).length;
  check('并发创建同编号项目只成功一次', pjOk === 1, `成功=${pjOk} 状态=${JSON.stringify([...new Set(racePj.map(r => r.status))])}`);
  const racePjRow = listOf((await api(A, 'GET', '/projects?keyword=' + raceCode)).data)[0];
  if (racePjRow?.id) await api(A, 'DELETE', `/projects/${racePjRow.id}`);

  // 并发写入的最终一致性：库中记录数与接口返回一致
  const cntDb = db.prepare('SELECT COUNT(*) c FROM progress_records WHERE project_id=?').get(racePjId).c;
  const cntApi = listOf((await api(A, 'GET', `/progress/records?project_id=${racePjId}`)).data).length;
  check('并发写入后库与接口条数一致', cntDb === cntApi && cntDb === 1, `db=${cntDb} api=${cntApi}`);

  // 超长/特殊字符在计划与任务名中
  const longPl = await api(A, 'POST', '/plans', { project_id: PJW.data?.id, name: '计' + 'x'.repeat(3000) });
  check('超长计划名不崩溃', longPl.status < 500, `status=${longPl.status}`);
  if (longPl.data?.id) {
    const longTk = await api(A, 'POST', `/plans/${longPl.data.id}/tasks`, { name: '<img src=x onerror=alert(1)>', weight: 1 });
    check('任务名中的 HTML 可安全保存', longTk.status === 200, `status=${longTk.status}`);
  }

  /* ===================== K 前端契约兼容性（整行回传） ===================== */
  console.log('\n--- K 前端契约兼容性（模拟界面整行回传 PUT） ---');
  const PK = await mkProject(`BC-K-${STAMP}`, {
    budget: 500, start_date: '2026-01-01', end_date: '2026-12-31', location: '契约地点', status: '施工中'
  });
  const pkId = PK.data?.id;
  // 列表行携带 latest_percent / record_count / plan_done_weight / bid_count 等统计字段，
  // 前端 {...row} 会一并回传，必须被安全裁剪
  const projRow = (await api(A, 'GET', `/projects?keyword=BC-K-${STAMP}`)).data.list[0];
  check('项目整行回传未被拒绝', (await api(A, 'PUT', `/projects/${pkId}`, projRow)).status === 200, '');
  check('项目整行回传不会写入统计字段',
    (await api(A, 'GET', `/projects/${pkId}`)).data.location === '契约地点', '');
  const projEdit = await api(A, 'PUT', `/projects/${pkId}`, { ...projRow, location: '契约地点2' });
  check('项目整行回传可正常改字段',
    projEdit.status === 200 && (await api(A, 'GET', `/projects/${pkId}`)).data.location === '契约地点2', `status=${projEdit.status}`);

  const kBid = await api(A, 'POST', '/bids', { project_id: pkId, title: `BC契约招标-${STAMP}`, budget: 50, status: '报名中' });
  const bidRow = listOf((await api(A, 'GET', `/bids?project_id=${pkId}`)).data).find(b => b.title === `BC契约招标-${STAMP}`);
  check('招标整行回传（含 project_name 等联表字段）未被拒绝',
    (await api(A, 'PUT', `/bids/${kBid.data?.id}`, { ...bidRow, agency: '契约代理机构' })).status === 200, '');

  const kCt = await api(A, 'POST', '/contracts', { project_id: pkId, name: `BC契约合同-${STAMP}`, amount: 20, status: '待签订' });
  const ctRow = listOf((await api(A, 'GET', `/contracts?project_id=${pkId}`)).data).find(c => c.name === `BC契约合同-${STAMP}`);
  check('合同整行回传（含 paid_amount/project_name）未被拒绝',
    (await api(A, 'PUT', `/contracts/${kCt.data?.id}`, { ...ctRow, party_a: '契约甲方' })).status === 200, '');

  const kPl = await api(A, 'POST', '/plans', { project_id: pkId, name: `BC契约计划-${STAMP}`, year: 2026 });
  const plRowFull = listOf((await api(A, 'GET', '/plans')).data).find(p => p.id === kPl.data?.id);
  check('计划整行回传（含 task_count/done_weight）未被拒绝',
    (await api(A, 'PUT', `/plans/${kPl.data?.id}`, { ...plRowFull, owner: '契约负责人' })).status === 200, '');
  const kTk = await api(A, 'POST', `/plans/${kPl.data?.id}/tasks`, { name: 'BC契约任务', owner: '甲', weight: 30, status: '未开始' });
  const tkRow = db.prepare('SELECT * FROM plan_tasks WHERE id=?').get(kTk.data?.id);
  check('任务整行回传未被拒绝',
    (await api(A, 'PUT', `/plans/${kPl.data?.id}/tasks/${kTk.data?.id}`, { ...tkRow, status: '进行中' })).status === 200, '');

  const kRec = await api(A, 'POST', '/progress/records', {
    project_id: pkId, record_date: '2026-06-01', period: `${STAMP}K1`, percent: 10, work_done: '契约工作'
  });
  const recFull = listOf((await api(A, 'GET', `/progress/records?project_id=${pkId}`)).data).find(r => r.id === kRec.data?.id);
  const recPut = await api(A, 'PUT', `/progress/records/${kRec.data?.id}`, { ...recFull, percent: 12 });
  check('进度填报整行回传（含 created_at）未被拒绝', recPut.status === 200, `status=${recPut.status} ${msg(recPut)}`);
  check('进度填报整行回传后正文保留',
    (await api(A, 'GET', `/progress/records?project_id=${pkId}`)).data.find(r => r.id === kRec.data?.id)?.work_done === '契约工作', '');

  const kMs = await api(A, 'POST', '/progress/milestones',
    { project_id: pkId, name: `BC契约里程碑-${STAMP}`, plan_date: '2026-12-01', status: '未开始' });
  const msFull = listOf((await api(A, 'GET', `/progress/milestones?project_id=${pkId}`)).data).find(m => m.id === kMs.data?.id);
  check('里程碑整行回传未被拒绝',
    (await api(A, 'PUT', `/progress/milestones/${kMs.data?.id}`, { ...msFull, status: '进行中' })).status === 200, '');

  // 员工在界面上"未改动直接保存"应给出明确提示而非报错 500
  const freshRow = (await api(A, 'GET', `/projects/${pkId}`)).data;
  const noChange = await api(L, 'POST', '/change-requests', { target_type: 'project', target_id: pkId, payload: freshRow });
  check('员工整行回传但无实际变更时给出明确 400 提示',
    noChange.status === 400 && msg(noChange).includes('未检测到'), `status=${noChange.status} msg=${msg(noChange)}`);

  /* ===================== 清理 ===================== */
  console.log('\n--- 清理测试数据 ---');
  for (const id of [...new Set(created.projects)].filter(Boolean)) await api(A, 'DELETE', `/projects/${id}`);
  try {
    db.exec(`
      DELETE FROM change_requests WHERE
        (target_type='project' AND target_id NOT IN (SELECT id FROM projects)) OR
        (target_type='bid' AND target_id NOT IN (SELECT id FROM bids)) OR
        (target_type='contract' AND target_id NOT IN (SELECT id FROM contracts)) OR
        (target_type='progress_record' AND target_id NOT IN (SELECT id FROM progress_records)) OR
        (target_type='milestone' AND target_id NOT IN (SELECT id FROM milestones)) OR
        (target_type='plan' AND target_id NOT IN (SELECT id FROM plans)) OR
        (target_type='task' AND target_id NOT IN (SELECT id FROM plan_tasks));
      DELETE FROM change_requests WHERE status='pending' AND target_name LIKE 'BC-%';
      DELETE FROM users WHERE username LIKE 'bcuser%';
    `);
  } catch (e) { console.log('  清理异常:', e.message); }
  console.log(`  已删除临时项目 ${[...new Set(created.projects)].filter(Boolean).length} 个`);

  /* ===================== 汇总 ===================== */
  console.log('\n================================================================');
  console.log(`用例总计: ${pass + fail}   通过: ${pass}   失败: ${fail}`);
  if (failures.length) {
    console.log('\n【失败用例明细】');
    failures.forEach(f => console.log(`  - ${f.name}\n      ${f.detail ?? ''}`));
  }
  const levels = { '严重': 0, '高': 0, '中': 0, '低': 0 };
  findings.forEach(f => levels[f.level] = (levels[f.level] || 0) + 1);
  console.log(`\n【遗留问题清单】共 ${findings.length} 项  ${Object.entries(levels).map(([k, v]) => k + v).join('  ')}`);
  findings.forEach((f, i) => {
    console.log(`\n${i + 1}. [${f.level}] ${f.area} :: ${f.title}`);
    console.log(`   证据: ${f.evidence}`);
    console.log(`   影响: ${f.impact}`);
    console.log(`   建议: ${f.fix}`);
  });
  if (!findings.length) console.log('未发现遗留问题，全部历史缺陷已修复并被用例覆盖 ✓');
  db.close();
  if (fail) process.exitCode = 1;
}

main().catch(e => { console.error('测试脚本异常:', e); try { db.close(); } catch {} process.exit(1); });
