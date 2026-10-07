/**
 * 变更申请与审批
 * 规则：普通员工修改已有记录 → 提交变更申请 → 管理员审批通过后才真正写库
 *
 * 一致性保证：
 *  - 审批落库前的硬校验复用 rules.js 中与直接编辑完全相同的函数，杜绝两套规则；
 *  - 审批前比对申请快照与当前数据，目标已被改动则拒绝应用，避免覆盖他人的后续修改；
 *  - 同一对象的多条待审批申请，批准其一后其余自动作废，避免"记录了通过却没生效"。
 */
const express = require('express');
const { db, tx } = require('../db');
const { requireAdmin } = require('../auth');
const {
  validateProject, validateBid, validateContract,
  validateRecord, validateMilestone, validatePlan, validateTask
} = require('../rules');
const { applyScheduleCascade } = require('../cascade');
const { notify } = require('./notifications');

const router = express.Router();

/* 可申请变更的对象注册表：表名、名称字段、允许变更的字段白名单与中文名 */
const REG = {
  project: {
    typeLabel: '项目', table: 'projects', nameField: 'name',
    fields: { code: '项目编号', name: '项目名称', type: '项目类型', location: '建设地点',
      owner: '建设单位', manager: '负责人', phone: '联系电话', budget: '总投资(万元)',
      start_date: '计划开工', end_date: '计划完工', status: '状态', description: '项目概况' }
  },
  bid: {
    typeLabel: '招标信息', table: 'bids', nameField: 'title',
    fields: { bid_no: '招标编号', title: '招标名称', method: '招标方式', budget: '控制价(万元)',
      publish_date: '发布日期', signup_deadline: '报名截止', bid_open_date: '开标日期',
      agency: '代理机构', winner: '中标单位', win_amount: '中标金额(万元)',
      content: '招标内容', status: '状态' }
  },
  contract: {
    typeLabel: '合同', table: 'contracts', nameField: 'name',
    fields: { contract_no: '合同编号', name: '合同名称', party_a: '甲方', party_b: '乙方',
      amount: '合同金额(万元)', sign_date: '签订日期', start_date: '开始日期', end_date: '结束日期',
      status: '合同状态', content: '合同内容' }
  },
  progress_record: {
    typeLabel: '进度填报', table: 'progress_records', nameField: null,
    fields: { record_date: '填报日期', period: '报告期', percent: '累计进度(%)',
      work_done: '本期完成工作', issues: '存在问题', next_plan: '下期计划', reporter: '填报人' }
  },
  milestone: {
    typeLabel: '里程碑', table: 'milestones', nameField: 'name',
    fields: { name: '里程碑名称', plan_date: '计划日期', actual_date: '实际日期', status: '状态' }
  },
  plan: {
    typeLabel: '计划', table: 'plans', nameField: 'name',
    fields: { name: '计划名称', year: '年度', start_date: '开始日期', end_date: '结束日期',
      owner: '负责人', status: '状态', description: '说明' }
  },
  task: {
    typeLabel: '计划任务', table: 'plan_tasks', nameField: 'name',
    fields: { name: '任务名称', owner: '负责人', weight: '权重(%)', start_date: '计划开始',
      end_date: '计划完成', actual_start: '实际开始', actual_end: '实际完成',
      status: '状态', remark: '备注' }
  }
};

const normD = v => (v === '' || v === undefined || v === null ? null : v);

/**
 * 审批通过前的业务硬校验：与直接编辑走完全相同的 rules 函数。
 * @returns {string|null} 错误提示；通过返回 null
 */
function validateOnApprove(type, targetId, data) {
  const cur = db.prepare(`SELECT * FROM ${REG[type].table} WHERE id=?`).get(targetId);
  if (!cur) return null; // 目标已删除由审批主流程处理

  // 构造"应用变更后"的完整行：未在本次 payload 中的字段沿用当前值
  const merged = { ...cur };
  for (const f of Object.keys(REG[type].fields)) {
    if (data[f] !== undefined) merged[f] = normD(data[f]);
  }

  let r;
  switch (type) {
    case 'project': r = validateProject(merged, { id: targetId, old: cur }); break;
    case 'bid': r = validateBid(merged, { id: Number(targetId) }); break;
    case 'contract': r = validateContract(merged, { id: Number(targetId) }); break;
    case 'progress_record': r = validateRecord(merged, { mode: 'update', excludeId: Number(targetId) }); break;
    case 'milestone': r = validateMilestone(merged); break;
    case 'plan': r = validatePlan(merged); break;
    case 'task': r = validateTask(merged, { planId: cur.plan_id, excludeId: Number(targetId) }); break;
    default: r = { error: null };
  }
  return r.error || null;
}

/**
 * 快照有效性校验：申请提交后若目标字段已被其他人（或管理员）改过，
 * 再按旧快照整体覆盖会淹没后续修改，必须先驳回重提。
 */
function findStale(type, targetId, r) {
  let oldSnapshot = null;
  try { oldSnapshot = JSON.parse(r.old_data || 'null'); } catch { oldSnapshot = null; }
  if (!oldSnapshot) return null;
  const cur = db.prepare(`SELECT * FROM ${REG[type].table} WHERE id=?`).get(targetId);
  if (!cur) return null;
  let payload = null;
  try { payload = JSON.parse(r.payload || '{}'); } catch { payload = {}; }

  for (const f of Object.keys(payload)) {
    const key = REG[type].fields[f] ? f : null;
    if (!key) continue;
    if (!sameVal(oldSnapshot[f], cur[f])) {
      return `字段"${REG[type].fields[f]}"在提交申请后已被修改（申请时：${showVal(oldSnapshot[f])}，当前：${showVal(cur[f])}），请驳回后重新提交`;
    }
  }
  return null;
}

/** 业务对象删除时，同步清理其变更申请（items: [[type,id],...]） */
function cleanupChangeRequests(items) {
  if (!items || !items.length) return;
  const stmt = db.prepare('DELETE FROM change_requests WHERE target_type=? AND target_id=?');
  for (const [type, id] of items) {
    if (REG[type] && id != null) stmt.run(type, id);
  }
}

function norm(v) { return v === '' || v === undefined ? null : v; }
function sameVal(a, b) {
  a = norm(a); b = norm(b);
  if (a === b) return true;
  if (a !== null && b !== null && a !== '' && b !== '' && Number(a) === Number(b)) return true;
  return String(a) === String(b);
}
function showVal(v) {
  v = norm(v);
  return v === null ? '（空）' : String(v);
}
function rowName(meta, row) {
  if (!row) return '';
  if (meta.nameField) return row[meta.nameField];
  return (row.period || row.record_date || '') + ' 进度填报';
}

function parseRow(r) {
  if (!r) return r;
  ['payload', 'old_data', 'changes'].forEach(k => {
    if (typeof r[k] === 'string') { try { r[k] = JSON.parse(r[k]); } catch { r[k] = null; } }
  });
  r.type_label = (REG[r.target_type] || {}).typeLabel || r.target_type;
  return r;
}

/**
 * 显示名单一数据源：target_name 仅为提交时快照，列表/详情返回时一律以
 * 各业务主表（projects/bids/contracts/...）的当前名称为准，避免对象改名后
 * 审批模块与项目/合同等模块显示不一致。对象已删除时保留快照兜底。
 */
function attachLiveName(r) {
  if (!r) return r;
  const meta = REG[r.target_type];
  if (meta) {
    const cur = db.prepare(`SELECT * FROM ${meta.table} WHERE id=?`).get(r.target_id);
    if (cur) {
      r.target_name = rowName(meta, cur);
      r.target_exists = 1;
    } else {
      r.target_exists = 0;
    }
  }
  return r;
}

/* 提交变更申请 */
router.post('/', (req, res) => {
  const { target_type, target_id, payload } = req.body || {};
  const meta = REG[target_type];
  if (!meta) return res.status(400).json({ message: '不支持的变更对象类型' });
  if (!target_id) return res.status(400).json({ message: '缺少变更对象' });
  const old = db.prepare(`SELECT * FROM ${meta.table} WHERE id=?`).get(target_id);
  if (!old) return res.status(404).json({ message: '原记录不存在，无法提交变更' });

  const data = (payload && typeof payload === 'object' && !Array.isArray(payload)) ? payload : {};
  const changes = [];
  const allowed = {};
  Object.keys(meta.fields).forEach(f => {
    if (data[f] === undefined) return;
    allowed[f] = norm(data[f]);
    if (!sameVal(old[f], data[f])) {
      changes.push({ field: f, label: meta.fields[f], old: showVal(old[f]), new: showVal(data[f]) });
    }
  });
  if (!changes.length) return res.status(400).json({ message: '未检测到任何变更内容' });

  const info = db.prepare(`INSERT INTO change_requests
    (target_type,target_id,action,target_name,payload,old_data,changes,status,submitted_by,submitted_by_name)
    VALUES(?,?,?,?,?,?,?,?,?,?)`)
    .run(target_type, target_id, 'update', rowName(meta, old),
      JSON.stringify(allowed), JSON.stringify(old), JSON.stringify(changes),
      'pending', req.user.id, req.user.real_name);
  // 同一对象存在多条待审批时给出提示，便于管理员识别冲突
  const pend = db.prepare("SELECT COUNT(*) c FROM change_requests WHERE target_type=? AND target_id=? AND status='pending'")
    .get(target_type, target_id).c;
  const row = parseRow(db.prepare('SELECT * FROM change_requests WHERE id=?').get(info.lastInsertRowid));
  row.warnings = pend > 1 ? [`该对象当前共有 ${pend} 条待审批申请，批准其中一条后其余将自动作废`] : [];
  res.json(row);
});

/* 列表：管理员看全部，员工只看自己提交的 */
router.get('/', (req, res) => {
  const { status = '', target_type = '', scope = '' } = req.query;
  const where = [];
  const args = [];
  if (status) { where.push('status=?'); args.push(status); }
  if (target_type) { where.push('target_type=?'); args.push(target_type); }
  if (req.user.role !== '管理员' || scope === 'mine') { where.push('submitted_by=?'); args.push(req.user.id); }
  const wsql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const list = db.prepare(`SELECT * FROM change_requests ${wsql} ORDER BY id DESC`).all(...args)
    .map(parseRow).map(attachLiveName);
  res.json({ list, total: list.length });
});

/* 待审批数量（菜单徽标用） */
router.get('/pending/count', (req, res) => {
  const isAdmin = req.user.role === '管理员';
  const row = isAdmin
    ? db.prepare("SELECT COUNT(*) c FROM change_requests WHERE status='pending'").get()
    : db.prepare("SELECT COUNT(*) c FROM change_requests WHERE status='pending' AND submitted_by=?").get(req.user.id);
  res.json({ count: row.c, mine: !isAdmin });
});

router.get('/:id', (req, res) => {
  const r = attachLiveName(parseRow(db.prepare('SELECT * FROM change_requests WHERE id=?').get(req.params.id)));
  if (!r) return res.status(404).json({ message: '申请不存在' });
  if (req.user.role !== '管理员' && r.submitted_by !== req.user.id) {
    return res.status(403).json({ message: '无权查看该申请' });
  }
  res.json(r);
});

/* 审批通过：将变更真正写入业务表 */
router.post('/:id/approve', requireAdmin, (req, res) => {
  const r = db.prepare('SELECT * FROM change_requests WHERE id=?').get(req.params.id);
  if (!r) return res.status(404).json({ message: '申请不存在' });
  if (r.status !== 'pending') return res.status(400).json({ message: '该申请已处理，请勿重复操作' });
  const meta = REG[r.target_type];
  if (!meta) return res.status(400).json({ message: '未知的变更类型' });

  const current = db.prepare(`SELECT * FROM ${meta.table} WHERE id=?`).get(r.target_id);
  if (!current) return res.status(400).json({ message: '原记录已删除，无法应用变更，可驳回该申请' });

  const payload = JSON.parse(r.payload || '{}');

  // 快照有效性：目标字段在提交后被改动 → 拒绝应用，避免淹没后续修改
  const stale = findStale(r.target_type, r.target_id, r);
  if (stale) {
    return res.status(409).json({ message: '目标数据已被修改，无法直接应用：' + stale + '。请先驳回本次申请。' });
  }

  // 落库前业务硬校验（与直接编辑完全同一套规则）
  const invalid = validateOnApprove(r.target_type, r.target_id, payload);
  if (invalid) return res.status(400).json({ message: '变更内容未通过校验：' + invalid });

  const cols = Object.keys(payload).filter(f => meta.fields[f] !== undefined);

  // 项目工期变更：先取旧值用于联动
  const projectBefore = r.target_type === 'project'
    ? db.prepare('SELECT * FROM projects WHERE id=?').get(r.target_id) : null;

  let extra = '';
  let superseded = 0;
  try {
    // 落库、作废同对象其余申请、工期联动、状态联动必须原子完成：
    // 中途失败若留下"已批准但未生效"或半套联动数据，会造成跨模块不一致
    tx(() => {
      if (cols.length) {
        db.prepare(`UPDATE ${meta.table} SET ${cols.map(c => c + '=?').join(',')} WHERE id=?`)
          .run(...cols.map(c => payload[c]), r.target_id);
      }
      db.prepare(`UPDATE change_requests SET status='approved',reviewed_by=?,reviewed_at=datetime('now','localtime'),review_comment=? WHERE id=?`)
        .run(req.user.real_name, (req.body && req.body.comment) || null, r.id);

      // 同一对象的其余待审批申请自动作废：否则会出现"记录为已通过但实际未生效"的失真审计
      superseded = db.prepare(
        `UPDATE change_requests SET status='superseded',reviewed_by=?,reviewed_at=datetime('now','localtime'),review_comment=?
         WHERE target_type=? AND target_id=? AND status='pending'`)
        .run(req.user.real_name, '已被针对同一对象的另一条变更申请覆盖', r.target_type, r.target_id).changes;

      // 联动1：项目开工/完工日期变化 → 顺延挂靠在工期边界上的合同/里程碑/计划/任务
      if (projectBefore) {
        const notes = applyScheduleCascade(r.target_id, projectBefore, payload);
        if (notes.length) extra = '；已联动顺延' + notes.join('、');
      }
      // 联动2：合同经审批进入"履行中" → 项目状态自动转入施工中
      if (r.target_type === 'contract' && payload.status === '履行中') {
        const c = db.prepare('SELECT project_id FROM contracts WHERE id=?').get(r.target_id);
        if (c) {
          const n = db.prepare("UPDATE projects SET status='施工中' WHERE id=? AND status IN ('筹备中','招标中')").run(c.project_id).changes;
          if (n) extra += '；项目状态已联动为"施工中"';
        }
      }
    });
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) {
      return res.status(400).json({ message: '变更内容与现有记录冲突（如编号重复），无法应用' });
    }
    throw e;
  }
  if (superseded) extra += `；同对象的另外 ${superseded} 条待审批申请已自动作废`;

  // 通知提交人
  if (r.submitted_by) {
    notify(r.submitted_by, 'success',
      `变更申请已通过：${r.target_name}`,
      `您提交的${meta.typeLabel}变更申请已审批通过并生效。${extra}`,
      '#/approvals');
  }
  res.json({ ok: 1, message: '已通过并应用变更' + extra });
});

/* 驳回 */
router.post('/:id/reject', requireAdmin, (req, res) => {
  const r = db.prepare('SELECT * FROM change_requests WHERE id=?').get(req.params.id);
  if (!r) return res.status(404).json({ message: '申请不存在' });
  if (r.status !== 'pending') return res.status(400).json({ message: '该申请已处理，请勿重复操作' });
  const comment = (req.body && req.body.comment) || '';
  if (!comment.trim()) return res.status(400).json({ message: '请填写驳回原因' });
  db.prepare(`UPDATE change_requests SET status='rejected',reviewed_by=?,reviewed_at=datetime('now','localtime'),review_comment=? WHERE id=?`)
    .run(req.user.real_name, comment, r.id);
  // 通知提交人
  if (r.submitted_by) {
    notify(r.submitted_by, 'danger',
      `变更申请已驳回：${r.target_name}`,
      `您提交的${REG[r.target_type].typeLabel}变更申请被驳回。驳回原因：${comment}`,
      '#/approvals');
  }
  res.json({ ok: 1, message: '已驳回' });
});

module.exports = router;
module.exports.cleanupChangeRequests = cleanupChangeRequests;
