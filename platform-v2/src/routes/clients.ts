import { Router } from 'express';
import { z } from 'zod';
import { db } from '../lib/db.js';
import { env } from '../config/env.js';
import { sendToClient } from '../services/mailer.js';
import { reportQueue } from '../jobs/queue.js';

/**
 * واجهة إدارة العملاء (JSON API) — تقابل onboardNewClient_ و
 * buildCustomClientForm معاً، من نداء واحد وبلا أي مورد يُستهلك
 * لكل عميل (المشكلة التي كانت تسقف Apps Script عند ~14 عميلاً).
 */

export const clientsRouter = Router();

const createClientSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  displayName: z.string().optional(),
  sector: z.string().optional(),
  profile: z.record(z.string()).optional(), // ملف العميل: { "البند": "القيمة" }
  customQuestions: z
    .array(
      z.object({
        title: z.string().min(2),
        type: z.enum(['TEXT', 'NUMBER', 'PARAGRAPH', 'SCALE', 'MULTIPLE_CHOICE']).default('TEXT'),
        required: z.boolean().default(false),
        choices: z.array(z.string()).optional(),
      }),
    )
    .optional(),
});

// POST /api/clients — تسجيل عميل جديد كاملاً
clientsRouter.post('/api/clients', async (req, res) => {
  const parsed = createClientSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues });

  const d = parsed.data;
  const existing = await db.client.findUnique({ where: { name: d.name } });
  if (existing) return res.status(409).json({ error: 'عميل بهذا الاسم موجود مسبقاً', clientId: existing.id });

  const client = await db.client.create({
    data: {
      name: d.name,
      email: d.email,
      displayName: d.displayName ?? d.name,
      sector: d.sector,
      profileFields: d.profile
        ? { create: Object.entries(d.profile).map(([key, value]) => ({ key, value })) }
        : undefined,
      customQuestions: d.customQuestions
        ? { create: d.customQuestions.map((q, i) => ({ ...q, order: i })) }
        : undefined,
    },
  });

  const formUrl = `${env.publicBaseUrl}/f/${client.formToken}`;

  // بريد ترحيبي — محكوم بقفل الاعتماد تلقائياً عبر mailer.ts
  await sendToClient(
    client.email,
    'رابط إدخال بيانات الأداء — شركة مساري لريادة الأعمال',
    `<div dir="rtl">مرحباً ${client.displayName}،<br><br>` +
      `هذا رابطك الخاص لإدخال بيانات الأداء اليومية:<br>` +
      `<a href="${formUrl}">${formUrl}</a><br><br>` +
      `اسمك مسجَّل تلقائياً في الرابط — لا حاجة لكتابته.</div>`,
  );

  res.status(201).json({ clientId: client.id, formUrl });
});

// GET /api/clients — لوحة حالة كل العملاء
clientsRouter.get('/api/clients', async (_req, res) => {
  const clients = await db.client.findMany({
    include: {
      entries: { orderBy: { dataDate: 'desc' }, take: 1 },
      reports: { orderBy: { createdAt: 'desc' }, take: 1 },
      _count: { select: { entries: true, reports: true } },
    },
    orderBy: { createdAt: 'asc' },
  });
  res.json(
    clients.map((c) => ({
      id: c.id,
      name: c.name,
      email: c.email,
      sector: c.sector,
      active: c.active,
      formUrl: `${env.publicBaseUrl}/f/${c.formToken}`,
      lastEntryDate: c.entries[0]?.dataDate ?? null,
      lastReport: c.reports[0] ? { period: c.reports[0].periodLabel, status: c.reports[0].status } : null,
      totals: c._count,
    })),
  );
});

// POST /api/clients/:id/report — توليد تقرير فوري يدوياً (عبر الطابور)
clientsRouter.post('/api/clients/:id/report', async (req, res) => {
  const periodType = (req.body?.periodType ?? 'daily') as 'daily' | 'weekly' | 'monthly';
  await reportQueue.add(`${periodType}-report`, { clientId: req.params.id, periodType });
  res.json({ queued: true, periodType });
});
