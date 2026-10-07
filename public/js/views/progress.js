/* 进度管理：项目进度概览卡片列表 → 点击进入详情（填报记录+里程碑） */
window.Views = window.Views || {};

Views.Progress = {
  template: `
    <div class="page-container">
      <!-- 概览：项目进度卡片列表 -->
      <template v-if="!projectId">
        <div class="search-bar">
          <el-form :inline="true">
            <el-form-item label="关键词">
              <el-input v-model="q.keyword" placeholder="项目名称/编号/负责人" clearable style="width:240px" @keyup.enter="loadOverview" />
            </el-form-item>
            <el-form-item label="状态">
              <el-select v-model="q.status" placeholder="全部" clearable style="width:130px" @change="loadOverview">
                <el-option v-for="s in CFG.projectStatuses" :key="s" :label="s" :value="s" />
              </el-select>
            </el-form-item>
            <el-form-item>
              <el-button type="primary" :icon="Search" @click="loadOverview">查询</el-button>
              <el-button :icon="RefreshLeft" @click="reset">重置</el-button>
            </el-form-item>
          </el-form>
        </div>

        <div class="table-card">
          <div class="table-toolbar">
            <strong>项目进度概览（共 {{ total }} 个项目）</strong>
            <el-button :icon="Download" @click="doExport">导出</el-button>
          </div>
          <el-row :gutter="14">
            <el-col v-for="p in list" :key="p.id" :span="6" style="margin-bottom:14px">
              <el-card class="proj-card" shadow="hover" @click="enter(p)">
                <div class="proj-card-head">
                  <div class="proj-card-title" :title="p.name">{{ p.name }}</div>
                  <el-tag size="small" :type="tagType(p.status)">{{ p.status }}</el-tag>
                </div>
                <div class="proj-card-code muted">{{ p.code }} · {{ p.manager || '—' }}</div>
                <div class="proj-card-progress">
                  <div class="proj-card-progress-label">
                    <span>形象进度</span>
                    <span :class="{'text-danger': p.latest_percent==null}">{{ p.latest_percent==null ? '未填报' : p.latest_percent+'%' }}</span>
                  </div>
                  <el-progress :percentage="p.latest_percent ?? 0" :stroke-width="8" :show-text="false" />
                </div>
                <div class="proj-card-meta">
                  <span><el-icon><Document /></el-icon> {{ p.record_count || 0 }} 期报告</span>
                  <span><el-icon><Flag /></el-icon> {{ p.milestone_done || 0 }}/{{ p.milestone_count || 0 }} 里程碑</span>
                </div>
                <div class="proj-card-foot muted">
                  {{ p.start_date || '—' }} ~ {{ p.end_date || '—' }}
                </div>
              </el-card>
            </el-col>
          </el-row>
          <el-empty v-if="!list.length && !loading" description="暂无项目" />
          <div class="pagination-bar" v-if="total > q.pageSize">
            <el-pagination background layout="prev,pager,next" :total="total"
              v-model:current-page="q.page" :page-size="q.pageSize" @current-change="loadOverview" />
          </div>
        </div>
      </template>

      <!-- 详情：单个项目的进度填报 + 里程碑 -->
      <template v-else>
        <div class="search-bar">
          <el-form :inline="true">
            <el-form-item>
              <el-button :icon="Back" @click="back">返回列表</el-button>
            </el-form-item>
            <el-form-item>
              <el-select v-model="projectId" placeholder="切换项目" filterable style="width:320px" @change="loadAll">
                <el-option v-for="p in projects" :key="p.id" :label="p.code + ' | ' + p.name" :value="p.id" />
              </el-select>
            </el-form-item>
            <el-form-item v-if="current">
              <el-tag :type="tagType(current.status)" size="large">{{ current.status }}</el-tag>
            </el-form-item>
          </el-form>
        </div>

        <el-row :gutter="14" style="margin-bottom:14px">
          <el-col :span="6">
            <el-card class="stat-card bg-green" body-style="padding:0">
              <div class="el-card__body">
                <div class="stat-icon"><el-icon><TrendCharts /></el-icon></div>
                <div><div class="stat-num">{{ latestPercent }}%</div><div class="stat-label">当前累计进度</div></div>
              </div>
            </el-card>
          </el-col>
          <el-col :span="6">
            <el-card class="stat-card bg-blue" body-style="padding:0">
              <div class="el-card__body">
                <div class="stat-icon"><el-icon><Document /></el-icon></div>
                <div><div class="stat-num">{{ records.length }}</div><div class="stat-label">进度报告期数</div></div>
              </div>
            </el-card>
          </el-col>
          <el-col :span="6">
            <el-card class="stat-card bg-orange" body-style="padding:0">
              <div class="el-card__body">
                <div class="stat-icon"><el-icon><Flag /></el-icon></div>
                <div><div class="stat-num">{{ msDone }}/{{ milestones.length }}</div><div class="stat-label">里程碑完成</div></div>
              </div>
            </el-card>
          </el-col>
          <el-col :span="6">
            <el-card class="stat-card bg-purple" body-style="padding:0">
              <div class="el-card__body">
                <div class="stat-icon"><el-icon><Calendar /></el-icon></div>
                <div><div class="stat-num" style="font-size:16px;padding-top:8px">{{ current ? (current.start_date+' 至 '+current.end_date) : '—' }}</div><div class="stat-label">项目工期</div></div>
              </div>
            </el-card>
          </el-col>
        </el-row>

        <el-card style="margin-bottom:14px">
          <div class="table-toolbar">
            <strong>进度填报记录</strong>
            <div>
              <el-button :icon="Download" @click="exportRecords">导出</el-button>
              <el-button type="primary" :icon="Plus" @click="openRec()">新增填报</el-button>
            </div>
          </div>
          <el-table :data="records" border stripe size="small">
            <el-table-column type="expand">
              <template #default="{row}">
                <div style="padding:8px 30px;background:#fafafa">
                  <p><b>本期完成工作：</b>{{ row.work_done || '—' }}</p>
                  <p><b>存在问题：</b>{{ row.issues || '—' }}</p>
                  <p><b>下期计划：</b>{{ row.next_plan || '—' }}</p>
                </div>
              </template>
            </el-table-column>
            <el-table-column prop="record_date" label="填报日期" width="110" />
            <el-table-column prop="period" label="报告期" width="150" />
            <el-table-column label="累计进度" width="190">
              <template #default="{row}">
                <el-progress :percentage="row.percent" :stroke-width="12" :status="row.percent>=100?'success':''" />
              </template>
            </el-table-column>
            <el-table-column prop="work_done" label="本期完成工作摘要" min-width="280" show-overflow-tooltip />
            <el-table-column prop="reporter" label="填报人" width="100" />
            <el-table-column label="操作" width="130">
              <template #default="{row}">
                <el-button link type="primary" size="small" @click="openRec(row)">编辑</el-button>
                <el-button v-if="isAdmin()" link type="danger" size="small" @click="delRec(row)">删除</el-button>
                <el-tooltip v-else content="仅管理员可删除" placement="top">
                  <el-button link type="danger" size="small" disabled>删除</el-button>
                </el-tooltip>
              </template>
            </el-table-column>
          </el-table>
        </el-card>

        <el-card>
          <div class="table-toolbar">
            <strong>项目里程碑</strong>
            <el-button type="primary" plain :icon="Plus" @click="openMs()">新增里程碑</el-button>
          </div>
          <el-table :data="milestones" border stripe size="small">
            <el-table-column type="index" label="#" width="55" />
            <el-table-column prop="name" label="里程碑名称" min-width="220" />
            <el-table-column prop="plan_date" label="计划日期" width="130" />
            <el-table-column prop="actual_date" label="实际完成日期" width="130">
              <template #default="{row}">{{ row.actual_date || '—' }}</template>
            </el-table-column>
            <el-table-column label="状态" width="110">
              <template #default="{row}"><el-tag size="small" :type="tagType(row.status)">{{ row.status }}</el-tag></template>
            </el-table-column>
            <el-table-column label="操作" width="130">
              <template #default="{row}">
                <el-button link type="primary" size="small" @click="openMs(row)">编辑</el-button>
                <el-button v-if="isAdmin()" link type="danger" size="small" @click="delMs(row)">删除</el-button>
                <el-tooltip v-else content="仅管理员可删除" placement="top">
                  <el-button link type="danger" size="small" disabled>删除</el-button>
                </el-tooltip>
              </template>
            </el-table-column>
          </el-table>
        </el-card>
      </template>

      <!-- 进度填报弹窗 -->
      <el-dialog v-model="recDlg.visible" :title="recDlg.isEdit?'编辑进度填报':'新增进度填报'" width="680px">
        <el-alert v-if="recDlg.isEdit && !isAdmin()" type="warning" :closable="false" show-icon
          title="您提交的修改将进入「变更审批」，由管理员确认后生效。" style="margin-bottom:14px" />
        <el-form :model="recDlg.form" label-width="104px">
          <el-row :gutter="12">
            <el-col :span="12"><el-form-item label="填报日期" required>
              <el-date-picker v-model="recDlg.form.record_date" type="date" value-format="YYYY-MM-DD" style="width:100%" />
            </el-form-item></el-col>
            <el-col :span="12"><el-form-item label="报告期">
              <el-input v-model="recDlg.form.period" placeholder="如 2026年第3季度" />
            </el-form-item></el-col>
            <el-col :span="24"><el-form-item label="累计完成(%)">
              <el-slider v-model="recDlg.form.percent" show-input :min="0" :max="100" />
            </el-form-item></el-col>
            <el-col :span="24"><el-form-item label="本期完成工作">
              <el-input v-model="recDlg.form.work_done" type="textarea" :rows="3" />
            </el-form-item></el-col>
            <el-col :span="24"><el-form-item label="存在问题">
              <el-input v-model="recDlg.form.issues" type="textarea" :rows="2" />
            </el-form-item></el-col>
            <el-col :span="24"><el-form-item label="下期计划">
              <el-input v-model="recDlg.form.next_plan" type="textarea" :rows="2" />
            </el-form-item></el-col>
            <el-col :span="12"><el-form-item label="填报人"><el-input v-model="recDlg.form.reporter" /></el-form-item></el-col>
          </el-row>
        </el-form>
        <template #footer>
          <el-button @click="recDlg.visible=false">取消</el-button>
          <el-button type="primary" @click="saveRec">保存</el-button>
        </template>
      </el-dialog>

      <!-- 里程碑弹窗 -->
      <el-dialog v-model="msDlg.visible" :title="msDlg.isEdit?'编辑里程碑':'新增里程碑'" width="480px">
        <el-alert v-if="msDlg.isEdit && !isAdmin()" type="warning" :closable="false" show-icon
          title="您提交的修改将进入「变更审批」，由管理员确认后生效。" style="margin-bottom:14px" />
        <el-form :model="msDlg.form" label-width="104px">
          <el-form-item label="名称" required><el-input v-model="msDlg.form.name" /></el-form-item>
          <el-form-item label="计划日期"><el-date-picker v-model="msDlg.form.plan_date" type="date" value-format="YYYY-MM-DD" style="width:100%" /></el-form-item>
          <el-form-item label="实际日期"><el-date-picker v-model="msDlg.form.actual_date" type="date" value-format="YYYY-MM-DD" style="width:100%" /></el-form-item>
          <el-form-item label="状态">
            <el-select v-model="msDlg.form.status" style="width:100%">
              <el-option v-for="s in CFG.milestoneStatuses" :key="s" :label="s" :value="s" />
            </el-select>
          </el-form-item>
        </el-form>
        <template #footer>
          <el-button @click="msDlg.visible=false">取消</el-button>
          <el-button type="primary" @click="saveMs">保存</el-button>
        </template>
      </el-dialog>
    </div>`,
  setup() {
    const { Plus, Download, Search, RefreshLeft, Back, Document, Flag, TrendCharts, Calendar } = ElementPlusIconsVue;
    const projects = ref([]);
    const projectId = ref('');
    const current = ref(null);
    const records = ref([]);
    const milestones = ref([]);

    /* 概览列表 */
    const loading = ref(false);
    const list = ref([]);
    const total = ref(0);
    const q = reactive({ keyword: '', status: '', page: 1, pageSize: 12 });

    const loadOverview = async (p) => {
      if (p) q.page = p;
      loading.value = true;
      try {
        const r = await http.get('/projects', { params: { ...q } });
        list.value = r.list; total.value = r.total;
      } finally { loading.value = false; }
    };
    const reset = () => { q.keyword = ''; q.status = ''; loadOverview(1); };
    const enter = (p) => { projectId.value = p.id; loadAll(); };
    const back = () => { projectId.value = ''; current.value = null; loadOverview(); };

    const doExport = () => {
      const p = new URLSearchParams({ keyword: q.keyword || '', status: q.status || '', export: 'csv' });
      exportCSV('/projects?' + p.toString(), '项目进度概览');
    };

    const latestPercent = computed(() => records.value[0]?.percent ?? 0);
    const msDone = computed(() => milestones.value.filter(m => m.status === '已完成').length);

    const loadAll = async () => {
      current.value = null; records.value = []; milestones.value = [];
      if (!projectId.value) return;
      current.value = await http.get('/projects/' + projectId.value);
      const [r, m] = await Promise.all([
        http.get('/progress/records', { params: { project_id: projectId.value } }),
        http.get('/progress/milestones', { params: { project_id: projectId.value } })
      ]);
      records.value = r; milestones.value = m;
    };

    /* 进度填报 */
    const recDlg = reactive({ visible: false, isEdit: false, form: {} });
    const openRec = (row) => {
      recDlg.isEdit = !!row;
      recDlg.form = row ? { ...row } : {
        project_id: projectId.value, record_date: new Date().toISOString().slice(0, 10),
        period: '', percent: latestPercent.value, work_done: '', issues: '', next_plan: '',
        reporter: JSON.parse(localStorage.getItem('swc_user') || '{}').real_name || ''
      };
      recDlg.visible = true;
    };
    const saveRec = async () => {
      if (!recDlg.form.record_date) { ElementPlus.ElMessage.warning('请选择填报日期'); return; }
      recDlg.form.project_id = projectId.value;
      if (recDlg.isEdit) {
        if (isAdmin()) {
          const resp = await http.put('/progress/records/' + recDlg.form.id, recDlg.form);
          notifySave(resp, '保存成功');
        } else {
          await submitChange('progress_record', recDlg.form.id, recDlg.form);
          ElementPlus.ElMessage.success('修改已提交，等待管理员确认后生效');
          notifyCrChanged();
        }
      } else {
        const resp = await http.post('/progress/records', recDlg.form);
        notifySave(resp, '进度填报已新增');
      }
      recDlg.visible = false; loadAll();
    };
    const delRec = (row) => {
      ElementPlus.ElMessageBox.confirm('确定删除该条进度记录吗？', '删除确认', { type: 'warning' })
        .then(async () => {
          await http.delete('/progress/records/' + row.id);
          loadAll();
        }).catch(() => {});
    };

    /* 里程碑 */
    const msDlg = reactive({ visible: false, isEdit: false, form: {} });
    const openMs = (row) => {
      msDlg.isEdit = !!row;
      msDlg.form = row ? { ...row } : { project_id: projectId.value, name: '', plan_date: '', actual_date: '', status: '未开始' };
      msDlg.visible = true;
    };
    const saveMs = async () => {
      if (!msDlg.form.name) { ElementPlus.ElMessage.warning('请输入里程碑名称'); return; }
      msDlg.form.project_id = projectId.value;
      if (msDlg.isEdit) {
        if (isAdmin()) {
          const resp = await http.put('/progress/milestones/' + msDlg.form.id, msDlg.form);
          notifySave(resp, '保存成功');
        } else {
          await submitChange('milestone', msDlg.form.id, msDlg.form);
          ElementPlus.ElMessage.success('修改已提交，等待管理员确认后生效');
          notifyCrChanged();
        }
      } else {
        const resp = await http.post('/progress/milestones', msDlg.form);
        notifySave(resp, '里程碑已新增');
      }
      msDlg.visible = false; loadAll();
    };
    const delMs = (row) => {
      ElementPlus.ElMessageBox.confirm('确定删除该里程碑吗？', '删除确认', { type: 'warning' })
        .then(async () => {
          await http.delete('/progress/milestones/' + row.id);
          loadAll();
        }).catch(() => {});
    };

    const exportRecords = () => {
      exportCSV('/progress/records?project_id=' + projectId.value + '&export=csv', '进度记录');
    };

    onMounted(async () => {
      projects.value = await http.get('/projects/all');
      loadOverview();
    });

    return { CFG, tagType, isAdmin, Plus, Download, Search, RefreshLeft, Back, Document, Flag, TrendCharts, Calendar,
      projects, projectId, current, records, milestones, latestPercent, msDone,
      loading, list, total, q, loadOverview, reset, enter, back, doExport,
      loadAll, exportRecords,
      recDlg, openRec, saveRec, delRec, msDlg, openMs, saveMs, delMs };
  }
};
