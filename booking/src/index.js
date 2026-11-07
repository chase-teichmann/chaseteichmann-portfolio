// Booking Worker for chaseteichmann.com.
//   GET  /availability?minutes=30  → { slots: [ISO start, …] }  Chase's open times, minus his busy calendar.
//   POST /book                     → { start, end, meetLink }   Re-checks the slot, then creates the event
//                                    with a Google Meet link; Google emails the invite to the visitor.
// The Worker reads free/busy, plus the events it created itself (to limit repeat bookings). It signs in to
// Google as Chase with a refresh token stored as an encrypted Cloudflare secret, and it only answers
// requests from the site's own origins.
//
// Abuse limits, because the Origin check stops other websites but not scripts:
//   - per-IP rate limits (Cloudflare rate-limiting bindings AVAILABILITY_LIMIT and BOOK_LIMIT),
//   - a hidden "website" field that people never fill in,
//   - one upcoming call per email address, and at most MAX_UPCOMING_BOOKINGS upcoming site bookings.
// When NOTIFY_EMAIL is set, Chase also gets an email for each new booking (time and calendar link only).
import { RULES, slots } from './rules.js';
import { PROJECTS } from './projects.js';

const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';
const CAL = 'https://www.googleapis.com/calendar/v3';
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const DAY = 86_400_000;
const GMAIL_SEND = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';
const SOURCE = 'chaseteichmann.com'; // tag on events this Worker creates

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

    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    try {
      if (request.method === 'GET' && url.pathname === '/availability') {
        if (!(await allow(env.AVAILABILITY_LIMIT, ip))) return json(429, { error: 'rate_limited' });
        const minutes = Number(url.searchParams.get('minutes') || RULES.callMinutes);
        if (minutes !== RULES.callMinutes) return json(400, { error: 'invalid_minutes' });
        const now = Date.now();
        const busy = await freeBusy(env, now, now + (RULES.horizonDays + 1) * DAY);
        return json(200, { slots: slots({ now, minutes, busy }).map((s) => new Date(s).toISOString()) });
      }

      if (request.method === 'POST' && url.pathname === '/book') {
        if (!(await allow(env.BOOK_LIMIT, ip))) return json(429, { error: 'rate_limited' });
        const input = await readBooking(request);
        if (input.error) return json(400, { error: input.error });
        const upcoming = await siteBookings(env, input.email);
        if (upcoming.byEmail > 0) return json(429, { error: 'already_booked' });
        if (upcoming.total >= maxUpcoming(env)) return json(429, { error: 'booking_limit' });
        const now = Date.now();
        const busy = await freeBusy(env, now, now + (RULES.horizonDays + 1) * DAY);
        const open = slots({ now, minutes: RULES.callMinutes, busy });
        if (!open.includes(input.start)) return json(409, { error: 'slot_taken' });
        const event = await createEvent(env, input);
        if (env.NOTIFY_EMAIL) {
          const note = notifyChase(env, event).catch((err) => console.error('notify failed:', err && err.message));
          if (ctx && ctx.waitUntil) ctx.waitUntil(note);
          else await note;
        }
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
  // Hidden from people; bots that fill every field fill this one too.
  if (s(body.website, 200) || s(body._gotcha, 200)) return { error: 'rejected' };
  if (!EMAIL.test(out.email)) return { error: 'invalid_email' };
  if (!out.company) return { error: 'invalid_company' };
  if (!Number.isFinite(out.start)) return { error: 'invalid_start' };
  if (out.minutes !== RULES.callMinutes) return { error: 'invalid_minutes' };
  return out;
}

// Rate-limit binding check. Missing binding (local dev, tests) means no limit.
async function allow(limiter, key) {
  if (!limiter || typeof limiter.limit !== 'function') return true;
  const { success } = await limiter.limit({ key });
  return success;
}

const maxUpcoming = (env) => {
  const n = Number(env.MAX_UPCOMING_BOOKINGS);
  return Number.isFinite(n) && n > 0 ? n : 10;
};

// Upcoming events this Worker created: how many in total, and how many for this email address.
async function siteBookings(env, email) {
  const cal = encodeURIComponent(env.CALENDAR_ID || 'primary');
  const q = new URLSearchParams({ timeMin: new Date().toISOString(), singleEvents: 'true', maxResults: '250', fields: 'items(attendees(email),extendedProperties)' });
  q.append('privateExtendedProperty', `source=${SOURCE}`);
  const data = await google(env, `/calendars/${cal}/events?${q}`);
  const items = data.items || [];
  const who = email.toLowerCase();
  const byEmail = items.filter((ev) => (ev.attendees || []).some((a) => (a.email || '').toLowerCase() === who)).length;
  return { total: items.length, byEmail };
}

// Emails Chase that a call was booked: the time and a link to the event, nothing about the visitor
// (their details stay on the calendar event, as the privacy page says). Sent from his own Gmail.
const b64 = (text) => btoa(String.fromCharCode(...new TextEncoder().encode(text)));

async function notifyChase(env, event) {
  const when = new Intl.DateTimeFormat('en-US', { timeZone: RULES.timeZone, weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(new Date(event.start.dateTime));
  const lines = [`Someone booked an intro call from chaseteichmann.com for ${when}.`, '', `Details: ${event.htmlLink || 'see your Google Calendar'}`];
  const message = [
    `To: ${env.NOTIFY_EMAIL}`,
    `Subject: =?UTF-8?B?${b64(`New intro call: ${when}`)}?=`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    lines.join('\r\n'),
  ].join('\r\n');
  const raw = b64(message).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const res = await fetch(GMAIL_SEND, { method: 'POST', headers: { Authorization: `Bearer ${await accessToken(env)}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ raw }) });
  if (!res.ok) throw new Error(`Gmail send → ${res.status}`);
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

// Popup reminders on Chase's copy of the event (a visitor's own calendar keeps its own settings).
// Google Calendar's phone alerts are reliable where Gmail's aren't, so the first one goes off about
// two minutes after the booking as a "someone just booked" alert; the others come before the call.
// Google allows at most 5 reminders, each from 0 to 40320 minutes (4 weeks) before the start.
const JUST_BOOKED_DELAY = 2;
const BEFORE_CALL = [60, 10];
export function reminderMinutes(start, now) {
  const untilStart = Math.floor((start - now) / 60_000);
  const all = [untilStart - JUST_BOOKED_DELAY, ...BEFORE_CALL].filter((m) => m >= 0 && m <= 40_320 && m < untilStart);
  return [...new Set(all)].sort((a, b) => b - a);
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
      extendedProperties: { private: { source: SOURCE } },
      reminders: { useDefault: false, overrides: reminderMinutes(b.start, Date.now()).map((minutes) => ({ method: 'popup', minutes })) },
    }),
  });
}

// Exposed for tests.
export const _internal = { readBooking, notifyChase, reminderMinutes, resetToken: () => { cachedToken = null; } };
