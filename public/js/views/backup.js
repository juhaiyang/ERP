/* 数据备份（仅管理员） */
window.Views = window.Views || {};

Views.Backup = {
  template: `
    <div class="page-container">
      <div class="table-card">
        <div class="table-toolbar">
          <div>
            <strong>数据库备份</strong>
            <span class="muted" style="margin-left:12px;font-weight:normal;font-size:13px">采用 SQLite 热备份（VACUUM INTO），不中断服务；保留最近 14 天。</span>
          </div>
          <el-button type="primary" :icon="Plus" :loading="backing" @click="doBackup">立即备份</el-button>
        </div>
        <el-table :data="list" v-loading="loading" border stripe size="small">
          <el-table-column prop="filename" label="备份文件" min-width="320" />
          <el-table-column label="大小" width="120" align="right">
            <template #default="{row}">{{ fmtSize(row.size) }}</template>
          </el-table-column>
          <el-table-column prop="created_at" label="创建时间" width="200" />
          <el-table-column label="操作" width="180" fixed="right">
            <template #default="{row}">
              <el-button link type="primary" size="small" @click="download(row)">下载</el-button>
              <el-button link type="danger" size="small" @click="remove(row)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
        <el-alert v-if="!list.length" type="info" :closable="false" title="暂无备份，点击右上角「立即备份」创建" style="margin-top:14px" />
      </div>

      <el-divider content-position="left">恢复说明</el-divider>
      <el-alert type="warning" :closable="false" show-icon style="margin-bottom:12px"
        title="恢复操作需手动执行（避免误操作覆盖生产数据）" />
      <div class="table-card">
        <p>1. 下载需要恢复的备份文件（.db）</p>
        <p>2. 停止服务（关闭 <code>启动服务.bat</code> 窗口）</p>
        <p>3. 将下载的备份文件重命名为 <code>swc.db</code>，覆盖 <code>data/swc.db</code></p>
        <p>4. 重新启动服务即可</p>
      </div>
    </div>`,
  setup() {
    const { Plus } = ElementPlusIconsVue;
    const loading = ref(false);
    const backing = ref(false);
    const list = ref([]);
    const fmtSize = (b) => {
      if (!b) return '';
      if (b < 1024) return b + ' B';
      if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
      return (b / 1024 / 1024).toFixed(2) + ' MB';
    };
    const load = async () => {
      loading.value = true;
      try { list.value = await http.get('/backup'); } finally { loading.value = false; }
    };
    const doBackup = async () => {
      backing.value = true;
      try {
        const r = await http.post('/backup');
        ElementPlus.ElMessage.success('备份成功，完整性校验：' + r.integrity);
        load();
      } finally { backing.value = false; }
    };
    const download = (row) => {
      downloadFile('/backup/' + encodeURIComponent(row.filename) + '/download', row.filename).catch(() => {});
    };
    const remove = (row) => {
      ElementPlus.ElMessageBox.confirm(`确定删除备份「${row.filename}」吗？`, '删除确认', { type: 'warning' })
        .then(async () => {
          await http.delete('/backup/' + encodeURIComponent(row.filename));
          ElementPlus.ElMessage.success('已删除');
          load();
        }).catch(() => {});
    };
    onMounted(load);
    return { list, loading, backing, fmtSize, load, doBackup, download, remove, Plus };
  }
};
