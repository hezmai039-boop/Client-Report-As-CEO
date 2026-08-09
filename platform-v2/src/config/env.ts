import 'dotenv/config';

function required(name: string, value: string | undefined): string {
  if (!value) {
    console.warn(`⚠️  متغير البيئة ${name} غير مضبوط — راجع .env.example`);
    return '';
  }
  return value;
}

export const env = {
  databaseUrl: required('DATABASE_URL', process.env.DATABASE_URL),
  redisUrl: required('REDIS_URL', process.env.REDIS_URL),

  // قفل الاعتماد المركزي — يطابق EXTERNAL_SEND_APPROVED في automation.gs
  externalSendApproved: process.env.EXTERNAL_SEND_APPROVED === 'true',
  ownerEmail: required('OWNER_EMAIL', process.env.OWNER_EMAIL),

  smtp: {
    host: process.env.SMTP_HOST || '',
    port: Number(process.env.SMTP_PORT || 587),
    user: process.env.SMTP_USER || '',
    password: process.env.SMTP_PASSWORD || '',
    fromName: process.env.SMTP_FROM_NAME || 'شركة مساري لريادة الأعمال',
    fromEmail: process.env.SMTP_FROM_EMAIL || '',
  },

  gemini: {
    apiKey: process.env.GEMINI_API_KEY || '',
    model: process.env.GEMINI_MODEL || 'gemini-flash-latest',
  },

  // كلمة مرور المسارات الإدارية (/admin، /api/*، /governance*) — فارغة = مفتوح (تطوير فقط)
  adminPassword: process.env.ADMIN_PASSWORD || '',

  publicBaseUrl: process.env.PUBLIC_BASE_URL || 'http://localhost:3000',
  port: Number(process.env.PORT || 3000),
};
