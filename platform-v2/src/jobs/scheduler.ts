import { reportQueue } from './queue.js';
import { db } from '../lib/db.js';
import { sendInternal } from '../services/mailer.js';

/**
 * الجدولة الدورية — تستبدل مشغّلات Apps Script الزمنية
 * (runDailyReports / runWeeklyReports / runMonthlyReports) بمهام
 * متكررة في BullMQ. مشغّل "منطقي" واحد لكل وتيرة مهما بلغ عدد
 * العملاء — سقف الـ 20 مشغّلاً لم يعد موجوداً أصلاً.
 *
 * دور كل جدولة: enqueue فقط (ثوانٍ معدودة حتى لألف عميل) — التوليد
 * الفعلي يتوزع على العامل بالتوازي.
 */

export async function enqueueAllActive(periodType: 'daily' | 'weekly' | 'monthly'): Promise<number> {
  const clients = await db.client.findMany({ where: { active: true }, select: { id: true } });
  await reportQueue.addBulk(
    clients.map((c) => ({
      name: `${periodType}-report`,
      data: { clientId: c.id, periodType },
      opts: { jobId: `${periodType}:${c.id}:${new Date().toISOString().slice(0, 10)}` }, // منع ازدواج نفس اليوم
    })),
  );
  return clients.length;
}

/** الفحص اليومي — يقابل dailyHealthCheck_ في automation.gs */
export async function dailyHealthCheck(): Promise<void> {
  const clients = await db.client.findMany({ include: { entries: { orderBy: { dataDate: 'desc' }, take: 1 } } });
  const stale: string[] = [];
  const now = Date.now();
  for (const c of clients) {
    const last = c.entries[0]?.dataDate;
    if (!last) {
      stale.push(`${c.name} — لم تصل أي بيانات بعد`);
      continue;
    }
    const days = Math.floor((now - last.getTime()) / 86_400_000);
    if (days >= 3) stale.push(`${c.name} — آخر بيانات قبل ${days} يوماً`);
  }
  if (stale.length) {
    await sendInternal(
      '[منصة مساري] تقرير صحة المنصة اليومي',
      `<div dir="rtl">عملاء يحتاجون متابعة:<br>${stale.map((s) => `• ${s}`).join('<br>')}</div>`,
    );
  }
}

export async function startSchedulers(): Promise<void> {
  // BullMQ Repeatable Jobs بصيغة cron (بتوقيت الخادم) — العامل يميّزها
  // باسمها (scheduler-*) ولا يقرأ منها بيانات
  await reportQueue.add('scheduler-daily', {}, {
    repeat: { pattern: '0 7 * * *' }, // يومياً 7 صباحاً
    jobId: 'scheduler-daily',
  });
  await reportQueue.add('scheduler-weekly', {}, {
    repeat: { pattern: '0 8 * * 0' }, // الأحد 8 صباحاً
    jobId: 'scheduler-weekly',
  });
  await reportQueue.add('scheduler-monthly', {}, {
    repeat: { pattern: '0 9 1 * *' }, // أول يوم بالشهر 9 صباحاً
    jobId: 'scheduler-monthly',
  });
}
