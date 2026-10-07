/* 全局常量与请求封装 */
/* 统一解构 Vue 组合式 API，供所有视图脚本使用（经典脚本共享全局词法作用域） */
const { ref, reactive, computed, watch, onMounted, onBeforeUnmount, nextTick } = Vue;

/* ---------- 权限工具（所有页面统一使用，避免各处自行判断角色） ---------- */
window.currentUser = function () {
  try { return JSON.parse(localStorage.getItem('swc_user') || '{}'); } catch { return {}; }
};
window.isAdmin = function () { return currentUser().role === '管理员'; };
/** 员工提交修改 → 走变更申请；管理员直接改 */
window.submitChange = function (targetType, targetId, payload) {
  return http.post('/change-requests', { target_type: targetType, target_id: targetId, payload });
};
/** 变更申请数量变化时通知菜单徽标刷新 */
window.notifyCrChanged = function () { window.dispatchEvent(new Event('cr-changed')); };
/**
 * 保存成功后的统一提示：后端返回 warnings（软警告）时以 warning 样式展示，
 * 既允许保存合理业务数据（如监理合同收尾期超出项目工期），又保证偏差不被静默忽略。
 */
window.notifySave = function (resp, okText) {
  if (resp && Array.isArray(resp.warnings) && resp.warnings.length) {
    ElementPlus.ElMessage.warning(okText + '，请注意：' + resp.warnings.join('；'));
  } else {
    ElementPlus.ElMessage.success(okText);
  }
};

/**
 * 导出 CSV：带 Bearer Token 下载，兼容鉴权接口
 * @param {string} url  相对 /api 的路径，如 '/projects?status=施工中&export=csv'
 * @param {string} filename 下载文件名（不含扩展名）
 */
window.exportCSV = function (url, filename) {
  const token = localStorage.getItem('swc_token');
  return fetch('/api' + url, { headers: { Authorization: 'Bearer ' + token } })
    .then(r => {
      if (!r.ok) return r.json().then(e => { throw new Error(e.message || '导出失败'); });
      return r.blob();
    })
    .then(blob => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = (filename || 'export') + '.csv';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(a.href);
      ElementPlus.ElMessage.success('导出成功');
    })
    .catch(e => ElementPlus.ElMessage.error(e.message || '导出失败'));
};

window.CFG = {
  projectTypes: ['小流域综合治理', '坡耕地整治', '淤地坝工程', '生态清洁小流域', '水土保持监测', '淤地坝除险加固', '其他'],
  projectStatuses: ['筹备中', '招标中', '施工中', '已完工', '已验收', '暂停'],
  bidMethods: ['公开招标', '邀请招标', '竞争性谈判', '直接委托'],
  bidStatuses: ['草稿', '报名中', '已开标', '已评标', '已定标', '已终止'],
  contractStatuses: ['待签订', '履行中', '已完成', '已终止'],
  payStages: ['预付款', '进度款', '结算款', '质保金'],
  taskStatuses: ['未开始', '进行中', '已完成', '已延期'],
  milestoneStatuses: ['未开始', '进行中', '已完成'],
  planStatuses: ['编制中', '执行中', '已完成', '已调整']
};

window.tagType = function (val, map) {
  const m = map || {
    '筹备中': 'info', '招标中': 'warning', '施工中': 'primary', '已完工': 'success', '已验收': 'success', '暂停': 'danger',
    '草稿': 'info', '报名中': 'warning', '已开标': 'primary', '已评标': 'primary', '已定标': 'success', '已终止': 'danger',
    '待签订': 'warning', '履行中': 'primary', '已完成': 'success', '已终止': 'danger',
    '未开始': 'info', '进行中': 'primary', '已完成': 'success', '已延期': 'danger',
    '编制中': 'info', '执行中': 'primary', '已调整': 'warning'
  };
  return m[val] || 'info';
};

const service = axios.create({ baseURL: '/api', timeout: 15000 });
service.interceptors.request.use(cfg => {
  const token = localStorage.getItem('swc_token');
  if (token) cfg.headers.Authorization = 'Bearer ' + token;
  return cfg;
});
service.interceptors.response.use(
  resp => resp.data,
  err => {
    const status = err.response && err.response.status;
    const msg = (err.response && err.response.data && err.response.data.message) || err.message;
    if (status === 401) {
      localStorage.removeItem('swc_token');
      localStorage.removeItem('swc_user');
      if (location.hash !== '#/login') location.hash = '#/login';
    } else {
      ElementPlus.ElMessage.error(msg || '请求失败');
    }
    return Promise.reject(err);
  }
);
window.http = service;
