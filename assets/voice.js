/* Smart School — Telugu voice for "Read the AI analysis aloud", "Listen", chat answers …
 *
 * The report / progress card pages speak through one global function, speak(text, lang), which
 * uses the browser's own voices. Many devices have no Telugu voice, so nothing (or English) is heard.
 * This wraps speak(): Telugu text is turned into real audio by /api/tts (Bhashini, see api/tts.js)
 * and played; if that service is not set up or fails, the original device voice is used as before.
 */
(function () {
  'use strict';
  if (typeof window.speak !== 'function') return;
  var original = window.speak;
  var MAX = 480;                         /* characters per request (server limit 600) */
  var player = new Audio(), seq = 0, cache = {};
  player.preload = 'auto';

  /* Is the cloud voice available on this deployment? (404 locally, 503 until keys are set) */
  var ready = (/^https?:$/.test(location.protocol) ? fetch('/api/tts', { method: 'GET', cache: 'no-store' })
    .then(function (r) { return r.ok ? r.json() : { configured: false }; })
    .then(function (j) { return !!(j && j.configured); })
    .catch(function () { return false; }) : Promise.resolve(false));

  /* iPhones only allow audio started from a tap: unlock the one player on the first tap. */
  var SILENT = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';
  function unlock() {
    if (unlock.done) return; unlock.done = true;
    try { player.src = SILENT; var p = player.play(); if (p && p.catch) p.catch(function () {}); } catch (e) {}
  }
  ['click', 'touchend'].forEach(function (ev) { addEventListener(ev, unlock, { capture: true, passive: true }); });

  /* the pages declare `note` and `lang` as shared top-level consts: reachable by name, not via window */
  function note(msg) { try { var n = document.getElementById('tNote'); if (n) n.textContent = msg || ''; } catch (e) {} }
  function pageLang() { try { /* global const from the page */ return typeof lang === 'function' ? lang() : 'te'; } catch (e) { return 'te'; } }
  function stopAudio() { try { player.pause(); player.removeAttribute('src'); player.load(); } catch (e) {} }

  /* stopping speech (Stop button, a new answer …) also stops our audio */
  if (window.speechSynthesis && speechSynthesis.cancel) {
    var cancel = speechSynthesis.cancel.bind(speechSynthesis);
    speechSynthesis.cancel = function () { seq++; stopAudio(); return cancel(); };
  }

  function chunks(text) {
    var parts = String(text).replace(/\s+/g, ' ').match(/[^.!?।\n]+[.!?।]*/g) || [String(text)], out = [], cur = '';
    parts.forEach(function (p) {
      p = p.trim(); if (!p) return;
      while (p.length > MAX) { var cut = p.lastIndexOf(' ', MAX); cut = cut > 50 ? cut : MAX; if (cur) { out.push(cur); cur = ''; } out.push(p.slice(0, cut)); p = p.slice(cut).trim(); }
      if ((cur + ' ' + p).trim().length > MAX) { out.push(cur); cur = p; } else cur = (cur + ' ' + p).trim();
    });
    if (cur) out.push(cur);
    return out;
  }
  function fetchAudio(text, lang) {
    var key = lang + '|' + text;
    if (!cache[key]) {
      cache[key] = fetch('/api/tts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: text, lang: lang }) })
        .then(function (r) { if (!r.ok) throw new Error('tts ' + r.status); return r.blob(); })
        .then(function (b) { return URL.createObjectURL(b); });
      cache[key].catch(function () { delete cache[key]; });
    }
    return cache[key];
  }
  function playCloud(text, lang, my) {
    var list = chunks(text); if (!list.length) return Promise.resolve();
    var i = 0, next = fetchAudio(list[0], lang);
    return new Promise(function (resolve, reject) {
      function step() {
        if (my !== seq) return resolve();
        var cur = next; if (i + 1 < list.length) next = fetchAudio(list[i + 1], lang);   /* fetch ahead while this part plays */
        cur.then(function (url) {
          if (my !== seq) return resolve();
          player.onended = function () { i++; if (i < list.length) step(); else { note(''); resolve(); } };
          player.onerror = function () { reject(new Error('audio')); };
          player.src = url;
          var p = player.play(); if (p && p.catch) p.catch(reject);
          if (i === 0) note('');
        }, reject);
      }
      step();
    });
  }

  window.speak = function (text, lang) {
    if (lang == null) lang = pageLang();
    if (lang !== 'te') return original.call(this, text, lang);
    try { speechSynthesis.cancel(); } catch (e) { seq++; stopAudio(); }
    var my = ++seq;
    ready.then(function (ok) {
      if (my !== seq) return;
      if (!ok) { original(text, lang); return; }
      note('🔊 …');
      playCloud(text, lang, my).catch(function () { if (my === seq) { note(''); original(text, lang); } });
    });
  };
  window.speak.cloud = ready;
})();
