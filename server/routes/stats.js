const express = require('express');
const { db } = require('../db');
const router = express.Router();

router.get('/overview', (req, res) => {
  const projectTotal = db.prepare('SELECT COUNT(*) c FROM projects').get().c;
  const activeProjects = db.prepare("SELECT COUNT(*) c FROM projects WHERE status='施工中'").get().c;
  const bidding = db.prepare("SELECT COUNT(*) c FROM bids WHERE status IN ('报名中','已开标','已评标')").get().c;
  const contractRunning = db.prepare("SELECT COUNT(*) c FROM contracts WHERE status='履行中'").get().c;
  const contractAmount = db.prepare('SELECT COALESCE(SUM(amount),0) s FROM contracts').get().s;
  const paidAmount = db.prepare('SELECT COALESCE(SUM(amount),0) s FROM contract_payments').get().s;
  // 平均进度：与项目模块统一口径——按填报日期(及id)取每个项目最新一期，而非简单 MAX(id)
  const avgRow = db.prepare(`
    SELECT ROUND(AVG(percent),1) a FROM progress_records r
    WHERE r.id IN (
      SELECT (SELECT id FROM progress_records WHERE project_id=p.id
        ORDER BY record_date DESC,id DESC LIMIT 1)
      FROM (SELECT DISTINCT project_id AS id FROM progress_records) p)`).get();

  // 项目类型分布
  const typeDist = db.prepare('SELECT type name, COUNT(*) value FROM projects GROUP BY type').all();
  // 项目状态分布
  const statusDist = db.prepare('SELECT status name, COUNT(*) value FROM projects GROUP BY status').all();
  // 各项目最新进度
  const projectProgress = db.prepare(`
    SELECT p.name, p.budget,
      COALESCE((SELECT percent FROM progress_records r WHERE r.project_id=p.id
        ORDER BY r.record_date DESC,r.id DESC LIMIT 1),0) percent
    FROM projects p ORDER BY p.id`).all();
  // 近6个月合同签订额
  const monthly = db.prepare(`
    SELECT strftime('%Y-%m', sign_date) m, COALESCE(SUM(amount),0) amount, COUNT(*) cnt
    FROM contracts
    WHERE sign_date >= date('now','-6 month','start of month')
    GROUP BY m ORDER BY m`).all();
  // 近期即将截止招标
  const deadlineSoon = db.prepare(`
    SELECT b.title, b.signup_deadline, p.name project_name FROM bids b
    LEFT JOIN projects p ON p.id=b.project_id
    WHERE b.status='报名中' ORDER BY b.signup_deadline LIMIT 6`).all();

  // 进度核对预警：进度填报 vs 计划任务加权完成度，偏差超过 15 个百分点
  const deviations = db.prepare(`
    SELECT * FROM (
      SELECT p.id, p.name, p.status,
        (SELECT percent FROM progress_records r WHERE r.project_id=p.id
          ORDER BY r.record_date DESC,r.id DESC LIMIT 1) AS progress_pct,
        (SELECT ROUND(AVG(dw),1) FROM (
           SELECT COALESCE(SUM(CASE WHEN t.status='已完成' THEN t.weight ELSE 0 END),0) dw
           FROM plans pl LEFT JOIN plan_tasks t ON t.plan_id=pl.id
           WHERE pl.project_id=p.id GROUP BY pl.id)) AS plan_done
      FROM projects p
    ) WHERE progress_pct IS NOT NULL AND plan_done IS NOT NULL
      AND ABS(progress_pct-plan_done) > 15
    ORDER BY ABS(progress_pct-plan_done) DESC`).all();

  // 在建但尚未编制任何计划的项目
  const planMissing = db.prepare(`
    SELECT id, name, status FROM projects p
    WHERE status='施工中' AND NOT EXISTS (SELECT 1 FROM plans WHERE project_id=p.id)`).all();

  res.json({
    cards: { projectTotal, activeProjects, bidding, contractRunning, contractAmount, paidAmount, avgProgress: avgRow.a || 0 },
    typeDist, statusDist, projectProgress, monthly, deadlineSoon, deviations, planMissing
  });
});

module.exports = router;
