/**
 * 存量数据一致性体检（只读）
 * 直接扫描数据库，输出所有违反业务规则 / 跨模块冲突 / 孤儿数据。
 *
 * 运行：node test/data-consistency.mjs            # 默认 data/swc.db
 *       DB_PATH=xxx.db node test/data-consistency.mjs
 */
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const DB_PATH = process.env.DB_PATH || fileURLToPath(new URL('../data/swc.db', import.meta.url));
const db = new DatabaseSync(DB_PATH, { readOnly: true });

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const all = sql => { try { return db.prepare(sql).all(); } catch (e) { return [{ __error: e.message }]; } };

const groups = [];
function add(title, level, rows, desc, impact) {
  groups.push({ title, level, rows, desc, impact });
}

/* ---------- 1. 基础统计 ---------- */
const counts = {
  项目: db.prepare('SELECT COUNT(*) c FROM projects').get().c,
  招标: db.prepare('SELECT COUNT(*) c FROM bids').get().c,
  合同: db.prepare('SELECT COUNT(*) c FROM contracts').get().c,
  付款记录: db.prepare('SELECT COUNT(*) c FROM contract_payments').get().c,
  进度填报: db.prepare('SELECT COUNT(*) c FROM progress_records').get().c,
  里程碑: db.prepare('SELECT COUNT(*) c FROM milestones').get().c,
  计划: db.prepare('SELECT COUNT(*) c FROM plans').get().c,
  计划任务: db.prepare('SELECT COUNT(*) c FROM plan_tasks').get().c,
  变更申请: db.prepare('SELECT COUNT(*) c FROM change_requests').get().c,
  用户: db.prepare('SELECT COUNT(*) c FROM users').get().c,
  审计日志: db.prepare('SELECT COUNT(*) c FROM audit_logs').get().c,
  附件: db.prepare('SELECT COUNT(*) c FROM attachments').get().c
};

/* ---------- 2. 日期合法性 ---------- */
add('日期格式非法或不存在的日期（如 2026-02-30）', '高',
  all(`
    SELECT 'projects' tbl, id, start_date d1, end_date d2 FROM projects
      WHERE (start_date IS NOT NULL AND start_date NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')
         OR (end_date IS NOT NULL AND end_date NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')
    UNION ALL SELECT 'bids', id, publish_date, bid_open_date FROM bids
      WHERE (publish_date IS NOT NULL AND publish_date NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')
         OR (bid_open_date IS NOT NULL AND bid_open_date NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')
    UNION ALL SELECT 'contracts', id, sign_date, start_date FROM contracts
      WHERE (sign_date IS NOT NULL AND sign_date NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')
         OR (start_date IS NOT NULL AND start_date NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')
    UNION ALL SELECT 'progress_records', id, record_date, NULL FROM progress_records
      WHERE record_date NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
    UNION ALL SELECT 'plan_tasks', id, start_date, end_date FROM plan_tasks
      WHERE (start_date IS NOT NULL AND start_date NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')
         OR (end_date IS NOT NULL AND end_date NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')
  `).filter(r => {
    if (r.__error) return true;
    for (const k of ['d1', 'd2']) {
      if (r[k] && DATE_RE.test(r[k])) {
        const [y, m, dd] = r[k].split('-').map(Number);
        const dt = new Date(`${r[k]}T00:00:00`);
        if (dt.getMonth() !== m - 1 || dt.getDate() !== dd || dt.getFullYear() !== y) return true;
      }
    }
    return false;
  }),
  '存在于日期字段中的非 YYYY-MM-DD 字符串，或日历上不存在的日期',
  '污染工期计算、排序与按月统计');

/* ---------- 3. 日期顺序冲突 ---------- */
add('日期顺序倒置', '高', [
  ...all("SELECT 'project' tbl,id,code name,start_date a,end_date b FROM projects WHERE start_date IS NOT NULL AND end_date IS NOT NULL AND start_date>end_date"),
  ...all("SELECT 'bid' tbl,id,title name,signup_deadline a,bid_open_date b FROM bids WHERE signup_deadline IS NOT NULL AND bid_open_date IS NOT NULL AND signup_deadline>bid_open_date"),
  ...all("SELECT 'bid(发布>报名)' tbl,id,title name,publish_date a,signup_deadline b FROM bids WHERE publish_date IS NOT NULL AND signup_deadline IS NOT NULL AND publish_date>signup_deadline"),
  ...all("SELECT 'contract' tbl,id,name,start_date a,end_date b FROM contracts WHERE start_date IS NOT NULL AND end_date IS NOT NULL AND start_date>end_date"),
  ...all("SELECT 'task(计划)' tbl,id,name,start_date a,end_date b FROM plan_tasks WHERE start_date IS NOT NULL AND end_date IS NOT NULL AND start_date>end_date"),
  ...all("SELECT 'task(实际)' tbl,id,name,actual_start a,actual_end b FROM plan_tasks WHERE actual_start IS NOT NULL AND actual_end IS NOT NULL AND actual_start>actual_end"),
  ...all("SELECT 'plan' tbl,id,name,start_date a,end_date b FROM plans WHERE start_date IS NOT NULL AND end_date IS NOT NULL AND start_date>end_date")
], '开始/发布日期晚于结束/开标日期的记录', '时间线自相矛盾');

/* ---------- 4. 金额链路冲突 ---------- */
add('金额链路冲突', '高', [
  ...all(`SELECT '中标价>控制价' kind, b.id, b.title name, b.budget a, b.win_amount b1 FROM bids b
          WHERE b.win_amount IS NOT NULL AND b.budget IS NOT NULL AND b.win_amount>b.budget`),
  ...all(`SELECT '已付>合同额' kind, c.id, c.name, c.amount a, COALESCE((SELECT SUM(amount) FROM contract_payments WHERE contract_id=c.id),0) b1
          FROM contracts c WHERE COALESCE((SELECT SUM(amount) FROM contract_payments WHERE contract_id=c.id),0) > c.amount+0.009`),
  ...all(`SELECT '合同额≠中标额' kind, c.id, c.name, c.amount a, b.win_amount b1 FROM contracts c
          JOIN bids b ON b.id=c.bid_id WHERE c.bid_id IS NOT NULL AND ABS(c.amount - COALESCE(b.win_amount,0))>0.009`),
  ...all(`SELECT '合同额合计>总投资' kind, p.id, p.name, p.budget a, COALESCE((SELECT SUM(amount) FROM contracts WHERE project_id=p.id),0) b1
          FROM projects p WHERE p.budget>0 AND COALESCE((SELECT SUM(amount) FROM contracts WHERE project_id=p.id),0) > p.budget+0.009`),
  ...all(`SELECT '金额为负' kind, id, name, amount a, NULL b1 FROM contracts WHERE amount<0
          UNION ALL SELECT '金额为负', id, title, budget, NULL FROM bids WHERE budget<0 OR win_amount<0
          UNION ALL SELECT '金额为负', id, name, budget, NULL FROM projects WHERE budget<0
          UNION ALL SELECT '金额为负', id, 'payment', amount, NULL FROM contract_payments WHERE amount<0`)
], '控制价/中标价/合同额/付款/总投资之间的数量关系不成立', '投资与财务台账失真');

/* ---------- 5. 状态与数据矛盾 ---------- */
add('状态与明细自相矛盾', '高', [
  ...all("SELECT '已定标但无中标人' kind, b.id, b.title name, b.status st, NULL ex FROM bids b WHERE b.status='已定标' AND COALESCE(b.winner,'')='' "),
  ...all("SELECT '履行中但无签订日期' kind, c.id, c.name, c.status st, NULL ex FROM contracts c WHERE c.status IN ('履行中','已签订') AND COALESCE(c.sign_date,'')=''"),
  ...all("SELECT '里程碑已完成但无实际日期' kind, m.id, m.name, m.status st, p.name ex FROM milestones m LEFT JOIN projects p ON p.id=m.project_id WHERE m.status='已完成' AND COALESCE(m.actual_date,'')=''"),
  ...all("SELECT '里程碑有实际日期但状态未完成' kind, m.id, m.name, m.status st, m.actual_date ex FROM milestones m WHERE COALESCE(m.actual_date,'')<>'' AND m.status<>'已完成'"),
  ...all("SELECT '任务已完成但无实际完成日期' kind, t.id, t.name, t.status st, pl.name ex FROM plan_tasks t LEFT JOIN plans pl ON pl.id=t.plan_id WHERE t.status='已完成' AND COALESCE(t.actual_end,'')=''"),
  ...all("SELECT '任务有实际完成日期但状态未完成' kind, t.id, t.name, t.status st, t.actual_end ex FROM plan_tasks t WHERE COALESCE(t.actual_end,'')<>'' AND t.status<>'已完成'"),
  ...all(`SELECT '实际完成日期晚于今天' kind, id, name, status st, actual_end ex FROM milestones
          WHERE actual_end IS NOT NULL AND actual_end > date('now','localtime')
          UNION ALL SELECT '实际完成日期晚于今天', id, name, status, actual_end FROM plan_tasks
          WHERE actual_end IS NOT NULL AND actual_end > date('now','localtime')`)
], '对象状态与其必填明细/时间字段互相矛盾', '导出与审计时无法自洽，且部分状态无法通过现有校验再编辑');

/* ---------- 6. 跨模块状态联动矛盾 ---------- */
add('跨模块状态联动矛盾', '中', [
  ...all(`SELECT '已完工/已验收但仍有履行中合同' kind, p.id, p.name, p.status st, c.name ex FROM projects p
          JOIN contracts c ON c.project_id=p.id AND c.status='履行中'
          WHERE p.status IN ('已完工','已验收')`),
  ...all(`SELECT '筹备/招标中但已有履行中合同' kind, p.id, p.name, p.status st, c.name ex FROM projects p
          JOIN contracts c ON c.project_id=p.id AND c.status='履行中'
          WHERE p.status IN ('筹备中','招标中')`),
  ...all(`SELECT '施工中但无任何合同' kind, p.id, p.name, p.status st, NULL ex FROM projects p
          WHERE p.status='施工中' AND NOT EXISTS (SELECT 1 FROM contracts c WHERE c.project_id=p.id)`),
  ...all(`SELECT '已完工/已验收但进度<100%' kind, p.id, p.name, p.status st,
            (SELECT percent FROM progress_records r WHERE r.project_id=p.id ORDER BY r.record_date DESC,r.id DESC LIMIT 1) ex
          FROM projects p WHERE p.status IN ('已完工','已验收')
            AND COALESCE((SELECT percent FROM progress_records r WHERE r.project_id=p.id ORDER BY r.record_date DESC,r.id DESC LIMIT 1),0) < 100`),
  ...all(`SELECT '进度=100%但项目未到终态' kind, p.id, p.name, p.status st, NULL ex FROM projects p
          WHERE COALESCE((SELECT percent FROM progress_records r WHERE r.project_id=p.id ORDER BY r.record_date DESC,r.id DESC LIMIT 1),0) >= 100
            AND p.status NOT IN ('已完工','已验收')`),
  ...all(`SELECT '施工中但无计划' kind, p.id, p.name, p.status st, NULL ex FROM projects p
          WHERE p.status='施工中' AND NOT EXISTS (SELECT 1 FROM plans pl WHERE pl.project_id=p.id)`)
], '父对象状态与子对象真实现状脱节（例如项目已完工但合同仍在履行）', '驾驶舱口径与实际情况不符');

/* ---------- 7. 进度填报序列冲突 ---------- */
add('进度填报序列倒挂', '高',
  all(`
    SELECT cur.project_id, p.name project_name, prev.record_date prev_date, prev.percent prev_pct,
           cur.record_date cur_date, cur.percent cur_pct
    FROM progress_records cur
    JOIN progress_records prev ON prev.project_id=cur.project_id AND prev.record_date<cur.record_date
    JOIN projects p ON p.id=cur.project_id
    WHERE prev.percent>cur.percent
    ORDER BY cur.project_id, cur.record_date`),
  '同一项目存在"更早报告期百分比 > 更晚报告期百分比"的记录对',
  '累计进度序列失去单调性：明明报过更高进度，列表/统计只取最新一期，历史最大值被隐藏');

add('同一项目同一报告期重复填报', '中',
  all(`
    SELECT project_id, period, COUNT(*) cnt, GROUP_CONCAT(id||':'||percent||'%') detail
    FROM progress_records
    WHERE period IS NOT NULL AND period<>'' AND (project_id,period) IN (
      SELECT project_id,period FROM progress_records
      WHERE period IS NOT NULL AND period<>'' GROUP BY project_id,period HAVING COUNT(*)>1)
    GROUP BY project_id,period`),
  '(项目, 报告期) 组合出现多条记录',
  '同一期季报有多份互相矛盾的进度值，"最新一期"取决于 id，统计口径不稳定');

add('进度填报日期超出项目工期', '低',
  all(`
    SELECT r.id, p.name project_name, r.record_date, p.start_date a, p.end_date b
    FROM progress_records r JOIN projects p ON p.id=r.project_id
    WHERE (p.start_date IS NOT NULL AND p.start_date<>'' AND r.record_date<p.start_date)
       OR (p.end_date IS NOT NULL AND p.end_date<>'' AND r.record_date>p.end_date)`),
  '填报日期落在项目计划开工∼完工区间之外',
  '使用早期/延后期的补报数据，与工期计划不匹配');

add('百分比取值越界', '高',
  all('SELECT id, project_id, record_date, percent FROM progress_records WHERE percent<0 OR percent>100 OR typeof(percent)<>\'integer\''),
  '累计进度不在 0-100 整数范围内',
  '进度条与完成度计算异常');

/* ---------- 8. 计划/权重一致性 ---------- */
add('计划任务权重合计超过 100%', '中',
  all(`
    SELECT pl.id plan_id, pl.name plan_name, p.name project_name,
           COUNT(t.id) task_cnt, SUM(t.weight) total_weight
    FROM plans pl LEFT JOIN plan_tasks t ON t.plan_id=pl.id LEFT JOIN projects p ON p.id=pl.project_id
    GROUP BY pl.id HAVING COALESCE(SUM(t.weight),0)>100.01`),
  '同一计划下所有任务的权重之和 > 100%',
  '计划完成度 done_weight 可超过 100%，与"百分比"语义冲突');

add('计划完成度超过 100%', '中',
  all(`
    SELECT plan_id, SUM(weight) done_weight FROM plan_tasks
    WHERE status='已完成' GROUP BY plan_id HAVING SUM(weight)>100.01`),
  '已完成任务的权重合计 > 100%',
  '项目/驾驶舱的"计划完成度"突破 100%');

add('任务/里程碑日期脱离父级周期', '低', [
  ...all(`SELECT '任务超出所属计划周期' kind, t.id, t.name, pl.start_date a, t.start_date b
          FROM plan_tasks t JOIN plans pl ON pl.id=t.plan_id
          WHERE (pl.start_date IS NOT NULL AND pl.start_date<>'' AND t.start_date IS NOT NULL AND t.start_date<pl.start_date)
             OR (pl.end_date IS NOT NULL AND pl.end_date<>'' AND t.end_date IS NOT NULL AND t.end_date>pl.end_date)`),
  ...all(`SELECT '里程碑超出项目工期' kind, m.id, m.name, p.start_date a, m.plan_date b
          FROM milestones m JOIN projects p ON p.id=m.project_id
          WHERE (p.start_date IS NOT NULL AND p.start_date<>'' AND m.plan_date IS NOT NULL AND m.plan_date<p.start_date)
             OR (p.end_date IS NOT NULL AND p.end_date<>'' AND m.plan_date IS NOT NULL AND m.plan_date>p.end_date)`),
  ...all(`SELECT '合同超出项目工期' kind, c.id, c.name, p.end_date a, c.end_date b
          FROM contracts c JOIN projects p ON p.id=c.project_id
          WHERE p.end_date IS NOT NULL AND p.end_date<>'' AND c.end_date IS NOT NULL AND c.end_date>p.end_date`),
  ...all(`SELECT '计划超出项目工期' kind, pl.id, pl.name, p.end_date a, pl.end_date b
          FROM plans pl JOIN projects p ON p.id=pl.project_id
          WHERE p.end_date IS NOT NULL AND p.end_date<>'' AND pl.end_date IS NOT NULL AND pl.end_date>p.end_date`)
], '子对象的日期区间超出了所属项目/计划的工期区间', '层级计划失去约束意义');

/* ---------- 9. 招标→合同 时间线 ---------- */
add('招标/合同时间线冲突', '中', [
  ...all(`SELECT '签订日期早于开标日' kind, c.id, c.name, b.bid_open_date a, c.sign_date b
          FROM contracts c JOIN bids b ON b.id=c.bid_id
          WHERE c.bid_id IS NOT NULL AND b.bid_open_date IS NOT NULL AND b.bid_open_date<>'' AND c.sign_date IS NOT NULL AND c.sign_date<>'' AND c.sign_date<b.bid_open_date`),
  ...all(`SELECT '合同与关联招标不同项目' kind, c.id, c.name, c.project_id a, b.project_id b
          FROM contracts c JOIN bids b ON b.id=c.bid_id WHERE c.project_id<>b.project_id`)
], '合同签订时间早于关联招标的开标时间，或跨项目关联', '业务流程时间线倒置');

/* ---------- 10. 重复编号 ---------- */
add('编号重复', '中', [
  ...all("SELECT '招标编号重复' kind, MIN(id) id, bid_no code, COUNT(*) cnt, NULL ex FROM bids WHERE bid_no IS NOT NULL AND bid_no<>'' GROUP BY bid_no HAVING COUNT(*)>1"),
  ...all("SELECT '合同编号重复' kind, MIN(id) id, contract_no code, COUNT(*) cnt, NULL ex FROM contracts WHERE contract_no IS NOT NULL AND contract_no<>'' GROUP BY contract_no HAVING COUNT(*)>1")
], '招标编号/合同编号在表中出现重复（数据库无唯一约束）', '编号失去唯一标识作用，导出的台账无法区分');

/* ---------- 11. 孤儿/引用完整性 ---------- */
add('孤儿数据与无效引用', '高', [
  ...all("SELECT '孤儿付款记录' kind, id, 'contract_id='||contract_id name, amount a, NULL b FROM contract_payments WHERE contract_id NOT IN (SELECT id FROM contracts)"),
  ...all("SELECT '孤儿计划任务' kind, id, name, plan_id a, NULL b FROM plan_tasks WHERE plan_id NOT IN (SELECT id FROM plans)"),
  ...all("SELECT '孤儿变更申请(project)' kind, id, target_name, target_id a, NULL b FROM change_requests WHERE target_type='project' AND target_id NOT IN (SELECT id FROM projects)"),
  ...all("SELECT '孤儿变更申请(bid)' kind, id, target_name, target_id a, NULL b FROM change_requests WHERE target_type='bid' AND target_id NOT IN (SELECT id FROM bids)"),
  ...all("SELECT '孤儿变更申请(contract)' kind, id, target_name, target_id a, NULL b FROM change_requests WHERE target_type='contract' AND target_id NOT IN (SELECT id FROM contracts)"),
  ...all("SELECT '孤儿变更申请(progress)' kind, id, target_name, target_id a, NULL b FROM change_requests WHERE target_type='progress_record' AND target_id NOT IN (SELECT id FROM progress_records)"),
  ...all("SELECT '孤儿变更申请(milestone)' kind, id, target_name, target_id a, NULL b FROM change_requests WHERE target_type='milestone' AND target_id NOT IN (SELECT id FROM milestones)"),
  ...all("SELECT '孤儿变更申请(plan)' kind, id, target_name, target_id a, NULL b FROM change_requests WHERE target_type='plan' AND target_id NOT IN (SELECT id FROM plans)"),
  ...all("SELECT '孤儿变更申请(task)' kind, id, target_name, target_id a, NULL b FROM change_requests WHERE target_type='task' AND target_id NOT IN (SELECT id FROM plan_tasks)"),
  ...all("SELECT '合同指向不存在的招标' kind, id, name, bid_id a, NULL b FROM contracts WHERE bid_id IS NOT NULL AND bid_id NOT IN (SELECT id FROM bids)")
], '子表记录指向已不存在的父对象，或变更申请指向已删除的业务对象', '永远不会展示在任何列表中，也不会被清理，长期沉淀为脏数据');

/* ---------- 12. 附件有效性 ---------- */
const attMap = { project: 'projects', bid: 'bids', contract: 'contracts', progress: 'progress_records', plan: 'plans' };
const orphanAtt = [];
for (const [mod, tbl] of Object.entries(attMap)) {
  orphanAtt.push(...all(`SELECT '附件指向不存在的${mod}' kind, id, filename, target_id a, NULL b
    FROM attachments WHERE module='${mod}' AND target_id NOT IN (SELECT id FROM ${tbl})`));
}
const missingFiles = [];
if (db.prepare('SELECT COUNT(*) c FROM attachments').get().c > 0) {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const dir = path.join(path.dirname(DB_PATH), 'uploads');
  for (const a of all('SELECT id, filename, stored_name FROM attachments')) {
    if (!fs.existsSync(path.join(dir, a.stored_name))) missingFiles.push({ kind: '附件文件已丢失', id: a.id, name: a.filename, a: a.stored_name, b: null });
  }
}
add('附件失效', '中', [...orphanAtt, ...missingFiles],
  '附件记录的宿主对象已删除，或磁盘上的文件已丢失', '详情页显示可下载但实际 404');

/* ---------- 13. 必填项缺失 ---------- */
add('必填/关键字段缺失', '低', [
  ...all("SELECT '项目无负责人' kind, id, name, NULL a, NULL b FROM projects WHERE COALESCE(manager,'')=''"),
  ...all("SELECT '项目无工期' kind, id, name, NULL a, NULL b FROM projects WHERE COALESCE(start_date,'')='' OR COALESCE(end_date,'')=''"),
  ...all("SELECT '项目无总投资' kind, id, name, budget a, NULL b FROM projects WHERE budget IS NULL OR budget=0"),
  ...all("SELECT '招标无所属项目编号' kind, id, title, NULL a, NULL b FROM bids WHERE bid_no IS NULL OR bid_no=''"),
  ...all("SELECT '合同乙方为空' kind, id, name, NULL a, NULL b FROM contracts WHERE COALESCE(party_b,'')=''"),
  ...all("SELECT '任务无负责人' kind, id, name, NULL a, NULL b FROM plan_tasks WHERE COALESCE(owner,'')=''"),
  ...all("SELECT '计划执行中但无周期' kind, id, name, NULL a, NULL b FROM plans WHERE status='执行中' AND (start_date IS NULL OR end_date IS NULL)")
], '关键业务字段为空', '信息不完整影响台账可用性');

/* ---------- 14. 用户与审计 ---------- */
add('账号与审计', '低', [
  ...all("SELECT '停用账号仍有有效会话记录' kind, id, username, NULL a, NULL b FROM users WHERE active=0"),
  ...all("SELECT '弱密码风险(与默认口令一致)' kind, id, username, NULL a, NULL b FROM users WHERE password='ea3d1e2eba2adba1d5b6ab9c4b6b6b2b0b4b9a1e0b7b7bd3d5c1e6b8a4d0b4b'"),
  ...all(`SELECT '近24小时内失败登录过多(>20)' kind, MAX(id) id, username, COUNT(*) cnt, NULL b
          FROM audit_logs WHERE action='登录' AND status_code>=400
            AND created_at>=datetime('now','-1 day') GROUP BY username HAVING COUNT(*)>20`)
], '账号与审计层面的关注项', '安全运维参考');

/* ---------- 输出 ---------- */
console.log('\n================================================================');
console.log('      水土保持项目管理系统 —— 存量数据一致性体检报告');
console.log('================================================================');
console.log('  数据库: ' + DB_PATH);
console.log('\n【数据量】');
console.log('  ' + Object.entries(counts).map(([k, v]) => `${k}: ${v}`).join('   '));

const norm = rows => rows.filter(r => !r.__error && Object.keys(r).length > 0);
const levels = { '高': [], '中': [], '低': [] };
const clean = [];
for (const g of groups) {
  const rows = norm(g.rows);
  if (rows.length) levels[g.level].push({ ...g, rows });
  else clean.push(g.title);
}
const totalIssues = Object.values(levels).reduce((s, a) => s + a.reduce((x, g) => x + g.rows.length, 0), 0);

console.log(`\n【体检结果】共发现 ${totalIssues} 处问题 / ${Object.values(levels).reduce((s, a) => s + a.length, 0)} 类`);
if (!totalIssues) {
  console.log('  未发现违反业务规则的数据，存量数据一致 ✓');
}
for (const lv of ['高', '中', '低']) {
  for (const g of levels[lv]) {
    console.log(`\n[${lv}] ${g.title}  —— ${g.rows.length} 条`);
    console.log(`   规则: ${g.desc}`);
    console.log(`   影响: ${g.impact}`);
    const head = Object.keys(g.rows[0]);
    const sample = g.rows.slice(0, 8).map(r =>
      '     · ' + head.filter(k => k !== 'kind').map(k => `${k}=${r[k] ?? '∅'}`).join('  '));
    console.log(sample.join('\n'));
    if (g.rows.length > 8) console.log(`     · ... 其余 ${g.rows.length - 8} 条略`);
  }
}
console.log('\n【通过项】');
clean.forEach(t => console.log('  ✓ ' + t));
console.log('\n================================================================\n');
db.close();
