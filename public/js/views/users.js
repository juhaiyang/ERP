/* 用户管理（仅管理员可见入口） */
window.Views = window.Views || {};

Views.Users = {
  template: `
    <div class="page-container">
      <div class="table-card">
        <div class="table-toolbar">
          <strong>系统用户（{{ list.length }} 人）</strong>
          <el-button type="primary" :icon="Plus" @click="openAdd">新增用户</el-button>
        </div>
        <el-table :data="list" v-loading="loading" border stripe size="small">
          <el-table-column prop="username" label="用户名" width="150" />
          <el-table-column prop="real_name" label="姓名" width="150" />
          <el-table-column label="角色" width="130">
            <template #default="{row}">
              <el-tag size="small" :type="row.role==='管理员'?'danger':'primary'" effect="plain">{{ row.role }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="状态" width="110">
            <template #default="{row}">
              <el-switch :model-value="row.active===1"
                :disabled="row.id===me.id"
                @change="(v)=>toggleActive(row,v)"
                active-text="启用" inactive-text="停用" inline-prompt />
            </template>
          </el-table-column>
          <el-table-column prop="created_at" label="创建时间" width="180" />
          <el-table-column label="操作" width="230">
            <template #default="{row}">
              <el-button link type="primary" size="small" @click="openEdit(row)">编辑角色</el-button>
              <el-button link type="warning" size="small" @click="resetPwd(row)">重置密码</el-button>
              <el-tooltip v-if="row.id===me.id" content="不能停用或降级当前登录账号" placement="top">
                <el-button link type="info" size="small" disabled>当前账号</el-button>
              </el-tooltip>
            </template>
          </el-table-column>
        </el-table>
        <el-alert type="info" :closable="false" show-icon style="margin-top:14px"
          title="权限说明：管理员可执行所有操作并审批变更；普通员工（项目经理/业务员）可以新增项目等业务信息，修改已有数据需提交变更申请经管理员确认，删除操作仅管理员可用。" />
      </div>

      <el-dialog v-model="dlg.visible" :title="dlg.isEdit?'编辑用户':'新增用户'" width="480px">
        <el-form :model="dlg.form" label-width="90px">
          <el-form-item label="用户名" required>
            <el-input v-model="dlg.form.username" :disabled="dlg.isEdit" placeholder="登录用用户名" />
          </el-form-item>
          <el-form-item label="姓名"><el-input v-model="dlg.form.real_name" /></el-form-item>
          <el-form-item label="角色" required>
            <el-select v-model="dlg.form.role" style="width:100%">
              <el-option label="管理员（全部权限+审批+用户管理）" value="管理员" />
              <el-option label="项目经理（可新增，修改需审批，不可删除）" value="项目经理" />
              <el-option label="业务员（可新增，修改需审批，不可删除）" value="业务员" />
            </el-select>
          </el-form-item>
          <el-form-item v-if="!dlg.isEdit" label="初始密码" required>
            <el-input v-model="dlg.form.password" type="password" show-password placeholder="至少6位" />
          </el-form-item>
        </el-form>
        <template #footer>
          <el-button @click="dlg.visible=false">取消</el-button>
          <el-button type="primary" @click="save">保存</el-button>
        </template>
      </el-dialog>
    </div>`,
  setup() {
    const { Plus } = ElementPlusIconsVue;
    const loading = ref(false);
    const list = ref([]);
    const me = currentUser();

    const load = async () => {
      loading.value = true;
      try { list.value = await http.get('/users'); } finally { loading.value = false; }
    };

    const dlg = reactive({ visible: false, isEdit: false, form: {} });
    const openAdd = () => {
      dlg.isEdit = false;
      dlg.form = { username: '', real_name: '', role: '业务员', password: '' };
      dlg.visible = true;
    };
    const openEdit = (row) => {
      dlg.isEdit = true;
      dlg.form = { id: row.id, username: row.username, real_name: row.real_name, role: row.role };
      dlg.visible = true;
    };
    const save = async () => {
      if (!dlg.form.username) { ElementPlus.ElMessage.warning('请填写用户名'); return; }
      if (dlg.isEdit) {
        await http.put('/users/' + dlg.form.id, { real_name: dlg.form.real_name, role: dlg.form.role });
        ElementPlus.ElMessage.success('已保存');
      } else {
        if (!dlg.form.password || dlg.form.password.length < 6) {
          ElementPlus.ElMessage.warning('初始密码至少6位'); return;
        }
        await http.post('/users', dlg.form);
        ElementPlus.ElMessage.success('用户已创建，可告知对方登录');
      }
      dlg.visible = false; load();
    };

    const toggleActive = (row, v) => {
      const action = v ? '启用' : '停用';
      ElementPlus.ElMessageBox.confirm(`确定${action}用户「${row.real_name || row.username}」吗？${v ? '' : '停用后该用户将无法登录。'}`,
        '操作确认', { type: 'warning' })
        .then(async () => {
          await http.put('/users/' + row.id, { active: v ? 1 : 0 });
          ElementPlus.ElMessage.success(`已${action}`); load();
        }).catch(() => {});
    };

    const resetPwd = (row) => {
      ElementPlus.ElMessageBox.prompt(`为「${row.real_name || row.username}」设置新密码（至少6位）`, '重置密码', {
        confirmButtonText: '确认重置', cancelButtonText: '取消', inputPlaceholder: '输入新密码',
        inputValidator: (v) => (v && v.length >= 6 ? true : '密码至少6位')
      }).then(async ({ value }) => {
        await http.post(`/users/${row.id}/reset-password`, { password: value });
        ElementPlus.ElMessage.success('密码已重置');
      }).catch(() => {});
    };

    onMounted(load);
    return { isAdmin, me, loading, list, Plus, dlg, openAdd, openEdit, save, toggleActive, resetPwd };
  }
};
