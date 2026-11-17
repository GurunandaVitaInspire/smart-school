/* Smart School — warns on the Substitute Time Table / Extra Work app when the chosen date is a
   holiday in the Academic Calendar (calendar.html). Read-only; it never changes the time table. */
(function () {
  'use strict';
  function holidayOn(iso) {
    var cal = null;
    try { cal = JSON.parse(localStorage.getItem('ss_calendar_v1') || 'null'); } catch (e) { return null; }
    if (!cal || !cal.events) return null;
    for (var i = 0; i < cal.events.length; i++) {
      var e = cal.events[i];
      if (e.type === 'holiday' && e.start <= iso && (e.end || e.start) >= iso) return e.label || 'Holiday';
    }
    return null;
  }
  function check() {
    var inp = document.getElementById('dateIn'); if (!inp) return;
    var box = document.getElementById('ssHoliday');
    if (!box) {
      box = document.createElement('div'); box.id = 'ssHoliday'; box.setAttribute('role', 'status');
      box.style.cssText = 'margin-top:10px;padding:12px 14px;border-radius:14px;font-weight:700;font-size:.95rem;background:#FDECEA;color:#9B1C1C;border:1px solid #F5C2BD';
      (inp.closest('.datebar') || inp.parentNode).insertAdjacentElement('afterend', box);
    }
    var h = inp.value ? holidayOn(inp.value) : null;
    box.hidden = !h;
    if (h) box.innerHTML = 'This date is a holiday in your Academic Calendar: <b></b>. No substitutes are needed. <a href="' + (location.pathname.indexOf('/extra-work/') >= 0 ? '../' : '') + 'calendar.html" style="color:inherit">Open calendar</a>';
    if (h) box.querySelector('b').textContent = h;
  }
  document.addEventListener('change', function (e) { if (e.target && e.target.id === 'dateIn') check(); });
  document.addEventListener('input', function (e) { if (e.target && e.target.id === 'dateIn') check(); });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(check, 400); });
  else setTimeout(check, 400);
})();
