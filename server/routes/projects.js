const express = require('express');
const { db } = require('../db');
const { requireAdmin } = require('../auth');
const V = require('../validate');
const { validateProject } = require('../rules');
const { applyScheduleCascade } = require('../cascade');
const { cleanupChangeRequests } = require('./approvals');
const { sendCSV } = require('../csv');
const router = express.Router();

const PROJECT_COLUMNS = [
  { key: 'code', label: '项目编号' }, { key: 'name', label: '项目名称' },
  { key: 'type', label: '项目类型' }, { key: 'location', label: '建设地点' },
  { key: 'owner', label: '建设单位' }, { key: 'manager', label: '负责人' },
  { key: 'phone', label: '联系电话' }, { key: 'budget', label: '总投资(万元)' },
  { key: 'start_date', label: '计划开工' }, { key: 'end_date', label: '计划完工' },
  { key: 'status', label: '状态' }, { key: 'latest_percent', label: '最新进度(%)' },
  { key: 'description', label: '项目概况' }
];

const FIELDS = ['code', 'name', 'type', 'location', 'owner', 'manager', 'phone',
  'budget', 'start_date', 'end_date', 'status', 'description'];

/** 分页参数净化：非数字回落到默认值，并夹紧上下限，避免 NaN 绑定导致的 500 与全表返回 */
function clampInt(v, def, min, max) {
  const n = Number.parseInt(v, 10);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, n));
}

const LATEST_SQL = `SELECT percent FROM progress_records r WHERE r.project_id=p.id
  ORDER BY r.record_date DESC, r.id DESC LIMIT 1`;
const PLAN_DONE_SQL = `SELECT ROUND(AVG(dw),1) FROM (
     SELECT COALESCE(SUM(CASE WHEN t.status='已完成' THEN t.weight ELSE 0 END),0) dw
     FROM plans pl LEFT JOIN plan_tasks t ON t.plan_id=pl.id
     WHERE pl.project_id=p.id GROUP BY pl.id)`;

/** 项目列表（分页+搜索），支持 ?export=csv 导出全部 */
router.get('/', (req, res) => {
  const { keyword = '', status = '', export: exp } = req.query;
  const page = clampInt(req.query.page, 1, 1, 100000);
  const pageSize = clampInt(req.query.pageSize, 10, 1, 200);
  const where = [];
  const args = [];
  if (keyword) {
    where.push('(p.name LIKE ? OR p.code LIKE ? OR p.manager LIKE ? OR p.location LIKE ?)');
    args.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
  }
  if (status) { where.push('p.status=?'); args.push(status); }
  const wsql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const baseSql = `SELECT p.*,
      (${LATEST_SQL}) AS latest_percent,
      (SELECT COUNT(*) FROM progress_records r WHERE r.project_id=p.id) AS record_count,
      (SELECT COUNT(*) FROM milestones m WHERE m.project_id=p.id) AS milestone_count,
      (SELECT COUNT(*) FROM milestones m WHERE m.project_id=p.id AND m.status='已完成') AS milestone_done,
      (${PLAN_DONE_SQL}) AS plan_done_weight,
      (SELECT COUNT(*) FROM bids b WHERE b.project_id=p.id) AS bid_count,
      (SELECT COUNT(*) FROM contracts c WHERE c.project_id=p.id) AS contract_count
    FROM projects p ${wsql}`;

  if (exp === 'csv') {
    const rows = db.prepare(baseSql + ' ORDER BY p.id DESC').all(...args);
    return sendCSV(res, '项目列表', rows, PROJECT_COLUMNS);
  }

  const total = db.prepare(`SELECT COUNT(*) c FROM projects p ${wsql}`).get(...args).c;
  const list = db.prepare(baseSql + ' ORDER BY p.id DESC LIMIT ? OFFSET ?')
    .all(...args, pageSize, (page - 1) * pageSize);
  res.json({ list, total });
});

/** 下拉用精简列表 */
router.get('/all', (req, res) => {
  res.json(db.prepare('SELECT id, code, name, status FROM projects ORDER BY id DESC').all());
});

/** 项目详情（含最新进度） */
router.get('/:id', (req, res) => {
  const p = db.prepare('SELECT * FROM projects WHERE id=?').get(req.params.id);
  if (!p) return res.status(404).json({ message: '项目不存在' });
  p.latest_percent = db.prepare(
    'SELECT percent FROM progress_records WHERE project_id=? ORDER BY record_date DESC,id DESC LIMIT 1'
  ).get(req.params.id)?.percent ?? null;
  p.plan_done_weight = db.prepare(`SELECT ROUND(AVG(dw),1) w FROM (
    SELECT COALESCE(SUM(CASE WHEN t.status='已完成' THEN t.weight ELSE 0 END),0) dw
    FROM plans pl LEFT JOIN plan_tasks t ON t.plan_id=pl.id
    WHERE pl.project_id=? GROUP BY pl.id)`).get(req.params.id)?.w ?? null;
  res.json(p);
});

router.post('/', (req, res) => {
  const { row } = V.pick(req.body, FIELDS);
  if (V.isMissing(row.code) || V.isMissing(row.name)) {
    return res.status(400).json({ message: '项目编号和名称必填' });
  }
  if (V.isMissing(row.type)) row.type = '其他';
  if (V.isMissing(row.status)) row.status = '筹备中';

  const r = validateProject(row, { id: null, old: null });
  if (r.error) return res.status(r.code).json({ message: r.error });

  try {
    const keys = FIELDS.filter(f => row[f] !== undefined);
    const info = db.prepare(`INSERT INTO projects(${keys.join(',')}) VALUES(${keys.map(() => '?').join(',')})`)
      .run(...keys.map(f => row[f] ?? null));
    const saved = db.prepare('SELECT * FROM projects WHERE id=?').get(info.lastInsertRowid);
    saved.warnings = validateProject(saved, { id: saved.id, old: null }).warnings;
    res.json(saved);
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return res.status(400).json({ message: '项目编号已存在' });
    throw e;
  }
});

router.put('/:id', requireAdmin, (req, res) => {
  const oldRow = db.prepare('SELECT * FROM projects WHERE id=?').get(req.params.id);
  if (!oldRow) return res.status(404).json({ message: '项目不存在' });

  // 只更新请求体中出现的字段
  const { row, keys } = V.pick(req.body, FIELDS);
  if (!keys.length) return res.json({ ok: 1 });

  const merged = { ...oldRow, ...row };
  const r = validateProject(merged, { id: req.params.id, old: oldRow });
  if (r.error) return res.status(r.code).json({ message: r.error });

  try {
    V.patchRow('projects', 'id', req.params.id, row, keys);
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return res.status(400).json({ message: '项目编号已存在' });
    throw e;
  }
  const saved = db.prepare('SELECT * FROM projects WHERE id=?').get(req.params.id);

  // 工期变更联动：与审批路径保持完全一致的行为
  const notes = applyScheduleCascade(saved.id, oldRow, row);
  saved.warnings = [...r.warnings, ...notes.map(n => '已联动顺延' + n)];
  res.json(saved);
});

router.delete('/:id', requireAdmin, (req, res) => {
  const id = req.params.id;
  if (!db.prepare('SELECT id FROM projects WHERE id=?').get(id)) {
    return res.status(404).json({ message: '项目不存在' });
  }
  // change_requests 无外键，删除项目前先清理项目及其全部下属对象的变更申请
  const items = [['project', Number(id)]];
  const childMap = { bids: 'bid', contracts: 'contract', progress_records: 'progress_record',
    milestones: 'milestone', plans: 'plan' };
  for (const [table, type] of Object.entries(childMap)) {
    db.prepare(`SELECT id FROM ${table} WHERE project_id=?`).all(id)
      .forEach(r => items.push([type, r.id]));
  }
  db.prepare('SELECT id FROM plan_tasks WHERE plan_id IN (SELECT id FROM plans WHERE project_id=?)')
    .all(id).forEach(r => items.push(['task', r.id]));
  cleanupChangeRequests(items);
  db.prepare('DELETE FROM projects WHERE id=?').run(id);
  res.json({ ok: 1 });
});

module.exports = router;
