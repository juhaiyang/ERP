/* 首页仪表盘 */
window.Views = window.Views || {};

Views.Dashboard = {
  template: `
    <div class="page-container">
      <el-row :gutter="14">
        <el-col :span="4" v-for="c in cards" :key="c.label">
          <el-card class="stat-card" :class="c.bg" body-style="padding:0">
            <div class="el-card__body">
              <div class="stat-icon"><el-icon><component :is="c.icon" /></el-icon></div>
              <div>
                <div class="stat-num">{{ c.value }}</div>
                <div class="stat-label">{{ c.label }}</div>
              </div>
            </div>
          </el-card>
        </el-col>
      </el-row>

      <el-row :gutter="14" style="margin-top:14px">
        <el-col :span="10">
          <div class="chart-card">
            <div class="chart-title">项目类型分布</div>
            <div ref="pieRef" class="chart-box"></div>
          </div>
        </el-col>
        <el-col :span="14">
          <div class="chart-card">
            <div class="chart-title">各项目最新进度（%）</div>
            <div ref="barRef" class="chart-box"></div>
          </div>
        </el-col>
      </el-row>

      <el-row :gutter="14" style="margin-top:14px">
        <el-col :span="12">
          <div class="chart-card">
            <div class="chart-title">近6个月合同签订额（万元）</div>
            <div ref="lineRef" style="height:280px"></div>
          </div>
        </el-col>
        <el-col :span="12">
          <div class="chart-card">
            <div class="chart-title">报名中的招标（按截止时间）</div>
            <el-table :data="deadlineSoon" height="280" size="small">
              <el-table-column prop="title" label="招标项目" min-width="200" show-overflow-tooltip />
              <el-table-column prop="project_name" label="所属项目" min-width="180" show-overflow-tooltip />
              <el-table-column prop="signup_deadline" label="报名截止" width="110" />
            </el-table>
          </div>
        </el-col>
      </el-row>

      <el-row :gutter="14" style="margin-top:14px">
        <el-col :span="24">
          <div class="chart-card">
            <div class="chart-title">跨模块数据核对预警（进度填报 vs 计划任务完成度 / 在建项目计划缺失）</div>
            <el-table :data="syncAlerts" size="small">
              <el-table-column prop="name" label="项目" min-width="240" show-overflow-tooltip />
              <el-table-column label="问题类型" width="150">
                <template #default="{row}">
                  <el-tag size="small" :type="row.level==='danger'?'danger':'warning'">{{ row.kind }}</el-tag>
                </template>
              </el-table-column>
              <el-table-column prop="detail" label="核对结果" min-width="360" show-overflow-tooltip />
              <template #empty>
                <el-empty description="各模块数据核对一致，暂无预警" :image-size="60" />
              </template>
            </el-table>
          </div>
        </el-col>
      </el-row>
    </div>`,
  setup() {
    const pieRef = ref(), barRef = ref(), lineRef = ref();
    const deadlineSoon = ref([]);
    const syncAlerts = ref([]);
    const cards = ref([
      { label: '项目总数', value: '-', icon: 'FolderOpened', bg: 'bg-green' },
      { label: '在建项目', value: '-', icon: 'Tools', bg: 'bg-blue' },
      { label: '招标进行中', value: '-', icon: 'Notification', bg: 'bg-orange' },
      { label: '履行中合同', value: '-', icon: 'Tickets', bg: 'bg-purple' },
      { label: '合同总额(万元)', value: '-', icon: 'Money', bg: 'bg-green' },
      { label: '平均进度', value: '-', icon: 'TrendCharts', bg: 'bg-blue' }
    ]);

    const charts = [];
    const renderPie = (data) => {
      const c = echarts.init(pieRef.value);
      c.setOption({
        tooltip: { trigger: 'item', formatter: '{b}: {c}个 ({d}%)' },
        legend: { bottom: 0, type: 'scroll' },
        series: [{ type: 'pie', radius: ['42%', '68%'], center: ['50%', '44%'],
          itemStyle: { borderRadius: 6, borderColor: '#fff', borderWidth: 2 },
          label: { formatter: '{b}\n{c}个' },
          data }]
      });
      charts.push(c);
    };
    const renderBar = (data) => {
      const c = echarts.init(barRef.value);
      c.setOption({
        tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
        grid: { left: 10, right: 30, top: 20, bottom: 60 },
        xAxis: { type: 'category', data: data.map(d => d.name), axisLabel: { interval: 0, rotate: 18, fontSize: 11 } },
        yAxis: { type: 'value', max: 100, axisLabel: { formatter: '{value}%' } },
        series: [{ type: 'bar', data: data.map(d => d.percent), barWidth: 34,
          itemStyle: { borderRadius: [4, 4, 0, 0],
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: '#2fc38b' }, { offset: 1, color: '#0e7a4f' }]) },
          label: { show: true, position: 'top', formatter: '{c}%' } }]
      });
      charts.push(c);
    };
    const renderLine = (data) => {
      const c = echarts.init(lineRef.value);
      c.setOption({
        tooltip: { trigger: 'axis' },
        grid: { left: 60, right: 20, top: 24, bottom: 36 },
        xAxis: { type: 'category', data: data.map(d => d.m) },
        yAxis: { type: 'value', name: '万元' },
        series: [{ type: 'line', data: data.map(d => Number(d.amount.toFixed(1))),
          smooth: true, symbolSize: 8, lineStyle: { width: 3, color: '#2070d3' },
          areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: 'rgba(74,163,240,.35)' }, { offset: 1, color: 'rgba(74,163,240,.02)' }]) },
          itemStyle: { color: '#2070d3' } }]
      });
      charts.push(c);
    };

    onMounted(async () => {
      // 先注册 resize 监听：若在 await 之后注册，接口异常时监听器将永远不会被挂上，
      // 且 onBeforeUnmount 的移除随之失效
      window.addEventListener('resize', resize);
      const d = await http.get('/stats/overview');
      cards.value[0].value = d.cards.projectTotal;
      cards.value[1].value = d.cards.activeProjects;
      cards.value[2].value = d.cards.bidding;
      cards.value[3].value = d.cards.contractRunning;
      cards.value[4].value = Number(d.cards.contractAmount.toFixed(1));
      cards.value[5].value = d.cards.avgProgress + '%';
      deadlineSoon.value = d.deadlineSoon;
      // 汇总跨模块核对预警：进度偏差 + 在建无计划
      syncAlerts.value = [
        ...(d.deviations || []).map(x => ({
          name: x.name, kind: '进度偏差', level: 'danger',
          detail: `进度填报 ${x.progress_pct}%，计划任务完成度 ${x.plan_done}%，偏差 ${x.progress_pct - x.plan_done > 0 ? '+' : ''}${(x.progress_pct - x.plan_done).toFixed(1)} 个百分点`
        })),
        ...(d.planMissing || []).map(x => ({
          name: x.name, kind: '计划缺失', level: 'warning',
          detail: '项目处于施工中，但计划模块尚未编制任何计划'
        }))
      ];
      await Vue.nextTick();
      renderPie(d.typeDist);
      renderBar(d.projectProgress);
      renderLine(d.monthly);
    });
    const resize = () => charts.forEach(c => c.resize());
    onBeforeUnmount(() => {
      window.removeEventListener('resize', resize);
      // 销毁 echarts 实例，避免反复进出首页导致画布与事件监听泄漏
      charts.forEach(c => { try { c.dispose(); } catch { /* 已销毁 */ } });
      charts.length = 0;
    });

    return { cards, pieRef, barRef, lineRef, deadlineSoon, syncAlerts };
  }
};
