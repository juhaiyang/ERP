/**
 * 附件管理：上传、下载、列表、删除
 * 支持 project/bid/contract/progress/plan 等模块的附件关联
 */
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { db } = require('../db');
const { requireAdmin } = require('../auth');

const router = express.Router();

const UPLOAD_DIR = path.join(__dirname, '..', '..', 'data', 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const ALLOWED_MODULES = ['project', 'bid', 'contract', 'progress', 'plan'];
const MAX_SIZE = 20 * 1024 * 1024; // 20MB

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '';
    cb(null, Date.now() + '_' + crypto.randomBytes(8).toString('hex') + ext);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_SIZE }
});

/** 上传附件：POST /api/attachments?module=project&target_id=1  (multipart/form-data, field=file) */
router.post('/', upload.single('file'), (req, res) => {
  const { module, target_id } = req.query;
  if (!ALLOWED_MODULES.includes(module)) return res.status(400).json({ message: '不支持的模块类型' });
  if (!target_id) return res.status(400).json({ message: '缺少 target_id' });
  if (!req.file) return res.status(400).json({ message: '未收到文件' });

  const info = db.prepare(`INSERT INTO attachments
    (module, target_id, filename, stored_name, size, mime, uploaded_by, uploaded_by_name)
    VALUES (?,?,?,?,?,?,?,?)`)
    .run(module, Number(target_id), req.file.originalname, req.file.filename,
      req.file.size, req.file.mimetype, req.user.id, req.user.real_name);

  const row = db.prepare('SELECT * FROM attachments WHERE id=?').get(info.lastInsertRowid);
  res.json(row);
});

/** 附件列表：GET /api/attachments?module=project&target_id=1 */
router.get('/', (req, res) => {
  const { module, target_id } = req.query;
  if (!module || !target_id) return res.status(400).json({ message: '缺少 module 或 target_id' });
  const list = db.prepare(
    'SELECT * FROM attachments WHERE module=? AND target_id=? ORDER BY id DESC'
  ).all(module, Number(target_id));
  res.json(list);
});

/** 下载附件：GET /api/attachments/:id/download */
router.get('/:id/download', (req, res) => {
  const att = db.prepare('SELECT * FROM attachments WHERE id=?').get(req.params.id);
  if (!att) return res.status(404).json({ message: '附件不存在' });
  const filePath = path.join(UPLOAD_DIR, att.stored_name);
  if (!fs.existsSync(filePath)) return res.status(404).json({ message: '文件已丢失' });
  res.download(filePath, att.filename);
});

/** 删除附件：仅管理员或上传人 */
router.delete('/:id', (req, res) => {
  const att = db.prepare('SELECT * FROM attachments WHERE id=?').get(req.params.id);
  if (!att) return res.status(404).json({ message: '附件不存在' });
  if (req.user.role !== '管理员' && att.uploaded_by !== req.user.id) {
    return res.status(403).json({ message: '仅管理员或上传人可删除' });
  }
  const filePath = path.join(UPLOAD_DIR, att.stored_name);
  if (fs.existsSync(filePath)) {
    try { fs.unlinkSync(filePath); } catch (e) { console.error('[附件删除文件失败]', e.message); }
  }
  db.prepare('DELETE FROM attachments WHERE id=?').run(req.params.id);
  res.json({ ok: 1 });
});

module.exports = router;
