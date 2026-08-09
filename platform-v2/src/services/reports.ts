import { db } from '../lib/db.js';
import { generateRecommendations } from './ai.js';
import { sendToClient } from './mailer.js';
import type { ReportPeriod } from '@prisma/client';

/**
 * توليد وإرسال تقرير عميل واحد — يقابل generateAndSendReport في
 * الرمز.gs، مع فارقين جوهريين:
 *
 * 1. حارس التكرار حقيقي: قيد unique(clientId, periodType, periodLabel)
 *    في قاعدة البيانات — يستحيل فيزيائياً إرسال نفس التقرير مرتين
 *    (مشكلة "حاشي باشا ×3" لا يمكن أن تحدث هنا).
 * 2. الإرسال محكوم بقفل الاعتماد في mailer.ts — التقرير المحجوب
 *    يُسجَّل بحالة suppressed لا sent، فالأرشيف صادق دائماً.
 */

function periodRange(periodType: ReportPeriod, ref: Date): { from: Date; to: Date; label: string } {
  const to = new Date(ref);
  const from = new Date(ref);
  if (periodType === 'daily') {
    from.setDate(from.getDate() - 1);
    to.setTime(from.getTime());
    return { from, to, label: from.toLocaleDateString('ar-SA', { day: '2-digit', month: 'long', year: 'numeric' }) };
  }
  if (periodType === 'weekly') {
    from.setDate(from.getDate() - 7);
    return { from, to, label: `أسبوع ${from.toLocaleDateString('ar-SA')} — ${to.toLocaleDateString('ar-SA')}` };
  }
  from.setMonth(from.getMonth() - 1);
  return { from, to, label: `شهر ${from.toLocaleDateString('ar-SA', { month: 'long', year: 'numeric' })}` };
}

export async function generateAndSendReport(clientId: string, periodType: ReportPeriod, refDate = new Date()) {
  const client = await db.client.findUniqueOrThrow({
    where: { id: clientId },
    include: { profileFields: true },
  });

  const { from, to, label } = periodRange(periodType, refDate);

  // حارس التكرار — على مستوى القاعدة لا الكود
  const existing = await db.report.findUnique({
    where: { clientId_periodType_periodLabel: { clientId, periodType, periodLabel: label } },
  });
  if (existing && existing.status === 'sent') {
    return { skipped: true, reason: 'أُرسل مسبقاً', reportId: existing.id };
  }

  const entries = await db.dailyEntry.findMany({
    where: { clientId, dataDate: { gte: from, lte: to } },
    orderBy: { dataDate: 'asc' },
  });

  if (entries.length === 0) {
    return { skipped: true, reason: 'لا بيانات في الفترة' };
  }

  // تجميع المؤشرات
  const sum = (f: (e: (typeof entries)[number]) => number | null) =>
    entries.reduce((acc, e) => acc + (f(e) ?? 0), 0);

  const totalRevenue = entries.reduce((a, e) => a + Number(e.revenue ?? 0), 0);
  const totalOps = sum((e) => e.operationsCount);
  const avgTicket = totalOps > 0 ? Math.round(totalRevenue / totalOps) : 0;

  const prefs = client.profileFields.find((f) => f.key.includes('تفضيلات التوصيات'))?.value ?? null;

  const aiSummary = await generateRecommendations({
    clientDisplayName: client.displayName ?? client.name,
    sector: client.sector,
    periodLabel: label,
    metrics: {
      'إجمالي الإيرادات': totalRevenue,
      'عدد العمليات': totalOps,
      'متوسط قيمة العملية': avgTicket,
      'عملاء جدد': sum((e) => e.newClients),
      'عملاء متكررون': sum((e) => e.repeatClients),
      'مصروفات التسويق': sum((e) => Number(e.marketingSpend ?? 0)),
    },
    recommendationPreferences: prefs,
  });

  const html =
    `<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif">` +
    `<h2>تقرير ${periodType === 'daily' ? 'يومي' : periodType === 'weekly' ? 'أسبوعي' : 'شهري'} — ${client.displayName ?? client.name}</h2>` +
    `<p>الفترة: ${label}</p>` +
    `<ul>` +
    `<li>إجمالي الإيرادات: ${totalRevenue.toLocaleString('ar-SA')} ﷼</li>` +
    `<li>عدد العمليات: ${totalOps}</li>` +
    `<li>متوسط قيمة العملية: ${avgTicket.toLocaleString('ar-SA')} ﷼</li>` +
    `</ul>` +
    `<h3>قراءة وتوصيات</h3><p>${aiSummary.replace(/\n/g, '<br>')}</p>` +
    `</div>`;

  const mail = await sendToClient(client.email, `تقريرك — ${label}`, html);

  const report = await db.report.upsert({
    where: { clientId_periodType_periodLabel: { clientId, periodType, periodLabel: label } },
    create: {
      clientId,
      periodType,
      periodLabel: label,
      status: mail.delivered ? 'sent' : 'suppressed',
      aiSummary,
      sentAt: mail.delivered ? new Date() : null,
    },
    update: {
      status: mail.delivered ? 'sent' : 'suppressed',
      aiSummary,
      sentAt: mail.delivered ? new Date() : null,
    },
  });

  return { skipped: false, reportId: report.id, delivered: mail.delivered, suppressed: mail.suppressed };
}
