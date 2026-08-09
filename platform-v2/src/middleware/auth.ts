import type { Request, Response, NextFunction } from 'express';
import { env } from '../config/env.js';

/**
 * مصادقة أساسية (HTTP Basic Auth) لحماية المسارات الإدارية:
 * /admin و /api/* و /governance* — المهمة 3 من README.
 *
 * نموذج العميل /f/<token> يبقى عاماً بلا مصادقة (رمزه هو مصادقته).
 *
 * كلمة المرور تُضبط في .env عبر ADMIN_PASSWORD — إن تُركت فارغة
 * تُطبع تحذيرات وتبقى المسارات مفتوحة (وضع تطوير محلي فقط).
 */
export function adminAuth(req: Request, res: Response, next: NextFunction) {
  if (!env.adminPassword) {
    console.warn('⚠️  ADMIN_PASSWORD غير مضبوط — المسارات الإدارية مفتوحة (وضع تطوير فقط)');
    return next();
  }

  const header = req.headers.authorization ?? '';
  if (header.startsWith('Basic ')) {
    const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
    const idx = decoded.indexOf(':');
    const pass = idx >= 0 ? decoded.slice(idx + 1) : '';
    if (pass === env.adminPassword) return next();
  }

  res.set('WWW-Authenticate', 'Basic realm="Masari Admin", charset="UTF-8"');
  res.status(401).send('مصادقة مطلوبة');
}
