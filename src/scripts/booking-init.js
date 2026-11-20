// Runs in <head> on every page. If this browser has an upcoming booking saved (see booking.js),
// marks <html> so the header's "Your booking" button shows without a flash. Expired bookings are
// removed here, so a booking is never kept past the end of its call.
(() => {
  try {
    const b = JSON.parse(localStorage.getItem('ct-booking') || 'null');
    if (b && Date.parse(b.end) > Date.now()) document.documentElement.classList.add('has-booking');
    else if (b) localStorage.removeItem('ct-booking');
  } catch {}
})();
