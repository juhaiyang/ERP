/* 招标管理 */
window.Views = window.Views || {};

Views.Bids = {
  template: `
    <div class="page-container">
      <div class="search-bar">
        <el-form :inline="true">
          <el-form-item label="所属项目">
            <el-select v-model="q.project_id" placeholder="全部项目" clearable filterable style="width:240px">
              <el-option v-for="p in projects" :key="p.id" :label="p.name" :value="p.id" />
            </el-select>
          </el-form-item>
          <el-form-item label="状态">
            <el-select v-model="q.status" placeholder="全部状态" clearable style="width:130px">
              <el-option v-for="s in CFG.bidStatuses" :key="s" :label="s" :value="s" />
            </el-select>
          </el-form-item>
          <el-form-item label="关键词">
            <el-input v-model="q.keyword" placeholder="名称/编号/代理/中标单位" clearable style="width:230px" @keyup.enter="load" />
          </el-form-item>
          <el-form-item>
            <el-button type="primary" :icon="Search" @click="load">查询</el-button>
            <el-button :icon="RefreshLeft" @click="reset">重置</el-button>
          </el-form-item>
        </el-form>
      </div>

      <div class="table-card">
        <div class="table-toolbar">
          <strong>招标信息列表（共 {{ total }} 条）</strong>
          <div>
            <el-button :icon="Download" @click="doExport">导出</el-button>
            <el-button type="primary" :icon="Plus" @click="openAdd">新增招标</el-button>
          </div>
        </div>
        <el-table :data="list" v-loading="loading" border stripe size="small">
          <el-table-column prop="bid_no" label="招标编号" width="155" />
          <el-table-column prop="title" label="招标项目名称" min-width="230" show-overflow-tooltip />
          <el-table-column prop="project_name" label="所属项目" min-width="200" show-overflow-tooltip />
          <el-table-column prop="method" label="方式" width="100">
            <template #default="{row}"><el-tag size="small" effect="plain">{{ row.method }}</el-tag></template>
          </el-table-column>
          <el-table-column prop="budget" label="控制价(万元)" width="110" align="right">
            <template #default="{row}">{{ fmt(row.budget) }}</template>
          </el-table-column>
          <el-table-column prop="publish_date" label="发布日期" width="105" />
          <el-table-column prop="signup_deadline" label="报名截止" width="105" />
          <el-table-column prop="bid_open_date" label="开标日期" width="105" />
          <el-table-column prop="agency" label="代理机构" min-width="160" show-overflow-tooltip />
          <el-table-column prop="winner" label="中标单位" min-width="180" show-overflow-tooltip>
            <template #default="{row}">{{ row.winner || '—' }}</template>
          </el-table-column>
          <el-table-column label="状态" width="90">
            <template #default="{row}"><el-tag size="small" :type="tagType(row.status)">{{ row.status }}</el-tag></template>
          </el-table-column>
          <el-table-column label="操作" width="120" fixed="right">
            <template #default="{row}">
              <el-button link type="primary" size="small" @click="openEdit(row)">编辑</el-button>
              <el-button v-if="isAdmin()" link type="danger" size="small" @click="remove(row)">删除</el-button>
              <el-tooltip v-else content="仅管理员可删除" placement="top">
                <el-button link type="danger" size="small" disabled>删除</el-button>
              </el-tooltip>
            </template>
          </el-table-column>
        </el-table>
      </div>

      <el-dialog v-model="dlg.visible" :title="dlg.isEdit?'编辑招标信息':'新增招标信息'" width="760px">
        <el-alert v-if="dlg.isEdit && !isAdmin()" type="warning" :closable="false" show-icon
          title="您提交的修改将进入「变更审批」，由管理员确认后生效。" style="margin-bottom:14px" />
        <el-form :model="dlg.form" label-width="104px">
          <el-row :gutter="12">
            <el-col :span="12">
              <el-form-item label="所属项目" required>
                <el-select v-model="dlg.form.project_id" filterable style="width:100%" placeholder="请选择项目">
                  <el-option v-for="p in projects" :key="p.id" :label="p.name" :value="p.id" />
                </el-select>
              </el-form-item>
            </el-col>
            <el-col :span="12"><el-form-item label="招标编号"><el-input v-model="dlg.form.bid_no" /></el-form-item></el-col>
            <el-col :span="24"><el-form-item label="招标名称" required><el-input v-model="dlg.form.title" /></el-form-item></el-col>
            <el-col :span="12">
              <el-form-item label="招标方式">
                <el-select v-model="dlg.form.method" style="width:100%">
                  <el-option v-for="m in CFG.bidMethods" :key="m" :label="m" :value="m" />
                </el-select>
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item label="状态">
                <el-select v-model="dlg.form.status" style="width:100%">
                  <el-option v-for="s in CFG.bidStatuses" :key="s" :label="s" :value="s" />
                </el-select>
              </el-form-item>
            </el-col>
            <el-col :span="12"><el-form-item label="控制价(万元)"><el-input-number v-model="dlg.form.budget" :min="0" :precision="2" style="width:100%" /></el-form-item></el-col>
            <el-col :span="12"><el-form-item label="中标金额(万元)"><el-input-number v-model="dlg.form.win_amount" :min="0" :precision="2" style="width:100%" /></el-form-item></el-col>
            <el-col :span="12"><el-form-item label="发布日期"><el-date-picker v-model="dlg.form.publish_date" type="date" value-format="YYYY-MM-DD" style="width:100%" /></el-form-item></el-col>
            <el-col :span="12"><el-form-item label="报名截止"><el-date-picker v-model="dlg.form.signup_deadline" type="date" value-format="YYYY-MM-DD" style="width:100%" /></el-form-item></el-col>
            <el-col :span="12"><el-form-item label="开标日期"><el-date-picker v-model="dlg.form.bid_open_date" type="date" value-format="YYYY-MM-DD" style="width:100%" /></el-form-item></el-col>
            <el-col :span="12"><el-form-item label="代理机构"><el-input v-model="dlg.form.agency" /></el-form-item></el-col>
            <el-col :span="24"><el-form-item label="中标单位"><el-input v-model="dlg.form.winner" placeholder="定标后填写" /></el-form-item></el-col>
            <el-col :span="24"><el-form-item label="招标内容"><el-input v-model="dlg.form.content" type="textarea" :rows="3" /></el-form-item></el-col>
          </el-row>
        </el-form>
        <template #footer>
          <el-button @click="dlg.visible=false">取消</el-button>
          <el-button type="primary" @click="save">保存</el-button>
        </template>
      </el-dialog>
    </div>`,
  setup() {
    const { Search, Plus, RefreshLeft, Download } = ElementPlusIconsVue;
    const loading = ref(false);
    const list = ref([]);
    const total = ref(0);
    const projects = ref([]);
    const q = reactive({ project_id: '', status: '', keyword: '' });
    const fmt = (v) => (v == null ? '' : Number(v).toLocaleString('zh-CN', { maximumFractionDigits: 2 }));

    const load = async () => {
      loading.value = true;
      try {
        const params = {};
        Object.keys(q).forEach(k => { if (q[k] !== '') params[k] = q[k]; });
        const r = await http.get('/bids', { params });
        list.value = r.list; total.value = r.total;
      } finally { loading.value = false; }
    };
    const reset = () => { q.project_id = ''; q.status = ''; q.keyword = ''; load(); };

    const dlg = reactive({ visible: false, isEdit: false, form: {} });
    const emptyForm = () => ({ project_id: '', bid_no: '', title: '', method: '公开招标',
      budget: 0, win_amount: null, publish_date: '', signup_deadline: '', bid_open_date: '',
      agency: '', winner: '', content: '', status: '草稿' });
    const openAdd = () => { dlg.isEdit = false; dlg.form = emptyForm(); dlg.visible = true; };
    const openEdit = (row) => { dlg.isEdit = true; dlg.form = { ...row }; dlg.visible = true; };
    const save = async () => {
      if (!dlg.form.project_id || !dlg.form.title) { ElementPlus.ElMessage.warning('所属项目和招标名称必填'); return; }
      if (dlg.isEdit) {
        if (isAdmin()) {
          const resp = await http.put('/bids/' + dlg.form.id, dlg.form);
          notifySave(resp, '保存成功');
        } else {
          await submitChange('bid', dlg.form.id, dlg.form);
          ElementPlus.ElMessage.success('修改已提交，等待管理员确认后生效');
          notifyCrChanged();
        }
      } else {
        const resp = await http.post('/bids', dlg.form);
        notifySave(resp, '招标信息已新增');
      }
      dlg.visible = false; load();
    };
    const remove = (row) => {
      ElementPlus.ElMessageBox.confirm(`确定删除招标信息「${row.title}」吗？`, '删除确认', { type: 'warning' })
        .then(async () => {
          await http.delete('/bids/' + row.id);
          ElementPlus.ElMessage.success('已删除'); load();
        }).catch(() => {});
    };

    onMounted(async () => {
      projects.value = await http.get('/projects/all');
      load();
    });
    const doExport = () => {
      const p = new URLSearchParams({ keyword: q.keyword || '', status: q.status || '', project_id: q.project_id || '', export: 'csv' });
      exportCSV('/bids?' + p.toString(), '招标列表');
    };
    return { CFG, tagType, fmt, isAdmin, Search, Plus, RefreshLeft, Download,
      list, total, projects, q, loading, load, reset, doExport,
      dlg, openAdd, openEdit, save, remove };
  }
};
