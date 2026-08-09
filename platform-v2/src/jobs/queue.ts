import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { env } from '../config/env.js';

/**
 * طابور المهام (BullMQ + Redis) — هذا تحديداً ما يجعل 1000 عميل ممكناً:
 *
 * في Apps Script: حلقة واحدة تولّد 1000 تقرير تصطدم بحد 6 دقائق
 * تنفيذ وتموت بمنتصف الطريق، بلا إعادة محاولة.
 *
 * هنا: كل تقرير "مهمة" مستقلة في الطابور — العامل (worker.ts) يسحبها
 * بدفعات متوازية محدودة، وأي فشل يُعاد تلقائياً 3 مرات بتأخير متدرّج،
 * ولا يوجد أي سقف زمني على المجموع الكلي.
 */

export const connection = new Redis(env.redisUrl, { maxRetriesPerRequest: null });

export const reportQueue = new Queue('reports', {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 30_000 },
    removeOnComplete: 1000,
    removeOnFail: 5000,
  },
});

export interface ReportJobData {
  clientId: string;
  periodType: 'daily' | 'weekly' | 'monthly';
}
