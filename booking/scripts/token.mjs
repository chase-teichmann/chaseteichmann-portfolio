// One-time: get a Google refresh token for the booking Worker.
// Usage: GOOGLE_CLIENT_ID=… GOOGLE_CLIENT_SECRET=… npm run token
// Opens a sign-in link; after you approve, the refresh token prints here. Nothing is saved to disk.
import http from 'node:http';
import { randomBytes } from 'node:crypto';

const id = process.env.GOOGLE_CLIENT_ID;
const secret = process.env.GOOGLE_CLIENT_SECRET;
if (!id || !secret) {
  console.error('Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET first (from your Desktop app OAuth client).');
  process.exit(1);
}
const scopes = ['https://www.googleapis.com/auth/calendar.events', 'https://www.googleapis.com/auth/calendar.freebusy'];
const state = randomBytes(16).toString('hex');

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname !== '/callback') { res.writeHead(404).end(); return; }
  if (url.searchParams.get('state') !== state) { res.writeHead(400).end('State mismatch. Run the script again.'); return; }
  const code = url.searchParams.get('code');
  if (!code) { res.writeHead(400).end(`Sign-in failed: ${url.searchParams.get('error') || 'no code'}`); return; }
  const redirect = `http://127.0.0.1:${server.address().port}/callback`;
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: id, client_secret: secret, redirect_uri: redirect, grant_type: 'authorization_code' }),
  });
  const data = await r.json();
  if (!data.refresh_token) {
    res.writeHead(500).end('No refresh token returned. See the terminal.');
    console.error('No refresh token in the response:', data.error || data);
    console.error('If you approved before, remove the app at myaccount.google.com/permissions and run this again.');
    process.exit(1);
  }
  res.writeHead(200, { 'Content-Type': 'text/plain' }).end('Done. Go back to your terminal.');
  console.log('\nYour refresh token (paste it into: npx wrangler secret put GOOGLE_REFRESH_TOKEN):\n');
  console.log(data.refresh_token);
  console.log('\nThen clear this terminal.');
  server.close();
});

server.listen(0, '127.0.0.1', () => {
  const redirect = `http://127.0.0.1:${server.address().port}/callback`;
  const auth = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  auth.search = new URLSearchParams({ client_id: id, redirect_uri: redirect, response_type: 'code', scope: scopes.join(' '), access_type: 'offline', prompt: 'consent', state }).toString();
  console.log('Open this link and sign in with the Gmail account that should receive bookings:\n');
  console.log(auth.toString());
});
