import { Router } from 'express';
import { db } from '../lib/db.js';
import { env } from '../config/env.js';

/**
 * لوحة الإدارة — تعرض ما يعيده GET /api/clients بواجهة ويب بدل JSON
 * (المهمة 2 من README). محمية بنفس مصادقة /api/*.
 */

export const adminRouter = Router();

const STATUS_AR: Record<string, string> = {
  sent: 'أُرسل',
  suppressed: 'محجوب (قفل الاعتماد)',
  pending: 'قيد المعالجة',
  failed: 'فشل',
};

adminRouter.get('/admin', async (_req, res) => {
  const clients = await db.client.findMany({
    include: {
      entries: { orderBy: { dataDate: 'desc' }, take: 1 },
      reports: { orderBy: { createdAt: 'desc' }, take: 1 },
      _count: { select: { entries: true, reports: true } },
    },
    orderBy: { createdAt: 'asc' },
  });

  const rows = clients
    .map((c) => {
      const lastEntry = c.entries[0]?.dataDate;
      const lastReport = c.reports[0];
      const formUrl = `${env.publicBaseUrl}/f/${c.formToken}`;
      const staleDays = lastEntry ? Math.floor((Date.now() - lastEntry.getTime()) / 86_400_000) : null;
      const staleClass = staleDays === null || staleDays >= 3 ? ' class="warn"' : '';
      return `<tr>
        <td>${c.displayName ?? c.name}</td>
        <td>${c.email}</td>
        <td>${c.sector ?? '—'}</td>
        <td>${c.active ? '<span class="badge on">نشط</span>' : '<span class="badge off">غير نشط</span>'}</td>
        <td${staleClass}>${lastEntry ? lastEntry.toISOString().slice(0, 10) : 'لا بيانات بعد'}</td>
        <td>${c._count.entries}</td>
        <td>${lastReport ? `${lastReport.periodLabel} — ${STATUS_AR[lastReport.status] ?? lastReport.status}` : '—'}</td>
        <td><a href="${formUrl}" target="_blank">فتح النموذج</a><br>
            <button onclick="copyLink('${formUrl}')">نسخ الرابط</button></td>
        <td><button onclick="genReport('${c.id}','daily')">يومي</button>
            <button onclick="genReport('${c.id}','weekly')">أسبوعي</button>
            <button onclick="genReport('${c.id}','monthly')">شهري</button></td>
      </tr>`;
    })
    .join('');

  res.send(`<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>لوحة إدارة مساري</title>
<style>
  body{font-family:Tahoma,Arial,sans-serif;background:#f4f6f8;margin:0;padding:24px}
  .card{max-width:1200px;margin:0 auto;background:#fff;border-radius:12px;padding:28px;box-shadow:0 2px 10px rgba(0,0,0,.08)}
  h1{color:#1F3A5F;font-size:1.3rem;margin-top:0}
  table{width:100%;border-collapse:collapse;font-size:.85rem}
  td,th{border:1px solid #e3e8ee;padding:8px;text-align:right;vertical-align:top}
  th{background:#f0f3f7;color:#1F3A5F}
  .badge{padding:2px 10px;border-radius:12px;font-size:.75rem}
  .on{background:#e8f7ee;color:#1d7a44}
  .off{background:#fdecea;color:#c0392b}
  .warn{background:#fff6e5}
  button{background:#1F3A5F;color:#fff;border:0;padding:5px 10px;border-radius:6px;cursor:pointer;font-size:.75rem;margin:1px}
  .lock{background:${env.externalSendApproved ? '#fdecea' : '#e8f7ee'};border-radius:8px;padding:10px 14px;margin-bottom:16px;font-size:.9rem}
  #toast{position:fixed;bottom:20px;right:20px;background:#1F3A5F;color:#fff;padding:10px 18px;border-radius:8px;display:none}
</style></head><body><div class="card">
<h1>لوحة إدارة مساري — ${clients.length} عملاء</h1>
<div class="lock">🔒 قفل الاعتماد: ${env.externalSendApproved ? '<b>مفتوح — البريد يصل العملاء فعلاً</b>' : 'مفعّل — كل بريد خارجي يتحوّل إليك للمعاينة'}</div>
<table>
<tr><th>العميل</th><th>البريد</th><th>القطاع</th><th>الحالة</th><th>آخر بيانات</th><th>عدد الإدخالات</th><th>آخر تقرير</th><th>رابط النموذج</th><th>تقرير فوري</th></tr>
${rows}
</table>
<p><a href="/governance">استبيان الحوكمة</a> — <a href="/governance/log">سجل الحوكمة</a> — <a href="/api/clients">JSON خام</a></p>
</div>
<div id="toast"></div>
<script>
function toast(m){const t=document.getElementById('toast');t.textContent=m;t.style.display='block';setTimeout(()=>t.style.display='none',2500)}
function copyLink(u){navigator.clipboard.writeText(u).then(()=>toast('نُسخ الرابط ✅'))}
async function genReport(id,p){
  const r=await fetch('/api/clients/'+id+'/report',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({periodType:p})});
  toast(r.ok?'أُضيف للطابور ✅ — تابع نافذة العامل':'فشل الطلب ❌');
}
</script></body></html>`);
});
