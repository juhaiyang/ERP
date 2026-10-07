/**
 * 站内消息通知：审批结果、系统提醒等
 * 每个用户查看自己的通知，标记已读
 */
const express = require('express');
const { db } = require('../db');
const router = express.Router();

/** 创建通知（供其他模块调用） */
function notify(userId, type, title, content, link) {
  db.prepare(`INSERT INTO notifications(user_id,type,title,content,link) VALUES(?,?,?,?,?)`)
    .run(userId, type || 'info', title, content || null, link || null);
}

/** 当前用户的通知列表（未读优先） */
router.get('/', (req, res) => {
  const { is_read } = req.query;
  let sql = 'SELECT * FROM notifications WHERE user_id=?';
  const args = [req.user.id];
  if (is_read !== undefined) { sql += ' AND is_read=?'; args.push(Number(is_read)); }
  sql += ' ORDER BY is_read ASC, id DESC LIMIT 100';
  res.json(db.prepare(sql).all(...args));
});

/** 未读数量 */
router.get('/unread-count', (req, res) => {
  const c = db.prepare('SELECT COUNT(*) c FROM notifications WHERE user_id=? AND is_read=0').get(req.user.id).c;
  res.json({ count: c });
});

/** 标记已读（单个或全部） */
router.post('/read', (req, res) => {
  const { id } = req.body || {};
  if (id) {
    db.prepare('UPDATE notifications SET is_read=1 WHERE id=? AND user_id=?').run(id, req.user.id);
  } else {
    db.prepare('UPDATE notifications SET is_read=1 WHERE user_id=?').run(req.user.id);
  }
  res.json({ ok: 1 });
});

/** 删除通知 */
router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM notifications WHERE id=? AND user_id=?').run(req.params.id, req.user.id);
  res.json({ ok: 1 });
});

module.exports = router;
module.exports.notify = notify;
