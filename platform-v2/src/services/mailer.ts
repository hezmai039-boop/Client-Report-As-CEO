import nodemailer from 'nodemailer';
import { env } from '../config/env.js';

/**
 * طبقة البريد الموحّدة — تستبدل MailApp في Apps Script.
 *
 * قفل الاعتماد (يطابق sendClientEmail_ في automation.gs حرفياً):
 * ما دام EXTERNAL_SEND_APPROVED=false في .env، أي بريد "خارجي"
 * (لعميل) يتحوّل إلى OWNER_EMAIL بعنوان "[معلَّق بانتظار الاعتماد]"
 * مع بيان المستلم الأصلي — فتعاين ما كان سيصل العميل قبل أي اعتماد.
 *
 * حصة البريد: عبر SMTP تجاري (SendGrid/SES/Mailgun) لا يوجد سقف
 * 100 بريد/يوم — عند 1000 عميل بتقرير يومي تحتاج ~30-35 ألف
 * بريد شهرياً، وكلها ضمن الخطط الأساسية لهذه الخدمات.
 */

const transporter = env.smtp.host
  ? nodemailer.createTransport({
      host: env.smtp.host,
      port: env.smtp.port,
      secure: env.smtp.port === 465,
      auth: env.smtp.user ? { user: env.smtp.user, pass: env.smtp.password } : undefined,
    })
  : null;

export interface MailResult {
  delivered: boolean;      // وصل المستلم الفعلي
  suppressed: boolean;     // حُجب بقفل الاعتماد وأُعيد توجيهه للمالك
}

export interface MailAttachment {
  filename: string;
  content: Buffer;
  contentType?: string;
}

async function deliver(to: string, subject: string, html: string, attachments?: MailAttachment[]): Promise<void> {
  if (!transporter) {
    // بلا SMTP مضبوط: نطبع في الطرفية بدل الفشل — مناسب للتطوير المحلي
    const att = attachments?.length ? `\nمرفقات: ${attachments.map((a) => `${a.filename} (${a.content.length} bytes)`).join('، ')}` : '';
    console.log(`\n📧 [محاكاة بريد — SMTP غير مضبوط]\nإلى: ${to}\nالموضوع: ${subject}${att}\n${'-'.repeat(40)}\n${html}\n`);
    return;
  }
  await transporter.sendMail({
    from: `"${env.smtp.fromName}" <${env.smtp.fromEmail || env.smtp.user}>`,
    to,
    subject,
    html,
    attachments,
  });
}

/** بريد داخلي للمالك — يمر دائماً بلا قفل (تنبيهات، فحوصات، تقارير حوكمة) */
export async function sendInternal(subject: string, html: string): Promise<void> {
  await deliver(env.ownerEmail, subject, html);
}

/** بريد خارجي لعميل — محكوم بقفل الاعتماد */
export async function sendToClient(recipient: string, subject: string, html: string, attachments?: MailAttachment[]): Promise<MailResult> {
  if (!env.externalSendApproved) {
    await deliver(
      env.ownerEmail,
      `[معلَّق بانتظار الاعتماد] ${subject}`,
      `<b>⛔ قفل الاعتماد مفعّل — لم يُرسل هذا البريد للمستلم.</b><br>` +
        `المستلم الأصلي: ${recipient}<br>` +
        `للاعتماد النهائي: اضبط EXTERNAL_SEND_APPROVED=true في .env ثم أعد التشغيل.<br><hr>` +
        html,
      attachments,
    );
    return { delivered: false, suppressed: true };
  }
  await deliver(recipient, subject, html, attachments);
  return { delivered: true, suppressed: false };
}
