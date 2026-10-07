const express = require('express');
const { db, tx } = require('../db');
const { requireAdmin } = require('../auth');
const V = require('../validate');
const { validatePlan, validateTask } = require('../rules');
const { cleanupChangeRequests } = require('./approvals');
const { deleteAttachmentsFor } = require('./attachments');
const { sendCSV } = require('../csv');
const router = express.Router();

const PLAN_COLUMNS = [
  { key: 'project_name', label: '所属项目' }, { key: 'name', label: '计划名称' },
  { key: 'year', label: '年度' }, { key: 'start_date', label: '开始日期' },
  { key: 'end_date', label: '结束日期' }, { key: 'owner', label: '负责人' },
  { key: 'status', label: '状态' }, { key: 'done_weight', label: '完成权重(%)' },
  { key: 'description', label: '说明' }
];

const OVERVIEW_COLUMNS = [
  { key: 'code', label: '项目编号' }, { key: 'name', label: '项目名称' },
  { key: 'status', label: '项目状态' }, { key: 'manager', label: '负责人' },
  { key: 'plan_count', label: '计划数' }, { key: 'task_count', label: '任务数' },
  { key: 'done_weight', label: '计划完成度(%)' },
  { key: 'start_date', label: '计划开工' }, { key: 'end_date', label: '计划完工' }
];

const PLAN_FIELDS = ['project_id', 'name', 'year', 'start_date', 'end_date', 'owner', 'status', 'description'];
const TASK_FIELDS = ['name', 'owner', 'weight', 'start_date', 'end_date',
  'actual_start', 'actual_end', 'status', 'remark'];

/* ---------- 计划 ---------- */
router.get('/', (req, res) => {
  const { project_id = '', status = '', export: exp } = req.query;
  const where = [];
  const args = [];
  if (project_id) { where.push('pl.project_id=?'); args.push(project_id); }
  if (status) { where.push('pl.status=?'); args.push(status); }
  const wsql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const list = db.prepare(`
    SELECT pl.*, p.name AS project_name,
      (SELECT COUNT(*) FROM plan_tasks t WHERE t.plan_id=pl.id) AS task_count,
      (SELECT ROUND(COALESCE(SUM(CASE WHEN t.status='已完成' THEN t.weight ELSE 0 END),0),1)
         FROM plan_tasks t WHERE t.plan_id=pl.id) AS done_weight
    FROM plans pl LEFT JOIN projects p ON p.id=pl.project_id
    ${wsql} ORDER BY pl.id DESC`).all(...args);
  if (exp === 'csv') return sendCSV(res, '计划列表', list, PLAN_COLUMNS);
  res.json({ list, total: list.length });
});

/** 项目计划覆盖概览：全部项目 + 各自计划/任务统计（计划管理首页卡片） */
router.get('/overview', (req, res) => {
  const { keyword = '', status = '', export: exp } = req.query;
  const where = [];
  const args = [];
  if (keyword) {
    where.push('(p.name LIKE ? OR p.code LIKE ? OR p.manager LIKE ?)');
    args.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
  }
  if (status) { where.push('p.status=?'); args.push(status); }
  const wsql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const rows = db.prepare(`
    SELECT p.id, p.code, p.name, p.status, p.manager, p.start_date, p.end_date,
      (SELECT COUNT(*) FROM plans pl WHERE pl.project_id=p.id) AS plan_count,
      (SELECT COUNT(*) FROM plan_tasks t JOIN plans pl2 ON t.plan_id=pl2.id WHERE pl2.project_id=p.id) AS task_count,
      (SELECT ROUND(AVG(dw),1) FROM (
         SELECT COALESCE(SUM(CASE WHEN t.status='已完成' THEN t.weight ELSE 0 END),0) dw
         FROM plans pl3 LEFT JOIN plan_tasks t ON t.plan_id=pl3.id
         WHERE pl3.project_id=p.id GROUP BY pl3.id)) AS done_weight
    FROM projects p ${wsql} ORDER BY p.id DESC`).all(...args);
  if (exp === 'csv') return sendCSV(res, '项目计划概览', rows, OVERVIEW_COLUMNS);
  res.json({ list: rows, total: rows.length });
});

router.get('/:id', (req, res) => {
  const plan = db.prepare(`SELECT pl.*, p.name AS project_name FROM plans pl
    LEFT JOIN projects p ON p.id=pl.project_id WHERE pl.id=?`).get(req.params.id);
  if (!plan) return res.status(404).json({ message: '计划不存在' });
  plan.tasks = db.prepare('SELECT * FROM plan_tasks WHERE plan_id=? ORDER BY start_date,id').all(req.params.id);
  res.json(plan);
});

router.post('/', (req, res) => {
  const { row } = V.pick(req.body, PLAN_FIELDS);
  if (V.isMissing(row.project_id) || V.isMissing(row.name)) {
    return res.status(400).json({ message: '所属项目和计划名称必填' });
  }
  const r = validatePlan(row);
  if (r.error) return res.status(r.code).json({ message: r.error });

  // 只写入请求体中出现的字段，缺省字段交由表结构默认值（如 status='编制中'）
  const keys = PLAN_FIELDS.filter(f => row[f] !== undefined);
  const info = db.prepare(`INSERT INTO plans(${keys.join(',')}) VALUES(${keys.map(() => '?').join(',')})`)
    .run(...keys.map(f => row[f] ?? null));
  const saved = db.prepare('SELECT * FROM plans WHERE id=?').get(info.lastInsertRowid);
  saved.warnings = r.warnings;
  res.json(saved);
});

router.put('/:id', requireAdmin, (req, res) => {
  const old = db.prepare('SELECT * FROM plans WHERE id=?').get(req.params.id);
  if (!old) return res.status(404).json({ message: '计划不存在' });

  // 只更新请求体中出现的字段（早期实现会把未提交字段置 NULL 导致计划被"掏空"）
  const { row, keys } = V.pick(req.body, PLAN_FIELDS);
  if (!keys.length) return res.json({ ok: 1 });

  const merged = { ...old, ...row };
  const r = validatePlan(merged);
  if (r.error) return res.status(r.code).json({ message: r.error });

  V.patchRow('plans', 'id', req.params.id, row, keys);
  const saved = db.prepare('SELECT * FROM plans WHERE id=?').get(req.params.id);
  saved.warnings = r.warnings;
  res.json(saved);
});

router.delete('/:id', requireAdmin, (req, res) => {
  if (!db.prepare('SELECT id FROM plans WHERE id=?').get(req.params.id)) {
    return res.status(404).json({ message: '计划不存在' });
  }
  const items = [['plan', Number(req.params.id)]];
  db.prepare('SELECT id FROM plan_tasks WHERE plan_id=?').all(req.params.id)
    .forEach(r => items.push(['task', r.id]));
  tx(() => {
    cleanupChangeRequests(items);
    deleteAttachmentsFor('plan', req.params.id);
    db.prepare('DELETE FROM plans WHERE id=?').run(req.params.id);
  });
  res.json({ ok: 1 });
});

/* ---------- 计划任务 ---------- */
router.post('/:id/tasks', (req, res) => {
  if (!db.prepare('SELECT id FROM plans WHERE id=?').get(req.params.id)) {
    return res.status(404).json({ message: '计划不存在' });
  }
  const { row } = V.pick(req.body, TASK_FIELDS);
  if (V.isMissing(row.name)) return res.status(400).json({ message: '任务名称必填' });
  if (row.weight === null) row.weight = 0;
  if (row.status === null) row.status = '未开始';

  const r = validateTask(row, { planId: Number(req.params.id) });
  if (r.error) return res.status(r.code).json({ message: r.error });

  const info = db.prepare(`INSERT INTO plan_tasks(plan_id,${TASK_FIELDS.join(',')})
    VALUES(?,${TASK_FIELDS.map(() => '?').join(',')})`)
    .run(req.params.id, ...TASK_FIELDS.map(f => row[f] ?? null));
  const saved = db.prepare('SELECT * FROM plan_tasks WHERE id=?').get(info.lastInsertRowid);
  saved.warnings = r.warnings;
  res.json(saved);
});

router.put('/:id/tasks/:tid', requireAdmin, (req, res) => {
  const old = db.prepare('SELECT * FROM plan_tasks WHERE id=? AND plan_id=?').get(req.params.tid, req.params.id);
  if (!old) return res.status(404).json({ message: '任务不存在' });

  const { row, keys } = V.pick(req.body, TASK_FIELDS);
  if (!keys.length) return res.json({ ok: 1 });

  const merged = { ...old, ...row };
  const r = validateTask(merged, { planId: Number(req.params.id), excludeId: Number(req.params.tid) });
  if (r.error) return res.status(r.code).json({ message: r.error });

  V.patchRow('plan_tasks', 'id', Number(req.params.tid), row, keys);
  const saved = db.prepare('SELECT * FROM plan_tasks WHERE id=?').get(req.params.tid);
  saved.warnings = r.warnings;
  res.json(saved);
});

router.delete('/:id/tasks/:tid', requireAdmin, (req, res) => {
  if (!db.prepare('SELECT id FROM plan_tasks WHERE id=? AND plan_id=?').get(req.params.tid, req.params.id)) {
    return res.status(404).json({ message: '任务不存在' });
  }
  cleanupChangeRequests([['task', Number(req.params.tid)]]);
  db.prepare('DELETE FROM plan_tasks WHERE id=? AND plan_id=?').run(req.params.tid, req.params.id);
  res.json({ ok: 1 });
});

module.exports = router;
