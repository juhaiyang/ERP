/* 系统设置（仅管理员） */
window.Views = window.Views || {};

Views.Settings = {
  template: `
    <div class="page-container">
      <div class="table-card">
        <div class="table-toolbar">
          <strong>系统设置</strong>
          <el-button type="primary" :icon="Check" :loading="saving" @click="save">保存设置</el-button>
        </div>
        <el-form label-width="200px" style="max-width:720px">
          <el-form-item label="平台名称">
            <el-input v-model="form.company_name" />
          </el-form-item>
          <el-form-item label="单文件上传大小限制(MB)">
            <el-input-number v-model="form.max_upload_mb" :min="1" :max="200" />
          </el-form-item>
          <el-form-item label="备份保留天数">
            <el-input-number v-model="form.backup_retention_days" :min="1" :max="365" />
          </el-form-item>
          <el-divider content-position="left">业务字典（状态枚举）</el-divider>
          <el-form-item label="项目状态">
            <el-input v-model="form.project_statuses" placeholder="逗号分隔，如：筹备中,招标中,施工中" />
            <div class="muted" style="font-size:12px;margin-top:4px">修改后仅影响前端下拉，已有数据不受影响</div>
          </el-form-item>
          <el-form-item label="项目类型">
            <el-input v-model="form.project_types" />
          </el-form-item>
          <el-form-item label="合同状态">
            <el-input v-model="form.contract_statuses" />
          </el-form-item>
        </el-form>
      </div>
    </div>`,
  setup() {
    const { Check } = ElementPlusIconsVue;
    const saving = ref(false);
    const form = reactive({ company_name: '', max_upload_mb: 20, backup_retention_days: 14,
      project_statuses: '', project_types: '', contract_statuses: '' });

    const load = async () => {
      const r = await http.get('/settings');
      Object.assign(form, r.map);
      // map 中的值统一为字符串，数字型字段需还原为数值，否则 el-input-number 行为异常
      form.max_upload_mb = Number(form.max_upload_mb) || 20;
      form.backup_retention_days = Number(form.backup_retention_days) || 14;
      // 字典默认值
      if (!form.project_statuses) form.project_statuses = CFG.projectStatuses.join(',');
      if (!form.project_types) form.project_types = CFG.projectTypes.join(',');
      if (!form.contract_statuses) form.contract_statuses = CFG.contractStatuses.join(',');
    };
    const save = async () => {
      saving.value = true;
      try {
        await http.put('/settings', form);
        // 立即刷新前端字典，使修改无需重新登录/刷新即生效
        await applySettings();
        ElementPlus.ElMessage.success('设置已保存');
      } finally { saving.value = false; }
    };
    onMounted(load);
    return { form, saving, save, Check };
  }
};
