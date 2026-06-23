/* D&D VTT client. Talks to the server over Socket.io. */
const socket = io();
const $ = (id) => document.getElementById(id);

let me = { id: null, name: '', color: '#c0392b', room: '' };
let gridSize = 70;
const tokenEls = {}; // id -> element

/* ============ JOIN ============ */
$('join-btn').onclick = join;
$('join-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') join(); });

function join() {
  const name = $('join-name').value.trim() || 'Adventurer';
  const room = $('join-room').value.trim() || 'default';
  const color = $('join-color').value;
  me.name = name; me.room = room; me.color = color;
  socket.emit('join', { roomId: room, name, color });
  $('join-screen').classList.add('hidden');
  $('app').classList.remove('hidden');
  $('room-label').textContent = `Table: ${room}`;
  // Restore character sheet from this device
  loadSheet();
}

/* ============ INITIAL STATE ============ */
socket.on('state', (s) => {
  me.id = s.youId;
  gridSize = s.gridSize || 70;
  applyGrid(gridSize);
  if (s.mapImage) setMap(s.mapImage);
  $('chat-log').innerHTML = '';
  (s.chat || []).forEach(addChat);
  $('tokens').innerHTML = '';
  Object.values(s.tokens || {}).forEach(renderToken);
});

socket.on('players', (players) => {
  const ul = $('player-list'); ul.innerHTML = '';
  players.forEach((p) => {
    const li = document.createElement('li');
    li.innerHTML = `<span class="dot" style="background:${p.color}"></span> ${escapeHtml(p.name)}${p.id === me.id ? ' (you)' : ''}`;
    ul.appendChild(li);
  });
});

/* ============ CHAT + AI DM ============ */
function addChat(m) {
  const log = $('chat-log');
  const div = document.createElement('div');
  div.className = 'msg ' + (m.role || 'player');
  if (m.role === 'system') {
    div.textContent = m.text;
  } else {
    div.innerHTML = `<span class="who">${escapeHtml(m.author)}</span>${escapeHtml(m.text)}`;
  }
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
}
socket.on('chat', addChat);
socket.on('dm:thinking', (on) => $('dm-typing').classList.toggle('hidden', !on));

$('send-btn').onclick = sendChat;
$('chat-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') sendChat(); });
function sendChat() {
  const text = $('chat-input').value.trim();
  if (!text) return;
  socket.emit('chat', { text });
  $('chat-input').value = '';
}
$('dm-btn').onclick = () => {
  const text = $('chat-input').value.trim();
  socket.emit('dm:ask', { text });
  $('chat-input').value = '';
};

/* ============ DICE ============ */
document.querySelectorAll('.die').forEach((b) => {
  b.onclick = () => rollFormula(`1d${b.dataset.die}`);
});
$('dice-roll').onclick = () => rollFormula($('dice-formula').value.trim() || '1d20');
$('dice-formula').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('dice-roll').click(); });

function rollDie(sides) { return Math.floor(Math.random() * sides) + 1; }

// Parses NdM+K. Handles advantage/disadvantage for single d20 + quick mod.
function rollFormula(formula) {
  const adv = $('adv').checked, dis = $('dis').checked;
  const quickmod = parseInt($('quickmod').value) || 0;
  let detail = [], total = 0;

  const m = formula.match(/^(\d*)d(\d+)([+-]\d+)?$/i);
  if (!m) { showDice('?', 'Invalid formula. Try 2d6+3'); return; }
  let count = parseInt(m[1] || '1'), sides = parseInt(m[2]), bonus = parseInt(m[3] || '0');

  if (sides === 20 && count === 1 && (adv || dis)) {
    const a = rollDie(20), b = rollDie(20);
    const pick = adv ? Math.max(a, b) : Math.min(a, b);
    total = pick + bonus + quickmod;
    detail.push(`${adv ? 'ADV' : 'DIS'} [${a},${b}]→${pick}`);
  } else {
    const rolls = [];
    for (let i = 0; i < count; i++) { const r = rollDie(sides); rolls.push(r); total += r; }
    total += bonus + quickmod;
    detail.push(`[${rolls.join(',')}]`);
  }
  const mods = (bonus || quickmod) ? ` ${fmtMod(bonus + quickmod)}` : '';
  const detailStr = detail.join(' ') + mods;
  showDice(total, detailStr);
  socket.emit('roll', { formula: formula + (quickmod ? fmtMod(quickmod) : ''), result: total, detail: detailStr });
}
function fmtMod(n) { return n >= 0 ? `+${n}` : `${n}`; }
function showDice(total, detail) {
  $('dice-result').innerHTML = `<div class="big">${total}</div><div>${escapeHtml(detail)}</div>`;
}

/* ============ CHARACTER SHEET (local autosave) ============ */
const sheetFields = ['sh-name','sh-class','sh-level','sh-race','sh-ac','sh-hp','sh-maxhp',
  'ab-str','ab-dex','ab-con','ab-int','ab-wis','ab-cha','sh-notes'];
sheetFields.forEach((f) => $(f).addEventListener('input', () => { updateMods(); saveSheet(); }));

const abilMap = { str:'STR', dex:'DEX', con:'CON', int:'INT', wis:'WIS', cha:'CHA' };
function mod(score) { return Math.floor((parseInt(score || 10) - 10) / 2); }
function updateMods() {
  Object.keys(abilMap).forEach((k) => {
    const m = mod($(`ab-${k}`).value);
    $(`m-${k}`).textContent = fmtMod(m);
  });
}
// Click a modifier to roll d20 + that ability
Object.keys(abilMap).forEach((k) => {
  $(`m-${k}`).onclick = () => {
    const m = mod($(`ab-${k}`).value);
    $('quickmod').value = m;
    document.querySelector('[data-tab="dice"]').click();
    rollFormula('1d20');
  };
});
function saveSheet() {
  const data = {}; sheetFields.forEach((f) => data[f] = $(f).value);
  localStorage.setItem('dnd-sheet-' + me.room, JSON.stringify(data));
}
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
    t.classList.add('active');
    $('tab-' + t.dataset.tab).classList.add('active');
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
  const board = $('board');
  board.style.backgroundImage = `url(${dataUrl})`;
  board.style.backgroundSize = 'cover';
  board.classList.add('has-map');
}
socket.on('map:set', setMap);
function applyGrid(size) { $('grid').style.backgroundSize = `${size}px ${size}px`; }
socket.on('grid:set', (s) => { gridSize = s; applyGrid(s); });

/* ============ TOKENS ============ */
$('addtoken-btn').onclick = () => {
  socket.emit('token:add', {
    x: 100 + Math.random() * 300, y: 100 + Math.random() * 200,
    color: me.color, label: initials(me.name), size: 1,
  });
};
socket.on('token:add', renderToken);
socket.on('token:update', (t) => { if (tokenEls[t.id]) { Object.assign(tokenEls[t.id].dataset, { x: t.x, y: t.y }); styleToken(tokenEls[t.id], t); } });
socket.on('token:move', ({ id, x, y }) => {
  const el = tokenEls[id]; if (!el) return;
  el.style.left = x + 'px'; el.style.top = y + 'px';
  el._token.x = x; el._token.y = y;
});
socket.on('token:remove', (id) => { if (tokenEls[id]) { tokenEls[id].remove(); delete tokenEls[id]; } });

function renderToken(t) {
  let el = tokenEls[t.id];
  if (!el) {
    el = document.createElement('div');
    el.className = 'token';
    el.innerHTML = `<span class="lbl"></span>`;
    $('tokens').appendChild(el);
    tokenEls[t.id] = el;
    makeDraggable(el);
  }
  el._token = t;
  el.style.left = t.x + 'px'; el.style.top = t.y + 'px';
  styleToken(el, t);
}
function styleToken(el, t) {
  const s = (t.size || 1) * 64;
  el.style.width = s + 'px'; el.style.height = s + 'px';
  el.style.background = t.img ? `center/cover url(${t.img})` : t.color;
  el.querySelector('.lbl').textContent = t.img ? '' : (t.label || '');
  el.classList.toggle('mine', t.ownerId === me.id);
}

function makeDraggable(el) {
  let dragging = false, ox = 0, oy = 0;
  el.addEventListener('mousedown', (e) => {
    dragging = true;
    ox = e.clientX - el.offsetLeft; oy = e.clientY - el.offsetTop;
    e.preventDefault();
  });
  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    let x = e.clientX - ox, y = e.clientY - oy;
    el.style.left = x + 'px'; el.style.top = y + 'px';
    el._token.x = x; el._token.y = y;
    socket.emit('token:move', { id: el._token.id, x, y });
  });
  window.addEventListener('mouseup', () => {
    if (!dragging) return; dragging = false;
    // snap to grid
    const sx = Math.round(el.offsetLeft / gridSize) * gridSize;
    const sy = Math.round(el.offsetTop / gridSize) * gridSize;
    el.style.left = sx + 'px'; el.style.top = sy + 'px';
    el._token.x = sx; el._token.y = sy;
    socket.emit('token:move', { id: el._token.id, x: sx, y: sy });
  });
  el.addEventListener('dblclick', () => openTokenModal(el._token));
}

/* Token edit modal */
let editingToken = null;
function openTokenModal(t) {
  editingToken = t;
  $('tk-label').value = t.label || '';
  $('tk-color').value = t.color || '#c0392b';
  $('tk-size').value = t.size || 1;
  $('token-modal').classList.remove('hidden');
}
$('tk-save').onclick = () => {
  if (!editingToken) return;
  const upd = { id: editingToken.id, label: $('tk-label').value, color: $('tk-color').value, size: parseInt($('tk-size').value) };
  socket.emit('token:update', upd);
  $('token-modal').classList.add('hidden');
};
$('tk-delete').onclick = () => {
  if (editingToken) socket.emit('token:remove', editingToken.id);
  $('token-modal').classList.add('hidden');
};
$('token-modal').addEventListener('click', (e) => { if (e.target.id === 'token-modal') e.currentTarget.classList.add('hidden'); });

/* ============ VOICE CHAT (WebRTC mesh) ============ */
const peers = {};       // peerId -> RTCPeerConnection
let localStream = null;
let voiceOn = false;
const rtcConfig = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

$('voice-btn').onclick = toggleVoice;
async function toggleVoice() {
  if (voiceOn) return stopVoice();
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  } catch (e) {
    alert('Microphone access denied or unavailable.'); return;
  }
  voiceOn = true;
  $('voice-btn').textContent = '🎙️ Voice: On';
  $('voice-btn').classList.add('on');
  $('voice-peers').textContent = 'Voice connected. Others who turn on voice will be heard.';
  // Re-announce so existing peers initiate connections to us.
  socket.emit('join', { roomId: me.room, name: me.name, color: me.color });
}
function stopVoice() {
  voiceOn = false;
  $('voice-btn').textContent = '🎙️ Voice: Off';
  $('voice-btn').classList.remove('on');
  Object.values(peers).forEach((pc) => pc.close());
  Object.keys(peers).forEach((k) => delete peers[k]);
  if (localStream) { localStream.getTracks().forEach((t) => t.stop()); localStream = null; }
  $('remote-audio-container').innerHTML = '';
}

function createPeer(peerId, initiator) {
  const pc = new RTCPeerConnection(rtcConfig);
  peers[peerId] = pc;
  if (localStream) localStream.getTracks().forEach((t) => pc.addTrack(t, localStream));
  pc.onicecandidate = (e) => { if (e.candidate) socket.emit('rtc:signal', { to: peerId, data: { candidate: e.candidate } }); };
  pc.ontrack = (e) => {
    let audio = document.getElementById('audio-' + peerId);
    if (!audio) { audio = document.createElement('audio'); audio.id = 'audio-' + peerId; audio.autoplay = true; $('remote-audio-container').appendChild(audio); }
    audio.srcObject = e.streams[0];
  };
  if (initiator) {
    pc.createOffer().then((offer) => { pc.setLocalDescription(offer); socket.emit('rtc:signal', { to: peerId, data: { sdp: offer } }); });
  }
  return pc;
}

// A new peer joined — if we have voice on, start a connection to them.
socket.on('peer-joined', ({ peerId }) => { if (voiceOn && !peers[peerId]) createPeer(peerId, true); });
socket.on('peer-left', ({ peerId }) => {
  if (peers[peerId]) { peers[peerId].close(); delete peers[peerId]; }
  const a = document.getElementById('audio-' + peerId); if (a) a.remove();
});

socket.on('rtc:signal', async ({ from, data }) => {
  if (!voiceOn) return; // ignore if we're not in voice
  let pc = peers[from] || createPeer(from, false);
  if (data.sdp) {
    await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
    if (data.sdp.type === 'offer') {
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit('rtc:signal', { to: from, data: { sdp: answer } });
    }
  } else if (data.candidate) {
    try { await pc.addIceCandidate(new RTCIceCandidate(data.candidate)); } catch {}
  }
});

/* ============ helpers ============ */
function initials(name) { return name.split(/\s+/).map((w) => w[0]).join('').slice(0, 3).toUpperCase(); }
function escapeHtml(s) { return (s || '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }
