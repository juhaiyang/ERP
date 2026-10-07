/**
 * 系统设置：键值对配置，仅管理员可修改
 * 前端可拉取用于覆盖硬编码的业务字典
 */
const express = require('express');
const { db } = require('../db');
const { requireAdmin } = require('../auth');
const router = express.Router();

/** 所有设置（所有登录用户可读） */
router.get('/', (req, res) => {
  const rows = db.prepare('SELECT key, value, description, updated_at FROM system_settings ORDER BY key').all();
  const map = {};
  rows.forEach(r => { map[r.key] = r.value; });
  res.json({ rows, map });
});

/** 更新设置（仅管理员） */
router.put('/', requireAdmin, (req, res) => {
  const items = req.body || {};
  const entries = Object.entries(items);
  if (!entries.length) return res.status(400).json({ message: '没有需要保存的设置' });
  const stmt = db.prepare(`INSERT INTO system_settings(key,value,description,updated_at)
    VALUES(?,?,?,datetime('now','localtime'))
    ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`);
  const tx = db.transaction(rows => rows.forEach(([k, v]) => stmt.run(k, String(v ?? ''), null)));
  tx(entries);
  res.json({ ok: 1, message: '设置已保存' });
});

module.exports = router;
