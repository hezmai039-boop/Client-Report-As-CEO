import { describe, it, expect } from 'vitest';
import { periodRange } from '../src/services/reports.js';

// periodRange هي أساس حارس التكرار: نفس اليوم المرجعي يجب أن يعطي
// نفس periodLabel دائماً — وإلا انهار قيد unique في القاعدة.
describe('periodRange', () => {
  const ref = new Date('2026-08-09T07:00:00');

  it('اليومي: يغطي يوم الأمس فقط', () => {
    const { from, to } = periodRange('daily', ref);
    expect(from.toISOString().slice(0, 10)).toBe('2026-08-08');
    expect(to.toISOString().slice(0, 10)).toBe('2026-08-08');
  });

  it('الأسبوعي: يغطي 7 أيام للخلف', () => {
    const { from, to } = periodRange('weekly', ref);
    expect(from.toISOString().slice(0, 10)).toBe('2026-08-02');
    expect(to.toISOString().slice(0, 10)).toBe('2026-08-09');
  });

  it('الشهري: يغطي شهراً للخلف', () => {
    const { from, to } = periodRange('monthly', ref);
    expect(from.toISOString().slice(0, 10)).toBe('2026-07-09');
    expect(to.toISOString().slice(0, 10)).toBe('2026-08-09');
  });

  it('نفس اليوم المرجعي يعطي نفس التسمية دائماً (حجر أساس حارس التكرار)', () => {
    const a = periodRange('daily', new Date('2026-08-09T07:00:00'));
    const b = periodRange('daily', new Date('2026-08-09T23:59:00'));
    expect(a.label).toBe(b.label);
  });

  it('يومان مختلفان يعطيان تسميتين مختلفتين', () => {
    const a = periodRange('daily', new Date('2026-08-09T07:00:00'));
    const b = periodRange('daily', new Date('2026-08-10T07:00:00'));
    expect(a.label).not.toBe(b.label);
  });
});
