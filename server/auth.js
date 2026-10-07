/** 登录鉴权：Bearer Token（内存存储，支持登出、绝对过期、空闲过期与失败锁定） */
const crypto = require('crypto');
const { db, hashPassword, verifyPassword, isLegacyHash } = require('./db');

/**
 * token -> { info, exp(绝对过期时间), last(最近活跃时间) }
 * 说明：内存存储，服务重启后需重新登录；配合定期清扫避免长期运行导致内存只增不减。
 */
const tokens = new Map();

const ABSOLUTE_TTL = 12 * 3600 * 1000;   // 登录后最长有效 12 小时
const IDLE_TTL = 4 * 3600 * 1000;        // 连续 4 小时无操作自动登出
const SWEEP_INTERVAL = 30 * 60 * 1000;   // 过期会话清扫周期

/* ---------------- 登录失败保护 ---------------- */
const failState = new Map();   // key -> { count, until }
const ipState = new Map();     // ip  -> { count, windowStart }
const MAX_FAIL = 5;            // 同一账号连续错误次数上限
const LOCK_MS = 10 * 60 * 1000;// 锁定时长
const IP_MAX_FAIL = 50;        // 同一来源 IP 的失败上限（防止跨账号撞库）
const IP_WINDOW_MS = 10 * 60 * 1000;

function lockRemainingMs(until) { return Math.max(0, until - Date.now()); }

function isLocked(key, ip) {
  const st = failState.get(key);
  if (st && st.until > Date.now()) {
    return { locked: true, minutes: Math.ceil(lockRemainingMs(st.until) / 60000), byAccount: true };
  }
  if (st && st.until && st.until <= Date.now()) failState.delete(key);

  const ipSt = ipState.get(ip);
  if (ipSt && Date.now() - ipSt.windowStart < IP_WINDOW_MS && ipSt.count >= IP_MAX_FAIL) {
    return { locked: true, minutes: Math.ceil((IP_WINDOW_MS - (Date.now() - ipSt.windowStart)) / 60000), byAccount: false };
  }
  if (ipSt && Date.now() - ipSt.windowStart >= IP_WINDOW_MS) ipState.delete(ip);
  return { locked: false };
}

function noteFail(key, ip) {
  const st = failState.get(key) || { count: 0, until: 0 };
  st.count += 1;
  if (st.count >= MAX_FAIL) st.until = Date.now() + LOCK_MS;
  failState.set(key, st);

  const ipSt = (ipState.get(ip) && Date.now() - ipState.get(ip).windowStart < IP_WINDOW_MS)
    ? ipState.get(ip) : { count: 0, windowStart: Date.now() };
  ipSt.count += 1;
  ipState.set(ip, ipSt);
}

function noteSuccess(key) { failState.delete(key); }

function loginKeyOf(username) { return 'u:' + String(username || '').slice(0, 200); }

function login(req, res) {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ message: '请输入用户名和密码' });

  const ip = clientIp(req);
  const lock = isLocked(loginKeyOf(username), ip);
  if (lock.locked) {
    return res.status(403).json({
      message: lock.byAccount
        ? `密码连续错误 ${MAX_FAIL} 次，账号已锁定 ${lock.minutes} 分钟，请稍后再试或联系管理员`
        : `来自该网络地址的登录失败次数过多，请 ${lock.minutes} 分钟后再试`
    });
  }

  const user = db.prepare('SELECT * FROM users WHERE username=?').get(username);
  if (!user || !verifyPassword(password, user.password)) {
    noteFail(loginKeyOf(username), ip);
    const left = MAX_FAIL - (failState.get(loginKeyOf(username))?.count || 0);
    return res.status(401).json({
      message: left > 0
        ? `用户名或密码错误，再错 ${left} 次账号将锁定 ${LOCK_MS / 60000} 分钟`
        : `用户名或密码错误，账号已锁定 ${LOCK_MS / 60000} 分钟`
    });
  }
  if (user.active === 0) {
    return res.status(403).json({ message: '账号已停用，请联系管理员' });
  }
  noteSuccess(loginKeyOf(username));

  // 旧版固定盐 sha256 哈希在登录成功后自动升级为 scrypt + 随机盐
  if (isLegacyHash(user.password)) {
    db.prepare('UPDATE users SET password=? WHERE id=?').run(hashPassword(password), user.id);
  }

  const token = crypto.randomBytes(24).toString('hex');
  const info = { id: user.id, username: user.username, real_name: user.real_name, role: user.role };
  tokens.set(token, { info, exp: Date.now() + ABSOLUTE_TTL, last: Date.now() });
  res.json({ token, user: info });
}

/** 来源 IP：仅取真实连接地址，不信任客户端可伪造的 X-Forwarded-For（否则可通过伪造头绕过登录失败限制） */
function clientIp(req) {
  return req.ip || req.socket?.remoteAddress || '';
}

function requireAuth(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  const sess = token ? tokens.get(token) : null;
  if (!sess) return res.status(401).json({ message: '未登录或登录已过期' });

  const now = Date.now();
  if (now > sess.exp) {
    tokens.delete(token);
    return res.status(401).json({ message: '登录已过期，请重新登录' });
  }
  if (now - sess.last > IDLE_TTL) {
    tokens.delete(token);
    return res.status(401).json({ message: '长时间未操作，登录已过期，请重新登录' });
  }
  sess.last = now;

  // 每次请求实时校验角色与启用状态（改角色/停用后即时生效）
  const fresh = db.prepare('SELECT id,username,real_name,role,active FROM users WHERE id=?').get(sess.info.id);
  if (!fresh || fresh.active === 0) {
    tokens.delete(token);
    return res.status(403).json({ message: '账号不可用，请联系管理员' });
  }
  req.user = { id: fresh.id, username: fresh.username, real_name: fresh.real_name, role: fresh.role };
  req.token = token;
  next();
}

/** 登出：销毁服务端会话（仅清 localStorage 不会让 token 失效） */
function logout(req, res) {
  if (req.token) tokens.delete(req.token);
  res.json({ ok: 1, message: '已安全退出' });
}

/** 定期清扫过期会话，避免 tokens 长期只增不减 */
const sweeper = setInterval(() => {
  const now = Date.now();
  for (const [t, s] of tokens) {
    if (now > s.exp || now - s.last > IDLE_TTL) tokens.delete(t);
  }
  for (const [k, s] of failState) if (s.until && s.until <= now) failState.delete(k);
  for (const [k, s] of ipState) if (now - s.windowStart >= IP_WINDOW_MS) ipState.delete(k);
}, SWEEP_INTERVAL);
if (sweeper.unref) sweeper.unref();

/** 仅管理员可通过（挂在需要管理员权限的路由上） */
function requireAdmin(req, res, next) {
  if (req.user.role !== '管理员') {
    return res.status(403).json({ message: '权限不足，该操作仅管理员可执行' });
  }
  next();
}

function me(req, res) {
  res.json(req.user);
}

/** 用户自助修改密码：需验证原密码 */
function changePassword(req, res) {
  const { old_password, new_password } = req.body || {};
  if (!old_password || !new_password) return res.status(400).json({ message: '请输入原密码和新密码' });
  if (new_password.length < 6) return res.status(400).json({ message: '新密码至少6位' });
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  if (!user) return res.status(404).json({ message: '用户不存在' });
  if (!verifyPassword(old_password, user.password)) return res.status(400).json({ message: '原密码错误' });
  if (old_password === new_password) return res.status(400).json({ message: '新密码不能与原密码相同' });
  db.prepare('UPDATE users SET password=? WHERE id=?').run(hashPassword(new_password), req.user.id);
  res.json({ ok: 1, message: '密码修改成功' });
}

module.exports = { login, requireAuth, requireAdmin, me, changePassword, logout };
