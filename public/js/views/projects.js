/* 项目管理 */
window.Views = window.Views || {};

Views.Projects = {
  template: `
    <div class="page-container">
      <div class="search-bar">
        <el-form :inline="true">
          <el-form-item label="关键词">
            <el-input v-model="q.keyword" placeholder="名称/编号/负责人/地点" clearable style="width:220px" @keyup.enter="load(1)" />
          </el-form-item>
          <el-form-item label="状态">
            <el-select v-model="q.status" placeholder="全部" clearable style="width:130px">
              <el-option v-for="s in CFG.projectStatuses" :key="s" :label="s" :value="s" />
            </el-select>
          </el-form-item>
          <el-form-item>
            <el-button type="primary" :icon="Search" @click="load(1)">查询</el-button>
            <el-button :icon="RefreshLeft" @click="reset">重置</el-button>
          </el-form-item>
        </el-form>
      </div>

      <div class="table-card">
        <div class="table-toolbar">
          <strong>项目列表</strong>
          <div>
            <el-button :icon="Download" @click="doExport">导出</el-button>
            <el-button type="primary" :icon="Plus" @click="openAdd">新增项目</el-button>
          </div>
        </div>
        <el-table :data="list" v-loading="loading" border stripe size="small">
          <el-table-column prop="code" label="项目编号" width="120" />
          <el-table-column prop="name" label="项目名称" min-width="230" show-overflow-tooltip>
            <template #default="{row}">
              <el-link type="primary" @click="openDetail(row)">{{ row.name }}</el-link>
            </template>
          </el-table-column>
          <el-table-column prop="type" label="类型" width="130">
            <template #default="{row}"><el-tag size="small" effect="plain">{{ row.type }}</el-tag></template>
          </el-table-column>
          <el-table-column prop="location" label="建设地点" min-width="170" show-overflow-tooltip />
          <el-table-column prop="manager" label="负责人" width="90" />
          <el-table-column prop="budget" label="投资(万元)" width="100" align="right">
            <template #default="{row}">{{ fmt(row.budget) }}</template>
          </el-table-column>
          <el-table-column label="工期" width="185">
            <template #default="{row}"><span class="muted">{{ row.start_date }} ~ {{ row.end_date }}</span></template>
          </el-table-column>
          <el-table-column label="状态" width="90">
            <template #default="{row}"><el-tag size="small" :type="tagType(row.status)">{{ row.status }}</el-tag></template>
          </el-table-column>
          <el-table-column label="进度" width="110">
            <template #default="{row}">
              <el-progress v-if="row.latest_percent!=null" :percentage="row.latest_percent" :stroke-width="10" />
              <span v-else class="muted">未填报</span>
            </template>
          </el-table-column>
          <el-table-column label="计划度" width="92" align="center">
            <template #default="{row}">
              <span v-if="row.plan_done_weight==null" class="muted">未编制</span>
              <el-tooltip v-else content="计划任务加权完成度与填报进度偏差超过15%，请核对" placement="top" :disabled="!planDev(row)">
                <span :style="planDev(row)?'color:#f56c6c;font-weight:700;cursor:help':''">{{ row.plan_done_weight }}%</span>
              </el-tooltip>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="150" fixed="right">
            <template #default="{row}">
              <el-button link type="primary" size="small" @click="openDetail(row)">详情</el-button>
              <el-button link type="primary" size="small" @click="openEdit(row)">编辑</el-button>
              <el-button v-if="isAdmin()" link type="danger" size="small" @click="remove(row)">删除</el-button>
              <el-tooltip v-else content="仅管理员可删除项目" placement="top">
                <el-button link type="danger" size="small" disabled>删除</el-button>
              </el-tooltip>
            </template>
          </el-table-column>
        </el-table>
        <div class="pagination-bar">
          <el-pagination background layout="total,prev,pager,next,sizes" :total="total"
            v-model:current-page="q.page" v-model:page-size="q.pageSize"
            :page-sizes="[10,20,50]" @current-change="load()" @size-change="load(1)" />
        </div>
      </div>

      <!-- 新增/编辑 -->
      <el-dialog v-model="dlg.visible" :title="dlg.isEdit?'编辑项目':'新增项目'" width="720px">
        <el-alert v-if="dlg.isEdit && !isAdmin()" type="warning" :closable="false" show-icon
          title="您提交的修改不会立即生效，将进入「变更审批」，由管理员确认后生效。" style="margin-bottom:14px" />
        <el-form :model="dlg.form" label-width="96px">
          <el-row :gutter="12">
            <el-col :span="12"><el-form-item label="项目编号" required><el-input v-model="dlg.form.code" /></el-form-item></el-col>
            <el-col :span="12"><el-form-item label="项目名称" required><el-input v-model="dlg.form.name" /></el-form-item></el-col>
            <el-col :span="12">
              <el-form-item label="项目类型">
                <el-select v-model="dlg.form.type" style="width:100%">
                  <el-option v-for="t in CFG.projectTypes" :key="t" :label="t" :value="t" />
                </el-select>
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item label="项目状态">
                <el-select v-model="dlg.form.status" style="width:100%">
                  <el-option v-for="s in CFG.projectStatuses" :key="s" :label="s" :value="s" />
                </el-select>
              </el-form-item>
            </el-col>
            <el-col :span="12"><el-form-item label="建设地点"><el-input v-model="dlg.form.location" /></el-form-item></el-col>
            <el-col :span="12"><el-form-item label="建设单位"><el-input v-model="dlg.form.owner" /></el-form-item></el-col>
            <el-col :span="12"><el-form-item label="负责人"><el-input v-model="dlg.form.manager" /></el-form-item></el-col>
            <el-col :span="12"><el-form-item label="联系电话"><el-input v-model="dlg.form.phone" /></el-form-item></el-col>
            <el-col :span="12"><el-form-item label="总投资(万元)"><el-input-number v-model="dlg.form.budget" :min="0" :precision="2" style="width:100%" /></el-form-item></el-col>
            <el-col :span="12">
              <el-form-item label="开工日期"><el-date-picker v-model="dlg.form.start_date" type="date" value-format="YYYY-MM-DD" style="width:100%" /></el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item label="完工日期"><el-date-picker v-model="dlg.form.end_date" type="date" value-format="YYYY-MM-DD" style="width:100%" /></el-form-item>
            </el-col>
            <el-col :span="24"><el-form-item label="项目概况"><el-input v-model="dlg.form.description" type="textarea" :rows="3" /></el-form-item></el-col>
          </el-row>
        </el-form>
        <template #footer>
          <el-button @click="dlg.visible=false">取消</el-button>
          <el-button type="primary" @click="save">保存</el-button>
        </template>
      </el-dialog>

      <!-- 项目详情 -->
      <el-drawer v-model="detail.visible" size="72%" :title="detail.data?detail.data.name:''">
        <template v-if="detail.data">
          <el-alert v-for="(a,i) in detailAlerts" :key="i" :title="a" type="warning" show-icon :closable="false"
            style="margin-bottom:10px" />
          <el-descriptions :column="3" border size="small" style="margin-bottom:14px">
            <el-descriptions-item label="项目编号">{{ detail.data.code }}</el-descriptions-item>
            <el-descriptions-item label="项目类型">{{ detail.data.type }}</el-descriptions-item>
            <el-descriptions-item label="状态">
              <el-tag size="small" :type="tagType(detail.data.status)">{{ detail.data.status }}</el-tag>
            </el-descriptions-item>
            <el-descriptions-item label="建设地点">{{ detail.data.location }}</el-descriptions-item>
            <el-descriptions-item label="建设单位">{{ detail.data.owner }}</el-descriptions-item>
            <el-descriptions-item label="负责人/电话">{{ detail.data.manager }} {{ detail.data.phone }}</el-descriptions-item>
            <el-descriptions-item label="总投资">{{ fmt(detail.data.budget) }} 万元</el-descriptions-item>
            <el-descriptions-item label="工期">{{ detail.data.start_date }} 至 {{ detail.data.end_date }}</el-descriptions-item>
            <el-descriptions-item label="最新进度">{{ detail.data.latest_percent!=null?detail.data.latest_percent+'%':'未填报' }}</el-descriptions-item>
            <el-descriptions-item label="计划任务完成度">
              <span v-if="detail.data.plan_done_weight==null" class="muted">未编制计划</span>
              <span v-else :style="planDev(detail.data)?'color:#f56c6c;font-weight:700':''">{{ detail.data.plan_done_weight }}%</span>
            </el-descriptions-item>
            <el-descriptions-item label="项目概况" :span="3">{{ detail.data.description }}</el-descriptions-item>
          </el-descriptions>

          <el-tabs v-model="detail.tab">
            <el-tab-pane label="招标信息" name="bids">
              <el-table :data="detail.bids" size="small" border>
                <el-table-column prop="bid_no" label="招标编号" width="150" />
                <el-table-column prop="title" label="招标名称" min-width="200" show-overflow-tooltip />
                <el-table-column prop="method" label="方式" width="90" />
                <el-table-column prop="budget" label="控制价(万)" width="100" align="right" />
                <el-table-column prop="winner" label="中标单位" min-width="180" show-overflow-tooltip />
                <el-table-column label="状态" width="90">
                  <template #default="{row}"><el-tag size="small" :type="tagType(row.status)">{{ row.status }}</el-tag></template>
                </el-table-column>
              </el-table>
            </el-tab-pane>
            <el-tab-pane label="合同" name="contracts">
              <el-table :data="detail.contracts" size="small" border>
                <el-table-column prop="contract_no" label="合同编号" width="150" />
                <el-table-column prop="name" label="合同名称" min-width="200" show-overflow-tooltip />
                <el-table-column prop="party_b" label="乙方" min-width="180" show-overflow-tooltip />
                <el-table-column prop="amount" label="金额(万元)" width="100" align="right" />
                <el-table-column label="已付(万元)" width="100" align="right">
                  <template #default="{row}">{{ fmt(row.paid_amount) }}</template>
                </el-table-column>
                <el-table-column prop="sign_date" label="签订日期" width="105" />
                <el-table-column label="状态" width="90">
                  <template #default="{row}"><el-tag size="small" :type="tagType(row.status)">{{ row.status }}</el-tag></template>
                </el-table-column>
              </el-table>
            </el-tab-pane>
            <el-tab-pane label="进度填报" name="progress">
              <el-table :data="detail.records" size="small" border>
                <el-table-column prop="record_date" label="填报日期" width="105" />
                <el-table-column prop="period" label="报告期" width="130" />
                <el-table-column label="累计进度" width="170">
                  <template #default="{row}"><el-progress :percentage="row.percent" :stroke-width="10" /></template>
                </el-table-column>
                <el-table-column prop="work_done" label="本期完成" min-width="240" show-overflow-tooltip />
                <el-table-column prop="reporter" label="填报人" width="90" />
              </el-table>
            </el-tab-pane>
            <el-tab-pane label="里程碑" name="milestones">
              <el-table :data="detail.milestones" size="small" border>
                <el-table-column prop="name" label="里程碑" min-width="180" />
                <el-table-column prop="plan_date" label="计划日期" width="120" />
                <el-table-column prop="actual_date" label="实际日期" width="120" />
                <el-table-column label="状态" width="100">
                  <template #default="{row}"><el-tag size="small" :type="tagType(row.status)">{{ row.status }}</el-tag></template>
                </el-table-column>
              </el-table>
            </el-tab-pane>
            <el-tab-pane label="计划" name="plans">
              <el-table :data="detail.plans" size="small" border>
                <el-table-column prop="name" label="计划名称" min-width="220" show-overflow-tooltip />
                <el-table-column prop="year" label="年度" width="80" />
                <el-table-column label="周期" width="200">
                  <template #default="{row}"><span class="muted">{{ row.start_date }} ~ {{ row.end_date }}</span></template>
                </el-table-column>
                <el-table-column prop="owner" label="负责人" width="100" />
                <el-table-column label="状态" width="90">
                  <template #default="{row}"><el-tag size="small" :type="tagType(row.status)">{{ row.status }}</el-tag></template>
                </el-table-column>
              </el-table>
            </el-tab-pane>
            <el-tab-pane label="附件" name="attachments">
              <div style="margin-bottom:10px;display:flex;justify-content:space-between;align-items:center">
                <span class="muted">支持上传合同扫描件、招标文件、验收报告等文档（单个不超过 20MB）</span>
                <el-upload :show-file-list="false" :before-upload="beforeUpload"
                  :http-request="(opts) => uploadFile(detail.data.id, opts)" :disabled="!detail.data">
                  <el-button type="primary" size="small" :icon="Upload">上传附件</el-button>
                </el-upload>
              </div>
              <el-table :data="detail.attachments" size="small" border>
                <el-table-column prop="filename" label="文件名" min-width="220" show-overflow-tooltip />
                <el-table-column label="大小" width="100" align="right">
                  <template #default="{row}">{{ fmtSize(row.size) }}</template>
                </el-table-column>
                <el-table-column prop="uploaded_by_name" label="上传人" width="100" />
                <el-table-column prop="created_at" label="上传时间" width="160" />
                <el-table-column label="操作" width="140" fixed="right">
                  <template #default="{row}">
                    <el-button link type="primary" size="small" @click="downloadAtt(row)">下载</el-button>
                    <el-button v-if="isAdmin() || row.uploaded_by===user.id" link type="danger" size="small" @click="delAtt(row)">删除</el-button>
                  </template>
                </el-table-column>
              </el-table>
            </el-tab-pane>
          </el-tabs>
        </template>
      </el-drawer>
    </div>`,
  setup() {
    const { Search, Plus, RefreshLeft, Download, Upload } = ElementPlusIconsVue;
    const loading = ref(false);
    const list = ref([]);
    const total = ref(0);
    const q = reactive({ keyword: '', status: '', page: 1, pageSize: 10 });
    const fmt = (v) => (v == null ? '' : Number(v).toLocaleString('zh-CN', { maximumFractionDigits: 2 }));

    const load = async (p) => {
      if (p) q.page = p;
      loading.value = true;
      try {
        const r = await http.get('/projects', { params: q });
        list.value = r.list; total.value = r.total;
      } finally { loading.value = false; }
    };
    const reset = () => { q.keyword = ''; q.status = ''; load(1); };

    const dlg = reactive({ visible: false, isEdit: false, form: {} });
    const emptyForm = () => ({ code: '', name: '', type: '小流域综合治理', location: '', owner: '', manager: '',
      phone: '', budget: 0, start_date: '', end_date: '', status: '筹备中', description: '' });
    const openAdd = () => { dlg.isEdit = false; dlg.form = emptyForm(); dlg.visible = true; };
    const openEdit = (row) => { dlg.isEdit = true; dlg.form = { ...row }; dlg.visible = true; };
    const save = async () => {
      if (!dlg.form.code || !dlg.form.name) { ElementPlus.ElMessage.warning('项目编号和名称必填'); return; }
      if (dlg.isEdit) {
        if (isAdmin()) {
          const resp = await http.put('/projects/' + dlg.form.id, dlg.form);
          notifySave(resp, '保存成功');
        } else {
          await submitChange('project', dlg.form.id, dlg.form);
          ElementPlus.ElMessage.success('修改已提交，等待管理员确认后生效');
          notifyCrChanged();
        }
      } else {
        const resp = await http.post('/projects', dlg.form);
        notifySave(resp, '项目已新增');
      }
      dlg.visible = false; load();
    };
    const remove = (row) => {
      ElementPlus.ElMessageBox.confirm(`确定删除项目「${row.name}」吗？关联的招标、合同、进度、计划等数据将一并删除！`, '删除确认', { type: 'warning' })
        .then(async () => {
          await http.delete('/projects/' + row.id);
          ElementPlus.ElMessage.success('已删除'); load();
        }).catch(() => {});
    };

    const detail = reactive({ visible: false, data: null, tab: 'bids',
      bids: [], contracts: [], records: [], milestones: [], plans: [], attachments: [] });
    const user = currentUser();
    const openDetail = async (row) => {
      Object.assign(detail, { visible: true, data: row, tab: 'bids', bids: [], contracts: [], records: [], milestones: [], plans: [], attachments: [] });
      const id = row.id;
      const [b, c, r, m, pl, att] = await Promise.all([
        http.get('/bids', { params: { project_id: id } }),
        http.get('/contracts', { params: { project_id: id } }),
        http.get('/progress/records', { params: { project_id: id } }),
        http.get('/progress/milestones', { params: { project_id: id } }),
        http.get('/plans', { params: { project_id: id } }),
        http.get('/attachments', { params: { module: 'project', target_id: id } })
      ]);
      detail.bids = b.list; detail.contracts = c.list; detail.records = r;
      detail.milestones = m; detail.plans = pl.list; detail.attachments = att;
    };

    /* 进度填报 vs 计划任务加权完成度：偏差超过 15 个百分点视为异常 */
    const planDev = (row) => {
      if (!row || row.latest_percent == null || row.plan_done_weight == null) return false;
      return Math.abs(Number(row.latest_percent) - Number(row.plan_done_weight)) > 15;
    };
    const detailAlerts = computed(() => {
      if (!detail.visible || !detail.data) return [];
      const d = detail.data;
      const alerts = [];
      const pct = d.latest_percent ?? (detail.records[0]?.percent ?? null);
      let planDone = d.plan_done_weight;
      if (planDone == null && detail.plans.length) {
        planDone = Math.round(detail.plans.reduce((s, p) => s + (p.done_weight || 0), 0) / detail.plans.length * 10) / 10;
      }
      if (d.status === '施工中' && planDone == null) {
        alerts.push('该项目处于“施工中”，但计划模块尚未编制任何计划，无法核对任务完成情况。');
      }
      if (pct != null && planDone != null && Math.abs(pct - planDone) > 15) {
        const diff = pct - planDone;
        alerts.push(`进度核对：最新进度填报 ${pct}%，计划任务加权完成度 ${planDone}%，偏差 ${diff > 0 ? '+' : ''}${diff} 个百分点。`
          + (diff > 0 ? '形象进度快于任务节点，请及时在计划模块更新任务实际状态。'
                       : '任务完成度高于形象进度，请核实进度填报是否遗漏。'));
      }
      return alerts;
    });

    onMounted(() => load());
    const doExport = () => {
      const p = new URLSearchParams({ keyword: q.keyword || '', status: q.status || '', export: 'csv' });
      exportCSV('/projects?' + p.toString(), '项目列表');
    };

    /* ---------- 附件 ---------- */
    const fmtSize = (b) => {
      if (!b) return '';
      if (b < 1024) return b + ' B';
      if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
      return (b / 1024 / 1024).toFixed(2) + ' MB';
    };
    const beforeUpload = (file) => {
      if (file.size > 20 * 1024 * 1024) {
        ElementPlus.ElMessage.error('文件大小不能超过 20MB');
        return false;
      }
      return true;
    };
    const uploadFile = async (projectId, opts) => {
      const fd = new FormData();
      fd.append('file', opts.file);
      try {
        const token = localStorage.getItem('swc_token');
        const r = await fetch('/api/attachments?module=project&target_id=' + projectId, {
          method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: fd
        });
        if (!r.ok) { const e = await r.json(); throw new Error(e.message || '上传失败'); }
        const saved = await r.json();
        detail.attachments.unshift(saved);
        ElementPlus.ElMessage.success('上传成功');
        opts.onSuccess(saved);
      } catch (e) {
        ElementPlus.ElMessage.error(e.message || '上传失败');
        opts.onError(e);
      }
    };
    const downloadAtt = (row) => {
      const token = localStorage.getItem('swc_token');
      fetch('/api/attachments/' + row.id + '/download', { headers: { Authorization: 'Bearer ' + token } })
        .then(r => r.blob()).then(blob => {
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = row.filename;
          a.click();
          URL.revokeObjectURL(a.href);
        });
    };
    const delAtt = (row) => {
      ElementPlus.ElMessageBox.confirm(`确定删除附件「${row.filename}」吗？`, '删除确认', { type: 'warning' })
        .then(async () => {
          await http.delete('/attachments/' + row.id);
          detail.attachments = detail.attachments.filter(a => a.id !== row.id);
          ElementPlus.ElMessage.success('已删除');
        }).catch(() => {});
    };

    return {
      CFG, tagType, fmt, isAdmin, Search, Plus, RefreshLeft, Download, Upload,
      list, total, q, loading, load, reset, doExport,
      dlg, openAdd, openEdit, save, remove, detail, openDetail,
      planDev, detailAlerts, user,
      fmtSize, beforeUpload, uploadFile, downloadAtt, delAtt
    };
  }
};
