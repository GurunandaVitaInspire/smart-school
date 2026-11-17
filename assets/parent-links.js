/* Smart School — Parent Links list (progress card / report card, teacher view).
   Each student's 💬 button already opens WhatsApp straight to that parent's number when the
   marks sheet has it (column H, "MOBILE (10 digits)"). This shows, on every row, which number
   the button will open — or that the number is missing, so the teacher can add it to the sheet. */
(function () {
  'use strict';
  if (/[#&?]d=/.test(location.hash + '&' + location.search)) return; /* parent's own view: nothing to do */
  var css = document.createElement('style');
  css.textContent = '.dgR .ss-ph{flex:0 0 auto!important;min-width:0}.ss-ph{flex:none;font-size:.72rem;font-weight:800;padding:3px 8px;border-radius:999px;white-space:nowrap}' +
    '.ss-ph.ok{background:#E3F6EE;color:#12805C}.ss-ph.no{background:#FDECEA;color:#B42318}' +
    '.ss-ph-note{margin:8px 0 0;padding:10px 12px;border-radius:12px;background:#FFF4D6;color:#5A3E00;font-size:.85rem;font-weight:600}';
  document.head.appendChild(css);

  function mark(list) {
    var rows = list.querySelectorAll('.dgR'), missing = 0;
    [].forEach.call(rows, function (row) {
      var wa = row.querySelector('a[href*="wa.me/"]'); if (!wa || row.querySelector('.ss-ph')) { if (row.querySelector('.ss-ph.no')) missing++; return; }
      var m = /wa\.me\/(\d{10,13})\?/.exec(wa.getAttribute('href') || '');
      var tag = document.createElement('span');
      if (m) {
        tag.className = 'ss-ph ok'; tag.textContent = '📱 ••••' + m[1].slice(-4);
        tag.title = 'WhatsApp opens the chat with +' + m[1].replace(/^91/, '91 ');
        wa.title = 'Open WhatsApp chat with this parent';
      } else {
        tag.className = 'ss-ph no'; tag.textContent = 'No mobile number';
        tag.title = 'Add the parent’s 10-digit mobile number in column H of the marks sheet. Until then WhatsApp asks you to pick the contact.';
        missing++;
      }
      wa.parentNode.insertBefore(tag, wa);
    });
    var intro = document.querySelector('#dgP p');
    if (intro && rows.length && !intro.dataset.ss) {
      intro.dataset.ss = '1';
      intro.textContent = 'Tap 💬 to open WhatsApp straight in that parent’s chat (number from the marks sheet), then press Send. Tap 👁 to see the card exactly as the parent will see it.';
    }
    var note = document.getElementById('ssPhNote');
    if (missing && !note) {
      note = document.createElement('p'); note.id = 'ssPhNote'; note.className = 'ss-ph-note';
      list.parentNode.insertBefore(note, list);
    }
    if (note) {
      note.hidden = !missing;
      note.textContent = missing + ' student(s) have no mobile number in the marks sheet. Type the parent’s 10-digit number in column H (“MOBILE”) and upload the sheet again — then WhatsApp opens their chat directly.';
    }
  }
  function watch() {
    var list = document.getElementById('dgL'); if (!list) return;
    new MutationObserver(function () { mark(list); }).observe(list, { childList: true, subtree: true });
    mark(list);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watch); else watch();
})();
