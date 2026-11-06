// Booking Worker for chaseteichmann.com.
//   GET  /availability?minutes=30  → { slots: [ISO start, …] }  Chase's open times, minus his busy calendar.
//   POST /book                     → { start, end, meetLink }   Re-checks the slot, then creates the event
//                                    with a Google Meet link; Google emails the invite to the visitor.
// The Worker reads free/busy only, never event details. It signs in to Google as Chase with a refresh token
// stored as an encrypted Cloudflare secret, and it only answers requests from the site's own origins.
import { RULES, slots } from './rules.js';
import { PROJECTS } from './projects.js';

const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';
const CAL = 'https://www.googleapis.com/calendar/v3';
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const DAY = 86_400_000;

let cachedToken = null; // { value, expires }

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get('Origin') || '';
    const allowed = (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
    const cors = allowed.includes(origin)
      ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Accept', 'Access-Control-Max-Age': '86400', Vary: 'Origin' }
      : { Vary: 'Origin' };
    const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...cors } });

    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { status: allowed.includes(origin) ? 204 : 403, headers: cors });
    // Browsers always send Origin on cross-site requests; anything else isn't the site.
    if (!allowed.includes(origin)) return json(403, { error: 'origin_not_allowed' });

    try {
      if (request.method === 'GET' && url.pathname === '/availability') {
        const minutes = Number(url.searchParams.get('minutes') || RULES.callMinutes);
        if (minutes !== RULES.callMinutes) return json(400, { error: 'invalid_minutes' });
        const now = Date.now();
        const busy = await freeBusy(env, now, now + (RULES.horizonDays + 1) * DAY);
        return json(200, { slots: slots({ now, minutes, busy }).map((s) => new Date(s).toISOString()) });
      }

      if (request.method === 'POST' && url.pathname === '/book') {
        const input = await readBooking(request);
        if (input.error) return json(400, { error: input.error });
        const now = Date.now();
        const busy = await freeBusy(env, now, now + (RULES.horizonDays + 1) * DAY);
        const open = slots({ now, minutes: RULES.callMinutes, busy });
        if (!open.includes(input.start)) return json(409, { error: 'slot_taken' });
        const event = await createEvent(env, input);
        return json(200, { start: event.start.dateTime, end: event.end.dateTime, meetLink: event.hangoutLink || null });
      }

      return json(404, { error: 'not_found' });
    } catch (err) {
      console.error(err && err.stack ? err.stack : String(err));
      // Fail closed: if any calendar can't be read, offer no times rather than risk a double booking.
      return json(503, { error: 'calendar_unavailable' });
    }
  },
};

async function readBooking(request) {
  let body;
  try { body = await request.json(); } catch { return { error: 'invalid_json' }; }
  const s = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const out = {
    name: s(body.name, 120),
    company: s(body.company, 160),
    role: s(body.role, 160),
    email: s(body.email, 254),
    note: s(body.note, 2000),
    agenda: Array.isArray(body.agenda) ? [...new Set(body.agenda.filter((id) => typeof id === 'string' && id in PROJECTS))].slice(0, 12) : [],
    start: Date.parse(body.start),
    minutes: Number(body.minutes),
  };
  if (!EMAIL.test(out.email)) return { error: 'invalid_email' };
  if (!out.company) return { error: 'invalid_company' };
  if (!Number.isFinite(out.start)) return { error: 'invalid_start' };
  if (out.minutes !== RULES.callMinutes) return { error: 'invalid_minutes' };
  return out;
}

async function accessToken(env) {
  if (cachedToken && cachedToken.expires > Date.now() + 60_000) return cachedToken.value;
  const res = await fetch(GOOGLE_TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, refresh_token: env.GOOGLE_REFRESH_TOKEN, grant_type: 'refresh_token' }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`token refresh failed: ${data.error || res.status}`); // e.g. invalid_grant
  cachedToken = { value: data.access_token, expires: Date.now() + (data.expires_in || 3600) * 1000 };
  return cachedToken.value;
}

async function google(env, path, init = {}) {
  const res = await fetch(CAL + path, { ...init, headers: { Authorization: `Bearer ${await accessToken(env)}`, 'Content-Type': 'application/json', ...(init.headers || {}) } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Google Calendar ${path} → ${res.status} ${JSON.stringify(data.error || data).slice(0, 300)}`);
  return data;
}

async function freeBusy(env, from, until) {
  const ids = (env.BUSY_CALENDAR_IDS || 'primary').split(',').map((s) => s.trim()).filter(Boolean);
  const data = await google(env, '/freeBusy', {
    method: 'POST',
    body: JSON.stringify({ timeMin: new Date(from).toISOString(), timeMax: new Date(until).toISOString(), timeZone: RULES.timeZone, items: ids.map((id) => ({ id })) }),
  });
  const busy = [];
  for (const id of ids) {
    const cal = data.calendars && data.calendars[id];
    if (!cal || (cal.errors && cal.errors.length)) throw new Error(`free/busy unavailable for ${id}`);
    for (const b of cal.busy) busy.push({ start: Date.parse(b.start), end: Date.parse(b.end) });
  }
  return busy;
}

async function createEvent(env, b) {
  const end = b.start + RULES.callMinutes * 60_000;
  const agenda = b.agenda.length ? b.agenda.map((id) => `• ${PROJECTS[id]}`).join('\n') : '• No projects picked. General intro.';
  const who = [b.name, b.role && `hiring for ${b.role}`].filter(Boolean).join(', ');
  const description = [
    `Intro call booked from chaseteichmann.com.`,
    ``,
    `Who: ${who || b.email} (${b.company})`,
    `Email: ${b.email}`,
    ``,
    `Agenda:`,
    agenda,
    ...(b.note ? ['', 'Note:', b.note] : []),
  ].join('\n');
  return google(env, `/calendars/${encodeURIComponent(env.CALENDAR_ID || 'primary')}/events?conferenceDataVersion=1&sendUpdates=all`, {
    method: 'POST',
    body: JSON.stringify({
      summary: `Intro call: Chase Teichmann × ${b.company}`,
      description,
      start: { dateTime: new Date(b.start).toISOString(), timeZone: RULES.timeZone },
      end: { dateTime: new Date(end).toISOString(), timeZone: RULES.timeZone },
      attendees: [{ email: b.email, displayName: b.name || undefined }],
      conferenceData: { createRequest: { requestId: crypto.randomUUID(), conferenceSolutionKey: { type: 'hangoutsMeet' } } },
      guestsCanModify: false,
      reminders: { useDefault: true },
    }),
  });
}

// Exposed for tests.
export const _internal = { readBooking, resetToken: () => { cachedToken = null; } };
