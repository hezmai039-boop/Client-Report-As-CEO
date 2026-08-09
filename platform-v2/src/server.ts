import express from 'express';
import cors from 'cors';
import { env } from './config/env.js';
import { publicFormRouter } from './routes/publicForm.js';
import { clientsRouter } from './routes/clients.js';
import { governanceRouter } from './routes/governance.js';
import { adminRouter } from './routes/admin.js';
import { adminAuth } from './middleware/auth.js';

/**
 * الخادم الرئيسي — منصة تقارير العملاء الآلية (مساري)
 *
 * التشغيل المحلي:
 *   1. docker compose up -d          (قاعدة البيانات + Redis)
 *   2. npm install
 *   3. cp .env.example .env          (ثم عدّل القيم)
 *   4. npx prisma migrate dev        (إنشاء الجداول)
 *   5. npm run dev                   (هذا الخادم)
 *   6. npm run worker                (عامل التقارير — نافذة طرفية ثانية)
 */

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get('/', (_req, res) => {
  res.send(`<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>منصة مساري</title>
<style>
  body{font-family:Tahoma,Arial,sans-serif;background:#f4f6f8;margin:0;padding:24px}
  .card{max-width:560px;margin:40px auto;background:#fff;border-radius:12px;padding:32px;box-shadow:0 2px 10px rgba(0,0,0,.08)}
  h1{color:#1F3A5F;font-size:1.4rem;margin-top:0}
  a.btn{display:block;background:#1F3A5F;color:#fff;text-decoration:none;padding:14px 18px;border-radius:8px;margin:10px 0;font-size:1rem}
  a.btn small{display:block;font-weight:normal;opacity:.85;font-size:.8rem;margin-top:3px}
  .lock{background:${env.externalSendApproved ? '#fdecea' : '#e8f7ee'};border-radius:8px;padding:12px 16px;margin-top:20px;font-size:.9rem}
</style></head><body><div class="card">
<h1>منصة تقارير العملاء الآلية — مساري</h1>
<a class="btn" href="/admin">📊 لوحة الإدارة<small>حالة كل العملاء، آخر البيانات والتقارير، توليد تقرير فوري</small></a>
<a class="btn" href="/governance">📝 استبيان الحوكمة اليومي<small>يُعبَّأ بنهاية كل يوم عمل</small></a>
<a class="btn" href="/governance/log">📚 سجل الحوكمة<small>صفحة اطلاع الملاك — قراءة فقط</small></a>
<div class="lock">🔒 قفل الاعتماد: ${env.externalSendApproved ? '<b>مفتوح — البريد يصل العملاء فعلاً</b>' : 'مفعّل — كل بريد خارجي يتحوّل إليك للمعاينة'}</div>
</div></body></html>`);
});

app.use(publicFormRouter); // عام — رمز الرابط هو المصادقة
app.use('/api', adminAuth);
app.use('/governance', adminAuth);
app.use('/admin', adminAuth);
app.use(clientsRouter);
app.use(governanceRouter);
app.use(adminRouter);

app.listen(env.port, () => {
  console.log(`🚀 منصة مساري تعمل على ${env.publicBaseUrl}`);
  console.log(`🔒 قفل الاعتماد: ${env.externalSendApproved ? 'مفتوح — البريد يصل العملاء فعلاً' : 'مفعّل — كل بريد خارجي يتحوّل إليك'}`);
});
