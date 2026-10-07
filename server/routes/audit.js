/** 审计日志查询（仅管理员） */
const express = require('express');
const router = express.Router();
const { db } = require('../db');
const { requireAdmin } = require('../auth');

router.use(requireAdmin);

// 筛选项元数据（供前端生成下拉）
router.get('/meta', (req, res) => {
  res.json({
    modules: db.prepare('SELECT DISTINCT module FROM audit_logs ORDER BY module').all().map(r => r.module),
    actions: ['登录', '登出', '新增', '修改', '删除', '审批', '备份', '其他']
  });
});

// 日志列表：module/action/username/keyword/status(成功/失败)/startDate/endDate + 分页
router.get('/', (req, res) => {
  const { module, action, username, keyword, status, startDate, endDate } = req.query;
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const pageSize = Math.min(200, Math.max(1, parseInt(req.query.pageSize) || 20));

  const where = [];
  const args = [];
  if (module) { where.push('module=?'); args.push(module); }
  if (action) { where.push('action=?'); args.push(action); }
  if (username) { where.push('username LIKE ?'); args.push('%' + username + '%'); }
  if (status === 'success') where.push('status_code<400');
  if (status === 'fail') where.push('status_code>=400');
  if (startDate) { where.push('created_at>=?'); args.push(startDate + ' 00:00:00'); }
  if (endDate) { where.push('created_at<=?'); args.push(endDate + ' 23:59:59'); }
  if (keyword) {
    where.push('(target LIKE ? OR path LIKE ? OR detail LIKE ? OR real_name LIKE ?)');
    args.push('%' + keyword + '%', '%' + keyword + '%', '%' + keyword + '%', '%' + keyword + '%');
  }
  const wsql = where.length ? 'WHERE ' + where.join(' AND ') : '';

  const total = db.prepare(`SELECT COUNT(*) c FROM audit_logs ${wsql}`).get(...args).c;
  const list = db.prepare(
    `SELECT id,user_id,username,real_name,action,module,target,method,path,status_code,ip,detail,created_at
     FROM audit_logs ${wsql} ORDER BY id DESC LIMIT ? OFFSET ?`
  ).all(...args, pageSize, (page - 1) * pageSize).map(r => {
    if (r.detail) { try { r.detail = JSON.parse(r.detail); } catch { /* 保留原始字符串 */ } }
    return r;
  });

  res.json({ list, total, page, pageSize });
});

module.exports = router;
