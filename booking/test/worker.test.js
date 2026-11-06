import { describe, it, expect, beforeEach, vi } from 'vitest';
import worker, { _internal } from '../src/index.js';

const env = { GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 'secret', GOOGLE_REFRESH_TOKEN: 'refresh', ALLOWED_ORIGINS: 'https://chaseteichmann.com', BUSY_CALENDAR_IDS: 'primary' };
const ORIGIN = { Origin: 'https://chaseteichmann.com' };
let calls;

function mockGoogle({ busy = [], freeBusyError = false, tokenError = false } = {}) {
  calls = [];
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    calls.push({ url: String(url), init });
    const j = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    if (String(url).includes('oauth2')) return tokenError ? j(400, { error: 'invalid_grant' }) : j(200, { access_token: 'at', expires_in: 3600 });
    if (String(url).endsWith('/freeBusy')) return j(200, { calendars: { primary: freeBusyError ? { errors: [{ reason: 'notFound' }] } : { busy } } });
    if (String(url).includes('/events')) {
      const b = JSON.parse(init.body);
      return j(200, { start: { dateTime: b.start.dateTime }, end: { dateTime: b.end.dateTime }, hangoutLink: 'https://meet.google.com/abc-defg-hij' });
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
    const ev = calls.find((c) => c.url.includes('/events'));
    expect(ev.url).toContain('sendUpdates=all');
    expect(ev.url).toContain('conferenceDataVersion=1');
    const sent = JSON.parse(ev.init.body);
    expect(sent.attendees[0].email).toBe('jordan@acme.test');
    expect(sent.description).toContain('Automated billing on Recurly');
    expect(sent.description).not.toContain('nope');
    expect(Date.parse(sent.end.dateTime) - Date.parse(sent.start.dateTime)).toBe(30 * 60_000);
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
});
