/* 合同管理 */
window.Views = window.Views || {};

Views.Contracts = {
  template: `
    <div class="page-container">
      <div class="search-bar">
        <el-form :inline="true">
          <el-form-item label="所属项目">
            <el-select v-model="q.project_id" placeholder="全部项目" clearable filterable style="width:240px" @change="load">
              <el-option v-for="p in projects" :key="p.id" :label="p.name" :value="p.id" />
            </el-select>
          </el-form-item>
          <el-form-item label="状态">
            <el-select v-model="q.status" placeholder="全部状态" clearable style="width:130px" @change="load">
              <el-option v-for="s in CFG.contractStatuses" :key="s" :label="s" :value="s" />
            </el-select>
          </el-form-item>
          <el-form-item label="关键词">
            <el-input v-model="q.keyword" placeholder="名称/编号/乙方" clearable style="width:210px" @keyup.enter="load" />
          </el-form-item>
          <el-form-item>
            <el-button type="primary" :icon="Search" @click="load">查询</el-button>
            <el-button :icon="RefreshLeft" @click="reset">重置</el-button>
          </el-form-item>
        </el-form>
      </div>

      <div class="table-card">
        <div class="table-toolbar">
          <strong>合同列表（共 {{ total }} 份）</strong>
          <div>
            <el-button :icon="Download" @click="doExport">导出</el-button>
            <el-button type="primary" :icon="Plus" @click="openAdd">新增合同</el-button>
          </div>
        </div>
        <el-table :data="list" v-loading="loading" border stripe size="small">
          <el-table-column prop="contract_no" label="合同编号" width="150" />
          <el-table-column prop="name" label="合同名称" min-width="230" show-overflow-tooltip />
          <el-table-column prop="project_name" label="所属项目" min-width="190" show-overflow-tooltip />
          <el-table-column prop="party_a" label="甲方" min-width="160" show-overflow-tooltip />
          <el-table-column prop="party_b" label="乙方" min-width="190" show-overflow-tooltip />
          <el-table-column prop="amount" label="金额(万元)" width="105" align="right">
            <template #default="{row}">{{ fmt(row.amount) }}</template>
          </el-table-column>
          <el-table-column label="已付/待付" width="150" align="center">
            <template #default="{row}">
              <span style="color:#67c23a">{{ fmt(row.paid_amount) }}</span>
              <span class="muted"> / {{ fmt((row.amount||0)-(row.paid_amount||0)) }}</span>
            </template>
          </el-table-column>
          <el-table-column prop="sign_date" label="签订日期" width="105" />
          <el-table-column label="履约期" width="185">
            <template #default="{row}"><span class="muted">{{ row.start_date }} ~ {{ row.end_date }}</span></template>
          </el-table-column>
          <el-table-column label="状态" width="90">
            <template #default="{row}"><el-tag size="small" :type="tagType(row.status)">{{ row.status }}</el-tag></template>
          </el-table-column>
          <el-table-column label="操作" width="170" fixed="right">
            <template #default="{row}">
              <el-button link type="primary" size="small" @click="openPay(row)">付款</el-button>
              <el-button link type="primary" size="small" @click="openEdit(row)">编辑</el-button>
              <el-button v-if="isAdmin()" link type="danger" size="small" @click="remove(row)">删除</el-button>
              <el-tooltip v-else content="仅管理员可删除" placement="top">
                <el-button link type="danger" size="small" disabled>删除</el-button>
              </el-tooltip>
            </template>
          </el-table-column>
        </el-table>
      </div>

      <!-- 新增/编辑 -->
      <el-dialog v-model="dlg.visible" :title="dlg.isEdit?'编辑合同':'新增合同'" width="760px">
        <el-alert v-if="dlg.isEdit && !isAdmin()" type="warning" :closable="false" show-icon
          title="您提交的修改将进入「变更审批」，由管理员确认后生效。" style="margin-bottom:14px" />
        <el-form :model="dlg.form" label-width="104px">
          <el-row :gutter="12">
            <el-col :span="12">
              <el-form-item label="所属项目" required>
                <el-select v-model="dlg.form.project_id" filterable style="width:100%" @change="onProjectChange">
                  <el-option v-for="p in projects" :key="p.id" :label="p.name" :value="p.id" />
                </el-select>
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item label="关联招标">
                <el-select v-model="dlg.form.bid_id" clearable style="width:100%" placeholder="可选择已定标招标">
                  <el-option v-for="b in projectBids" :key="b.id" :label="b.title" :value="b.id" />
                </el-select>
              </el-form-item>
            </el-col>
            <el-col :span="12"><el-form-item label="合同编号"><el-input v-model="dlg.form.contract_no" /></el-form-item></el-col>
            <el-col :span="12">
              <el-form-item label="合同状态">
                <el-select v-model="dlg.form.status" style="width:100%">
                  <el-option v-for="s in CFG.contractStatuses" :key="s" :label="s" :value="s" />
                </el-select>
              </el-form-item>
            </el-col>
            <el-col :span="24"><el-form-item label="合同名称" required><el-input v-model="dlg.form.name" /></el-form-item></el-col>
            <el-col :span="12"><el-form-item label="甲方(发包人)"><el-input v-model="dlg.form.party_a" /></el-form-item></el-col>
            <el-col :span="12"><el-form-item label="乙方(承包人)"><el-input v-model="dlg.form.party_b" /></el-form-item></el-col>
            <el-col :span="12"><el-form-item label="合同金额(万元)"><el-input-number v-model="dlg.form.amount" :min="0" :precision="2" style="width:100%" /></el-form-item></el-col>
            <el-col :span="12"><el-form-item label="签订日期"><el-date-picker v-model="dlg.form.sign_date" type="date" value-format="YYYY-MM-DD" style="width:100%" /></el-form-item></el-col>
            <el-col :span="12"><el-form-item label="开始日期"><el-date-picker v-model="dlg.form.start_date" type="date" value-format="YYYY-MM-DD" style="width:100%" /></el-form-item></el-col>
            <el-col :span="12"><el-form-item label="结束日期"><el-date-picker v-model="dlg.form.end_date" type="date" value-format="YYYY-MM-DD" style="width:100%" /></el-form-item></el-col>
            <el-col :span="24"><el-form-item label="合同内容"><el-input v-model="dlg.form.content" type="textarea" :rows="3" /></el-form-item></el-col>
          </el-row>
        </el-form>
        <template #footer>
          <el-button @click="dlg.visible=false">取消</el-button>
          <el-button type="primary" @click="save">保存</el-button>
        </template>
      </el-dialog>

      <!-- 付款管理 -->
      <el-dialog v-model="pay.visible" :title="'付款记录 - ' + (pay.contract.name||'')" width="720px">
        <el-descriptions :column="3" border size="small" style="margin-bottom:14px">
          <el-descriptions-item label="合同金额">{{ fmt(pay.contract.amount) }} 万元</el-descriptions-item>
          <el-descriptions-item label="已付金额"><span style="color:#67c23a">{{ fmt(pay.paidSum) }} 万元</span></el-descriptions-item>
          <el-descriptions-item label="待付金额"><span style="color:#e6a23c">{{ fmt((pay.contract.amount||0)-pay.paidSum) }} 万元</span></el-descriptions-item>
        </el-descriptions>
        <el-table :data="pay.list" size="small" border style="margin-bottom:14px">
          <el-table-column prop="pay_date" label="付款日期" width="120" />
          <el-table-column prop="stage" label="阶段" width="100">
            <template #default="{row}"><el-tag size="small">{{ row.stage || '—' }}</el-tag></template>
          </el-table-column>
          <el-table-column prop="amount" label="金额(万元)" width="120" align="right" />
          <el-table-column prop="note" label="备注" min-width="200" show-overflow-tooltip />
          <el-table-column label="操作" width="80">
            <template #default="{row}">
              <el-button v-if="isAdmin()" link type="danger" size="small" @click="delPay(row)">删除</el-button>
              <span v-else class="muted">—</span>
            </template>
          </el-table-column>
        </el-table>
        <el-divider content-position="left">登记付款</el-divider>
        <el-form :inline="true">
          <el-form-item label="日期"><el-date-picker v-model="pay.form.pay_date" type="date" value-format="YYYY-MM-DD" style="width:150px" /></el-form-item>
          <el-form-item label="阶段">
            <el-select v-model="pay.form.stage" style="width:110px">
              <el-option v-for="s in CFG.payStages" :key="s" :label="s" :value="s" />
            </el-select>
          </el-form-item>
          <el-form-item label="金额"><el-input-number v-model="pay.form.amount" :min="0" :precision="2" style="width:140px" /></el-form-item>
          <el-form-item label="备注" style="margin-right:0"><el-input v-model="pay.form.note" style="width:180px" /></el-form-item>
          <el-form-item><el-button type="primary" :icon="Plus" @click="addPay">添加</el-button></el-form-item>
        </el-form>
      </el-dialog>
    </div>`,
  setup() {
    const { Search, Plus, RefreshLeft, Download } = ElementPlusIconsVue;
    const loading = ref(false);
    const list = ref([]);
    const total = ref(0);
    const projects = ref([]);
    const q = reactive({ project_id: '', status: '', keyword: '' });
    const fmt = (v) => (v == null ? '' : Number(v || 0).toLocaleString('zh-CN', { maximumFractionDigits: 2 }));

    const load = async () => {
      loading.value = true;
      try {
        const params = {};
        Object.keys(q).forEach(k => { if (q[k] !== '') params[k] = q[k]; });
        const r = await http.get('/contracts', { params });
        list.value = r.list; total.value = r.total;
      } finally { loading.value = false; }
    };
    const reset = () => { q.project_id = ''; q.status = ''; q.keyword = ''; load(); };

    const dlg = reactive({ visible: false, isEdit: false, form: {} });
    const projectBids = ref([]);
    const emptyForm = () => ({ project_id: '', bid_id: null, contract_no: '', name: '',
      party_a: '', party_b: '', amount: 0, sign_date: '', start_date: '', end_date: '',
      status: '待签订', content: '' });
    const onProjectChange = async (pid) => {
      dlg.form.bid_id = null;
      projectBids.value = [];
      if (pid) {
        const r = await http.get('/bids', { params: { project_id: pid } });
        projectBids.value = r.list;
      }
    };
    const openAdd = () => { dlg.isEdit = false; dlg.form = emptyForm(); projectBids.value = []; dlg.visible = true; };
    const openEdit = async (row) => {
      dlg.isEdit = true; dlg.form = { ...row };
      const r = await http.get('/bids', { params: { project_id: row.project_id } });
      projectBids.value = r.list;
      dlg.visible = true;
    };
    const save = async () => {
      if (!dlg.form.project_id || !dlg.form.name) { ElementPlus.ElMessage.warning('所属项目和合同名称必填'); return; }
      if (dlg.isEdit) {
        if (isAdmin()) {
          const resp = await http.put('/contracts/' + dlg.form.id, dlg.form);
          notifySave(resp, '保存成功');
        } else {
          await submitChange('contract', dlg.form.id, dlg.form);
          ElementPlus.ElMessage.success('修改已提交，等待管理员确认后生效');
          notifyCrChanged();
        }
      } else {
        const resp = await http.post('/contracts', dlg.form);
        notifySave(resp, '合同已新增');
      }
      dlg.visible = false; load();
    };
    const remove = (row) => {
      ElementPlus.ElMessageBox.confirm(`确定删除合同「${row.name}」吗？付款记录将一并删除！`, '删除确认', { type: 'warning' })
        .then(async () => {
          await http.delete('/contracts/' + row.id);
          ElementPlus.ElMessage.success('已删除'); load();
        }).catch(() => {});
    };

    /* 付款 */
    const pay = reactive({ visible: false, contract: {}, list: [], paidSum: 0,
      form: { pay_date: '', stage: '进度款', amount: 0, note: '' } });
    const openPay = async (row) => {
      pay.contract = row; pay.visible = true;
      pay.form = { pay_date: new Date().toISOString().slice(0, 10), stage: '进度款', amount: 0, note: '' };
      await loadPay();
    };
    const loadPay = async () => {
      pay.list = await http.get(`/contracts/${pay.contract.id}/payments`);
      pay.paidSum = pay.list.reduce((s, x) => s + (x.amount || 0), 0);
    };
    const addPay = async () => {
      if (!pay.form.amount) { ElementPlus.ElMessage.warning('请填写付款金额'); return; }
      await http.post(`/contracts/${pay.contract.id}/payments`, pay.form);
      ElementPlus.ElMessage.success('付款已登记');
      pay.form.amount = 0; pay.form.note = '';
      await loadPay(); load();
    };
    const delPay = (row) => {
      ElementPlus.ElMessageBox.confirm('确定删除该笔付款记录吗？', '删除确认', { type: 'warning' })
        .then(async () => {
          await http.delete(`/contracts/${pay.contract.id}/payments/${row.id}`);
          await loadPay(); load();
        }).catch(() => {});
    };

    onMounted(async () => {
      projects.value = await http.get('/projects/all');
      load();
    });
    const doExport = () => {
      const p = new URLSearchParams({ keyword: q.keyword || '', status: q.status || '', project_id: q.project_id || '', export: 'csv' });
      exportCSV('/contracts?' + p.toString(), '合同列表');
    };
    return { CFG, tagType, fmt, isAdmin, Search, Plus, RefreshLeft, Download,
      list, total, projects, q, loading, load, reset, doExport,
      dlg, projectBids, onProjectChange, openAdd, openEdit, save, remove,
      pay, openPay, addPay, delPay };
  }
};
