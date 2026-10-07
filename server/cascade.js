/**
 * 项目工期变更联动
 * 从审批模块抽出，使"管理员直接改项目工期"与"经审批改项目工期"行为完全一致。
 */
const { db } = require('./db');

const dayDiff = (a, b) =>
  Math.round((Date.parse(b + 'T00:00:00') - Date.parse(a + 'T00:00:00')) / 86400000);

/**
 * 项目开工推迟/完工顺延时，同步平移挂靠在工期边界上的下游对象。
 * 仅处理"推迟/顺延（delta>0）"；工期提前不自动压缩下游，避免误砍合同与计划。
 *
 * @param {number} projectId 项目ID
 * @param {object} before    变更前的项目行
 * @param {object} payload   本次写入的数据（未提供的字段视为不变）
 * @returns {string[]} 联动说明
 */
function applyScheduleCascade(projectId, before, payload) {
  const notes = [];
  const nz = v => (v === '' || v === undefined || v === null ? null : v);

  const oldEnd = before.end_date;
  const newEnd = payload.end_date !== undefined ? nz(payload.end_date) : before.end_date;
  if (oldEnd && newEnd && newEnd > oldEnd) {
    const mod = '+' + dayDiff(oldEnd, newEnd) + ' days';
    const n1 = db.prepare('UPDATE contracts SET end_date=date(end_date,?) WHERE project_id=? AND end_date>=?')
      .run(mod, projectId, oldEnd).changes;
    const n2 = db.prepare('UPDATE milestones SET plan_date=date(plan_date,?) WHERE project_id=? AND plan_date>=?')
      .run(mod, projectId, oldEnd).changes;
    const n3 = db.prepare('UPDATE plans SET end_date=date(end_date,?) WHERE project_id=? AND end_date>=?')
      .run(mod, projectId, oldEnd).changes;
    const n4 = db.prepare(
      'UPDATE plan_tasks SET end_date=date(end_date,?) WHERE plan_id IN (SELECT id FROM plans WHERE project_id=?) AND end_date>=?'
    ).run(mod, projectId, oldEnd).changes;
    if (n1) notes.push(`合同结束日期 ${n1} 份`);
    if (n2) notes.push(`里程碑计划日期 ${n2} 个`);
    if (n3) notes.push(`计划结束日期 ${n3} 个`);
    if (n4) notes.push(`计划任务结束日期 ${n4} 项`);
  }

  const oldStart = before.start_date;
  const newStart = payload.start_date !== undefined ? nz(payload.start_date) : before.start_date;
  if (oldStart && newStart && newStart > oldStart) {
    const mod = '+' + dayDiff(oldStart, newStart) + ' days';
    const n1 = db.prepare('UPDATE contracts SET start_date=date(start_date,?) WHERE project_id=? AND start_date<=?')
      .run(mod, projectId, oldStart).changes;
    const n2 = db.prepare('UPDATE milestones SET plan_date=date(plan_date,?) WHERE project_id=? AND plan_date<=?')
      .run(mod, projectId, oldStart).changes;
    const n3 = db.prepare('UPDATE plans SET start_date=date(start_date,?) WHERE project_id=? AND start_date<=?')
      .run(mod, projectId, oldStart).changes;
    const n4 = db.prepare(
      'UPDATE plan_tasks SET start_date=date(start_date,?) WHERE plan_id IN (SELECT id FROM plans WHERE project_id=?) AND start_date<=?'
    ).run(mod, projectId, oldStart).changes;
    if (n1) notes.push(`合同开始日期 ${n1} 份`);
    if (n2) notes.push(`里程碑计划日期 ${n2} 个`);
    if (n3) notes.push(`计划开始日期 ${n3} 个`);
    if (n4) notes.push(`计划任务开始日期 ${n4} 项`);
  }
  return notes;
}

module.exports = { applyScheduleCascade };
