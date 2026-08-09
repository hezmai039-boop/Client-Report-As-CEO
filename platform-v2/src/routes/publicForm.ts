import { Router } from 'express';
import { z } from 'zod';
import { db } from '../lib/db.js';

/**
 * نموذج إدخال البيانات العام — يستبدل Google Forms بالكامل.
 *
 * كل عميل يملك رابطاً فريداً: /f/<formToken>
 * - لا يكتب العميل اسمه أبداً (يُستنتج من الرمز) — استحالة بنيوية
 *   لتكرار خطأ "الاسم الفارغ/غير المطابق" الذي حدث مع نواف طه.
 * - لا يُستهلك أي مورد لكل عميل جديد (لا نموذج، لا مشغّل) — رابط
 *   ورمز في قاعدة البيانات فقط، فالسقف الوحيد هو حجم القاعدة.
 */

export const publicFormRouter = Router();

const fixedFields = [
  { name: 'dataDate', label: 'تاريخ البيانات', type: 'date', required: true },
  { name: 'revenue', label: 'إجمالي الإيرادات', type: 'number', required: true },
  { name: 'operationsCount', label: 'عدد العمليات', type: 'number', required: true },
  { name: 'cost', label: 'تكلفة البضاعة/التشغيل', type: 'number', required: false },
  { name: 'newClients', label: 'عملاء جدد', type: 'number', required: false },
  { name: 'repeatClients', label: 'عملاء متكررون', type: 'number', required: false },
  { name: 'marketingSpend', label: 'مصروفات التسويق', type: 'number', required: false },
  { name: 'satisfaction', label: 'رضا العملاء (1-5)', type: 'number', required: false },
  { name: 'topItem', label: 'أبرز صنف/خدمة', type: 'text', required: false },
  { name: 'sectorIndicator', label: 'مؤشر قطاعي إضافي', type: 'text', required: false },
  { name: 'notes', label: 'ملاحظات اليوم', type: 'textarea', required: false },
] as const;

function renderPage(title: string, body: string): string {
  return `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>
  body{font-family:Tahoma,Arial,sans-serif;background:#f4f6f8;margin:0;padding:24px}
  .card{max-width:560px;margin:0 auto;background:#fff;border-radius:12px;padding:28px;box-shadow:0 2px 10px rgba(0,0,0,.08)}
  h1{color:#1F3A5F;font-size:1.3rem;margin-top:0}
  label{display:block;margin:14px 0 4px;font-weight:bold;font-size:.95rem}
  input,textarea,select{width:100%;box-sizing:border-box;padding:10px;border:1px solid #cfd6de;border-radius:8px;font-family:inherit}
  .req::after{content:" *";color:#c0392b}
  button{margin-top:20px;width:100%;background:#1F3A5F;color:#fff;border:0;padding:13px;border-radius:8px;font-size:1rem;cursor:pointer}
  .ok{background:#e8f7ee;border:1px solid #27ae60;border-radius:8px;padding:16px;color:#1d7a44}
</style></head><body><div class="card">${body}</div></body></html>`;
}

publicFormRouter.get('/f/:token', async (req, res) => {
  const client = await db.client.findUnique({
    where: { formToken: req.params.token },
    include: { customQuestions: { orderBy: { order: 'asc' } } },
  });
  if (!client) return res.status(404).send(renderPage('غير موجود', '<h1>رابط غير صالح</h1>'));

  const fixed = fixedFields
    .map((f) => {
      const req_ = f.required ? ' required' : '';
      const cls = f.required ? ' class="req"' : '';
      if (f.type === 'textarea') return `<label${cls}>${f.label}</label><textarea name="${f.name}" rows="3"></textarea>`;
      return `<label${cls}>${f.label}</label><input type="${f.type}" name="${f.name}"${req_}>`;
    })
    .join('');

  const custom = client.customQuestions
    .map((q) => {
      const req_ = q.required ? ' required' : '';
      const cls = q.required ? ' class="req"' : '';
      if (q.type === 'PARAGRAPH') return `<label${cls}>${q.title}</label><textarea name="q_${q.id}" rows="3"${req_}></textarea>`;
      if (q.type === 'SCALE') return `<label${cls}>${q.title}</label><input type="number" min="1" max="5" name="q_${q.id}"${req_}>`;
      if (q.type === 'MULTIPLE_CHOICE') {
        const opts = ((q.choices as string[]) ?? ['نعم', 'لا']).map((c) => `<option>${c}</option>`).join('');
        return `<label${cls}>${q.title}</label><select name="q_${q.id}"${req_}>${opts}</select>`;
      }
      const t = q.type === 'NUMBER' ? 'number' : 'text';
      return `<label${cls}>${q.title}</label><input type="${t}" name="q_${q.id}"${req_}>`;
    })
    .join('');

  res.send(
    renderPage(
      `بيانات الأداء — ${client.displayName ?? client.name}`,
      `<h1>بيانات الأداء اليومي — ${client.displayName ?? client.name}</h1>
       <p>اسمك مسجَّل تلقائياً — لا حاجة لكتابته.</p>
       <form method="post">${fixed}${custom}<button>إرسال</button></form>`,
    ),
  );
});

const entrySchema = z.object({
  dataDate: z.string().min(8),
  revenue: z.coerce.number().optional(),
  operationsCount: z.coerce.number().int().optional(),
  cost: z.coerce.number().optional(),
  newClients: z.coerce.number().int().optional(),
  repeatClients: z.coerce.number().int().optional(),
  marketingSpend: z.coerce.number().optional(),
  satisfaction: z.coerce.number().int().min(1).max(5).optional(),
  topItem: z.string().optional(),
  sectorIndicator: z.string().optional(),
  notes: z.string().optional(),
});

publicFormRouter.post('/f/:token', async (req, res) => {
  const client = await db.client.findUnique({ where: { formToken: req.params.token } });
  if (!client) return res.status(404).send(renderPage('غير موجود', '<h1>رابط غير صالح</h1>'));

  const parsed = entrySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).send(renderPage('خطأ', `<h1>بيانات ناقصة أو غير صالحة</h1><p>${parsed.error.issues.map((i) => i.message).join('<br>')}</p>`));
  }
  const d = parsed.data;

  const customAnswers: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.body as Record<string, string>)) {
    if (k.startsWith('q_') && String(v).trim()) customAnswers[k.slice(2)] = String(v);
  }

  // upsert — الحارس الحقيقي ضد تكرار نفس اليوم هو unique في القاعدة
  await db.dailyEntry.upsert({
    where: { clientId_dataDate: { clientId: client.id, dataDate: new Date(d.dataDate) } },
    create: {
      clientId: client.id,
      dataDate: new Date(d.dataDate),
      revenue: d.revenue,
      operationsCount: d.operationsCount,
      cost: d.cost,
      newClients: d.newClients,
      repeatClients: d.repeatClients,
      marketingSpend: d.marketingSpend,
      satisfaction: d.satisfaction,
      topItem: d.topItem,
      sectorIndicator: d.sectorIndicator,
      notes: d.notes,
      customAnswers,
    },
    update: {}, // نفس اليوم مُدخل مسبقاً: لا نستبدل — نفس سلوك dailyRowExists_
  });

  if (!client.active) {
    await db.client.update({ where: { id: client.id }, data: { active: true } });
  }

  res.send(renderPage('تم', `<div class="ok"><b>وصلت بياناتك بنجاح ✅</b><br>سيصلك تقريرك تلقائياً.</div>`));
});
