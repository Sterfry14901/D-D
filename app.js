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
  renderInit(s.initiative || [], s.turnIndex || 0);
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
socket.on('init:state', ({ list, turnIndex }) => renderInit(list, turnIndex));
function renderInit(list, turnIndex) {
  const ol = $('init-list'); ol.innerHTML = '';
  list.forEach((e, i) => {
    const li = document.createElement('li');
    li.className = i === turnIndex ? 'active' : '';
    li.innerHTML = `<span class="ini">${e.init}</span> <span class="nm">${escapeHtml(e.name)}</span> <button class="ini-x" title="Remove">✕</button>`;
    li.querySelector('.ini-x').onclick = () => socket.emit('init:remove', e.id);
    ol.appendChild(li);
  });
  const banner = $('turn-banner');
  if (list.length) { banner.textContent = `⚔️ ${list[turnIndex].name}'s turn`; banner.classList.remove('hidden'); }
  else banner.classList.add('hidden');
}

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
    for (let cx = tcx - R; cx <= tcx + R; cx++) {
      for (let cy = tcy - R; cy <= tcy + R; cy++) {
        if (cx < 0 || cy < 0) continue;
        const dist = Math.max(Math.abs(cx - tcx), Math.abs(cy - tcy));
        if (dist > R) continue;
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
