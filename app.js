/* D&D VTT client. Talks to the server over Socket.io. */
const socket = io();
const $ = (id) => document.getElementById(id);
// Let other scripts (bestiary.js) post to the shared chat/roll log.
window.emitChat = (text) => socket.emit('chat', { text });

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
  $('me-plate-name').textContent = me.name;
  applyZoom();
  loadSheet();
  loadCS();
  linkedToken = localStorage.getItem('dnd-link-' + me.room) || null;
  sendPartyStatus();
}

let linkedToken = null;
function syncLinkedToken() {
  if (!linkedToken || !tokenEls[linkedToken] || !cs) return;
  socket.emit('token:update', { id: linkedToken, hp: Number(cs.hp) || 0, maxhp: Number(cs.maxhp) || 0 });
}
const COND_EMOJI = { Blinded: '🙈', Charmed: '💗', Deafened: '🔇', Frightened: '😱', Grappled: '🤼', Incapacitated: '💫', Invisible: '👻', Paralyzed: '⚡', Petrified: '🗿', Poisoned: '☠️', Prone: '⬇️', Restrained: '🕸️', Stunned: '😵', Unconscious: '💤' };
function syncLinkedConditions() {
  if (!linkedToken || !tokenEls[linkedToken] || !cs) return;
  const st = (cs.conditions || []).map((c) => COND_EMOJI[c]).filter(Boolean);
  socket.emit('token:update', { id: linkedToken, statuses: st });
}

/* ============ PARTY STATUS (live HP/AC) ============ */
function sendPartyStatus() {
  if (!me.id && !me.room) return;
  socket.emit('party:status', {
    name: (cs && cs.name) || me.name,
    hp: cs ? Number(cs.hp) || 0 : 0,
    maxhp: cs ? Number(cs.maxhp) || 0 : 0,
    ac: cs ? Number(cs.ac) || 0 : 0,
  });
  syncLinkedToken();
}
socket.on('party:list', (list) => {
  const box = $('party-status'); if (!box) return;
  if (!list.length) { box.innerHTML = '<div class="cs-empty">No character HP shared yet. Fill in your sheet.</div>'; return; }
  box.innerHTML = list.map((p) => {
    const pct = p.maxhp > 0 ? Math.max(0, Math.min(100, (p.hp / p.maxhp) * 100)) : 0;
    const col = pct > 50 ? '#5fae54' : pct > 25 ? '#d9a434' : '#c0392b';
    return `<div class="pmember">
      <div class="pm-top"><span class="pm-name">${escapeHtml(p.name)}</span><span class="pm-ac">🛡️ ${p.ac || '—'}</span></div>
      <div class="pm-hpbar"><i style="width:${pct}%;background:${col}"></i></div>
      <div class="pm-hp">${p.maxhp > 0 ? `${p.hp} / ${p.maxhp} HP` : 'no HP set'}</div>
    </div>`;
  }).join('');
});

/* ============ SHARED CAMPAIGN JOURNAL ============ */
let notesTimer = null, notesSaved = true;
function applyNotes(text) {
  const ta = $('journal-text'); if (!ta) return;
  // don't clobber what the user is actively typing
  if (document.activeElement === ta) return;
  ta.value = text;
  const st = $('journal-status'); if (st) st.textContent = 'Synced';
}
function initJournal() {
  const ta = $('journal-text'); if (!ta) return;
  ta.addEventListener('input', () => {
    notesSaved = false;
    const st = $('journal-status'); if (st) st.textContent = 'Saving…';
    if (notesTimer) clearTimeout(notesTimer);
    notesTimer = setTimeout(() => {
      socket.emit('notes:set', ta.value);
      notesSaved = true;
      const s2 = $('journal-status'); if (s2) s2.textContent = 'Saved';
    }, 500);
  });
}
socket.on('notes:set', (text) => applyNotes(text));
document.addEventListener('DOMContentLoaded', initJournal);
if (document.readyState !== 'loading') initJournal();

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
  applyNotes(s.notes || '');
  $('board').classList.toggle('gm-fog', me.isGm);
  document.body.classList.toggle('is-gm', me.isGm);
  $('gm-badge').classList.toggle('hidden', !me.isGm);
  $('me-plate-role').textContent = me.isGm ? 'Dungeon Master' : 'Player';
  document.querySelector('#me-plate .ava').textContent = me.isGm ? '👑' : '🧙';
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
document.querySelectorAll('.dm-quick button').forEach((b) => {
  b.onclick = () => socket.emit('dm:ask', { text: b.dataset.dm });
});

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
  // — Fodder / CR ≤ 1 —
  { n: 'Rat', hp: 1, e: '🐀', cr: '0' }, { n: 'Bat', hp: 1, e: '🦇', cr: '0' },
  { n: 'Commoner', hp: 4, e: '🧑‍🌾', cr: '0' }, { n: 'Kobold', hp: 5, e: '🦎', cr: '1/8' },
  { n: 'Giant Rat', hp: 7, e: '🐀', cr: '1/8' }, { n: 'Goblin', hp: 7, e: '👺', cr: '1/4' },
  { n: 'Cultist', hp: 9, e: '🕯️', cr: '1/8' }, { n: 'Bandit', hp: 11, e: '🗡️', cr: '1/8' },
  { n: 'Guard', hp: 11, e: '🛡️', cr: '1/8' }, { n: 'Acolyte', hp: 9, e: '📿', cr: '1/4' },
  { n: 'Skeleton', hp: 13, e: '💀', cr: '1/4' }, { n: 'Wolf', hp: 11, e: '🐺', cr: '1/4' },
  { n: 'Boar', hp: 11, e: '🐗', cr: '1/4' }, { n: 'Panther', hp: 13, e: '🐆', cr: '1/4' },
  { n: 'Zombie', hp: 22, e: '🧟', cr: '1/4' }, { n: 'Orc', hp: 15, e: '👹', cr: '1/2' },
  { n: 'Hobgoblin', hp: 11, e: '🪓', cr: '1/2' }, { n: 'Gnoll', hp: 22, e: '🐕', cr: '1/2' },
  { n: 'Lizardfolk', hp: 22, e: '🦎', cr: '1/2' }, { n: 'Thug', hp: 32, e: '🥊', cr: '1/2' },
  { n: 'Scout', hp: 16, e: '🏹', cr: '1/2' }, { n: 'Giant Spider', hp: 26, e: '🕷️', size: 2, cr: '1' },
  { n: 'Ghoul', hp: 22, e: '🧟', cr: '1' }, { n: 'Dire Wolf', hp: 37, e: '🐺', size: 2, cr: '1' },
  { n: 'Brown Bear', hp: 34, e: '🐻', size: 2, cr: '1' }, { n: 'Giant Eagle', hp: 26, e: '🦅', size: 2, cr: '1' },
  { n: 'Goblin Boss', hp: 21, e: '👑', cr: '1' }, { n: 'Imp', hp: 10, e: '😈', cr: '1' },
  // — Mid / CR 2–5 —
  { n: 'Ogre', hp: 59, e: '👹', size: 2, cr: '2' }, { n: 'Bandit Captain', hp: 65, e: '⚔️', cr: '2' },
  { n: 'Cult Fanatic', hp: 33, e: '🔥', cr: '2' }, { n: 'Bugbear', hp: 27, e: '🐾', cr: '1' },
  { n: 'Gargoyle', hp: 52, e: '🗿', cr: '2' }, { n: 'Wight', hp: 45, e: '☠️', cr: '3' },
  { n: 'Ghost', hp: 45, e: '👻', cr: '4' }, { n: 'Owlbear', hp: 59, e: '🦉', size: 2, cr: '3' },
  { n: 'Knight', hp: 52, e: '🛡️', cr: '3' }, { n: 'Mummy', hp: 58, e: '🧟', cr: '3' },
  { n: 'Manticore', hp: 68, e: '🦁', size: 2, cr: '3' }, { n: 'Werewolf', hp: 58, e: '🐺', cr: '3' },
  { n: 'Basilisk', hp: 52, e: '🦎', cr: '3' }, { n: 'Wyrmling Dragon', hp: 33, e: '🐉', size: 2, cr: '3' },
  { n: 'Veteran', hp: 58, e: '⚔️', cr: '3' }, { n: 'Mage', hp: 40, e: '🧙', cr: '6' },
  { n: 'Priest', hp: 27, e: '✝️', cr: '2' }, { n: 'Troll', hp: 84, e: '🧌', size: 2, cr: '5' },
  { n: 'Flesh Golem', hp: 93, e: '🧟', size: 2, cr: '5' }, { n: 'Gelatinous Cube', hp: 84, e: '🟩', size: 3, cr: '2' },
  { n: 'Wraith', hp: 67, e: '👻', cr: '5' }, { n: 'Air Elemental', hp: 90, e: '🌪️', size: 2, cr: '5' },
  { n: 'Fire Elemental', hp: 102, e: '🔥', size: 2, cr: '5' }, { n: 'Water Elemental', hp: 114, e: '🌊', size: 2, cr: '5' },
  { n: 'Earth Elemental', hp: 126, e: '🪨', size: 2, cr: '5' }, { n: 'Vampire Spawn', hp: 82, e: '🧛', cr: '5' },
  // — Big / CR 6+ —
  { n: 'Ettin', hp: 85, e: '👹', size: 2, cr: '4' }, { n: 'Hill Giant', hp: 105, e: '🗻', size: 3, cr: '5' },
  { n: 'Young Dragon', hp: 178, e: '🐉', size: 3, cr: '10' }, { n: 'Stone Giant', hp: 126, e: '🗿', size: 3, cr: '7' },
  { n: 'Frost Giant', hp: 138, e: '❄️', size: 3, cr: '8' }, { n: 'Fire Giant', hp: 162, e: '🔥', size: 3, cr: '9' },
  { n: 'Assassin', hp: 78, e: '🗡️', cr: '8' }, { n: 'Mind Flayer', hp: 71, e: '🦑', cr: '7' },
  { n: 'Vampire', hp: 144, e: '🧛', cr: '13' }, { n: 'Lich', hp: 135, e: '💀', cr: '21' },
];
let monsterFilter = '';
function buildMonsters() {
  const g = $('mon-grid'); if (!g) return;
  g.innerHTML = '';
  const q = monsterFilter.trim().toLowerCase();
  const list = q ? MONSTERS.filter((m) => (m.n + ' cr' + (m.cr || '')).toLowerCase().includes(q)) : MONSTERS;
  if (!list.length) { g.innerHTML = '<div class="mon-empty">No monsters match.</div>'; return; }
  list.forEach((m) => {
    const b = document.createElement('button');
    b.className = 'mon-btn';
    const canView = typeof window.hasStatBlock === 'function' && window.hasStatBlock(m.n);
    b.innerHTML = `<span class="me">${m.e}</span><span class="mn">${m.n}</span><em>${m.hp} hp${m.cr ? ' · CR ' + m.cr : ''}</em>${canView ? '<span class="mon-info" title="View stat block">📖</span>' : ''}`;
    b.onclick = () => spawnMonster(m);
    b.oncontextmenu = (e) => { if (canView) { e.preventDefault(); window.showStatBlock(m.n); } };
    const info = b.querySelector('.mon-info');
    if (info) info.onclick = (e) => { e.stopPropagation(); window.showStatBlock(m.n); };
    g.appendChild(b);
  });
}
function spawnMonster(m) {
  if (!me.isGm) return;
  socket.emit('token:add', {
    x: gridSize * (2 + Math.floor(Math.random() * 6)),
    y: gridSize * (1 + Math.floor(Math.random() * 3)),
    color: '#7a2318', label: m.n, size: m.size || 1,
    statuses: [], emoji: m.e, hp: m.hp, maxhp: m.hp,
  });
}
buildMonsters();
(function () {
  const q = $('mon-q');
  if (q) q.addEventListener('input', () => { monsterFilter = q.value; buildMonsters(); });
  // XP thresholds per character by level: [easy, medium, hard, deadly]
  const XP_T = { 1: [25, 50, 75, 100], 2: [50, 100, 150, 200], 3: [75, 150, 225, 400], 4: [125, 250, 375, 500], 5: [250, 500, 750, 1100], 6: [300, 600, 900, 1400], 7: [350, 750, 1100, 1700], 8: [450, 900, 1400, 2100], 9: [550, 1100, 1600, 2400], 10: [600, 1200, 1900, 2800], 11: [800, 1600, 2400, 3600], 12: [1000, 2000, 3000, 4500], 13: [1100, 2200, 3400, 5100], 14: [1250, 2500, 3800, 5700], 15: [1400, 2800, 4300, 6400], 16: [1600, 3200, 4800, 7200], 17: [2000, 3900, 5900, 8800], 18: [2100, 4200, 6300, 9500], 19: [2400, 4900, 7300, 10900], 20: [2800, 5700, 8500, 12700] };
  const xpBtn = $('xp-calc');
  if (xpBtn) xpBtn.onclick = () => {
    const n = Math.max(1, Math.min(12, parseInt($('xp-count').value) || 4));
    const lv = Math.max(1, Math.min(20, parseInt($('xp-level').value) || 1));
    const t = XP_T[lv];
    const f = (x) => (x * n).toLocaleString();
    $('xp-out').innerHTML = `Party of ${n} @ lv ${lv} — <b>Easy</b> ${f(t[0])} · <b>Med</b> ${f(t[1])} · <b>Hard</b> ${f(t[2])} · <b>Deadly</b> ${f(t[3])} XP`;
  };
  const npcBtn = $('npc-roll');
  if (npcBtn) npcBtn.onclick = () => {
    if (!me.isGm) return;
    const pick = (a) => a[Math.floor(Math.random() * a.length)];
    const first = ['Bram', 'Elara', 'Osric', 'Mira', 'Doran', 'Sela', 'Halvard', 'Wynn', 'Garrick', 'Thistle', 'Corin', 'Yselda', 'Peteran', 'Rowan', 'Ismark', 'Ada', 'Fenn', 'Voss', 'Nella', 'Torvin'];
    const last = ['Underbough', 'Ashfield', 'Stormwind', 'Blackwater', 'Greycloak', 'Ironhand', 'Meadows', 'Thorne', 'Copperpot', 'Vayne', 'Frostbeard', 'Nightingale', 'Marsh', 'Holt'];
    const race = ['human', 'half-elf', 'dwarf', 'elf', 'halfling', 'tiefling', 'half-orc', 'gnome', 'dragonborn'];
    const role = ['innkeeper', 'blacksmith', 'town guard', 'merchant', 'hedge wizard', 'farmer', 'sellsword', 'priest', 'thief', 'noble', 'fisher', 'scholar', 'bard', 'herbalist', 'stablehand'];
    const quirk = ['speaks in a whisper', 'never makes eye contact', 'laughs at their own jokes', 'is missing two fingers', 'quotes old proverbs', 'smells of woodsmoke', 'is deeply superstitious', 'owes someone dangerous money', 'hides a heart of gold', 'is secretly terrified', 'collects odd trinkets', 'has a twin no one mentions', 'is always hungry', 'distrusts magic'];
    const want = ['wants coin above all', 'is looking for a lost sibling', 'seeks revenge quietly', 'just wants a quiet life', 'is hiding from the law', 'craves adventure', 'protects a secret', 'serves a hidden master'];
    const name = pick(first) + ' ' + pick(last);
    socket.emit('chat', { text: `🎭 NPC: ${name}, a ${pick(race)} ${pick(role)} who ${pick(quirk)} and ${pick(want)}.` });
  };
  const lootBtn = $('loot-roll');
  if (lootBtn) lootBtn.onclick = () => {
    if (!me.isGm) return;
    const tier = parseInt($('loot-tier').value) || 1;
    const d6 = () => Math.floor(Math.random() * 6) + 1;
    const gp = tier * (d6() + d6()) * (tier >= 3 ? 100 : 10);
    const sp = (d6() + d6()) * 10;
    let text = `💰 Treasure (Tier ${tier}): ${gp} gp, ${sp} sp`;
    if (Math.random() < 0.55 && typeof window.rollLootItem === 'function') {
      const it = window.rollLootItem(tier);
      if (it) text += ` — and a magic item: ${it.n} (${it.r})`;
    }
    socket.emit('chat', { text });
  };
})();

/* ============ ENCOUNTER BUILDER ============ */
const ENCOUNTERS = [
  { name: 'Goblin Ambush', e: '🏹', mobs: [{ n: 'Goblin', hp: 7, e: '👹', c: 4 }] },
  { name: 'Wolf Pack', e: '🐺', mobs: [{ n: 'Wolf', hp: 11, e: '🐺', c: 3 }, { n: 'Dire Wolf', hp: 37, e: '🐺', size: 2, c: 1 }] },
  { name: 'Undead Horde', e: '💀', mobs: [{ n: 'Skeleton', hp: 13, e: '💀', c: 3 }, { n: 'Zombie', hp: 22, e: '🧟', c: 2 }] },
  { name: 'Bandit Camp', e: '🗡️', mobs: [{ n: 'Bandit', hp: 11, e: '🗡️', c: 4 }, { n: 'Cultist', hp: 9, e: '🕯️', c: 1 }] },
  { name: 'Spider Nest', e: '🕷️', mobs: [{ n: 'Giant Spider', hp: 26, e: '🕷️', size: 2, c: 3 }] },
  { name: 'Ogre Gang', e: '👹', mobs: [{ n: 'Ogre', hp: 59, e: '👹', size: 2, c: 2 }] },
  { name: "Dragon's Lair", e: '🐉', mobs: [{ n: 'Young Dragon', hp: 178, e: '🐉', size: 3, c: 1 }, { n: 'Kobold', hp: 5, e: '🦎', c: 3 }] },
  { name: 'Ghostly Haunt', e: '👻', mobs: [{ n: 'Ghost', hp: 45, e: '👻', c: 2 }] },
  { name: 'Orc War Band', e: '👹', mobs: [{ n: 'Orc', hp: 15, e: '👹', c: 4 }, { n: 'Ogre', hp: 59, e: '👹', size: 2, c: 1 }] },
  { name: 'Hobgoblin Patrol', e: '🪓', mobs: [{ n: 'Hobgoblin', hp: 11, e: '🪓', c: 4 }, { n: 'Bugbear', hp: 27, e: '🐾', c: 1 }] },
  { name: 'Gnoll Hunt', e: '🐕', mobs: [{ n: 'Gnoll', hp: 22, e: '🐕', c: 4 }] },
  { name: 'Cult Ritual', e: '🔥', mobs: [{ n: 'Cultist', hp: 9, e: '🕯️', c: 4 }, { n: 'Cult Fanatic', hp: 33, e: '🔥', c: 1 }] },
  { name: 'Owlbear', e: '🦉', mobs: [{ n: 'Owlbear', hp: 59, e: '🦉', size: 2, c: 1 }] },
  { name: 'Giant Rampage', e: '🗻', mobs: [{ n: 'Hill Giant', hp: 105, e: '🗻', size: 3, c: 1 }, { n: 'Ogre', hp: 59, e: '👹', size: 2, c: 1 }] },
  { name: 'Vampire & Spawn', e: '🧛', mobs: [{ n: 'Vampire Spawn', hp: 82, e: '🧛', c: 2 }] },
  { name: 'Elemental Fury', e: '🌪️', mobs: [{ n: 'Fire Elemental', hp: 102, e: '🔥', size: 2, c: 1 }, { n: 'Air Elemental', hp: 90, e: '🌪️', size: 2, c: 1 }] },
];
function buildEncounters() {
  const g = $('enc-grid'); if (!g) return;
  ENCOUNTERS.forEach((enc) => {
    const total = enc.mobs.reduce((s, m) => s + m.c, 0);
    const b = document.createElement('button'); b.className = 'mon-btn';
    b.innerHTML = `<span class="me">${enc.e}</span><span class="mn">${enc.name}</span><em>${total}</em>`;
    b.onclick = () => spawnEncounter(enc);
    g.appendChild(b);
  });
}
function spawnEncounter(enc) {
  if (!me.isGm) return;
  let i = 0;
  enc.mobs.forEach((m) => {
    for (let k = 0; k < m.c; k++) {
      const cx = 3 + (i % 5) * (m.size || 1);
      const cy = 3 + Math.floor(i / 5) * 1.4;
      const nm = m.c > 1 ? `${m.n} ${k + 1}` : m.n;
      socket.emit('token:add', {
        x: Math.round(cx * gridSize), y: Math.round(cy * gridSize),
        color: '#7a2318', label: nm, size: m.size || 1, statuses: [], emoji: m.e, hp: m.hp, maxhp: m.hp,
      });
      socket.emit('init:add', { name: nm, init: 1 + Math.floor(Math.random() * 20) + 2 }); // auto-roll initiative
      i++;
    }
  });
  socket.emit('init:sort');
  socket.emit('chat', { text: `🐲 Encounter dropped: ${enc.name} (${enc.mobs.map((m) => m.c + '× ' + m.n).join(', ')}). Initiative rolled.` });
}
buildEncounters();

/* ============ RESIZABLE SIDE PANEL ============ */
(function () {
  const panel = $('panel'), handle = $('panel-resize');
  if (!panel || !handle) return;
  const saved = parseInt(localStorage.getItem('dnd-panelw'));
  if (saved) panel.style.width = saved + 'px';
  let resizing = false;
  handle.addEventListener('mousedown', (e) => { resizing = true; document.body.style.cursor = 'col-resize'; e.preventDefault(); });
  window.addEventListener('mousemove', (e) => {
    if (!resizing) return;
    let w = window.innerWidth - e.clientX;
    w = Math.max(280, Math.min(700, w));
    panel.style.width = w + 'px';
  });
  window.addEventListener('mouseup', () => {
    if (!resizing) return; resizing = false; document.body.style.cursor = '';
    localStorage.setItem('dnd-panelw', parseInt(panel.style.width) || 384);
  });
})();

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
function applyGrid(size) { $('grid').style.backgroundSize = `${size}px ${size}px`; renderFog(); syncGridSlider(size); }
function syncGridSlider(size) { const gs = $('grid-slider'); if (gs) { gs.value = size; } const gv = $('grid-val'); if (gv) gv.textContent = size; }
socket.on('grid:set', (s) => { gridSize = s; applyGrid(s); renderWalls(); refreshLighting(); });
if ($('grid-slider')) $('grid-slider').oninput = () => {
  const v = Math.max(40, Math.min(200, parseInt($('grid-slider').value) || 70));
  gridSize = v; applyGrid(v); renderWalls(); refreshLighting();
  socket.emit('grid:set', v);
};

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
socket.on('token:remove', (id) => { if (tokenEls[id]) { tokenEls[id].remove(); delete tokenEls[id]; refreshLighting(); } if (id === linkedToken) { linkedToken = null; localStorage.removeItem('dnd-link-' + me.room); } });

function renderToken(t) {
  let el = tokenEls[t.id];
  if (!el) {
    el = document.createElement('div'); el.className = 'token';
    el.innerHTML = `<span class="lbl"></span><div class="hpbar"><i></i></div><div class="statuses"></div><div class="tk-death"></div>`;
    $('tokens').appendChild(el); tokenEls[t.id] = el; makeDraggable(el);
  }
  el._token = t;
  el.style.left = t.x + 'px'; el.style.top = t.y + 'px';
  styleToken(el, t);
  if (typeof combat !== 'undefined' && combat.list && combat.list.length) {
    el.classList.toggle('active-turn', el._token.label === combat.list[combat.turnIndex].name);
  }
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
  const st = (t.statuses || []).slice();
  if (t.conc) st.unshift('🧠');
  el.querySelector('.statuses').innerHTML = st.map((x) => `<span>${x}</span>`).join('');
  el.classList.toggle('concentrating', !!t.conc);
  // Death saves — shown only when downed (0 HP with a max)
  const death = el.querySelector('.tk-death');
  if (death) {
    if (Number(t.maxhp) > 0 && Number(t.hp) === 0) {
      const s = Math.min(3, t.dsSucc || 0), f = Math.min(3, t.dsFail || 0);
      death.style.display = 'flex';
      death.innerHTML = `<span class="ds-s">${'●'.repeat(s)}${'○'.repeat(3 - s)}</span><span class="ds-f">${'●'.repeat(f)}${'○'.repeat(3 - f)}</span>`;
    } else death.style.display = 'none';
  }
}

let moveLabel = null;
function showMoveLabel(el, x, y, startX, startY) {
  if (!moveLabel) { moveLabel = document.createElement('div'); moveLabel.id = 'move-label'; $('stage').appendChild(moveLabel); }
  const ft = Math.round(Math.hypot(x - startX, y - startY) / gridSize * 5 / 5) * 5;
  moveLabel.style.display = 'block';
  moveLabel.style.left = (x + (el._token.size || 1) * 64 + 6) + 'px';
  moveLabel.style.top = y + 'px';
  moveLabel.textContent = ft + ' ft';
}
function hideMoveLabel() { if (moveLabel) moveLabel.style.display = 'none'; }

function makeDraggable(el) {
  let dragging = false, grabX = 0, grabY = 0, startX = 0, startY = 0;
  el.addEventListener('mousedown', (e) => {
    if (e.altKey || fogMode) return;
    dragging = true; const c = boardCoords(e); grabX = c.x - el._token.x; grabY = c.y - el._token.y;
    startX = el._token.x; startY = el._token.y;
    e.preventDefault(); e.stopPropagation();
  });
  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const c = boardCoords(e); const x = c.x - grabX, y = c.y - grabY;
    el.style.left = x + 'px'; el.style.top = y + 'px'; el._token.x = x; el._token.y = y;
    socket.emit('token:move', { id: el._token.id, x, y });
    showMoveLabel(el, x, y, startX, startY);
    refreshLighting();
  });
  window.addEventListener('mouseup', () => {
    if (!dragging) return; dragging = false; hideMoveLabel();
    const sx = Math.round(el._token.x / gridSize) * gridSize, sy = Math.round(el._token.y / gridSize) * gridSize;
    el.style.left = sx + 'px'; el.style.top = sy + 'px'; el._token.x = sx; el._token.y = sy;
    socket.emit('token:move', { id: el._token.id, x: sx, y: sy });
  });
  el.addEventListener('dblclick', (e) => { e.stopPropagation(); openTokenModal(el._token); });
  el.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); showTokenCtx(el._token, e.clientX, e.clientY); });
}

/* ============ TOKEN CONTEXT MENU (right-click) ============ */
let ctxMenuEl = null;
function closeTokenCtx() { if (ctxMenuEl) { ctxMenuEl.remove(); ctxMenuEl = null; } }
window.addEventListener('mousedown', (e) => { if (ctxMenuEl && !ctxMenuEl.contains(e.target)) closeTokenCtx(); });
window.addEventListener('scroll', closeTokenCtx, true);
window.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeTokenCtx(); });
function tokenHP(t) { return Number(t.hp) || 0; }
function centerOnToken(t) {
  const wrap = $('board-wrap'); if (!wrap) return;
  const s = (t.size || 1) * 64;
  wrap.scrollTo({ left: (t.x + s / 2) * zoom - wrap.clientWidth / 2, top: (t.y + s / 2) * zoom - wrap.clientHeight / 2, behavior: 'smooth' });
}
function rollDeathSave(t) {
  const d = 1 + Math.floor(Math.random() * 20);
  if (d === 20) {
    socket.emit('token:update', { id: t.id, hp: 1, dsSucc: 0, dsFail: 0 });
    socket.emit('chat', { text: `🎲 ${t.label} death save: 20 — 💚 regains 1 HP and is up!` });
    return;
  }
  let s = Math.min(3, t.dsSucc || 0), f = Math.min(3, t.dsFail || 0), msg;
  if (d === 1) { f = Math.min(3, f + 2); msg = 'nat 1 — two failures'; }
  else if (d >= 10) { s = Math.min(3, s + 1); msg = 'success'; }
  else { f = Math.min(3, f + 1); msg = 'failure'; }
  const upd = { id: t.id, dsSucc: s, dsFail: f };
  let tail = '';
  if (s >= 3) { tail = ' — stabilized'; upd.dsSucc = 0; upd.dsFail = 0; }
  else if (f >= 3) { tail = ' — has died 💀'; }
  socket.emit('token:update', upd);
  socket.emit('chat', { text: `🎲 ${t.label} death save: ${d} (${msg})${tail}` });
}
function showTokenCtx(t, px, py) {
  closeTokenCtx();
  const m = document.createElement('div');
  m.id = 'ctx-menu'; ctxMenuEl = m;
  const row = (icon, label, fn, cls) => {
    const d = document.createElement('div');
    d.className = 'ctx-item' + (cls ? ' ' + cls : '');
    d.innerHTML = `<span class="ctx-ic">${icon}</span>${label}`;
    d.onclick = (ev) => { ev.stopPropagation(); fn(); };
    m.appendChild(d);
    return d;
  };
  const hdr = document.createElement('div'); hdr.className = 'ctx-hdr';
  hdr.textContent = t.label || 'Token'; m.appendChild(hdr);
  row('✏️', 'Edit…', () => { closeTokenCtx(); openTokenModal(t); });
  if (typeof window.hasStatBlock === 'function' && window.hasStatBlock(t.label)) {
    row('📖', 'Stat block', () => { closeTokenCtx(); window.showStatBlock(t.label); });
  }
  row('💥', 'Damage…', () => {
    const n = parseInt(prompt('Damage amount:', '5')); closeTokenCtx();
    if (n > 0) socket.emit('token:update', { id: t.id, hp: Math.max(0, tokenHP(t) - n) });
  });
  row('💚', 'Heal…', () => {
    const n = parseInt(prompt('Heal amount:', '5')); closeTokenCtx();
    if (n > 0) { const mx = Number(t.maxhp) || Infinity; socket.emit('token:update', { id: t.id, hp: Math.min(mx, tokenHP(t) + n) }); }
  });
  row('🧠', 'Concentration' + (t.conc ? ' ✓' : ''), () => {
    closeTokenCtx(); socket.emit('token:update', { id: t.id, conc: !t.conc });
  });
  if (Number(t.maxhp) > 0 && Number(t.hp) === 0) {
    row('🎲', 'Death save', () => { closeTokenCtx(); rollDeathSave(t); });
  }
  // Conditions strip
  const cs2 = document.createElement('div'); cs2.className = 'ctx-conds';
  Object.entries(COND_EMOJI).forEach(([name, em]) => {
    const b = document.createElement('span');
    const on = (t.statuses || []).includes(em);
    b.className = 'ctx-cond' + (on ? ' on' : '');
    b.textContent = em; b.title = name;
    b.onclick = (ev) => {
      ev.stopPropagation();
      let st = [...(t.statuses || [])];
      if (st.includes(em)) st = st.filter((x) => x !== em); else st.push(em);
      t.statuses = st; b.classList.toggle('on');
      socket.emit('token:update', { id: t.id, statuses: st });
    };
    cs2.appendChild(b);
  });
  m.appendChild(cs2);
  row('📋', 'Duplicate', () => {
    closeTokenCtx();
    const c = { x: t.x + gridSize, y: t.y, color: t.color, label: t.label, size: t.size || 1,
      statuses: [...(t.statuses || [])], emoji: t.emoji || '', img: t.img || null,
      hp: t.hp ?? null, maxhp: t.maxhp ?? null, vision: t.vision ?? null, light: t.light ?? null };
    socket.emit('token:add', c);
  });
  row('🎯', 'Center camera', () => { closeTokenCtx(); centerOnToken(t); });
  row('🗑️', 'Delete', () => { closeTokenCtx(); if (confirm('Delete this token?')) socket.emit('token:remove', t.id); }, 'danger');
  document.body.appendChild(m);
  // Position, keeping on-screen
  const r = m.getBoundingClientRect();
  let x = px, y = py;
  if (x + r.width > innerWidth) x = innerWidth - r.width - 6;
  if (y + r.height > innerHeight) y = innerHeight - r.height - 6;
  m.style.left = Math.max(6, x) + 'px'; m.style.top = Math.max(6, y) + 'px';
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
  $('tk-link').checked = (linkedToken === t.id);
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
  // Link / unlink this token to my character sheet
  if ($('tk-link').checked) {
    linkedToken = editingToken.id;
    localStorage.setItem('dnd-link-' + me.room, linkedToken);
    if ($('tk-hp').value !== '') cs.hp = Number($('tk-hp').value);
    if ($('tk-maxhp').value !== '') cs.maxhp = Number($('tk-maxhp').value);
    saveCS(); if (csBuilt) { csPopulate(); csRecompute(); } sendPartyStatus(); syncLinkedConditions();
  } else if (linkedToken === editingToken.id) {
    linkedToken = null; localStorage.removeItem('dnd-link-' + me.room);
  }
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
let initDragId = null;
function renderInit(list, turnIndex, round) {
  const ol = $('init-list'); ol.innerHTML = '';
  list.forEach((e, i) => {
    const li = document.createElement('li');
    li.className = i === turnIndex ? 'active' : '';
    li.draggable = true; li.dataset.id = e.id;
    li.innerHTML = `<span class="ini-grip" title="Drag to reorder">⠿</span><span class="ini">${e.init}</span> <span class="nm">${escapeHtml(e.name)}</span> <button class="ini-x" title="Remove">✕</button>`;
    li.querySelector('.ini-x').onclick = () => socket.emit('init:remove', e.id);
    li.addEventListener('dragstart', (ev) => { initDragId = e.id; li.classList.add('dragging'); ev.dataTransfer.effectAllowed = 'move'; });
    li.addEventListener('dragend', () => { li.classList.remove('dragging'); document.querySelectorAll('#init-list li').forEach((x) => x.classList.remove('drop-into')); });
    li.addEventListener('dragover', (ev) => { ev.preventDefault(); ev.dataTransfer.dropEffect = 'move'; li.classList.add('drop-into'); });
    li.addEventListener('dragleave', () => li.classList.remove('drop-into'));
    li.addEventListener('drop', (ev) => {
      ev.preventDefault(); li.classList.remove('drop-into');
      if (!initDragId || initDragId === e.id) return;
      const ids = [...document.querySelectorAll('#init-list li')].map((x) => x.dataset.id);
      const from = ids.indexOf(initDragId); ids.splice(from, 1);
      const to = ids.indexOf(e.id);
      ids.splice(to, 0, initDragId);
      socket.emit('init:reorder', ids);
      initDragId = null;
    });
    ol.appendChild(li);
  });
  const key = (round || 1) + ':' + turnIndex;
  if (key !== combat._key) { combat.turnStart = Date.now(); combat._key = key; }
  combat.list = list; combat.turnIndex = turnIndex; combat.round = round || 1;
  updateTurnBanner();
  highlightActiveToken();
}
function highlightActiveToken() {
  const name = combat.list.length ? combat.list[combat.turnIndex].name : null;
  Object.values(tokenEls).forEach((el) => {
    el.classList.toggle('active-turn', !!name && el._token && el._token.label === name);
  });
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
const CS_NUMF = ['level','ac','speed','hp','maxhp','temphp','hitDiceUsed','cp','sp','ep','gp','pp'];

function csDefault() {
  return { name:'', pronouns:'', race:'', cls:'', level:1, background:'', inspiration:false,
    ac:10, speed:30, hp:10, maxhp:10, temphp:0,
    scores:{str:10,dex:10,con:10,int:10,wis:10,cha:10},
    saves:{}, skills:{}, attacks:[], conditions:[], notes:'',
    resistances:'', senses:'', proficiencies:'', spells:'', inventory:'', features:'',
    slots:{1:{max:0,used:0},2:{max:0,used:0},3:{max:0,used:0},4:{max:0,used:0},5:{max:0,used:0},6:{max:0,used:0},7:{max:0,used:0},8:{max:0,used:0},9:{max:0,used:0}},
    deathSucc:0, deathFail:0, hitDiceTotal:'', hitDiceUsed:0, cp:0, sp:0, ep:0, gp:0, pp:0 };
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
// Export / import character to a portable JSON file
$('cs-export').onclick = () => {
  const safe = String(cs.name || 'character').replace(/[^\w-]+/g, '_') || 'character';
  const blob = new Blob([JSON.stringify(cs, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = 'character-' + safe + '.json';
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(a.href);
};
$('cs-import-btn').onclick = () => $('cs-import-file').click();
$('cs-import-file').onchange = (e) => {
  const f = e.target.files[0]; if (!f) return;
  const rd = new FileReader();
  rd.onload = () => {
    const backup = cs;
    try {
      const obj = JSON.parse(rd.result);
      if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('bad');
      cs = Object.assign(csDefault(), obj);            // merge onto defaults so missing keys are safe
      cs.scores = Object.assign(csDefault().scores, obj.scores || {});
      cs.slots = Object.assign(csDefault().slots, obj.slots || {});
      saveCS();
      if (!csBuilt) buildCS();
      csPopulate(); csRecompute(); csRenderAttacks();
      sendPartyStatus(); syncLinkedConditions();
    } catch (err) { cs = backup; alert('That does not look like a valid character file.'); }
    e.target.value = '';
  };
  rd.readAsText(f);
};

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
      <div class="cs-rest">
        <button data-rest="short" class="cs-short">☕ Short Rest</button>
        <button data-rest="long" class="cs-long">🌙 Long Rest</button>
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
      <div class="cs-sec"><div class="cs-sec-t">Abilities</div><div class="cs-abils">${abilCards}</div>
        <div class="cs-hint">Click to roll · Shift-click = advantage · Ctrl-click = disadvantage</div></div>
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
  const deathPips = (t) => [0,1,2].map((i) => `<button class="cs-dpip ${t}" data-death="${t}:${i}"></button>`).join('');
  h.push(`<div class="cs-grid cs-grid3">
    <div class="cs-sec"><div class="cs-sec-t">Spell Slots</div><div id="cs-slots" class="cs-slots"></div></div>
    <div class="cs-sec">
      <div class="cs-sec-t">Death Saves</div>
      <div class="cs-death"><span>Successes</span><div class="cs-dpips">${deathPips('succ')}</div></div>
      <div class="cs-death"><span>Failures</span><div class="cs-dpips">${deathPips('fail')}</div></div>
      <div class="cs-sec-t" style="margin-top:12px">Hit Dice</div>
      <div class="cs-hitdice">
        <label>Total <input data-cs="hitDiceTotal" placeholder="8d8" /></label>
        <label>Used <input data-cs="hitDiceUsed" type="number" /></label>
      </div>
    </div>
    <div class="cs-sec">
      <div class="cs-sec-t">Currency</div>
      <div class="cs-coins">
        <label>CP <input data-cs="cp" type="number" /></label>
        <label>SP <input data-cs="sp" type="number" /></label>
        <label>EP <input data-cs="ep" type="number" /></label>
        <label>GP <input data-cs="gp" type="number" /></label>
        <label>PP <input data-cs="pp" type="number" /></label>
      </div>
    </div>
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
  csRenderSlots(); csPopulateDeath();
}
function csRenderSlots() {
  const box = $('cs-slots'); if (!box) return;
  let h = '';
  for (let l = 1; l <= 9; l++) {
    const s = cs.slots[l] || { max: 0, used: 0 };
    const pips = s.max > 0 ? Array.from({ length: s.max }, (_, i) => `<button class="cs-pip ${i < s.used ? 'on' : ''}" data-slot="${l}:${i}"></button>`).join('') : '<span class="cs-empty">—</span>';
    h += `<div class="cs-slotrow"><span class="cs-slotlvl">${l}</span><input class="cs-slotmax" type="number" min="0" max="9" data-slotmax="${l}" value="${s.max}" /><div class="cs-pips">${pips}</div></div>`;
  }
  box.innerHTML = h;
}
function csPopulateDeath() {
  const body = $('cs-body'); if (!body) return;
  body.querySelectorAll('[data-death]').forEach((el) => {
    const [t, i] = el.dataset.death.split(':');
    const n = t === 'succ' ? cs.deathSucc : cs.deathFail;
    el.classList.toggle('on', Number(i) < n);
  });
}

function csOnChange(e) {
  const el = e.target;
  if (el.dataset.cs !== undefined) { const f = el.dataset.cs; cs[f] = CS_NUMF.includes(f) ? Number(el.value) || 0 : el.value; if (['name','hp','maxhp','ac'].includes(f)) sendPartyStatusDebounced(); }
  else if (el.dataset.score !== undefined) cs.scores[el.dataset.score] = Number(el.value) || 0;
  else if (el.dataset.save !== undefined) cs.saves[el.dataset.save] = el.checked;
  else if (el.dataset.skill !== undefined) cs.skills[el.dataset.skill] = el.checked;
  else if (el.dataset.slotmax !== undefined) {
    const l = el.dataset.slotmax, m = Math.max(0, Math.min(9, Number(el.value) || 0));
    cs.slots[l] = cs.slots[l] || { max: 0, used: 0 }; cs.slots[l].max = m;
    if (cs.slots[l].used > m) cs.slots[l].used = m;
    saveCS(); if (e.type === 'change') csRenderSlots(); return;
  }
  else return;
  csRecompute(); saveCS();
}

function csOnClick(e) {
  const rollEl = e.target.closest('[data-roll]');
  if (rollEl) { csRoll(rollEl.dataset.roll, e); return; }
  const insp = e.target.closest('[data-insp]');
  if (insp) { cs.inspiration = !cs.inspiration; insp.classList.toggle('on', cs.inspiration); saveCS(); return; }
  const cond = e.target.closest('[data-cond]');
  if (cond) { const c = cond.dataset.cond; if (cs.conditions.includes(c)) cs.conditions = cs.conditions.filter((x) => x !== c); else cs.conditions.push(c); cond.classList.toggle('on'); saveCS(); syncLinkedConditions(); return; }
  const slot = e.target.closest('[data-slot]');
  if (slot) { const [l, i] = slot.dataset.slot.split(':'); const s = cs.slots[l]; if (!s) return; const idx = Number(i); s.used = idx < s.used ? idx : idx + 1; csRenderSlots(); saveCS(); return; }
  const dp = e.target.closest('[data-death]');
  if (dp) { const [t, i] = dp.dataset.death.split(':'); const idx = Number(i); const cur = t === 'succ' ? cs.deathSucc : cs.deathFail; const nv = idx < cur ? idx : idx + 1; if (t === 'succ') cs.deathSucc = nv; else cs.deathFail = nv; csPopulateDeath(); saveCS(); return; }
  const hp = e.target.closest('[data-hp]');
  if (hp) {
    const amt = Math.abs(Number($('cs-hp-amt').value) || 0);
    if (hp.dataset.hp === 'heal') cs.hp = Math.min(Number(cs.maxhp || 0), Number(cs.hp || 0) + amt);
    else { let rem = amt; const t = Number(cs.temphp || 0); const used = Math.min(t, rem); cs.temphp = t - used; rem -= used; cs.hp = Math.max(0, Number(cs.hp || 0) - rem); }
    csPopulate(); saveCS(); sendPartyStatus(); return;
  }
  const rest = e.target.closest('[data-rest]');
  if (rest) { doRest(rest.dataset.rest); return; }
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

function doRest(type) {
  const announce = (text) => socket.emit('chat', { text: `🛌 ${text}` });
  if (type === 'long') {
    cs.hp = Number(cs.maxhp) || cs.hp; cs.temphp = 0;
    for (let l = 1; l <= 9; l++) if (cs.slots[l]) cs.slots[l].used = 0;
    cs.deathSucc = 0; cs.deathFail = 0;
    const total = parseInt(cs.hitDiceTotal) || 0;
    if (total > 0) cs.hitDiceUsed = Math.max(0, (Number(cs.hitDiceUsed) || 0) - Math.max(1, Math.floor(total / 2)));
    csPopulate(); csRecompute(); saveCS(); sendPartyStatus();
    announce('takes a long rest — HP and spell slots restored, half of hit dice recovered.');
  } else {
    cs.deathSucc = 0; cs.deathFail = 0;
    const total = parseInt(cs.hitDiceTotal) || 0;
    const m = (cs.hitDiceTotal || '').match(/d(\d+)/i); const die = m ? parseInt(m[1]) : 8;
    const used = Number(cs.hitDiceUsed) || 0;
    let msg = 'takes a short rest.';
    if (total > 0 && used < total && Number(cs.hp) < Number(cs.maxhp)) {
      const conMod = csMod(cs.scores.con), roll = 1 + Math.floor(Math.random() * die);
      const heal = Math.max(0, roll + conMod);
      cs.hp = Math.min(Number(cs.maxhp) || 0, (Number(cs.hp) || 0) + heal);
      cs.hitDiceUsed = used + 1;
      msg = `takes a short rest, spending a hit die (d${die} ${csFmt(conMod)} = ${heal} HP recovered).`;
    }
    csPopulate(); csRecompute(); saveCS(); sendPartyStatus();
    announce(msg);
  }
}

function csRoll(spec, ev) {
  const [type, key] = spec.split(':');
  const prof = csProf();
  let label = '', mod = 0;
  if (type === 'ability') { label = CS_ABILN[key] + ' check'; mod = csMod(cs.scores[key]); }
  else if (type === 'save') { label = CS_ABILN[key] + ' save'; mod = csMod(cs.scores[key]) + (cs.saves[key] ? prof : 0); }
  else if (type === 'skill') { const ab = Object.fromEntries(CS_SKILLS)[key]; label = key; mod = csMod(cs.scores[ab]) + (cs.skills[key] ? prof : 0); }
  else if (type === 'init') { label = 'Initiative'; mod = csMod(cs.scores.dex); }
  else if (type === 'atk') { const a = cs.attacks[Number(key)]; if (!a) return; label = a.name + ' to hit'; mod = Number(a.bonus) || 0; }
  const adv = ev && ev.shiftKey, dis = ev && (ev.ctrlKey || ev.metaKey || ev.altKey);
  let r, tag = '';
  if (adv || dis) {
    const x = 1 + Math.floor(Math.random() * 20), y = 1 + Math.floor(Math.random() * 20);
    r = adv ? Math.max(x, y) : Math.min(x, y);
    tag = adv ? ` ADV[${x},${y}]` : ` DIS[${x},${y}]`;
  } else r = 1 + Math.floor(Math.random() * 20);
  socket.emit('roll', { formula: (cs.name ? cs.name + ' — ' : '') + label, result: r + mod, detail: `d20[${r}]${tag} ${csFmt(mod)}` });
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
$('aoe-apply').onclick = () => {
  const a = aoes[aoes.length - 1];
  if (!a) { alert('Place a spell area first, then Apply.'); return; }
  const dmg = Math.abs(Number($('aoe-dmg').value) || 0);
  if (!dmg) { alert('Enter a damage amount.'); return; }
  const saveHalf = $('aoe-save').checked;
  const dc = Number($('aoe-dc').value) || 0;
  const sb = Number($('aoe-savebonus').value) || 0;
  let hit = 0; const notes = [];
  Object.values(tokenEls).forEach((el) => {
    const t = el._token; if (!t || !(Number(t.maxhp) > 0)) return;
    const cx = t.x + (t.size || 1) * 32, cy = t.y + (t.size || 1) * 32;
    if (!pointInAoe(a, cx, cy)) return;
    let applied = dmg;
    if (saveHalf && dc > 0) {
      const roll = 1 + Math.floor(Math.random() * 20), total = roll + sb;
      if (total >= dc) { applied = Math.floor(dmg / 2); notes.push(`${t.label || 'token'} saved (${total}≥${dc}) → ${applied}`); }
      else notes.push(`${t.label || 'token'} failed (${total}<${dc}) → ${applied}`);
    }
    socket.emit('token:update', { id: t.id, hp: Math.max(0, (Number(t.hp) || 0) - applied) });
    hit++;
  });
  const detail = notes.length ? ' — ' + notes.join('; ') : '';
  socket.emit('chat', { text: `💥 Area effect: ${hit} token${hit === 1 ? '' : 's'} hit for up to ${dmg}${saveHalf && dc ? ` (DC ${dc} save for half)` : ''}.${detail}` });
};

function distToSeg(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1, l2 = dx * dx + dy * dy;
  let tt = l2 ? ((px - x1) * dx + (py - y1) * dy) / l2 : 0;
  tt = Math.max(0, Math.min(1, tt));
  return Math.hypot(px - (x1 + tt * dx), py - (y1 + tt * dy));
}
function pointInTri(px, py, a, b, c) {
  const d1 = (px - b.x) * (a.y - b.y) - (a.x - b.x) * (py - b.y);
  const d2 = (px - c.x) * (b.y - c.y) - (b.x - c.x) * (py - c.y);
  const d3 = (px - a.x) * (c.y - a.y) - (c.x - a.x) * (py - a.y);
  const neg = d1 < 0 || d2 < 0 || d3 < 0, pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
}
function pointInAoe(a, px, py) {
  if (a.type === 'circle') return Math.hypot(px - a.x, py - a.y) <= ft2px(a.size);
  if (a.type === 'line') return distToSeg(px, py, a.x, a.y, a.x2, a.y2) <= ft2px(5) / 2;
  const dx = a.x2 - a.x, dy = a.y2 - a.y, len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len, pxp = -uy, pyp = ux, half = len * 0.5;
  const bx = a.x + ux * len, by = a.y + uy * len;
  return pointInTri(px, py, { x: a.x, y: a.y }, { x: bx + pxp * half, y: by + pyp * half }, { x: bx - pxp * half, y: by - pyp * half });
}

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

/* ============ RAIL TOOLTIPS ============ */
(function () {
  const tip = document.createElement('div');
  tip.id = 'rail-tip'; tip.style.cssText = 'position:fixed;z-index:60;pointer-events:none;opacity:0;transition:opacity .1s;background:#0e1013;color:#f0e6d2;border:1px solid #2a2e37;border-radius:8px;padding:6px 10px;font-size:12px;white-space:nowrap;box-shadow:0 6px 18px rgba(0,0,0,0.5);font-family:"EB Garamond",serif;';
  document.body.appendChild(tip);
  function show(el) {
    const t = el.getAttribute('title'); if (!t) return;
    tip.textContent = t;
    const r = el.getBoundingClientRect();
    tip.style.left = (r.right + 10) + 'px';
    tip.style.top = (r.top + r.height / 2 - 14) + 'px';
    tip.style.opacity = '1';
  }
  function hide() { tip.style.opacity = '0'; }
  document.addEventListener('mouseover', (e) => { const b = e.target.closest('.topbar-actions button.ghost'); if (b) show(b); });
  document.addEventListener('mouseout', (e) => { if (e.target.closest('.topbar-actions button.ghost')) hide(); });
})();

/* ============ helpers ============ */
let _psTimer = null;
function sendPartyStatusDebounced() { if (_psTimer) return; _psTimer = setTimeout(() => { _psTimer = null; sendPartyStatus(); }, 600); }
function initials(name) { return name.split(/\s+/).map((w) => w[0]).join('').slice(0, 3).toUpperCase(); }
function escapeHtml(s) { return (s || '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }
