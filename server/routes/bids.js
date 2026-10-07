const express = require('express');
const { db } = require('../db');
const { requireAdmin } = require('../auth');
const V = require('../validate');
const { validateBid } = require('../rules');
const { cleanupChangeRequests } = require('./approvals');
const { sendCSV } = require('../csv');
const router = express.Router();

const BID_COLUMNS = [
  { key: 'project_name', label: '所属项目' }, { key: 'bid_no', label: '招标编号' },
  { key: 'title', label: '招标名称' }, { key: 'method', label: '招标方式' },
  { key: 'budget', label: '控制价(万元)' }, { key: 'publish_date', label: '发布日期' },
  { key: 'signup_deadline', label: '报名截止' }, { key: 'bid_open_date', label: '开标日期' },
  { key: 'agency', label: '代理机构' }, { key: 'winner', label: '中标单位' },
  { key: 'win_amount', label: '中标金额(万元)' }, { key: 'status', label: '状态' }
];

const FIELDS = ['project_id', 'bid_no', 'title', 'method', 'budget', 'publish_date',
  'signup_deadline', 'bid_open_date', 'agency', 'winner', 'win_amount', 'content', 'status'];

router.get('/', (req, res) => {
  const { keyword = '', status = '', project_id = '', export: exp } = req.query;
  const where = [];
  const args = [];
  if (keyword) {
    where.push('(b.title LIKE ? OR b.bid_no LIKE ? OR b.agency LIKE ? OR b.winner LIKE ?)');
    args.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
  }
  if (status) { where.push('b.status=?'); args.push(status); }
  if (project_id) { where.push('b.project_id=?'); args.push(project_id); }
  const wsql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const list = db.prepare(`
    SELECT b.*, p.name AS project_name, p.code AS project_code
    FROM bids b LEFT JOIN projects p ON p.id=b.project_id
    ${wsql} ORDER BY b.id DESC`).all(...args);
  if (exp === 'csv') return sendCSV(res, '招标列表', list, BID_COLUMNS);
  res.json({ list, total: list.length });
});

router.post('/', (req, res) => {
  const { row } = V.pick(req.body, FIELDS);
  if (V.isMissing(row.project_id) || V.isMissing(row.title)) {
    return res.status(400).json({ message: '所属项目和招标名称必填' });
  }
  const r = validateBid(row, { id: null });
  if (r.error) return res.status(r.code).json({ message: r.error });

  const info = db.prepare(`INSERT INTO bids(${FIELDS.join(',')}) VALUES(${FIELDS.map(() => '?').join(',')})`)
    .run(...FIELDS.map(f => row[f] ?? null));
  const saved = db.prepare('SELECT * FROM bids WHERE id=?').get(info.lastInsertRowid);
  saved.warnings = r.warnings;
  res.json(saved);
});

router.put('/:id', requireAdmin, (req, res) => {
  const old = db.prepare('SELECT * FROM bids WHERE id=?').get(req.params.id);
  if (!old) return res.status(404).json({ message: '招标信息不存在' });

  const { row, keys } = V.pick(req.body, FIELDS);
  if (!keys.length) return res.json({ ok: 1 });

  const merged = { ...old, ...row };
  const r = validateBid(merged, { id: Number(req.params.id) });
  if (r.error) return res.status(r.code).json({ message: r.error });

  V.patchRow('bids', 'id', Number(req.params.id), row, keys);
  const saved = db.prepare('SELECT * FROM bids WHERE id=?').get(req.params.id);
  saved.warnings = r.warnings;
  res.json(saved);
});

router.delete('/:id', requireAdmin, (req, res) => {
  if (!db.prepare('SELECT id FROM bids WHERE id=?').get(req.params.id)) {
    return res.status(404).json({ message: '招标信息不存在' });
  }
  cleanupChangeRequests([['bid', Number(req.params.id)]]);
  db.prepare('DELETE FROM bids WHERE id=?').run(req.params.id);
  res.json({ ok: 1 });
});

module.exports = router;
