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

/* ============ TABS ============ */
document.querySelectorAll('.tab').forEach((t) => {
  t.onclick = () => {
    document.querySelectorAll('.tab').forEach((x) => x.classList.remove('active'));
    document.querySelectorAll('.tabpane').forEach((x) => x.classList.remove('active'));
    t.classList.add('active'); $('tab-' + t.dataset.tab).classList.add('active');
  };
});

/* ============ MAP ============ */
$('map-btn').onclick = () => $('map-file').click();
$('map-file').onchange = (e) => {
  const file = e.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = () => { socket.emit('map:set', reader.result); setMap(reader.result); };
  reader.readAsDataURL(file);
};
function setMap(dataUrl) {
  const stage = $('stage');
  stage.style.backgroundImage = `url(${dataUrl})`;
  stage.style.backgroundSize = 'cover';
  $('board').classList.add('has-map');
}
socket.on('map:set', setMap);
function applyGrid(size) { $('grid').style.backgroundSize = `${size}px ${size}px`; renderFog(); }
socket.on('grid:set', (s) => { gridSize = s; applyGrid(s); });

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
  if (rulerMode) { rulerStart = boardCoords(e); e.preventDefault(); return; }
  if (fogMode && me.isGm) { paintFog(e); return; }
  panning = true; panStart = { x: e.clientX, y: e.clientY, sl: $('board-wrap').scrollLeft, st: $('board-wrap').scrollTop };
});
window.addEventListener('mousemove', (e) => {
  if (panning) { $('board-wrap').scrollLeft = panStart.sl - (e.clientX - panStart.x); $('board-wrap').scrollTop = panStart.st - (e.clientY - panStart.y); }
  else if (rulerStart) { const c = boardCoords(e); drawRuler(rulerStart.x, rulerStart.y, c.x, c.y); }
  else if (fogPainting && me.isGm) paintFog(e);
});
window.addEventListener('mouseup', () => { panning = false; fogPainting = false; rulerStart = null; });

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
socket.on('token:add', renderToken);
socket.on('token:update', (t) => { if (tokenEls[t.id]) { tokenEls[t.id]._token = t; styleToken(tokenEls[t.id], t); } });
socket.on('token:move', ({ id, x, y }) => {
  const el = tokenEls[id]; if (!el) return;
  el.style.left = x + 'px'; el.style.top = y + 'px'; el._token.x = x; el._token.y = y;
});
socket.on('token:remove', (id) => { if (tokenEls[id]) { tokenEls[id].remove(); delete tokenEls[id]; } });

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
  $('token-modal').classList.remove('hidden');
}
// Art palette: pick an emoji preset (clears custom image)
document.querySelectorAll('.art-opt[data-e]').forEach((b) => {
  b.onclick = () => {
    editEmoji = b.dataset.e; editImg = null;
    document.querySelectorAll('.art-opt[data-e]').forEach((x) => x.classList.toggle('on', x === b));
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
$('fog-paint-hide').onclick = () => { fogPaintHide = true; $('fog-paint-hide').classList.add('active'); $('fog-paint-reveal').classList.remove('active'); };
$('fog-paint-reveal').onclick = () => { fogPaintHide = false; $('fog-paint-reveal').classList.add('active'); $('fog-paint-hide').classList.remove('active'); };
$('fog-cover-all').onclick = () => socket.emit('fog:all', true);
$('fog-clear-all').onclick = () => socket.emit('fog:all', false);

function paintFog(e) {
  fogPainting = true;
  const c = boardCoords(e);
  const cx = Math.floor(c.x / gridSize), cy = Math.floor(c.y / gridSize);
  if (cx < 0 || cy < 0) return;
  const key = `${cx},${cy}`;
  const wantHidden = fogPaintHide;
  if (!!fog.hidden[key] === wantHidden) return;
  if (wantHidden) fog.hidden[key] = true; else delete fog.hidden[key];
  socket.emit('fog:cell', { key, hidden: wantHidden });
  renderFog();
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

/* ============ helpers ============ */
function initials(name) { return name.split(/\s+/).map((w) => w[0]).join('').slice(0, 3).toUpperCase(); }
function escapeHtml(s) { return (s || '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }
