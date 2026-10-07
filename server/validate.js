/**
 * 通用取值校验工具
 * 全系统的日期/数值/金额校验必须统一走这里，避免各模块各自实现导致规则漂移。
 *   - 日期：不仅要求 YYYY-MM-DD 格式，还要求日期在日历上真实存在（拦截 2026-02-30）
 *   - 数值：显式类型判断，拒绝布尔值、非数字字符串等被 SQLite 隐式转换的输入
 *   - 金额：统一保留两位小数比较，避免浮点误差造成"看似相等其实不等"
 */
const { db } = require('./db');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 是否为真实存在的日历日期 */
function isDate(v) {
  if (v === null || v === undefined) return false;
  if (typeof v === 'object') return false;
  const s = String(v);
  if (!DATE_RE.test(s)) return false;
  const y = Number(s.slice(0, 4));
  const m = Number(s.slice(5, 7));
  const d = Number(s.slice(8, 10));
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  // 2026-02-30 会被 Date 归一化为 3 月 2 日，必须回读比对
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** 值是否为空（未填写） */
function isMissing(v) {
  return v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
}

/** 空值归一为 null */
function norm(v) { return isMissing(v) ? null : v; }

/**
 * 转为数字：空值返回 null，非数字返回 NaN。
 * 显式拒绝布尔与对象：Number(true)=1、Number([])=0 会绕过数值校验被 SQLite 隐式转换写入。
 */
function toNum(v) {
  if (isMissing(v)) return null;
  if (typeof v === 'boolean' || typeof v === 'object') return NaN;
  return Number(v);
}

/** 严格数值判断（拒绝 true / 'abc' / null） */
function isNum(n) { return typeof n === 'number' && Number.isFinite(n); }

/** 金额比较用：统一两位小数，规避浮点误差 */
function money(n) { return Math.round(Number(n) * 100) / 100; }

/**
 * 从请求体中抽取指定字段。
 * 这是"部分字段更新"的唯一正确写法：只更新请求体中真正出现的字段，
 * 未提交的字段保持原值（早期 plans/progress 模块把未提交字段置 NULL，会导致数据被静默清空）。
 * @returns {{row:Object, keys:string[]}} row 为归一化后的待写值，keys 为实际出现的字段名
 */
function pick(body, fields) {
  const b = (body && typeof body === 'object' && !Array.isArray(body)) ? body : {};
  const row = {};
  const keys = [];
  for (const f of fields) {
    if (b[f] === undefined) continue;
    row[f] = norm(b[f]);
    keys.push(f);
  }
  return { row, keys };
}

/**
 * 执行部分字段更新，返回影响行数。
 * table / idField 由调用方传入常量，keys 来自 pick()，不拼接触发外部输入。
 */
function patchRow(table, idField, id, row, keys) {
  if (!keys.length) return 0;
  const sql = `UPDATE ${table} SET ${keys.map(k => `${k}=?`).join(',')} WHERE ${idField}=?`;
  return db.prepare(sql).run(...keys.map(k => row[k]), id).changes;
}

/** 服务端当前日期 */
function today() {
  return db.prepare("SELECT date('now','localtime') d").get().d;
}

module.exports = { db, DATE_RE, isDate, isMissing, norm, toNum, isNum, money, pick, patchRow, today };
