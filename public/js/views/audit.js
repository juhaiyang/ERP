/* 审计日志（仅管理员可见入口）：记录谁在何时对什么数据做了什么操作 */
window.Views = window.Views || {};

Views.Audit = {
  template: `
    <div class="page-container">
      <div class="table-card">
        <div class="table-toolbar">
          <strong>审计日志（共 {{ total }} 条）</strong>
          <el-button :icon="Refresh" @click="load">刷新</el-button>
        </div>

        <el-form :inline="true" size="small" @submit.prevent="search">
          <el-form-item label="模块">
            <el-select v-model="q.module" placeholder="全部模块" clearable style="width:130px" @change="search">
              <el-option v-for="m in modules" :key="m" :label="m" :value="m" />
            </el-select>
          </el-form-item>
          <el-form-item label="操作">
            <el-select v-model="q.action" placeholder="全部操作" clearable style="width:120px" @change="search">
              <el-option v-for="a in actions" :key="a" :label="a" :value="a" />
            </el-select>
          </el-form-item>
          <el-form-item label="结果">
            <el-select v-model="q.status" placeholder="全部" clearable style="width:110px" @change="search">
              <el-option label="成功" value="success" />
              <el-option label="失败" value="fail" />
            </el-select>
          </el-form-item>
          <el-form-item label="操作人">
            <el-input v-model="q.username" placeholder="账号/姓名" clearable style="width:130px" @keyup.enter="search" />
          </el-form-item>
          <el-form-item label="时间">
            <el-date-picker v-model="dateRange" type="daterange" range-separator="至"
              start-placeholder="开始日期" end-placeholder="结束日期" value-format="YYYY-MM-DD"
              @change="onDateChange" style="width:240px" />
          </el-form-item>
          <el-form-item>
            <el-button type="primary" :icon="Search" @click="search">查询</el-button>
            <el-button :icon="RefreshLeft" @click="reset">重置</el-button>
          </el-form-item>
        </el-form>

        <el-table :data="list" v-loading="loading" border stripe size="small">
          <el-table-column prop="created_at" label="时间" width="160" />
          <el-table-column label="操作人" width="150">
            <template #default="{row}">
              {{ row.real_name || row.username || '（未登录）' }}
              <div style="color:#909399;font-size:12px">{{ row.username || '' }}</div>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="240">
            <template #default="{row}">
              <el-tag size="small" :type="tagType(row.action)">{{ row.action }}</el-tag>
              <div class="op-desc" :title="describe(row)">{{ describe(row) }}</div>
            </template>
          </el-table-column>
          <el-table-column prop="module" label="模块" width="95" />
          <el-table-column prop="target" label="操作对象" min-width="180" show-overflow-tooltip />
          <el-table-column label="结果" width="85">
            <template #default="{row}">
              <el-tag size="small" :type="row.status_code<400?'success':'danger'" effect="plain">
                {{ row.status_code<400 ? '成功' : row.status_code }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="ip" label="IP" width="130" />
          <el-table-column label="查看" width="70" fixed="right">
            <template #default="{row}">
              <el-button link type="primary" size="small" @click="showDetail(row)">详情</el-button>
            </template>
          </el-table-column>
        </el-table>

        <el-pagination style="margin-top:14px;justify-content:flex-end"
          v-model:current-page="q.page" v-model:page-size="q.pageSize"
          :page-sizes="[20, 50, 100]" :total="total"
          layout="total, sizes, prev, pager, next, jumper" @size-change="load" @current-change="load" />
      </div>

      <el-dialog v-model="dlg.visible" title="日志详情" width="560px">
        <el-descriptions :column="1" border size="small" v-if="dlg.row">
          <el-descriptions-item label="时间">{{ dlg.row.created_at }}</el-descriptions-item>
          <el-descriptions-item label="操作人">{{ dlg.row.real_name || '' }}（{{ dlg.row.username || '未登录' }}）#{{ dlg.row.user_id || '-' }}</el-descriptions-item>
          <el-descriptions-item label="操作">{{ dlg.row.action }} / {{ dlg.row.module }}</el-descriptions-item>
          <el-descriptions-item label="对象">{{ dlg.row.target || '-' }}</el-descriptions-item>
          <el-descriptions-item label="请求">{{ dlg.row.method }} {{ dlg.row.path }}</el-descriptions-item>
          <el-descriptions-item label="结果">HTTP {{ dlg.row.status_code }}</el-descriptions-item>
          <el-descriptions-item label="来源IP">{{ dlg.row.ip || '-' }}</el-descriptions-item>
          <el-descriptions-item label="请求内容">
            <pre style="margin:0;white-space:pre-wrap;word-break:break-all;font-size:12px;max-height:240px;overflow:auto">{{ fmtDetail(dlg.row.detail) }}</pre>
          </el-descriptions-item>
        </el-descriptions>
      </el-dialog>
    </div>`,
  setup() {
    const { Search, Refresh, RefreshLeft } = ElementPlusIconsVue;
    const loading = ref(false);
    const list = ref([]);
    const total = ref(0);
    const modules = ref([]);
    const actions = ['登录', '新增', '修改', '删除', '审批', '备份', '其他'];
    const dateRange = ref([]);
    const q = reactive({ module: '', action: '', status: '', username: '', startDate: '', endDate: '', page: 1, pageSize: 20 });
    const dlg = reactive({ visible: false, row: null });

    const buildParams = () => {
      const p = { page: q.page, pageSize: q.pageSize };
      for (const k of ['module', 'action', 'status', 'username', 'startDate', 'endDate']) {
        if (q[k]) p[k] = q[k];
      }
      return p;
    };

    const load = async () => {
      loading.value = true;
      try {
        const r = await http.get('/audit-logs', { params: buildParams() });
        list.value = r.list;
        total.value = r.total;
      } finally { loading.value = false; }
    };

    const loadMeta = async () => {
      try { modules.value = (await http.get('/audit-logs/meta')).modules; } catch {}
    };

    const search = () => { q.page = 1; load(); };
    const reset = () => {
      Object.assign(q, { module: '', action: '', status: '', username: '', startDate: '', endDate: '', page: 1 });
      dateRange.value = [];
      load();
    };
    const onDateChange = (v) => {
      q.startDate = v ? v[0] : '';
      q.endDate = v ? v[1] : '';
      search();
    };

    const tagType = (a) => ({ '登录': 'success', '新增': 'primary', '修改': 'warning', '删除': 'danger', '审批': 'info', '备份': '' }[a] || '');
    const showDetail = (row) => { dlg.row = row; dlg.visible = true; };

    /** 生成操作内容文字描述：动作 + 模块 + 操作对象 */
    const describe = (row) => {
      if (row.action === '登录') return '用户登录系统';
      if (row.action === '备份') return '执行数据库备份';
      if (row.action === '审批') return `审批变更：${row.target || ''}`.trim();
      if (row.action === '其他') return row.module || '未知操作';
      // target 形如 "项目 青龙河..." 或 "项目 #5"
      return `${row.action}${row.target ? ' ' + row.target : ''}`.trim();
    };

    const fmtDetail = (d) => {
      if (!d) return '（无请求体）';
      if (typeof d === 'string') return d;
      return JSON.stringify(d, null, 2);
    };

    onMounted(() => { loadMeta(); load(); });
    return { loading, list, total, modules, actions, q, dateRange, dlg,
      load, search, reset, onDateChange, tagType, showDetail, describe, fmtDetail, Search, Refresh, RefreshLeft };
  }
};
