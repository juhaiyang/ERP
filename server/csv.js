/**
 * CSV 导出工具：将数据行转换为带 BOM 的 CSV 字符串（Excel 可直接打开中文）
 * columns: [{ key, label }]
 */
function toCSV(rows, columns) {
  const escape = v => {
    if (v === null || v === undefined) return '';
    let s = String(v).replace(/\r?\n/g, ' ');
    if (/[",]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
    return s;
  };
  const header = columns.map(c => escape(c.label)).join(',');
  const body = rows.map(r => columns.map(c => escape(r[c.key])).join(',')).join('\r\n');
  // UTF-8 BOM 让 Excel 正确识别中文
  return '\uFEFF' + header + '\r\n' + body;
}

/** 发送 CSV 下载响应 */
function sendCSV(res, filename, rows, columns) {
  const csv = toCSV(rows, columns);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}.csv"`);
  res.send(csv);
}

module.exports = { toCSV, sendCSV };
