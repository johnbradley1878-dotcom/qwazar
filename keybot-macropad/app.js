/* =====================================================================
   KeyBot Pad – Bluetooth macro pad for the Keyestudio KeyBot tamagotchi
   Talks to the HC-06 (Bluetooth Classic SPP) through the Web Serial API
   in Chrome for Android. Commands match handleCommand() in
   keybotQZR_tamagotchi.ino.
   ===================================================================== */
'use strict';

const SPP_UUID = '00001101-0000-1000-8000-00805f9b34fb';   // Serial Port Profile
const STORE_SLOTS = 'keybot.slots.v1';
const STORE_SETTINGS = 'keybot.settings.v1';

const COLORS = ['sunset', 'amber', 'ocean', 'ember', 'sand', 'sky', 'aqua', 'lime',
                'rose', 'mint', 'violet', 'indigo', 'gold', 'teal', 'magenta', 'slate'];

const EMOJI_PICKS = ['🎵', '💃', '🐶', '🦴', '⭐', '🎉', '💡', '🌈', '🚀', '🎯', '🐾', '😜', '🔔', '🧸', '🍪', '⚡'];

// One entry per command the robot currently understands, then free slots.
const DEFAULT_SLOTS = [
  { label: 'Feed',      icon: '🍽️', cmd: 'F', color: 'sunset' },
  { label: 'Bone',      icon: '🦴', cmd: '1', color: 'amber' },
  { label: 'Fish',      icon: '🐟', cmd: '2', color: 'ocean' },
  { label: 'Burger',    icon: '🍔', cmd: '3', color: 'ember' },
  { label: 'Potato',    icon: '🥔', cmd: '4', color: 'sand' },
  { label: 'Drink',     icon: '💧', cmd: 'D', color: 'sky' },
  { label: 'Wash',      icon: '🛁', cmd: 'W', color: 'aqua' },
  { label: 'Change',    icon: '🧷', cmd: '9', color: 'lime' },
  { label: 'Cuddle',    icon: '💖', cmd: 'P', color: 'rose' },
  { label: 'Fetch',     icon: '🎾', cmd: 'G', color: 'mint' },
  { label: 'Scare',     icon: '👻', cmd: 'S', color: 'violet' },
  { label: 'Sleep',     icon: '😴', cmd: 'Z', color: 'indigo' },
  { label: 'Wake up',   icon: '☀️', cmd: 'A', color: 'gold' },
  { label: 'Stats',     icon: '📊', cmd: '?', color: 'teal' },
  { label: 'Sound',     icon: '🔊', cmd: 'M', color: 'magenta' },
  { label: 'Turn test', icon: '🔄', cmd: 'C', color: 'slate' },
  { label: 'Help',      icon: '❓', cmd: 'H', color: 'slate' },
  { empty: true }, { empty: true }, { empty: true }, { empty: true },
  { empty: true }, { empty: true }, { empty: true },
];

const DEFAULT_SETTINGS = { stopOnRelease: true, haptics: true, wakeLock: true, repeatMs: 150, baud: 9600 };

const METERS = [
  { key: 'Food',   icon: '🍖', m1: '#ff7a59', m2: '#ffd166' },
  { key: 'Drink',  icon: '💧', m1: '#1e90ff', m2: '#5ee7ff' },
  { key: 'Clean',  icon: '🫧', m1: '#0aa5a5', m2: '#3cf0d0' },
  { key: 'Energy', icon: '⚡', m1: '#f5a300', m2: '#fff07a' },
  { key: 'Joy',    icon: '💖', m1: '#f0287a', m2: '#ff8fc8' },
];

// Robot reply text -> emoji for the little screen
const REPLY_FACES = [
  [/bone|fish|burger|potato|here comes/i, '😋'], [/yuck|hated/i, '🤢'], [/glug/i, '🥤'],
  [/poo|changing/i, '💩'], [/bath/i, '🛁'], [/cuddle/i, '🥰'], [/boo/i, '👻'], [/eek/i, '😱'],
  [/night|sleepy|zzz/i, '😴'], [/morning|awake/i, '☀️'], [/fetch/i, '🎾'], [/bump|way/i, '💥'],
  [/stopped/i, '🛑'], [/sound on/i, '🔊'], [/sound off/i, '🔇'], [/turn test/i, '🔄'], [/clean/i, '✨'],
];

/* ===================== State ===================== */
const $ = (id) => document.getElementById(id);
let slots = load(STORE_SLOTS, DEFAULT_SLOTS);
let settings = { ...DEFAULT_SETTINGS, ...load(STORE_SETTINGS, {}) };
let port = null, writer = null, reader = null, keepReading = false, readDone = null;
let editing = false, editIndex = -1, edColor = COLORS[0];
let wakeLock = null;
const hasSerial = 'serial' in navigator;

function load(key, fallback) {
  try { const v = JSON.parse(localStorage.getItem(key)); return v ?? structuredClone(fallback); }
  catch { return structuredClone(fallback); }
}
const saveSlots = () => localStorage.setItem(STORE_SLOTS, JSON.stringify(slots));
const saveSettings = () => localStorage.setItem(STORE_SETTINGS, JSON.stringify(settings));

/* ===================== Helpers ===================== */
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), 2200);
}

function log(text, cls = 'sys') {
  const el = $('log');
  const line = document.createElement('div');
  line.className = cls;
  line.textContent = (cls === 'tx' ? '→ ' : cls === 'rx' ? '← ' : '') + text;
  el.appendChild(line);
  while (el.childElementCount > 300) el.firstChild.remove();
  el.scrollTop = el.scrollHeight;
}

const buzz = (ms = 12) => settings.haptics && navigator.vibrate && navigator.vibrate(ms);

// "I"  "\n"  "\x1B[A" -> bytes (UTF-8, so £ becomes C2 A3 which the robot understands)
function encodeCmd(str) {
  const enc = new TextEncoder();
  const out = [];
  const re = /\\x([0-9a-fA-F]{2})|\\([nrt\\])/g;
  let last = 0, m;
  while ((m = re.exec(str))) {
    out.push(...enc.encode(str.slice(last, m.index)));
    out.push(m[1] ? parseInt(m[1], 16) : { n: 10, r: 13, t: 9, '\\': 92 }[m[2]]);   // \xHH = raw byte
    last = re.lastIndex;
  }
  out.push(...enc.encode(str.slice(last)));
  return new Uint8Array(out);
}

/* ===================== Bluetooth serial ===================== */
async function connect() {
  if (!hasSerial) { toast('Open this page in Chrome on Android'); return; }
  setConn('busy', 'Connecting…');
  try {
    // Re-use a robot we already have permission for; otherwise show the picker.
    const known = await navigator.serial.getPorts();
    port = known[0];
    if (!port) port = await pickPort();
    try {
      await port.open({ baudRate: Number(settings.baud) || 9600 });
    } catch (e) {
      if (known[0] && !/already open/i.test(e.message)) {   // remembered robot failed – let user pick again
        port = await pickPort();
        await port.open({ baudRate: Number(settings.baud) || 9600 });
      } else throw e;
    }
    writer = port.writable.getWriter();
    setConn('on', 'Connected');
    log('Connected to robot');
    say('🐶', 'Connected! Say hello to KeyBot.');
    buzz(40);
    requestWakeLock();
    readDone = readLoop();
  } catch (e) {
    port = null;
    setConn('off', 'Connect');
    if (e.name !== 'NotFoundError') { log('Connect failed: ' + e.message); toast('Could not connect – is the robot on & paired?'); }
  }
}

function pickPort() {
  return navigator.serial.requestPort({
    filters: [{ bluetoothServiceClassId: SPP_UUID }],
    allowedBluetoothServiceClassIds: [SPP_UUID],
  }).catch((e) => {
    if (e.name === 'TypeError') return navigator.serial.requestPort();   // older Chrome: no filter support
    throw e;
  });
}

async function disconnect(fromReadLoop = false) {
  if (!port) return;
  keepReading = false;
  try { await reader?.cancel(); } catch {}
  if (!fromReadLoop) { try { await readDone; } catch {} }   // reader must release its lock before close()
  try { writer?.releaseLock(); } catch {}
  try { await port?.close(); } catch {}
  port = writer = reader = null;
  releaseWakeLock();
  setConn('off', 'Connect');
  log('Disconnected');
  say('🤖', 'Disconnected. Tap Connect to drive again.');
}

async function readLoop() {
  keepReading = true;
  const decoder = new TextDecoder();
  let buffer = '';
  while (port?.readable && keepReading) {
    reader = port.readable.getReader();
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let nl;
        while ((nl = buffer.search(/\r?\n/)) >= 0) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1).replace(/^\n/, '');
          if (line) onRobotLine(line);
        }
      }
    } catch (e) {
      log('Link lost: ' + e.message);
      break;
    } finally {
      reader.releaseLock();
    }
  }
  if (keepReading) disconnect(true);   // robot switched off / out of range
}

async function send(cmd, { quiet = false } = {}) {
  if (!cmd) return;
  if (!quiet) log(cmd, 'tx');
  if (!writer) {
    if (!hasSerial) return;              // demo mode – just logged
    if (!quiet) toast('Not connected – tap Connect');
    return;
  }
  try { await writer.write(encodeCmd(cmd)); }
  catch (e) { log('Send failed: ' + e.message); }
}

function setConn(state, text) {
  $('btn-connect').dataset.state = state;
  $('connect-text').textContent = text;
}

/* ===================== Robot replies ===================== */
function say(face, text) {
  const f = $('speech-face');
  f.textContent = face;
  f.classList.remove('bump'); void f.offsetWidth; f.classList.add('bump');
  $('speech-text').textContent = text;
}

function onRobotLine(line) {
  log(line, 'rx');
  if (/^Food \d+/.test(line)) { parseStats(line); say('📊', 'Stats updated.'); return; }
  if (/^(F feed|D or pound|W wash|Arrows|Z sleep)/.test(line)) return;   // help text: console only
  const face = (REPLY_FACES.find(([re]) => re.test(line)) || [, '🤖'])[1];
  say(face, line);
  if (/did a poo/i.test(line)) $('badge-poo').hidden = false;
  if (/changing him|nothing to change/i.test(line)) $('badge-poo').hidden = true;
  if (/night night|sleepy/i.test(line)) $('badge-sleep').hidden = false;
  if (/good morning/i.test(line)) $('badge-sleep').hidden = true;
}

function parseStats(line) {
  for (const m of METERS) {
    const match = line.match(new RegExp(m.key + '\\s+(-?\\d+)'));
    if (match) setMeter(m.key, Number(match[1]));
  }
  $('badge-poo').hidden = !/NEEDS CHANGING/.test(line);
  $('badge-sleep').hidden = !/asleep/.test(line);
}

function buildMeters() {
  $('meters').innerHTML = METERS.map((m) => `
    <div class="meter" id="meter-${m.key}" style="--m1:${m.m1};--m2:${m.m2}">
      <div class="bar"><div class="fill"></div><div class="val">–</div></div>
      <span class="ico">${m.icon}</span><span>${m.key}</span>
    </div>`).join('');
}

function setMeter(key, v) {
  const el = $('meter-' + key);
  if (!el) return;
  const pct = Math.max(0, Math.min(100, v));
  el.querySelector('.fill').style.height = pct + '%';
  el.querySelector('.val').textContent = v;
  el.classList.toggle('low', v < 25);   // NEED_LEVEL in the sketch
}

/* ===================== Press handling (tap + hold-to-repeat) ===================== */
function bindPress(el, getCmd, { repeat = () => false, onRelease } = {}) {
  let timer = null;
  const start = (e) => {
    if (e.button > 0) return;
    e.preventDefault();
    if (editing && el.classList.contains('tile')) return;   // edit mode handled by click
    el.setPointerCapture?.(e.pointerId);
    el.classList.add('pressed');
    buzz();
    const cmd = getCmd();
    send(cmd);
    if (repeat()) timer = setInterval(() => send(cmd, { quiet: true }), Number(settings.repeatMs) || 150);
  };
  const end = () => {
    if (!el.classList.contains('pressed')) return;
    el.classList.remove('pressed');
    el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
    if (timer) { clearInterval(timer); timer = null; onRelease?.(); }
  };
  el.addEventListener('pointerdown', start);
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  el.addEventListener('lostpointercapture', end);
  el.addEventListener('contextmenu', (e) => e.preventDefault());
}

function initDpad() {
  document.querySelectorAll('.dkey').forEach((k) => {
    const isStop = k.dataset.cmd === 'X';
    bindPress(k, () => k.dataset.cmd, {
      repeat: () => !isStop,
      onRelease: () => settings.stopOnRelease && send('X', { quiet: true }),
    });
  });
  // Keyboard arrows also drive (handy on a PC / with a BT keyboard)
  const keys = { ArrowUp: 'I', ArrowDown: 'K', ArrowLeft: 'J', ArrowRight: 'L', ' ': 'X' };
  document.addEventListener('keydown', (e) => {
    if (e.target.closest('input, dialog')) return;
    if (keys[e.key]) { e.preventDefault(); send(keys[e.key], { quiet: e.repeat }); }
  });
}

/* ===================== Macro grid ===================== */
function tileHTML(s) {
  if (s.empty) return `<span class="t-icon">＋</span><span class="t-label">Free slot</span>`;
  const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  return `<span class="t-cmd">${esc(s.cmd)}</span><span class="t-icon">${esc(s.icon || '🔘')}</span><span class="t-label">${esc(s.label)}</span>`;
}

function renderGrid() {
  const grid = $('grid');
  grid.innerHTML = '';
  slots.forEach((s, i) => {
    const b = document.createElement('button');
    b.className = 'tile' + (s.empty ? ' empty' : '');
    b.id = 'slot-' + i;
    if (!s.empty) b.dataset.color = s.color || 'slate';
    b.style.animationDelay = (i * 18) + 'ms';
    b.innerHTML = tileHTML(s);
    b.setAttribute('aria-label', s.empty ? 'Free slot – tap to assign' : `${s.label} (sends ${s.cmd})`);
    if (s.empty) {
      b.addEventListener('click', () => openEditor(i));
    } else {
      bindPress(b, () => slots[i].cmd, { repeat: () => !!slots[i].repeat });
      b.addEventListener('click', (e) => {
        if (editing) openEditor(i);
        else if (e.detail === 0) send(slots[i].cmd);   // keyboard / accessibility activation
      });
    }
    grid.appendChild(b);
  });
}

function setEditing(on) {
  editing = on;
  document.body.classList.toggle('editing', on);
  $('btn-edit').setAttribute('aria-pressed', on);
  $('btn-edit').textContent = on ? '✅ Done' : '✏️ Edit';
  $('edit-hint').hidden = !on;
}

/* ===================== Slot editor ===================== */
function openEditor(i) {
  editIndex = i;
  const s = slots[i];
  $('editor-title').textContent = s.empty ? 'Assign free slot' : 'Edit button';
  $('ed-label').value = s.empty ? '' : s.label || '';
  $('ed-icon').value = s.empty ? '' : s.icon || '';
  $('ed-cmd').value = s.empty ? '' : s.cmd || '';
  $('ed-repeat').checked = !!s.repeat;
  edColor = s.color || COLORS[(i * 5) % COLORS.length];
  $('ed-clear').hidden = !!s.empty;
  renderSwatches();
  updatePreview();
  $('editor').showModal();
  setTimeout(() => $('ed-label').focus(), 50);
}

function renderSwatches() {
  $('swatches').innerHTML = COLORS.map((c) =>
    `<button type="button" class="swatch${c === edColor ? ' sel' : ''}" data-color="${c}" aria-label="${c}"></button>`).join('');
}

function updatePreview() {
  const p = $('editor-preview');
  p.dataset.color = edColor;
  p.innerHTML = tileHTML({ label: $('ed-label').value || 'Label', icon: $('ed-icon').value || '🔘', cmd: $('ed-cmd').value || '?' });
}

function saveEditor() {
  const cmd = $('ed-cmd').value;
  if (!cmd) { toast('Enter the command letter to send'); $('ed-cmd').focus(); return; }
  slots[editIndex] = {
    label: $('ed-label').value.trim() || cmd,
    icon: $('ed-icon').value.trim() || '🔘',
    cmd, color: edColor, repeat: $('ed-repeat').checked,
  };
  saveSlots(); renderGrid(); $('editor').close();
  toast('Saved ✓');
}

function moveSlot(dir) {
  const j = editIndex + dir;
  if (j < 0 || j >= slots.length) return;
  [slots[editIndex], slots[j]] = [slots[j], slots[editIndex]];
  editIndex = j;
  saveSlots(); renderGrid();
}

function initEditor() {
  $('emoji-row').innerHTML = EMOJI_PICKS.map((e) => `<button type="button">${e}</button>`).join('');
  $('emoji-row').addEventListener('click', (e) => {
    if (e.target.tagName === 'BUTTON') { $('ed-icon').value = e.target.textContent; updatePreview(); }
  });
  $('swatches').addEventListener('click', (e) => {
    const c = e.target.dataset.color;
    if (c) { edColor = c; renderSwatches(); updatePreview(); }
  });
  ['ed-label', 'ed-icon', 'ed-cmd'].forEach((id) => $(id).addEventListener('input', updatePreview));
  $('ed-cancel').addEventListener('click', () => $('editor').close());
  $('ed-clear').addEventListener('click', () => {
    slots[editIndex] = { empty: true }; saveSlots(); renderGrid(); $('editor').close(); toast('Slot freed');
  });
  $('ed-delete').addEventListener('click', () => {
    slots.splice(editIndex, 1); saveSlots(); renderGrid(); $('editor').close(); toast('Slot deleted');
  });
  $('ed-left').addEventListener('click', () => moveSlot(-1));
  $('ed-right').addEventListener('click', () => moveSlot(1));
  $('editor-form').addEventListener('submit', (e) => { e.preventDefault(); saveEditor(); });
}

/* ===================== Drawers & settings ===================== */
function toggleDrawer(id, force) {
  const el = $(id);
  const show = force ?? el.hidden;
  ['console', 'settings'].forEach((d) => { $(d).hidden = true; $('btn-' + d).classList.remove('active'); });
  el.hidden = !show;
  $('btn-' + id).classList.toggle('active', show);
}

function initSettings() {
  const bindCheck = (id, key) => {
    $(id).checked = !!settings[key];
    $(id).addEventListener('change', () => { settings[key] = $(id).checked; saveSettings(); if (key === 'wakeLock') settings.wakeLock && writer ? requestWakeLock() : releaseWakeLock(); });
  };
  const bindNum = (id, key) => {
    $(id).value = settings[key];
    $(id).addEventListener('change', () => { settings[key] = Number($(id).value) || DEFAULT_SETTINGS[key]; saveSettings(); });
  };
  bindCheck('set-stop-release', 'stopOnRelease');
  bindCheck('set-haptics', 'haptics');
  bindCheck('set-wakelock', 'wakeLock');
  bindNum('set-repeat', 'repeatMs');
  bindNum('set-baud', 'baud');

  $('btn-export').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify({ slots, settings }, null, 2)], { type: 'application/json' });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'keybot-pad-layout.json' });
    a.click(); URL.revokeObjectURL(a.href);
  });
  $('file-import').addEventListener('change', async (e) => {
    try {
      const data = JSON.parse(await e.target.files[0].text());
      if (!Array.isArray(data.slots)) throw new Error('no slots');
      slots = data.slots; saveSlots();
      if (data.settings) { settings = { ...DEFAULT_SETTINGS, ...data.settings }; saveSettings(); }
      renderGrid(); toast('Layout imported ✓');
    } catch { toast('That file is not a KeyBot Pad layout'); }
    e.target.value = '';
  });
  $('btn-add-slot').addEventListener('click', () => { slots.push({ empty: true }); saveSlots(); renderGrid(); toast('Free slot added'); });
  $('btn-reset').addEventListener('click', () => {
    if (!confirm('Reset all buttons to the default layout?')) return;
    slots = structuredClone(DEFAULT_SLOTS); saveSlots(); renderGrid(); toast('Layout reset');
  });
  $('btn-forget').addEventListener('click', async () => {
    if (!hasSerial) return;
    await disconnect();
    for (const p of await navigator.serial.getPorts()) await p.forget?.();
    toast('Robot forgotten – you can pick it again');
  });
}

/* ===================== Screen wake lock ===================== */
async function requestWakeLock() {
  if (!settings.wakeLock || !('wakeLock' in navigator)) return;
  try { wakeLock = await navigator.wakeLock.request('screen'); } catch {}
}
function releaseWakeLock() { wakeLock?.release().catch(() => {}); wakeLock = null; }
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && writer) requestWakeLock();
});

/* ===================== Boot ===================== */
function init() {
  buildMeters();
  renderGrid();
  initDpad();
  initEditor();
  initSettings();

  $('btn-connect').addEventListener('click', () => (writer ? disconnect() : connect()));
  $('btn-stats').addEventListener('click', () => send('?'));
  $('btn-edit').addEventListener('click', () => setEditing(!editing));
  $('btn-console').addEventListener('click', () => toggleDrawer('console'));
  $('btn-settings').addEventListener('click', () => toggleDrawer('settings'));
  document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => toggleDrawer(b.dataset.close, false)));
  $('raw-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const v = $('raw-input').value;
    if (v) { send(v); $('raw-input').value = ''; }
  });

  if (!hasSerial) {
    $('demo-banner').hidden = false;
    log('Demo mode: Web Serial not available. Commands are only shown here.');
  } else {
    navigator.serial.addEventListener('disconnect', (e) => { if (e.target === port) disconnect(); });
  }

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

init();
