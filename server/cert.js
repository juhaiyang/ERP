/**
 * 自签名 HTTPS 证书管理
 * - 首次使用自动生成证书（含 SAN: localhost / 127.0.0.1 / 本机局域网 IP）
 * - 证书存在且剩余有效期 > 30 天时直接复用，避免每次启动重生成
 * - 证书文件存放在项目根目录的 certs/ 下
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { X509Certificate } = require('crypto');
const selfsigned = require('selfsigned');

const CERT_DIR = path.join(__dirname, '..', 'certs');
const CERT_PATH = path.join(CERT_DIR, 'server.crt');
const KEY_PATH = path.join(CERT_DIR, 'server.key');

/** 获取本机所有非回环 IPv4 地址（用于写入证书 SAN） */
function getLanIPs() {
  const ips = [];
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        ips.push(net.address);
      }
    }
  }
  return ips;
}

/** 生成自签名证书并写入文件 */
function generateCert() {
  fs.mkdirSync(CERT_DIR, { recursive: true });
  const ips = getLanIPs();
  const altNames = [
    { type: 2, value: 'localhost' },        // DNS: localhost
    { type: 7, ip: '127.0.0.1' },           // IP: 127.0.0.1
    ...ips.map(ip => ({ type: 7, ip }))     // 本机局域网 IP
  ];
  const attrs = [{ name: 'commonName', value: 'SWC-ERP' }];
  const pems = selfsigned.generate(attrs, {
    keySize: 2048,
    days: 3650,                // 有效期 10 年
    algorithm: 'sha256',
    extensions: [
      { name: 'basicConstraints', cA: true },
      {
        name: 'keyUsage',
        keyCertSign: true,
        digitalSignature: true,
        nonRepudiation: true,
        keyEncipherment: true,
        dataEncipherment: true
      },
      { name: 'extKeyUsage', serverAuth: true, clientAuth: true },
      { name: 'subjectAltName', altNames }
    ]
  });
  fs.writeFileSync(CERT_PATH, pems.cert);
  fs.writeFileSync(KEY_PATH, pems.private);
  console.log(`[证书] 已生成自签名证书，SAN 包含: localhost, 127.0.0.1${ips.length ? ', ' + ips.join(', ') : ''}`);
  return { key: pems.private, cert: pems.cert };
}

/** 加载证书：存在且剩余有效期 > 30 天则复用，否则重新生成 */
function loadCert() {
  if (fs.existsSync(CERT_PATH) && fs.existsSync(KEY_PATH)) {
    try {
      const certPem = fs.readFileSync(CERT_PATH, 'utf8');
      const keyPem = fs.readFileSync(KEY_PATH, 'utf8');
      const cert = new X509Certificate(certPem);
      const daysLeft = (new Date(cert.validTo) - new Date()) / 86400000;
      if (daysLeft > 30) {
        return { key: keyPem, cert: certPem };
      }
      console.log(`[证书] 剩余有效期 ${Math.ceil(daysLeft)} 天，即将重新生成`);
    } catch (e) {
      console.log('[证书] 读取已有证书失败，重新生成:', e.message);
    }
  }
  return generateCert();
}

module.exports = { loadCert, CERT_PATH, KEY_PATH };
