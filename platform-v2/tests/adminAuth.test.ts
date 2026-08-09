import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

// اختبار مصادقة المسارات الإدارية (Basic Auth)

function mockRes() {
  const res = {
    statusCode: 0,
    headers: {} as Record<string, string>,
    body: '',
    set(k: string, v: string) { this.headers[k] = v; return this; },
    status(c: number) { this.statusCode = c; return this; },
    send(b: string) { this.body = b; return this; },
  };
  return res as unknown as Response & { statusCode: number; headers: Record<string, string> };
}

beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllEnvs());

describe('adminAuth', () => {
  it('يرفض الطلب بلا ترويسة مصادقة (401)', async () => {
    vi.stubEnv('ADMIN_PASSWORD', 'secret123');
    const { adminAuth } = await import('../src/middleware/auth.js');
    const res = mockRes();
    const next = vi.fn() as unknown as NextFunction;

    adminAuth({ headers: {} } as Request, res, next);

    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('يقبل كلمة المرور الصحيحة', async () => {
    vi.stubEnv('ADMIN_PASSWORD', 'secret123');
    const { adminAuth } = await import('../src/middleware/auth.js');
    const res = mockRes();
    const next = vi.fn() as unknown as NextFunction;
    const header = 'Basic ' + Buffer.from(':secret123').toString('base64');

    adminAuth({ headers: { authorization: header } } as Request, res, next);

    expect(next).toHaveBeenCalled();
  });

  it('يرفض كلمة المرور الخاطئة', async () => {
    vi.stubEnv('ADMIN_PASSWORD', 'secret123');
    const { adminAuth } = await import('../src/middleware/auth.js');
    const res = mockRes();
    const next = vi.fn() as unknown as NextFunction;
    const header = 'Basic ' + Buffer.from(':wrong').toString('base64');

    adminAuth({ headers: { authorization: header } } as Request, res, next);

    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('كلمة مرور غير مضبوطة = مفتوح مع تحذير (وضع تطوير)', async () => {
    vi.stubEnv('ADMIN_PASSWORD', '');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { adminAuth } = await import('../src/middleware/auth.js');
    const next = vi.fn() as unknown as NextFunction;

    adminAuth({ headers: {} } as Request, mockRes(), next);

    expect(next).toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
