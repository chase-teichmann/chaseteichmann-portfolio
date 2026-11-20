// "Your booking": remembers a booked call in this browser until the call ends, and shows it on
// its own page (/booking/). Runs on every page.
//
// - Home page: when checkout books a real call (store.js fires "ct:booked"), the booking is saved
//   under the `ct-booking` localStorage key, and once the shipping animation finishes the visitor
//   lands on /booking/ instead of a confirmation in the middle of the page.
// - /booking/ page: fills in the details from the saved booking, or says there isn't one.
// - Header: booking-init.js shows the "Your booking" button while a booking is saved.
//
// Nothing here is sent anywhere. The saved booking is removed when its call ends, or when the
// visitor removes it on the booking page.
(() => {
  const KEY = 'ct-booking';
  const root = document.documentElement;

  /** The saved booking, or null if there isn't one (or it has ended, or is unreadable). */
  function read() {
    let b = null;
    try {
      b = JSON.parse(localStorage.getItem(KEY) || 'null');
    } catch {
      return null;
    }
    const ok =
      b && b.v === 1 && typeof b.start === 'string' && typeof b.end === 'string' &&
      Number.isFinite(Date.parse(b.start)) && Number.isFinite(Date.parse(b.end)) &&
      Array.isArray(b.agenda);
    if (!ok || Date.parse(b.end) <= Date.now()) {
      forget();
      return null;
    }
    return b;
  }

  function save(b) {
    try {
      localStorage.setItem(KEY, JSON.stringify(b));
      root.classList.add('has-booking');
      return true;
    } catch {
      return false;
    }
  }

  function forget() {
    try {
      localStorage.removeItem(KEY);
    } catch {}
    root.classList.remove('has-booking');
  }

  /** Same reference the checkout has always shown: CT-<yymmdd>-<first 4 letters of the company>. */
  function reference(company, on = new Date()) {
    const two = (n) => String(n).padStart(2, '0');
    const date = `${String(on.getFullYear()).slice(2)}${two(on.getMonth() + 1)}${two(on.getDate())}`;
    const co = String(company || '').replace(/[^a-z0-9]/gi, '').slice(0, 4).toUpperCase() || 'REQ';
    return `CT-${date}-${co}`;
  }

  // ---------- Home page: save the booking, then go to its page ----------
  document.addEventListener('ct:booked', (e) => {
    const { mode, request, result, protection } = e.detail || {};
    if (mode !== 'sent' || !request || !result) return; // preview bookings stay on the page
    const saved = save({
      v: 1,
      ref: reference(request.company),
      start: result.start || request.start,
      end: result.end || new Date(Date.parse(request.start) + request.minutes * 60000).toISOString(),
      minutes: request.minutes,
      email: request.email,
      company: request.company,
      role: request.role || '',
      agenda: [...(request.agenda || [])],
      protection: protection !== false,
      meetLink: typeof result.meetLink === 'string' ? result.meetLink : null,
    });
    if (!saved) return; // storage blocked: the in-page confirmation still shows

    const target = document.querySelector('[data-booking-link]');
    const url = target ? target.href : new URL('booking/index.html', location.href).href;
    let gone = false;
    const go = () => {
      if (gone) return;
      gone = true;
      location.assign(url);
    };
    // Hide the page behind the shipping animation so the old in-page confirmation never flashes.
    root.classList.add('is-leaving-for-booking');
    setTimeout(() => {
      const ship = document.querySelector('body > .ship');
      if (!ship) return go();
      new MutationObserver((_, obs) => {
        if (!ship.isConnected) {
          obs.disconnect();
          go();
        }
      }).observe(document.body, { childList: true });
    }, 60);
    setTimeout(go, 10000); // never strand the visitor if the animation misbehaves
  });

  // Coming back to the home page with the browser's Back button restores it as it was left (in the
  // confirmation view, hidden). Put the store back to normal instead.
  addEventListener('pageshow', (e) => {
    if (!e.persisted || !root.classList.contains('is-leaving-for-booking')) return;
    root.classList.remove('is-leaving-for-booking');
    document.querySelector('[data-panel="sent"] [data-action="reset"]')?.click();
  });

  // ---------- /booking/ page ----------
  const page = document.querySelector('[data-booking-page]');
  if (!page) return;

  const $ = (sel) => page.querySelector(sel);
  const found = $('[data-bk-found]');
  const none = $('[data-bk-none]');
  const set = (sel, text) => {
    const el = $(sel);
    if (el) el.textContent = text;
  };

  function showNone() {
    found.hidden = true;
    none.hidden = false;
  }

  function relative(start, end, now = Date.now()) {
    if (now >= start && now < end) return 'Happening now';
    const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
    const mins = Math.round((start - now) / 60000);
    if (mins < 60) return `Starts ${rtf.format(Math.max(mins, 1), 'minute')}`;
    const hours = Math.round(mins / 60);
    if (hours < 24) return `Starts ${rtf.format(hours, 'hour')}`;
    // Whole calendar days between today and the call, in the visitor's time zone.
    const day = (t) => {
      const d = new Date(t);
      return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
    };
    return rtf.format(Math.round((day(start) - day(now)) / 86400000), 'day').replace(/^./, (c) => c.toUpperCase());
  }

  function render(b) {
    const start = Date.parse(b.start);
    const end = Date.parse(b.end);
    const minutes = b.minutes || Math.round((end - start) / 60000);
    const when = new Intl.DateTimeFormat(undefined, {
      weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
    }).format(start);

    set('[data-bk-ref]', `Confirmation #${b.ref || reference(b.company)}`);
    set('[data-bk-when]', when);
    set('[data-bk-rel]', relative(start, end));
    set('[data-bk-contact]', b.email || '');
    set('[data-bk-company]', b.company || '');
    set('[data-bk-role]', b.role || '');
    $('[data-bk-role]').hidden = !b.role;
    set('[data-bk-when-short]', when);
    set('[data-bk-where]', `Google Meet · ${minutes} min`);
    set('[data-bk-invite]', b.email
      ? `A Google Calendar invite with the Meet link, sent to ${b.email}.`
      : 'A Google Calendar invite with the Meet link.');
    set('[data-bk-call]', `${when}, ${minutes} minutes on Google Meet.`);

    const join = $('[data-bk-join]');
    const meet = typeof b.meetLink === 'string' && /^https:\/\/meet\.google\.com\//.test(b.meetLink);
    join.hidden = !meet;
    if (meet) join.href = b.meetLink;

    // Order summary: one line per project, in agenda order.
    const lines = $('[data-bk-lines]');
    lines.replaceChildren();
    for (const id of b.agenda) {
      const tpl = page.querySelector(`template[data-bk-line="${CSS.escape(String(id))}"]`);
      if (!tpl) continue;
      const line = tpl.content.cloneNode(true);
      // Use just the drawing as the thumbnail, as the checkout's order summary does.
      line.querySelectorAll('.booking__art').forEach((box) => {
        const svg = box.querySelector('svg');
        if (!svg) return box.remove();
        svg.removeAttribute('aria-labelledby');
        svg.removeAttribute('role');
        svg.setAttribute('aria-hidden', 'true');
        svg.setAttribute('focusable', 'false');
        svg.querySelectorAll('[id]').forEach((el) => el.removeAttribute('id'));
        svg.querySelectorAll('title,desc').forEach((el) => el.remove());
        box.replaceWith(svg);
      });
      lines.appendChild(line);
    }
    const count = lines.children.length;
    lines.hidden = count === 0;
    $('[data-bk-empty]').hidden = count > 0;
    set('[data-bk-count]', `Subtotal · ${count} ${count === 1 ? 'item' : 'items'}`);
    $('[data-bk-protect-line]').hidden = !b.protection;

    found.hidden = false;
    none.hidden = true;
  }

  const booking = read();
  if (booking) render(booking);
  else showNone();

  // Keep "Starts in …" current while the page is open, and drop the booking once the call ends.
  if (booking) {
    const timer = setInterval(() => {
      if (!read()) {
        clearInterval(timer);
        showNone();
        return;
      }
      set('[data-bk-rel]', relative(Date.parse(booking.start), Date.parse(booking.end)));
    }, 30000);
  }

  $('[data-bk-forget]')?.addEventListener('click', () => {
    forget();
    showNone();
    $('[data-bk-none-title]')?.focus();
  });
})();
