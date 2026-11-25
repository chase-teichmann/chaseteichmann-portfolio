import { describe, it, expect, beforeEach, vi } from 'vitest';
import worker, { _internal } from '../src/index.js';

const env = { GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 'secret', GOOGLE_REFRESH_TOKEN: 'refresh', ALLOWED_ORIGINS: 'https://chaseteichmann.com', BUSY_CALENDAR_IDS: 'primary' };
const ORIGIN = { Origin: 'https://chaseteichmann.com' };
let calls;

function mockGoogle({ busy = [], freeBusyError = false, tokenError = false, upcoming = [], gmailStatus = 200 } = {}) {
  calls = [];
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    calls.push({ url: String(url), init });
    const j = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    if (String(url).includes('oauth2')) return tokenError ? j(400, { error: 'invalid_grant' }) : j(200, { access_token: 'at', expires_in: 3600 });
    if (String(url).endsWith('/freeBusy')) return j(200, { calendars: { primary: freeBusyError ? { errors: [{ reason: 'notFound' }] } : { busy } } });
    if (String(url).includes('gmail.googleapis.com')) return j(gmailStatus, { id: 'm1' });
    if (String(url).includes('/events') && (init.method || 'GET') === 'GET') return j(200, { items: upcoming });
    if (String(url).includes('/events')) {
      const b = JSON.parse(init.body);
      return j(200, { start: { dateTime: b.start.dateTime }, end: { dateTime: b.end.dateTime }, hangoutLink: 'https://meet.google.com/abc-defg-hij', htmlLink: 'https://www.google.com/calendar/event?eid=abc' });
    }
    return j(404, {});
  });
}
const req = (path, init = {}) => new Request('https://w.example' + path, { ...init, headers: { ...ORIGIN, ...(init.headers || {}) } });

beforeEach(() => { _internal.resetToken(); vi.useRealTimers(); });

describe('worker', () => {
  it('returns open slots', async () => {
    mockGoogle();
    const r = await worker.fetch(req('/availability?minutes=30'), env);
    expect(r.status).toBe(200);
    expect(r.headers.get('Access-Control-Allow-Origin')).toBe('https://chaseteichmann.com');
    expect(r.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(r.headers.get('Content-Security-Policy')).toContain("frame-ancestors 'none'");
    const { slots } = await r.json();
    expect(slots.length).toBeGreaterThan(10);
  });
  it('refuses other origins', async () => {
    mockGoogle();
    const r = await worker.fetch(new Request('https://w.example/availability?minutes=30', { headers: { Origin: 'https://evil.example' } }), env);
    expect(r.status).toBe(403);
    expect(calls.length).toBe(0);
  });
  it('fails closed when a calendar cannot be read', async () => {
    mockGoogle({ freeBusyError: true });
    const r = await worker.fetch(req('/availability?minutes=30'), env);
    expect(r.status).toBe(503);
  });
  it('reports a revoked token as unavailable', async () => {
    mockGoogle({ tokenError: true });
    const r = await worker.fetch(req('/availability?minutes=30'), env);
    expect(r.status).toBe(503);
  });
  it('books an open slot with a Meet link and emails the invite', async () => {
    mockGoogle();
    const { slots } = await (await worker.fetch(req('/availability?minutes=30'), env)).json();
    const body = { name: 'Jordan Lee', company: 'Acme', role: 'Staff engineer', email: 'jordan@acme.test', note: 'Hi', agenda: ['billing', 'nope'], start: slots[0], minutes: 30 };
    const r = await worker.fetch(req('/book', { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }), env);
    expect(r.status).toBe(200);
    const out = await r.json();
    expect(out.meetLink).toContain('meet.google.com');
    const ev = calls.find((c) => c.url.includes('/events') && c.init.method === 'POST');
    expect(ev.url).toContain('sendUpdates=all');
    expect(ev.url).toContain('conferenceDataVersion=1');
    const sent = JSON.parse(ev.init.body);
    expect(sent.attendees[0].email).toBe('jordan@acme.test');
    expect(sent.description).toContain('Automated billing on Recurly');
    expect(sent.description).not.toContain('nope');
    expect(Date.parse(sent.end.dateTime) - Date.parse(sent.start.dateTime)).toBe(30 * 60_000);
    expect(sent.extendedProperties.private.source).toBe('chaseteichmann.com');
    expect(sent.reminders.useDefault).toBe(false);
    const mins = sent.reminders.overrides.map((o) => o.minutes);
    expect(sent.reminders.overrides.every((o) => o.method === 'popup')).toBe(true);
    const untilStart = (Date.parse(slots[0]) - Date.now()) / 60_000;
    expect(mins[0]).toBeGreaterThan(untilStart - 4); // goes off a couple of minutes after booking
    expect(mins[0]).toBeLessThan(untilStart);
    expect(mins.slice(1)).toEqual([60, 10]);
    expect(calls.some((c) => c.url.includes('gmail'))).toBe(false); // no NOTIFY_EMAIL, no email
  });
  it('rejects a slot that is no longer open', async () => {
    mockGoogle();
    const { slots } = await (await worker.fetch(req('/availability?minutes=30'), env)).json();
    mockGoogle({ busy: [{ start: slots[0], end: new Date(Date.parse(slots[0]) + 1800000).toISOString() }] });
    const body = { company: 'Acme', email: 'jordan@acme.test', start: slots[0], minutes: 30 };
    const r = await worker.fetch(req('/book', { method: 'POST', body: JSON.stringify(body) }), env);
    expect(r.status).toBe(409);
  });
  it('validates input', async () => {
    mockGoogle();
    const bad = await worker.fetch(req('/book', { method: 'POST', body: JSON.stringify({ company: 'Acme', email: 'not-an-email', start: new Date().toISOString(), minutes: 30 }) }), env);
    expect(bad.status).toBe(400);
    const wrongLen = await worker.fetch(req('/availability?minutes=60'), env);
    expect(wrongLen.status).toBe(400);
  });

  const book = async (envOver = {}, extra = {}, mock = {}) => {
    mockGoogle(mock);
    const e = { ...env, ...envOver };
    const { slots } = await (await worker.fetch(req('/availability?minutes=30'), e)).json();
    const body = { company: 'Acme', email: 'Jordan@Acme.test', start: slots[0], minutes: 30, ...extra };
    return worker.fetch(req('/book', { method: 'POST', body: JSON.stringify(body) }), e);
  };
  it('rejects the hidden spam field', async () => {
    const r = await book({}, { website: 'http://spam.example' });
    expect(r.status).toBe(400);
    expect(calls.some((c) => c.init.method === 'POST' && c.url.includes('/events'))).toBe(false);
  });
  it('allows one upcoming call per email address', async () => {
    const r = await book({}, {}, { upcoming: [{ attendees: [{ email: 'jordan@acme.test' }] }] });
    expect(r.status).toBe(429);
    expect((await r.json()).error).toBe('already_booked');
    const list = calls.find((c) => c.url.includes('/events') && !c.init.method);
    expect(decodeURIComponent(list.url)).toContain('privateExtendedProperty=source=chaseteichmann.com');
  });
  it('caps upcoming site bookings', async () => {
    const upcoming = Array.from({ length: 3 }, (_, i) => ({ attendees: [{ email: `p${i}@x.test` }] }));
    const r = await book({ MAX_UPCOMING_BOOKINGS: '3' }, {}, { upcoming });
    expect(r.status).toBe(429);
    expect((await r.json()).error).toBe('booking_limit');
  });
  it('rate limits by IP when the binding is present', async () => {
    mockGoogle();
    const keys = [];
    const limiter = { limit: async ({ key }) => { keys.push(key); return { success: false }; } };
    const r = await worker.fetch(req('/book', { method: 'POST', body: '{}', headers: { 'CF-Connecting-IP': '203.0.113.7' } }), { ...env, BOOK_LIMIT: limiter });
    expect(r.status).toBe(429);
    expect(keys).toEqual(['203.0.113.7']);
    expect(calls.length).toBe(0);
  });
  it('emails Chase the time and calendar link, without the visitor\'s details', async () => {
    const r = await book({ NOTIFY_EMAIL: 'me@example.test' }, { name: 'Jordan Lee', note: 'secret note' });
    expect(r.status).toBe(200);
    const mail = calls.find((c) => c.url.includes('gmail'));
    const raw = JSON.parse(mail.init.body).raw.replace(/-/g, '+').replace(/_/g, '/');
    const text = new TextDecoder().decode(Uint8Array.from(atob(raw), (ch) => ch.charCodeAt(0)));
    expect(text).toContain('To: me@example.test');
    expect(text).toContain('calendar/event?eid=abc');
    expect(text).not.toMatch(/Jordan|Acme|secret note/i);
  });
  it('counts one upcoming call per person, ignoring +tags, case and Gmail dots', async () => {
    const r = await book({}, { email: 'Jane.Doe+site@gmail.com' }, { upcoming: [{ attendees: [{ email: 'janedoe@googlemail.com' }] }] });
    expect(r.status).toBe(429);
    expect((await r.json()).error).toBe('already_booked');
  });
  it('keeps links, HTML and hidden characters out of the invite', async () => {
    const r = await book({}, {
      name: 'Jordan <b>Lee</b>\u202E',
      company: 'Win a prize at https://evil.example.com/claim',
      role: 'CTO\u200B at www.prize.io',
      note: 'Hi!\n\n\n\nClick <a href="https://evil.com">here</a> or mailto:x@evil.com',
    });
    expect(r.status).toBe(200);
    const sent = JSON.parse(calls.find((c) => c.url.includes('/events') && c.init.method === 'POST').init.body);
    const text = [sent.summary, sent.description.replace('Intro call booked from chaseteichmann.com.', ''), sent.attendees[0].displayName].join('\n');
    expect(text).not.toMatch(/https?:|mailto:|www\.|\.com\b|\.io\b|[<>]|[\u200B\u202E]/);
    expect(sent.summary).toBe('Intro call: Chase Teichmann × Win a prize at evil[.]example[.]com/claim');
    expect(sent.description).toContain('Click here or x@evil[.]com');
    expect(sent.description).not.toContain('\n\n\n');
  });
  it('shortens what visitors type', async () => {
    const r = await book({}, { name: 'n'.repeat(300), company: 'c'.repeat(300), role: 'r'.repeat(300), note: 'x'.repeat(5000) });
    expect(r.status).toBe(200);
    const sent = JSON.parse(calls.find((c) => c.url.includes('/events') && c.init.method === 'POST').init.body);
    expect(sent.attendees[0].displayName).toHaveLength(80);
    expect(sent.summary).toBe(`Intro call: Chase Teichmann × ${'c'.repeat(80)}`);
    expect(sent.description).toContain('x'.repeat(500));
    expect(sent.description).not.toContain('x'.repeat(501));
  });
  it('rejects email addresses with header characters', async () => {
    const r = await book({}, { email: 'a"b@x.test' });
    expect(r.status).toBe(400);
  });
  it('tells Chase how close the site is to its booking limit', async () => {
    const upcoming = Array.from({ length: 2 }, (_, i) => ({ attendees: [{ email: `p${i}@x.test` }] }));
    const r = await book({ NOTIFY_EMAIL: 'me@example.test', MAX_UPCOMING_BOOKINGS: '4' }, {}, { upcoming });
    expect(r.status).toBe(200);
    const raw = JSON.parse(calls.find((c) => c.url.includes('gmail')).init.body).raw.replace(/-/g, '+').replace(/_/g, '/');
    const text = new TextDecoder().decode(Uint8Array.from(atob(raw), (ch) => ch.charCodeAt(0)));
    expect(text).toContain('Upcoming calls booked from the site: 3 of 4.');
    expect(text).toContain('Close to the limit');
  });
  it('still books when the notification email fails', async () => {
    const r = await book({ NOTIFY_EMAIL: 'me@example.test' }, {}, { gmailStatus: 403 });
    expect(r.status).toBe(200);
  });
});

describe('reminderMinutes', () => {
  const H = 3_600_000;
  it('alerts just after booking, then an hour and ten minutes before', () => {
    expect(_internal.reminderMinutes(48 * H, 0)).toEqual([48 * 60 - 2, 60, 10]);
  });
  it('stays within Google\'s four-week limit', () => {
    expect(_internal.reminderMinutes(30 * 24 * H, 0)).toEqual([60, 10]);
  });
  it('drops reminders that would already be in the past', () => {
    expect(_internal.reminderMinutes(30 * 60_000, 0)).toEqual([28, 10]);
  });
});

describe('cleanText', () => {
  const c = (t, max = 500, o) => _internal.cleanText(t, max, o);
  it('leaves ordinary text alone', () => {
    expect(c('Staff Engineer, Node.js and Vue.js (e.g. Nuxt)')).toBe('Staff Engineer, Node.js and Vue.js (e.g. Nuxt)');
  });
  it('turns web addresses into plain text', () => {
    expect(c('see HTTPS://Evil.COM/x and Ｅｖｉｌ．ｃｏｍ')).toBe('see Evil[.]COM/x and Evil[.]com');
  });
  it('keeps line breaks only when asked', () => {
    expect(c('a\r\nb')).toBe('a b');
    expect(c('a\r\nb', 500, { multiline: true })).toBe('a\nb');
  });
  it('ignores anything that is not text', () => {
    expect(c(42)).toBe('');
    expect(c(null)).toBe('');
  });
});
