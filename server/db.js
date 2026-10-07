/**
 * 数据库层：基于 Node 内置 SQLite（node:sqlite）
 * 首次启动自动建表并写入演示数据
 */
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'swc.db'));
db.exec('PRAGMA foreign_keys = ON;');
db.exec('PRAGMA busy_timeout = 5000;');

/**
 * 口令哈希：scrypt + 每用户随机盐（格式 scrypt$salt$hash）。
 * 早期版本使用固定盐的 sha256，verifyPassword 兼容校验旧值，用户下次改密时自动升级。
 */
function hashPassword(pwd) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(pwd), salt, 32).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

/** 校验口令：兼容历史 sha256 格式（固定盐），新格式走 scrypt 定时安全比较 */
function verifyPassword(pwd, stored) {
  if (typeof stored !== 'string' || !stored) return false;
  if (stored.startsWith('scrypt$')) {
    const [, salt, hash] = stored.split('$');
    if (!salt || !hash) return false;
    const calc = crypto.scryptSync(String(pwd), salt, 32).toString('hex');
    const a = Buffer.from(calc, 'hex');
    const b = Buffer.from(hash, 'hex');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }
  // 旧格式回退：sha256('swc#' + pwd)
  const legacy = crypto.createHash('sha256').update('swc#' + pwd).digest('hex');
  const a = Buffer.from(legacy, 'hex');
  const b = Buffer.from(stored, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** 是否为需升级的历史弱哈希 */
function isLegacyHash(stored) {
  return typeof stored === 'string' && stored.length === 64 && !stored.startsWith('scrypt$');
}

/**
 * 事务包装：node:sqlite 无 transaction() API，统一用 BEGIN/COMMIT/ROLLBACK。
 * 支持嵌套调用（内层复用外层事务，不重复 BEGIN）。
 */
let txDepth = 0;
function tx(fn) {
  if (txDepth > 0) return fn();
  txDepth++;
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch { /* 回滚失败时保留原始异常 */ }
    throw e;
  } finally {
    txDepth--;
  }
}

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  real_name TEXT,
  role TEXT DEFAULT '业务员',
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,              -- 项目编号
  name TEXT NOT NULL,                     -- 项目名称
  type TEXT NOT NULL,                     -- 项目类型
  location TEXT,                          -- 建设地点
  owner TEXT,                             -- 建设单位
  manager TEXT,                           -- 项目负责人
  phone TEXT,                             -- 联系电话
  budget REAL DEFAULT 0,                  -- 总投资（万元）
  start_date TEXT,                        -- 计划开工
  end_date TEXT,                          -- 计划完工
  status TEXT DEFAULT '筹备中',
  description TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS bids (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  bid_no TEXT,                            -- 招标编号
  title TEXT NOT NULL,                    -- 招标项目名称
  method TEXT DEFAULT '公开招标',          -- 招标方式
  budget REAL DEFAULT 0,                  -- 招标控制价（万元）
  publish_date TEXT,                      -- 发布日期
  signup_deadline TEXT,                   -- 报名截止
  bid_open_date TEXT,                     -- 开标日期
  agency TEXT,                            -- 招标代理机构
  winner TEXT,                            -- 中标单位
  win_amount REAL,                        -- 中标金额
  content TEXT,                           -- 招标内容
  status TEXT DEFAULT '草稿',
  created_at TEXT DEFAULT (datetime('now','localtime')),
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS contracts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  bid_id INTEGER,
  contract_no TEXT,
  name TEXT NOT NULL,
  party_a TEXT,                           -- 甲方（发包人）
  party_b TEXT,                           -- 乙方（承包人）
  amount REAL DEFAULT 0,                  -- 合同金额（万元）
  sign_date TEXT,
  start_date TEXT,
  end_date TEXT,
  status TEXT DEFAULT '待签订',
  content TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY(bid_id) REFERENCES bids(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS contract_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contract_id INTEGER NOT NULL,
  amount REAL NOT NULL,                   -- 付款金额（万元）
  pay_date TEXT,
  stage TEXT,                             -- 付款阶段（预付款/进度款/结算款/质保金）
  note TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  FOREIGN KEY(contract_id) REFERENCES contracts(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS progress_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  record_date TEXT NOT NULL,              -- 填报日期
  period TEXT,                            -- 报告期，如 2026年第3季度 / 2026年9月
  percent INTEGER DEFAULT 0,              -- 累计完成百分比
  work_done TEXT,                         -- 本期完成工作
  issues TEXT,                            -- 存在问题
  next_plan TEXT,                         -- 下期计划
  reporter TEXT,                          -- 填报人
  created_at TEXT DEFAULT (datetime('now','localtime')),
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS milestones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  name TEXT NOT NULL,                     -- 里程碑名称
  plan_date TEXT,
  actual_date TEXT,
  status TEXT DEFAULT '未开始',
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  year INTEGER,                           -- 计划年度
  start_date TEXT,
  end_date TEXT,
  owner TEXT,                             -- 编制人/负责人
  status TEXT DEFAULT '编制中',
  description TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS plan_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  owner TEXT,
  weight REAL DEFAULT 0,                  -- 权重（%）
  start_date TEXT,
  end_date TEXT,
  actual_start TEXT,
  actual_end TEXT,
  status TEXT DEFAULT '未开始',
  remark TEXT,
  FOREIGN KEY(plan_id) REFERENCES plans(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_bids_project ON bids(project_id);
CREATE INDEX IF NOT EXISTS idx_contracts_project ON contracts(project_id);
CREATE INDEX IF NOT EXISTS idx_progress_project ON progress_records(project_id);
CREATE INDEX IF NOT EXISTS idx_milestones_project ON milestones(project_id);
CREATE INDEX IF NOT EXISTS idx_plans_project ON plans(project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_plan ON plan_tasks(plan_id);

CREATE TABLE IF NOT EXISTS change_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  target_type TEXT NOT NULL,          -- project/bid/contract/progress_record/milestone/plan/task
  target_id INTEGER NOT NULL,
  action TEXT DEFAULT 'update',       -- update / delete
  target_name TEXT,                   -- 提交时对象名称快照
  payload TEXT,                       -- 申请生效的新数据 JSON
  old_data TEXT,                      -- 提交时原始数据快照 JSON
  changes TEXT,                       -- 变更字段明细 JSON: [{field,label,old,new}]
  status TEXT DEFAULT 'pending',      -- pending/approved/rejected
  submitted_by INTEGER,
  submitted_by_name TEXT,
  submitted_at TEXT DEFAULT (datetime('now','localtime')),
  reviewed_by TEXT,
  reviewed_at TEXT,
  review_comment TEXT
);
CREATE INDEX IF NOT EXISTS idx_cr_status ON change_requests(status);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,                      -- 操作人ID（未登录操作如登录失败时为空）
  username TEXT,                        -- 操作人账号快照
  real_name TEXT,                       -- 操作人姓名快照
  action TEXT NOT NULL,                 -- 操作类型：登录/登出/新增/修改/删除/审批/其他
  module TEXT NOT NULL,                 -- 业务模块：认证/项目/招标/合同/进度/计划/审批/用户/统计
  target TEXT,                          -- 操作对象描述（如"项目 #5 青龙河项目"）
  method TEXT,                          -- HTTP方法
  path TEXT,                            -- 请求路径
  status_code INTEGER,                  -- 响应状态码（用于甄别失败操作）
  ip TEXT,                              -- 来源IP
  detail TEXT,                          -- 请求内容摘要JSON（密码等敏感字段已脱敏）
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_module ON audit_logs(module);
CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_logs(username);

CREATE TABLE IF NOT EXISTS attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  module TEXT NOT NULL,                -- 所属模块：project/bid/contract/progress/plan
  target_id INTEGER NOT NULL,          -- 所属业务对象ID
  filename TEXT NOT NULL,              -- 原始文件名
  stored_name TEXT NOT NULL,           -- 存储文件名（UUID）
  size INTEGER DEFAULT 0,              -- 文件大小（字节）
  mime TEXT,                           -- MIME类型
  uploaded_by INTEGER,                 -- 上传人ID
  uploaded_by_name TEXT,               -- 上传人姓名
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_att_target ON attachments(module, target_id);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,            -- 接收用户ID
  type TEXT DEFAULT 'info',            -- info/success/warning/danger
  title TEXT NOT NULL,                 -- 通知标题
  content TEXT,                        -- 通知内容
  link TEXT,                           -- 跳转链接
  is_read INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, is_read);

CREATE TABLE IF NOT EXISTS system_settings (
  key TEXT PRIMARY KEY,
  value TEXT,
  description TEXT,
  updated_at TEXT DEFAULT (datetime('now','localtime'))
);
`);

/* 轻量幂等迁移：老库补字段 */
function columnExists(table, col) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === col);
}
if (!columnExists('users', 'active')) {
  db.exec('ALTER TABLE users ADD COLUMN active INTEGER DEFAULT 1');
}

function seed() {
  const cnt = db.prepare('SELECT COUNT(*) AS c FROM users').get();
  if (cnt.c > 0) return;

  const insUser = db.prepare('INSERT INTO users(username,password,real_name,role) VALUES(?,?,?,?)');
  insUser.run('admin', hashPassword('123456'), '系统管理员', '管理员');
  insUser.run('zhangs', hashPassword('123456'), '张建国', '项目经理');
  insUser.run('liuy', hashPassword('123456'), '刘雅婷', '业务员');

  const P = db.prepare(`INSERT INTO projects(code,name,type,location,owner,manager,phone,budget,start_date,end_date,status,description)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`);
  const projects = [
    ['SWC-2026-001', '青龙河小流域水土流失综合治理工程', '小流域综合治理', '甘肃省庆阳市青龙河流域', '庆阳市水务局', '张建国', '13909340001', 3280.0, '2026-03-01', '2027-10-31', '施工中',
      '治理水土流失面积36.5km²，含坡改梯、水保林、经果林、封育治理、谷坊及塘堰整治等措施。'],
    ['SWC-2026-002', '董志塬坡耕地水土流失综合治理项目', '坡耕地整治', '甘肃省庆阳市西峰区', '西峰区水土保持管理局', '李茂才', '13909340002', 1860.0, '2026-04-15', '2027-06-30', '施工中',
      '坡耕地梯田改造8200亩，配套田间道路与排水系统，新建蓄水池12座。'],
    ['SWC-2026-003', '王家沟淤地坝除险加固工程', '淤地坝工程', '陕西省延安市安塞区', '安塞区水土保持工作队', '王海涛', '13909340003', 940.0, '2026-05-20', '2026-12-20', '招标中',
      '对3座病险淤地坝进行坝体加固、溢洪道改造及放水设施维修。'],
    ['SWC-2026-004', '溪源镇生态清洁小流域建设工程', '生态清洁小流域', '浙江省杭州市临安区', '临安区水利水电局', '陈雨薇', '13909340004', 2560.0, '2026-06-01', '2027-12-31', '筹备中',
      '围绕溪源溪建设生态护岸、人工湿地、村落污水治理及生态涵养林，打造清洁小流域示范。'],
    ['SWC-2025-018', '银昆高速宁东段水土保持监测项目', '水土保持监测', '宁夏吴忠市', '宁夏交通建设有限公司', '刘雅婷', '13909340005', 320.0, '2025-09-01', '2026-12-31', '施工中',
      '对高速公路建设全过程开展扰动土地、弃土弃渣及水土保持措施监测，按季度提交监测报告。']
  ];
  projects.forEach(p => P.run(...p));

  const B = db.prepare(`INSERT INTO bids(project_id,bid_no,title,method,budget,publish_date,signup_deadline,bid_open_date,agency,winner,win_amount,content,status)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  B.run(1, 'QY-SWC-2026-003', '青龙河小流域综合治理工程施工标段', '公开招标', 2650.0, '2026-01-20', '2026-02-10', '2026-02-18', '甘肃中水招标有限公司', '甘肃长河水利水电工程有限公司', 2586.5,
    '坡改梯1560亩、水保林1.2万亩、谷坊28座、护岸3.2km及配套设施施工', '已定标');
  B.run(1, 'QY-SWC-2026-004', '青龙河小流域综合治理工程监理服务', '公开招标', 86.0, '2026-01-22', '2026-02-12', '2026-02-20', '甘肃中水招标有限公司', '兰州河海工程监理有限公司', 81.8,
    '施工阶段全过程质量、进度、投资及水土保持措施监理', '已定标');
  B.run(2, 'XF-SWC-2026-002', '董志塬坡耕地治理项目施工', '公开招标', 1520.0, '2026-03-05', '2026-03-20', '2026-03-27', '庆阳鑫诚项目管理公司', '庆阳塬上建设工程有限公司', 1488.0,
    '梯田改造8200亩、田间道路18km、蓄水池12座', '已定标');
  B.run(3, 'AS-SWC-2026-007', '王家沟淤地坝除险加固工程施工', '公开招标', 780.0, '2026-09-25', '2026-10-15', '2026-10-22', '陕西恒瑞招标代理公司', null, null,
    '坝体加固、溢洪道改扩建、放水涵洞维修及监测设施安装', '报名中');
  B.run(4, 'LA-SWC-2026-011', '溪源镇生态清洁小流域勘察设计', '邀请招标', 130.0, '2026-08-10', '2026-08-25', '2026-08-30', '杭州临安工程咨询公司', '浙江水韵勘测设计研究院', 124.6,
    '初步设计、施工图设计及水土保持方案编制', '已定标');

  const C = db.prepare(`INSERT INTO contracts(project_id,bid_id,contract_no,name,party_a,party_b,amount,sign_date,start_date,end_date,status,content)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`);
  C.run(1, 1, 'HT-QGH-2026-008', '青龙河小流域综合治理工程施工合同', '庆阳市水务局', '甘肃长河水利水电工程有限公司', 2586.5, '2026-02-28', '2026-03-01', '2027-10-31', '履行中',
      '按招标文件及施工图完成全部治理措施施工');
  C.run(1, 2, 'HT-QGH-2026-009', '青龙河小流域综合治理工程监理合同', '庆阳市水务局', '兰州河海工程监理有限公司', 81.8, '2026-03-02', '2026-03-05', '2027-11-15', '履行中',
      '施工全过程监理服务');
  C.run(2, 3, 'HT-DZY-2026-015', '董志塬坡耕地治理项目施工合同', '西峰区水土保持管理局', '庆阳塬上建设工程有限公司', 1488.0, '2026-04-10', '2026-04-15', '2027-06-30', '履行中',
      '坡耕地梯田改造及配套工程施工');
  C.run(4, 5, 'HT-XYZ-2026-021', '溪源镇生态清洁小流域勘察设计合同', '临安区水利水电局', '浙江水韵勘测设计研究院', 124.6, '2026-09-05', '2026-09-10', '2027-01-20', '履行中',
      '初步设计、施工图设计');
  C.run(5, null, 'HT-YK-2025-031', '银昆高速宁东段水土保持监测服务合同', '宁夏交通建设有限公司', '西北绿洲水土保持监测有限公司', 298.0, '2025-08-25', '2025-09-01', '2026-12-31', '履行中',
      '建设期水土保持监测，季度报告+总结报告');

  const Pay = db.prepare('INSERT INTO contract_payments(contract_id,amount,pay_date,stage,note) VALUES(?,?,?,?,?)');
  Pay.run(1, 517.3, '2026-03-10', '预付款', '合同额20%预付款');
  Pay.run(1, 388.0, '2026-07-15', '进度款', '上半年进度款');
  Pay.run(2, 16.4, '2026-04-10', '预付款', '合同额20%');
  Pay.run(3, 297.6, '2026-05-06', '预付款', '合同额20%');
  Pay.run(3, 260.0, '2026-09-20', '进度款', '三季度进度款');
  Pay.run(5, 89.4, '2025-10-15', '预付款', '合同额30%');
  Pay.run(5, 74.5, '2026-04-20', '进度款', '上半年监测服务费');

  const R = db.prepare(`INSERT INTO progress_records(project_id,record_date,period,percent,work_done,issues,next_plan,reporter)
    VALUES(?,?,?,?,?,?,?,?)`);
  R.run(1, '2026-06-28', '2026年第2季度', 32, '完成坡改梯620亩、水保林4800亩、谷坊11座、护岸1.1km；监理同步跟进。', '部分沟道施工道路受雨水冲毁，需修复后才能进料。', '推进坡改梯剩余工程，完成谷坊18座，种植水保林至9000亩。', '张建国');
  R.run(1, '2026-09-25', '2026年第3季度', 48, '完成坡改梯1180亩、水保林8600亩、经果林1200亩、谷坊20座、护岸2.0km。', '水保林苗木秋浇用水紧张，已协调乡镇拉水保灌。', '秋栽水保林3400亩，完成护岸至3.2km，推进塘堰整治。', '张建国');
  R.run(2, '2026-09-26', '2026年第3季度', 41, '完成梯田改造3500亩、田间道路7.8km、蓄水池4座。', '梯田区征占地协调缓慢，影响两个工区展开。', '新开辟2个工区，道路施工至12km，蓄水池再建4座。', '李茂才');
  R.run(5, '2026-09-30', '2026年第3季度', 68, '完成3个季度监测报告，布设监测点18处，完成弃渣场拦挡与植被恢复复测。', 'K112弃渣场截排水沟存在淤堵，已发整改通知。', '跟踪弃渣场整改，开展第4季度监测，准备年度报告。', '刘雅婷');

  const M = db.prepare('INSERT INTO milestones(project_id,name,plan_date,actual_date,status) VALUES(?,?,?,?,?)');
  M.run(1, '工程开工', '2026-03-01', '2026-03-01', '已完成');
  M.run(1, '坡改梯工程完工', '2026-12-31', null, '进行中');
  M.run(1, '水保林草措施完工', '2027-06-30', null, '未开始');
  M.run(1, '竣工验收', '2027-10-31', null, '未开始');
  M.run(2, '梯田改造过半', '2026-10-31', null, '进行中');
  M.run(2, '主体工程完工', '2027-06-30', null, '未开始');
  M.run(3, '开标定标', '2026-10-22', null, '未开始');
  M.run(3, '主体完工', '2026-12-20', null, '未开始');
  M.run(5, '监测总结报告', '2026-12-31', null, '进行中');

  const PL = db.prepare(`INSERT INTO plans(project_id,name,year,start_date,end_date,owner,status,description)
    VALUES(?,?,?,?,?,?,?,?)`);
  PL.run(1, '青龙河项目2026年度施工计划', 2026, '2026-03-01', '2026-12-31', '张建国', '执行中', '2026年度坡改梯、林草及沟道工程施工安排');
  PL.run(2, '董志塬项目2026年度施工计划', 2026, '2026-04-15', '2026-12-31', '李茂才', '执行中', '梯田改造及配套设施年度计划');
  PL.run(3, '王家沟淤地坝招标采购计划', 2026, '2026-09-20', '2026-11-15', '王海涛', '执行中', '招标、定标及合同签订节点计划');
  PL.run(4, '溪源镇项目前期工作计划', 2026, '2026-09-01', '2027-02-28', '陈雨薇', '执行中', '勘察设计、施工图及施工招标准备');

  const T = db.prepare(`INSERT INTO plan_tasks(plan_id,name,owner,weight,start_date,end_date,actual_start,actual_end,status,remark)
    VALUES(?,?,?,?,?,?,?,?,?,?)`);
  T.run(1, '施工准备及临建', '张建国', 5, '2026-03-01', '2026-03-20', '2026-03-01', '2026-03-18', '已完成', '');
  T.run(1, '坡改梯工程', '马建平', 30, '2026-03-21', '2026-12-31', '2026-03-22', null, '进行中', '已完成1180/1560亩');
  T.run(1, '水保林种植（春栽+秋栽）', '赵林山', 25, '2026-04-01', '2026-11-30', '2026-04-03', null, '进行中', '春栽完成，秋栽进行中');
  T.run(1, '谷坊及塘堰整治', '马建平', 20, '2026-05-01', '2027-04-30', '2026-05-06', null, '进行中', '已完成谷坊20座');
  T.run(1, '护岸工程', '孙克俭', 15, '2026-04-15', '2027-05-31', '2026-04-20', null, '进行中', '完成2.0/3.2km');
  T.run(1, '年度自查验收', '张建国', 5, '2026-12-15', '2026-12-31', null, null, '未开始', '');
  T.run(2, '施工准备', '李茂才', 5, '2026-04-15', '2026-05-05', '2026-04-15', '2026-05-02', '已完成', '');
  T.run(2, '梯田改造（一、二工区）', '周大勇', 45, '2026-05-06', '2026-12-20', '2026-05-08', null, '进行中', '3500/8200亩');
  T.run(2, '田间道路工程', '周大勇', 25, '2026-06-01', '2027-03-31', '2026-06-05', null, '进行中', '7.8/18km');
  T.run(2, '蓄水池及排水', '吴文清', 25, '2026-07-01', '2027-04-30', '2026-07-10', null, '进行中', '4/12座');
  T.run(3, '招标文件编制及备案', '王海涛', 20, '2026-09-20', '2026-09-30', '2026-09-21', '2026-09-30', '已完成', '');
  T.run(3, '发布公告及投标人报名', '王海涛', 25, '2026-09-25', '2026-10-15', '2026-09-25', null, '进行中', '报名中');
  T.run(3, '开标评标', '王海涛', 30, '2026-10-22', '2026-10-30', null, null, '未开始', '');
  T.run(3, '合同谈判及签订', '王海涛', 25, '2026-11-01', '2026-11-15', null, null, '未开始', '');
  T.run(4, '初步设计编制及评审', '陈雨薇', 30, '2026-09-10', '2026-11-30', '2026-09-12', null, '进行中', '');
  T.run(4, '施工图设计', '陈雨薇', 40, '2026-12-01', '2027-02-15', null, null, '未开始', '');
  T.run(4, '施工招标准备', '郑启航', 30, '2027-01-15', '2027-02-28', null, null, '未开始', '');
}

seed();

/* 轻量幂等数据修复：消除跨模块不一致的存量数据（每次启动执行，重复执行无副作用） */
function dataFixup() {
  // 1) change_requests 无外键，清理指向已删除业务对象的孤儿审批记录
  db.exec(`
    DELETE FROM change_requests WHERE target_type='project' AND target_id NOT IN (SELECT id FROM projects);
    DELETE FROM change_requests WHERE target_type='bid' AND target_id NOT IN (SELECT id FROM bids);
    DELETE FROM change_requests WHERE target_type='contract' AND target_id NOT IN (SELECT id FROM contracts);
    DELETE FROM change_requests WHERE target_type='progress_record' AND target_id NOT IN (SELECT id FROM progress_records);
    DELETE FROM change_requests WHERE target_type='milestone' AND target_id NOT IN (SELECT id FROM milestones);
    DELETE FROM change_requests WHERE target_type='plan' AND target_id NOT IN (SELECT id FROM plans);
    DELETE FROM change_requests WHERE target_type='task' AND target_id NOT IN (SELECT id FROM plan_tasks);
  `);

  // 2) 非法里程碑：已填实际完成日期但状态不是“已完成”（状态与日期矛盾）
  db.prepare(`DELETE FROM milestones
    WHERE COALESCE(actual_date,'')<>'' AND status<>'已完成'`).run();

  // 3) 空壳测试任务：无负责人/无日期/无权重的“会议评审”
  db.prepare(`DELETE FROM plan_tasks
    WHERE name='会议评审' AND COALESCE(owner,'')='' AND weight=0
      AND COALESCE(start_date,'')='' AND COALESCE(end_date,'')=''`).run();

  // 4) 修复历史空状态项目（早期接口允许缺省 status）
  db.prepare("UPDATE projects SET status='筹备中' WHERE status IS NULL OR status=''").run();

  // 5) 存量状态联动：已存在“履行中”合同的筹备/招标项目 → 施工中
  db.prepare(`UPDATE projects SET status='施工中'
    WHERE status IN ('筹备中','招标中')
      AND EXISTS (SELECT 1 FROM contracts c WHERE c.project_id=projects.id AND c.status='履行中')`).run();

  // 6) 为在建但无计划的种子项目（SWC-2025-018）补监测计划，任务完成度与进度填报对齐
  const p = db.prepare("SELECT id FROM projects WHERE code='SWC-2025-018'").get();
  if (p && db.prepare('SELECT COUNT(*) c FROM plans WHERE project_id=?').get(p.id).c === 0) {
    const info = db.prepare(`INSERT INTO plans(project_id,name,year,start_date,end_date,owner,status,description)
      VALUES(?,?,?,?,?,?,?,?)`)
      .run(p.id, '银昆高速宁东段监测项目2025-2026年度监测计划', 2026,
        '2025-09-01', '2026-12-31', '刘雅婷', '执行中',
        '按监测合同开展建设期全过程水土保持监测，分季度提交报告并完成总结验收');
    const T = db.prepare(`INSERT INTO plan_tasks(plan_id,name,owner,weight,start_date,end_date,actual_start,actual_end,status,remark)
      VALUES(?,?,?,?,?,?,?,?,?,?)`);
    T.run(info.lastInsertRowid, '监测方案编制与监测点位布设', '刘雅婷', 10,
      '2025-09-01', '2025-10-15', '2025-09-03', '2025-10-12', '已完成', '布设监测点18处');
    T.run(info.lastInsertRowid, '2025年度季度监测（4期）', '刘雅婷', 25,
      '2025-10-01', '2025-12-31', '2025-10-08', '2025-12-28', '已完成', '季报已提交');
    T.run(info.lastInsertRowid, '2026年前三季度监测', '刘雅婷', 30,
      '2026-01-01', '2026-09-30', '2026-01-10', '2026-09-28', '已完成', '三期季报已提交');
    T.run(info.lastInsertRowid, '第四季度监测及年度报告', '刘雅婷', 20,
      '2026-10-01', '2026-12-15', '2026-10-02', null, '进行中', '');
    T.run(info.lastInsertRowid, '监测总结报告与验收', '刘雅婷', 15,
      '2026-11-15', '2026-12-31', null, null, '未开始', '');
  }
}
dataFixup();

/* 演示用：若变更申请为空，写入一条待审批申请（工期顺延申请），便于体验审批流程 */
function seedChangeRequest() {
  const c = db.prepare('SELECT COUNT(*) c FROM change_requests').get();
  if (c.c > 0) return;
  const p = db.prepare("SELECT * FROM projects WHERE code='SWC-2026-001'").get();
  const u = db.prepare("SELECT id, real_name FROM users WHERE username='liuy'").get();
  if (!p || !u) return;
  const oldRow = { ...p };
  const payload = { ...p, end_date: '2027-11-30',
    description: (p.description || '') + '（申请：因秋季造林季节延后，完工日期顺延一个月）' };
  const changes = [
    { field: 'end_date', label: '完工日期', old: oldRow.end_date, new: payload.end_date },
    { field: 'description', label: '项目概况', old: oldRow.description, new: payload.description }
  ];
  db.prepare(`INSERT INTO change_requests
    (target_type,target_id,action,target_name,payload,old_data,changes,status,submitted_by,submitted_by_name)
    VALUES(?,?,?,?,?,?,?,?,?,?)`)
    .run('project', p.id, 'update', p.name,
      JSON.stringify(payload), JSON.stringify(oldRow), JSON.stringify(changes),
      'pending', u.id, u.real_name);
}
seedChangeRequest();

/* 系统设置默认值（仅首次写入） */
function seedSettings() {
  const defaults = [
    ['company_name', '水土保持项目管理平台', '平台名称'],
    ['max_upload_mb', '20', '单文件上传大小限制(MB)'],
    ['backup_retention_days', '14', '备份保留天数']
  ];
  const ins = db.prepare(`INSERT OR IGNORE INTO system_settings(key,value,description) VALUES(?,?,?)`);
  defaults.forEach(([k, v, d]) => ins.run(k, v, d));
}
seedSettings();

module.exports = { db, hashPassword, verifyPassword, isLegacyHash, tx };
