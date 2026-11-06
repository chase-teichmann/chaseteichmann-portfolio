import { describe, it, expect } from 'vitest';
import { slots, earliest, RULES } from '../src/rules.js';

const et = (iso) => Date.parse(iso); // ISO with explicit offset
const fmt = (ms) => {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(ms));
  const g = (t) => p.find((x) => x.type === t).value;
  return `${g('weekday')} ${g('hour')}:${g('minute')}`;
};

describe('slots', () => {
  const now = et('2026-11-09T08:00:00-05:00'); // Monday morning
  const all = slots({ now });

  it('starts one business day out', () => {
    expect(Math.min(...all)).toBeGreaterThanOrEqual(earliest(now));
    expect(fmt(all[0])).toBe('Tue 09:30');
  });
  it('never offers Wednesdays or weekends', () => {
    expect(all.some((s) => /^(Wed|Sat|Sun)/.test(fmt(s)))).toBe(false);
  });
  it('keeps Thursday to 9:30–10:00 and 1–5', () => {
    const thu = all.filter((s) => fmt(s).startsWith('Thu')).map((s) => fmt(s).slice(4));
    expect(thu.slice(0, 3)).toEqual(['09:30', '13:00', '13:30']);
    expect(thu).not.toContain('10:00');
  });
  it('ends the last call by 5pm', () => {
    expect(all.some((s) => fmt(s).endsWith('16:30'))).toBe(true);
    expect(all.some((s) => fmt(s).endsWith('17:00'))).toBe(false);
  });
  it('stays within three weeks', () => {
    expect(Math.max(...all) - now).toBeLessThanOrEqual(RULES.horizonDays * 86_400_000);
  });
  it('drops slots that overlap busy time', () => {
    const busy = [{ start: et('2026-11-10T10:15:00-05:00'), end: et('2026-11-10T11:00:00-05:00') }];
    const day = [et('2026-11-10T00:00:00-05:00'), et('2026-11-11T00:00:00-05:00')];
    const tue = slots({ now, busy }).filter((s) => s >= day[0] && s < day[1]).map((s) => fmt(s).slice(4));
    expect(tue).not.toContain('10:00');
    expect(tue).not.toContain('10:30');
    expect(tue).toContain('09:30');
    expect(tue).toContain('11:00');
  });
  it('handles the switch from daylight time', () => {
    const before = slots({ now: et('2026-10-30T08:00:00-04:00') });
    // Monday Nov 2, 2026 is after the Nov 1 change; 9:30 must still be 9:30 local.
    expect(before.map(fmt)).toContain('Mon 09:30');
  });
});
