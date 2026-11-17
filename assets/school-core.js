/* Smart School — shared logic for the dashboard, calendar, prep plan and timetable pages.
   Everything here runs in the browser; nothing is uploaded anywhere.
   Statistics, exam-focus and working-day maths are ported from the team's
   Interactive Progress Report project (class_stats.py, student_analytics.py,
   exam_focus.py, calendar.py) so both apps give the same answers. */
(function () {
  'use strict';
  var SS = window.SS = window.SS || {};

  /* ------------------------------------------------------------------ utils */
  SS.esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  SS.$ = function (sel, root) { return (root || document).querySelector(sel); };
  SS.$$ = function (sel, root) { return [].slice.call((root || document).querySelectorAll(sel)); };
  SS.isNum = function (v) { return typeof v === 'number' && isFinite(v); };
  SS.round1 = function (v) { return Math.round(v * 10) / 10; };
  SS.ls = function (k, v) {
    try {
      if (v === undefined) return localStorage.getItem(k);
      if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v);
    } catch (e) { return null; }
  };
  SS.school = function () { return { name: SS.ls('ssat_school') || '', addr: SS.ls('ssat_addr') || '' }; };
  SS.toast = function (msg) {
    var t = SS.$('#toast');
    if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
    t.textContent = msg; t.classList.add('on');
    clearTimeout(SS._tt); SS._tt = setTimeout(function () { t.classList.remove('on'); }, 3200);
  };

  /* ---------------------------------------------- libraries (same CDN as the tools) */
  var LIBS = {
    XLSX: 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
    SSAT: 'ssat-sheet.js',
    html2pdf: 'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js'
  };
  SS.need = function (name) {
    if (window[name]) return Promise.resolve();
    return new Promise(function (res, rej) {
      var s = document.createElement('script'); s.src = LIBS[name];
      s.onload = res; s.onerror = function () { rej(new Error('Could not load ' + name + '. Check the internet connection.')); };
      document.head.appendChild(s);
    });
  };

  /* ------------------------------------------------ the marks sheet from the Home page */
  function idbGet(key) {
    return new Promise(function (res) {
      try {
        var r = indexedDB.open('ssat', 1);
        r.onupgradeneeded = function () { r.result.createObjectStore('files'); };
        r.onsuccess = function () {
          try {
            var q = r.result.transaction('files', 'readonly').objectStore('files').get(key);
            q.onsuccess = function () { res(q.result || null); }; q.onerror = function () { res(null); };
          } catch (e) { res(null); }
        };
        r.onerror = function () { res(null); };
      } catch (e) { res(null); }
    });
  }
  /* Resolves { file, time, data } or null when nothing has been uploaded yet.
     data = { stu:[...], ex:[...], meta:{...} } exactly as the report-card tools read it. */
  SS.loadMarks = function () {
    return idbGet('marks').then(function (rec) {
      if (!rec || !rec.buf) return null;
      return SS.need('XLSX').then(function () { return SS.need('SSAT'); }).then(function () {
        var data = window.SSAT.fromWorkbook(window.XLSX.read(rec.buf, { type: 'array' }));
        return { file: rec.name, time: rec.time, data: data };
      });
    });
  };

  /* Students of one class (and optional section), with that class's own exam list. */
  SS.classView = function (data, cls, sec) {
    var stu = data.stu.filter(function (s) { return String(s.c) === String(cls) && (!sec || s.sec === sec); });
    var exams = (data.meta.exBy && data.meta.exBy[cls]) || data.ex;
    var present = exams.filter(function (e) { return stu.some(function (s) { return s.ex[e.k]; }); });
    return { students: stu, exams: present };
  };
  SS.sections = function (data, cls) {
    var set = {};
    data.stu.forEach(function (s) { if (String(s.c) === String(cls) && s.sec) set[s.sec] = 1; });
    return Object.keys(set).sort();
  };

  /* ------------------------------------------------------------ grades */
  SS.GRADE_ORDER = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'D1', 'D2'];
  SS.GRADE_POINTS = { A1: 10, A2: 9, B1: 8, B2: 7, C1: 6, C2: 5, D1: 4, D2: 3 };
  SS.GRADE_COLOR = { A1: '#12A37A', A2: '#34B98A', B1: '#2F80ED', B2: '#5B9BF0', C1: '#D99A00', C2: '#E8B23A', D1: '#EA6A1B', D2: '#E5484D' };

  /* Port of class_stats.compute_class_stats */
  SS.classStats = function (students, exams, selectedKey) {
    var keys = exams.map(function (e) { return e.k; });
    var key = keys.indexOf(selectedKey) >= 0 ? selectedKey : keys[keys.length - 1];
    var exDef = exams.filter(function (e) { return e.k === key; })[0];
    var counts = {}; SS.GRADE_ORDER.forEach(function (g) { counts[g] = 0; });
    var pass = 0, fail = 0, graded = 0, absent = 0;
    var subMarks = {}, subMax = {}, subOrder = [];
    var ranked = [];
    students.forEach(function (s) {
      var e = s.ex[key]; if (!e) return;
      if (e.res === 'ABSENT') { absent++; return; }
      var g = e.tg;
      if (SS.GRADE_POINTS[g]) { graded++; counts[g]++; if (g === 'D2' || e.res === 'FAIL') fail++; else pass++; }
      (e.subs || []).forEach(function (x) {
        if (!SS.isNum(x.m)) return;
        if (!subMarks[x.n]) { subMarks[x.n] = []; subOrder.push(x.n); subMax[x.n] = x.mx; }
        subMarks[x.n].push(x.m);
      });
      if (SS.isNum(e.rk)) ranked.push({ s: s, rank: e.rk, total: e.tm, max: e.tmax, grade: g, res: e.res });
    });
    ranked.sort(function (a, b) { return a.rank - b.rank; });
    var subjectAverages = subOrder.map(function (n) {
      var v = subMarks[n], avg = v.reduce(function (a, b) { return a + b; }, 0) / v.length, mx = subMax[n] || 0;
      var passN = v.filter(function (m) { return mx && m / mx >= 0.35; }).length;
      return { subject: n, avg: SS.round1(avg), max: mx, pct: mx ? SS.round1(avg * 100 / mx) : 0, passPct: Math.round(passN * 100 / v.length), n: v.length };
    });
    var top = ranked.filter(function (r) { return r.grade !== 'D2' && r.res !== 'FAIL'; }).slice(0, 5);
    var attention = [], seen = [];
    students.forEach(function (s) {
      var e = s.ex[key];
      if (e && (e.tg === 'D2' || e.res === 'FAIL')) { attention.push({ s: s, rank: e.rk, total: e.tm, max: e.tmax, grade: e.tg, reason: 'fail' }); seen.push(s); }
    });
    ranked.filter(function (r) { return seen.indexOf(r.s) < 0 && ['C1', 'C2', 'D1'].indexOf(r.grade) >= 0; })
      .sort(function (a, b) { return b.rank - a.rank; })
      .forEach(function (r) { if (attention.length < 6) attention.push({ s: r.s, rank: r.rank, total: r.total, max: r.max, grade: r.grade, reason: 'low' }); });
    var attPcts = [], lowAtt = [];
    students.forEach(function (s) {
      var p = SS.attendancePct(s);
      if (p != null) { attPcts.push(p); if (p < 75) lowAtt.push({ s: s, pct: p }); }
    });
    lowAtt.sort(function (a, b) { return a.pct - b.pct; });
    var trend = keys.map(function (k) {
      var vals = [], max = 0;
      students.forEach(function (s) { var e = s.ex[k]; if (e && SS.isNum(e.tm) && e.tmax) { vals.push(e.tm / e.tmax); } });
      return { exam: k, pct: vals.length ? SS.round1(vals.reduce(function (a, b) { return a + b; }, 0) * 100 / vals.length) : null };
    });
    return {
      key: key, exam: exDef, total: students.length, graded: graded, pass: pass, fail: fail, absent: absent,
      passPct: graded ? Math.round(pass * 100 / graded) : null,
      grades: SS.GRADE_ORDER.map(function (g) { return { grade: g, count: counts[g] }; }),
      subjects: subjectAverages, top: top, attention: attention.slice(0, 6),
      avgAttendance: attPcts.length ? SS.round1(attPcts.reduce(function (a, b) { return a + b; }, 0) / attPcts.length) : null,
      lowAttendance: lowAtt, trend: trend
    };
  };

  SS.attendancePct = function (s) {
    var a = s.att; if (!a || !a.ms) return null;
    var wd = 0, at = 0;
    a.ms.forEach(function (m) { if (SS.isNum(m.wd) && SS.isNum(m.at)) { wd += m.wd; at += m.at; } });
    return wd ? SS.round1(at * 100 / wd) : null;
  };

  /* Port of student_analytics.build_student_analytics */
  SS.studentAnalytics = function (student, classStudents, exams) {
    var present = exams.filter(function (e) { return student.ex[e.k]; });
    var rows = {}, names = [];
    present.forEach(function (e) {
      var classVals = {};
      classStudents.forEach(function (s) {
        var x = s.ex[e.k]; if (!x) return;
        (x.subs || []).forEach(function (sub) { if (SS.isNum(sub.m)) (classVals[sub.n] = classVals[sub.n] || []).push(sub.m); });
      });
      (student.ex[e.k].subs || []).forEach(function (sub) {
        if (!rows[sub.n]) { rows[sub.n] = []; names.push(sub.n); }
        var v = classVals[sub.n] || [];
        rows[sub.n].push({ exam: e.k, m: SS.isNum(sub.m) ? sub.m : null, g: sub.g, mx: sub.mx, avg: v.length ? SS.round1(v.reduce(function (a, b) { return a + b; }, 0) / v.length) : null });
      });
    });
    var strengths = [], weak = [], failing = [];
    var subjects = names.map(function (n) {
      var r = rows[n], graded = r.filter(function (x) { return SS.GRADE_POINTS[x.g]; }), trend = null;
      if (graded.length >= 2) {
        var a = SS.GRADE_POINTS[graded[0].g], b = SS.GRADE_POINTS[graded[graded.length - 1].g];
        trend = b > a ? 'up' : b < a ? 'down' : 'flat';
      }
      if (graded.length) {
        var avg = graded.reduce(function (t, x) { return t + SS.GRADE_POINTS[x.g]; }, 0) / graded.length;
        if (graded.some(function (x) { return x.g === 'D2'; })) failing.push(n);
        else if (avg < 6) weak.push(n);
        else if (avg >= 8) strengths.push(n);
      }
      return { name: n, perExam: r, trend: trend };
    });
    var rankTrend = present.map(function (e) { var x = student.ex[e.k]; return { exam: e.k, rank: SS.isNum(x.rk) ? x.rk : null, total: x.tm, max: x.tmax, grade: x.tg, res: x.res }; });
    return { exams: present.map(function (e) { return e.k; }), subjects: subjects, rankTrend: rankTrend, attendance: student.att ? student.att.ms || [] : [], attendancePct: SS.attendancePct(student), strengths: strengths, weak: weak, failing: failing };
  };

  /* ------------------------------------------------- exam focus (port of exam_focus.py) */
  SS.examSequence = function (fa, sa) {
    if (fa <= 0) return Array.from({ length: sa }, function (_, i) { return 'SA-' + (i + 1); });
    if (sa <= 0) return Array.from({ length: fa }, function (_, i) { return 'FA-' + (i + 1); });
    var base = Math.floor(fa / sa), extra = fa % sa, seq = [], n = 1;
    for (var s = 1; s <= sa; s++) {
      var size = base + (s <= extra ? 1 : 0);
      for (var i = 0; i < size; i++) seq.push('FA-' + (n++));
      seq.push('SA-' + s);
    }
    return seq;
  };
  SS.nextExam = function (done, fa, sa) {
    var d = done.map(function (k) { return String(k).trim().toUpperCase(); });
    var seq = SS.examSequence(fa, sa);
    for (var i = 0; i < seq.length; i++) if (d.indexOf(seq[i]) < 0) return seq[i];
    return null;
  };
  SS.chaptersForExam = function (chapters, slot, fa, sa) {
    var sorted = chapters.slice().sort(function (a, b) { return a.no - b.no; });
    var m = /^(FA|SA)-?(\d+)$/i.exec(slot || '');
    if (!m || !sorted.length || fa <= 0) return [];
    var kind = m[1].toUpperCase(), num = +m[2], size = Math.ceil(sorted.length / fa);
    if (kind === 'FA') return sorted.slice((num - 1) * size, (num - 1) * size + size);
    var covered = sa ? Math.round(num * fa / sa) : fa;
    return sorted.slice(0, covered * size);
  };
  SS.topTopics = function (topics, limit) {
    return topics.slice().sort(function (a, b) { return (b.marks + (b.choice || 0)) - (a.marks + (a.choice || 0)); }).slice(0, limit || 3);
  };
  /* Everything the prep plan needs for one subject. Returns null when there is no syllabus data for it. */
  SS.examFocus = function (subjectCode, doneKeys) {
    var D = window.SS_DATA && window.SS_DATA.subjects[subjectCode];
    if (!D) return null;
    var plan = SS.calendar.get().examPlan;
    var slot = SS.nextExam(doneKeys, plan.fa, plan.sa);
    var chapters = slot ? SS.chaptersForExam(D.chapters, slot, plan.fa, plan.sa) : [];
    chapters = chapters.filter(function (c) { return NOT_A_LESSON.indexOf(c.name) < 0; });
    if (slot && /^SA/i.test(slot)) {
      /* an SA is cumulative: list only what is new since the last exam, then mention the rest */
      var prev = SS.examSequence(plan.fa, plan.sa), idx = prev.indexOf(slot);
      var before = idx > 0 ? SS.chaptersForExam(D.chapters, prev[idx - 1], plan.fa, plan.sa) : [];
      chapters = chapters.map(function (c) { return Object.assign({ revise: before.indexOf(c) >= 0 || false }, c); });
    }
    return { code: subjectCode, en: D.en, te: D.te, exam: slot, date: slot ? SS.calendar.examDate(slot) : null, chapters: chapters, top: SS.topTopics(D.topics, 3), info: D.exam };
  };

  /* --------------------------------------------- deterministic day-by-day study plan
     The other project asks an LLM per subject; this one is rule-based and covers all of a
     student's focus subjects together, because a student studies them side by side:
     - only real working dates between today and the exam (weekly off-days and holidays removed)
     - each day mixes up to two subjects (more only if the chapters would not fit otherwise)
     - new chapters for the coming exam first, failing subjects first; spare days revise
       chapters taught earlier in the year (most recent first)
     - the last day before the exam revises each subject's highest-marks blueprint topic */
  var NOT_A_LESSON = ['शब्दकोश'];
  SS.studyPlan = function (focuses, fromISO) {
    focuses = (focuses || []).filter(function (f) { return f && f.exam && f.date; });
    if (!focuses.length) return null;
    var examDay = focuses.map(function (f) { return f.date.start; }).sort()[0];
    var today = fromISO || SS.isoDate(new Date());
    var dates = SS.calendar.workingDates(today, SS.addDays(examDay, -1));
    if (!dates.length) return { tooLate: true, days: [], examDate: examDay, exam: focuses[0].exam };
    var study = dates.length > 1 ? dates.slice(0, -1) : dates.slice();
    var plan = SS.calendar.get().examPlan;
    var queues = focuses.map(function (f) {
      var D = window.SS_DATA.subjects[f.code], seq = SS.examSequence(plan.fa, plan.sa), idx = seq.indexOf(f.exam);
      var fresh = f.chapters.filter(function (c) { return !c.revise && NOT_A_LESSON.indexOf(c.name) < 0; });
      var taught = [];
      for (var i = 0; i < idx; i++) SS.chaptersForExam(D.chapters, seq[i], plan.fa, plan.sa).forEach(function (c) { if (taught.indexOf(c) < 0) taught.push(c); });
      var rev = taught.filter(function (c) { return !fresh.some(function (x) { return x.no === c.no; }) && NOT_A_LESSON.indexOf(c.name) < 0; }).reverse();
      return { f: f, fresh: fresh.slice(), rev: rev };
    });
    var freshTotal = queues.reduce(function (n, q) { return n + q.fresh.length; }, 0);
    var per = Math.min(4, Math.max(Math.min(2, queues.length), Math.ceil(freshTotal / study.length)));
    var days = [], turn = 0;
    study.forEach(function (d) {
      var tasks = [], tries = 0;
      while (tasks.length < per && tries < queues.length * 2) {
        var q = queues[turn % queues.length]; turn++; tries++;
        if (tasks.some(function (t) { return t.code === q.f.code; })) continue;
        var c = q.fresh.shift(), kind = 'new';
        if (!c) { c = q.rev.shift(); kind = 'revise'; }
        if (!c) continue;
        tasks.push({ code: q.f.code, subject: q.f.en, chapter: c.name, kind: kind });
      }
      days.push({ date: d, tasks: tasks });
    });
    var left = queues.reduce(function (n, q) { return n + q.fresh.length; }, 0);
    if (dates.length > 1) days.push({ date: dates[dates.length - 1], tasks: [], finalRevision: focuses.map(function (f) { var t = f.top[0]; return t ? { subject: f.en, topic: t.name, marks: t.marks + (t.choice ? '+' + t.choice : '') } : null; }).filter(Boolean) });
    return { tooLate: false, days: days, exam: focuses[0].exam, examDate: examDay, unplaced: left };
  };

  /* ------------------------------------------------------------- dates */
  SS.isoDate = function (d) { var z = new Date(d.getTime() - d.getTimezoneOffset() * 60000); return z.toISOString().slice(0, 10); };
  SS.parseISO = function (s) { var p = String(s).split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); };
  SS.addDays = function (iso, n) { var d = SS.parseISO(iso); d.setDate(d.getDate() + n); return SS.isoDate(d); };
  SS.fmtDate = function (iso, opts) {
    try { return SS.parseISO(iso).toLocaleDateString('en-IN', opts || { day: 'numeric', month: 'short', year: 'numeric' }); } catch (e) { return iso; }
  };
  SS.weekday = function (iso) { return SS.parseISO(iso).toLocaleDateString('en-IN', { weekday: 'short' }); };

  /* ------------------------------------------------- Academic Calendar (stored on this device) */
  var CAL_KEY = 'ss_calendar_v1';
  function defaultYear() {
    var now = new Date(), y = now.getMonth() >= 5 ? now.getFullYear() : now.getFullYear() - 1;
    return { start: y + '-06-12', end: (y + 1) + '-04-23', pattern: '6-day' };
  }
  SS.calendar = {
    get: function () {
      var c = null;
      try { c = JSON.parse(SS.ls(CAL_KEY) || 'null'); } catch (e) { c = null; }
      c = c || {};
      c.year = c.year || defaultYear();
      c.examPlan = c.examPlan || { fa: 4, sa: 2 };
      c.events = c.events || [];
      c.dayHours = SS.isNum(c.dayHours) ? c.dayHours : null;
      return c;
    },
    save: function (c) { SS.ls(CAL_KEY, JSON.stringify(c)); },
    isSet: function () { return !!SS.ls(CAL_KEY); },
    holidaySet: function (c) {
      var set = {};
      (c || SS.calendar.get()).events.forEach(function (e) {
        if (e.type !== 'holiday') return;
        var d = e.start; while (d <= (e.end || e.start)) { set[d] = e.label || 'Holiday'; d = SS.addDays(d, 1); }
      });
      return set;
    },
    isWorkingWeekday: function (iso, pattern) {
      var wd = SS.parseISO(iso).getDay(); /* 0 = Sunday */
      if (wd === 0) return false;
      if (pattern === '5-day' && wd === 6) return false;
      return true;
    },
    workingDates: function (from, to, cal) {
      var c = cal || SS.calendar.get(), hol = SS.calendar.holidaySet(c), out = [];
      if (!from || !to || from > to) return out;
      var d = from, guard = 0;
      while (d <= to && guard++ < 800) { if (SS.calendar.isWorkingWeekday(d, c.year.pattern) && !hol[d]) out.push(d); d = SS.addDays(d, 1); }
      return out;
    },
    capacity: function (cal) {
      var c = cal || SS.calendar.get(), y = c.year;
      var days = SS.calendar.workingDates(y.start, y.end, c).length;
      var total = Math.round((SS.parseISO(y.end) - SS.parseISO(y.start)) / 864e5) + 1;
      return { working: days, nonWorking: total - days, total: total, hours: c.dayHours ? Math.round(days * c.dayHours) : null };
    },
    holidayOn: function (iso) { var h = SS.calendar.holidaySet(); return h[iso] || null; },
    examDate: function (key) {
      var e = SS.calendar.get().events.filter(function (x) { return x.type === 'exam' && String(x.examKey).toUpperCase() === String(key).toUpperCase(); })
        .sort(function (a, b) { return a.start < b.start ? -1 : 1; })[0];
      return e ? { start: e.start, end: e.end || e.start, label: e.label } : null;
    },
    uid: function () { return 'e' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  };

  /* ------------------------------------------------------- Smart Science Lab */
  function normTitle(s) {
    return String(s || '').toLowerCase().replace(/[–—]/g, '-').replace(/&/g, ' and ').replace(/\bthe\b/g, ' ')
      .replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  }
  /* AP-textbook chapter titles that cover the same topic as an NCERT lab chapter under a different name.
     Hand-checked; anything not listed here only links on an exact title match. */
  var LAB_ALIAS = {
    'reflection of light by different surfaces': 9,
    'refraction of light at plane surfaces': 9,
    'refraction of light at curved surfaces': 9,
    'electric current': 11,
    'electromagnetism': 12
  };
  SS.labs = {
    catalog: null,
    /* Live catalogue through this site's own /labs proxy (vercel.json), else the bundled snapshot. */
    load: function () {
      if (SS.labs.catalog) return Promise.resolve(SS.labs.catalog);
      var snap = window.SS_DATA && window.SS_DATA.labs;
      var ctrl = window.AbortController ? new AbortController() : null;
      var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, 4000);
      return fetch('/labs/shared/catalog.physical-science-10.json', ctrl ? { signal: ctrl.signal } : {})
        .then(function (r) { if (!r.ok) throw 0; return r.json(); })
        .then(function (j) {
          SS.labs.catalog = { base: j.base_url, chapters: j.chapters.map(function (c) { return { no: c.chapter, title: c.title, group: c.topic_group, overview: c.overview_path, lab: c.lab.path, games: c.games.path, experiments: c.lab.experiments || [], gameList: c.games.list || [] }; }) };
          return SS.labs.catalog;
        })
        .catch(function () { SS.labs.catalog = snap; return snap; })
        .then(function (c) { clearTimeout(timer); return c; });
    },
    find: function (title) {
      var c = SS.labs.catalog; if (!c) return null;
      var n = normTitle(title), hit = null;
      c.chapters.forEach(function (ch) { if (normTitle(ch.title) === n) hit = ch; });
      if (!hit && LAB_ALIAS[n]) c.chapters.forEach(function (ch) { if (ch.no === LAB_ALIAS[n]) hit = ch; });
      if (!hit) return null;
      return { title: hit.title, overview: c.base + '/' + hit.overview, lab: c.base + '/' + hit.lab, games: c.base + '/' + hit.games, experiments: hit.experiments.length, gamesCount: hit.gameList.length };
    }
  };

  /* --------------------------------------------------------------- tiny charts (SVG) */
  SS.barList = function (items, opts) {
    /* items: [{label, value, max, color, note}] → horizontal bars, accessible text included */
    opts = opts || {};
    return '<div class="bars">' + items.map(function (it) {
      var pct = it.max ? Math.max(0, Math.min(100, it.value * 100 / it.max)) : 0;
      return '<div class="bar-row"><span class="bar-l">' + SS.esc(it.label) + '</span><span class="bar-t"><i style="width:' + pct.toFixed(1) + '%;background:' + (it.color || 'var(--a)') + '"></i>' +
        (SS.isNum(it.mark) ? '<b class="bar-m" style="left:' + Math.min(100, it.mark).toFixed(1) + '%" title="' + SS.esc(opts.markLabel || '') + '"></b>' : '') +
        '</span><span class="bar-v">' + SS.esc(it.note != null ? it.note : it.value) + '</span></div>';
    }).join('') + '</div>';
  };
  SS.lineChart = function (points, opts) {
    /* points: [{label, value|null}] values in %, draws a small trend line */
    opts = opts || {};
    var w = 520, h = 160, px = 34, py = 18, vals = points.filter(function (p) { return SS.isNum(p.value); });
    if (!vals.length) return '<p class="muted">No data yet.</p>';
    var n = points.length, step = n > 1 ? (w - px * 2) / (n - 1) : 0;
    var y = function (v) { return h - py - (v / 100) * (h - py * 2); };
    var path = '', dots = '', labels = '';
    points.forEach(function (p, i) {
      var x = px + step * i;
      labels += '<text x="' + x + '" y="' + (h - 2) + '" text-anchor="middle" class="ax">' + SS.esc(p.label) + '</text>';
      if (!SS.isNum(p.value)) return;
      path += (path ? 'L' : 'M') + x.toFixed(1) + ' ' + y(p.value).toFixed(1);
      dots += '<circle cx="' + x.toFixed(1) + '" cy="' + y(p.value).toFixed(1) + '" r="4.5"/><text x="' + x.toFixed(1) + '" y="' + (y(p.value) - 10).toFixed(1) + '" text-anchor="middle" class="vl">' + SS.esc(p.value + (opts.suffix || '%')) + '</text>';
    });
    var grid = [25, 50, 75, 100].map(function (g) { return '<line x1="' + px + '" x2="' + (w - px) + '" y1="' + y(g) + '" y2="' + y(g) + '" class="gl"/>'; }).join('');
    return '<svg class="line" viewBox="0 0 ' + w + ' ' + h + '" role="img" aria-label="' + SS.esc(opts.label || 'Trend') + '">' + grid + '<path d="' + path + '"/>' + dots + labels + '</svg>';
  };

  /* ---------------------------------------------------------------- PDF helper */
  /* html2canvas 1.4 cannot parse modern colour functions (color-mix → "color(srgb …)", oklch …).
     In the copy it renders, swap every such value for plain rgba so the PDF keeps the same colours. */
  var COLOR_PROPS = ['color', 'background-color', 'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color', 'outline-color', 'text-decoration-color', 'fill', 'stroke', 'box-shadow', 'background-image'];
  function toRgba(v) {
    return v.replace(/color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\)/g, function (_, r, g, b, a) {
      return 'rgba(' + Math.round(r * 255) + ',' + Math.round(g * 255) + ',' + Math.round(b * 255) + ',' + (a == null ? 1 : +a) + ')';
    }).replace(/oklch\([^)]*\)|oklab\([^)]*\)|lab\([^)]*\)|lch\([^)]*\)/g, 'rgba(0,0,0,0)');
  }
  function plainColours(doc) {
    var win = doc.defaultView || window;
    [].forEach.call(doc.querySelectorAll('*'), function (el) {
      var cs = win.getComputedStyle(el);
      COLOR_PROPS.forEach(function (p) {
        var v = cs.getPropertyValue(p);
        if (v && /color\(|oklch|oklab|\blab\(|\blch\(/.test(v)) el.style.setProperty(p, toRgba(v), 'important');
      });
    });
  }
  SS.savePdf = function (el, filename, landscape) {
    return SS.need('html2pdf').then(function () {
      document.body.classList.add('pdf-mode');
      if (!landscape) el.classList.add('pdf-page');   /* lay the card out at A4 width while it is captured */
      return window.html2pdf().set({
        margin: [8, 8, 8, 8], filename: filename,
        image: { type: 'jpeg', quality: 0.95 },
        html2canvas: { scale: 2, useCORS: true, scrollY: 0, backgroundColor: '#ffffff', onclone: plainColours },
        jsPDF: { unit: 'mm', format: 'a4', orientation: landscape ? 'landscape' : 'portrait' },
        pagebreak: { mode: ['css', 'legacy'], avoid: '.avoid-break' }
      }).from(el).save();
    }).then(function () { document.body.classList.remove('pdf-mode'); el.classList.remove('pdf-page'); },
      function (e) { document.body.classList.remove('pdf-mode'); el.classList.remove('pdf-page'); throw e; });
  };
})();
