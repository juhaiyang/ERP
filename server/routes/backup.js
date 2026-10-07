/**
 * 数据库备份与恢复（仅管理员）
 * 备份采用 SQLite VACUUM INTO 热备份，不中断服务；
 * 恢复需停止写入，采用文件替换方式。
 */
const express = require('express');
const path = require('path');
const fs = require('fs');
const { db } = require('../db');
const { requireAdmin } = require('../auth');

const router = express.Router();
router.use(requireAdmin);

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'swc.db');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
fs.mkdirSync(BACKUP_DIR, { recursive: true });

const RETENTION_DAYS = 14;

/** 备份列表 */
router.get('/', (req, res) => {
  const files = fs.readdirSync(BACKUP_DIR)
    .filter(f => f.endsWith('.db'))
    .map(f => {
      const fp = path.join(BACKUP_DIR, f);
      const stat = fs.statSync(fp);
      return {
        filename: f,
        size: stat.size,
        created_at: stat.mtime.toLocaleString('zh-CN', { hour12: false })
      };
    })
    .sort((a, b) => b.filename.localeCompare(a.filename));
  res.json(files);
});

/** 立即备份 */
router.post('/', (req, res) => {
  const ts = new Date();
  const pad = n => String(n).padStart(2, '0');
  const fname = `swc_${ts.getFullYear()}${pad(ts.getMonth() + 1)}${pad(ts.getDate())}_${pad(ts.getHours())}${pad(ts.getMinutes())}${pad(ts.getSeconds())}.db`;
  const dest = path.join(BACKUP_DIR, fname);
  try {
    db.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`);
  } catch (e) {
    return res.status(500).json({ message: '备份失败：' + e.message });
  }
  // 完整性校验
  const { DatabaseSync } = require('node:sqlite');
  let integrity = 'unknown';
  try {
    const checkDb = new DatabaseSync(dest);
    integrity = checkDb.prepare('PRAGMA integrity_check').get().integrity_check;
    checkDb.close();
  } catch (e) { integrity = '校验异常: ' + e.message; }

  // 清理过期备份
  const expire = Date.now() - RETENTION_DAYS * 24 * 3600 * 1000;
  fs.readdirSync(BACKUP_DIR).forEach(f => {
    const fp = path.join(BACKUP_DIR, f);
    if (fs.statSync(fp).mtimeMs < expire) {
      try { fs.unlinkSync(fp); } catch (e) { /* ignore */ }
    }
  });

  res.json({ ok: 1, filename: fname, integrity });
});

/** 下载备份 */
router.get('/:filename/download', (req, res) => {
  const fname = path.basename(req.params.filename);
  const fp = path.join(BACKUP_DIR, fname);
  if (!fs.existsSync(fp) || !fname.endsWith('.db')) {
    return res.status(404).json({ message: '备份文件不存在' });
  }
  res.download(fp, fname);
});

/** 删除备份 */
router.delete('/:filename', (req, res) => {
  const fname = path.basename(req.params.filename);
  const fp = path.join(BACKUP_DIR, fname);
  if (!fs.existsSync(fp)) return res.status(404).json({ message: '备份文件不存在' });
  fs.unlinkSync(fp);
  res.json({ ok: 1 });
});

module.exports = router;
