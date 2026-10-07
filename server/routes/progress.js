const express = require('express');
const { db } = require('../db');
const { requireAdmin } = require('../auth');
const V = require('../validate');
const { validateRecord, validateMilestone } = require('../rules');
const { cleanupChangeRequests } = require('./approvals');
const { sendCSV } = require('../csv');
const router = express.Router();

const PROGRESS_COLUMNS = [
  { key: 'record_date', label: '填报日期' }, { key: 'period', label: '报告期' },
  { key: 'percent', label: '累计进度(%)' }, { key: 'work_done', label: '本期完成工作' },
  { key: 'issues', label: '存在问题' }, { key: 'next_plan', label: '下期计划' },
  { key: 'reporter', label: '填报人' }
];

const RECORD_FIELDS = ['project_id', 'record_date', 'period', 'percent',
  'work_done', 'issues', 'next_plan', 'reporter'];
const MILESTONE_FIELDS = ['project_id', 'name', 'plan_date', 'actual_date', 'status'];

/* ---------- 进度填报记录 ---------- */
router.get('/records', (req, res) => {
  const { project_id, export: exp } = req.query;
  if (!project_id) return res.status(400).json({ message: '请选择项目' });
  const list = db.prepare(
    'SELECT * FROM progress_records WHERE project_id=? ORDER BY record_date DESC, id DESC').all(project_id);
  if (exp === 'csv') {
    const p = db.prepare('SELECT name FROM projects WHERE id=?').get(project_id);
    return sendCSV(res, (p?.name || '项目') + '_进度记录', list, PROGRESS_COLUMNS);
  }
  res.json(list);
});

router.post('/records', (req, res) => {
  const { row } = V.pick(req.body, RECORD_FIELDS);
  if (V.isMissing(row.project_id) || V.isMissing(row.record_date)) {
    return res.status(400).json({ message: '项目和填报日期必填' });
  }
  if (row.percent === null) row.percent = 0;

  const r = validateRecord(row, { mode: 'create' });
  if (r.error) return res.status(r.code).json({ message: r.error });

  const info = db.prepare(`INSERT INTO progress_records
    (project_id,record_date,period,percent,work_done,issues,next_plan,reporter)
    VALUES(?,?,?,?,?,?,?,?)`)
    .run(row.project_id ?? null, row.record_date ?? null, row.period ?? null, row.percent ?? 0,
      row.work_done ?? null, row.issues ?? null, row.next_plan ?? null, row.reporter ?? null);
  const saved = db.prepare('SELECT * FROM progress_records WHERE id=?').get(info.lastInsertRowid);
  saved.warnings = r.warnings;
  res.json(saved);
});

router.put('/records/:id', requireAdmin, (req, res) => {
  const old = db.prepare('SELECT * FROM progress_records WHERE id=?').get(req.params.id);
  if (!old) return res.status(404).json({ message: '进度填报不存在' });

  // 只更新请求体中出现的字段（早期实现会把未提交的正文字段静默清空）
  const { row, keys } = V.pick(req.body, RECORD_FIELDS);
  if (!keys.length) return res.json({ ok: 1 });

  const merged = { ...old };
  for (const k of keys) merged[k] = row[k];
  const r = validateRecord(merged, { mode: 'update', excludeId: Number(req.params.id) });
  if (r.error) return res.status(r.code).json({ message: r.error });

  V.patchRow('progress_records', 'id', Number(req.params.id), row, keys);
  const saved = db.prepare('SELECT * FROM progress_records WHERE id=?').get(req.params.id);
  saved.warnings = r.warnings;
  res.json(saved);
});

router.delete('/records/:id', requireAdmin, (req, res) => {
  if (!db.prepare('SELECT id FROM progress_records WHERE id=?').get(req.params.id)) {
    return res.status(404).json({ message: '进度填报不存在' });
  }
  cleanupChangeRequests([['progress_record', Number(req.params.id)]]);
  db.prepare('DELETE FROM progress_records WHERE id=?').run(req.params.id);
  res.json({ ok: 1 });
});

/* ---------- 里程碑 ---------- */
router.get('/milestones', (req, res) => {
  const { project_id } = req.query;
  if (!project_id) return res.status(400).json({ message: '请选择项目' });
  res.json(db.prepare('SELECT * FROM milestones WHERE project_id=? ORDER BY plan_date,id').all(project_id));
});

router.post('/milestones', (req, res) => {
  const { row } = V.pick(req.body, MILESTONE_FIELDS);
  if (V.isMissing(row.project_id) || V.isMissing(row.name)) {
    return res.status(400).json({ message: '项目和里程碑名称必填' });
  }
  if (row.status === null) row.status = '未开始';

  const r = validateMilestone(row);
  if (r.error) return res.status(r.code).json({ message: r.error });

  const info = db.prepare('INSERT INTO milestones(project_id,name,plan_date,actual_date,status) VALUES(?,?,?,?,?)')
    .run(row.project_id ?? null, row.name ?? null, row.plan_date ?? null,
      row.actual_date ?? null, row.status ?? '未开始');
  const saved = db.prepare('SELECT * FROM milestones WHERE id=?').get(info.lastInsertRowid);
  saved.warnings = r.warnings;
  res.json(saved);
});

router.put('/milestones/:id', requireAdmin, (req, res) => {
  const old = db.prepare('SELECT * FROM milestones WHERE id=?').get(req.params.id);
  if (!old) return res.status(404).json({ message: '里程碑不存在' });

  const { row, keys } = V.pick(req.body, MILESTONE_FIELDS);
  if (!keys.length) return res.json({ ok: 1 });

  const merged = { ...old };
  for (const k of keys) merged[k] = row[k];
  const r = validateMilestone(merged);
  if (r.error) return res.status(r.code).json({ message: r.error });

  V.patchRow('milestones', 'id', Number(req.params.id), row, keys);
  const saved = db.prepare('SELECT * FROM milestones WHERE id=?').get(req.params.id);
  saved.warnings = r.warnings;
  res.json(saved);
});

router.delete('/milestones/:id', requireAdmin, (req, res) => {
  if (!db.prepare('SELECT id FROM milestones WHERE id=?').get(req.params.id)) {
    return res.status(404).json({ message: '里程碑不存在' });
  }
  cleanupChangeRequests([['milestone', Number(req.params.id)]]);
  db.prepare('DELETE FROM milestones WHERE id=?').run(req.params.id);
  res.json({ ok: 1 });
});

module.exports = router;
