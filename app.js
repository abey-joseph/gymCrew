/* Gym Crew: UI, routing, state. Plain JS, no dependencies. Plan data lives in data.js. */
'use strict';

/* ================= utilities ================= */

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ESC[c]);
const pad = (n) => String(n).padStart(2, '0');
const clamp = (n, a, b) => Math.min(b, Math.max(a, n));

const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseYmd = (s) => { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() + n); return x; };
const daysBetween = (a, b) => Math.round((new Date(b.getFullYear(), b.getMonth(), b.getDate()) - new Date(a.getFullYear(), a.getMonth(), a.getDate())) / 864e5);
/* Weeks run Sunday to Saturday. */
const weekStartOf = (d) => addDays(d, -d.getDay());
const now = () => new Date();
const todayStr = () => ymd(now());
const thisWeekStart = () => ymd(weekStartOf(now()));
const fmtDay = (s) => parseYmd(s).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
const fmtDayLong = (s) => parseYmd(s).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function toNum(v) {
  if (v === '' || v == null) return null;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}
function fmtKg(n) {
  if (n == null) return '–';
  return (Math.round(n * 100) / 100).toString();
}
function fmt1(n) { return n == null ? '–' : (Math.round(n * 10) / 10).toFixed(1); }
function signed(n, digits = 1) {
  if (n == null || Number.isNaN(n)) return '–';
  const r = Number(n.toFixed(digits));
  if (r === 0) return '±0';
  return (r > 0 ? '+' : '−') + Math.abs(r).toFixed(digits);
}
const thousands = (n) => Math.round(n).toLocaleString('en-GB');

/* ================= storage ================= */

const SCHEMA_VERSION = 2;
const KEY_PREFIX = 'gymcrew:v1:';
const KEY_LAST_USER = 'gymcrew:lastUser';
const timerKey = (uid) => `gymcrew:timer:${uid}`;

const Store = {
  ok: true,
  get(key) {
    try { return localStorage.getItem(key); } catch (e) { this.fail(e); return null; }
  },
  set(key, value) {
    try { localStorage.setItem(key, value); return true; } catch (e) { this.fail(e); return false; }
  },
  remove(key) {
    try { localStorage.removeItem(key); } catch (e) { this.fail(e); }
  },
  probe() {
    try {
      const k = 'gymcrew:probe';
      localStorage.setItem(k, '1');
      localStorage.removeItem(k);
      return true;
    } catch (e) { this.fail(e); return false; }
  },
  fail(e) {
    if (this.ok) console.warn('Storage unavailable', e);
    this.ok = false;
    const b = $('#banner');
    if (b) { b.textContent = "Can't save on this browser."; b.hidden = false; }
  },
};

function freshData(user) {
  return {
    schemaVersion: SCHEMA_VERSION,
    settings: { sessionLength: DEFAULT_SESSION_LENGTH, startDate: null, tipDismissed: false, persistAsked: false, sound: true },
    sessions: {},
    habits: {},
    scans: [Object.assign({ id: 'start' }, user.startScan)],
  };
}

/* Migrations: MIGRATIONS[n] turns schema n into schema n+1. Add one whenever the
 * stored shape changes, then bump SCHEMA_VERSION. Example for a renamed exercise id:
 *   1: (d) => { for (const s of Object.values(d.sessions)) if (s.sets['old-id']) { s.sets['new-id'] = s.sets['old-id']; delete s.sets['old-id']; } return d; },
 */
const MIGRATIONS = {
  /* 1 → 2: weeks moved from Monday–Sunday to Sunday–Saturday. Re-file each workout under the
   * Sunday week it was started in, and move a Monday plan start to the Sunday before it. */
  1: (d) => {
    const old = d.sessions || {};
    const sessions = {};
    const list = Object.values(old).filter((x) => x && typeof x === 'object')
      .sort((a, b) => (a.startedAt || 0) - (b.startedAt || 0));
    for (const x of list) {
      const when = x.startedAt > 86400000 ? new Date(x.startedAt) : x.weekStart ? parseYmd(x.weekStart) : null;
      if (when) x.weekStart = ymd(weekStartOf(when));
      let id = `${x.weekStart}_${x.workoutId}`;
      if (sessions[id]) { // same workout twice in one new week: keep both, the later one stays current
        const prev = sessions[id];
        delete sessions[id];
        prev.id = `${id}_${prev.startedAt || 'old'}`;
        sessions[prev.id] = prev;
      }
      x.id = id;
      sessions[id] = x;
    }
    d.sessions = sessions;
    const sd = d.settings && d.settings.startDate;
    if (sd && /^\d{4}-\d{2}-\d{2}$/.test(sd)) d.settings.startDate = ymd(weekStartOf(parseYmd(sd)));
    return d;
  },
};

function migrate(data, user) {
  let d = data && typeof data === 'object' ? data : {};
  if (!Number.isInteger(d.schemaVersion) || d.schemaVersion < 1) d.schemaVersion = 1;
  while (d.schemaVersion < SCHEMA_VERSION) {
    const step = MIGRATIONS[d.schemaVersion];
    if (step) d = step(d);
    d.schemaVersion += 1;
  }
  const base = freshData(user);
  d.settings = Object.assign({}, base.settings, d.settings || {});
  if (!SESSION_LENGTHS.includes(d.settings.sessionLength)) d.settings.sessionLength = DEFAULT_SESSION_LENGTH;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(d.settings.startDate))) d.settings.startDate = null;
  if (!d.sessions || typeof d.sessions !== 'object' || Array.isArray(d.sessions)) d.sessions = {};
  if (!d.habits || typeof d.habits !== 'object' || Array.isArray(d.habits)) d.habits = {};
  if (!Array.isArray(d.scans)) d.scans = base.scans;
  return d;
}

function loadUserData(user) {
  const raw = Store.get(KEY_PREFIX + user.id);
  if (!raw) return freshData(user);
  try {
    return migrate(JSON.parse(raw), user);
  } catch (e) {
    console.warn('Saved data could not be read; keeping a copy and starting fresh', e);
    Store.set(KEY_PREFIX + user.id + ':corrupt', raw);
    return freshData(user);
  }
}

function save() {
  if (!S.user) return;
  Store.set(KEY_PREFIX + S.user.id, JSON.stringify(S.data));
}

/* ================= state ================= */

const S = {
  user: null,
  data: null,
  habitsWeek: null, // Sunday (YYYY-MM-DD) shown on the Habits screen
  timer: null, // { endsAt, total, label, fired }
};

function findUser(name) {
  const n = String(name || '').trim().toLowerCase();
  if (!n) return null;
  return Object.values(USERS).find((u) => u.id === n || u.name.toLowerCase() === n) || null;
}

function login(user) {
  S.user = user;
  S.data = loadUserData(user);
  S.habitsWeek = null;
  Store.set(KEY_LAST_USER, user.id);
  if (!S.data.settings.persistAsked) {
    S.data.settings.persistAsked = true;
    try {
      if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    } catch (e) { /* ignore */ }
  }
  save();
  loadTimer();
}

function logout() {
  clearTimer(false);
  S.user = null;
  S.data = null;
  Store.remove(KEY_LAST_USER);
  location.hash = '#/login';
}

/* ================= plan logic ================= */

/* Each person starts their plan by tapping Start: week 1 then begins on next Sunday. */
const planStart = () => (S.data && S.data.settings.startDate) || null;
const nextSunday = (d = now()) => ymd(addDays(weekStartOf(d), 7));
/* Used for milestone dates and chart ranges before someone has tapped Start. */
const planStartOrNext = () => planStart() || nextSunday();

/* Plan week for a date: 1 = the start week; 0 or less = before the plan (or not started). */
function weekNumber(date = now()) {
  const start = planStart();
  if (!start) return 0;
  return Math.floor(daysBetween(parseYmd(start), weekStartOf(date)) / 7) + 1;
}
function weekNumberOfStart(weekStart) { return weekNumber(parseYmd(weekStart)); }

function startPlan() {
  S.data.settings.startDate = nextSunday();
  save();
  toast(`Locked in: week 1 starts <strong>${fmtDayLong(S.data.settings.startDate)}</strong>`, { ms: 4000 });
  route();
}
const isDeload = (weekNo) => DELOAD_WEEKS.includes(weekNo);

/* Exercises (with sets for this length / deload), finisher amount and time estimate. */
function prescribe(workoutId, length, deload) {
  const w = WORKOUTS[workoutId];
  const tiers = TIERS_FOR_LENGTH[length] || TIERS_FOR_LENGTH[DEFAULT_SESSION_LENGTH];
  const list = [];
  w.exercises.forEach((e, idx) => {
    if (!tiers.includes(e.tier)) return;
    let sets = e.sets + (length === 75 && idx < 2 ? 1 : 0);
    if (deload) sets = 2;
    list.push(Object.assign({ unit: 'reps', inc: 2.5, lift: e.id, perSide: false, assisted: false, superset: null }, e, { sets, order: idx }));
  });
  // A superset only counts when at least two of its exercises are shown.
  const counts = {};
  list.forEach((e) => { if (e.superset) counts[e.superset] = (counts[e.superset] || 0) + 1; });
  list.forEach((e) => { if (e.superset && counts[e.superset] < 2) e.superset = null; });

  // Blocks: single exercises, or superset groups (kept together, in order).
  const blocks = [];
  list.forEach((e) => {
    const prev = blocks[blocks.length - 1];
    if (e.superset && prev && prev.superset === e.superset) prev.items.push(e);
    else blocks.push({ superset: e.superset, items: [e] });
  });

  const finisher = Object.assign({}, w.finisher, { amount: w.finisher.amounts[length] });
  return { workout: w, length, deload, exercises: list, blocks, finisher, minutes: estimateMinutes(blocks, finisher) };
}

/* Rough time model: each set = 10 s + ~3 s per rep (×2 when per side), followed by its rest.
 * Plus 30 s to set up each exercise, the warm-up (7 min) and warm-up sets (1 min), and the finisher. */
function workSeconds(e) {
  const top = e.reps[1];
  const t = e.unit === 'secs' ? top + 10 : 10 + 3 * top;
  return e.perSide ? t * 2 : t;
}
function estimateMinutes(blocks, finisher) {
  let sec = WARMUP.minutes * 60 + 60;
  for (const b of blocks) {
    const rounds = Math.max(...b.items.map((e) => e.sets));
    const work = b.items.reduce((a, e) => a + workSeconds(e), 0);
    const rest = b.items[b.items.length - 1].rest;
    sec += rounds * (work + rest) + 30 * b.items.length;
  }
  sec += finisher.amount * 60; // 1 round of 30/30 = 1 min
  return Math.round(sec / 60);
}
const roundTo5 = (m) => Math.round(m / 5) * 5;

const sessionId = (weekStart, workoutId) => `${weekStart}_${workoutId}`;
function getSession(weekStart, workoutId) { return S.data.sessions[sessionId(weekStart, workoutId)] || null; }
function sessionState(s) { return !s ? 'todo' : s.status === 'done' ? 'done' : 'progress'; }

function weekSummary(weekStart) {
  const items = WORKOUT_ORDER.map((wid) => ({ wid, session: getSession(weekStart, wid) }));
  const done = items.filter((i) => sessionState(i.session) === 'done').length;
  const next = items.find((i) => sessionState(i.session) !== 'done') || null;
  return { items, done, next };
}

/* Most recent earlier session that logged ticked sets for this exercise. */
function lastPerformance(exId, excludeId) {
  let best = null;
  for (const s of Object.values(S.data.sessions)) {
    if (s.id === excludeId) continue;
    const sets = (s.sets && s.sets[exId]) || [];
    const done = sets.filter((x) => x && x.done);
    if (!done.length) continue;
    const when = s.finishedAt || s.updatedAt || s.startedAt || 0;
    if (!best || when > best.when) best = { when, sets, done, session: s };
  }
  return best;
}

function formatSets(ex, sets) {
  if (ex.unit === 'secs') return sets.map((s) => `${s.reps ?? '–'} s`).join(', ');
  // Group consecutive sets with the same kg: "40 kg × 10, 10 · 37.5 kg × 9"
  const groups = [];
  for (const s of sets) {
    const kg = toNum(s.kg);
    const g = groups[groups.length - 1];
    if (g && g.kg === kg) g.reps.push(s.reps ?? '–');
    else groups.push({ kg, reps: [s.reps ?? '–'] });
  }
  const per = ex.perSide ? ' each' : '';
  return groups.map((g) => `${g.kg == null ? 'BW' : fmtKg(g.kg) + ' kg'}${ex.assisted && g.kg != null ? ' assist' : ''} × ${g.reps.join(', ')}${per}`).join(' · ');
}

/* Rep-range progression rule. */
function progressionHint(ex, last) {
  if (!last) return { cls: 'same', text: 'First time: pick a weight that leaves 1–2 reps in reserve.' };
  const done = last.done;
  const allLogged = last.sets.filter(Boolean).every((x) => x.done);
  const allTop = done.length > 0 && allLogged && done.every((x) => (toNum(x.reps) || 0) >= ex.reps[1]);
  if (ex.unit === 'secs') {
    return allTop ? { cls: 'up', text: '↑ Hold 5 s longer per set.' } : { cls: 'same', text: 'Aim for +5 s on a set.' };
  }
  if (allTop) {
    return ex.assisted
      ? { cls: 'down', text: `↓ Lower assist by ${ex.inc} kg` }
      : { cls: 'up', text: `↑ Add weight: +${ex.inc} kg` };
  }
  return { cls: 'same', text: 'Aim for +1 rep on a set.' };
}

function sessionVolume(s) {
  let total = 0;
  for (const [exId, sets] of Object.entries(s.sets || {})) {
    const ex = findExercise(exId);
    if (!ex || ex.assisted || ex.unit === 'secs') continue; // assist kg and holds are not lifted load
    for (const x of sets) {
      if (!x || !x.done) continue;
      const kg = toNum(x.kg) || 0;
      const reps = toNum(x.reps) || 0;
      total += kg * reps * (ex.perSide ? 2 : 1);
    }
  }
  return Math.round(total);
}

function findExercise(exId) {
  for (const w of Object.values(WORKOUTS)) {
    const e = w.exercises.find((x) => x.id === exId);
    if (e) return Object.assign({ unit: 'reps', inc: 2.5, lift: e.id, perSide: false, assisted: false }, e);
  }
  return null;
}

/* ================= timer (timestamp based, survives screen lock) ================= */

let timerInterval = null;
let audioCtx = null;

function loadTimer() {
  S.timer = null;
  if (!S.user) return;
  try {
    const t = JSON.parse(Store.get(timerKey(S.user.id)) || 'null');
    if (t && typeof t.endsAt === 'number' && t.endsAt > Date.now() - 60000) S.timer = t;
  } catch (e) { /* ignore */ }
  updateTimer();
}
function persistTimer() {
  if (!S.user) return;
  if (S.timer) Store.set(timerKey(S.user.id), JSON.stringify(S.timer));
  else Store.remove(timerKey(S.user.id));
}
function startTimer(seconds, label) {
  if (!seconds) return;
  S.timer = { endsAt: Date.now() + seconds * 1000, total: seconds * 1000, label, fired: false };
  persistTimer();
  unlockAudio();
  updateTimer();
}
function clearTimer(persist = true) {
  S.timer = null;
  if (persist) persistTimer();
  updateTimer();
}
function timerRemaining() { return S.timer ? S.timer.endsAt - Date.now() : 0; }

function updateTimer() {
  const el = $('#timer');
  if (!el) return;
  const show = !!(S.timer && S.user && location.hash !== '#/login');
  el.hidden = !show;
  document.body.classList.toggle('has-timer', show);
  if (!show) { if (timerInterval) { clearInterval(timerInterval); timerInterval = null; } return; }
  if (!timerInterval) timerInterval = setInterval(updateTimer, 250);

  const left = timerRemaining();
  const over = left <= 0;
  el.classList.toggle('over', over);
  $('.timer-label', el).textContent = over ? 'Rest over: next set' : `Rest · ${S.timer.label}`;
  const secs = Math.max(0, Math.ceil(left / 1000));
  $('.timer-left', el).textContent = over ? 'Go!' : `${Math.floor(secs / 60)}:${pad(secs % 60)}`;
  $('.timer-fill', el).style.transform = `scaleX(${clamp(left / S.timer.total, 0, 1)})`;
  $('[data-action="timer-add"]', el).hidden = over;

  if (over && !S.timer.fired) {
    S.timer.fired = true;
    persistTimer();
    // Only buzz if the rest ended recently (not when reopening the app much later).
    if (left > -15000) alertRestOver();
  }
  if (over && left < -8000) clearTimer();
}

function unlockAudio() {
  if (!S.data || !S.data.settings.sound) return;
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    if (!audioCtx) audioCtx = new Ctx();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  } catch (e) { /* ignore */ }
}
function alertRestOver() {
  try { if (navigator.vibrate) navigator.vibrate([300, 120, 300]); } catch (e) { /* ignore */ }
  if (!S.data || !S.data.settings.sound || !audioCtx || document.hidden) return;
  try {
    const t0 = audioCtx.currentTime;
    [0, 0.25].forEach((off) => {
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.frequency.value = 880;
      g.gain.setValueAtTime(0.0001, t0 + off);
      g.gain.exponentialRampToValueAtTime(0.25, t0 + off + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + off + 0.18);
      o.connect(g).connect(audioCtx.destination);
      o.start(t0 + off);
      o.stop(t0 + off + 0.2);
    });
  } catch (e) { /* ignore */ }
}

/* ================= "how to" animations ================= */

const FIG = { torso: 44, sho: 41, neck: 12, head: 8.5, ua: 26, fa: 24, th: 34, sh: 32, foot: 10, shoW: 14, hipW: 8 };
const C = { body: '#f3f3f5', far: '#7d7d88', kit: '#3a3a45', kitLine: '#55555f', weight: '#f5a623', cable: '#c9c9d1' };
const dirv = (a) => { const r = (a * Math.PI) / 180; return [Math.sin(r), -Math.cos(r)]; };
const go = (p, len, a) => { const d = dirv(a); return [p[0] + d[0] * len, p[1] + d[1] * len]; };
const mirror = (a) => (a == null ? a : -a);

function howtoFor(ex) { return HOWTO[ex.id] || HOWTO[ex.lift] || null; }

function solvePose(view, q) {
  const J = {};
  if (view === 'side') {
    if (q.ax != null) {
      J.ankle = [q.ax, q.ay];
      J.knee = go(J.ankle, -FIG.sh, q.sh);
      J.hip = go(J.knee, -FIG.th, q.th);
    } else {
      J.hip = [q.hx, q.hy];
      J.knee = go(J.hip, FIG.th, q.th);
      J.ankle = go(J.knee, FIG.sh, q.sh);
    }
    J.toe = go(J.ankle, FIG.foot, q.ft == null ? 90 : q.ft);
    if (q.th2 != null) {
      J.knee2 = go(J.hip, FIG.th, q.th2);
      J.ankle2 = go(J.knee2, FIG.sh, q.sh2);
      J.toe2 = go(J.ankle2, FIG.foot, q.ft2 == null ? 90 : q.ft2);
    }
    J.neck = go(J.hip, FIG.torso, q.t);
    J.head = go(J.neck, FIG.neck, q.t);
    J.shoulder = go(J.hip, FIG.sho, q.t);
    J.elbow = go(J.shoulder, FIG.ua, q.ua);
    J.hand = go(J.elbow, FIG.fa, q.fa);
    return J;
  }
  let shR; let shL;
  if (view === 'top') {
    shR = [118, 96]; shL = [82, 96];
  } else {
    J.hip = [q.hx, q.hy];
    J.neck = [q.hx, q.hy - FIG.torso];
    J.head = [q.hx, q.hy - FIG.torso - FIG.neck - 1];
    shR = [q.hx + FIG.shoW, q.hy - FIG.sho]; shL = [q.hx - FIG.shoW, q.hy - FIG.sho];
    const ths = q.ths == null ? 1 : q.ths;
    J.hipR = [q.hx + FIG.hipW, q.hy]; J.hipL = [q.hx - FIG.hipW, q.hy];
    J.knee = go(J.hipR, FIG.th * ths, q.th); J.ankle = go(J.knee, FIG.sh, q.sh);
    J.kneeL = go(J.hipL, FIG.th * ths, mirror(q.th)); J.ankleL = go(J.kneeL, FIG.sh, mirror(q.sh));
  }
  J.shoulder = shR; J.shoulderL = shL;
  J.elbow = go(shR, FIG.ua, q.ua); J.hand = go(J.elbow, FIG.fa, q.fa);
  J.elbowL = go(shL, FIG.ua, mirror(q.ual == null ? q.ua : q.ual));
  J.handL = go(J.elbowL, FIG.fa, mirror(q.fal == null ? q.fa : q.fal));
  return J;
}

const f1 = (n) => n.toFixed(1);
const pts = (...ps) => ps.map((p) => `${f1(p[0])},${f1(p[1])}`).join(' ');
const limb = (ps, color, w = 7) => `<polyline points="${pts(...ps)}" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;

function drawProp(pr, J, view, q) {
  const hands = view === 'side' || pr.one ? [J.hand] : [J.hand, J.handL];
  switch (pr.t) {
    case 'rect': return `<rect x="${pr.p[0]}" y="${pr.p[1]}" width="${pr.p[2]}" height="${pr.p[3]}" rx="3" fill="${C.kit}" stroke="${C.kitLine}"/>`;
    case 'line': return `<line x1="${pr.p[0]}" y1="${pr.p[1]}" x2="${pr.p[2]}" y2="${pr.p[3]}" stroke="${C.kitLine}" stroke-width="${pr.w || 5}" stroke-linecap="round"/>`;
    case 'backpad': {
      const n = dirv(q.t - 90);
      const a = go(J.hip, 2, q.t); const b = go(J.hip, FIG.torso + 2, q.t);
      return `<line x1="${f1(a[0] + n[0] * 8)}" y1="${f1(a[1] + n[1] * 8)}" x2="${f1(b[0] + n[0] * 8)}" y2="${f1(b[1] + n[1] * 8)}" stroke="${C.kit}" stroke-width="9" stroke-linecap="round"/>`;
    }
    case 'pad': {
      const j = J[pr.at];
      return `<rect x="${f1(j[0] - 7 + (pr.dx || 0))}" y="${f1(j[1] - 7 + (pr.dy || 0))}" width="14" height="14" rx="4" fill="${C.kit}" stroke="${C.kitLine}"/>`;
    }
    case 'plate': {
      const j = J[pr.at]; const cx = j[0] + (pr.dx || 0); const cy = j[1] + (pr.dy || 0);
      return `<circle cx="${f1(cx)}" cy="${f1(cy)}" r="${pr.r || 16}" fill="rgba(245,166,35,0.12)" stroke="${C.weight}" stroke-width="2.5"/><circle cx="${f1(cx)}" cy="${f1(cy)}" r="3" fill="${C.weight}"/>`;
    }
    case 'db':
      return hands.map((h) => (view === 'side'
        ? `<circle cx="${f1(h[0])}" cy="${f1(h[1])}" r="6.5" fill="${C.weight}"/>`
        : `<line x1="${f1(h[0] - 9)}" y1="${f1(h[1])}" x2="${f1(h[0] + 9)}" y2="${f1(h[1])}" stroke="${C.weight}" stroke-width="3"/><rect x="${f1(h[0] - 12)}" y="${f1(h[1] - 5)}" width="6" height="10" rx="1.5" fill="${C.weight}"/><rect x="${f1(h[0] + 6)}" y="${f1(h[1] - 5)}" width="6" height="10" rx="1.5" fill="${C.weight}"/>`)).join('');
    case 'grip':
      return hands.map((h) => `<circle cx="${f1(h[0])}" cy="${f1(h[1])}" r="4" fill="${C.weight}"/>`).join('');
    case 'cable': {
      const h = J.hand;
      return `<circle cx="${pr.from[0]}" cy="${pr.from[1]}" r="4.5" fill="none" stroke="${C.kitLine}" stroke-width="2"/><line x1="${pr.from[0]}" y1="${pr.from[1]}" x2="${f1(h[0])}" y2="${f1(h[1])}" stroke="${C.cable}" stroke-width="1.4"/>`;
    }
    case 'bar2': {
      const y = (J.hand[1] + J.handL[1]) / 2;
      return `<line x1="${pr.from[0]}" y1="${pr.from[1]}" x2="${pr.from[0]}" y2="${f1(y)}" stroke="${C.cable}" stroke-width="1.4"/><line x1="${f1(J.handL[0] - 12)}" y1="${f1(y)}" x2="${f1(J.hand[0] + 12)}" y2="${f1(y)}" stroke="${C.weight}" stroke-width="4" stroke-linecap="round"/>`;
    }
    default: return '';
  }
}
const BEHIND = new Set(['rect', 'line', 'backpad', 'pad', 'plate']);

function drawFigure(view, J) {
  let s = '';
  if (view === 'side') {
    if (J.knee2) s += limb([J.hip, J.knee2, J.ankle2, J.toe2], C.far);
    s += limb([J.hip, J.neck], C.body, 9);
    s += limb([J.hip, J.knee, J.ankle, J.toe], C.body);
    s += `<circle cx="${f1(J.head[0])}" cy="${f1(J.head[1])}" r="${FIG.head}" fill="${C.body}"/>`;
    s += limb([J.shoulder, J.elbow, J.hand], C.body, 6.5);
    return s;
  }
  if (view === 'top') {
    s += limb([J.shoulderL, J.elbowL, J.handL], C.body, 6.5) + limb([J.shoulder, J.elbow, J.hand], C.body, 6.5);
    s += `<ellipse cx="100" cy="97" rx="23" ry="10" fill="${C.body}"/>`;
    s += `<circle cx="100" cy="95" r="10" fill="#cfcfd6" stroke="#0b0b0d" stroke-width="1.5"/>`;
    return s;
  }
  s += limb([J.hipL, J.kneeL, J.ankleL], C.body) + limb([J.hipR, J.knee, J.ankle], C.body);
  s += limb([J.hipL, J.hipR], C.body, 8) + limb([J.hip, J.neck], C.body, 10);
  s += limb([J.shoulderL, J.shoulder], C.body, 8);
  s += limb([J.shoulderL, J.elbowL, J.handL], C.body, 6.5) + limb([J.shoulder, J.elbow, J.hand], C.body, 6.5);
  s += `<circle cx="${f1(J.head[0])}" cy="${f1(J.head[1])}" r="${FIG.head + 1}" fill="${C.body}"/>`;
  return s;
}

const lerpPose = (a, b, p) => {
  const q = {};
  for (const k of Object.keys(a)) q[k] = b[k] == null ? a[k] : a[k] + (b[k] - a[k]) * p;
  return q;
};

/* Inner SVG for a movement at progress p (0 = start pose, 1 = end pose). */
function howtoFrame(h, p) {
  const q = lerpPose(h.a, Object.assign({}, h.a, h.b), p);
  const J = solvePose(h.view, q);
  const props = h.props || [];
  let s = h.view === 'top' ? '' : '<line x1="6" y1="151.5" x2="194" y2="151.5" stroke="#2c2c34" stroke-width="3"/>';
  for (const pr of props) if (BEHIND.has(pr.t) && pr.z !== 'front') s += drawProp(pr, J, h.view, q);
  s += drawFigure(h.view, J);
  for (const pr of props) if (!BEHIND.has(pr.t) || pr.z === 'front') s += drawProp(pr, J, h.view, q);
  return s;
}
function howtoSVG(h, p) {
  return `<svg viewBox="0 0 200 160" role="img" aria-hidden="true">${howtoFrame(h, p)}</svg>`;
}

const easeInOut = (x) => 0.5 - Math.cos(Math.PI * x) / 2;
const reduceMotion = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const HT = { h: null, raf: 0, t0: 0, pausedAt: null };

/* Where in the rep cycle we are, t in seconds. */
function howtoPhase(h, t) {
  const [ab, hb, ba, ha] = h.tempo;
  const total = ab + hb + ba + ha;
  let x = total ? t % total : 0;
  if (x < ab) return { p: easeInOut(x / ab), word: h.words[0] };
  x -= ab;
  if (x < hb) return { p: 1, word: h.words[0] === h.words[1] ? h.words[0] : 'Hold' };
  x -= hb;
  if (x < ba) return { p: 1 - easeInOut(x / ba), word: h.words[1] };
  return { p: 0, word: h.words[1] === h.words[0] ? h.words[0] : 'Ready' };
}

function howtoTick() {
  const sheet = $('#howto');
  if (!HT.h || sheet.hidden) return;
  const t = (HT.pausedAt != null ? HT.pausedAt : performance.now() - HT.t0) / 1000;
  const ph = howtoPhase(HT.h, t);
  $('#howto-fig').innerHTML = howtoFrame(HT.h, ph.p);
  $('#howto-word').textContent = ph.word;
  if (HT.pausedAt == null) HT.raf = requestAnimationFrame(howtoTick);
}

function openHowto(exId) {
  const ex = findExercise(exId);
  const h = ex && howtoFor(ex);
  if (!h) return;
  HT.h = h;
  HT.t0 = performance.now();
  HT.pausedAt = reduceMotion() ? 0 : null;
  $('#howto-title').textContent = ex.name;
  const [ab, hb, ba] = h.tempo;
  $('#howto-tempo').textContent = ex.unit === 'secs'
    ? `Hold ${ex.reps[0]}–${ex.reps[1]} s`
    : `${h.words[0]} ${ab} s${hb >= 0.5 ? ` · hold ${hb} s` : ''} · ${h.words[1].toLowerCase()} ${ba} s`;
  $('#howto-steps').innerHTML = h.steps.map((x) => `<li>${esc(x)}</li>`).join('')
    + (ex.cue ? `<li class="cue-step">${esc(ex.cue)}</li>` : '');
  $('#howto-view').textContent = h.view === 'top' ? 'Seen from above' : h.view === 'front' ? 'Seen from the front' : 'Seen from the side';
  $('[data-action="howto-toggle"]').textContent = HT.pausedAt != null ? '▶ Play' : '❚❚ Pause';
  $('#howto').hidden = false;
  cancelAnimationFrame(HT.raf);
  howtoTick();
}
function closeHowto() {
  cancelAnimationFrame(HT.raf);
  HT.h = null;
  $('#howto').hidden = true;
}
function toggleHowto() {
  if (!HT.h) return;
  if (HT.pausedAt == null) {
    HT.pausedAt = performance.now() - HT.t0;
    cancelAnimationFrame(HT.raf);
  } else {
    HT.t0 = performance.now() - HT.pausedAt;
    HT.pausedAt = null;
  }
  $('[data-action="howto-toggle"]').textContent = HT.pausedAt != null ? '▶ Play' : '❚❚ Pause';
  howtoTick();
}

/* ================= toast ================= */

let toastTimeout = null;
function toast(html, { action = null, ms = 3200 } = {}) {
  const el = $('#toast');
  el.innerHTML = html;
  el.classList.toggle('action', !!action);
  el.onclick = action;
  el.hidden = false;
  clearTimeout(toastTimeout);
  if (ms) toastTimeout = setTimeout(() => { el.hidden = true; }, ms);
}

/* ================= rendering helpers ================= */

const app = () => $('#app');

function setChrome(tab) {
  const tabs = $('#tabs');
  tabs.hidden = !tab;
  app().classList.toggle('no-tabs', !tab);
  $$('#tabs a').forEach((a) => a.classList.toggle('active', a.dataset.tab === tab));
  updateTimer();
}

const ICON_NO_IMAGE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 15h18v3H3zm2-5h3v4H5zm11 0h3v4h-3zM9 11h6v3H9z"/></svg>';

function thumb(image, name) {
  if (!image) return `<div class="thumb icon" aria-hidden="true">${ICON_NO_IMAGE}</div>`;
  const src = IMAGE_DIR + image;
  return `<button type="button" class="thumb" data-action="view-photo" data-src="${esc(src)}" aria-label="Show photo: ${esc(IMAGES[image] || name)}">
    <img src="${esc(src)}" alt="${esc(IMAGES[image] || name)}" loading="lazy" decoding="async" width="84" height="84"></button>`;
}

function deloadBanner(weekNo) {
  if (!isDeload(weekNo)) return '';
  return `<div class="deload" role="note"><span>⚡</span><span>Deload week: every exercise is 2 sets. Keep the same weights and leave the gym fresh.</span></div>`;
}

function weeklyCounts(weekStart) {
  const start = parseYmd(weekStart);
  const counts = { gym: weekSummary(weekStart).done, steps: 0, protein: 0, calories: 0, sleep: 0 };
  for (let i = 0; i < 7; i++) {
    const h = S.data.habits[ymd(addDays(start, i))];
    if (!h) continue;
    for (const k of ['steps', 'protein', 'calories', 'sleep']) if (h[k]) counts[k] += 1;
  }
  return counts;
}

const HABITS = [
  { key: 'steps', label: 'Steps', target: (t) => `${thousands(t.steps)} steps` },
  { key: 'protein', label: 'Protein', target: (t) => `${t.protein} g` },
  { key: 'calories', label: 'Calories', target: (t) => `${thousands(t.calories)} kcal` },
  { key: 'sleep', label: 'Sleep', target: (t) => `${t.sleep} h` },
];
const WEEKLY_ROWS = [
  { key: 'gym', label: 'Gym' },
  { key: 'steps', label: 'Steps' },
  { key: 'protein', label: 'Protein' },
  { key: 'calories', label: 'Calories' },
  { key: 'sleep', label: 'Sleep' },
];

function weeklyBars(weekStart) {
  const c = weeklyCounts(weekStart);
  return `<div class="bars">${WEEKLY_ROWS.map((r) => {
    const target = WEEKLY_TARGETS[r.key];
    const met = c[r.key] >= target;
    return `<div class="bar-row${met ? ' met' : ''}"><span>${r.label}</span>
      <div class="bar" role="img" aria-label="${r.label} ${c[r.key]} of ${target}"><i style="width:${clamp((c[r.key] / target) * 100, 0, 100)}%"></i></div>
      <b>${c[r.key]}/${target}${met ? ' ✓' : ''}</b></div>`;
  }).join('')}</div>`;
}

/* ================= screens ================= */

function renderLogin(error = '') {
  setChrome(null);
  app().innerHTML = `
  <section class="login">
    <img class="logo" src="./icons/icon-192.png" alt="" width="72" height="72">
    <h1>Gym Crew</h1>
    <p class="muted">Workouts and habits for the crew.</p>
    <form id="login-form" autocomplete="off" novalidate>
      <label class="field"><span>What's your name?</span>
        <input id="login-name" type="text" name="name" autocapitalize="words" autocorrect="off" spellcheck="false" enterkeyhint="go" required>
      </label>
      <button class="btn block" type="submit">Let's go</button>
      <p class="error" id="login-error" role="alert"${error ? '' : ' hidden'}>${esc(error)}</p>
    </form>
  </section>`;
  $('#login-form').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const user = findUser($('#login-name').value);
    if (!user) {
      const err = $('#login-error');
      err.textContent = 'Name not found. This app is for Abey, Sudheep and Ashik.';
      err.hidden = false;
      return;
    }
    login(user);
    location.hash = '#/today';
  });
}

function renderToday() {
  setChrome('today');
  const u = S.user;
  const wk = weekNumber();
  const weekStart = thisWeekStart();
  const len = S.data.settings.sessionLength;
  const summary = weekSummary(weekStart);
  const today = todayStr();
  const h = S.data.habits[today] || {};

  const start = planStart();
  const headLine = wk >= 1 ? `Week ${wk} of plan` : start ? `Plan starts ${fmtDayLong(start)}` : 'Plan not started';

  let startCard = '';
  if (!start) {
    startCard = `<div class="card hero">
      <div class="eyebrow">Your ${PLAN_WEEKS}-week plan</div>
      <div class="big">Ready to start?</div>
      <p class="muted" style="margin-top:6px">Tap Start and week 1 begins on <strong>${fmtDayLong(nextSunday())}</strong>. Until then you can try the workouts and log habits.</p>
      <button type="button" class="btn block" data-action="start-plan">Start my plan</button>
    </div>`;
  } else if (wk < 1) {
    const days = daysBetween(now(), parseYmd(start));
    startCard = `<div class="card hero">
      <div class="eyebrow">Plan locked in</div>
      <div class="big">Week 1 starts ${fmtDayLong(start)}</div>
      <p class="muted" style="margin-top:6px">${days === 1 ? 'Tomorrow' : `In ${days} days`}. Workouts before then count as practice.</p>
    </div>`;
  }

  let nextCard;
  if (summary.next) {
    const p = prescribe(summary.next.wid, len, isDeload(wk));
    const state = sessionState(summary.next.session);
    nextCard = `<div class="card${startCard ? '' : ' hero'}">
      <div class="eyebrow">${wk >= 1 ? 'Next workout' : 'Practice workout'} · ${WORKOUT_ORDER.indexOf(summary.next.wid) + 1} of 4</div>
      <div class="card-head"><div><div class="big">${esc(p.workout.name)}</div>
        <div class="muted">≈ ${roundTo5(p.minutes)} min · ${p.exercises.length} exercises${p.deload ? ' · deload' : ''}</div></div></div>
      <div class="spacer"></div>
      <a class="btn block" href="#/workout/${summary.next.wid}">${state === 'progress' ? 'Continue' : 'Start'} ${esc(p.workout.name)}</a>
    </div>`;
  } else {
    nextCard = `<div class="card hero"><div class="eyebrow">This week</div><div class="big">4/4 done ✓</div>
      <p class="muted">Every session is in the bag. Rest up; the next round starts Sunday.</p></div>`;
  }

  const tip = S.data.settings.tipDismissed ? '' : `<div class="card tip">
    <div class="card-head"><h3>Keep your data safe</h3><button class="btn small ghost" data-action="dismiss-tip">Got it</button></div>
    <p>On iPhone, use Share → Add to Home Screen. Safari can clear data for websites you haven't opened in 7 days; the home-screen app keeps it. Export a backup monthly.</p>
  </div>`;

  app().innerHTML = `
    <h1>Hi ${esc(u.name)}</h1>
    <p class="sub">${headLine} · ${fmtDayLong(today)}</p>
    ${deloadBanner(wk)}
    ${startCard}
    ${tip}
    ${nextCard}
    <h2>Today's habits</h2>
    <div class="toggles">${HABITS.map((x) => `<button type="button" class="toggle" data-action="habit" data-date="${today}" data-key="${x.key}" aria-pressed="${!!h[x.key]}">
      <strong>${x.key === 'steps' ? 'Steps target hit' : x.key === 'protein' ? 'Protein hit' : x.key === 'calories' ? 'Calories on target' : 'Slept 7 h'}</strong>
      <span>${x.label} ${x.target(u.targets)}</span></button>`).join('')}</div>
    <h2>This week</h2>
    <div class="card">${weeklyBars(weekStart)}</div>
  `;
}

function renderPlan() {
  setChrome('plan');
  const u = S.user;
  const weekStart = thisWeekStart();
  const wk = weekNumber();
  const summary = weekSummary(weekStart);
  const len = S.data.settings.sessionLength;

  const items = summary.items.map((it, i) => {
    const st = sessionState(it.session);
    const p = prescribe(it.wid, len, isDeload(wk));
    const isNext = summary.next && summary.next.wid === it.wid;
    const label = st === 'done' ? `Done ${fmtDayLong(ymd(new Date(it.session.finishedAt)))}` : st === 'progress' ? 'In progress' : 'Not started';
    const meta = st === 'done'
      ? `${it.session.durationMin} min · ${thousands(it.session.volume)} kg volume`
      : `≈ ${roundTo5(p.minutes)} min · ${p.exercises.length} exercises`;
    return `<a class="session-item ${st}${isNext ? ' next' : ''}" href="#/workout/${it.wid}">
      <span class="idx">${st === 'done' ? '✓' : i + 1}</span>
      <div class="meta"><div><strong>${esc(p.workout.name)}</strong></div><div>${meta}</div></div>
      <span class="status">${label}</span></a>`;
  }).join('');

  // Past weeks: from the plan start (or the earliest logged session) up to last week.
  const starts = Object.values(S.data.sessions).map((s) => s.weekStart).filter(Boolean);
  let first = planStart() || weekStart;
  for (const s of starts) if (s < first) first = s;
  const past = [];
  for (let d = addDays(parseYmd(weekStart), -7); ymd(d) >= first; d = addDays(d, -7)) {
    const ws = ymd(d);
    const sm = weekSummary(ws);
    const n = weekNumberOfStart(ws);
    past.push(`<div class="week-row"><span>${n >= 1 ? `Week ${n}` : 'Before plan'} · <span class="muted">${fmtDay(ws)}</span>${isDeload(n) ? ' <span class="tag">Deload</span>' : ''}</span>
      <span class="dots">${sm.items.map((x) => `<i class="${sessionState(x.session) === 'done' ? 'on' : ''}"></i>`).join('')}</span>
      <b class="num">${sm.done}/4</b></div>`);
    if (past.length >= 30) break;
  }

  app().innerHTML = `
    <h1>Plan</h1>
    <p class="sub">${wk >= 1 ? `Week ${wk} of ${PLAN_WEEKS}` : planStart() ? `Starts ${fmtDayLong(planStart())}` : 'Not started yet (tap Start on Today)'} · ${summary.done}/4 sessions · ${len}-min sessions</p>
    ${deloadBanner(wk)}
    <div class="session-list">${items}</div>
    <p class="muted small" style="margin-top:10px">Do them in order, on any days that suit your shifts. The week runs Sunday to Saturday.</p>
    <h2>Past weeks</h2>
    ${past.length ? `<div class="weeks">${past.join('')}</div>` : '<p class="muted">No past weeks yet.</p>'}
  `;
}

/* ---------- workout ---------- */

let W = null; // current workout view: { wid, weekStart, sid, p }

function currentSession(create) {
  let s = S.data.sessions[W.sid];
  if (!s && create) {
    const t = Date.now();
    s = S.data.sessions[W.sid] = {
      id: W.sid, workoutId: W.wid, weekStart: W.weekStart, weekNo: weekNumberOfStart(W.weekStart),
      status: 'in_progress', startedAt: t, updatedAt: t, warmup: false, finisher: false, sets: {},
    };
  }
  return s;
}

function prefillFor(ex, i, last) {
  if (!last) return { kg: '', reps: ex.unit === 'secs' ? String(ex.reps[0]) : String(ex.reps[0]) };
  const src = last.sets[i] || last.sets[last.sets.length - 1] || {};
  return { kg: src.kg ?? '', reps: src.reps ?? String(ex.reps[0]) };
}

function renderWorkout(wid) {
  if (!WORKOUTS[wid]) { location.hash = '#/plan'; return; }
  setChrome('plan');
  const weekStart = thisWeekStart();
  const sid = sessionId(weekStart, wid);
  const existing = S.data.sessions[sid];
  const wk = weekNumberOfStart(weekStart);
  const len = existing && existing.status === 'done' && existing.sessionLength ? existing.sessionLength : S.data.settings.sessionLength;
  const p = prescribe(wid, len, isDeload(wk));
  W = { wid, weekStart, sid, p };
  const s = existing || {};
  const w = p.workout;

  const exCard = (ex) => {
    const last = lastPerformance(ex.id, sid);
    const hint = progressionHint(ex, last);
    const stored = (s.sets && s.sets[ex.id]) || [];
    const isTime = ex.unit === 'secs';
    const repsLabel = isTime ? `${ex.reps[0]}–${ex.reps[1]} s` : ex.reps[0] === ex.reps[1] ? `${ex.reps[0]}` : `${ex.reps[0]}–${ex.reps[1]}`;
    const rows = [];
    for (let i = 0; i < ex.sets; i++) {
      const v = stored[i] || prefillFor(ex, i, last);
      const done = !!(stored[i] && stored[i].done);
      rows.push(`<div class="set-row${isTime ? ' no-kg' : ''}${done ? ' done' : ''}" data-ex="${ex.id}" data-i="${i}">
        <span class="set-no">${i + 1}</span>
        ${isTime ? '' : `<input class="in-kg" type="text" inputmode="decimal" enterkeyhint="next" aria-label="Set ${i + 1} ${ex.assisted ? 'assist ' : ''}kg" placeholder="${ex.assisted ? 'assist' : 'kg'}" value="${esc(v.kg)}">`}
        <input class="in-reps" type="text" inputmode="numeric" enterkeyhint="done" aria-label="Set ${i + 1} ${isTime ? 'seconds' : 'reps'}" placeholder="${isTime ? 'sec' : 'reps'}" value="${esc(v.reps)}">
        <button type="button" class="tick" role="checkbox" aria-checked="${done}" aria-label="Set ${i + 1} done" data-action="tick">✓</button>
      </div>`);
    }
    return `<article class="card ex" id="ex-${ex.id}" data-ex-card="${ex.id}">
      <div class="ex-top">${thumb(ex.image, ex.name)}
        <div class="ex-info"><h3>${esc(ex.name)} <span class="check">✓</span></h3>
          <div class="presc">${ex.sets} × ${repsLabel}${ex.perSide ? ' each side' : ''} <span class="muted">· rest ${ex.rest ? ex.rest + ' s' : 'none, go straight to the next'}</span></div>
          ${ex.cue ? `<p class="cue">${esc(ex.cue)}</p>` : ''}
          ${howtoFor(ex) ? `<button type="button" class="howto-btn" data-action="howto" data-ex="${ex.id}" aria-label="How to do ${esc(ex.name)}"><span aria-hidden="true">▶</span> How to</button>` : ''}
        </div></div>
      <div class="last">${last ? `Last time: ${esc(formatSets(ex, last.done))}` : 'No history yet.'}<span class="hint ${hint.cls}">${esc(hint.text)}</span></div>
      <div class="sets">
        <div class="sets-head${isTime ? ' no-kg' : ''}"><span>Set</span>${isTime ? '' : `<span>${ex.assisted ? 'Assist kg' : 'kg'}</span>`}<span>${isTime ? 'Seconds' : 'Reps'}</span><span>Done</span></div>
        ${rows.join('')}
      </div>
    </article>`;
  };

  const blocks = p.blocks.map((b) => b.superset
    ? `<section class="superset" aria-label="Superset"><div class="superset-label">Superset: alternate, rest after the last one</div>${b.items.map(exCard).join('')}</section>`
    : exCard(b.items[0])).join('');

  const first = p.exercises[0];
  const firstLast = first ? lastPerformance(first.id, sid) : null;
  const firstKg = firstLast ? Math.max(...firstLast.done.map((x) => toNum(x.kg) || 0)) : 0;
  const wuSets = firstKg > 0
    ? `2 warm-up sets on ${esc(first.name.toLowerCase())}: ${fmtKg(Math.round(firstKg * 0.5 / 2.5) * 2.5)} kg × 10, then ${fmtKg(Math.round(firstKg * 0.75 / 2.5) * 2.5)} kg × 5.`
    : `2 light warm-up sets on ${esc(first ? first.name.toLowerCase() : 'the first exercise')}: ${esc(WARMUP.sets)}.`;

  const fin = p.finisher;
  const finText = fin.unit === 'rounds' ? `${fin.amount} rounds (${fin.amount} min)` : `${fin.amount} min`;
  const statusLine = s.status === 'done'
    ? `Finished ${fmtDayLong(ymd(new Date(s.finishedAt)))} · ${s.durationMin} min · ${thousands(s.volume)} kg`
    : `≈ ${roundTo5(p.minutes)} min · ${len}-min plan${p.deload ? ' · deload' : ''}`;

  app().innerHTML = `
    <div class="wo-head">
      <div class="row"><a class="back" href="#/plan">‹ Plan</a><span class="muted small">Week ${wk >= 1 ? wk : '0'} · ${WORKOUT_ORDER.indexOf(wid) + 1} of 4</span></div>
      <h1>${esc(w.name)}</h1>
      <div class="muted small num" id="wo-status">${statusLine}</div>
      <div class="progress-line"><i id="wo-progress"></i></div>
    </div>
    <div class="spacer"></div>
    ${deloadBanner(wk)}
    <article class="card check-card${s.warmup ? ' is-done' : ''}" data-check="warmup">
      ${thumb(WARMUP.image, 'Warm-up')}
      <div class="ex-info"><h3>Warm-up · ~${WARMUP.minutes} min</h3>
        <ul><li>${esc(WARMUP.base)}</li><li>${esc(WARMUP[w.type])}</li><li>${wuSets}</li></ul></div>
      <button type="button" class="tick" role="checkbox" aria-checked="${!!s.warmup}" aria-label="Warm-up done" data-action="check" data-key="warmup">✓</button>
    </article>
    ${blocks}
    <article class="card check-card${s.finisher ? ' is-done' : ''}" data-check="finisher">
      ${thumb(fin.image, fin.name)}
      <div class="ex-info"><h3>Finisher</h3>
        <div class="presc">${esc(fin.name)} · ${finText}</div>
        <button type="button" class="btn small ghost" data-action="finisher-timer" data-min="${fin.amount}" style="margin-top:6px">Start ${fin.amount}:00 timer</button></div>
      <button type="button" class="tick" role="checkbox" aria-checked="${!!s.finisher}" aria-label="Finisher done" data-action="check" data-key="finisher">✓</button>
    </article>
    <div class="finish" id="finish"></div>
  `;
  updateWorkoutChrome();
}

function workoutProgress() {
  const s = S.data.sessions[W.sid] || {};
  let total = 2; let done = (s.warmup ? 1 : 0) + (s.finisher ? 1 : 0);
  for (const ex of W.p.exercises) {
    total += ex.sets;
    const sets = (s.sets && s.sets[ex.id]) || [];
    for (let i = 0; i < ex.sets; i++) if (sets[i] && sets[i].done) done += 1;
  }
  return { total, done };
}

function updateWorkoutChrome() {
  const s = S.data.sessions[W.sid];
  const { total, done } = workoutProgress();
  const bar = $('#wo-progress');
  if (bar) bar.style.width = `${(done / total) * 100}%`;
  for (const ex of W.p.exercises) {
    const sets = (s && s.sets && s.sets[ex.id]) || [];
    let all = true;
    for (let i = 0; i < ex.sets; i++) if (!(sets[i] && sets[i].done)) all = false;
    const card = $(`[data-ex-card="${ex.id}"]`);
    if (card) card.classList.toggle('is-done', all);
  }
  const fin = $('#finish');
  if (!fin) return;
  if (s && s.status === 'done') {
    fin.innerHTML = `<div class="card"><strong class="good">✓ Workout saved.</strong> <span class="muted">Changes you make here still save.</span></div>`;
  } else if (done === total) {
    fin.innerHTML = `<button type="button" class="btn block" data-action="finish">Finish workout</button>`;
  } else {
    fin.innerHTML = `<p class="muted small" style="text-align:center">${total - done} left to tick. <button type="button" class="btn link" data-action="finish-early">Finish early</button></p>`;
  }
}

function onSetInput(row) {
  const exId = row.dataset.ex;
  const i = Number(row.dataset.i);
  const s = currentSession(true);
  const arr = s.sets[exId] || (s.sets[exId] = []);
  const kgIn = $('.in-kg', row);
  const cur = arr[i] || {};
  arr[i] = { kg: kgIn ? kgIn.value.trim() : '', reps: $('.in-reps', row).value.trim(), done: !!cur.done };
  for (let j = 0; j < i; j++) if (!arr[j]) arr[j] = null;
  s.updatedAt = Date.now();
  save();
}

function onTick(btn) {
  const row = btn.closest('.set-row');
  onSetInput(row); // capture current values (including prefilled ones)
  const s = currentSession(true);
  const exId = row.dataset.ex;
  const i = Number(row.dataset.i);
  const entry = s.sets[exId][i];
  entry.done = !entry.done;
  s.updatedAt = Date.now();
  save();
  btn.setAttribute('aria-checked', String(entry.done));
  row.classList.toggle('done', entry.done);
  if (entry.done) {
    const ex = W.p.exercises.find((e) => e.id === exId);
    const block = W.p.blocks.find((b) => b.items.includes(ex));
    const isLastInBlock = block.items[block.items.length - 1] === ex;
    if (isLastInBlock && ex.rest > 0) startTimer(ex.rest, block.superset ? `${block.items.map((x) => x.name).join(' + ')}` : ex.name);
    else if (!isLastInBlock) {
      const nextEx = block.items[block.items.indexOf(ex) + 1];
      toast(`Superset: go straight to <strong>${esc(nextEx.name)}</strong>`, { ms: 2000 });
    }
  }
  updateWorkoutChrome();
}

function onCheck(btn) {
  const key = btn.dataset.key;
  const s = currentSession(true);
  s[key] = !s[key];
  s.updatedAt = Date.now();
  save();
  btn.setAttribute('aria-checked', String(s[key]));
  btn.closest('.check-card').classList.toggle('is-done', s[key]);
  updateWorkoutChrome();
}

function finishWorkout() {
  const s = currentSession(true);
  const t = Date.now();
  s.status = 'done';
  s.finishedAt = t;
  s.updatedAt = t;
  s.durationMin = Math.max(1, Math.round((t - s.startedAt) / 60000));
  s.volume = sessionVolume(s);
  s.sessionLength = W.p.length;
  s.deload = W.p.deload;
  save();
  clearTimer();
  const name = W.p.workout.name;
  location.hash = '#/today';
  toast(`<strong>${esc(name)} saved</strong> · ${s.durationMin} min · ${thousands(s.volume)} kg`, { ms: 4000 });
}

/* ---------- habits ---------- */

function renderHabits() {
  setChrome('habits');
  const u = S.user;
  const current = thisWeekStart();
  const weekStart = S.habitsWeek || current;
  const start = parseYmd(weekStart);
  const today = todayStr();
  const wk = weekNumberOfStart(weekStart);
  const counts = weeklyCounts(weekStart);

  // Gym days: finished sessions by their finish date (within this week).
  const gymDays = {};
  for (const s of Object.values(S.data.sessions)) {
    if (s.status === 'done' && s.finishedAt) gymDays[ymd(new Date(s.finishedAt))] = true;
  }

  const days = Array.from({ length: 7 }, (_, i) => ymd(addDays(start, i)));
  let html = `<div class="hgrid" role="grid" aria-label="Habits for the week"><div></div>`;
  html += days.map((d, i) => `<div class="h${d === today ? ' today' : ''}">${DOW[i]}<b>${parseYmd(d).getDate()}</b></div>`).join('');
  const rows = [...HABITS.map((h) => ({ key: h.key, label: h.label })), { key: 'gym', label: 'Gym' }];
  for (const r of rows) {
    const target = WEEKLY_TARGETS[r.key];
    const met = counts[r.key] >= target;
    html += `<div class="lbl${met ? ' met' : ''}">${r.label}<small>${counts[r.key]}/${target}${met ? ' ✓' : ''}</small></div>`;
    html += days.map((d) => {
      const future = d > today;
      const cls = `cell${d === today ? ' today' : ''}${future ? ' future' : ''}`;
      if (r.key === 'gym') {
        return `<div class="${cls} auto" aria-pressed="${!!gymDays[d]}" aria-label="Gym ${d}${gymDays[d] ? ' done' : ''}">✓</div>`;
      }
      const on = !!(S.data.habits[d] && S.data.habits[d][r.key]);
      return `<button type="button" class="${cls}" data-action="habit" data-date="${d}" data-key="${r.key}" aria-pressed="${on}" aria-label="${r.label} ${d}"${future ? ' disabled' : ''}>✓</button>`;
    }).join('');
  }
  html += '</div>';

  const met = WEEKLY_ROWS.filter((r) => counts[r.key] >= WEEKLY_TARGETS[r.key]).length;
  app().innerHTML = `
    <h1>Habits</h1>
    <p class="sub">Tap a cell to toggle. Gym fills in from finished workouts.</p>
    <div class="week-nav">
      <button type="button" class="icon-btn" data-action="week-prev" aria-label="Previous week">‹</button>
      <div class="label"><div>${wk >= 1 ? `Week ${wk}` : 'Before plan'}${weekStart === current ? ' · this week' : ''}</div><div>${fmtDay(weekStart)} – ${fmtDay(ymd(addDays(start, 6)))}</div></div>
      <button type="button" class="icon-btn" data-action="week-next" aria-label="Next week"${weekStart >= current ? ' disabled' : ''}>›</button>
    </div>
    <div class="card">${html}</div>
    <div class="card"><div class="card-head"><h3>Weekly targets</h3><span class="${met === WEEKLY_ROWS.length ? 'good' : 'muted'} small">${met}/${WEEKLY_ROWS.length} met</span></div>
      <div class="spacer"></div>${weeklyBars(weekStart)}</div>
    <p class="muted small">Daily targets: ${HABITS.map((h) => `${h.label} ${h.target(u.targets)}`).join(' · ')}.</p>
  `;
}

function toggleHabit(btn) {
  const d = btn.dataset.date;
  const k = btn.dataset.key;
  const h = S.data.habits[d] || (S.data.habits[d] = {});
  h[k] = !h[k];
  if (!Object.values(h).some(Boolean)) delete S.data.habits[d];
  save();
  route();
}

/* ---------- progress ---------- */

function sortedScans() { return S.data.scans.slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)); }

function milestoneList(u) {
  const start = parseYmd(planStartOrNext());
  return u.milestones.values.map((v, i) => {
    const week = (i + 1) * MILESTONE_EVERY_WEEKS;
    return { week, date: ymd(addDays(start, week * 7 - 1)), target: v };
  });
}

function scanNear(dateStr, scans, windowDays = 10) {
  const d = parseYmd(dateStr);
  let best = null;
  for (const s of scans) {
    const diff = Math.abs(daysBetween(d, parseYmd(s.date)));
    if (diff <= windowDays && (!best || diff < best.diff)) best = { diff, scan: s };
  }
  return best && best.scan;
}

/* Inline SVG line chart. series: [{date, value}]. */
function lineChart({ title, unit, series, goalLine = null, refLines = [], band = null, xFrom, xTo, digits = 1 }) {
  const W0 = 340; const H0 = 170;
  const m = { l: 38, r: 10, t: 14, b: 24 };
  const iw = W0 - m.l - m.r; const ih = H0 - m.t - m.b;
  const x0 = parseYmd(xFrom).getTime(); const x1 = Math.max(parseYmd(xTo).getTime(), x0 + 864e5);
  const vals = series.map((p) => p.value);
  if (goalLine) goalLine.forEach((p) => vals.push(p.value));
  refLines.forEach((r) => vals.push(r.value));
  if (band) vals.push(band[0], band[1]);
  let lo = Math.min(...vals); let hi = Math.max(...vals);
  const padY = Math.max((hi - lo) * 0.12, 0.5);
  lo -= padY; hi += padY;
  const X = (ds) => m.l + ((parseYmd(ds).getTime() - x0) / (x1 - x0)) * iw;
  const Y = (v) => m.t + (1 - (v - lo) / (hi - lo)) * ih;
  const ticks = [];
  const step = niceStep((hi - lo) / 4);
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) ticks.push(v);

  let svg = `<svg viewBox="0 0 ${W0} ${H0}" role="img" aria-label="${esc(title)} chart">`;
  ticks.forEach((v) => {
    svg += `<line x1="${m.l}" x2="${W0 - m.r}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}" stroke="#2c2c34" stroke-width="1"/>`;
    svg += `<text x="${m.l - 6}" y="${(Y(v) + 4).toFixed(1)}" fill="#9b9ba6" font-size="11" text-anchor="end">${+v.toFixed(2)}</text>`;
  });
  if (band) {
    svg += `<rect x="${m.l}" width="${iw}" y="${Y(band[1]).toFixed(1)}" height="${(Y(band[0]) - Y(band[1])).toFixed(1)}" fill="rgba(62,207,142,0.14)" stroke="rgba(62,207,142,0.5)" stroke-dasharray="4 4"/>`;
  }
  refLines.forEach((r) => {
    svg += `<line x1="${m.l}" x2="${W0 - m.r}" y1="${Y(r.value).toFixed(1)}" y2="${Y(r.value).toFixed(1)}" stroke="${r.color || '#f5a623'}" stroke-width="1.5" stroke-dasharray="5 4"/>`;
    svg += `<text x="${W0 - m.r}" y="${(Y(r.value) - 4).toFixed(1)}" fill="${r.color || '#f5a623'}" font-size="10.5" text-anchor="end">${esc(r.label)}</text>`;
  });
  if (goalLine && goalLine.length) {
    svg += `<polyline fill="none" stroke="#f5a623" stroke-width="2" stroke-dasharray="6 5" points="${goalLine.map((p) => `${X(p.date).toFixed(1)},${Y(p.value).toFixed(1)}`).join(' ')}"/>`;
    goalLine.slice(1).forEach((p) => { svg += `<circle cx="${X(p.date).toFixed(1)}" cy="${Y(p.value).toFixed(1)}" r="2.5" fill="#f5a623"/>`; });
  }
  if (series.length) {
    svg += `<polyline fill="none" stroke="#f3f3f5" stroke-width="2.5" stroke-linejoin="round" points="${series.map((p) => `${X(p.date).toFixed(1)},${Y(p.value).toFixed(1)}`).join(' ')}"/>`;
    series.forEach((p, i) => {
      svg += `<circle cx="${X(p.date).toFixed(1)}" cy="${Y(p.value).toFixed(1)}" r="${i === series.length - 1 ? 4.5 : 3.5}" fill="#0b0b0d" stroke="#f3f3f5" stroke-width="2"><title>${fmtDay(p.date)}: ${p.value} ${unit}</title></circle>`;
    });
    const lastP = series[series.length - 1];
    const lx = X(lastP.date);
    svg += `<text x="${clamp(lx, m.l + 14, W0 - m.r - 14).toFixed(1)}" y="${(Y(lastP.value) - 9).toFixed(1)}" fill="#f3f3f5" font-size="12" font-weight="700" text-anchor="middle">${lastP.value.toFixed(digits)}</text>`;
  }
  svg += `<text x="${m.l}" y="${H0 - 6}" fill="#9b9ba6" font-size="11">${fmtDay(xFrom)}</text>`;
  svg += `<text x="${W0 - m.r}" y="${H0 - 6}" fill="#9b9ba6" font-size="11" text-anchor="end">${fmtDay(xTo)}</text>`;
  svg += '</svg>';
  return svg;
}
function niceStep(raw) {
  const p = Math.pow(10, Math.floor(Math.log10(raw || 1)));
  const n = raw / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}

function chartCard(title, unit, legend, svg) {
  return `<div class="card chart"><div class="card-head"><h3>${esc(title)}</h3><span class="muted small">${esc(unit)}</span></div>${svg}
    <div class="legend">${legend}</div></div>`;
}

function personalRecords() {
  const best = {};
  for (const s of Object.values(S.data.sessions)) {
    for (const [exId, sets] of Object.entries(s.sets || {})) {
      const ex = findExercise(exId);
      if (!ex) continue;
      for (const x of sets) {
        if (!x || !x.done) continue;
        const kg = toNum(x.kg); const reps = toNum(x.reps);
        if (reps == null) continue;
        const when = s.finishedAt || s.updatedAt || s.startedAt;
        const cand = { ex, kg, reps, when };
        const cur = best[ex.lift];
        if (!cur || better(ex, cand, cur)) best[ex.lift] = cand;
      }
    }
  }
  return Object.values(best).sort((a, b) => a.ex.name.localeCompare(b.ex.name));
}
function better(ex, a, b) {
  if (ex.unit === 'secs') return a.reps > b.reps;
  const ak = a.kg == null ? 0 : a.kg; const bk = b.kg == null ? 0 : b.kg;
  if (ex.assisted) return ak < bk || (ak === bk && a.reps > b.reps); // less assist is better
  return ak > bk || (ak === bk && a.reps > b.reps);
}

function renderProgress() {
  setChrome('progress');
  const u = S.user;
  const scans = sortedScans();
  const first = scans.find((s) => s.id === 'start') || scans[0];
  const latest = scans[scans.length - 1];
  const recomp = u.goalType === 'recomp';
  const ms = milestoneList(u);
  const xFrom = first ? first.date : planStartOrNext();
  let xTo = ymd(addDays(parseYmd(planStartOrNext()), PLAN_WEEKS * 7 - 1));
  if (ms[ms.length - 1].date > xTo) xTo = ms[ms.length - 1].date;
  if (latest && latest.date > xTo) xTo = latest.date;
  const delta = (k) => (latest && first && latest[k] != null && first[k] != null ? latest[k] - first[k] : null);

  /* headline */
  let stats;
  if (recomp) {
    const inBand = latest && latest.weight >= u.weightBand[0] && latest.weight <= u.weightBand[1];
    const dFat = delta('fatKg'); const dMus = delta('muscleKg');
    stats = `
      <div class="stat"><div class="k">Fat</div><div class="v">${fmt1(latest.fatKg)}<small> kg</small></div><div class="d ${dFat < 0 ? 'good' : dFat > 0 ? 'bad' : ''}">${signed(dFat)} kg since start</div></div>
      <div class="stat"><div class="k">Muscle</div><div class="v">${fmt1(latest.muscleKg)}<small> kg</small></div><div class="d ${dMus >= 0 ? 'good' : 'bad'}">${signed(dMus)} kg · goal ≥ ${u.muscleTarget}</div></div>
      <div class="stat"><div class="k">Body fat</div><div class="v">${fmt1(latest.bodyFat)}<small> %</small></div><div class="d ${latest.bodyFat <= u.bodyFatTarget ? 'good' : ''}">goal ≤ ${u.bodyFatTarget}%</div></div>
      <div class="stat"><div class="k">Weight band</div><div class="v">${u.weightBand[0]}–${u.weightBand[1]}<small> kg</small></div><div class="d ${inBand ? 'good' : 'bad'}">Now ${fmt1(latest.weight)} kg ${inBand ? '✓ in band' : '✗ outside'}</div></div>`;
  } else {
    const dW = delta('weight'); const dFat = delta('fatKg'); const dMus = delta('muscleKg');
    const nextM = ms.find((m) => m.date >= todayStr()) || ms[ms.length - 1];
    stats = `
      <div class="stat"><div class="k">Weight</div><div class="v">${fmt1(latest.weight)}<small> kg</small></div><div class="d ${dW < 0 ? 'good' : dW > 0 ? 'bad' : ''}">${signed(dW)} kg · ${fmt1(Math.max(0, latest.weight - u.goalWeight))} to go</div></div>
      <div class="stat"><div class="k">Next milestone</div><div class="v">${nextM.target}<small> kg</small></div><div class="d">by ${fmtDay(nextM.date)} (week ${nextM.week})</div></div>
      <div class="stat"><div class="k">Fat</div><div class="v">${fmt1(latest.fatKg)}<small> kg</small></div><div class="d ${dFat < 0 ? 'good' : dFat > 0 ? 'bad' : ''}">${signed(dFat)} kg since start</div></div>
      <div class="stat"><div class="k">Muscle</div><div class="v">${fmt1(latest.muscleKg)}<small> kg</small></div><div class="d ${dMus >= 0 ? 'good' : 'bad'}">${signed(dMus)} kg · keep it</div></div>`;
  }

  /* charts */
  const ser = (k) => scans.filter((s) => s[k] != null).map((s) => ({ date: s.date, value: s[k] }));
  const msLine = [{ date: first.date, value: first[u.milestones.metric] }].concat(ms.map((m) => ({ date: m.date, value: m.target })));
  const dashed = '<span><i></i>Milestone path</span>';
  const solid = '<span><i class="solid"></i>Your scans</span>';
  const charts = [];
  if (recomp) {
    charts.push(chartCard('Fat', 'kg', `${solid}${dashed}`, lineChart({ title: 'Fat kg', unit: 'kg', series: ser('fatKg'), goalLine: msLine, xFrom, xTo })));
    charts.push(chartCard('Muscle', 'kg', `${solid}<span><i></i>Goal ≥ ${u.muscleTarget} kg</span>`, lineChart({ title: 'Muscle kg', unit: 'kg', series: ser('muscleKg'), refLines: [{ value: u.muscleTarget, label: `goal ${u.muscleTarget}` }], xFrom, xTo })));
    charts.push(chartCard('Weight', 'kg', `${solid}<span><i class="band"></i>Band ${u.weightBand[0]}–${u.weightBand[1]} kg</span>`, lineChart({ title: 'Weight', unit: 'kg', series: ser('weight'), band: u.weightBand, xFrom, xTo })));
  } else {
    const refs = [{ value: u.goalWeight, label: `goal ${u.goalWeight}` }];
    if (u.note) refs.push({ value: u.note.weight, label: `${u.note.weight}: ${u.note.label}`, color: '#3ecf8e' });
    charts.push(chartCard('Weight', 'kg', `${solid}${dashed}${u.note ? `<span><i style="border-color:#3ecf8e"></i>${u.note.weight} kg: ${esc(u.note.label)}</span>` : ''}`,
      lineChart({ title: 'Weight', unit: 'kg', series: ser('weight'), goalLine: msLine, refLines: refs, xFrom, xTo })));
    charts.push(chartCard('Fat', 'kg', solid, lineChart({ title: 'Fat kg', unit: 'kg', series: ser('fatKg'), xFrom, xTo })));
    charts.push(chartCard('Muscle', 'kg', `${solid}<span><i></i>Hold at start (${fmt1(first.muscleKg)} kg)</span>`, lineChart({ title: 'Muscle kg', unit: 'kg', series: ser('muscleKg'), refLines: [{ value: first.muscleKg, label: 'hold' }], xFrom, xTo })));
  }
  charts.push(chartCard('Visceral fat', 'cm²', `${solid}<span><i></i>100 cm² healthy line</span>`, lineChart({ title: 'Visceral fat', unit: 'cm²', series: ser('visceral'), refLines: [{ value: 100, label: '100' }], xFrom, xTo, digits: 0 })));

  /* milestones */
  const today = todayStr();
  const msRows = ms.map((m) => {
    const sc = scanNear(m.date, scans);
    const pending = m.date > today && !sc;
    let actual = '–'; let ok = null; let extra = '';
    if (sc) {
      if (recomp) {
        actual = `${fmt1(sc.fatKg)} kg`;
        const musOk = sc.muscleKg >= first.muscleKg;
        ok = sc.fatKg <= m.target && musOk;
        extra = `<td class="c">${fmt1(sc.muscleKg)} ${musOk ? '✓' : '✗'}</td>`;
      } else {
        actual = `${fmt1(sc.weight)} kg`;
        ok = sc.weight <= m.target;
      }
    } else if (recomp) extra = '<td class="c">–</td>';
    const mark = ok === null ? `<span class="muted">${pending ? 'upcoming' : 'no scan'}</span>` : ok ? '<span class="good">✓</span>' : '<span class="bad">✗</span>';
    return `<tr><td>Wk ${m.week}<div class="tiny muted">${fmtDay(m.date)}</div></td><td>${recomp ? '≤ ' : ''}${m.target.toFixed(1)} kg</td><td>${actual}</td>${extra}<td class="c">${mark}</td></tr>`;
  }).join('');
  const msTable = `<div class="table-wrap"><table>
    <thead><tr><th>Checkpoint</th><th>Target ${recomp ? 'fat' : 'weight'}</th><th>Actual</th>${recomp ? '<th class="c">Muscle</th>' : ''}<th class="c"></th></tr></thead>
    <tbody>${msRows}</tbody></table></div>
    <p class="muted tiny" style="margin-top:8px">${planStart() ? '' : `Dates assume you start on ${fmtDayLong(nextSunday())}; they lock in when you tap Start. `}Actual uses the scan closest to each checkpoint (within 10 days).${recomp ? ` Muscle should rise or hold at ${fmt1(first.muscleKg)} kg.` : ''}</p>`;

  /* scan list */
  const scanItems = scans.slice().reverse().map((s) => {
    const d = (k, label, unitStr = ' kg', digits = 1) => (s[k] != null && first[k] != null && s !== first ? `${label} ${signed(s[k] - first[k], digits)}${unitStr}` : null);
    const changes = [d('weight', 'Weight'), d('fatKg', 'Fat'), d('muscleKg', 'Muscle'), d('bodyFat', 'BF', '%'), d('visceral', 'Visceral', '', 0)].filter(Boolean);
    return `<div class="list-item"><div class="grow">
      <div class="t">${fmtDayLong(s.date)}${s.id === 'start' ? ' · <span class="tag">Start</span>' : ''}</div>
      <div class="s num">${fmt1(s.weight)} kg · ${fmt1(s.bodyFat)}% · fat ${fmt1(s.fatKg)} · muscle ${fmt1(s.muscleKg)} · visceral ${s.visceral ?? '–'}</div>
      ${changes.length ? `<div class="s num">${changes.join(' · ')}</div>` : ''}
    </div>${s.id === 'start' ? '' : `<button type="button" class="btn small ghost" data-action="delete-scan" data-id="${esc(s.id)}" aria-label="Delete scan ${s.date}">✕</button>`}</div>`;
  }).join('');

  /* PRs */
  const prs = personalRecords();
  const prList = prs.length ? `<div class="list">${prs.map((p) => `<div class="list-item"><div class="grow"><div class="t">${esc(p.ex.lift === p.ex.id ? p.ex.name : p.ex.name.replace(/\s*\(.*\)$/, ''))}</div>
      <div class="s">${p.when ? fmtDay(ymd(new Date(p.when))) : ''}${p.ex.assisted ? ' · least assist' : ''}</div></div>
      <div class="r">${p.ex.unit === 'secs' ? `${p.reps} s` : `${p.kg == null ? 'BW' : fmtKg(p.kg) + ' kg'} × ${p.reps}`}</div></div>`).join('')}</div>`
    : '<p class="muted">Tick some sets and your bests show up here.</p>';

  app().innerHTML = `
    <h1>Progress</h1>
    <p class="sub">${recomp ? 'Recomp: lose fat, keep or build muscle.' : `Cut to ${esc(u.goalText)}.`} Latest scan ${fmtDay(latest.date)}.</p>
    <div class="stats">${stats}</div>
    ${charts.join('')}
    <h2>Milestones</h2>
    <div class="card">${msTable}</div>
    <h2>Body scans</h2>
    <details class="card" id="scan-form-wrap">
      <summary>Add a scan</summary>
      <form id="scan-form" novalidate>
        <div class="grid-2">
          <label class="field"><span>Date</span><input type="date" name="date" value="${todayStr()}" required></label>
          <label class="field"><span>Weight (kg)</span><input type="text" inputmode="decimal" name="weight" placeholder="${fmt1(latest.weight)}" required></label>
          <label class="field"><span>Body fat %</span><input type="text" inputmode="decimal" name="bodyFat" placeholder="${fmt1(latest.bodyFat)}"></label>
          <label class="field"><span>Fat (kg)</span><input type="text" inputmode="decimal" name="fatKg" placeholder="${fmt1(latest.fatKg)}"></label>
          <label class="field"><span>Muscle (kg)</span><input type="text" inputmode="decimal" name="muscleKg" placeholder="${fmt1(latest.muscleKg)}"></label>
          <label class="field"><span>Visceral fat (cm²)</span><input type="text" inputmode="decimal" name="visceral" placeholder="${latest.visceral ?? ''}"></label>
        </div>
        <button class="btn block" type="submit">Save scan</button>
        <p class="error" id="scan-error" hidden></p>
      </form>
    </details>
    <div class="list">${scanItems}</div>
    <h2>Personal records</h2>
    ${prList}
  `;
  $('#scan-form').addEventListener('submit', onScanSubmit);
}

function onScanSubmit(ev) {
  ev.preventDefault();
  const f = new FormData(ev.target);
  const err = $('#scan-error');
  const date = String(f.get('date') || '');
  const weight = toNum(f.get('weight'));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { err.textContent = 'Pick a date.'; err.hidden = false; return; }
  if (weight == null || weight < 30 || weight > 250) { err.textContent = 'Enter your weight in kg.'; err.hidden = false; return; }
  const scan = { id: `scan-${Date.now()}`, date, weight };
  for (const k of ['bodyFat', 'fatKg', 'muscleKg', 'visceral']) {
    const v = toNum(f.get(k));
    if (v != null) scan[k] = v;
  }
  S.data.scans.push(scan);
  save();
  toast('Scan saved');
  renderProgress();
}

/* ---------- settings ---------- */

function renderSettings() {
  setChrome('settings');
  const u = S.user;
  const st = S.data.settings;
  const wk = weekNumber();
  app().innerHTML = `
    <h1>Settings</h1>
    <p class="sub">Signed in as <strong>${esc(u.name)}</strong> · ${esc(u.goalText)}</p>

    <div class="card setting">
      <h3>Plan start</h3>
      ${!planStart()
        ? `<p>Not started. Tap Start and week 1 begins on ${fmtDayLong(nextSunday())}.</p>
           <button type="button" class="btn" data-action="start-plan">Start my plan</button>`
        : wk < 1
          ? `<p>Week 1 starts ${fmtDayLong(planStart())}.</p>
             <button type="button" class="btn ghost" data-action="cancel-start">Cancel start</button>`
          : `<p>Started ${fmtDayLong(planStart())} · week ${wk} of ${PLAN_WEEKS}. Restarting keeps all your workouts, habits and scans; only the week count starts again.</p>
             <button type="button" class="btn ghost" data-action="restart-plan">Restart from ${fmtDayLong(nextSunday())}</button>`}
    </div>

    <div class="card setting">
      <h3>Session length</h3>
      <p>Changes which exercises show. Core work always stays; 75 min adds a set to the first two lifts.</p>
      <div class="pills" role="radiogroup" aria-label="Session length">
        ${SESSION_LENGTHS.map((m) => {
          const est = WORKOUT_ORDER.map((wid) => prescribe(wid, m, isDeload(wk)).minutes);
          return `<label><input type="radio" name="len" value="${m}" ${st.sessionLength === m ? 'checked' : ''}><span>${m} min<small>≈ ${roundTo5(Math.min(...est))}–${roundTo5(Math.max(...est))}</small></span></label>`;
        }).join('')}
      </div>
    </div>

    <div class="card setting">
      <h3>Rest timer</h3>
      <label class="check-line"><input type="checkbox" id="sound" ${st.sound ? 'checked' : ''}> Beep when rest is over (phones that support it also vibrate)</label>
    </div>

    <div class="card setting">
      <h3>Backup</h3>
      <p>Your data lives only on this phone. Export a backup monthly and keep it somewhere safe.</p>
      <div class="row wrap">
        <button type="button" class="btn" data-action="export">Export backup</button>
        <label class="btn ghost" for="import-file">Import backup</label>
        <input type="file" id="import-file" accept="application/json,.json" hidden>
      </div>
    </div>

    <div class="card setting">
      <h3>Switch user</h3>
      <p>Each person's data stays separate on this device.</p>
      <button type="button" class="btn ghost" data-action="switch-user">Switch user</button>
    </div>

    <div class="card setting">
      <h3>Reset my data</h3>
      <p>Deletes all of ${esc(u.name)}'s workouts, habits and scans on this device. Type <strong>RESET</strong> to confirm.</p>
      <div class="row"><input type="text" id="reset-confirm" class="grow" autocomplete="off" autocapitalize="characters" aria-label="Type RESET to confirm" placeholder="RESET">
        <button type="button" class="btn danger" data-action="reset" id="reset-btn" disabled>Reset</button></div>
    </div>

    <p class="version">Gym Crew v${esc(APP_VERSION)} · data schema ${SCHEMA_VERSION}</p>
  `;
  $$('input[name=len]').forEach((r) => r.addEventListener('change', () => {
    st.sessionLength = Number(r.value);
    save();
    toast(`Sessions set to ${st.sessionLength} min`);
  }));
  $('#sound').addEventListener('change', (e) => { st.sound = e.target.checked; save(); });
  $('#reset-confirm').addEventListener('input', (e) => { $('#reset-btn').disabled = e.target.value.trim() !== 'RESET'; });
  $('#import-file').addEventListener('change', onImportFile);
}

function exportBackup() {
  const payload = { app: 'gymcrew', userId: S.user.id, exportedAt: new Date().toISOString(), data: S.data };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `gymcrew-${S.user.id}-${todayStr()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  toast('Backup downloaded');
}

function validateBackup(obj) {
  if (!obj || typeof obj !== 'object') return 'This file is not a Gym Crew backup.';
  if (obj.app !== 'gymcrew' || !obj.data) return 'This file is not a Gym Crew backup.';
  if (obj.userId !== S.user.id) {
    const owner = USERS[obj.userId];
    return `This backup belongs to ${owner ? owner.name : 'someone else'}. Sign in as them to import it.`;
  }
  const d = obj.data;
  if (typeof d !== 'object') return 'The backup is damaged.';
  if (!Number.isInteger(d.schemaVersion) || d.schemaVersion > SCHEMA_VERSION) return 'This backup is from a newer version of the app. Update the app first.';
  if (!d.settings || typeof d.settings !== 'object') return 'The backup is missing settings.';
  if (!d.sessions || typeof d.sessions !== 'object' || Array.isArray(d.sessions)) return 'The backup is missing workouts.';
  if (!d.habits || typeof d.habits !== 'object' || Array.isArray(d.habits)) return 'The backup is missing habits.';
  if (!Array.isArray(d.scans) || d.scans.some((s) => !s || typeof s.date !== 'string' || typeof s.weight !== 'number')) return 'The backup has damaged scans.';
  return null;
}

function onImportFile(ev) {
  const file = ev.target.files && ev.target.files[0];
  ev.target.value = '';
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    let obj;
    try { obj = JSON.parse(reader.result); } catch (e) { toast('That file is not valid JSON.'); return; }
    const problem = validateBackup(obj);
    if (problem) { toast(esc(problem), { ms: 5000 }); return; }
    const n = Object.keys(obj.data.sessions).length;
    if (!confirm(`Replace all of ${S.user.name}'s data on this device with this backup (${n} workouts, ${obj.data.scans.length} scans, exported ${String(obj.exportedAt || '').slice(0, 10)})?`)) return;
    S.data = migrate(obj.data, S.user);
    save();
    toast('Backup imported');
    route();
  };
  reader.onerror = () => toast('Could not read that file.');
  reader.readAsText(file);
}

function resetData() {
  if ($('#reset-confirm').value.trim() !== 'RESET') return;
  const keepTip = S.data.settings.tipDismissed;
  S.data = freshData(S.user);
  S.data.settings.tipDismissed = keepTip;
  S.data.settings.persistAsked = true;
  save();
  clearTimer();
  toast('Your data was reset');
  location.hash = '#/today';
}

/* ================= router & events ================= */

function route() {
  const parts = location.hash.replace(/^#\/?/, '').split('/');
  const name = parts[0] || '';
  if (!S.user) {
    if (name !== 'login') { location.replace('#/login'); return; }
    renderLogin();
    updateTimer();
    return;
  }
  if (name !== 'workout') W = null;
  closeHowto();
  switch (name) {
    case 'today': renderToday(); break;
    case 'plan': renderPlan(); break;
    case 'workout': renderWorkout(parts[1]); break;
    case 'habits': renderHabits(); break;
    case 'progress': renderProgress(); break;
    case 'settings': renderSettings(); break;
    default: location.replace('#/today'); return;
  }
  updateTimer();
}

function onClick(ev) {
  const el = ev.target.closest('[data-action]');
  if (!el) return;
  const a = el.dataset.action;
  switch (a) {
    case 'tick': onTick(el); break;
    case 'check': onCheck(el); break;
    case 'finish': finishWorkout(); break;
    case 'finish-early':
      if (confirm('Finish now? Only the sets you ticked are saved.')) finishWorkout();
      break;
    case 'finisher-timer': startTimer(Number(el.dataset.min) * 60, 'Finisher'); break;
    case 'howto': openHowto(el.dataset.ex); break;
    case 'howto-close': closeHowto(); break;
    case 'howto-toggle': toggleHowto(); break;
    case 'view-photo': openViewer(el.dataset.src, $('img', el).alt); break;
    case 'habit': toggleHabit(el); break;
    case 'dismiss-tip': S.data.settings.tipDismissed = true; save(); route(); break;
    case 'week-prev': S.habitsWeek = ymd(addDays(parseYmd(S.habitsWeek || thisWeekStart()), -7)); route(); break;
    case 'week-next': {
      const next = ymd(addDays(parseYmd(S.habitsWeek || thisWeekStart()), 7));
      S.habitsWeek = next >= thisWeekStart() ? null : next;
      route();
      break;
    }
    case 'delete-scan':
      if (confirm('Delete this scan?')) {
        S.data.scans = S.data.scans.filter((s) => s.id !== el.dataset.id);
        save();
        renderProgress();
      }
      break;
    case 'start-plan': startPlan(); break;
    case 'restart-plan':
      if (confirm(`Restart your plan? Week 1 will begin ${fmtDayLong(nextSunday())}. Your workouts, habits and scans are kept.`)) startPlan();
      break;
    case 'cancel-start': S.data.settings.startDate = null; save(); toast('Start cancelled'); route(); break;
    case 'export': exportBackup(); break;
    case 'switch-user': logout(); break;
    case 'reset': resetData(); break;
    case 'timer-add':
      if (S.timer) { S.timer.endsAt += 15000; S.timer.total += 15000; persistTimer(); updateTimer(); }
      break;
    case 'timer-skip': clearTimer(); break;
    default: break;
  }
}

function onInput(ev) {
  const row = ev.target.closest('.set-row');
  if (row && W) onSetInput(row);
}

function openViewer(src, alt) {
  const v = $('#viewer');
  const img = $('img', v);
  img.src = src;
  img.alt = alt || '';
  v.hidden = false;
}

/* ================= service worker & update toast ================= */

function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  if (location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') return;
  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) return;
    refreshing = true;
    location.reload();
  });
  navigator.serviceWorker.register('./sw.js').then((reg) => {
    const offer = (worker) => {
      toast('<strong>Update available</strong> — tap to refresh', {
        ms: 0,
        action: () => { worker.postMessage({ type: 'SKIP_WAITING' }); $('#toast').hidden = true; },
      });
    };
    if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      if (!w) return;
      w.addEventListener('statechange', () => {
        if (w.state === 'installed' && navigator.serviceWorker.controller) offer(w);
      });
    });
    // Check for updates whenever the app comes back to the foreground.
    document.addEventListener('visibilitychange', () => { if (!document.hidden) reg.update().catch(() => {}); });
  }).catch((e) => console.warn('Service worker registration failed', e));
}

/* ================= boot ================= */

function boot() {
  Store.probe();
  document.addEventListener('click', onClick);
  document.addEventListener('input', onInput);
  $('#viewer').addEventListener('click', () => { $('#viewer').hidden = true; });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { $('#viewer').hidden = true; closeHowto(); } });
  $('#howto').addEventListener('click', (e) => { if (e.target.id === 'howto') closeHowto(); });
  $('#howto-stage').addEventListener('click', toggleHowto);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    updateTimer();
    // Re-render screens that depend on "today" (the app may have been left open overnight).
    if (S.user && !W) route();
  });
  window.addEventListener('hashchange', route);

  const last = Store.get(KEY_LAST_USER);
  if (last && USERS[last]) {
    login(USERS[last]);
    if (!location.hash || location.hash === '#/login' || location.hash === '#/') location.replace('#/today');
  }
  route();
  registerSW();
}

boot();
