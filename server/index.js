/**
 * 水土保持项目管理系统 —— 服务入口
 * 启动：npm start
 *   HTTPS 模式（默认）：https://localhost:3000   （自签名证书，浏览器首次访问选"继续前往"）
 *   HTTP 模式：         HTTPS=false npm start  → http://localhost:3000
 */
const express = require('express');
const https = require('https');
const http = require('http');
const os = require('os');
const path = require('path');
require('./db');
const { login, requireAuth, me, changePassword, logout } = require('./auth');
const { auditMiddleware } = require('./audit');

const app = express();
app.use(express.json());

const ROOT = path.join(__dirname, '..');
const NM = path.join(ROOT, 'node_modules');

// 审计日志：在所有 /api 路由之前挂载，覆盖登录接口（仅记录写操作）
app.use('/api', auditMiddleware);

// 登录接口（无需鉴权）
app.post('/api/login', login);

// 以下接口均需登录
app.use('/api', requireAuth);
app.get('/api/me', me);
app.post('/api/change-password', changePassword);
app.post('/api/logout', requireAuth, logout);
app.use('/api/projects', require('./routes/projects'));
app.use('/api/bids', require('./routes/bids'));
app.use('/api/contracts', require('./routes/contracts'));
app.use('/api/progress', require('./routes/progress'));
app.use('/api/plans', require('./routes/plans'));
app.use('/api/change-requests', require('./routes/approvals'));
app.use('/api/users', require('./routes/users'));
app.use('/api/stats', require('./routes/stats'));
app.use('/api/audit-logs', require('./routes/audit'));
app.use('/api/attachments', require('./routes/attachments'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api/backup', require('./routes/backup'));

// 统一错误处理
app.use('/api', (err, req, res, next) => {
  if (err && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ message: '文件大小超过 20MB 限制' });
  }
  if (err && (err.type === 'entity.parse.failed' || err.status === 400)) {
    return res.status(400).json({ message: '请求体格式错误（非法JSON）' });
  }
  console.error(err);
  res.status(500).json({ message: err.message || '服务器内部错误' });
});

// 本地化的前端第三方库（离线可用）
app.use('/vendor/vue', express.static(path.join(NM, 'vue', 'dist')));
app.use('/vendor/vue-router', express.static(path.join(NM, 'vue-router', 'dist')));
app.use('/vendor/element-plus', express.static(path.join(NM, 'element-plus', 'dist')));
app.use('/vendor/element-plus-icons', express.static(path.join(NM, '@element-plus', 'icons-vue', 'dist')));
app.use('/vendor/echarts', express.static(path.join(NM, 'echarts', 'dist')));
app.use('/vendor/axios', express.static(path.join(NM, 'axios', 'dist')));

// 前端静态页面
app.use(express.static(path.join(ROOT, 'public')));

const PORT = process.env.PORT || 3000;
// 默认为 HTTPS 模式；如需 HTTP 可设置 HTTPS=false
const USE_HTTPS = process.env.HTTPS !== 'false';

function getLanIPs() {
  const ips = [];
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) ips.push(net.address);
    }
  }
  return ips;
}

function printBanner(proto) {
  console.log('==============================================');
  console.log('  水土保持项目管理系统已启动 (' + (USE_HTTPS ? 'HTTPS' : 'HTTP') + ' 模式)');
  console.log('  本机:     ' + proto + '://localhost:' + PORT);
  getLanIPs().forEach(ip => console.log('  局域网:   ' + proto + '://' + ip + ':' + PORT));
  console.log('  默认账号: admin / 123456');
  if (USE_HTTPS) console.log('  提示: 首次访问浏览器会提示不安全，选择"继续前往"即可');
  console.log('==============================================');
}

if (USE_HTTPS) {
  const { loadCert } = require('./cert');
  const { key, cert } = loadCert();
  https.createServer({ key, cert }, app).listen(PORT, '0.0.0.0', () => printBanner('https'));
} else {
  http.createServer(app).listen(PORT, '0.0.0.0', () => printBanner('http'));
}
