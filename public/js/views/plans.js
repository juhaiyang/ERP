/* 计划管理：计划 + 任务 + 甘特图 */
window.Views = window.Views || {};

Views.Plans = {
  template: `
    <div class="page-container">
      <!-- 概览：项目计划覆盖卡片 -->
      <template v-if="viewMode==='overview'">
        <div class="search-bar">
          <el-form :inline="true">
            <el-form-item label="关键词">
              <el-input v-model="oq.keyword" placeholder="项目名称/编号/负责人" clearable style="width:240px" @keyup.enter="loadOverview" />
            </el-form-item>
            <el-form-item label="状态">
              <el-select v-model="oq.status" placeholder="全部" clearable style="width:130px" @change="loadOverview">
                <el-option v-for="s in CFG.projectStatuses" :key="s" :label="s" :value="s" />
              </el-select>
            </el-form-item>
            <el-form-item>
              <el-button type="primary" :icon="Search" @click="loadOverview">查询</el-button>
              <el-button :icon="RefreshLeft" @click="resetO">重置</el-button>
            </el-form-item>
            <el-form-item>
              <el-radio-group v-model="viewMode" size="small">
                <el-radio-button label="overview">项目概览</el-radio-button>
                <el-radio-button label="list">计划列表</el-radio-button>
              </el-radio-group>
            </el-form-item>
          </el-form>
        </div>

        <div class="table-card">
          <div class="table-toolbar">
            <strong>项目计划概览（共 {{ olist.length }} 个项目）</strong>
            <el-button :icon="Download" @click="exportOverview">导出</el-button>
          </div>
          <el-row :gutter="14" v-loading="oloading">
            <el-col v-for="p in olist" :key="p.id" :span="6" style="margin-bottom:14px">
              <el-card class="proj-card" shadow="hover" @click="enter(p)">
                <div class="proj-card-head">
                  <div class="proj-card-title" :title="p.name">{{ p.name }}</div>
                  <el-tag size="small" :type="tagType(p.status)">{{ p.status }}</el-tag>
                </div>
                <div class="proj-card-code muted">{{ p.code }} · {{ p.manager || '—' }}</div>
                <div class="proj-card-progress">
                  <div class="proj-card-progress-label">
                    <span>计划完成度</span>
                    <span :class="{'text-danger': !p.plan_count}">{{ p.plan_count ? (p.done_weight ?? 0) + '%' : '未编制计划' }}</span>
                  </div>
                  <el-progress :percentage="p.done_weight ?? 0" :stroke-width="8" :show-text="false" />
                </div>
                <div class="proj-card-meta">
                  <span><el-icon><Document /></el-icon> {{ p.plan_count || 0 }} 个计划</span>
                  <span><el-icon><Flag /></el-icon> {{ p.task_count || 0 }} 项任务</span>
                </div>
                <div class="proj-card-foot muted">
                  {{ p.start_date || '—' }} ~ {{ p.end_date || '—' }}
                </div>
              </el-card>
            </el-col>
          </el-row>
          <el-empty v-if="!olist.length && !oloading" description="暂无项目" />
        </div>
      </template>

      <!-- 列表：计划列表 -->
      <template v-else>
        <div class="search-bar">
          <el-form :inline="true">
            <el-form-item label="所属项目">
              <el-select v-model="q.project_id" placeholder="全部项目" clearable filterable style="width:260px" @change="load">
                <el-option v-for="p in projects" :key="p.id" :label="p.name" :value="p.id" />
              </el-select>
            </el-form-item>
            <el-form-item label="状态">
              <el-select v-model="q.status" placeholder="全部状态" clearable style="width:130px" @change="load">
                <el-option v-for="s in CFG.planStatuses" :key="s" :label="s" :value="s" />
              </el-select>
            </el-form-item>
            <el-form-item>
              <el-radio-group v-model="viewMode" size="small">
                <el-radio-button label="overview">项目概览</el-radio-button>
                <el-radio-button label="list">计划列表</el-radio-button>
              </el-radio-group>
            </el-form-item>
            <el-form-item>
              <el-button :icon="Download" @click="doExport">导出</el-button>
              <el-button type="primary" :icon="Plus" @click="openAdd">编制计划</el-button>
            </el-form-item>
          </el-form>
        </div>

        <el-alert v-if="q.project_id && !q.status && !list.length && !loading" type="warning" :closable="false" show-icon
          title="该项目尚未编制计划，点击右上角「编制计划」为其创建" style="margin-bottom:12px" />

        <div class="table-card">
        <el-table :data="list" v-loading="loading" border stripe size="small">
          <el-table-column prop="name" label="计划名称" min-width="240" show-overflow-tooltip>
            <template #default="{row}">
              <el-link type="primary" @click="openDetail(row)">{{ row.name }}</el-link>
            </template>
          </el-table-column>
          <el-table-column prop="project_name" label="所属项目" min-width="200" show-overflow-tooltip />
          <el-table-column prop="year" label="年度" width="80" />
          <el-table-column label="周期" width="195">
            <template #default="{row}"><span class="muted">{{ row.start_date }} ~ {{ row.end_date }}</span></template>
          </el-table-column>
          <el-table-column prop="owner" label="负责人" width="90" />
          <el-table-column label="任务完成度(权重)" width="170">
            <template #default="{row}">
              <el-progress :percentage="Number(row.done_weight||0)" :stroke-width="10" />
            </template>
          </el-table-column>
          <el-table-column label="状态" width="90">
            <template #default="{row}"><el-tag size="small" :type="tagType(row.status)">{{ row.status }}</el-tag></template>
          </el-table-column>
          <el-table-column label="操作" width="200" fixed="right">
            <template #default="{row}">
              <el-button link type="primary" size="small" @click="openDetail(row)">任务/甘特图</el-button>
              <el-button link type="primary" size="small" @click="openEdit(row)">编辑</el-button>
              <el-button v-if="isAdmin()" link type="danger" size="small" @click="remove(row)">删除</el-button>
              <el-tooltip v-else content="仅管理员可删除" placement="top">
                <el-button link type="danger" size="small" disabled>删除</el-button>
              </el-tooltip>
            </template>
          </el-table-column>
        </el-table>
      </div>
      </template>

      <!-- 计划新增/编辑 -->
      <el-dialog v-model="dlg.visible" :title="dlg.isEdit?'编辑计划':'编制计划'" width="640px">
        <el-alert v-if="dlg.isEdit && !isAdmin()" type="warning" :closable="false" show-icon
          title="您提交的修改将进入「变更审批」，由管理员确认后生效。" style="margin-bottom:14px" />
        <el-form :model="dlg.form" label-width="96px">
          <el-form-item label="所属项目" required>
            <el-select v-model="dlg.form.project_id" filterable style="width:100%">
              <el-option v-for="p in projects" :key="p.id" :label="p.name" :value="p.id" />
            </el-select>
          </el-form-item>
          <el-form-item label="计划名称" required><el-input v-model="dlg.form.name" /></el-form-item>
          <el-row :gutter="12">
            <el-col :span="12"><el-form-item label="年度">
              <el-input-number v-model="dlg.form.year" :min="2024" :max="2035" style="width:100%" />
            </el-form-item></el-col>
            <el-col :span="12"><el-form-item label="负责人"><el-input v-model="dlg.form.owner" /></el-form-item></el-col>
            <el-col :span="12"><el-form-item label="开始日期">
              <el-date-picker v-model="dlg.form.start_date" type="date" value-format="YYYY-MM-DD" style="width:100%" />
            </el-form-item></el-col>
            <el-col :span="12"><el-form-item label="结束日期">
              <el-date-picker v-model="dlg.form.end_date" type="date" value-format="YYYY-MM-DD" style="width:100%" />
            </el-form-item></el-col>
            <el-col :span="24"><el-form-item label="状态">
              <el-select v-model="dlg.form.status" style="width:100%">
                <el-option v-for="s in CFG.planStatuses" :key="s" :label="s" :value="s" />
              </el-select>
            </el-form-item></el-col>
            <el-col :span="24"><el-form-item label="说明">
              <el-input v-model="dlg.form.description" type="textarea" :rows="3" />
            </el-form-item></el-col>
          </el-row>
        </el-form>
        <template #footer>
          <el-button @click="dlg.visible=false">取消</el-button>
          <el-button type="primary" @click="save">保存</el-button>
        </template>
      </el-dialog>

      <!-- 计划详情：任务 + 甘特图 -->
      <el-drawer v-model="detail.visible" size="86%" :title="detail.plan.name">
        <el-descriptions :column="4" border size="small" style="margin-bottom:12px">
          <el-descriptions-item label="所属项目">{{ detail.plan.project_name }}</el-descriptions-item>
          <el-descriptions-item label="负责人">{{ detail.plan.owner }}</el-descriptions-item>
          <el-descriptions-item label="周期">{{ detail.plan.start_date }} ~ {{ detail.plan.end_date }}</el-descriptions-item>
          <el-descriptions-item label="状态">
            <el-tag size="small" :type="tagType(detail.plan.status)">{{ detail.plan.status }}</el-tag>
          </el-descriptions-item>
        </el-descriptions>

        <div class="detail-section">
          <h4>甘特图（任务时间线）</h4>
          <div class="gantt" v-if="gantt.months.length">
            <div class="gantt-row gantt-head">
              <div class="gantt-label">任务 \\ 时间</div>
              <div class="gantt-track">
                <div v-for="m in gantt.months" :key="m.label" class="gantt-month"
                  :style="{ left: m.left + '%' }">{{ m.label }}</div>
              </div>
            </div>
            <div class="gantt-row" v-for="t in detail.plan.tasks" :key="t.id">
              <div class="gantt-label" :title="t.name">
                <el-tag size="small" :type="tagType(t.status)" style="margin-right:4px">{{ t.status }}</el-tag>{{ t.name }}
              </div>
              <div class="gantt-track">
                <div class="gantt-bar" :class="barClass(t)" :style="barStyle(t)"
                  :title="(t.owner||'') + ' ' + t.start_date + ' ~ ' + t.end_date">
                  {{ t.owner }}
                </div>
              </div>
            </div>
            <div class="gantt-row">
              <div class="gantt-label"><span class="muted">今日 ({{ today }})</span></div>
              <div class="gantt-track">
                <div class="gantt-today" :style="{ left: gantt.todayLeft + '%' }" v-if="gantt.todayLeft!=null"></div>
              </div>
            </div>
          </div>
          <el-empty v-else description="暂无任务，请先添加" :image-size="60" />
        </div>

        <div class="detail-section">
          <div class="table-toolbar">
            <h4 style="margin:0">任务分解（WBS）</h4>
            <el-button type="primary" size="small" :icon="Plus" @click="openTask()">新增任务</el-button>
          </div>
          <el-table :data="detail.plan.tasks" border size="small">
            <el-table-column prop="name" label="任务名称" min-width="200" show-overflow-tooltip />
            <el-table-column prop="owner" label="负责人" width="90" />
            <el-table-column prop="weight" label="权重(%)" width="90" align="right" />
            <el-table-column label="计划起止" width="200">
              <template #default="{row}"><span class="muted">{{ row.start_date }} ~ {{ row.end_date }}</span></template>
            </el-table-column>
            <el-table-column label="实际起止" width="200">
              <template #default="{row}"><span class="muted">{{ row.actual_start || '—' }} ~ {{ row.actual_end || '—' }}</span></template>
            </el-table-column>
            <el-table-column label="状态" width="90">
              <template #default="{row}"><el-tag size="small" :type="tagType(row.status)">{{ row.status }}</el-tag></template>
            </el-table-column>
            <el-table-column prop="remark" label="备注" min-width="160" show-overflow-tooltip />
            <el-table-column label="操作" width="130">
              <template #default="{row}">
                <el-button link type="primary" size="small" @click="openTask(row)">编辑</el-button>
                <el-button v-if="isAdmin()" link type="danger" size="small" @click="delTask(row)">删除</el-button>
                <el-tooltip v-else content="仅管理员可删除" placement="top">
                  <el-button link type="danger" size="small" disabled>删除</el-button>
                </el-tooltip>
              </template>
            </el-table-column>
          </el-table>
        </div>
      </el-drawer>

      <!-- 任务弹窗 -->
      <el-dialog v-model="taskDlg.visible" :title="taskDlg.isEdit?'编辑任务':'新增任务'" width="620px" append-to-body>
        <el-alert v-if="taskDlg.isEdit && !isAdmin()" type="warning" :closable="false" show-icon
          title="您提交的修改将进入「变更审批」，由管理员确认后生效。" style="margin-bottom:14px" />
        <el-form :model="taskDlg.form" label-width="96px">
          <el-form-item label="任务名称" required><el-input v-model="taskDlg.form.name" /></el-form-item>
          <el-row :gutter="12">
            <el-col :span="12"><el-form-item label="负责人"><el-input v-model="taskDlg.form.owner" /></el-form-item></el-col>
            <el-col :span="12"><el-form-item label="权重(%)">
              <el-input-number v-model="taskDlg.form.weight" :min="0" :max="100" :precision="1" style="width:100%" />
            </el-form-item></el-col>
            <el-col :span="12"><el-form-item label="计划开始">
              <el-date-picker v-model="taskDlg.form.start_date" type="date" value-format="YYYY-MM-DD" style="width:100%" />
            </el-form-item></el-col>
            <el-col :span="12"><el-form-item label="计划完成">
              <el-date-picker v-model="taskDlg.form.end_date" type="date" value-format="YYYY-MM-DD" style="width:100%" />
            </el-form-item></el-col>
            <el-col :span="12"><el-form-item label="实际开始">
              <el-date-picker v-model="taskDlg.form.actual_start" type="date" value-format="YYYY-MM-DD" style="width:100%" />
            </el-form-item></el-col>
            <el-col :span="12"><el-form-item label="实际完成">
              <el-date-picker v-model="taskDlg.form.actual_end" type="date" value-format="YYYY-MM-DD" style="width:100%" />
            </el-form-item></el-col>
            <el-col :span="24"><el-form-item label="状态">
              <el-radio-group v-model="taskDlg.form.status">
                <el-radio-button v-for="s in CFG.taskStatuses" :key="s" :label="s" />
              </el-radio-group>
            </el-form-item></el-col>
            <el-col :span="24"><el-form-item label="备注">
              <el-input v-model="taskDlg.form.remark" type="textarea" :rows="2" />
            </el-form-item></el-col>
          </el-row>
        </el-form>
        <template #footer>
          <el-button @click="taskDlg.visible=false">取消</el-button>
          <el-button type="primary" @click="saveTask">保存</el-button>
        </template>
      </el-dialog>
    </div>`,
  setup() {
    const { Plus, Download, Search, RefreshLeft, Document, Flag } = ElementPlusIconsVue;
    const loading = ref(false);
    const list = ref([]);
    const projects = ref([]);
    const q = reactive({ project_id: '', status: '' });
    const today = new Date().toISOString().slice(0, 10);

    /* 概览：项目计划覆盖卡片 */
    const viewMode = ref('overview');
    const oq = reactive({ keyword: '', status: '' });
    const olist = ref([]);
    const oloading = ref(false);
    const loadOverview = async () => {
      oloading.value = true;
      try {
        const params = {};
        if (oq.keyword) params.keyword = oq.keyword;
        if (oq.status) params.status = oq.status;
        const r = await http.get('/plans/overview', { params });
        olist.value = r.list;
      } finally { oloading.value = false; }
    };
    const resetO = () => { oq.keyword = ''; oq.status = ''; loadOverview(); };
    const exportOverview = () => {
      const p = new URLSearchParams({ keyword: oq.keyword || '', status: oq.status || '', export: 'csv' });
      exportCSV('/plans/overview?' + p.toString(), '项目计划概览');
    };
    /** 点击项目卡片 → 进入其计划列表；未编制计划的项目给出提示 */
    const enter = (p) => {
      q.project_id = p.id;
      viewMode.value = 'list';
      load();
      if (!p.plan_count) ElementPlus.ElMessage.info('该项目尚未编制计划，点击「编制计划」为其创建');
    };

    const load = async () => {
      loading.value = true;
      try {
        const params = {};
        if (q.project_id) params.project_id = q.project_id;
        if (q.status) params.status = q.status;
        const r = await http.get('/plans', { params });
        list.value = r.list;
      } finally { loading.value = false; }
    };

    const dlg = reactive({ visible: false, isEdit: false, form: {} });
    const openAdd = () => {
      dlg.isEdit = false;
      dlg.form = { project_id: q.project_id || '', name: '', year: new Date().getFullYear(),
        start_date: '', end_date: '', owner: '', status: '编制中', description: '' };
      dlg.visible = true;
    };
    const openEdit = (row) => { dlg.isEdit = true; dlg.form = { ...row }; dlg.visible = true; };
    const save = async () => {
      if (!dlg.form.project_id || !dlg.form.name) { ElementPlus.ElMessage.warning('所属项目和计划名称必填'); return; }
      if (dlg.isEdit) {
        if (isAdmin()) {
          const resp = await http.put('/plans/' + dlg.form.id, dlg.form);
          notifySave(resp, '保存成功');
        } else {
          await submitChange('plan', dlg.form.id, dlg.form);
          ElementPlus.ElMessage.success('修改已提交，等待管理员确认后生效');
          notifyCrChanged();
        }
      } else {
        const resp = await http.post('/plans', dlg.form);
        notifySave(resp, '计划已新增');
      }
      dlg.visible = false; load();
    };
    const remove = (row) => {
      ElementPlus.ElMessageBox.confirm(`确定删除计划「${row.name}」吗？任务将一并删除！`, '删除确认', { type: 'warning' })
        .then(async () => {
          await http.delete('/plans/' + row.id);
          ElementPlus.ElMessage.success('已删除'); load();
        }).catch(() => {});
    };

    /* 计划详情 + 甘特图 */
    const detail = reactive({ visible: false, plan: { tasks: [] } });
    const gantt = reactive({ months: [], todayLeft: null });

    const openDetail = async (row) => {
      detail.plan = await http.get('/plans/' + row.id);
      detail.visible = true;
      await Vue.nextTick();
      buildGantt();
    };
    const dayDiff = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);
    const buildGantt = () => {
      const tasks = detail.plan.tasks.filter(t => t.start_date && t.end_date);
      gantt.months = []; gantt.todayLeft = null;
      if (!tasks.length) return;
      const starts = tasks.map(t => t.start_date).sort();
      const ends = tasks.map(t => t.end_date).sort();
      const min = starts[0];
      const max = ends[ends.length - 1];
      const total = dayDiff(min, max) || 1;
      // 月份刻度
      const cur = new Date(min.slice(0, 7) + '-01');
      const endD = new Date(max.slice(0, 7) + '-01');
      while (cur <= endD) {
        const label = cur.getFullYear() + '-' + String(cur.getMonth() + 1).padStart(2, '0');
        const first = label + '-01';
        const left = Math.max(0, dayDiff(min, first) / total * 100);
        gantt.months.push({ label, left });
        cur.setMonth(cur.getMonth() + 1);
      }
      if (today >= min && today <= max) gantt.todayLeft = dayDiff(min, today) / total * 100;
    };
    const barStyle = (t) => {
      const tasks = detail.plan.tasks.filter(x => x.start_date && x.end_date);
      const min = tasks.map(x => x.start_date).sort()[0];
      const max = tasks.map(x => x.end_date).sort().reverse()[0];
      const total = dayDiff(min, max) || 1;
      const left = dayDiff(min, t.start_date) / total * 100;
      const width = Math.max((dayDiff(t.start_date, t.end_date) + 1) / total * 100, 2);
      return { left: left + '%', width: width + '%' };
    };
    const barClass = (t) => {
      if (t.status === '已完成') return 'done';
      if (t.status === '已延期') return 'delay';
      if (t.status === '进行中') return 'doing';
      if (t.end_date && t.end_date < today && t.status !== '已完成') return 'delay';
      return 'todo';
    };

    /* 任务 */
    const taskDlg = reactive({ visible: false, isEdit: false, form: {} });
    const openTask = (row) => {
      taskDlg.isEdit = !!row;
      taskDlg.form = row ? { ...row } : { name: '', owner: '', weight: 0,
        start_date: '', end_date: '', actual_start: '', actual_end: '', status: '未开始', remark: '' };
      taskDlg.visible = true;
    };
    const saveTask = async () => {
      if (!taskDlg.form.name) { ElementPlus.ElMessage.warning('请输入任务名称'); return; }
      const pid = detail.plan.id;
      if (taskDlg.isEdit) {
        if (isAdmin()) {
          const resp = await http.put(`/plans/${pid}/tasks/${taskDlg.form.id}`, taskDlg.form);
          notifySave(resp, '保存成功');
        } else {
          await submitChange('task', taskDlg.form.id, taskDlg.form);
          ElementPlus.ElMessage.success('修改已提交，等待管理员确认后生效');
          notifyCrChanged();
        }
      } else {
        const resp = await http.post(`/plans/${pid}/tasks`, taskDlg.form);
        notifySave(resp, '任务已新增');
      }
      taskDlg.visible = false;
      await openDetail({ id: pid }); load();
    };
    const delTask = (row) => {
      ElementPlus.ElMessageBox.confirm('确定删除该任务吗？', '删除确认', { type: 'warning' })
        .then(async () => {
          await http.delete(`/plans/${detail.plan.id}/tasks/${row.id}`);
          await openDetail({ id: detail.plan.id }); load();
        }).catch(() => {});
    };

    onMounted(async () => {
      projects.value = await http.get('/projects/all');
      loadOverview();
      load();
    });
    const doExport = () => {
      const p = new URLSearchParams({ project_id: q.project_id || '', status: q.status || '', export: 'csv' });
      exportCSV('/plans?' + p.toString(), '计划列表');
    };
    return { CFG, tagType, isAdmin, Plus, Download, Search, RefreshLeft, Document, Flag,
      loading, list, projects, q, today, load, doExport,
      viewMode, oq, olist, oloading, loadOverview, resetO, exportOverview, enter,
      dlg, openAdd, openEdit, save, remove,
      detail, gantt, openDetail, barStyle, barClass,
      taskDlg, openTask, saveTask, delTask };
  }
};
