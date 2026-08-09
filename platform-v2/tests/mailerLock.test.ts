import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * اختبار قفل الاعتماد — أهم آلية أمان في المنصة:
 * ما دام EXTERNAL_SEND_APPROVED=false يجب ألا يصل أي بريد لعميل،
 * بل يتحوّل للمالك بعنوان "[معلَّق بانتظار الاعتماد]".
 */

const OWNER = 'owner@masari.test';
const CLIENT = 'client@example.com';

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('OWNER_EMAIL', OWNER);
  vi.stubEnv('SMTP_HOST', ''); // بلا SMTP: deliver يطبع في الطرفية — نلتقطه
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('قفل الاعتماد EXTERNAL_SEND_APPROVED', () => {
  it('false: البريد يُحجب ويتحوّل للمالك بعنوان معلَّق', async () => {
    vi.stubEnv('EXTERNAL_SEND_APPROVED', 'false');
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { sendToClient } = await import('../src/services/mailer.js');

    const result = await sendToClient(CLIENT, 'تقريرك اليومي', '<p>محتوى</p>');

    expect(result.delivered).toBe(false);
    expect(result.suppressed).toBe(true);
    const output = log.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(output).toContain(OWNER); // ذهب للمالك
    expect(output).toContain('بانتظار الاعتماد'); // بلا تشكيل — ترتيب الحركات يختلف بين المحررات
    expect(output).toContain(CLIENT); // مع بيان المستلم الأصلي
  });

  it('true: البريد يصل المستلم الفعلي', async () => {
    vi.stubEnv('EXTERNAL_SEND_APPROVED', 'true');
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { sendToClient } = await import('../src/services/mailer.js');

    const result = await sendToClient(CLIENT, 'تقريرك اليومي', '<p>محتوى</p>');

    expect(result.delivered).toBe(true);
    expect(result.suppressed).toBe(false);
    const output = log.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(output).toContain(`إلى: ${CLIENT}`);
    expect(output).not.toContain('بانتظار الاعتماد');
  });

  it('البريد الداخلي للمالك يمر دائماً بلا قفل', async () => {
    vi.stubEnv('EXTERNAL_SEND_APPROVED', 'false');
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { sendInternal } = await import('../src/services/mailer.js');

    await sendInternal('تنبيه داخلي', '<p>فحص</p>');

    const output = log.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(output).toContain(`إلى: ${OWNER}`);
    expect(output).not.toContain('بانتظار الاعتماد');
  });
});
