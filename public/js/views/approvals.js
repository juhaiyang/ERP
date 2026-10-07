/* 变更审批中心 */
window.Views = window.Views || {};

Views.Approvals = {
  template: `
    <div class="page-container">
      <div class="search-bar">
        <el-form :inline="true">
          <el-form-item label="对象类型">
            <el-select v-model="q.target_type" placeholder="全部类型" clearable style="width:150px" @change="load">
              <el-option v-for="(label,key) in typeLabels" :key="key" :label="label" :value="key" />
            </el-select>
          </el-form-item>
          <el-form-item>
            <el-checkbox v-if="!isAdmin()" v-model="q.scopeMine" disabled>仅显示我提交的申请</el-checkbox>
            <el-tag v-else type="danger" effect="plain">管理员视图：待处理申请需您确认</el-tag>
          </el-form-item>
        </el-form>
      </div>

      <div class="table-card">
        <el-tabs v-model="q.status" @tab-change="load">
          <el-tab-pane label="待审批" name="pending" />
          <el-tab-pane label="已通过" name="approved" />
          <el-tab-pane label="已驳回" name="rejected" />
          <el-tab-pane label="全部" name="" />
        </el-tabs>
        <el-table :data="list" v-loading="loading" border stripe size="small">
          <el-table-column label="类型" width="100">
            <template #default="{row}">
              <el-tag size="small" effect="plain">{{ typeLabels[row.target_type] || row.target_type }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="target_name" label="变更对象" min-width="220" show-overflow-tooltip />
          <el-table-column label="变更内容" min-width="200">
            <template #default="{row}">
              <el-tag v-for="c in (row.changes||[]).slice(0,3)" :key="c.field" size="small"
                type="warning" style="margin-right:4px">{{ c.label }}</el-tag>
              <el-tag v-if="(row.changes||[]).length>3" size="small">+{{ row.changes.length-3 }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="submitted_by_name" label="提交人" width="100" />
          <el-table-column prop="submitted_at" label="提交时间" width="160" />
          <el-table-column label="状态" width="90">
            <template #default="{row}">
              <el-tag size="small" :type="crTag(row.status)">
                {{ {pending:'待审批',approved:'已通过',rejected:'已驳回',superseded:'已作废'}[row.status] || row.status }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="reviewed_by" label="审批人" width="100">
            <template #default="{row}">{{ row.reviewed_by || '—' }}</template>
          </el-table-column>
          <el-table-column label="操作" width="190" fixed="right">
            <template #default="{row}">
              <el-button link type="primary" size="small" @click="openDetail(row)">查看详情</el-button>
              <template v-if="isAdmin() && row.status==='pending'">
                <el-button link type="success" size="small" @click="approve(row)">通过</el-button>
                <el-button link type="danger" size="small" @click="reject(row)">驳回</el-button>
              </template>
            </template>
          </el-table-column>
        </el-table>
      </div>

      <el-dialog v-model="dlg.visible" title="变更申请详情" width="720px">
        <template v-if="dlg.data">
          <el-descriptions :column="2" border size="small" style="margin-bottom:14px">
            <el-descriptions-item label="对象类型">{{ typeLabels[dlg.data.target_type] }}</el-descriptions-item>
            <el-descriptions-item label="状态">
              <el-tag size="small" :type="crTag(dlg.data.status)">
                {{ {pending:'待审批',approved:'已通过',rejected:'已驳回'}[dlg.data.status] }}
              </el-tag>
            </el-descriptions-item>
            <el-descriptions-item label="变更对象" :span="2">{{ dlg.data.target_name }}</el-descriptions-item>
            <el-descriptions-item label="提交人">{{ dlg.data.submitted_by_name }}</el-descriptions-item>
            <el-descriptions-item label="提交时间">{{ dlg.data.submitted_at }}</el-descriptions-item>
            <el-descriptions-item v-if="dlg.data.reviewed_by" label="审批人">{{ dlg.data.reviewed_by }}</el-descriptions-item>
            <el-descriptions-item v-if="dlg.data.reviewed_at" label="审批时间">{{ dlg.data.reviewed_at }}</el-descriptions-item>
            <el-descriptions-item v-if="dlg.data.review_comment" label="驳回原因" :span="2">
              <span style="color:#f56c6c">{{ dlg.data.review_comment }}</span>
            </el-descriptions-item>
          </el-descriptions>

          <h4 style="margin:4px 0 10px;color:#0e7a4f">字段变更明细</h4>
          <el-table :data="dlg.data.changes || []" border size="small">
            <el-table-column prop="label" label="字段" width="150" />
            <el-table-column prop="old" label="原值（当前库中）" min-width="200">
              <template #default="{row}"><span style="color:#909399">{{ row.old }}</span></template>
            </el-table-column>
            <el-table-column label="" width="40" align="center">
              <template #default><el-icon><Right /></el-icon></template>
            </el-table-column>
            <el-table-column prop="new" label="申请变更为" min-width="200">
              <template #default="{row}"><span style="color:#e6a23c;font-weight:600">{{ row.new }}</span></template>
            </el-table-column>
          </el-table>
        </template>
        <template #footer>
          <el-button @click="dlg.visible=false">关闭</el-button>
          <template v-if="isAdmin() && dlg.data && dlg.data.status==='pending'">
            <el-button type="danger" @click="reject(dlg.data)">驳回</el-button>
            <el-button type="success" @click="approve(dlg.data)">确认通过并应用变更</el-button>
          </template>
        </template>
      </el-dialog>
    </div>`,
  setup() {
    const loading = ref(false);
    const list = ref([]);
    const q = reactive({ status: 'pending', target_type: '', scopeMine: !isAdmin() });
    const typeLabels = { project: '项目', bid: '招标信息', contract: '合同',
      progress_record: '进度填报', milestone: '里程碑', plan: '计划', task: '计划任务' };
    const crTag = (s) => ({ pending: 'warning', approved: 'success', rejected: 'danger', superseded: 'info' }[s] || 'info');

    const load = async () => {
      loading.value = true;
      try {
        const params = {};
        if (q.status) params.status = q.status;
        if (q.target_type) params.target_type = q.target_type;
        if (!isAdmin()) params.scope = 'mine';
        const r = await http.get('/change-requests', { params });
        list.value = r.list;
      } finally { loading.value = false; }
    };

    const dlg = reactive({ visible: false, data: null });
    const openDetail = async (row) => {
      dlg.data = await http.get('/change-requests/' + row.id);
      dlg.visible = true;
    };

    const approve = (row) => {
      ElementPlus.ElMessageBox.confirm(
        `确认通过「${row.target_name}」的变更申请吗？通过后新数据将立即写入系统。`,
        '审批确认', { type: 'warning', confirmButtonText: '确认通过', cancelButtonText: '取消' }
      ).then(async () => {
        const resp = await http.post(`/change-requests/${row.id}/approve`, {});
        ElementPlus.ElMessage.success(resp?.message || '已通过，变更已生效');
        dlg.visible = false; load(); notifyCrChanged();
      }).catch(() => {});
    };
    const reject = (row) => {
      ElementPlus.ElMessageBox.prompt('请填写驳回原因（将反馈给提交人）', '驳回变更申请', {
        type: 'warning', confirmButtonText: '确认驳回', cancelButtonText: '取消',
        inputPlaceholder: '例如：数据依据不足，请补充材料后重新提交',
        inputValidator: (v) => (v && v.trim() ? true : '驳回原因不能为空')
      }).then(async ({ value }) => {
        await http.post(`/change-requests/${row.id}/reject`, { comment: value });
        ElementPlus.ElMessage.success('已驳回');
        dlg.visible = false; load(); notifyCrChanged();
      }).catch(() => {});
    };

    onMounted(load);
    return { isAdmin, loading, list, q, typeLabels, crTag, load,
      dlg, openDetail, approve, reject };
  }
};
