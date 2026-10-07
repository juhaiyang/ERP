/** 用户管理（仅管理员） */
const express = require('express');
const { db, hashPassword } = require('../db');
const { requireAdmin } = require('../auth');
const router = express.Router();

router.use(requireAdmin);

const ROLES = ['管理员', '项目经理', '业务员'];

router.get('/', (req, res) => {
  res.json(db.prepare('SELECT id,username,real_name,role,active,created_at FROM users ORDER BY id').all());
});

router.post('/', (req, res) => {
  const { username, password, real_name, role } = req.body || {};
  if (!username || !password) return res.status(400).json({ message: '用户名和初始密码必填' });
  if (password.length < 6) return res.status(400).json({ message: '密码至少6位' });
  if (!ROLES.includes(role)) return res.status(400).json({ message: '角色不合法' });
  const exists = db.prepare('SELECT id FROM users WHERE username=?').get(username);
  if (exists) return res.status(400).json({ message: '用户名已存在' });
  const info = db.prepare('INSERT INTO users(username,password,real_name,role,active) VALUES(?,?,?,?,1)')
    .run(username, hashPassword(password), real_name || username, role);
  res.json(db.prepare('SELECT id,username,real_name,role,active,created_at FROM users WHERE id=?').get(info.lastInsertRowid));
});

router.put('/:id', (req, res) => {
  const id = Number(req.params.id);
  const { real_name, role, active } = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(id);
  if (!user) return res.status(404).json({ message: '用户不存在' });
  // 保护：管理员不能停用或降级自己，避免锁死系统
  if (id === req.user.id && (active === 0 || (role && role !== '管理员'))) {
    return res.status(400).json({ message: '不能停用或降级当前登录的管理员账号' });
  }
  if (role !== undefined && !ROLES.includes(role)) return res.status(400).json({ message: '角色不合法' });
  db.prepare('UPDATE users SET real_name=COALESCE(?,real_name), role=COALESCE(?,role), active=COALESCE(?,active) WHERE id=?')
    .run(real_name ?? null, role ?? null, active ?? null, id);
  res.json(db.prepare('SELECT id,username,real_name,role,active,created_at FROM users WHERE id=?').get(id));
});

router.post('/:id/reset-password', (req, res) => {
  const id = Number(req.params.id);
  const { password } = req.body || {};
  if (!password || password.length < 6) return res.status(400).json({ message: '新密码至少6位' });
  const user = db.prepare('SELECT id FROM users WHERE id=?').get(id);
  if (!user) return res.status(404).json({ message: '用户不存在' });
  db.prepare('UPDATE users SET password=? WHERE id=?').run(hashPassword(password), id);
  res.json({ ok: 1, message: '密码已重置' });
});

module.exports = router;
