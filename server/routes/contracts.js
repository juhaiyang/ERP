const express = require('express');
const { db } = require('../db');
const { requireAdmin } = require('../auth');
const V = require('../validate');
const { validateContract, validatePayment } = require('../rules');
const { cleanupChangeRequests } = require('./approvals');
const { sendCSV } = require('../csv');
const router = express.Router();

const CONTRACT_COLUMNS = [
  { key: 'project_name', label: '所属项目' }, { key: 'contract_no', label: '合同编号' },
  { key: 'name', label: '合同名称' }, { key: 'party_a', label: '甲方' },
  { key: 'party_b', label: '乙方' }, { key: 'amount', label: '合同金额(万元)' },
  { key: 'paid_amount', label: '已付(万元)' }, { key: 'sign_date', label: '签订日期' },
  { key: 'start_date', label: '开始日期' }, { key: 'end_date', label: '结束日期' },
  { key: 'status', label: '状态' }
];

const FIELDS = ['project_id', 'bid_id', 'contract_no', 'name', 'party_a', 'party_b',
  'amount', 'sign_date', 'start_date', 'end_date', 'status', 'content'];

/** 合同进入履行中 → 筹备/招标阶段的项目自动转入施工中 */
function activateProject(projectId) {
  db.prepare("UPDATE projects SET status='施工中' WHERE id=? AND status IN ('筹备中','招标中')").run(projectId);
}

router.get('/', (req, res) => {
  const { keyword = '', status = '', project_id = '', export: exp } = req.query;
  const where = [];
  const args = [];
  if (keyword) {
    where.push('(c.name LIKE ? OR c.contract_no LIKE ? OR c.party_b LIKE ?)');
    args.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
  }
  if (status) { where.push('c.status=?'); args.push(status); }
  if (project_id) { where.push('c.project_id=?'); args.push(project_id); }
  const wsql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const list = db.prepare(`
    SELECT c.*, p.name AS project_name, p.code AS project_code,
      (SELECT COALESCE(SUM(amount),0) FROM contract_payments WHERE contract_id=c.id) AS paid_amount
    FROM contracts c LEFT JOIN projects p ON p.id=c.project_id
    ${wsql} ORDER BY c.id DESC`).all(...args);
  if (exp === 'csv') return sendCSV(res, '合同列表', list, CONTRACT_COLUMNS);
  res.json({ list, total: list.length });
});

router.post('/', (req, res) => {
  const { row } = V.pick(req.body, FIELDS);
  if (V.isMissing(row.project_id) || V.isMissing(row.name)) {
    return res.status(400).json({ message: '所属项目和合同名称必填' });
  }
  const r = validateContract(row, { id: null });
  if (r.error) return res.status(r.code).json({ message: r.error });

  const info = db.prepare(`INSERT INTO contracts(${FIELDS.join(',')}) VALUES(${FIELDS.map(() => '?').join(',')})`)
    .run(...FIELDS.map(f => row[f] ?? null));
  if (row.status === '履行中') activateProject(row.project_id);
  const saved = db.prepare('SELECT * FROM contracts WHERE id=?').get(info.lastInsertRowid);
  saved.warnings = r.warnings;
  res.json(saved);
});

router.put('/:id', requireAdmin, (req, res) => {
  const old = db.prepare('SELECT * FROM contracts WHERE id=?').get(req.params.id);
  if (!old) return res.status(404).json({ message: '合同不存在' });

  const { row, keys } = V.pick(req.body, FIELDS);
  if (!keys.length) return res.json({ ok: 1 });

  const merged = { ...old, ...row };
  const r = validateContract(merged, { id: Number(req.params.id) });
  if (r.error) return res.status(r.code).json({ message: r.error });

  V.patchRow('contracts', 'id', Number(req.params.id), row, keys);
  if (merged.status === '履行中') activateProject(merged.project_id);
  const saved = db.prepare('SELECT * FROM contracts WHERE id=?').get(req.params.id);
  saved.warnings = r.warnings;
  res.json(saved);
});

router.delete('/:id', requireAdmin, (req, res) => {
  if (!db.prepare('SELECT id FROM contracts WHERE id=?').get(req.params.id)) {
    return res.status(404).json({ message: '合同不存在' });
  }
  cleanupChangeRequests([['contract', Number(req.params.id)]]);
  db.prepare('DELETE FROM contracts WHERE id=?').run(req.params.id);
  res.json({ ok: 1 });
});

/* ---------- 付款记录 ---------- */
router.get('/:id/payments', (req, res) => {
  res.json(db.prepare('SELECT * FROM contract_payments WHERE contract_id=? ORDER BY pay_date,id').all(req.params.id));
});

router.post('/:id/payments', (req, res) => {
  const body = (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) ? req.body : {};
  const fields = {
    amount: body.amount, pay_date: V.norm(body.pay_date),
    stage: V.norm(body.stage), note: V.norm(body.note)
  };
  const r = validatePayment(fields, { contractId: req.params.id });
  if (r.error) return res.status(r.code).json({ message: r.error });

  const info = db.prepare('INSERT INTO contract_payments(contract_id,amount,pay_date,stage,note) VALUES(?,?,?,?,?)')
    .run(req.params.id, fields.amount, fields.pay_date, fields.stage, fields.note);
  const saved = db.prepare('SELECT * FROM contract_payments WHERE id=?').get(info.lastInsertRowid);
  saved.warnings = r.warnings;
  res.json(saved);
});

router.put('/:id/payments/:pid', requireAdmin, (req, res) => {
  const old = db.prepare('SELECT * FROM contract_payments WHERE id=? AND contract_id=?')
    .get(req.params.pid, req.params.id);
  if (!old) return res.status(404).json({ message: '付款记录不存在' });
  const body = (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) ? req.body : {};
  const fields = {
    amount: body.amount !== undefined ? body.amount : old.amount,
    pay_date: body.pay_date !== undefined ? V.norm(body.pay_date) : old.pay_date,
    stage: body.stage !== undefined ? V.norm(body.stage) : old.stage,
    note: body.note !== undefined ? V.norm(body.note) : old.note
  };
  const r = validatePayment(fields, { contractId: req.params.id, excludeId: Number(req.params.pid) });
  if (r.error) return res.status(r.code).json({ message: r.error });
  db.prepare('UPDATE contract_payments SET amount=?,pay_date=?,stage=?,note=? WHERE id=?')
    .run(fields.amount, fields.pay_date, fields.stage, fields.note, req.params.pid);
  const saved = db.prepare('SELECT * FROM contract_payments WHERE id=?').get(req.params.pid);
  saved.warnings = r.warnings;
  res.json(saved);
});

router.delete('/:id/payments/:pid', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM contract_payments WHERE id=? AND contract_id=?').run(req.params.pid, req.params.id);
  res.json({ ok: 1 });
});

module.exports = router;
