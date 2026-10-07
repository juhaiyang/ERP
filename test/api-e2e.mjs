/**
 * 水土保持项目管理系统 API 综合测试
 * 运行：node test/api-e2e.mjs   （需先启动服务 npm start）
 * 使用 Node 内置 fetch，无额外依赖；测试数据自动清理
 */
const BASE = process.env.BASE || 'http://localhost:3000';
let pass = 0, fail = 0;
const failures = [];
const created = { projects: [], crIds: [], userIds: [] };

function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; failures.push({ name, detail }); console.log(`  FAIL  ${name}  ->  ${detail ?? ''}`); }
}
async function api(token, method, path, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  const resp = await fetch(BASE + '/api' + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  let data = null;
  try { data = await resp.json(); } catch {}
  return { status: resp.status, data };
}
const login = (u, p) => api(null, 'POST', '/login', { username: u, password: p });
const listOf = (d) => Array.isArray(d) ? d : (d.list || d.items || []);
const findMark = (resp, mark) => {
  const arr = listOf(resp?.data);
  return arr.find(r => JSON.stringify(r).includes(mark));
};

async function main() {
  console.log(`\n===== 水土保持项目管理系统 API 综合测试  BASE=${BASE} =====\n`);

  // 记录测试开始前的审计日志最大ID，便于测试结束后清理本次产生的日志
  const { DatabaseSync } = await import('node:sqlite');
  const tdb = new DatabaseSync(new URL('../data/swc.db', import.meta.url).pathname.replace(/^\/([A-Za-z]):/, '$1:'));
  tdb.exec('PRAGMA busy_timeout=8000'); // 与运行中的服务并发写时等待锁，避免 database is locked
  const maxAuditId = tdb.prepare('SELECT COALESCE(MAX(id),0) m FROM audit_logs').get().m;

  /* ---------- S1 认证与登录 ---------- */
  console.log('--- S1 认证与登录 ---');
  const la = await login('admin', '123456');
  check('admin 登录成功', la.status === 200 && la.data.token, `status=${la.status}`);
  const A = la.data.token;
  const lz = await login('zhangs', '123456');
  check('zhangs(项目经理) 登录成功', lz.status === 200 && lz.data.token, `status=${lz.status}`);
  const Z = lz.data.token;
  const ll = await login('liuy', '123456');
  check('liuy(业务员) 登录成功', ll.status === 200 && ll.data.token, `status=${ll.status}`);
  const L = ll.data.token;
  check('登录返回角色信息', la.data.user?.role === '管理员' && ll.data.user?.role === '业务员', JSON.stringify(la.data.user || {}));

  const w1 = await login('admin', 'wrong-password');
  check('错误密码被拒绝', w1.status >= 400 && w1.status < 500, `status=${w1.status}`);
  const w2 = await login('no_such_user', '123456');
  check('不存在用户被拒绝', w2.status >= 400 && w2.status < 500, `status=${w2.status}`);
  const w3 = await api(null, 'POST', '/login', { username: '', password: '' });
  check('空用户名密码返回400', w3.status === 400, `status=${w3.status}`);
  const w4 = await login("' OR '1'='1' --", 'whatever');
  check('SQL注入登录被拒绝', w4.status >= 400, `status=${w4.status} body=${JSON.stringify(w4.data)}`);

  const t1 = await api(null, 'GET', '/projects');
  check('无token访问业务接口401', t1.status === 401, `status=${t1.status}`);
  const t2 = await api('garbage.token.xxx', 'GET', '/projects');
  check('伪造token访问401', t2.status === 401, `status=${t2.status}`);
  const t3 = await api(A, 'GET', '/me');
  check('GET /me 返回当前用户', t3.status === 200 && t3.data.username === 'admin', JSON.stringify(t3.data || {}));

  /* ---------- S2 项目 CRUD 与校验 ---------- */
  console.log('--- S2 项目 CRUD 与校验 ---');
  const MK0 = 'TST-P0-' + Date.now();
  const p_miss = await api(A, 'POST', '/projects', { code: MK0 });
  check('缺少名称创建项目400', p_miss.status === 400, `status=${p_miss.status}`);
  const p_dupCode = (await api(A, 'GET', '/projects?pageSize=1')).data.list?.[0]?.code || 'SWC-2026-001';
  const p_dup = await api(A, 'POST', '/projects', { code: p_dupCode, name: '重复编号测试' });
  check('重复项目编号400', p_dup.status === 400, `status=${p_dup.status}`);
  const p_ok = await api(A, 'POST', '/projects', { code: MK0, name: '测试项目P0', type: '其他', location: '测试地点A', manager: '测试员', budget: 100 });
  check('管理员创建项目成功', p_ok.status === 200, `status=${p_ok.status}`);
  const pl = await api(A, 'GET', `/projects?keyword=${MK0}`);
  const P0 = findMark(pl, MK0);
  check('关键词搜索可找到新项目', !!P0, JSON.stringify(pl.data).slice(0, 120));
  const pd = await api(A, 'GET', `/projects/${P0?.id}`);
  check('项目详情获取成功', pd.status === 200 && pd.data?.name === '测试项目P0', JSON.stringify(pd.data || {}).slice(0, 120));
  const p404 = await api(A, 'GET', '/projects/99999');
  check('查询不存在项目404', p404.status === 404, `status=${p404.status}`);
  const pu = await api(A, 'PUT', `/projects/${P0?.id}`, { ...P0, location: '测试地点B' });
  check('管理员修改项目成功', pu.status === 200, `status=${pu.status}`);
  const pd2 = await api(A, 'GET', `/projects/${P0?.id}`);
  check('修改后数据已落库', pd2.data?.location === '测试地点B', `location=${pd2.data?.location}`);
  const pinj = await api(A, 'GET', `/projects?keyword=${encodeURIComponent("'; DROP TABLE projects;--")}`);
  const palist = await api(A, 'GET', '/projects');
  check('关键词SQL注入无副作用', pinj.status === 200 && listOf(palist.data).length >= 5, `status=${pinj.status} 总数=${listOf(palist.data).length}`);
  const pdel = await api(A, 'DELETE', `/projects/${P0?.id}`);
  check('管理员删除项目成功', pdel.status === 200, `status=${pdel.status}`);
  const pdel2 = await api(A, 'GET', `/projects/${P0?.id}`);
  check('删除后查询404', pdel2.status === 404, `status=${pdel2.status}`);

  /* ---------- S3 权限矩阵 ---------- */
  console.log('--- S3 权限矩阵（员工只读+可增，管理员独占改/删/审批/用户管理） ---');
  const q1 = await api(L, 'PUT', '/projects/1', { name: '越权修改' });
  check('业务员修改项目403', q1.status === 403, `status=${q1.status}`);
  const q2 = await api(L, 'DELETE', '/projects/1');
  check('业务员删除项目403', q2.status === 403, `status=${q2.status}`);
  const q3 = await api(Z, 'PUT', '/projects/1', { name: '越权修改' });
  check('项目经理修改项目403', q3.status === 403, `status=${q3.status}`);
  const q4 = await api(Z, 'DELETE', '/projects/1');
  check('项目经理删除项目403', q4.status === 403, `status=${q4.status}`);
  const q5 = await api(L, 'GET', '/users');
  check('业务员访问用户管理403', q5.status === 403, `status=${q5.status}`);
  const q6 = await api(Z, 'GET', '/users');
  check('项目经理访问用户管理403', q6.status === 403, `status=${q6.status}`);
  const q7 = await api(L, 'POST', '/users', { username: 'hacker', password: '123456', role: '管理员' });
  check('业务员创建用户403', q7.status === 403, `status=${q7.status}`);

  const MK1 = 'TST-P1-' + Date.now();
  const emp = await api(L, 'POST', '/projects', { code: MK1, name: '员工新增测试P1', type: '其他', location: '原始地点' });
  check('业务员新增项目直接生效', emp.status === 200, `status=${emp.status}`);
  const P1 = findMark(await api(A, 'GET', `/projects?keyword=${MK1}`), MK1);
  created.projects.push(P1?.id);
  check('员工新增的项目可查询到', !!P1, '未找到');

  /* ---------- S4 变更审批流 ---------- */
  console.log('--- S4 变更审批流 ---');
  const c_same = await api(L, 'POST', '/change-requests', { target_type: 'project', target_id: P1?.id, payload: { location: P1?.location } });
  check('无实际变化的申请被拒', c_same.status === 400 && String(c_same.data?.message).includes('未检测到'), `status=${c_same.status} msg=${c_same.data?.message}`);
  const c_bad = await api(L, 'POST', '/change-requests', { target_type: 'hacker_type', target_id: 1, payload: { x: 1 } });
  check('非法变更类型400', c_bad.status === 400, `status=${c_bad.status}`);
  const c_nf = await api(L, 'POST', '/change-requests', { target_type: 'project', target_id: 99999, payload: { location: 'x' } });
  check('变更对象不存在404', c_nf.status === 404, `status=${c_nf.status}`);

  const c1 = await api(L, 'POST', '/change-requests', { target_type: 'project', target_id: P1?.id, payload: { location: '审批后地点', phone: '13811112222' } });
  check('员工提交变更申请成功', c1.status === 200 && c1.data?.status === 'pending', `status=${c1.status}`);
  const CR1 = c1.data?.id; created.crIds.push(CR1);
  check('自动diff检测出2处变更', (c1.data?.changes || []).length === 2, JSON.stringify(c1.data?.changes || []));
  const c2 = await api(A, 'POST', '/change-requests', { target_type: 'project', target_id: P1?.id, payload: { manager: '管理员提交人' } });
  const CR2 = c2.data?.id; created.crIds.push(CR2);
  const c2v = await api(L, 'GET', `/change-requests/${CR2}`);
  check('员工无法查看他人申请403', c2v.status === 403, `status=${c2v.status}`);
  const ap1 = await api(L, 'POST', `/change-requests/${CR1}/approve`, {});
  check('员工审批被拒403', ap1.status === 403, `status=${ap1.status}`);
  const myList = await api(L, 'GET', '/change-requests');
  check('员工列表只见自己的申请', listOf(myList.data).every(r => r.submitted_by_name === '刘雅婷') && listOf(myList.data).length > 0,
    `总数=${listOf(myList.data).length} names=${[...new Set(listOf(myList.data).map(r => r.submitted_by_name))].join(',')}`);

  const cntA1 = (await api(A, 'GET', '/change-requests/pending/count')).data?.count;
  const cntL1 = (await api(L, 'GET', '/change-requests/pending/count')).data;
  check('管理员待审计数包含全部', cntA1 >= 1, `count=${cntA1}`);
  check('员工计数仅本人(mine=true)', cntL1?.mine === true, JSON.stringify(cntL1));

  const rj1 = await api(A, 'POST', `/change-requests/${CR2}/reject`, { comment: '' });
  check('驳回缺原因400', rj1.status === 400, `status=${rj1.status}`);
  const rj2 = await api(A, 'POST', `/change-requests/${CR2}/reject`, { comment: '测试驳回' });
  check('管理员驳回成功', rj2.status === 200, `status=${rj2.status}`);
  const afterRj = (await api(A, 'GET', `/projects/${P1?.id}`)).data;
  check('驳回后原数据不变', afterRj?.manager !== '管理员提交人', `manager=${afterRj?.manager}`);
  const rj3 = await api(A, 'POST', `/change-requests/${CR2}/reject`, { comment: '再次驳回' });
  check('重复驳回400', rj3.status === 400, `status=${rj3.status}`);

  const ap2 = await api(A, 'POST', `/change-requests/${CR1}/approve`, {});
  check('管理员审批通过', ap2.status === 200, `status=${ap2.status} msg=${ap2.data?.message}`);
  const afterAp = (await api(A, 'GET', `/projects/${P1?.id}`)).data;
  check('审批后两处变更落库', afterAp?.location === '审批后地点' && afterAp?.phone === '13811112222',
    `location=${afterAp?.location} phone=${afterAp?.phone}`);
  const ap3 = await api(A, 'POST', `/change-requests/${CR1}/approve`, {});
  check('重复审批400', ap3.status === 400, `status=${ap3.status}`);
  const cntA2 = (await api(A, 'GET', '/change-requests/pending/count')).data?.count;
  check('审批后待审计数相应减少', cntA2 === cntA1 - 2, `${cntA1} -> ${cntA2}（期间1条通过、1条驳回）`);
  const mine1 = await api(L, 'GET', `/change-requests/${CR1}`);
  check('员工可查自己的申请结果', mine1.status === 200 && mine1.data?.status === 'approved' && mine1.data?.reviewed_by === '系统管理员',
    `status=${mine1.status} data=${JSON.stringify(mine1.data || {}).slice(0, 150)}`);

  // 审批模块显示名单一数据源：对象改名后，待审批列表必须显示主模块当前名，而非提交时快照
  const MK4 = 'TST-P4-' + Date.now();
  const oldNm = 'TST审批旧名-' + MK4, newNm = 'TST审批新名-' + MK4;
  await api(A, 'POST', '/projects', { code: MK4, name: oldNm, type: '其他', location: '旧地点' });
  const P4 = findMark(await api(A, 'GET', '/projects?keyword=' + MK4), MK4);
  created.projects.push(P4?.id);
  await api(L, 'POST', '/change-requests', { target_type: 'project', target_id: P4?.id, payload: { location: '审批改地点' } });
  await api(A, 'PUT', `/projects/${P4?.id}`, { name: newNm });
  const crLive = (await api(A, 'GET', '/change-requests?scope=all')).data.list
    .find(c => c.target_type === 'project' && c.target_id === P4?.id);
  check('审批列表对象名实时跟随主模块', crLive?.target_name === newNm && crLive?.target_exists === 1,
    `target_name=${crLive?.target_name}`);
  const crLiveApprove = await api(A, 'POST', `/change-requests/${crLive?.id}/approve`, {});
  check('改名后原审批仍可正常通过', crLiveApprove.status === 200, `status=${crLiveApprove.status}`);
  const p4final = await api(A, 'GET', `/projects/${P4?.id}`);
  check('审批通过后新名与变更字段同时保留', p4final.data?.name === newNm && p4final.data?.location === '审批改地点',
    `name=${p4final.data?.name} location=${p4final.data?.location}`);

  /* ---------- S5 招标信息 ---------- */
  console.log('--- S5 招标信息 ---');
  const b_miss = await api(A, 'POST', '/bids', { project_id: P1?.id });
  check('缺招标名称400', b_miss.status === 400, `status=${b_miss.status}`);
  const b_ok = await api(A, 'POST', '/bids', { project_id: P1?.id, title: 'TST招标-' + MK1, method: '公开招标', budget: 50, status: '报名中' });
  check('创建招标成功', b_ok.status === 200, `status=${b_ok.status}`);
  const B1 = findMark(await api(A, 'GET', '/bids?keyword=' + MK1), 'TST招标-' + MK1);
  const b_403 = await api(L, 'PUT', `/bids/${B1?.id}`, { title: '越权' });
  check('业务员修改招标403', b_403.status === 403, `status=${b_403.status}`);
  // 状态改为"已定标"时必须同时给出中标单位与中标金额（否则无法形成闭环台账）
  const b_put = await api(A, 'PUT', `/bids/${B1?.id}`,
    { ...B1, winner: '测试中标单位', win_amount: 45, status: '已定标' });
  check('管理员修改招标成功', b_put.status === 200, `status=${b_put.status} msg=${b_put.data?.message}`);
  const b_noWinner = await api(A, 'PUT', `/bids/${B1?.id}`, { ...B1, winner: '', win_amount: null, status: '已定标' });
  check('已定标但缺中标单位/金额400', b_noWinner.status === 400, `status=${b_noWinner.status}`);
  const b_overBid = await api(A, 'PUT', `/bids/${B1?.id}`, { ...B1, budget: 100, win_amount: 200, status: '已定标' });
  check('中标金额高于控制价400', b_overBid.status === 400, `status=${b_overBid.status}`);
  const b_date = await api(A, 'POST', '/bids', { project_id: P1?.id, title: 'TST日期倒挂招标', signup_deadline: '2026-12-31', bid_open_date: '2026-12-01' });
  check('报名截止晚于开标日期400', b_date.status === 400, `status=${b_date.status}`);
  const b_pid = await api(A, 'POST', '/bids', { project_id: 99999, title: 'TST无项目招标' });
  check('招标所属项目不存在400', b_pid.status === 400, `status=${b_pid.status}`);
  const b_del = await api(A, 'DELETE', `/bids/${B1?.id}`);
  check('管理员删除招标成功', b_del.status === 200, `status=${b_del.status}`);

  /* ---------- S6 合同与付款 ---------- */
  console.log('--- S6 合同与付款台账 ---');
  const ct_miss = await api(A, 'POST', '/contracts', { project_id: P1?.id });
  check('缺合同名称400', ct_miss.status === 400, `status=${ct_miss.status}`);
  const ct_ok = await api(A, 'POST', '/contracts', { project_id: P1?.id, name: 'TST合同-' + MK1, party_a: '甲方测试', party_b: '乙方测试', amount: 100, status: '履行中' });
  check('创建合同成功', ct_ok.status === 200, `status=${ct_ok.status}`);
  const p1Active = await api(A, 'GET', `/projects/${P1?.id}`);
  check('履行中合同联动项目→施工中', p1Active.data?.status === '施工中', `status=${p1Active.data?.status}`);
  const ct_nopid = await api(A, 'POST', '/contracts', { project_id: 99999, name: 'TST无项目合同' });
  check('合同所属项目不存在400', ct_nopid.status === 400, `status=${ct_nopid.status}`);
  const ct_nobid = await api(A, 'POST', '/contracts', { project_id: P1?.id, name: 'TST无招标合同', bid_id: 99999 });
  check('合同关联招标不存在400', ct_nobid.status === 400, `status=${ct_nobid.status}`);
  // 动态找一个不属于 P1 的招标用于跨项目校验（避免依赖固定种子ID）
  const otherBid = (await api(A, 'GET', '/bids')).data.list.find(b => b.project_id !== P1?.id);
  const ct_cross = await api(A, 'POST', '/contracts', { project_id: P1?.id, name: 'TST跨项目合同', bid_id: otherBid?.id });
  check('合同跨项目关联招标400', !!otherBid && ct_cross.status === 400 && String(ct_cross.data?.message).includes('同一项目'), `bid=${otherBid?.id} status=${ct_cross.status} msg=${ct_cross.data?.message}`);
  const ct_date = await api(A, 'POST', '/contracts', { project_id: P1?.id, name: 'TST日期倒挂合同', start_date: '2026-12-01', end_date: '2026-01-01' });
  check('合同结束日期早于开始日期400', ct_date.status === 400, `status=${ct_date.status}`);
  // 软警告用例使用测试自有项目（明确工期），合同结束日远超项目完工日 → 仅警告不拦截
  const MK_W = 'TST-PW-' + Date.now();
  await api(A, 'POST', '/projects', { code: MK_W, name: '工期警告测试项目', type: '其他', start_date: '2026-01-01', end_date: '2026-12-31', status: '筹备中' });
  const PW = findMark(await api(A, 'GET', '/projects?keyword=' + MK_W), MK_W);
  created.projects.push(PW?.id);
  const ct_warn = await api(A, 'POST', '/contracts', { project_id: PW?.id, name: 'TST超工期警告-' + MK1, amount: 1, start_date: '2026-03-01', end_date: '2030-01-01', status: '待签订' });
  check('合同超出项目工期可保存但返回软警告', ct_warn.status === 200 && Array.isArray(ct_warn.data.warnings) && ct_warn.data.warnings.length >= 1,
    `status=${ct_warn.status} warnings=${JSON.stringify(ct_warn.data?.warnings)}`);
  if (ct_warn.data?.id) await api(A, 'DELETE', `/contracts/${ct_warn.data.id}`);
  const C1 = findMark(await api(A, 'GET', '/contracts?keyword=' + MK1), 'TST合同-' + MK1);
  const pay_miss = await api(A, 'POST', `/contracts/${C1?.id}/payments`, { note: '无金额' });
  check('付款缺金额400', pay_miss.status === 400, `status=${pay_miss.status}`);
  const pay1 = await api(A, 'POST', `/contracts/${C1?.id}/payments`, { pay_date: '2026-10-01', stage: '预付款', amount: 40, note: '首笔' });
  check('登记付款成功', pay1.status === 200, `status=${pay1.status}`);
  const pays = await api(A, 'GET', `/contracts/${C1?.id}/payments`);
  check('付款记录可查询', listOf(pays.data).length === 1, `len=${listOf(pays.data).length}`);
  const pay403 = await api(L, 'DELETE', `/contracts/${C1?.id}/payments/${listOf(pays.data)[0]?.id}`);
  check('业务员删除付款403', pay403.status === 403, `status=${pay403.status}`);
  const payDel = await api(A, 'DELETE', `/contracts/${C1?.id}/payments/${listOf(pays.data)[0]?.id}`);
  check('管理员删除付款成功', payDel.status === 200, `status=${payDel.status}`);
  const pays2 = await api(A, 'GET', `/contracts/${C1?.id}/payments`);
  check('删除后付款为空', listOf(pays2.data).length === 0, `len=${listOf(pays2.data).length}`);
  const ct_del = await api(A, 'DELETE', `/contracts/${C1?.id}`);
  check('管理员删除合同成功', ct_del.status === 200, `status=${ct_del.status}`);

  /* ---------- S7 进度管理与里程碑 ---------- */
  console.log('--- S7 进度与里程碑 ---');
  const rec_miss = await api(A, 'POST', '/progress/records', { project_id: P1?.id });
  check('进度缺填报日期400', rec_miss.status === 400, `status=${rec_miss.status}`);
  const rec_ok = await api(A, 'POST', '/progress/records', { project_id: P1?.id, record_date: '2026-10-01', period: '测试期', percent: 55, work_done: '完成一半', reporter: '测试员' });
  check('创建进度填报成功', rec_ok.status === 200, `status=${rec_ok.status}`);
  const recs = await api(A, 'GET', '/progress/records?project_id=' + P1?.id);
  const R1 = findMark(recs, '测试期');
  const rec403 = await api(L, 'PUT', `/progress/records/${R1?.id}`, { percent: 99 });
  check('业务员修改进度403', rec403.status === 403, `status=${rec403.status}`);
  const recPut = await api(A, 'PUT', `/progress/records/${R1?.id}`, { ...R1, percent: 66 });
  check('管理员修改进度成功', recPut.status === 200, `status=${recPut.status}`);
  const rec_badpct = await api(A, 'POST', '/progress/records', { project_id: P1?.id, record_date: '2026-10-02', percent: 150 });
  check('进度百分比超范围400', rec_badpct.status === 400, `status=${rec_badpct.status}`);
  const rec_back = await api(A, 'POST', '/progress/records', { project_id: P1?.id, record_date: '2026-10-03', percent: 10 });
  check('进度填报倒挂400（新报告期低于早期）', rec_back.status === 400, `status=${rec_back.status}`);
  const rec_nopid = await api(A, 'POST', '/progress/records', { project_id: 99999, record_date: '2026-10-04', percent: 10 });
  check('进度所属项目不存在400', rec_nopid.status === 400, `status=${rec_nopid.status}`);
  const ms_miss = await api(A, 'POST', '/progress/milestones', { project_id: P1?.id });
  check('里程碑缺名称400', ms_miss.status === 400, `status=${ms_miss.status}`);
  const ms_ok = await api(A, 'POST', '/progress/milestones', { project_id: P1?.id, name: 'TST里程碑-' + MK1, plan_date: '2026-12-01', status: '未开始' });
  check('创建里程碑成功', ms_ok.status === 200, `status=${ms_ok.status}`);
  const mss = await api(A, 'GET', '/progress/milestones?project_id=' + P1?.id);
  const M1 = findMark(mss, 'TST里程碑');
  const ms403 = await api(L, 'DELETE', `/progress/milestones/${M1?.id}`);
  check('业务员删除里程碑403', ms403.status === 403, `status=${ms403.status}`);
  const msDel = await api(A, 'DELETE', `/progress/milestones/${M1?.id}`);
  check('管理员删除里程碑成功', msDel.status === 200, `status=${msDel.status}`);
  const ms_nodate = await api(A, 'POST', '/progress/milestones', { project_id: P1?.id, name: 'TST完成无日期', status: '已完成' });
  check('里程碑已完成但无实际日期400', ms_nodate.status === 400, `status=${ms_nodate.status}`);
  const ms_future = await api(A, 'POST', '/progress/milestones', { project_id: P1?.id, name: 'TST未来完成', status: '已完成', actual_date: '2099-01-01' });
  check('里程碑实际完成日期晚于今天400', ms_future.status === 400, `status=${ms_future.status}`);
  // 审批兜底：业务员提交非法里程碑变更，管理员审批时必须拦截
  const msCrRow = await api(A, 'POST', '/progress/milestones', { project_id: P1?.id, name: 'TST审批校验里程碑', plan_date: '2026-12-01', status: '未开始' });
  const crBadMs = await api(L, 'POST', '/change-requests', { target_type: 'milestone', target_id: msCrRow.data?.id, payload: { status: '已完成' } });
  const apBadMs = await api(A, 'POST', `/change-requests/${crBadMs.data?.id}/approve`, {});
  check('审批兜底拦截非法里程碑变更400', apBadMs.status === 400, `status=${apBadMs.status} msg=${apBadMs.data?.message}`);

  /* ---------- S8 计划与任务 ---------- */
  console.log('--- S8 计划与任务 ---');
  const pl_miss = await api(A, 'POST', '/plans', { project_id: P1?.id });
  check('计划缺名称400', pl_miss.status === 400, `status=${pl_miss.status}`);
  const pl_ok = await api(A, 'POST', '/plans', { project_id: P1?.id, name: 'TST计划-' + MK1, year: 2026, status: '执行中' });
  check('创建计划成功', pl_ok.status === 200, `status=${pl_ok.status}`);
  const PL1 = findMark(await api(A, 'GET', '/plans?keyword=' + MK1), 'TST计划');
  const tk_miss = await api(A, 'POST', `/plans/${PL1?.id}/tasks`, { owner: 'x' });
  check('任务缺名称400', tk_miss.status === 400, `status=${tk_miss.status}`);
  const tk_ok = await api(A, 'POST', `/plans/${PL1?.id}/tasks`, { name: 'TST任务-' + MK1, owner: '测试员', weight: 30, status: '未开始' });
  check('创建任务成功', tk_ok.status === 200, `status=${tk_ok.status}`);
  const plDet = await api(A, 'GET', `/plans/${PL1?.id}`);
  const TK1 = (plDet.data?.tasks || []).find(t => String(t.name).includes('TST任务'));
  const tkPut = await api(A, 'PUT', `/plans/${PL1?.id}/tasks/${TK1?.id}`, { ...TK1, status: '进行中' });
  check('管理员修改任务成功', tkPut.status === 200, `status=${tkPut.status}`);
  const pl403 = await api(L, 'DELETE', `/plans/${PL1?.id}`);
  check('业务员删除计划403', pl403.status === 403, `status=${pl403.status}`);
  const tk_nodone = await api(A, 'POST', `/plans/${PL1?.id}/tasks`, { name: 'TST完成无日期任务', weight: 10, status: '已完成' });
  check('任务已完成但无实际完成日期400', tk_nodone.status === 400, `status=${tk_nodone.status}`);
  const tk_weight = await api(A, 'POST', `/plans/${PL1?.id}/tasks`, { name: 'TST权重超标任务', weight: 120 });
  check('任务权重超出0-100范围400', tk_weight.status === 400, `status=${tk_weight.status}`);
  const pl_nopid = await api(A, 'POST', '/plans', { project_id: 99999, name: 'TST无项目计划' });
  check('计划所属项目不存在400', pl_nopid.status === 400, `status=${pl_nopid.status}`);
  const nf_put = await api(A, 'PUT', '/projects/99999', { name: 'x' });
  check('修改不存在项目404', nf_put.status === 404, `status=${nf_put.status}`);

  /* ---------- S8b 工期审批联动顺延 ---------- */
  console.log('--- S8b 工期审批联动顺延 ---');
  const MK3 = 'TST-P3-' + Date.now();
  await api(A, 'POST', '/projects', { code: MK3, name: '工期联动测试P3', type: '其他', start_date: '2026-03-01', end_date: '2027-10-31', status: '筹备中' });
  const P3 = findMark(await api(A, 'GET', '/projects?keyword=' + MK3), MK3);
  created.projects.push(P3?.id);
  await api(A, 'POST', '/contracts', { project_id: P3?.id, name: 'TST顺延合同-' + MK3, amount: 10, start_date: '2026-03-01', end_date: '2027-10-31', status: '待签订' });
  const crSch = await api(L, 'POST', '/change-requests', { target_type: 'project', target_id: P3?.id, payload: { end_date: '2027-11-30' } });
  const apSch = await api(A, 'POST', `/change-requests/${crSch.data?.id}/approve`, {});
  check('工期顺延审批成功并返回联动信息', apSch.status === 200 && String(apSch.data?.message).includes('联动'),
    `status=${apSch.status} msg=${apSch.data?.message}`);
  const c3list = await api(A, 'GET', '/contracts?keyword=' + MK3);
  const c3row = listOf(c3list.data)[0];
  check('合同结束日期随项目工期顺延30天', c3row?.end_date === '2027-11-30', `end_date=${c3row?.end_date}`);
  const stats = await api(A, 'GET', '/stats/overview');
  check('统计总览含偏差与计划缺失预警字段', stats.status === 200 && Array.isArray(stats.data.deviations) && Array.isArray(stats.data.planMissing),
    `status=${stats.status}`);

  /* ---------- S9 级联删除 ---------- */
  console.log('--- S9 级联删除 ---');
  const MK2 = 'TST-P2-' + Date.now();
  await api(A, 'POST', '/projects', { code: MK2, name: '级联测试P2', type: '其他' });
  const P2 = findMark(await api(A, 'GET', '/projects?keyword=' + MK2), MK2);
  await api(A, 'POST', '/bids', { project_id: P2?.id, title: 'P2招标', status: '草稿' });
  await api(A, 'POST', '/contracts', { project_id: P2?.id, name: 'P2合同', amount: 10 });
  await api(A, 'POST', '/progress/records', { project_id: P2?.id, record_date: '2026-10-01', percent: 10 });
  await api(L, 'POST', '/change-requests', { target_type: 'project', target_id: P2?.id, payload: { description: 'P2待审批改动' } });
  const casc = await api(A, 'DELETE', `/projects/${P2?.id}`);
  check('删除项目成功', casc.status === 200, `status=${casc.status}`);
  const bidsAfter = findMark(await api(A, 'GET', '/bids'), 'P2招标');
  const consAfter = findMark(await api(A, 'GET', '/contracts'), 'P2合同');
  check('级联删除招标/合同', !bidsAfter && !consAfter, `bid=${!!bidsAfter} contract=${!!consAfter}`);
  const crAfterP2 = (await api(A, 'GET', '/change-requests')).data.list || [];
  check('级联删除时同步清理变更申请', !crAfterP2.some(c => c.target_type === 'project' && c.target_id === P2?.id),
    `残留CR=${crAfterP2.filter(c => c.target_type === 'project' && c.target_id === P2?.id).length}`);

  /* ---------- S10 用户管理 ---------- */
  console.log('--- S10 用户管理 ---');
  const u_dup = await api(A, 'POST', '/users', { username: 'liuy', password: '123456', role: '业务员' });
  check('重复用户名400', u_dup.status === 400, `status=${u_dup.status} msg=${u_dup.data?.message}`);
  const u_short = await api(A, 'POST', '/users', { username: 'tmpuser1', password: '123', role: '业务员' });
  check('密码过短400', u_short.status === 400, `status=${u_short.status}`);
  const u_role = await api(A, 'POST', '/users', { username: 'tmpuser2', password: '123456', role: '超级管理员' });
  check('非法角色400', u_role.status === 400, `status=${u_role.status}`);
  const TMPU = 'tstuser' + (Date.now() % 100000);
  const u_ok = await api(A, 'POST', '/users', { username: TMPU, real_name: '临时测试', password: 'test123456', role: '业务员' });
  check('创建用户成功', u_ok.status === 200, `status=${u_ok.status}`);
  const TU = findMark(await api(A, 'GET', '/users'), TMPU);
  created.userIds.push(TU?.id);
  const tu_login = await login(TMPU, 'test123456');
  check('新用户可登录', tu_login.status === 200 && !!tu_login.data.token, `status=${tu_login.status}`);
  const selfDis = await api(A, 'PUT', '/users/1', { active: 0 });
  check('管理员不能停用自己400', selfDis.status === 400, `status=${selfDis.status}`);
  const selfDemo = await api(A, 'PUT', '/users/1', { role: '业务员' });
  check('管理员不能降级自己400', selfDemo.status === 400, `status=${selfDemo.status}`);
  const dis = await api(A, 'PUT', `/users/${TU?.id}`, { active: 0 });
  check('停用用户成功', dis.status === 200, `status=${dis.status}`);
  const tu_login2 = await login(TMPU, 'test123456');
  check('被停用用户登录被拒', tu_login2.status === 403, `status=${tu_login2.status}`);
  const tu_api = await api(tu_login.data.token, 'GET', '/projects');
  check('被停用用户旧token立即失效', tu_api.status === 403, `status=${tu_api.status}`);
  const en = await api(A, 'PUT', `/users/${TU?.id}`, { active: 1 });
  check('启用用户成功', en.status === 200, `status=${en.status}`);
  const rp_short = await api(A, 'POST', `/users/${TU?.id}/reset-password`, { password: '123' });
  check('重置密码过短400', rp_short.status === 400, `status=${rp_short.status}`);
  const rp = await api(A, 'POST', `/users/${TU?.id}/reset-password`, { password: 'newpass888' });
  check('重置密码成功', rp.status === 200, `status=${rp.status}`);
  const tu_login3 = await login(TMPU, 'newpass888');
  check('新密码可登录', tu_login3.status === 200, `status=${tu_login3.status}`);

  /* ---------- S11 健壮性 ---------- */
  console.log('--- S11 健壮性 ---');
  const badResp = await fetch(BASE + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{invalid json' });
  check('非法JSON返回4xx而非500', badResp.status >= 400 && badResp.status < 500, `status=${badResp.status}（若500则错误处理可改进）`);
  const xss = await api(A, 'GET', '/projects?keyword=' + encodeURIComponent('<script>alert(1)</script>'));
  check('XSS关键词不致错', xss.status === 200, `status=${xss.status}`);

  /* ---------- S12 审计日志 ---------- */
  console.log('--- S12 审计日志 ---');
  const audDenied = await api(L, 'GET', '/audit-logs');
  check('业务员无权查看审计日志(403)', audDenied.status === 403, `status=${audDenied.status}`);
  const audMeta = await api(A, 'GET', '/audit-logs/meta');
  check('管理员可获取审计筛选项', audMeta.status === 200 && Array.isArray(audMeta.data.modules), `status=${audMeta.status}`);

  // 新增操作被记录：操作人/模块/动作/对象/结果齐全
  const MK_AUD = 'TST-AUD-' + Date.now();
  const audCreate = await api(A, 'POST', '/projects', { code: MK_AUD, name: '审计测试项目', type: '其他' });
  check('审计专用项目创建成功', audCreate.status === 200, `status=${audCreate.status}`);
  const audProj = findMark(await api(A, 'GET', '/projects?keyword=' + MK_AUD), MK_AUD);
  if (audProj) created.projects.push(audProj.id);
  const audList1 = await api(A, 'GET', '/audit-logs?module=' + encodeURIComponent('项目') + '&keyword=' + MK_AUD);
  const audRow = (audList1.data.list || []).find(r => r.action === '新增' && r.status_code === 200);
  check('新增项目写入审计日志', !!audRow && audRow.username === 'admin' && audRow.target.includes('审计测试项目'),
    `row=${JSON.stringify(audRow || {}).slice(0, 160)}`);

  // 登录失败被记录且密码脱敏
  await login('tst_audit_nouser', 'secret-pwd');
  const audList2 = await api(A, 'GET', '/audit-logs?module=' + encodeURIComponent('认证') + '&action=' + encodeURIComponent('登录')
    + '&status=fail&keyword=tst_audit_nouser');
  const failRow = (audList2.data.list || [])[0];
  check('登录失败写入审计日志', !!failRow && failRow.status_code === 401, `row=${JSON.stringify(failRow || {}).slice(0, 160)}`);
  check('日志中密码已脱敏', failRow?.detail?.password === '******', `detail=${JSON.stringify(failRow?.detail)}`);

  // GET 查询不写审计（本次测试期间不应出现 method=GET 的日志）
  const getLogged = tdb.prepare('SELECT COUNT(*) c FROM audit_logs WHERE method=\'GET\' AND id>?').get(maxAuditId).c;
  check('查询类操作不记录审计日志', getLogged === 0, `GET日志数=${getLogged}`);

  /* ---------- 清理 ---------- */
  console.log('--- 清理测试数据 ---');
  for (const pid of created.projects.filter(Boolean)) await api(A, 'DELETE', `/projects/${pid}`);
  console.log(`  已删除临时项目: ${created.projects.filter(Boolean).join(', ') || '无'}`);
  const crDel = tdb.prepare('DELETE FROM change_requests WHERE target_type=\'project\' AND target_id IN (' + created.projects.filter(Boolean).map(() => '?').join(',') + ')')
    .run(...created.projects.filter(Boolean));
  const uDel = tdb.prepare(`DELETE FROM users WHERE username LIKE 'tstuser%'`).run();
  // 安全网：若查重用例意外成功，避免“重复编号测试”残留污染种子数据
  const dupJunk = tdb.prepare("DELETE FROM projects WHERE name='重复编号测试'").run();
  const audDel = tdb.prepare('DELETE FROM audit_logs WHERE id>?').run(maxAuditId);
  tdb.close();
  console.log(`  已清理变更申请 ${crDel.changes} 条、临时用户 ${uDel.changes} 个、测试审计日志 ${audDel.changes} 条`);

  /* ---------- 汇总 ---------- */
  console.log('\n========================================');
  console.log(`总计: ${pass + fail}  通过: ${pass}  失败: ${fail}`);
  if (fail) {
    console.log('\n失败明细:');
    failures.forEach(f => console.log(`  - ${f.name}\n    ${f.detail ?? ''}`));
    process.exitCode = 1;
  } else {
    console.log('全部通过 ✓');
  }
}

main().catch(e => { console.error('测试脚本异常:', e); process.exit(1); });
