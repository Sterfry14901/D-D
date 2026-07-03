/* D&D VTT client. Talks to the server over Socket.io. */
const socket = io();
const $ = (id) => document.getElementById(id);

let me = { id: null, name: '', color: '#c0392b', room: '', isGm: false };
let gridSize = 70;
let zoom = 1;
const BOARD_W = 2100, BOARD_H = 1400;
const tokenEls = {};       // id -> element
let fog = { active: false, hidden: {} };
let fogMode = false;        // GM painting mode
let fogPaintHide = true;    // paint hides (true) or reveals (false)
let fogPainting = false;
let paintTarget = 'hide';   // 'hide' | 'reveal' | 'wall'
let walls = {};             // "cx,cy": true — sight-blocking cells
let lighting = false;       // dynamic line-of-sight active
const VISION_RADIUS = 6;    // cells a token can see (~30 ft)
let aoes = [];              // placed spell area templates
let aoeMode = false, aoeShape = 'circle', aoeStart = null;
const SVGNS = 'http://www.w3.org/2000/svg';

/* ============ JOIN ============ */
$('join-btn').onclick = join;
$('join-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') join(); });
$('join-gm').addEventListener('keydown', (e) => { if (e.key === 'Enter') join(); });

function join() {
  me.name = $('join-name').value.trim() || 'Adventurer';
  me.room = $('join-room').value.trim() || 'default';
  me.color = $('join-color').value;
  const gmPassword = $('join-gm').value;
  socket.emit('join', { roomId: me.room, name: me.name, color: me.color, gmPassword });
  $('join-screen').classList.add('hidden');
  $('app').classList.remove('hidden');
  $('room-label').textContent = `Table: ${me.room}`;
  applyZoom();
  loadSheet();
  loadCS();
}

/* ============ INITIAL STATE ============ */
socket.on('state', (s) => {
  me.id = s.youId;
  me.isGm = s.isGm;
  gridSize = s.gridSize || 70;
  applyGrid(gridSize);
  if (s.mapImage) setMap(s.mapImage);
  $('chat-log').innerHTML = '';
  (s.chat || []).forEach(addChat);
  $('tokens').innerHTML = '';
  Object.values(s.tokens || {}).forEach(renderToken);
  renderInit(s.initiative || [], s.turnIndex || 0, s.round || 1);
  fog = s.fog || { active: false, hidden: {} };
  renderFog();
  walls = s.walls || {};
  lighting = !!s.lighting;
  $('light-toggle').textContent = `💡 Lighting: ${lighting ? 'On' : 'Off'}`;
  $('light-toggle').classList.toggle('active', lighting);
  renderWalls();
  refreshLighting();
  aoes = s.aoes || [];
  renderAoes();
  if (s.handout) showHandout(s.handout); else hideHandout();
  setWeather(s.weather || 'clear');
  $('board').classList.toggle('gm-fog', me.isGm);
  $('gm-badge').classList.toggle('hidden', !me.isGm);
  $('fog-btn').classList.toggle('hidden', !me.isGm);
  $('save-btn').classList.toggle('hidden', !me.isGm);
  $('load-btn').classList.toggle('hidden', !me.isGm);
});

/* ============ SAVE / LOAD CAMPAIGN (GM) ============ */
$('save-btn').onclick = () => socket.emit('campaign:get');
socket.on('campaign:data', (data) => {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${data.room || 'campaign'}-${new Date().toISOString().slice(0,10)}.json`;
  a.click(); URL.revokeObjectURL(a.href);
});
$('load-btn').onclick = () => $('load-file').click();
$('load-file').onchange = (e) => {
  const file = e.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = () => { try { socket.emit('campaign:load', JSON.parse(reader.result)); } catch { alert('That file is not a valid campaign save.'); } };
  reader.readAsText(file);
  e.target.value = '';
};

/* ============ RULER ============ */
let rulerMode = false, rulerStart = null;
$('ruler-btn').onclick = () => {
  rulerMode = !rulerMode;
  $('ruler-btn').classList.toggle('on', rulerMode);
  $('board').classList.toggle('ruler-on', rulerMode);
  if (!rulerMode) $('ruler').innerHTML = '';
};
function drawRuler(x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const px = Math.sqrt(dx*dx + dy*dy);
  const feet = Math.round((px / gridSize) * 5);
  const ang = Math.atan2(dy, dx) * 180 / Math.PI;
  $('ruler').innerHTML =
    `<div class="ruler-line" style="left:${x1}px;top:${y1}px;width:${px}px;transform:rotate(${ang}deg)"></div>` +
    `<div class="ruler-label" style="left:${(x1+x2)/2}px;top:${(y1+y2)/2}px">${feet} ft</div>` +
    `<div class="ruler-dot" style="left:${x1}px;top:${y1}px"></div>` +
    `<div class="ruler-dot" style="left:${x2}px;top:${y2}px"></div>`;
}

socket.on('players', (players) => {
  const ul = $('player-list'); ul.innerHTML = '';
  players.forEach((p) => {
    const li = document.createElement('li');
    li.innerHTML = `<span class="dot" style="background:${p.color}"></span> ${escapeHtml(p.name)}${p.isGm ? ' <span class="mini-gm">GM</span>' : ''}${p.id === me.id ? ' <span class="you">(you)</span>' : ''}`;
    ul.appendChild(li);
  });
});

/* ============ CHAT + AI DM ============ */
function addChat(m) {
  const log = $('chat-log');
  const div = document.createElement('div');
  div.className = 'msg ' + (m.role || 'player');
  if (m.role === 'system') div.textContent = m.text;
  else div.innerHTML = `<span class="who">${escapeHtml(m.author)}</span>${escapeHtml(m.text)}`;
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
  if (m.role === 'roll') addRollHistory(m);
}
function addRollHistory(m) {
  const box = $('dice-history'); if (!box) return;
  const row = document.createElement('div');
  row.className = 'dh-row';
  row.innerHTML = `<span class="dh-who">${escapeHtml(m.author)}</span> <span class="dh-txt">${escapeHtml((m.text || '').replace(/^rolled /, ''))}</span>`;
  box.prepend(row);
  while (box.children.length > 12) box.lastChild.remove();
}
socket.on('chat', addChat);
socket.on('dm:thinking', (on) => $('dm-typing').classList.toggle('hidden', !on));
$('send-btn').onclick = sendChat;
$('chat-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') sendChat(); });
function sendChat() {
  const text = $('chat-input').value.trim(); if (!text) return;
  socket.emit('chat', { text }); $('chat-input').value = '';
}
$('dm-btn').onclick = () => { socket.emit('dm:ask', { text: $('chat-input').value.trim() }); $('chat-input').value = ''; };

/* ============ DICE ============ */
document.querySelectorAll('.die').forEach((b) => { b.onclick = () => rollFormula(`1d${b.dataset.die}`); });
$('dice-roll').onclick = () => rollFormula($('dice-formula').value.trim() || '1d20');
$('dice-formula').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('dice-roll').click(); });
function rollDie(s) { return Math.floor(Math.random() * s) + 1; }
function rollFormula(formula) {
  const adv = $('adv').checked, dis = $('dis').checked, quickmod = parseInt($('quickmod').value) || 0;
  let detail = [], total = 0;
  const m = formula.match(/^(\d*)d(\d+)([+-]\d+)?$/i);
  if (!m) { showDice('?', 'Invalid formula. Try 2d6+3'); return; }
  let count = parseInt(m[1] || '1'), sides = parseInt(m[2]), bonus = parseInt(m[3] || '0');
  if (sides === 20 && count === 1 && (adv || dis)) {
    const a = rollDie(20), b = rollDie(20), pick = adv ? Math.max(a, b) : Math.min(a, b);
    total = pick + bonus + quickmod; detail.push(`${adv ? 'ADV' : 'DIS'} [${a},${b}]→${pick}`);
  } else {
    const rolls = []; for (let i = 0; i < count; i++) { const r = rollDie(sides); rolls.push(r); total += r; }
    total += bonus + quickmod; detail.push(`[${rolls.join(',')}]`);
  }
  const mods = (bonus || quickmod) ? ` ${fmtMod(bonus + quickmod)}` : '';
  const detailStr = detail.join(' ') + mods;
  showDice(total, detailStr);
  socket.emit('roll', { formula: formula + (quickmod ? fmtMod(quickmod) : ''), result: total, detail: detailStr });
}
function fmtMod(n) { return n >= 0 ? `+${n}` : `${n}`; }
function showDice(total, detail) { $('dice-result').innerHTML = `<div class="big">${total}</div><div>${escapeHtml(detail)}</div>`; }

/* ============ CHARACTER SHEET ============ */
const sheetFields = ['sh-name','sh-class','sh-level','sh-race','sh-ac','sh-hp','sh-maxhp','ab-str','ab-dex','ab-con','ab-int','ab-wis','ab-cha','sh-notes'];
sheetFields.forEach((f) => $(f).addEventListener('input', () => { updateMods(); saveSheet(); }));
const abil = { str:1, dex:1, con:1, int:1, wis:1, cha:1 };
function mod(score) { return Math.floor((parseInt(score || 10) - 10) / 2); }
function updateMods() { Object.keys(abil).forEach((k) => { $(`m-${k}`).textContent = fmtMod(mod($(`ab-${k}`).value)); }); }
Object.keys(abil).forEach((k) => {
  $(`m-${k}`).onclick = () => { $('quickmod').value = mod($(`ab-${k}`).value); document.querySelector('[data-tab="dice"]').click(); rollFormula('1d20'); };
});
function saveSheet() { const d = {}; sheetFields.forEach((f) => d[f] = $(f).value); localStorage.setItem('dnd-sheet-' + me.room, JSON.stringify(d)); }
function loadSheet() {
  const raw = localStorage.getItem('dnd-sheet-' + me.room);
  if (raw) { try { const d = JSON.parse(raw); sheetFields.forEach((f) => { if (d[f] != null) $(f).value = d[f]; }); } catch {} }
  if (!$('sh-name').value) $('sh-name').value = me.name;
  updateMods();
}

/* Quick-roll helpers driven from the sheet */
function profBonus() { return 2 + Math.floor((parseInt($('sh-level').value || 1) - 1) / 4); }
function quickRoll(m) { $('quickmod').value = m; document.querySelector('[data-tab="dice"]').click(); rollFormula('1d20'); }
$('roll-attack').onclick = () => quickRoll(Math.max(mod($('ab-str').value), mod($('ab-dex').value)) + profBonus());
$('roll-init').onclick = () => quickRoll(mod($('ab-dex').value));
$('add-me-init').onclick = () => {
  const init = rollDie(20) + mod($('ab-dex').value);
  socket.emit('init:add', { name: $('sh-name').value.trim() || me.name, init });
  document.querySelector('[data-tab="combat"]').click();
};

/* ============ MONSTER QUICK-ADD ============ */
const MONSTERS = [
  { n: 'Goblin', hp: 7, e: '👹' }, { n: 'Orc', hp: 15, e: '👹' },
  { n: 'Kobold', hp: 5, e: '🦎' }, { n: 'Skeleton', hp: 13, e: '💀' },
  { n: 'Zombie', hp: 22, e: '🧟' }, { n: 'Bandit', hp: 11, e: '🗡️' },
  { n: 'Guard', hp: 11, e: '🛡️' }, { n: 'Cultist', hp: 9, e: '🕯️' },
  { n: 'Wolf', hp: 11, e: '🐺' }, { n: 'Dire Wolf', hp: 37, e: '🐺', size: 2 },
  { n: 'Giant Spider', hp: 26, e: '🕷️', size: 2 }, { n: 'Ogre', hp: 59, e: '👹', size: 2 },
  { n: 'Troll', hp: 84, e: '🧌', size: 2 }, { n: 'Wyrmling', hp: 33, e: '🐉', size: 2 },
  { n: 'Young Dragon', hp: 178, e: '🐉', size: 3 }, { n: 'Ghost', hp: 45, e: '👻' },
];
function buildMonsters() {
  const g = $('mon-grid'); if (!g) return;
  MONSTERS.forEach((m) => {
    const b = document.createElement('button');
    b.className = 'mon-btn';
    b.innerHTML = `<span class="me">${m.e}</span><span class="mn">${m.n}</span><em>${m.hp} hp</em>`;
    b.onclick = () => spawnMonster(m);
    g.appendChild(b);
  });
}
function spawnMonster(m) {
  socket.emit('token:add', {
    x: gridSize * (2 + Math.floor(Math.random() * 6)),
    y: gridSize * (1 + Math.floor(Math.random() * 3)),
    color: '#7a2318', label: m.n, size: m.size || 1,
    statuses: [], emoji: m.e, hp: m.hp, maxhp: m.hp,
  });
}
buildMonsters();

/* ============ TABS ============ */
document.querySelectorAll('.tab').forEach((t) => {
  t.onclick = () => {
    document.querySelectorAll('.tab').forEach((x) => x.classList.remove('active'));
    document.querySelectorAll('.tabpane').forEach((x) => x.classList.remove('active'));
    t.classList.add('active'); $('tab-' + t.dataset.tab).classList.add('active');
  };
});

/* ============ MAP ============ */
$('map-btn').onclick = () => $('map-modal').classList.remove('hidden');
$('map-close').onclick = () => $('map-modal').classList.add('hidden');
$('map-modal').addEventListener('click', (e) => { if (e.target.id === 'map-modal') e.currentTarget.classList.add('hidden'); });
$('map-upload').onclick = () => $('map-file').click();
document.querySelectorAll('.map-opt').forEach((b) => {
  b.onclick = () => { const m = b.dataset.map || null; socket.emit('map:set', m); setMap(m); $('map-modal').classList.add('hidden'); };
});
$('map-file').onchange = (e) => {
  const file = e.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = () => { socket.emit('map:set', reader.result); setMap(reader.result); $('map-modal').classList.add('hidden'); };
  reader.readAsDataURL(file); e.target.value = '';
};
function setMap(src) {
  const stage = $('stage');
  if (!src) { stage.style.backgroundImage = 'none'; $('board').classList.remove('has-map'); return; }
  stage.style.backgroundImage = `url(${src})`;
  stage.style.backgroundSize = 'cover';
  $('board').classList.add('has-map');
}
socket.on('map:set', setMap);
function applyGrid(size) { $('grid').style.backgroundSize = `${size}px ${size}px`; renderFog(); }
socket.on('grid:set', (s) => { gridSize = s; applyGrid(s); renderWalls(); refreshLighting(); });

/* ============ ZOOM & PAN ============ */
function applyZoom() {
  $('stage').style.transform = `scale(${zoom})`;
  $('board').style.width = (BOARD_W * zoom) + 'px';
  $('board').style.height = (BOARD_H * zoom) + 'px';
  $('zoom-label').textContent = Math.round(zoom * 100) + '%';
}
function setZoom(z, cx, cy) {
  const wrap = $('board-wrap');
  const oldZoom = zoom;
  zoom = Math.min(2.5, Math.max(0.35, z));
  if (cx != null) {
    const bx = (wrap.scrollLeft + cx) / oldZoom, by = (wrap.scrollTop + cy) / oldZoom;
    applyZoom();
    wrap.scrollLeft = bx * zoom - cx; wrap.scrollTop = by * zoom - cy;
  } else applyZoom();
}
$('zoom-in').onclick = () => setZoom(zoom + 0.15);
$('zoom-out').onclick = () => setZoom(zoom - 0.15);
$('board-wrap').addEventListener('wheel', (e) => {
  if (!e.ctrlKey && !e.metaKey && !e.shiftKey) return; // hold Ctrl/Cmd/Shift to zoom, otherwise scroll
  e.preventDefault();
  const r = $('board-wrap').getBoundingClientRect();
  setZoom(zoom + (e.deltaY < 0 ? 0.12 : -0.12), e.clientX - r.left, e.clientY - r.top);
}, { passive: false });

function boardCoords(e) {
  const r = $('stage').getBoundingClientRect();
  return { x: (e.clientX - r.left) / zoom, y: (e.clientY - r.top) / zoom };
}

let panning = false, panStart = null;
$('board-wrap').addEventListener('mousedown', (e) => {
  if (e.target.closest('.token')) return;
  if (e.altKey) { const c = boardCoords(e); socket.emit('ping', c); showPing(c.x, c.y, me.color); return; }
  if (aoeMode) { aoeStart = boardCoords(e); e.preventDefault(); return; }
  if (rulerMode) { rulerStart = boardCoords(e); e.preventDefault(); return; }
  if (fogMode && me.isGm) { paintFog(e); return; }
  panning = true; panStart = { x: e.clientX, y: e.clientY, sl: $('board-wrap').scrollLeft, st: $('board-wrap').scrollTop };
});
window.addEventListener('mousemove', (e) => {
  if (panning) { $('board-wrap').scrollLeft = panStart.sl - (e.clientX - panStart.x); $('board-wrap').scrollTop = panStart.st - (e.clientY - panStart.y); }
  else if (rulerStart) { const c = boardCoords(e); drawRuler(rulerStart.x, rulerStart.y, c.x, c.y); }
  else if (aoeStart) { renderAoes(previewFrom(e)); }
  else if (fogPainting && me.isGm) paintFog(e);
});
window.addEventListener('mouseup', (e) => {
  if (aoeStart) { finalizeAoe(e); aoeStart = null; }
  panning = false; fogPainting = false; rulerStart = null;
});

/* ============ PINGS ============ */
socket.on('ping', ({ x, y, color }) => showPing(x, y, color));
function showPing(x, y, color) {
  const el = document.createElement('div');
  el.className = 'ping'; el.style.left = x + 'px'; el.style.top = y + 'px';
  el.style.borderColor = color || '#d9b154';
  $('pings').appendChild(el);
  setTimeout(() => el.remove(), 2200);
}

/* ============ TOKENS ============ */
$('addtoken-btn').onclick = () => {
  socket.emit('token:add', { x: 140 * Math.ceil(Math.random()*4), y: 140, color: me.color, label: initials(me.name), size: 1, statuses: [] });
};
socket.on('token:add', (t) => { renderToken(t); refreshLighting(); });
socket.on('token:update', (t) => { if (tokenEls[t.id]) { tokenEls[t.id]._token = t; styleToken(tokenEls[t.id], t); refreshLighting(); } });
socket.on('token:move', ({ id, x, y }) => {
  const el = tokenEls[id]; if (!el) return;
  el.style.left = x + 'px'; el.style.top = y + 'px'; el._token.x = x; el._token.y = y;
  refreshLighting();
});
socket.on('token:remove', (id) => { if (tokenEls[id]) { tokenEls[id].remove(); delete tokenEls[id]; refreshLighting(); } });

function renderToken(t) {
  let el = tokenEls[t.id];
  if (!el) {
    el = document.createElement('div'); el.className = 'token';
    el.innerHTML = `<span class="lbl"></span><div class="hpbar"><i></i></div><div class="statuses"></div>`;
    $('tokens').appendChild(el); tokenEls[t.id] = el; makeDraggable(el);
  }
  el._token = t;
  el.style.left = t.x + 'px'; el.style.top = t.y + 'px';
  styleToken(el, t);
}
function styleToken(el, t) {
  const s = (t.size || 1) * 64;
  el.style.width = s + 'px'; el.style.height = s + 'px';
  const lbl = el.querySelector('.lbl');
  if (t.img) { el.style.background = `center/cover url(${t.img})`; lbl.textContent = ''; lbl.className = 'lbl'; }
  else { el.style.background = t.color; if (t.emoji) { lbl.textContent = t.emoji; lbl.className = 'lbl emoji'; } else { lbl.textContent = t.label || ''; lbl.className = 'lbl'; } }
  el.classList.toggle('mine', t.ownerId === me.id);
  const bar = el.querySelector('.hpbar'), fill = bar.querySelector('i');
  if (t.maxhp && Number(t.maxhp) > 0) {
    bar.style.display = 'block';
    const pct = Math.max(0, Math.min(100, (Number(t.hp) / Number(t.maxhp)) * 100));
    fill.style.width = pct + '%';
    fill.style.background = pct > 50 ? '#5fae54' : pct > 25 ? '#d9a434' : '#c0392b';
  } else bar.style.display = 'none';
  el.querySelector('.statuses').innerHTML = (t.statuses || []).map((x) => `<span>${x}</span>`).join('');
}

function makeDraggable(el) {
  let dragging = false, grabX = 0, grabY = 0;
  el.addEventListener('mousedown', (e) => {
    if (e.altKey || fogMode) return;
    dragging = true; const c = boardCoords(e); grabX = c.x - el._token.x; grabY = c.y - el._token.y;
    e.preventDefault(); e.stopPropagation();
  });
  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const c = boardCoords(e); const x = c.x - grabX, y = c.y - grabY;
    el.style.left = x + 'px'; el.style.top = y + 'px'; el._token.x = x; el._token.y = y;
    socket.emit('token:move', { id: el._token.id, x, y });
    refreshLighting();
  });
  window.addEventListener('mouseup', () => {
    if (!dragging) return; dragging = false;
    const sx = Math.round(el._token.x / gridSize) * gridSize, sy = Math.round(el._token.y / gridSize) * gridSize;
    el.style.left = sx + 'px'; el.style.top = sy + 'px'; el._token.x = sx; el._token.y = sy;
    socket.emit('token:move', { id: el._token.id, x: sx, y: sy });
  });
  el.addEventListener('dblclick', (e) => { e.stopPropagation(); openTokenModal(el._token); });
}

/* Token modal */
let editingToken = null, editStatuses = [], editEmoji = '', editImg = null;
function openTokenModal(t) {
  editingToken = t; editStatuses = [...(t.statuses || [])];
  editEmoji = t.emoji || ''; editImg = t.img || null;
  $('tk-label').value = t.label || ''; $('tk-color').value = t.color || '#c0392b';
  $('tk-size').value = t.size || 1;
  $('tk-hp').value = t.hp ?? ''; $('tk-maxhp').value = t.maxhp ?? '';
  $('tk-vision').value = t.vision ?? ''; $('tk-light').value = t.light ?? '';
  document.querySelectorAll('.status-opt').forEach((b) => b.classList.toggle('on', editStatuses.includes(b.dataset.s)));
  document.querySelectorAll('.art-opt[data-e]').forEach((b) => b.classList.toggle('on', !editImg && b.dataset.e === editEmoji));
  document.querySelectorAll('.img-opt').forEach((b) => b.classList.toggle('on', editImg === b.dataset.img));
  $('token-modal').classList.remove('hidden');
}
// Image token gallery: pick a built-in portrait
document.querySelectorAll('.img-opt').forEach((b) => {
  b.onclick = () => {
    editImg = b.dataset.img; editEmoji = '';
    document.querySelectorAll('.img-opt').forEach((x) => x.classList.toggle('on', x === b));
    document.querySelectorAll('.art-opt[data-e]').forEach((x) => x.classList.remove('on'));
  };
});
// Art palette: pick an emoji preset (clears custom image)
document.querySelectorAll('.art-opt[data-e]').forEach((b) => {
  b.onclick = () => {
    editEmoji = b.dataset.e; editImg = null;
    document.querySelectorAll('.art-opt[data-e]').forEach((x) => x.classList.toggle('on', x === b));
    document.querySelectorAll('.img-opt').forEach((x) => x.classList.remove('on'));
  };
});
// Upload custom token image
$('tk-upload').onclick = () => $('tk-img-file').click();
$('tk-img-file').onchange = (e) => {
  const file = e.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = () => { editImg = reader.result; editEmoji = ''; document.querySelectorAll('.art-opt[data-e]').forEach((x) => x.classList.remove('on')); };
  reader.readAsDataURL(file);
};
document.querySelectorAll('.status-opt').forEach((b) => {
  b.onclick = () => {
    const s = b.dataset.s;
    if (editStatuses.includes(s)) editStatuses = editStatuses.filter((x) => x !== s);
    else editStatuses.push(s);
    b.classList.toggle('on');
  };
});
$('tk-save').onclick = () => {
  if (!editingToken) return;
  socket.emit('token:update', {
    id: editingToken.id, label: $('tk-label').value, color: $('tk-color').value,
    size: parseInt($('tk-size').value),
    hp: $('tk-hp').value === '' ? null : Number($('tk-hp').value),
    maxhp: $('tk-maxhp').value === '' ? null : Number($('tk-maxhp').value),
    vision: $('tk-vision').value === '' ? null : Number($('tk-vision').value),
    light: $('tk-light').value === '' ? null : Number($('tk-light').value),
    statuses: editStatuses, emoji: editEmoji, img: editImg,
  });
  $('token-modal').classList.add('hidden');
};
$('tk-delete').onclick = () => { if (editingToken) socket.emit('token:remove', editingToken.id); $('token-modal').classList.add('hidden'); };
$('token-modal').addEventListener('click', (e) => { if (e.target.id === 'token-modal') e.currentTarget.classList.add('hidden'); });

/* ============ INITIATIVE ============ */
$('init-add-btn').onclick = () => {
  const name = $('init-name').value.trim(); if (!name) return;
  socket.emit('init:add', { name, init: $('init-roll').value });
  $('init-name').value = ''; $('init-roll').value = '';
};
$('init-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('init-add-btn').click(); });
$('init-sort').onclick = () => socket.emit('init:sort');
$('init-next').onclick = () => socket.emit('init:turn', 'next');
$('init-prev').onclick = () => socket.emit('init:turn', 'prev');
$('init-clear').onclick = () => socket.emit('init:clear');
let combat = { list: [], turnIndex: 0, round: 1, turnStart: Date.now(), _key: '' };
socket.on('init:state', ({ list, turnIndex, round }) => renderInit(list, turnIndex, round));
function renderInit(list, turnIndex, round) {
  const ol = $('init-list'); ol.innerHTML = '';
  list.forEach((e, i) => {
    const li = document.createElement('li');
    li.className = i === turnIndex ? 'active' : '';
    li.innerHTML = `<span class="ini">${e.init}</span> <span class="nm">${escapeHtml(e.name)}</span> <button class="ini-x" title="Remove">✕</button>`;
    li.querySelector('.ini-x').onclick = () => socket.emit('init:remove', e.id);
    ol.appendChild(li);
  });
  const key = (round || 1) + ':' + turnIndex;
  if (key !== combat._key) { combat.turnStart = Date.now(); combat._key = key; }
  combat.list = list; combat.turnIndex = turnIndex; combat.round = round || 1;
  updateTurnBanner();
}
function updateTurnBanner() {
  const banner = $('turn-banner');
  if (combat.list.length) {
    const s = Math.floor((Date.now() - combat.turnStart) / 1000);
    const mm = Math.floor(s / 60), ss = String(s % 60).padStart(2, '0');
    banner.textContent = `⚔️ Round ${combat.round} · ${combat.list[combat.turnIndex].name} · ${mm}:${ss}`;
    banner.classList.remove('hidden');
  } else banner.classList.add('hidden');
}
setInterval(() => { if (combat.list.length) updateTurnBanner(); }, 1000);

/* ============ FOG OF WAR ============ */
$('fog-btn').onclick = () => {
  const hidden = $('fog-bar').classList.toggle('hidden');
  fogMode = !hidden;
  $('fog-btn').classList.toggle('on', fogMode);
  $('board').classList.toggle('fog-painting', fogMode);
  if (fogMode && !fog.active) socket.emit('fog:active', true);
};
function setPaintTarget(t) {
  paintTarget = t;
  fogPaintHide = (t === 'hide');
  [['hide','fog-paint-hide'],['reveal','fog-paint-reveal'],['wall','fog-paint-wall']]
    .forEach(([k, id]) => $(id).classList.toggle('active', paintTarget === k));
}
$('fog-paint-hide').onclick = () => setPaintTarget('hide');
$('fog-paint-reveal').onclick = () => setPaintTarget('reveal');
$('fog-paint-wall').onclick = () => setPaintTarget('wall');
$('fog-cover-all').onclick = () => socket.emit('fog:all', true);
$('fog-clear-all').onclick = () => socket.emit('fog:all', false);
$('wall-clear').onclick = () => socket.emit('wall:clear');
$('light-toggle').onclick = () => socket.emit('light:active', !lighting);

function paintFog(e) {
  fogPainting = true;
  const c = boardCoords(e);
  const cx = Math.floor(c.x / gridSize), cy = Math.floor(c.y / gridSize);
  if (cx < 0 || cy < 0) return;
  const key = `${cx},${cy}`;
  if (paintTarget === 'wall') {
    if (walls[key]) return;
    walls[key] = true;
    socket.emit('wall:cell', { key, on: true });
    renderWalls(); refreshLighting();
    return;
  }
  const wantHidden = (paintTarget === 'hide');
  if (!!fog.hidden[key] === wantHidden) return;
  if (wantHidden) fog.hidden[key] = true; else delete fog.hidden[key];
  socket.emit('fog:cell', { key, hidden: wantHidden });
  renderFog();
}

/* ============ DYNAMIC LIGHTING ============ */
socket.on('light:state', ({ lighting: on, walls: w }) => {
  lighting = !!on; walls = w || {};
  $('light-toggle').textContent = `💡 Lighting: ${lighting ? 'On' : 'Off'}`;
  $('light-toggle').classList.toggle('active', lighting);
  renderWalls(); refreshLighting();
});
socket.on('wall:cell', ({ key, on }) => {
  if (on) walls[key] = true; else delete walls[key];
  renderWalls(); refreshLighting();
});

function renderWalls() {
  const layer = $('walls'); if (!layer) return;
  layer.innerHTML = '';
  // Walls are a GM building aid — only the GM sees the blocks.
  if (!me.isGm) return;
  for (const key in walls) {
    const [cx, cy] = key.split(',').map(Number);
    const cell = document.createElement('div');
    cell.className = 'wall-cell';
    cell.style.left = cx * gridSize + 'px'; cell.style.top = cy * gridSize + 'px';
    cell.style.width = gridSize + 'px'; cell.style.height = gridSize + 'px';
    layer.appendChild(cell);
  }
}

// Grid raycast: is there a clear line of sight from (x0,y0) to (x1,y1)?
function hasSight(x0, y0, x1, y1) {
  let dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
  let sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx - dy, x = x0, y = y0;
  while (true) {
    if (!(x === x0 && y === y0) && !(x === x1 && y === y1)) {
      if (walls[`${x},${y}`]) return false; // a wall between blocks sight
    }
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x += sx; }
    if (e2 < dx) { err += dx; y += sy; }
  }
  return true;
}

function computeVision() {
  const lit = new Set();
  const R = VISION_RADIUS;
  Object.values(tokenEls).forEach((el) => {
    const t = el._token; if (!t) return;
    const tcx = Math.floor((t.x + (t.size || 1) * 32) / gridSize);
    const tcy = Math.floor((t.y + (t.size || 1) * 32) / gridSize);
    // per-token: use the larger of its sight range and the light it emits
    const r = Math.max(Number(t.vision) || R, Number(t.light) || 0);
    for (let cx = tcx - r; cx <= tcx + r; cx++) {
      for (let cy = tcy - r; cy <= tcy + r; cy++) {
        if (cx < 0 || cy < 0) continue;
        const dist = Math.max(Math.abs(cx - tcx), Math.abs(cy - tcy));
        if (dist > r) continue;
        if (hasSight(tcx, tcy, cx, cy)) lit.add(`${cx},${cy}`);
      }
    }
  });
  return lit;
}

let lightingRAF = null;
function refreshLighting() {
  if (lightingRAF) return;
  lightingRAF = requestAnimationFrame(() => { lightingRAF = null; doLighting(); });
}
function doLighting() {
  const dark = $('dark'); if (!dark) return;
  dark.innerHTML = '';
  $('board').classList.toggle('lit', lighting);
  // GM sees everything; darkness only applies to players.
  if (!lighting || me.isGm) {
    Object.values(tokenEls).forEach((el) => { el.style.visibility = 'visible'; });
    return;
  }
  const lit = computeVision();
  const cols = Math.ceil(BOARD_W / gridSize), rows = Math.ceil(BOARD_H / gridSize);
  for (let cx = 0; cx < cols; cx++) {
    for (let cy = 0; cy < rows; cy++) {
      if (lit.has(`${cx},${cy}`)) continue;
      const cell = document.createElement('div');
      cell.className = 'dark-cell';
      cell.style.left = cx * gridSize + 'px'; cell.style.top = cy * gridSize + 'px';
      cell.style.width = gridSize + 'px'; cell.style.height = gridSize + 'px';
      dark.appendChild(cell);
    }
  }
  // Hide tokens that stand in darkness (outside the party's line of sight).
  Object.values(tokenEls).forEach((el) => {
    const t = el._token; if (!t) return;
    const cx = Math.floor((t.x + (t.size || 1) * 32) / gridSize);
    const cy = Math.floor((t.y + (t.size || 1) * 32) / gridSize);
    el.style.visibility = lit.has(`${cx},${cy}`) ? 'visible' : 'hidden';
  });
}
socket.on('fog:state', (f) => { fog = f; renderFog(); });
socket.on('fog:cell', ({ key, hidden }) => { if (hidden) fog.hidden[key] = true; else delete fog.hidden[key]; renderFog(); });

function renderFog() {
  const layer = $('fog'); layer.innerHTML = '';
  $('board').classList.toggle('fog-on', fog.active);
  if (!fog.active) return;
  for (const key in fog.hidden) {
    const [cx, cy] = key.split(',').map(Number);
    const cell = document.createElement('div');
    cell.className = 'fog-cell';
    cell.style.left = cx * gridSize + 'px'; cell.style.top = cy * gridSize + 'px';
    cell.style.width = gridSize + 'px'; cell.style.height = gridSize + 'px';
    layer.appendChild(cell);
  }
}

/* ============ FULL CHARACTER SHEET ============ */
const CS_ABIL = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
const CS_ABILN = { str: 'STR', dex: 'DEX', con: 'CON', int: 'INT', wis: 'WIS', cha: 'CHA' };
const CS_SKILLS = [['Acrobatics','dex'],['Animal Handling','wis'],['Arcana','int'],['Athletics','str'],['Deception','cha'],['History','int'],['Insight','wis'],['Intimidation','cha'],['Investigation','int'],['Medicine','wis'],['Nature','int'],['Perception','wis'],['Performance','cha'],['Persuasion','cha'],['Religion','int'],['Sleight of Hand','dex'],['Stealth','dex'],['Survival','wis']];
const CS_CONDS = ['Blinded','Charmed','Deafened','Frightened','Grappled','Incapacitated','Invisible','Paralyzed','Petrified','Poisoned','Prone','Restrained','Stunned','Unconscious'];
const CS_NUMF = ['level','ac','speed','hp','maxhp','temphp'];

function csDefault() {
  return { name:'', pronouns:'', race:'', cls:'', level:1, background:'', inspiration:false,
    ac:10, speed:30, hp:10, maxhp:10, temphp:0,
    scores:{str:10,dex:10,con:10,int:10,wis:10,cha:10},
    saves:{}, skills:{}, attacks:[], conditions:[], notes:'',
    resistances:'', senses:'', proficiencies:'', spells:'', inventory:'', features:'' };
}
let cs = csDefault(), csBuilt = false;
const csKey = () => 'dnd-cs-' + me.room;
function loadCS() {
  cs = csDefault();
  const raw = localStorage.getItem(csKey());
  if (raw) { try { const d = JSON.parse(raw); Object.assign(cs, d); cs.scores = Object.assign(cs.scores, d.scores || {}); } catch {} }
  else if ($('sh-name') && $('sh-name').value) { // migrate quick sheet
    cs.name = $('sh-name').value; cs.cls = $('sh-class').value; cs.level = Number($('sh-level').value) || 1;
    cs.race = $('sh-race').value; cs.ac = Number($('sh-ac').value) || 10;
    cs.hp = Number($('sh-hp').value) || 10; cs.maxhp = Number($('sh-maxhp').value) || 10;
    CS_ABIL.forEach((a) => cs.scores[a] = Number($('ab-' + a).value) || 10);
  }
  if (csBuilt) { csPopulate(); csRecompute(); csRenderAttacks(); }
}
function saveCS() { try { localStorage.setItem(csKey(), JSON.stringify(cs)); } catch {} }
function csMod(s) { return Math.floor((Number(s || 10) - 10) / 2); }
function csProf() { return 2 + Math.floor((Number(cs.level || 1) - 1) / 4); }
function csFmt(n) { return n >= 0 ? '+' + n : '' + n; }

$('open-cs').onclick = () => { if (!csBuilt) buildCS(); csPopulate(); csRecompute(); csRenderAttacks(); $('cs-modal').classList.remove('hidden'); };
$('cs-close').onclick = () => $('cs-modal').classList.add('hidden');
$('cs-modal').addEventListener('click', (e) => { if (e.target.id === 'cs-modal') $('cs-modal').classList.add('hidden'); });

function buildCS() {
  const h = [];
  h.push(`<div class="cs-header">
    <div class="cs-lvlbadge"><span data-lvlnum>1</span></div>
    <div class="cs-idblock">
      <input class="cs-name" data-cs="name" placeholder="Character name" />
      <div class="cs-idrow">
        <input data-cs="pronouns" placeholder="Pronouns" />
        <input data-cs="race" placeholder="Race / Ancestry" />
        <input data-cs="cls" placeholder="Class" />
        <label class="cs-lvlin">Lvl <input data-cs="level" type="number" min="1" max="20" /></label>
        <input data-cs="background" placeholder="Background" />
      </div>
    </div>
    <div class="cs-headstats">
      <button class="cs-insp" data-insp>✨ Inspiration</button>
      <div class="cs-badge">PROF <b data-prof>+2</b></div>
      <button class="cs-badge cs-roll" data-roll="init">INIT <b data-init>+0</b></button>
      <div class="cs-badge">PASS. PERC <b data-passive>10</b></div>
    </div>
  </div>`);
  h.push(`<div class="cs-topline">
    <div class="cs-hpblock">
      <div class="cs-hp-main">
        <label>HP <input data-cs="hp" type="number" /></label><span>/</span>
        <label>Max <input data-cs="maxhp" type="number" /></label>
        <label>Temp <input data-cs="temphp" type="number" /></label>
      </div>
      <div class="cs-hp-apply">
        <input id="cs-hp-amt" type="number" placeholder="0" />
        <button data-hp="dmg" class="cs-dmg">Damage</button>
        <button data-hp="heal" class="cs-heal">Heal</button>
      </div>
    </div>
    <div class="cs-acspeed">
      <div class="cs-badge big">AC <b><input data-cs="ac" type="number" /></b></div>
      <div class="cs-badge big">SPD <b><input data-cs="speed" type="number" /></b></div>
    </div>
  </div>`);
  const abilCards = CS_ABIL.map((a) => `<div class="cs-abil">
      <div class="cs-abil-name">${CS_ABILN[a]}</div>
      <input class="cs-score" data-score="${a}" type="number" />
      <button class="cs-mod" data-roll="ability:${a}" data-mod="${a}">+0</button>
    </div>`).join('');
  const saveRows = CS_ABIL.map((a) => `<div class="cs-line">
      <input type="checkbox" data-save="${a}" />
      <button class="cs-line-roll" data-roll="save:${a}"><span class="cs-val" data-saveval="${a}">+0</span> ${CS_ABILN[a]}</button>
    </div>`).join('');
  const skillRows = CS_SKILLS.map(([nm, ab]) => `<div class="cs-line">
      <input type="checkbox" data-skill="${nm}" />
      <button class="cs-line-roll" data-roll="skill:${nm}"><span class="cs-val" data-skillval="${nm}">+0</span> ${nm} <em>${CS_ABILN[ab]}</em></button>
    </div>`).join('');
  const condChips = CS_CONDS.map((c) => `<button class="cs-cond" data-cond="${c}">${c}</button>`).join('');
  h.push(`<div class="cs-grid">
    <div class="cs-col">
      <div class="cs-sec"><div class="cs-sec-t">Abilities</div><div class="cs-abils">${abilCards}</div></div>
      <div class="cs-sec"><div class="cs-sec-t">Saving Throws</div>${saveRows}</div>
    </div>
    <div class="cs-col">
      <div class="cs-sec"><div class="cs-sec-t">Skills</div>${skillRows}</div>
    </div>
    <div class="cs-col">
      <div class="cs-sec"><div class="cs-sec-t">Attacks</div>
        <div id="cs-atk-list"></div>
        <div class="cs-atk-add">
          <input id="cs-atk-name" placeholder="Name" />
          <input id="cs-atk-bonus" type="number" placeholder="+hit" />
          <input id="cs-atk-dmg" placeholder="1d8+3" />
          <button id="cs-atk-addbtn">Add</button>
        </div>
      </div>
      <div class="cs-sec"><div class="cs-sec-t">Conditions</div><div class="cs-conds">${condChips}</div></div>
      <div class="cs-sec"><div class="cs-sec-t">Defenses</div><textarea data-cs="resistances" placeholder="Resistances, immunities, vulnerabilities…"></textarea></div>
      <div class="cs-sec"><div class="cs-sec-t">Senses</div>
        <div class="cs-senses">
          <span class="cs-badge">PASS. PERC <b data-passive2>10</b></span>
          <span class="cs-badge">PASS. INVEST <b data-passinv>10</b></span>
          <span class="cs-badge">PASS. INSIGHT <b data-passins>10</b></span>
        </div>
        <textarea data-cs="senses" placeholder="Darkvision 60 ft, blindsight…"></textarea>
      </div>
      <div class="cs-sec"><div class="cs-sec-t">Proficiencies &amp; Languages</div><textarea data-cs="proficiencies" placeholder="Armor, weapons, tools, languages…"></textarea></div>
    </div>
  </div>
  <div class="cs-grid cs-grid3">
    <div class="cs-sec"><div class="cs-sec-t">Spells</div><textarea data-cs="spells" placeholder="Spell slots, prepared spells, cantrips…"></textarea></div>
    <div class="cs-sec"><div class="cs-sec-t">Inventory</div><textarea data-cs="inventory" placeholder="Equipment, coins, consumables…"></textarea></div>
    <div class="cs-sec"><div class="cs-sec-t">Features &amp; Traits</div><textarea data-cs="features" placeholder="Class features, feats, racial traits…"></textarea></div>
  </div>`);
  $('cs-body').innerHTML = h.join('');
  csBuilt = true;
  const body = $('cs-body');
  body.addEventListener('input', csOnChange);
  body.addEventListener('change', csOnChange);
  body.addEventListener('click', csOnClick);
}

function csPopulate() {
  const body = $('cs-body'); if (!body) return;
  body.querySelectorAll('[data-cs]').forEach((el) => { const f = el.dataset.cs; el.value = cs[f] ?? ''; });
  CS_ABIL.forEach((a) => { const el = body.querySelector(`[data-score="${a}"]`); if (el) el.value = cs.scores[a]; });
  body.querySelectorAll('[data-save]').forEach((el) => el.checked = !!cs.saves[el.dataset.save]);
  body.querySelectorAll('[data-skill]').forEach((el) => el.checked = !!cs.skills[el.dataset.skill]);
  body.querySelectorAll('[data-cond]').forEach((el) => el.classList.toggle('on', cs.conditions.includes(el.dataset.cond)));
  const insp = body.querySelector('[data-insp]'); if (insp) insp.classList.toggle('on', !!cs.inspiration);
}

function csOnChange(e) {
  const el = e.target;
  if (el.dataset.cs !== undefined) { const f = el.dataset.cs; cs[f] = CS_NUMF.includes(f) ? Number(el.value) || 0 : el.value; }
  else if (el.dataset.score !== undefined) cs.scores[el.dataset.score] = Number(el.value) || 0;
  else if (el.dataset.save !== undefined) cs.saves[el.dataset.save] = el.checked;
  else if (el.dataset.skill !== undefined) cs.skills[el.dataset.skill] = el.checked;
  else return;
  csRecompute(); saveCS();
}

function csOnClick(e) {
  const rollEl = e.target.closest('[data-roll]');
  if (rollEl) { csRoll(rollEl.dataset.roll); return; }
  const insp = e.target.closest('[data-insp]');
  if (insp) { cs.inspiration = !cs.inspiration; insp.classList.toggle('on', cs.inspiration); saveCS(); return; }
  const cond = e.target.closest('[data-cond]');
  if (cond) { const c = cond.dataset.cond; if (cs.conditions.includes(c)) cs.conditions = cs.conditions.filter((x) => x !== c); else cs.conditions.push(c); cond.classList.toggle('on'); saveCS(); return; }
  const hp = e.target.closest('[data-hp]');
  if (hp) {
    const amt = Math.abs(Number($('cs-hp-amt').value) || 0);
    if (hp.dataset.hp === 'heal') cs.hp = Math.min(Number(cs.maxhp || 0), Number(cs.hp || 0) + amt);
    else { let rem = amt; const t = Number(cs.temphp || 0); const used = Math.min(t, rem); cs.temphp = t - used; rem -= used; cs.hp = Math.max(0, Number(cs.hp || 0) - rem); }
    csPopulate(); saveCS(); return;
  }
  const rm = e.target.closest('[data-atk-rm]');
  if (rm) { cs.attacks.splice(Number(rm.dataset.atkRm), 1); csRenderAttacks(); saveCS(); return; }
  if (e.target.id === 'cs-atk-addbtn') {
    const nm = $('cs-atk-name').value.trim(); if (!nm) return;
    cs.attacks.push({ name: nm, bonus: Number($('cs-atk-bonus').value) || 0, dmg: $('cs-atk-dmg').value.trim() });
    $('cs-atk-name').value = ''; $('cs-atk-bonus').value = ''; $('cs-atk-dmg').value = '';
    csRenderAttacks(); saveCS(); return;
  }
}

function csRecompute() {
  const body = $('cs-body'); if (!body) return;
  const prof = csProf();
  body.querySelectorAll('[data-prof]').forEach((e) => e.textContent = csFmt(prof));
  body.querySelectorAll('[data-lvlnum]').forEach((e) => e.textContent = cs.level || 1);
  CS_ABIL.forEach((a) => {
    const m = csMod(cs.scores[a]);
    const me_ = body.querySelector(`[data-mod="${a}"]`); if (me_) me_.textContent = csFmt(m);
    const sv = body.querySelector(`[data-saveval="${a}"]`); if (sv) sv.textContent = csFmt(m + (cs.saves[a] ? prof : 0));
  });
  CS_SKILLS.forEach(([nm, ab]) => {
    const v = csMod(cs.scores[ab]) + (cs.skills[nm] ? prof : 0);
    const el = body.querySelector(`[data-skillval="${nm}"]`); if (el) el.textContent = csFmt(v);
  });
  const init = body.querySelector('[data-init]'); if (init) init.textContent = csFmt(csMod(cs.scores.dex));
  const per = 10 + csMod(cs.scores.wis) + (cs.skills['Perception'] ? prof : 0);
  const pass = body.querySelector('[data-passive]'); if (pass) pass.textContent = per;
  const pass2 = body.querySelector('[data-passive2]'); if (pass2) pass2.textContent = per;
  const pinv = body.querySelector('[data-passinv]'); if (pinv) pinv.textContent = 10 + csMod(cs.scores.int) + (cs.skills['Investigation'] ? prof : 0);
  const pins = body.querySelector('[data-passins]'); if (pins) pins.textContent = 10 + csMod(cs.scores.wis) + (cs.skills['Insight'] ? prof : 0);
}

function csRenderAttacks() {
  const box = $('cs-atk-list'); if (!box) return;
  box.innerHTML = cs.attacks.map((a, i) => `<div class="cs-atk">
    <button class="cs-line-roll" data-roll="atk:${i}"><b>${csFmt(Number(a.bonus) || 0)}</b> ${escapeHtml(a.name)}</button>
    <span class="cs-atk-dmg-txt">${escapeHtml(a.dmg || '')}</span>
    <button class="cs-atk-rm" data-atk-rm="${i}" title="Remove">✕</button>
  </div>`).join('') || '<div class="cs-empty">No attacks yet.</div>';
}

function csRoll(spec) {
  const [type, key] = spec.split(':');
  const prof = csProf();
  let label = '', mod = 0;
  if (type === 'ability') { label = CS_ABILN[key] + ' check'; mod = csMod(cs.scores[key]); }
  else if (type === 'save') { label = CS_ABILN[key] + ' save'; mod = csMod(cs.scores[key]) + (cs.saves[key] ? prof : 0); }
  else if (type === 'skill') { const ab = Object.fromEntries(CS_SKILLS)[key]; label = key; mod = csMod(cs.scores[ab]) + (cs.skills[key] ? prof : 0); }
  else if (type === 'init') { label = 'Initiative'; mod = csMod(cs.scores.dex); }
  else if (type === 'atk') { const a = cs.attacks[Number(key)]; if (!a) return; label = a.name + ' to hit'; mod = Number(a.bonus) || 0; }
  const r = 1 + Math.floor(Math.random() * 20);
  socket.emit('roll', { formula: (cs.name ? cs.name + ' — ' : '') + label, result: r + mod, detail: `d20[${r}] ${csFmt(mod)}` });
  const btn = $('open-cs'); // subtle flash so the user knows it registered
  if (btn) { btn.classList.add('flash'); setTimeout(() => btn.classList.remove('flash'), 300); }
}

/* ============ WEATHER / ATMOSPHERE ============ */
$('weather-btn').onclick = () => {
  const hidden = $('weather-bar').classList.toggle('hidden');
  $('weather-btn').classList.toggle('on', !hidden);
};
document.querySelectorAll('.wx').forEach((b) => {
  b.onclick = () => {
    document.querySelectorAll('.wx').forEach((x) => x.classList.toggle('active', x === b));
    socket.emit('weather:set', b.dataset.wx);
  };
});
socket.on('weather:set', setWeather);

const WX = (() => {
  const canvas = $('weather-fx');
  const ctx = canvas.getContext('2d');
  const wrap = $('board-wrap');
  let type = 'clear', parts = [], raf = null, W = 0, H = 0;
  function resize() {
    W = canvas.width = wrap.clientWidth; H = canvas.height = wrap.clientHeight;
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
  }
  window.addEventListener('resize', resize);
  // keep the canvas pinned to the visible area as the board scrolls
  wrap.addEventListener('scroll', () => { canvas.style.transform = `translate(${wrap.scrollLeft}px, ${wrap.scrollTop}px)`; });
  function seed(n, make) { parts = []; for (let i = 0; i < n; i++) parts.push(make()); }
  function start(t) {
    type = t; resize();
    canvas.style.transform = `translate(${wrap.scrollLeft}px, ${wrap.scrollTop}px)`;
    if (t === 'rain') seed(220, () => ({ x: Math.random()*W, y: Math.random()*H, l: 8+Math.random()*12, v: 8+Math.random()*6 }));
    else if (t === 'snow') seed(160, () => ({ x: Math.random()*W, y: Math.random()*H, r: 1+Math.random()*2.5, v: 0.6+Math.random()*1.2, d: Math.random()*Math.PI*2 }));
    else if (t === 'embers') seed(120, () => ({ x: Math.random()*W, y: Math.random()*H, r: 1+Math.random()*2, v: 0.5+Math.random()*1.5, d: Math.random()*Math.PI*2 }));
    else if (t === 'fog') seed(14, () => ({ x: Math.random()*W, y: Math.random()*H, r: 120+Math.random()*160, v: 0.2+Math.random()*0.4 }));
    if (!raf) loop();
  }
  function stop() { type = 'clear'; if (raf) cancelAnimationFrame(raf); raf = null; ctx.clearRect(0,0,W,H); }
  function loop() {
    raf = requestAnimationFrame(loop);
    ctx.clearRect(0, 0, W, H);
    if (type === 'rain') {
      ctx.strokeStyle = 'rgba(170,200,230,0.5)'; ctx.lineWidth = 1.3;
      parts.forEach((p) => {
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - 2, p.y + p.l); ctx.stroke();
        p.y += p.v; p.x -= 1; if (p.y > H) { p.y = -10; p.x = Math.random()*W; }
      });
    } else if (type === 'snow') {
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      parts.forEach((p) => {
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 7); ctx.fill();
        p.d += 0.02; p.y += p.v; p.x += Math.sin(p.d) * 0.8; if (p.y > H) { p.y = -6; p.x = Math.random()*W; }
      });
    } else if (type === 'embers') {
      parts.forEach((p) => {
        ctx.fillStyle = `rgba(255,${120 + Math.floor(Math.random()*80)},40,0.8)`;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 7); ctx.fill();
        p.d += 0.05; p.y -= p.v; p.x += Math.sin(p.d) * 0.7; if (p.y < -6) { p.y = H + 6; p.x = Math.random()*W; }
      });
    } else if (type === 'fog') {
      parts.forEach((p) => {
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r);
        g.addColorStop(0, 'rgba(200,205,215,0.14)'); g.addColorStop(1, 'rgba(200,205,215,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 7); ctx.fill();
        p.x += p.v; if (p.x - p.r > W) p.x = -p.r;
      });
    }
  }
  return { start, stop };
})();
function setWeather(t) {
  document.querySelectorAll('.wx').forEach((x) => x.classList.toggle('active', x.dataset.wx === t));
  if (!t || t === 'clear') WX.stop(); else WX.start(t);
}

/* ============ SHARED HANDOUT / IMAGE BOARD ============ */
$('handout-btn').onclick = () => $('handout-file').click();
$('handout-file').onchange = (e) => {
  const file = e.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = () => socket.emit('handout:show', reader.result);
  reader.readAsDataURL(file); e.target.value = '';
};
function showHandout(src) {
  $('handout-img').src = src;
  $('handout-remove').classList.toggle('hidden', !me.isGm);
  $('handout-modal').classList.remove('hidden');
}
function hideHandout() { $('handout-modal').classList.add('hidden'); }
socket.on('handout:show', showHandout);
socket.on('handout:clear', () => { hideHandout(); $('handout-img').src = ''; });
$('handout-close').onclick = hideHandout;                        // dismiss on my screen only
$('handout-remove').onclick = () => socket.emit('handout:clear'); // GM removes for everyone
$('handout-modal').addEventListener('click', (e) => { if (e.target.id === 'handout-modal') hideHandout(); });

/* ============ SPELL / AoE TEMPLATES ============ */
$('aoe-btn').onclick = () => {
  const hidden = $('aoe-bar').classList.toggle('hidden');
  aoeMode = !hidden;
  $('aoe-btn').classList.toggle('on', aoeMode);
  if (aoeMode) { // turn off conflicting modes
    rulerMode = false; $('ruler-btn').classList.remove('on'); $('board').classList.remove('ruler-on');
  }
};
[['circle','aoe-circle'],['cone','aoe-cone'],['line','aoe-line']].forEach(([shape, id]) => {
  $(id).onclick = () => {
    aoeShape = shape;
    ['aoe-circle','aoe-cone','aoe-line'].forEach((x) => $(x).classList.toggle('active', x === id));
  };
});
$('aoe-clear').onclick = () => socket.emit('aoe:clear');

const aoeSizeFt = () => Math.max(5, parseInt($('aoe-size').value) || 20);
const ft2px = (ft) => (ft / 5) * gridSize;

function previewFrom(e) {
  const c = boardCoords(e);
  if (aoeShape === 'circle') return { type: 'circle', x: aoeStart.x, y: aoeStart.y, size: aoeSizeFt(), color: me.color };
  return { type: aoeShape, x: aoeStart.x, y: aoeStart.y, x2: c.x, y2: c.y, size: aoeSizeFt(), color: me.color };
}
function finalizeAoe(e) {
  const t = previewFrom(e);
  if (t.type !== 'circle') {
    const d = Math.hypot(t.x2 - t.x, t.y2 - t.y);
    if (d < 8) return; // ignore accidental clicks with no drag
  }
  socket.emit('aoe:add', t);
}

socket.on('aoe:add', (a) => { aoes.push(a); renderAoes(); });
socket.on('aoe:remove', (id) => { aoes = aoes.filter((a) => a.id !== id); renderAoes(); });
socket.on('aoe:clear', () => { aoes = []; renderAoes(); });

function aoeSvg(a) {
  const col = a.color || '#d9b154';
  const common = `fill="${col}" fill-opacity="0.28" stroke="${col}" stroke-opacity="0.9" stroke-width="3"`;
  if (a.type === 'circle') {
    return `<circle cx="${a.x}" cy="${a.y}" r="${ft2px(a.size)}" ${common} />`;
  }
  if (a.type === 'line') {
    const w = ft2px(5);
    return `<line x1="${a.x}" y1="${a.y}" x2="${a.x2}" y2="${a.y2}" stroke="${col}" stroke-opacity="0.55" stroke-width="${w}" stroke-linecap="round" />`;
  }
  // cone: apex at origin, spreads ~53° toward the drag point
  const dx = a.x2 - a.x, dy = a.y2 - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;         // direction
  const px = -uy, py = ux;                      // perpendicular
  const half = len * 0.5;                        // 53° cone → half-width ≈ 0.5·length
  const bx = a.x + ux * len, by = a.y + uy * len;
  const c1x = bx + px * half, c1y = by + py * half;
  const c2x = bx - px * half, c2y = by - py * half;
  return `<polygon points="${a.x},${a.y} ${c1x},${c1y} ${c2x},${c2y}" ${common} />`;
}
function renderAoes(preview) {
  const svg = $('aoe'); if (!svg) return;
  const list = preview ? aoes.concat([preview]) : aoes;
  svg.innerHTML = list.map(aoeSvg).join('');
}

/* ============ VOICE CHAT (WebRTC mesh) ============ */
const peers = {}; let localStream = null, voiceOn = false;
const rtcConfig = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
$('voice-btn').onclick = toggleVoice;
async function toggleVoice() {
  if (voiceOn) return stopVoice();
  try { localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false }); }
  catch (e) { alert('Microphone access denied or unavailable.'); return; }
  voiceOn = true; $('voice-btn').textContent = '🎙️ Voice: On'; $('voice-btn').classList.add('on');
  $('voice-peers').textContent = 'Voice connected. Others who turn on voice will be heard.';
  socket.emit('join', { roomId: me.room, name: me.name, color: me.color });
}
function stopVoice() {
  voiceOn = false; $('voice-btn').textContent = '🎙️ Voice: Off'; $('voice-btn').classList.remove('on');
  Object.values(peers).forEach((pc) => pc.close()); Object.keys(peers).forEach((k) => delete peers[k]);
  if (localStream) { localStream.getTracks().forEach((t) => t.stop()); localStream = null; }
  $('remote-audio-container').innerHTML = '';
}
function createPeer(peerId, initiator) {
  const pc = new RTCPeerConnection(rtcConfig); peers[peerId] = pc;
  if (localStream) localStream.getTracks().forEach((t) => pc.addTrack(t, localStream));
  pc.onicecandidate = (e) => { if (e.candidate) socket.emit('rtc:signal', { to: peerId, data: { candidate: e.candidate } }); };
  pc.ontrack = (e) => {
    let a = document.getElementById('audio-' + peerId);
    if (!a) { a = document.createElement('audio'); a.id = 'audio-' + peerId; a.autoplay = true; $('remote-audio-container').appendChild(a); }
    a.srcObject = e.streams[0];
  };
  if (initiator) pc.createOffer().then((o) => { pc.setLocalDescription(o); socket.emit('rtc:signal', { to: peerId, data: { sdp: o } }); });
  return pc;
}
socket.on('peer-joined', ({ peerId }) => { if (voiceOn && !peers[peerId]) createPeer(peerId, true); });
socket.on('peer-left', ({ peerId }) => { if (peers[peerId]) { peers[peerId].close(); delete peers[peerId]; } const a = document.getElementById('audio-' + peerId); if (a) a.remove(); });
socket.on('rtc:signal', async ({ from, data }) => {
  if (!voiceOn) return;
  let pc = peers[from] || createPeer(from, false);
  if (data.sdp) {
    await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
    if (data.sdp.type === 'offer') { const a = await pc.createAnswer(); await pc.setLocalDescription(a); socket.emit('rtc:signal', { to: from, data: { sdp: a } }); }
  } else if (data.candidate) { try { await pc.addIceCandidate(new RTCIceCandidate(data.candidate)); } catch {} }
});

/* ============ TOUCH SUPPORT (mobile/tablet) ============ */
/* Bridge single-finger touches to the mouse handlers the board already uses. */
(function () {
  const wrap = $('board-wrap');
  if (!wrap) return;
  let boardTouch = false;
  const fire = (type, touch, target) => {
    const ev = new MouseEvent(type, { bubbles: true, cancelable: true, view: window,
      clientX: touch.clientX, clientY: touch.clientY });
    (target || document).dispatchEvent(ev);
  };
  wrap.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) return;
    boardTouch = true;
    const t = e.touches[0];
    fire('mousedown', t, document.elementFromPoint(t.clientX, t.clientY) || wrap);
  }, { passive: true });
  window.addEventListener('touchmove', (e) => {
    if (!boardTouch || e.touches.length !== 1) return;
    e.preventDefault();           // stop the page scrolling while dragging/panning
    fire('mousemove', e.touches[0], window);
  }, { passive: false });
  window.addEventListener('touchend', (e) => {
    if (!boardTouch) return;
    boardTouch = false;
    fire('mouseup', e.changedTouches[0], window);
  }, { passive: true });
})();

/* ============ helpers ============ */
function initials(name) { return name.split(/\s+/).map((w) => w[0]).join('').slice(0, 3).toUpperCase(); }
function escapeHtml(s) { return (s || '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }
