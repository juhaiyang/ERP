/* 应用入口：登录、布局、路由 */
const { createApp } = Vue;

window.Views = window.Views || {};

/* ---------------- 登录页 ---------------- */
Views.Login = {
  template: `
    <div class="login-wrap">
      <div class="login-card">
        <h2 class="login-title">水土保持项目管理系统</h2>
        <p class="login-sub">招标 · 合同 · 进度 · 计划 一体化管理平台</p>
        <el-form :model="form" :rules="rules" ref="formRef" @submit.prevent="submit">
          <el-form-item prop="username">
            <el-input v-model="form.username" size="large" placeholder="请输入用户名" :prefix-icon="User" />
          </el-form-item>
          <el-form-item prop="password">
            <el-input v-model="form.password" type="password" size="large" placeholder="请输入密码"
              :prefix-icon="Lock" show-password @keyup.enter="submit" />
          </el-form-item>
          <el-button type="primary" size="large" style="width:100%" :loading="loading" @click="submit">登 录</el-button>
        </el-form>
        <p class="login-tip">演示账号：admin（管理员）/ zhangs（项目经理）/ liuy（业务员），密码均为 123456</p>
      </div>
    </div>`,
  setup() {
    const formRef = ref();
    const loading = ref(false);
    const form = reactive({ username: 'admin', password: '123456' });
    const rules = {
      username: [{ required: true, message: '请输入用户名', trigger: 'blur' }],
      password: [{ required: true, message: '请输入密码', trigger: 'blur' }]
    };
    const submit = async () => {
      await formRef.value.validate().catch(() => { throw new Error('校验失败'); });
      loading.value = true;
      try {
        const r = await http.post('/login', form);
        localStorage.setItem('swc_token', r.token);
        localStorage.setItem('swc_user', JSON.stringify(r.user));
        ElementPlus.ElMessage.success('登录成功，欢迎 ' + r.user.real_name);
        location.hash = '#/dashboard';
      } finally { loading.value = false; }
    };
    return { form, rules, formRef, loading, submit,
      User: ElementPlusIconsVue.User, Lock: ElementPlusIconsVue.Lock };
  }
};

/* ---------------- 主布局 ---------------- */
Views.Layout = {
  template: `
    <el-container class="layout">
      <el-aside width="218px" class="layout-aside">
        <div style="height:56px;display:flex;align-items:center;justify-content:center;color:#0e7a4f;font-weight:700;font-size:16px;border-bottom:1px solid #f0f0f0;">
          水土保持 PM
        </div>
        <el-menu :default-active="active" router unique-opened>
          <el-menu-item index="/dashboard"><el-icon><DataLine /></el-icon><span>首页仪表盘</span></el-menu-item>
          <el-menu-item index="/projects"><el-icon><Location /></el-icon><span>项目管理</span></el-menu-item>
          <el-menu-item index="/bids"><el-icon><Document /></el-icon><span>招标管理</span></el-menu-item>
          <el-menu-item index="/contracts"><el-icon><Tickets /></el-icon><span>合同管理</span></el-menu-item>
          <el-menu-item index="/progress"><el-icon><TrendCharts /></el-icon><span>进度管理</span></el-menu-item>
          <el-menu-item index="/plans"><el-icon><Calendar /></el-icon><span>计划管理</span></el-menu-item>
          <el-menu-item index="/approvals">
            <el-icon><Bell /></el-icon>
            <span>变更审批</span>
            <el-badge v-if="crCount" :value="crCount" :max="99" type="danger" style="margin-left:6px" />
          </el-menu-item>
          <el-menu-item v-if="isAdmin()" index="/users"><el-icon><User /></el-icon><span>用户管理</span></el-menu-item>
          <el-menu-item v-if="isAdmin()" index="/audit"><el-icon><Notebook /></el-icon><span>审计日志</span></el-menu-item>
          <el-menu-item v-if="isAdmin()" index="/backup"><el-icon><Files /></el-icon><span>数据备份</span></el-menu-item>
          <el-menu-item v-if="isAdmin()" index="/settings"><el-icon><Setting /></el-icon><span>系统设置</span></el-menu-item>
        </el-menu>
      </el-aside>
      <el-container>
        <el-header class="layout-header" height="56px">
          <div class="logo"><el-icon><Promotion /></el-icon>水土保持综合治理项目管理平台</div>
          <div class="header-right">
            <el-popover placement="bottom-end" :width="360" trigger="click" @show="loadNotifications" popper-class="notif-pop">
              <template #reference>
                <el-badge :value="unreadCount" :max="99" :hidden="unreadCount===0" class="bell-badge">
                  <el-icon class="bell-icon"><Bell /></el-icon>
                </el-badge>
              </template>
              <div class="notif-head">
                <span>消息通知</span>
                <el-button link type="primary" size="small" @click="markAllRead">全部已读</el-button>
              </div>
              <div class="notif-list" v-if="notifications.length">
                <div v-for="n in notifications" :key="n.id" class="notif-item" :class="{unread: !n.is_read}" @click="openNotif(n)">
                  <div class="notif-title"><el-tag size="small" :type="notifType(n.type)" effect="dark">{{ notifLabel(n.type) }}</el-tag> {{ n.title }}</div>
                  <div class="notif-content">{{ n.content }}</div>
                  <div class="notif-time">{{ n.created_at }}</div>
                </div>
              </div>
              <div v-else class="notif-empty">暂无消息</div>
            </el-popover>

            <el-dropdown @command="onUserCmd">
              <span class="header-user">
                <el-icon><UserFilled /></el-icon>
                <span>{{ user.real_name }}（{{ user.role }}）</span>
                <el-icon><ArrowDown /></el-icon>
              </span>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item command="pwd"><el-icon><Lock /></el-icon>修改密码</el-dropdown-item>
                  <el-dropdown-item command="logout" divided><el-icon><SwitchButton /></el-icon>退出登录</el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </div>
        </el-header>
        <el-main style="padding:0;background:#f0f2f5">
          <router-view />
        </el-main>
      </el-container>

      <!-- 修改密码弹窗 -->
      <el-dialog v-model="pwdDlg.visible" title="修改密码" width="420px" @close="resetPwd">
        <el-form :model="pwdDlg.form" :rules="pwdRules" ref="pwdFormRef" label-width="88px">
          <el-form-item label="原密码" prop="old_password">
            <el-input v-model="pwdDlg.form.old_password" type="password" show-password />
          </el-form-item>
          <el-form-item label="新密码" prop="new_password">
            <el-input v-model="pwdDlg.form.new_password" type="password" show-password />
          </el-form-item>
          <el-form-item label="确认新密码" prop="confirm">
            <el-input v-model="pwdDlg.form.confirm" type="password" show-password @keyup.enter="submitPwd" />
          </el-form-item>
        </el-form>
        <template #footer>
          <el-button @click="pwdDlg.visible=false">取消</el-button>
          <el-button type="primary" :loading="pwdDlg.loading" @click="submitPwd">确认修改</el-button>
        </template>
      </el-dialog>
    </el-container>`,
  setup() {
    const route = VueRouter.useRoute();
    const router = VueRouter.useRouter();
    const user = JSON.parse(localStorage.getItem('swc_user') || '{}');
    const active = computed(() => route.path);

    /* 待审批数量徽标：本人相关（员工）/ 全部待审（管理员） */
    const crCount = ref(0);
    const loadCrCount = async () => {
      try { const r = await http.get('/change-requests/pending/count'); crCount.value = r.count; } catch {}
    };

    /* 消息通知 */
    const unreadCount = ref(0);
    const notifications = ref([]);
    const loadUnread = async () => {
      try { const r = await http.get('/notifications/unread-count'); unreadCount.value = r.count; } catch {}
    };
    const loadNotifications = async () => {
      try { notifications.value = await http.get('/notifications'); } catch {}
    };
    const markAllRead = async () => {
      await http.post('/notifications/read');
      unreadCount.value = 0;
      notifications.value.forEach(n => { n.is_read = 1; });
    };
    const openNotif = async (n) => {
      if (!n.is_read) {
        await http.post('/notifications/read', { id: n.id });
        n.is_read = 1;
        unreadCount.value = Math.max(0, unreadCount.value - 1);
      }
      if (n.link) { location.hash = n.link; }
    };
    const notifType = (t) => ({ success: 'success', danger: 'danger', warning: 'warning' }[t] || 'info');
    const notifLabel = (t) => ({ success: '通过', danger: '驳回', warning: '提醒', info: '通知' }[t] || '通知');

    let pollTimer = null;
    onMounted(() => {
      loadCrCount();
      loadUnread();
      window.addEventListener('cr-changed', loadCrCount);
      pollTimer = setInterval(loadUnread, 30000);
    });
    onBeforeUnmount(() => {
      window.removeEventListener('cr-changed', loadCrCount);
      if (pollTimer) clearInterval(pollTimer);
    });

    const logout = () => {
      ElementPlus.ElMessageBox.confirm('确定退出登录吗？', '提示', { type: 'warning' }).then(() => {
        // 先销毁服务端会话再清理本地凭据；接口异常时也必须保证本地登出
        http.post('/logout').catch(() => {}).finally(() => {
          localStorage.removeItem('swc_token');
          localStorage.removeItem('swc_user');
          router.push('/login');
        });
      }).catch(() => {});
    };

    /* 修改密码 */
    const pwdFormRef = ref();
    const pwdDlg = reactive({ visible: false, loading: false, form: { old_password: '', new_password: '', confirm: '' } });
    const pwdRules = {
      old_password: [{ required: true, message: '请输入原密码', trigger: 'blur' }],
      new_password: [{ required: true, min: 6, message: '新密码至少6位', trigger: 'blur' }],
      confirm: [{
        validator: (_, val, cb) => val !== pwdDlg.form.new_password ? cb(new Error('两次密码不一致')) : cb(),
        trigger: 'blur'
      }]
    };
    const resetPwd = () => { pwdDlg.form = { old_password: '', new_password: '', confirm: '' }; pwdFormRef.value?.clearValidate(); };
    const submitPwd = async () => {
      await pwdFormRef.value.validate().catch(() => { throw new Error('校验失败'); });
      pwdDlg.loading = true;
      try {
        await http.post('/change-password', { old_password: pwdDlg.form.old_password, new_password: pwdDlg.form.new_password });
        ElementPlus.ElMessage.success('密码修改成功，请重新登录');
        pwdDlg.visible = false;
        localStorage.removeItem('swc_token');
        localStorage.removeItem('swc_user');
        router.push('/login');
      } finally { pwdDlg.loading = false; }
    };
    const onUserCmd = (cmd) => { if (cmd === 'pwd') pwdDlg.visible = true; if (cmd === 'logout') logout(); };

    return { active, user, isAdmin, logout, crCount, pwdDlg, pwdRules, pwdFormRef, resetPwd, submitPwd, onUserCmd,
      unreadCount, notifications, loadNotifications, markAllRead, openNotif, notifType, notifLabel };
  }
};

/* ---------------- 路由 ---------------- */
const routes = [
  { path: '/login', component: Views.Login },
  {
    path: '/', component: Views.Layout, redirect: '/dashboard',
    children: [
      { path: 'dashboard', component: Views.Dashboard },
      { path: 'projects', component: Views.Projects },
      { path: 'bids', component: Views.Bids },
      { path: 'contracts', component: Views.Contracts },
      { path: 'progress', component: Views.Progress },
      { path: 'plans', component: Views.Plans },
      { path: 'approvals', component: Views.Approvals },
      { path: 'users', component: Views.Users, meta: { adminOnly: true } },
      { path: 'audit', component: Views.Audit, meta: { adminOnly: true } },
      { path: 'backup', component: Views.Backup, meta: { adminOnly: true } },
      { path: 'settings', component: Views.Settings, meta: { adminOnly: true } }
    ]
  }
];
const router = VueRouter.createRouter({ history: VueRouter.createWebHashHistory(), routes });
router.beforeEach((to) => {
  const token = localStorage.getItem('swc_token');
  if (!token && to.path !== '/login') return '/login';
  if (token && to.path === '/login') return '/dashboard';
  if (to.meta && to.meta.adminOnly && currentUser().role !== '管理员') return '/dashboard';
});

/* ---------------- 根组件（中文语言包） ---------------- */
const App = {
  template: `<el-config-provider :locale="locale"><router-view /></el-config-provider>`,
  setup() { return { locale: ElementPlusLocaleZhCn }; }
};

const app = createApp(App);
app.use(router);
app.use(ElementPlus);
for (const [key, comp] of Object.entries(ElementPlusIconsVue)) {
  app.component(key, comp);
}
app.mount('#app');
