// Booking rules, shared by the Worker and the site. Times are Chase's (America/New_York).
export const RULES = {
  timeZone: 'America/New_York',
  // ISO weekday (1 = Monday … 7 = Sunday) → open ranges. Wednesday and weekends are closed.
  hours: {
    1: [['09:30', '17:00']],
    2: [['09:30', '17:00']],
    4: [['09:30', '10:00'], ['13:00', '17:00']],
    5: [['09:30', '17:00']],
  },
  stepMinutes: 30,
  callMinutes: 30, // every intro call is 30 minutes
  noticeBusinessDays: 2, // earliest slot is two business days out (always 48 hours or more; weekends don't count)
  horizonDays: 21, // latest slot is three weeks out
};

const MIN = 60_000;
const DAY = 1440 * MIN;
const WEEKDAY = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
const fmtCache = new Map();

function fmt(timeZone) {
  let f = fmtCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    fmtCache.set(timeZone, f);
  }
  return f;
}

/** Wall-clock parts of an instant in a time zone. */
export function zoned(ms, timeZone) {
  const parts = fmt(timeZone).formatToParts(new Date(ms));
  const get = (t) => parts.find((p) => p.type === t).value;
  return { year: +get('year'), month: +get('month'), day: +get('day'), hour: +get('hour') % 24, minute: +get('minute'), weekday: WEEKDAY[get('weekday')] };
}

function offset(ms, timeZone) {
  const z = zoned(ms, timeZone);
  return Date.UTC(z.year, z.month - 1, z.day, z.hour, z.minute) - Math.floor(ms / MIN) * MIN;
}

/** The instant of a wall-clock time in a time zone (handles DST). */
export function instant(year, month, day, hour, minute, timeZone) {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  return guess - offset(guess - offset(guess, timeZone), timeZone);
}

/** First moment a call may start: `noticeBusinessDays` weekdays after now (24 hours each). */
export function earliest(now, rules = RULES) {
  let t = now;
  for (let n = 0; n < rules.noticeBusinessDays; ) {
    t += DAY;
    if (zoned(t, rules.timeZone).weekday <= 5) n++;
  }
  return t;
}

/**
 * Open slot starts (ms since epoch) between the notice period and the horizon,
 * inside working hours and not overlapping any busy range.
 */
export function slots({ now, minutes = RULES.callMinutes, busy = [], rules = RULES }) {
  const tz = rules.timeZone;
  const from = earliest(now, rules);
  const until = now + rules.horizonDays * DAY;
  const a = zoned(now, tz);
  const b = zoned(until, tz);
  const out = [];
  for (let d = Date.UTC(a.year, a.month - 1, a.day); d <= Date.UTC(b.year, b.month - 1, b.day); d += DAY) {
    const date = new Date(d);
    const [y, m, day] = [date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()];
    const weekday = ((date.getUTCDay() + 6) % 7) + 1;
    for (const [open, close] of rules.hours[weekday] ?? []) {
      const [oh, om] = open.split(':').map(Number);
      const [ch, cm] = close.split(':').map(Number);
      const end = instant(y, m, day, ch, cm, tz);
      for (let s = instant(y, m, day, oh, om, tz); s + minutes * MIN <= end; s += rules.stepMinutes * MIN) {
        if (s < from || s > until) continue;
        const e = s + minutes * MIN;
        if (!busy.some((r) => r.start < e && r.end > s)) out.push(s);
      }
    }
  }
  return out;
}
