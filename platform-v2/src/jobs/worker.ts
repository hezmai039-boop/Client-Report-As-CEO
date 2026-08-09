import { Worker } from 'bullmq';
import { connection, type ReportJobData } from './queue.js';
import { generateAndSendReport } from '../services/reports.js';
import { startSchedulers, enqueueAllActive, dailyHealthCheck } from './scheduler.js';

/**
 * العامل — يشغَّل كعملية مستقلة (npm run worker) ويعالج نوعين من المهام:
 *
 * 1. مهام الجدولة الدورية (scheduler-*): تصل حسب توقيتها الـ cron،
 *    ودورها فقط ملء الطابور بمهمة تقرير لكل عميل نشط (enqueue) —
 *    ثوانٍ معدودة حتى لألف عميل — ثم الفحص الصحي اليومي.
 * 2. مهام التقارير الفردية (*-report): توليد وإرسال تقرير عميل واحد.
 *
 * concurrency: 5 يعني 5 تقارير تُعالج معاً — عند 1000 عميل بتقرير
 * يستغرق ~3 ثوانٍ (توليد + Gemini + إرسال)، الدفعة الكاملة تنتهي
 * في ~10 دقائق دون لمس أي حد، مع إعادة محاولة تلقائية لأي فشل.
 */
const worker = new Worker<ReportJobData>(
  'reports',
  async (job) => {
    // مهام الجدولة: تملأ الطابور ولا تولّد تقارير بنفسها
    if (job.name.startsWith('scheduler-')) {
      const periodType = job.name.replace('scheduler-', '') as ReportJobData['periodType'];
      const count = await enqueueAllActive(periodType);
      if (periodType === 'daily') await dailyHealthCheck();
      return { scheduled: count, periodType };
    }

    // مهمة تقرير فردية
    const { clientId, periodType } = job.data;
    return generateAndSendReport(clientId, periodType);
  },
  { connection, concurrency: 5 },
);

worker.on('completed', (job, result) => {
  console.log(`✅ ${job.name}:`, JSON.stringify(result));
});
worker.on('failed', (job, err) => {
  console.error(`❌ فشل ${job?.name}: ${err.message}`);
});

startSchedulers().then(() => console.log('⏰ الجدولة الدورية مفعّلة (يومي 7ص، أسبوعي الأحد، شهري أول الشهر)'));

console.log('👷 عامل التقارير يعمل — بانتظار المهام…');
