/**
 * 审计日志中间件：自动记录所有状态变更操作（登录、新增、修改、删除、审批）
 * 仅记录 POST/PUT/DELETE，GET 查询不记录，避免日志被浏览行为淹没。
 */
const { db } = require('./db');

const MODULE_MAP = {
  login: '认证', logout: '认证', me: '认证', 'change-password': '认证',
  projects: '项目',
  bids: '招标',
  contracts: '合同',
  progress: '进度',
  plans: '计划',
  'change-requests': '审批',
  users: '用户',
  stats: '统计',
  'audit-logs': '审计日志',
  attachments: '附件',
  notifications: '通知',
  settings: '系统设置',
  backup: '数据备份'
};

const SENSITIVE = /(password|pwd|token)/i;
const MAX_DETAIL = 2000;

/** 写操作时，按模块查询对象名称，让 target 更可读 */
const TARGET_TABLE = {
  projects: { table: 'projects', name: 'name' },
  bids: { table: 'bids', name: 'title' },
  contracts: { table: 'contracts', name: 'name' },
  'progress/records': { table: 'progress_records', name: 'record_date' },
  'progress/milestones': { table: 'milestones', name: 'name' },
  plans: { table: 'plans', name: 'name' },
  users: { table: 'users', name: 'real_name' },
  attachments: { table: 'attachments', name: 'filename' },
  'change-requests': { table: 'change_requests', name: 'target_name' }
};

/** 请求体脱敏：递归移除任意层级的密码/令牌等字段（嵌套对象同样处理） */
function sanitize(body) {
  if (!body || typeof body !== 'object') return body;
  if (Array.isArray(body)) return body.map(sanitize);
  const out = {};
  for (const [k, v] of Object.entries(body)) {
    if (SENSITIVE.test(k)) { out[k] = '******'; continue; }
    out[k] = (v && typeof v === 'object') ? sanitize(v) : v;
  }
  return out;
}

/** 由请求路径推断模块与操作类型（用 originalUrl，避免挂载路径裁剪的不确定性） */
function classify(req) {
  const url = (req.originalUrl || req.url || '').split('?')[0];
  const seg = url.split('/').filter(Boolean); // /api/projects/5 -> ['api','projects','5']
  const base = seg[0] === 'api' ? seg[1] : seg[0];
  const module = MODULE_MAP[base] || base || '其他';

  let action = '其他';
  if (base === 'login') action = '登录';
  else if (base === 'logout') action = '登出';
  else if (base === 'change-requests' && /approve|reject/.test(url)) action = '审批';
  else if (base === 'notifications' && /\/read$/.test(url)) action = '修改';
  else if (base === 'backup' && req.method === 'POST') action = '备份';
  else if (req.method === 'POST') action = '新增';
  else if (req.method === 'PUT') action = '修改';
  else if (req.method === 'DELETE') action = '删除';

  // 操作对象：尽量取业务名称，否则用资源+ID
  const b = req.body || {};
  const name = b.name || b.title || b.real_name || b.username || '';
  const idMatch = url.match(/\/(\d+)(?:\/|$)/);
  let target = '';
  if (base === 'login') target = '用户登录';
  else if (name && (req.method === 'POST' || req.method === 'PUT')) target = `${module}${idMatch ? ' #' + idMatch[1] : ''} ${name}`;
  else if (idMatch) target = `${module} #${idMatch[1]}`;
  return { module, action, target };
}

/** 来源 IP：仅取真实连接地址，不信任可伪造的 X-Forwarded-For */
function clientIp(req) {
  return req.ip || req.socket?.remoteAddress || '';
}

const insert = db.prepare(`INSERT INTO audit_logs
  (user_id,username,real_name,action,module,target,method,path,status_code,ip,detail)
  VALUES (?,?,?,?,?,?,?,?,?,?,?)`);

function auditMiddleware(req, res, next) {
  // 需要预取对象名的操作：删除（对象即将消失）、审批（target_name 不在请求体中）
  const isDelete = req.method === 'DELETE';
  const isApprove = req.method === 'POST' && /\/approve$|\/reject$/.test(req.originalUrl || req.url || '');
  if (isDelete || isApprove) {
    try {
      const url = (req.originalUrl || req.url || '').split('?')[0];
      const seg = url.split('/').filter(Boolean);
      const base = seg[0] === 'api' ? seg[1] : seg[0];
      const idMatch = url.match(/\/(\d+)(?:\/|$)/);
      const sub = seg[2]; // 如 progress/records
      const key = sub ? `${base}/${sub}` : base;
      const cfg = TARGET_TABLE[key] || TARGET_TABLE[base];
      if (cfg && idMatch) {
        const row = db.prepare(`SELECT ${cfg.name} AS n FROM ${cfg.table} WHERE id=?`).get(idMatch[1]);
        if (row) req._auditTargetName = row.n;
      }
    } catch (e) { /* 忽略，降级为 ID */ }
  }

  res.on('finish', () => {
    try {
      // 只记录写操作和登录；GET/OPTIONS 等不记录
      if (!['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) return;

      const { module, action, target } = classify(req);
      let userId = req.user?.id ?? null;
      let username = req.user?.username || null;
      let realName = req.user?.real_name || null;

      // 登录接口在鉴权之前执行：成功时按请求体中的账号补全操作人
      if ((req.originalUrl || req.url || '').includes('/login')) {
        username = req.body?.username || null;
        if (res.statusCode === 200 && username) {
          const u = db.prepare('SELECT id,real_name FROM users WHERE username=?').get(username);
          if (u) { userId = u.id; realName = u.real_name; }
        }
      }

      // 用预取的对象名覆盖 target，让日志更可读
      let finalTarget = target;
      if (req._auditTargetName && module !== '其他') {
        const idMatch = (req.originalUrl || req.url || '').match(/\/(\d+)(?:\/|$)/);
        finalTarget = `${module}${idMatch ? ' #' + idMatch[1] : ''} ${req._auditTargetName}`;
      }

      let detail = null;
      if (req.body && Object.keys(req.body).length) {
        detail = JSON.stringify(sanitize(req.body));
        if (detail.length > MAX_DETAIL) detail = detail.slice(0, MAX_DETAIL) + '…';
      }

      insert.run(userId, username, realName, action, module, finalTarget,
        req.method, req.originalUrl || req.url, res.statusCode, clientIp(req), detail);
    } catch (e) {
      // 审计失败不影响业务请求
      console.error('[审计日志写入失败]', e.message);
    }
  });
  next();
}

module.exports = { auditMiddleware };
