import express from 'express';
import cors from 'cors';
import { env } from './config/env.js';
import { publicFormRouter } from './routes/publicForm.js';
import { clientsRouter } from './routes/clients.js';
import { governanceRouter } from './routes/governance.js';

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
  res.json({
    name: 'منصة تقارير العملاء الآلية — مساري',
    externalSendApproved: env.externalSendApproved,
    endpoints: {
      'GET  /api/clients': 'لوحة حالة كل العملاء',
      'POST /api/clients': 'تسجيل عميل جديد (يعيد رابط نموذجه)',
      'POST /api/clients/:id/report': 'توليد تقرير فوري عبر الطابور',
      'GET  /f/:token': 'نموذج إدخال بيانات العميل (عام)',
      'GET  /governance': 'استبيان الحوكمة اليومي',
      'GET  /governance/log': 'سجل الحوكمة (اطلاع الملاك)',
    },
  });
});

app.use(publicFormRouter);
app.use(clientsRouter);
app.use(governanceRouter);

app.listen(env.port, () => {
  console.log(`🚀 منصة مساري تعمل على ${env.publicBaseUrl}`);
  console.log(`🔒 قفل الاعتماد: ${env.externalSendApproved ? 'مفتوح — البريد يصل العملاء فعلاً' : 'مفعّل — كل بريد خارجي يتحوّل إليك'}`);
});
