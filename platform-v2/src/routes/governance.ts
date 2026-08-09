import { Router } from 'express';
import { db } from '../lib/db.js';

/**
 * وحدة حوكمة إدارة مساري — تقابل setupMasariGovernance في automation.gs.
 * استبيان يومي من 6 فقرات يعبّئه المدير التنفيذي، وكل رد يُسجَّل
 * بطابع زمني لا يُعدَّل — الانتظام نفسه هو الدليل أمام الملاك.
 * صفحة القراءة /governance/log تُشارك مع الملاك للاطلاع.
 */

export const governanceRouter = Router();

const SECTIONS: Array<{ title: string; fields: Array<{ name: string; label: string; type: string; required?: boolean }> }> = [
  { title: 'أولاً — عمليات العملاء', fields: [
    { name: 'activeClients', label: 'عدد العملاء النشطين', type: 'number', required: true },
    { name: 'reportsSentToday', label: 'تقارير أُرسلت للعملاء اليوم', type: 'number', required: true },
    { name: 'clientIssues', label: 'شكاوى أو مشاكل عملاء', type: 'textarea' },
  ]},
  { title: 'ثانياً — المبيعات والنمو', fields: [
    { name: 'newLeadsContacted', label: 'عملاء محتملون جدد تم التواصل معهم', type: 'number', required: true },
    { name: 'seriousMeetings', label: 'اجتماعات ومكالمات جادة', type: 'number' },
    { name: 'newContracts', label: 'عقود جديدة (عدد وقيمة)', type: 'text' },
  ]},
  { title: 'ثالثاً — المالية', fields: [
    { name: 'revenueCollected', label: 'إيرادات محصَّلة اليوم', type: 'number', required: true },
    { name: 'expensesToday', label: 'مصروفات اليوم', type: 'number', required: true },
    { name: 'pendingReceivables', label: 'مستحقات معلَّقة', type: 'number' },
  ]},
  { title: 'رابعاً — الفريق والتشغيل', fields: [
    { name: 'tasksCompleted', label: 'مهام مخطَّطة أُنجزت', type: 'text' },
    { name: 'operationalBlockers', label: 'معوقات تشغيلية', type: 'textarea' },
  ]},
  { title: 'خامساً — الحوكمة والقرارات', fields: [
    { name: 'decisionsToday', label: 'قرارات إدارية اتُّخذت اليوم', type: 'textarea' },
    { name: 'risksNotes', label: 'مخاطر جديدة أو ملاحظات التزام', type: 'textarea' },
    { name: 'selfRating', label: 'تقييم ذاتي لالتزام اليوم بالخطة (1-5)', type: 'number', required: true },
  ]},
  { title: 'سادساً — التخطيط', fields: [
    { name: 'tomorrowPlan', label: 'خطة الغد', type: 'textarea', required: true },
  ]},
];

function page(title: string, body: string): string {
  return `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>
  body{font-family:Tahoma,Arial,sans-serif;background:#f4f6f8;margin:0;padding:24px}
  .card{max-width:640px;margin:0 auto;background:#fff;border-radius:12px;padding:28px;box-shadow:0 2px 10px rgba(0,0,0,.08)}
  h1{color:#1F3A5F;font-size:1.25rem;margin-top:0} h2{color:#1F3A5F;font-size:1rem;border-bottom:2px solid #e3e8ee;padding-bottom:6px;margin-top:26px}
  label{display:block;margin:12px 0 4px;font-weight:bold;font-size:.9rem}
  input,textarea{width:100%;box-sizing:border-box;padding:9px;border:1px solid #cfd6de;border-radius:8px;font-family:inherit}
  .req::after{content:" *";color:#c0392b}
  button{margin-top:22px;width:100%;background:#1F3A5F;color:#fff;border:0;padding:13px;border-radius:8px;font-size:1rem;cursor:pointer}
  .ok{background:#e8f7ee;border:1px solid #27ae60;border-radius:8px;padding:16px;color:#1d7a44}
  table{width:100%;border-collapse:collapse;font-size:.85rem} td,th{border:1px solid #e3e8ee;padding:7px;text-align:right}
  th{background:#f0f3f7;color:#1F3A5F}
</style></head><body><div class="card">${body}</div></body></html>`;
}

governanceRouter.get('/governance', (_req, res) => {
  const body = SECTIONS.map((s) =>
    `<h2>${s.title}</h2>` + s.fields.map((f) => {
      const cls = f.required ? ' class="req"' : '';
      const rq = f.required ? ' required' : '';
      if (f.type === 'textarea') return `<label${cls}>${f.label}</label><textarea name="${f.name}" rows="3"${rq}></textarea>`;
      return `<label${cls}>${f.label}</label><input type="${f.type}" name="${f.name}"${rq}${f.name === 'selfRating' ? ' min="1" max="5"' : ''}>`;
    }).join(''),
  ).join('');
  res.send(page('حوكمة مساري — الاستبيان الإداري اليومي',
    `<h1>حوكمة مساري — الاستبيان الإداري اليومي</h1>
     <p>يُعبَّأ بنهاية كل يوم عمل. الطابع الزمني يُسجَّل آلياً ولا يُعدَّل.</p>
     <form method="post"><label class="req">تاريخ اليوم</label><input type="date" name="entryDate" required>${body}<button>تسجيل اليوم</button></form>`));
});

governanceRouter.post('/governance', async (req, res) => {
  const b = req.body as Record<string, string>;
  if (!b.entryDate) return res.status(400).send(page('خطأ', '<h1>تاريخ اليوم مطلوب</h1>'));

  const num = (v?: string) => (v && v.trim() !== '' ? Number(v) : null);
  const txt = (v?: string) => (v && v.trim() !== '' ? v.trim() : null);

  try {
    await db.governanceEntry.create({
      data: {
        entryDate: new Date(b.entryDate),
        activeClients: num(b.activeClients),
        reportsSentToday: num(b.reportsSentToday),
        clientIssues: txt(b.clientIssues),
        newLeadsContacted: num(b.newLeadsContacted),
        seriousMeetings: num(b.seriousMeetings),
        newContracts: txt(b.newContracts),
        revenueCollected: num(b.revenueCollected),
        expensesToday: num(b.expensesToday),
        pendingReceivables: num(b.pendingReceivables),
        tasksCompleted: txt(b.tasksCompleted),
        operationalBlockers: txt(b.operationalBlockers),
        decisionsToday: txt(b.decisionsToday),
        risksNotes: txt(b.risksNotes),
        selfRating: num(b.selfRating),
        tomorrowPlan: txt(b.tomorrowPlan),
      },
    });
  } catch {
    return res.status(409).send(page('مكرر', '<h1>سجل هذا اليوم موجود مسبقاً</h1><p>لا يُسمح بتعديل يوم مسجَّل — هذه قاعدة الحوكمة.</p>'));
  }

  res.send(page('تم', `<div class="ok"><b>سُجّل يومك بنجاح ✅</b><br>الطابع الزمني محفوظ.</div>`));
});

// صفحة اطلاع الملاك — قراءة فقط
governanceRouter.get('/governance/log', async (_req, res) => {
  const entries = await db.governanceEntry.findMany({ orderBy: { entryDate: 'desc' }, take: 90 });
  const rows = entries.map((e) =>
    `<tr><td>${e.entryDate.toISOString().slice(0, 10)}</td><td>${e.activeClients ?? ''}</td>` +
    `<td>${e.reportsSentToday ?? ''}</td><td>${e.revenueCollected ?? ''}</td><td>${e.expensesToday ?? ''}</td>` +
    `<td>${e.selfRating ?? ''}</td><td>${e.createdAt.toLocaleString('ar-SA')}</td></tr>`,
  ).join('');
  res.send(page('سجل حوكمة مساري',
    `<h1>سجل حوكمة مساري — آخر 90 يوماً</h1>
     <p>كل صف مسجَّل بطابع زمني آلي غير قابل للتعديل.</p>
     <table><tr><th>اليوم</th><th>عملاء نشطون</th><th>تقارير</th><th>إيرادات</th><th>مصروفات</th><th>تقييم ذاتي</th><th>وقت التسجيل الفعلي</th></tr>${rows}</table>`));
});
