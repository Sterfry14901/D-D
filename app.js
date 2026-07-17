/* D&D VTT client. Talks to the server over Socket.io. */
const socket = io();
const $ = (id) => document.getElementById(id);
// Let other scripts (bestiary.js) post to the shared chat/roll log.
window.emitChat = (text) => socket.emit('chat', { text });

let me = { id: null, name: '', color: '#c0392b', room: '', isGm: false };
let lastWhisperFrom = null;   // most recent person who whispered me (for /reply)
let gridSize = 70;
let zoom = 1;
const BOARD_W = 2100, BOARD_H = 1400;
const tokenEls = {};       // id -> element
let fog = { active: false, hidden: {} };
let fogMode = false;        // GM painting mode
let fogPaintHide = true;    // paint hides (true) or reveals (false)
let fogPainting = false;
let fogBrush = 1;           // brush size in cells (odd: 1, 3, 5)
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

// Prefill the room from an invite link (?room=NAME).
(function () {
  try {
    const r = new URLSearchParams(location.search).get('room');
    if (r && $('join-room')) $('join-room').value = r;
  } catch {}
})();

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
  applyOrigin();
  linkedToken = localStorage.getItem('dnd-link-' + me.room) || null;
  sendPartyStatus();
}

/* Character creation at join: apply Class / Species / Background picks (SRD 5.2.1)
   to the character sheet so a new hero is playable immediately. */
function applyOrigin() {
  if (!window.SRD) return;
  const clsName = ($('join-class') || {}).value || '';
  const spName = ($('join-species') || {}).value || '';
  const bgName = ($('join-bg') || {}).value || '';
  const scoreMode = ($('join-scores') || {}).value || '';
  if (!clsName && !spName && !bgName && !scoreMode) return;   // nothing chosen — keep existing sheet
  const cls = window.SRD.classes[clsName];
  const sp = window.SRD.species[spName];
  const bg = window.SRD.backgrounds[bgName];

  // Ability scores: standard array or 4d6-drop-lowest, best values into the
  // class's primary abilities, then CON, then the rest.
  let scoreLine = '';
  if (scoreMode) {
    let set;
    if (scoreMode === 'array') set = [15, 14, 13, 12, 10, 8];
    else {
      set = [];
      for (let i = 0; i < 6; i++) {
        const d = [0, 0, 0, 0].map(() => 1 + Math.floor(Math.random() * 6)).sort((a, b) => a - b);
        set.push(d[1] + d[2] + d[3]);
      }
    }
    set.sort((a, b) => b - a);
    const all = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
    const order = [];
    (cls && cls.prim ? cls.prim : []).forEach((k) => { if (!order.includes(k)) order.push(k); });
    if (!order.includes('con')) order.push('con');
    if (!order.includes('dex')) order.push('dex');
    all.forEach((k) => { if (!order.includes(k)) order.push(k); });
    order.forEach((k, i) => { cs.scores[k] = set[i]; });
    scoreLine = all.map((k) => k.toUpperCase() + ' ' + cs.scores[k]).join(' · ');
  }

  // Background ability score increases (2024 rules: +2/+1 to the background's abilities).
  // Applied after the base array/roll so the sheet is fully rules-correct.
  let abilLine = '';
  if (bg && scoreMode && window.SRD && typeof window.SRD.saveKeys === 'function') {
    const bgKeys = window.SRD.saveKeys(bg.abilities);
    if (bgKeys.length) {
      // +2 to the class-primary background ability if present, else the first listed; +1 to the next.
      const primFirst = bgKeys.slice().sort((a, b) => ((cls && cls.prim || []).includes(b) ? 1 : 0) - ((cls && cls.prim || []).includes(a) ? 1 : 0));
      cs.scores[primFirst[0]] = Math.min(20, (Number(cs.scores[primFirst[0]]) || 10) + 2);
      if (primFirst[1]) cs.scores[primFirst[1]] = Math.min(20, (Number(cs.scores[primFirst[1]]) || 10) + 1);
      abilLine = `+2 ${primFirst[0].toUpperCase()}${primFirst[1] ? ', +1 ' + primFirst[1].toUpperCase() : ''} (from ${bgName})`;
    }
  }

  cs.name = me.name;
  if (clsName) cs.cls = clsName;
  if (spName) cs.race = spName;
  if (bgName) cs.background = bgName;
  if (cls) {
    cs.level = 1;
    const conMod = Math.floor((Number(cs.scores.con || 10) - 10) / 2);
    cs.maxhp = Math.max(1, cls.hd + conMod);
    cs.hp = cs.maxhp;
    cs.hitDiceTotal = '1d' + cls.hd;
    cs.hitDiceUsed = 0;
    cs.saves = {}; cls.saves.forEach((k) => cs.saves[k] = true);
    const profBits = ['Weapons: ' + cls.weapons, 'Armor: ' + cls.armor];
    if (cls.tools && cls.tools !== '—') profBits.push('Tools: ' + cls.tools);
    if (bg && bg.tool) profBits.push('Background tool: ' + bg.tool);
    cs.proficiencies = profBits.join('\n');
    cs.inventory = cls.equipA;
    let feats = clsName + ' 1 — ' + cls.sig;
    if (sp) feats += '\n\n' + spName + ' traits — ' + sp.traits;
    if (bg) feats += '\n\n' + bgName + ' background — Origin feat: ' + bg.feat + '. Increase ' + bg.abilities + ' (one by 2 & one by 1, or all three by 1).';
    cs.features = feats;
    cs.notes = (cs.notes ? cs.notes + '\n' : '') + 'Class skills — ' + cls.skills;
    // Auto-pick the class's "Choose N" skills so the sheet is ready to play.
    // Prefer skills tied to the class's key abilities; skip any already granted by the background.
    if (cls.skillPick && cls.skillList && cls.skillList.length) {
      const SKILL_ABIL = { Acrobatics: 'dex', 'Animal Handling': 'wis', Arcana: 'int', Athletics: 'str', Deception: 'cha', History: 'int', Insight: 'wis', Intimidation: 'cha', Investigation: 'int', Medicine: 'wis', Nature: 'int', Perception: 'wis', Performance: 'cha', Persuasion: 'cha', Religion: 'int', 'Sleight of Hand': 'dex', Stealth: 'dex', Survival: 'wis' };
      const bgSkills = (bg && bg.skills) || [];
      const key = (cls.prim || []);
      const ranked = cls.skillList.slice()
        .filter((s) => !bgSkills.includes(s))
        .sort((a, b) => (key.includes(SKILL_ABIL[b]) ? 1 : 0) - (key.includes(SKILL_ABIL[a]) ? 1 : 0));
      ranked.slice(0, cls.skillPick).forEach((s) => cs.skills[s] = true);
    }
    // Senses & Defenses auto-filled from species + class
    const senseBits = [];
    if (sp && sp.senses) senseBits.push(sp.senses);
    cs.senses = senseBits.join('\n');
    const defBits = [];
    if (sp && sp.defenses) defBits.push(sp.defenses);
    if (window.SRD.classDefenses && window.SRD.classDefenses[clsName]) defBits.push(window.SRD.classDefenses[clsName]);
    cs.resistances = defBits.join('\n');
    // Level-1 spell slots + casting ability for casters (2024 rules)
    if (cls.slots1 > 0) {
      cs.slots[1] = { max: cls.slots1, used: 0 };
      cs.spells = 'Spellcasting ability: ' + cls.castAbil + '\n' + (cs.spells || '');
    }
    // Starting attacks from the class kit — to-hit = ability mod + proficiency (+2 at L1)
    if (window.SRD.weapons && cls.atk && cls.atk.length) {
      const mod = (k) => Math.floor((Number(cs.scores[k] || 10) - 10) / 2);
      cs.attacks = cls.atk.map((w) => {
        const wd = window.SRD.weapons[w]; if (!wd) return null;
        const am = wd.rng ? mod('dex') : wd.fin ? Math.max(mod('str'), mod('dex')) : mod('str');
        const extra = wd.rng ? ` ${wd.rng} ft` : wd.thrown ? ` (thrown ${wd.thrown} ft)` : '';
        return { name: `${w} — ${wd.type}${extra}`, bonus: am + 2, dmg: wd.die + (am ? (am > 0 ? '+' + am : am) : '') };
      }).filter(Boolean);
    }
  }
  if (sp) cs.speed = sp.speed;
  if (bg) bg.skills.forEach((s) => cs.skills[s] = true);
  saveCS();
  // Mirror the basics onto the quick sheet
  if ($('sh-name')) $('sh-name').value = cs.name;
  if ($('sh-class') && clsName) $('sh-class').value = clsName;
  if ($('sh-level') && clsName) $('sh-level').value = 1;
  if ($('sh-race') && spName) $('sh-race').value = spName;
  if ($('sh-hp') && cls) $('sh-hp').value = cs.hp;
  if ($('sh-maxhp') && cls) $('sh-maxhp').value = cs.maxhp;
  if (scoreMode) {
    ['str', 'dex', 'con', 'int', 'wis', 'cha'].forEach((k) => { const el = $('ab-' + k); if (el) el.value = cs.scores[k]; });
    if (typeof updateMods === 'function') updateMods();
  }
  if (typeof saveSheet === 'function') saveSheet();
  if (csBuilt) { csPopulate(); csRecompute(); csRenderAttacks(); }
  const bits = [clsName, spName, bgName].filter(Boolean).join(' · ');
  const finalLine = scoreLine ? ['str', 'dex', 'con', 'int', 'wis', 'cha'].map((k) => k.toUpperCase() + ' ' + cs.scores[k]).join(' · ') : '';
  const tail = finalLine ? ` — ${finalLine}${abilLine ? ' [' + abilLine + ']' : ''}` : '';
  socket.emit('chat', { text: `🧝 ${me.name} enters as a level 1 ${bits || 'adventurer'}.${tail}` });
}

// Copy an invite link to this table.
if ($('invite-btn')) $('invite-btn').onclick = async () => {
  const url = location.origin + location.pathname + '?room=' + encodeURIComponent(me.room || 'default');
  const btn = $('invite-btn'), orig = btn.textContent;
  try { await navigator.clipboard.writeText(url); btn.textContent = '✅ Link copied'; }
  catch { window.prompt('Copy this invite link:', url); btn.textContent = orig; }
  setTimeout(() => { btn.textContent = orig; }, 1800);
};

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
    level: cs ? Math.max(1, Math.min(20, Number(cs.level) || 1)) : 1,
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

/* Voice dictation into the journal (Web Speech API — Chrome/Edge). */
(function () {
  const btn = $('journal-rec'); if (!btn) return;
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { btn.title = 'Voice dictation needs Chrome or Edge.'; btn.style.opacity = '.5'; }
  let rec = null, recOn = false;
  btn.onclick = () => {
    if (!SR) { alert('Voice dictation is not supported in this browser — try Chrome or Edge.'); return; }
    if (recOn) { rec.stop(); return; }
    rec = new SR();
    rec.continuous = true; rec.interimResults = false; rec.lang = 'en-US';
    rec.onresult = (e) => {
      const ta = $('journal-text'); if (!ta) return;
      let text = '';
      for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) text += e.results[i][0].transcript;
      if (!text.trim()) return;
      const sep = ta.value && !/\s$/.test(ta.value) ? ' ' : '';
      ta.value += sep + text.trim();
      ta.dispatchEvent(new Event('input', { bubbles: true }));   // reuse the normal sync/save path
    };
    rec.onstart = () => { recOn = true; btn.textContent = '⏺ Recording…'; btn.classList.add('on'); flashHint('🎤 Dictating into the journal — click again to stop'); };
    rec.onend = () => { recOn = false; btn.textContent = '🎤 Rec'; btn.classList.remove('on'); };
    rec.onerror = (e) => { recOn = false; btn.textContent = '🎤 Rec'; btn.classList.remove('on'); if (e.error === 'not-allowed') alert('Microphone access denied.'); };
    rec.start();
  };
})();

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
  drawings = s.drawings || [];
  renderDrawings();
  if (s.handout) showHandout(s.handout); else hideHandout();
  setWeather(s.weather || 'clear');
  if (s.ambience && s.ambience !== 'off') { ambSyncUI(s.ambience); AMB.set(s.ambience); }
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
  // Only auto-scroll if the reader is already near the bottom (don't yank them
  // away while they scroll back through history).
  const atBottom = (log.scrollHeight - log.scrollTop - log.clientHeight) < 60;
  const div = document.createElement('div');
  div.className = 'msg ' + (m.role || 'player');
  if (m.role === 'system') div.textContent = m.text;
  else if (m.role === 'whisper') {
    if (m.author && m.author !== me.name) lastWhisperFrom = m.author;
    div.innerHTML = `<span class="who">🔒 ${escapeHtml(m.author)} <em class="wto">${escapeHtml(m.whisperTo || '')}</em></span>${escapeHtml(m.text)}`;
  }
  else div.innerHTML = `<span class="who">${escapeHtml(m.author)}</span>${escapeHtml(m.text)}`;
  log.appendChild(div);
  if (atBottom || (m.author && m.author === me.name)) log.scrollTop = log.scrollHeight;
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
  const cmd = text.match(/^\/(?:roll|r)\s+(.+)$/i);
  if (cmd) { chatRoll(cmd[1]); $('chat-input').value = ''; return; }
  const rm = text.match(/^\/(?:reply|wr)\b\s*(.*)$/i);
  if (rm) {
    const body = (rm[1] || '').trim();
    if (!body) { addChat({ role: 'system', text: 'Usage: /reply <message>' }); }
    else if (!lastWhisperFrom) { addChat({ role: 'system', text: 'No one has whispered you yet.' }); }
    else { socket.emit('chat:whisper', { to: lastWhisperFrom, text: body }); }
    $('chat-input').value = ''; return;
  }
  const wm = text.match(/^\/(?:w|whisper|gm)\b\s*(.*)$/i);
  if (wm) { chatWhisper(wm[1]); $('chat-input').value = ''; return; }
  socket.emit('chat', { text }); $('chat-input').value = '';
}
// Private whisper: player → GM with /w <message>; GM → player with /w <name> <message> or /w <name>: <message>.
function chatWhisper(rest) {
  rest = (rest || '').trim();
  let to = '';
  if (me.isGm) {
    const c = rest.match(/^([^:]+):\s*(.+)$/);
    if (c) { to = c[1].trim(); rest = c[2].trim(); }
    else { const sp = rest.match(/^(\S+)\s+(.+)$/); if (sp) { to = sp[1]; rest = sp[2].trim(); } }
  }
  if (!rest) { addChat({ role: 'system', text: me.isGm ? 'Usage: /w <player> <message>' : 'Usage: /w <message to the GM>' }); return; }
  socket.emit('chat:whisper', { to, text: rest });
}

// Roll20-style /roll parser in the chat box: /roll 2d6+3, /r 1d20 adv, /roll d100
function chatRoll(expr) {
  const advm = /\b(adv|advantage)\b/i.test(expr);
  const dism = /\b(dis|disadvantage)\b/i.test(expr);
  const clean = expr.replace(/\b(adv|advantage|dis|disadvantage)\b/ig, '').trim();
  const m = clean.match(/^(\d*)\s*d\s*(\d+)\s*([+-]\s*\d+)?$/i);
  if (!m) { socket.emit('chat', { text: `⚠️ ${me.name}: couldn't parse "/roll ${expr}". Try 2d6+3, 1d20 adv, or d100.` }); return; }
  const count = parseInt(m[1] || '1'), sides = parseInt(m[2]), bonus = parseInt((m[3] || '0').replace(/\s/g, ''));
  if (count < 1 || count > 100 || sides < 2 || sides > 1000) { socket.emit('chat', { text: `⚠️ ${me.name}: dice out of range (1–100 dice, 2–1000 sides).` }); return; }
  let total = 0, detail = '';
  if (sides === 20 && count === 1 && (advm || dism)) {
    const a = rollDie(20), b = rollDie(20), pick = advm ? Math.max(a, b) : Math.min(a, b);
    total = pick + bonus; detail = `${advm ? 'ADV' : 'DIS'} [${a},${b}]→${pick}${bonus ? fmtMod(bonus) : ''}`;
  } else {
    const rolls = []; for (let i = 0; i < count; i++) { const r = rollDie(sides); rolls.push(r); total += r; }
    total += bonus; detail = `[${rolls.join(',')}]${bonus ? fmtMod(bonus) : ''}`;
  }
  const label = `${count}d${sides}${bonus ? fmtMod(bonus) : ''}${advm ? ' adv' : dism ? ' dis' : ''}`;
  socket.emit('roll', { formula: (me.name ? me.name + ' — ' : '') + label, result: total, detail });
}
$('dm-btn').onclick = () => { socket.emit('dm:ask', { text: $('chat-input').value.trim() }); $('chat-input').value = ''; };
document.querySelectorAll('.dm-quick button').forEach((b) => {
  b.onclick = () => socket.emit('dm:ask', { text: b.dataset.dm });
});

/* ============ DICE ============ */
document.querySelectorAll('.die').forEach((b) => { b.onclick = () => rollFormula(`1d${b.dataset.die}`); });
// One-tap dice-tray presets (advantage/disadvantage + common formulas).
document.querySelectorAll('#dice-presets button').forEach((b) => {
  b.onclick = () => {
    const p = b.dataset.preset;
    if (p === 'adv' || p === 'dis') {
      $('adv').checked = (p === 'adv'); $('dis').checked = (p === 'dis');
      rollFormula('1d20');
      $('adv').checked = false; $('dis').checked = false;
    } else {
      rollFormula(p);
    }
  };
});
$('dice-roll').onclick = () => rollFormula($('dice-formula').value.trim() || '1d20');
$('dice-formula').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('dice-roll').click(); });
function rollDie(s) { return Math.floor(Math.random() * s) + 1; }
/* ============ SAVED ROLL MACROS (Roll20-style) ============ */
function loadMacros() { try { return JSON.parse(localStorage.getItem('dnd-macros') || '[]'); } catch { return []; } }
function saveMacros(a) { try { localStorage.setItem('dnd-macros', JSON.stringify(a)); } catch {} }
function renderMacros() {
  const list = $('macro-list'); if (!list) return;
  const macros = loadMacros();
  list.innerHTML = '';
  if (!macros.length) { list.innerHTML = '<span class="macro-empty">No saved rolls yet — add one below (e.g. Longsword · 1d20+5).</span>'; return; }
  macros.forEach((mac, i) => {
    const b = document.createElement('button'); b.className = 'macro-btn';
    b.innerHTML = `<span class="mac-n">${escapeHtml(mac.name)}</span><em>${escapeHtml(mac.formula)}</em><span class="macro-x" title="Delete">✕</span>`;
    b.onclick = () => { const inp = $('dice-formula'); if (inp) inp.value = mac.formula; rollFormula(mac.formula); };
    b.querySelector('.macro-x').onclick = (e) => { e.stopPropagation(); const a = loadMacros(); a.splice(i, 1); saveMacros(a); renderMacros(); };
    list.appendChild(b);
  });
}
if ($('macro-save')) $('macro-save').onclick = () => {
  const name = $('macro-name').value.trim(), formula = $('macro-formula').value.trim().replace(/\s+/g, '');
  if (!name || !formula) return;
  if (!/^\d*d\d+([+-]\d+)?$/i.test(formula)) { alert('Use a formula like 1d20+5, 2d6+3, or d20.'); return; }
  const a = loadMacros(); a.push({ name, formula }); saveMacros(a);
  $('macro-name').value = ''; $('macro-formula').value = ''; renderMacros();
};
if ($('macro-name')) $('macro-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('macro-formula').focus(); });
if ($('macro-formula')) $('macro-formula').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('macro-save').click(); });
renderMacros();

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
    statuses: [], emoji: m.e, hp: m.hp, maxhp: m.hp, cr: m.cr,
  });
}
buildMonsters();

/* ============ OPEN5E LIVE MONSTER SEARCH ============ */
(function () {
  const q = $('o5e-q'), go = $('o5e-go'), grid = $('o5e-grid');
  if (!q || !go || !grid) return;
  const TYPE_E = { dragon: '🐉', undead: '💀', fiend: '😈', beast: '🐾', humanoid: '🧑', giant: '🗻', aberration: '🦑', celestial: '👼', construct: '🗿', elemental: '🌪️', fey: '🧚', monstrosity: '🐲', ooze: '🟩', plant: '🌿' };
  const SIZE_N = { tiny: 1, small: 1, medium: 1, large: 2, huge: 3, gargantuan: 4 };
  function o5eBlock(m) {
    const A = ['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma'];
    const sp = m.speed ? Object.entries(m.speed).filter((e) => typeof e[1] === 'number').map((e) => (e[0] === 'walk' ? '' : e[0] + ' ') + e[1] + ' ft').join(', ') : '—';
    return {
      m: ((m.size || '') + ' ' + (m.type || '') + (m.alignment ? ', ' + m.alignment : '')).trim(),
      ac: m.armor_class, hp: m.hit_points + (m.hit_dice ? ' (' + m.hit_dice + ')' : ''), sp: sp || '—',
      a: A.map((k) => m[k] || 10),
      sen: m.senses || '—', cr: m.challenge_rating,
      tr: (m.special_abilities || []).map((x) => [x.name, x.desc]),
      act: (m.actions || []).map((x) => [x.name, x.desc]),
      rc: (m.reactions || []).concat(m.legendary_actions || []).map((x) => [x.name, x.desc]),
    };
  }
  function openBlock(m) {
    if (window.showStatBlockData) window.showStatBlockData(m.name, o5eBlock(m), (m.document__title || 'Open5e') + ' · open5e.com');
  }
  async function search() {
    const term = q.value.trim(); if (!term) return;
    grid.innerHTML = '<div class="mon-empty">Searching Open5e…</div>';
    try {
      const r = await fetch('https://api.open5e.com/v1/monsters/?search=' + encodeURIComponent(term) + '&limit=24');
      const data = await r.json();
      const list = (data.results || []).filter((m) => m.name && m.hit_points);
      grid.innerHTML = '';
      if (!list.length) { grid.innerHTML = '<div class="mon-empty">No Open5e monsters found.</div>'; return; }
      list.forEach((m) => {
        const e = TYPE_E[(m.type || '').toLowerCase()] || '👾';
        const b = document.createElement('button');
        b.className = 'mon-btn';
        b.innerHTML = `<span class="me">${e}</span><span class="mn">${m.name}</span><em>${m.hit_points} hp · CR ${m.challenge_rating}</em><span class="mon-info" title="View stat block">📖</span>`;
        b.onclick = () => {
          if (!me.isGm) return;
          socket.emit('token:add', {
            x: gridSize * (2 + Math.floor(Math.random() * 6)),
            y: gridSize * (1 + Math.floor(Math.random() * 3)),
            color: '#5a2d82', label: m.name, size: SIZE_N[(m.size || '').toLowerCase()] || 1,
            statuses: [], emoji: e, hp: m.hit_points, maxhp: m.hit_points, cr: m.challenge_rating,
          });
        };
        b.oncontextmenu = (ev) => { ev.preventDefault(); openBlock(m); };
        const info = b.querySelector('.mon-info');
        if (info) info.onclick = (ev) => { ev.stopPropagation(); openBlock(m); };
        grid.appendChild(b);
      });
    } catch (err) {
      grid.innerHTML = '<div class="mon-empty">Open5e unreachable — check your connection.</div>';
    }
  }
  go.onclick = search;
  q.addEventListener('keydown', (e) => { if (e.key === 'Enter') search(); });
})();

/* ============ LIVE ENCOUNTER DIFFICULTY METER (DM) ============ */
const CR_XP = { '0': 10, '1/8': 25, '1/4': 50, '1/2': 100, '1': 200, '2': 450, '3': 700, '4': 1100, '5': 1800, '6': 2300, '7': 2900, '8': 3900, '9': 5000, '10': 5900, '11': 7200, '12': 8400, '13': 10000, '14': 11500, '15': 13000, '16': 15000, '17': 18000, '18': 20000, '19': 22000, '20': 25000, '21': 33000, '22': 41000, '23': 50000, '24': 62000, '25': 75000, '26': 90000, '27': 105000, '28': 120000, '29': 135000, '30': 155000 };
const THREAT_T = { 1: [25, 50, 75, 100], 2: [50, 100, 150, 200], 3: [75, 150, 225, 400], 4: [125, 250, 375, 500], 5: [250, 500, 750, 1100], 6: [300, 600, 900, 1400], 7: [350, 750, 1100, 1700], 8: [450, 900, 1400, 2100], 9: [550, 1100, 1600, 2400], 10: [600, 1200, 1900, 2800], 11: [800, 1600, 2400, 3600], 12: [1000, 2000, 3000, 4500], 13: [1100, 2200, 3400, 5100], 14: [1250, 2500, 3800, 5700], 15: [1400, 2800, 4300, 6400], 16: [1600, 3200, 4800, 7200], 17: [2000, 3900, 5900, 8800], 18: [2100, 4200, 6300, 9500], 19: [2400, 4900, 7300, 10900], 20: [2800, 5700, 8500, 12700] };
let threatParty = [];
socket.on('party:list', (list) => { threatParty = list || []; recomputeThreat(); });
function tokenCR(t) {
  if (t.cr !== undefined && t.cr !== null && CR_XP[String(t.cr)] !== undefined) return String(t.cr);
  const m = MONSTERS.find((x) => x.n === t.label);
  return m && m.cr !== undefined ? String(m.cr) : null;
}
function recomputeThreat() {
  const box = $('threat-meter'); if (!box || !me.isGm) return;
  const toks = Object.values(tokenEls).map((e) => e._token).filter(Boolean);
  const crs = toks.filter((t) => !t.hidden || me.isGm).map(tokenCR).filter((c) => c !== null);
  if (!crs.length) { box.textContent = 'Drop monsters on the map to see the party’s odds.'; return; }
  const xp = crs.reduce((s, c) => s + (CR_XP[c] || 0), 0);
  const n = crs.length;
  const mult = n === 1 ? 1 : n === 2 ? 1.5 : n <= 6 ? 2 : n <= 10 ? 2.5 : n <= 14 ? 3 : 4;
  const adj = Math.round(xp * mult);
  const pcs = threatParty.filter((p) => (p.maxhp || 0) > 0);
  if (!pcs.length) { box.textContent = `${n} monster${n > 1 ? 's' : ''} worth ${xp} XP — no party sheets yet to compare against.`; return; }
  const th = pcs.reduce((a, p) => {
    const t = THREAT_T[Math.max(1, Math.min(20, p.level || 1))];
    return a.map((v, i) => v + t[i]);
  }, [0, 0, 0, 0]);
  const grade = adj >= th[3] ? ['☠️ DEADLY', '#e74c3c'] : adj >= th[2] ? ['🔥 Hard', '#e67e22'] : adj >= th[1] ? ['⚔️ Medium', '#f1c40f'] : adj >= th[0] ? ['🌿 Easy', '#7fbf6a'] : ['🍃 Trivial', '#9fbf8a'];
  box.innerHTML = `<b style="color:${grade[1]}">${grade[0]}</b> — ${n} monster${n > 1 ? 's' : ''}, ${xp} XP (adjusted ${adj}) vs ${pcs.length} PC${pcs.length > 1 ? 's' : ''} · thresholds E ${th[0]} / M ${th[1]} / H ${th[2]} / D ${th[3]}`;
}
setInterval(recomputeThreat, 3000);

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
    if (t.dataset.tab === 'spells' && window.refreshSpellGates) window.refreshSpellGates();
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
// Local grid overlay toggle (per-device; doesn't affect other players).
(function () {
  const cb = $('grid-show'); if (!cb) return;
  const saved = localStorage.getItem('dnd-grid-show');
  if (saved === '0') { cb.checked = false; const g = $('grid'); if (g) g.style.display = 'none'; }
  cb.onchange = () => {
    const g = $('grid'); if (g) g.style.display = cb.checked ? '' : 'none';
    localStorage.setItem('dnd-grid-show', cb.checked ? '1' : '0');
  };
})();

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
// Click the % readout to reset zoom to 100% and recenter the board.
if ($('zoom-label')) {
  $('zoom-label').style.cursor = 'pointer';
  $('zoom-label').title = 'Reset zoom to 100% and recenter';
  $('zoom-label').onclick = () => {
    setZoom(1);
    const wrap = $('board-wrap');
    if (wrap) { wrap.scrollLeft = (BOARD_W - wrap.clientWidth) / 2; wrap.scrollTop = (BOARD_H - wrap.clientHeight) / 2; }
  };
}
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
let snapGrid = true;
function snapPt(p) {
  if (!snapGrid) return p;
  return { x: (Math.floor(p.x / gridSize) + 0.5) * gridSize, y: (Math.floor(p.y / gridSize) + 0.5) * gridSize };
}

let panning = false, panStart = null;
$('board-wrap').addEventListener('mousedown', (e) => {
  if (e.target.closest('.token')) return;
  if (e.altKey) { const c = boardCoords(e); socket.emit('ping', c); showPing(c.x, c.y, me.color, me.name); return; }
  if (aoeMode) { aoeStart = snapPt(boardCoords(e)); e.preventDefault(); return; }
  if (rulerMode) { rulerStart = snapPt(boardCoords(e)); e.preventDefault(); return; }
  if (fogMode && me.isGm) { paintFog(e); return; }
  if (drawMode) { drawStroke = { points: [drawPt(e)], color: drawColor, w: 3 }; e.preventDefault(); return; }
  if (!e.shiftKey && typeof clearSelection === 'function') clearSelection();
  panning = true; panStart = { x: e.clientX, y: e.clientY, sl: $('board-wrap').scrollLeft, st: $('board-wrap').scrollTop };
});
window.addEventListener('mousemove', (e) => {
  if (panning) { $('board-wrap').scrollLeft = panStart.sl - (e.clientX - panStart.x); $('board-wrap').scrollTop = panStart.st - (e.clientY - panStart.y); }
  else if (rulerStart) { const c = snapPt(boardCoords(e)); drawRuler(rulerStart.x, rulerStart.y, c.x, c.y); }
  else if (aoeStart) { renderAoes(previewFrom(e)); }
  else if (drawStroke) { drawStroke.points.push(drawPt(e)); renderDrawings(drawStroke); }
  else if (fogPainting && me.isGm) paintFog(e);
});
window.addEventListener('mouseup', (e) => {
  if (aoeStart) { finalizeAoe(e); aoeStart = null; }
  if (drawStroke) { if (drawStroke.points.length > 1) { drawings.push(drawStroke); socket.emit('draw:add', drawStroke); } drawStroke = null; renderDrawings(); }
  panning = false; fogPainting = false; rulerStart = null;
});

/* ============ FREEHAND MAP DRAWING ============ */
let drawMode = false, drawStroke = null, drawColor = '#e07a3a', drawings = [];
function drawPt(e) { const p = boardCoords(e); return [Math.round(p.x), Math.round(p.y)]; }
function renderDrawings(temp) {
  const svg = $('draw'); if (!svg) return;
  const all = temp ? drawings.concat([temp]) : drawings;
  svg.innerHTML = all.map((s) => {
    const pts = (s.points || []).map((p) => p.join(',')).join(' ');
    return `<polyline points="${pts}" fill="none" stroke="${s.color || '#e07a3a'}" stroke-width="${s.w || 3}" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>`;
  }).join('');
}
socket.on('draw:add', (stroke) => { drawings.push(stroke); renderDrawings(); });
socket.on('draw:clear', () => { drawings = []; renderDrawings(); });
if ($('draw-btn')) $('draw-btn').onclick = () => {
  drawMode = !drawMode;
  $('draw-btn').classList.toggle('on', drawMode);
  $('draw-bar').classList.toggle('hidden', !drawMode);
  $('board').classList.toggle('draw-on', drawMode);
  if (drawMode) { // turn off conflicting tools
    rulerMode = false; $('ruler-btn').classList.remove('on'); $('board').classList.remove('ruler-on');
    if (typeof aoeMode !== 'undefined' && aoeMode) { aoeMode = false; $('aoe-btn').classList.remove('on'); $('aoe-bar').classList.add('hidden'); }
    if (fogMode) { fogMode = false; $('fog-btn').classList.remove('on'); $('fog-bar').classList.add('hidden'); $('board').classList.remove('fog-painting'); }
  }
};
document.querySelectorAll('.draw-color').forEach((b) => {
  b.onclick = () => { drawColor = b.dataset.c; document.querySelectorAll('.draw-color').forEach((x) => x.classList.toggle('active', x === b)); };
});
if ($('draw-clear')) $('draw-clear').onclick = () => { if (confirm('Erase all drawings for everyone?')) socket.emit('draw:clear'); };

/* ============ KEYBOARD SHORTCUTS ============ */
let _hintTimer = null;
function flashHint(msg) {
  const h = $('board-hint'); if (!h) return;
  if (!h.dataset.orig) h.dataset.orig = h.textContent;
  h.textContent = msg;
  if (_hintTimer) clearTimeout(_hintTimer);
  _hintTimer = setTimeout(() => { h.textContent = h.dataset.orig; }, 1600);
}
document.addEventListener('keydown', (e) => {
  if (!me.id) return;                       // not seated at the table yet
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const el = e.target;
  if (el && ((el.matches && el.matches('input, textarea, select')) || el.isContentEditable)) return;
  const gm = me.isGm;
  const click = (id) => { const b = $(id); if (b && !b.classList.contains('hidden')) b.click(); };
  switch (e.key.toLowerCase()) {
    case 'r': click('ruler-btn'); e.preventDefault(); break;
    case 'd': click('draw-btn'); e.preventDefault(); break;
    case 'e': click('aoe-btn'); e.preventDefault(); break;
    case 'f': if (gm) click('fog-btn'); e.preventDefault(); break;
    case 'm': click('map-btn'); e.preventDefault(); break;
    case 'c': click('open-cs'); e.preventDefault(); break;
    case 'g': snapGrid = !snapGrid; flashHint('Grid snap: ' + (snapGrid ? 'ON' : 'OFF')); e.preventDefault(); break;
    case 'n': if (gm) { click('init-next'); e.preventDefault(); } break;
    case ' ': if (gm) { click('init-next'); e.preventDefault(); } break;
    case '=': case '+': click('zoom-in'); e.preventDefault(); break;
    case '-': case '_': click('zoom-out'); e.preventDefault(); break;
    case 'escape':
      if (typeof closeTokenCtx === 'function') closeTokenCtx();
      ['token-modal', 'map-modal', 'handout-modal', 'cs-modal', 'sb-modal'].forEach((id) => { const m = $(id); if (m) m.classList.add('hidden'); });
      break;
    case '?': openHelp(); e.preventDefault(); break;
  }
});

/* ============ HELP / SHORTCUTS OVERLAY ============ */
function openHelp() {
  let m = document.getElementById('help-modal');
  if (!m) {
    m = document.createElement('div');
    m.id = 'help-modal'; m.className = 'overlay hidden';
    m.innerHTML = `<div class="sb-card help-card">
      <button class="sb-x" title="Close">✕</button>
      <div class="sb-name">Help &amp; Quick Reference</div>
      <div class="help-cols">
        <div>
          <div class="sb-h">Keyboard</div>
          <div class="help-kv"><b>R</b> Ruler</div>
          <div class="help-kv"><b>D</b> Draw</div>
          <div class="help-kv"><b>E</b> AoE template</div>
          <div class="help-kv"><b>F</b> Fog of war (GM)</div>
          <div class="help-kv"><b>M</b> Battle maps</div>
          <div class="help-kv"><b>C</b> Character sheet</div>
          <div class="help-kv"><b>G</b> Grid snap on/off</div>
          <div class="help-kv"><b>N / Space</b> Next turn (GM)</div>
          <div class="help-kv"><b>+ / −</b> Zoom &nbsp;·&nbsp; click <b>%</b> resets</div>
          <div class="help-kv"><b>Esc</b> Close menus</div>
          <div class="help-kv"><b>?</b> This help</div>
        </div>
        <div>
          <div class="sb-h">Chat commands</div>
          <div class="help-kv"><b>/roll 2d6+3</b> roll dice (also <b>/r</b>)</div>
          <div class="help-kv"><b>/roll 1d20 adv</b> advantage / <b>dis</b></div>
          <div class="help-kv"><b>/w &lt;msg&gt;</b> whisper the GM</div>
          <div class="help-kv"><b>/w &lt;name&gt; &lt;msg&gt;</b> GM → player</div>
          <div class="help-kv"><b>/reply &lt;msg&gt;</b> reply to last whisper</div>
          <div class="sb-h" style="margin-top:10px">Mouse &amp; tokens</div>
          <div class="help-kv"><b>Alt-click</b> ping the map (with your name)</div>
          <div class="help-kv"><b>Shift-click</b> multi-select tokens, then drag</div>
          <div class="help-kv"><b>Scroll over token</b> HP ±1 (Shift ±5)</div>
          <div class="help-kv"><b>Right-click token</b> size, ghost, conditions, stacking…</div>
          <div class="help-kv"><b>Shift-drag AoE</b> snap cone/line to 45°</div>
          <div class="help-kv"><b>🌦️ Weather</b> also holds 🎵 Ambience — synced soundscapes (DM)</div>
        </div>
      </div>
      <div class="sb-foot">⚔️ AI D&amp;D Tabletop — press ? anytime</div>
    </div>`;
    document.body.appendChild(m);
    m.addEventListener('click', (e) => { if (e.target === m || e.target.classList.contains('sb-x')) m.classList.add('hidden'); });
  }
  m.classList.remove('hidden');
}
if ($('help-btn')) $('help-btn').onclick = openHelp;

/* ============ PINGS ============ */
socket.on('ping', ({ x, y, color, name }) => showPing(x, y, color, name));
function showPing(x, y, color, name) {
  const el = document.createElement('div');
  el.className = 'ping'; el.style.left = x + 'px'; el.style.top = y + 'px';
  el.style.borderColor = color || '#d9b154';
  $('pings').appendChild(el);
  setTimeout(() => el.remove(), 2200);
  if (name) {
    const lbl = document.createElement('div');
    lbl.className = 'ping-name'; lbl.textContent = name;
    lbl.style.color = color || '#d9b154';
    lbl.style.left = x + 'px'; lbl.style.top = y + 'px';
    $('pings').appendChild(lbl);
    setTimeout(() => lbl.remove(), 2200);
  }
}

/* ============ TOKENS ============ */
$('addtoken-btn').onclick = () => {
  // Theme the token from the character: class emoji + sheet HP if a class is set.
  const theme = (window.SRD && cs && cs.cls && window.SRD.classes[cs.cls]) || null;
  const tok = { x: 140 * Math.ceil(Math.random()*4), y: 140, color: me.color, label: initials(me.name), size: 1, statuses: [] };
  if (theme) {
    if (theme.emoji) tok.emoji = theme.emoji;
    if (Number(cs.maxhp) > 0) { tok.hp = Number(cs.hp) || 0; tok.maxhp = Number(cs.maxhp); }
  }
  socket.emit('token:add', tok);
};
socket.on('token:add', (t) => { renderToken(t); refreshLighting(); });
socket.on('token:update', (t) => { if (tokenEls[t.id]) { tokenEls[t.id]._token = t; styleToken(tokenEls[t.id], t); refreshLighting(); } else { renderToken(t); refreshLighting(); } });
socket.on('token:move', ({ id, x, y }) => {
  const el = tokenEls[id]; if (!el) return;
  el.style.left = x + 'px'; el.style.top = y + 'px'; el._token.x = x; el._token.y = y;
  refreshLighting();
});
socket.on('token:remove', (id) => { if (tokenEls[id]) { tokenEls[id].remove(); delete tokenEls[id]; refreshLighting(); } if (id === linkedToken) { linkedToken = null; localStorage.removeItem('dnd-link-' + me.room); } });

// Pick black or white text for legibility on a given token color (WCAG-ish luminance).
function contrastText(hex) {
  const h = String(hex || '#888').replace('#', '');
  const n = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const r = parseInt(n.substr(0, 2), 16) || 0, g = parseInt(n.substr(2, 2), 16) || 0, b = parseInt(n.substr(4, 2), 16) || 0;
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.6 ? '#12100a' : '#f6efdd';
}
function hexA(hex, a) {
  const h = String(hex || '#f2cf7a').replace('#', '');
  const n = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const r = parseInt(n.substr(0, 2), 16) || 0, g = parseInt(n.substr(2, 2), 16) || 0, b = parseInt(n.substr(4, 2), 16) || 0;
  return `rgba(${r},${g},${b},${a})`;
}
function renderToken(t) {
  let el = tokenEls[t.id];
  if (!el) {
    el = document.createElement('div'); el.className = 'token';
    el.innerHTML = `<div class="tk-aura"></div><span class="lbl"></span><div class="hpbar"><i></i></div><div class="hpbar2"><i></i></div><div class="statuses"></div><div class="tk-death"></div><span class="tk-name"></span>`;
    $('tokens').appendChild(el); tokenEls[t.id] = el; makeDraggable(el);
    // Scroll wheel over a token nudges its HP (±1, or ±5 with Shift). GM or the token's owner only.
    el.addEventListener('wheel', (ev) => {
      const tk = el._token; if (!tk) return;
      if (!(Number(tk.maxhp) > 0)) return;
      if (!(me.isGm || tk.ownerId === me.id)) return;
      ev.preventDefault(); ev.stopPropagation();
      const step = ev.shiftKey ? 5 : 1;
      const dir = ev.deltaY < 0 ? 1 : -1;
      const mx = Number(tk.maxhp);
      const next = Math.max(0, Math.min(mx, (Number(tk.hp) || 0) + dir * step));
      if (next !== (Number(tk.hp) || 0)) socket.emit('token:update', { id: tk.id, hp: next });
    }, { passive: false });
  }
  el._token = t;
  el.style.left = t.x + 'px'; el.style.top = t.y + 'px';
  styleToken(el, t);
  // GM layer: hidden tokens are invisible to players, dimmed for the GM.
  el.style.display = (t.hidden && !me.isGm) ? 'none' : '';
  el.classList.toggle('gm-hidden', !!t.hidden && me.isGm);
  if (typeof combat !== 'undefined' && combat.list && combat.list.length) {
    el.classList.toggle('active-turn', el._token.label === combat.list[combat.turnIndex].name);
  }
}
function styleToken(el, t) {
  const s = (t.size || 1) * 64;
  el.style.width = s + 'px'; el.style.height = s + 'px';
  el.style.setProperty('--tk', s + 'px');
  const lbl = el.querySelector('.lbl');
  if (t.img) { el.style.background = `center/cover url(${t.img})`; lbl.textContent = ''; lbl.className = 'lbl'; lbl.style.color = ''; }
  else {
    el.style.background = t.color;
    if (t.emoji) { lbl.textContent = t.emoji; lbl.className = 'lbl emoji'; lbl.style.color = ''; }
    else { lbl.textContent = t.label || ''; lbl.className = 'lbl'; lbl.style.color = contrastText(t.color); }
  }
  el.classList.toggle('mine', t.ownerId === me.id);
  el.classList.toggle('downed', Number(t.maxhp) > 0 && Number(t.hp) === 0);
  el.classList.toggle('bloodied', Number(t.maxhp) > 0 && Number(t.hp) > 0 && Number(t.hp) <= Number(t.maxhp) / 2);
  el.classList.toggle('ghosted', !!t.ghost);
  const np = el.querySelector('.tk-name'); if (np) np.textContent = t.label || '';
  if (t.z != null && t.z !== '') el.style.zIndex = String(t.z); else el.style.zIndex = '';
  const bar = el.querySelector('.hpbar'), fill = bar.querySelector('i');
  if (t.maxhp && Number(t.maxhp) > 0) {
    bar.style.display = 'block';
    const pct = Math.max(0, Math.min(100, (Number(t.hp) / Number(t.maxhp)) * 100));
    fill.style.width = pct + '%';
    fill.style.background = pct > 50 ? '#5fae54' : pct > 25 ? '#d9a434' : '#c0392b';
  } else bar.style.display = 'none';
  const bar2 = el.querySelector('.hpbar2'), fill2 = bar2 && bar2.querySelector('i');
  if (bar2) {
    const temp = Number(t.temphp) || 0;
    if (temp > 0) {
      bar2.style.display = 'block';
      const denom = Number(t.maxhp) > 0 ? Number(t.maxhp) : temp;
      fill2.style.width = Math.max(8, Math.min(100, (temp / denom) * 100)) + '%';
    } else bar2.style.display = 'none';
  }
  const aura = el.querySelector('.tk-aura');
  if (aura) {
    const ft = Number(t.aura) || 0;
    if (ft > 0) {
      const rad = (ft / 5) * gridSize;
      const c = t.auraColor || '#f2cf7a';
      aura.style.display = 'block';
      aura.style.width = aura.style.height = (rad * 2) + 'px';
      aura.style.left = (s / 2 - rad) + 'px'; aura.style.top = (s / 2 - rad) + 'px';
      aura.style.background = `radial-gradient(circle, ${hexA(c, 0.30)} 0%, ${hexA(c, 0.12)} 60%, transparent 73%)`;
      aura.style.border = `1px solid ${hexA(c, 0.5)}`;
    } else aura.style.display = 'none';
  }
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

const selectedTokens = new Set();
function toggleSelect(id) {
  if (selectedTokens.has(id)) selectedTokens.delete(id); else selectedTokens.add(id);
  const el = tokenEls[id]; if (el) el.classList.toggle('selected', selectedTokens.has(id));
}
function clearSelection() {
  selectedTokens.forEach((id) => { const el = tokenEls[id]; if (el) el.classList.remove('selected'); });
  selectedTokens.clear();
}
function makeDraggable(el) {
  let dragging = false, grabX = 0, grabY = 0, startX = 0, startY = 0, groupDrag = false, group = [];
  el.addEventListener('mousedown', (e) => {
    if (e.altKey || fogMode) return;
    if (e.shiftKey) { toggleSelect(el._token.id); e.preventDefault(); e.stopPropagation(); return; } // shift-click = (de)select
    dragging = true; const c = boardCoords(e); grabX = c.x - el._token.x; grabY = c.y - el._token.y;
    startX = el._token.x; startY = el._token.y;
    groupDrag = selectedTokens.has(el._token.id) && selectedTokens.size > 1;
    group = groupDrag ? [...selectedTokens].filter((id) => id !== el._token.id && tokenEls[id]).map((id) => { const g = tokenEls[id]; return { el: g, t: g._token, x0: g._token.x, y0: g._token.y }; }) : [];
    e.preventDefault(); e.stopPropagation();
  });
  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const c = boardCoords(e); const x = c.x - grabX, y = c.y - grabY;
    el.style.left = x + 'px'; el.style.top = y + 'px'; el._token.x = x; el._token.y = y;
    socket.emit('token:move', { id: el._token.id, x, y });
    if (groupDrag) {
      const ddx = x - startX, ddy = y - startY;
      group.forEach((g) => { const nx = g.x0 + ddx, ny = g.y0 + ddy; g.el.style.left = nx + 'px'; g.el.style.top = ny + 'px'; g.t.x = nx; g.t.y = ny; socket.emit('token:move', { id: g.t.id, x: nx, y: ny }); });
    }
    showMoveLabel(el, x, y, startX, startY);
    refreshLighting();
  });
  window.addEventListener('mouseup', () => {
    if (!dragging) return; dragging = false; hideMoveLabel();
    const sx = Math.round(el._token.x / gridSize) * gridSize, sy = Math.round(el._token.y / gridSize) * gridSize;
    el.style.left = sx + 'px'; el.style.top = sy + 'px'; el._token.x = sx; el._token.y = sy;
    socket.emit('token:move', { id: el._token.id, x: sx, y: sy });
    if (groupDrag) {
      group.forEach((g) => { const gx = Math.round(g.t.x / gridSize) * gridSize, gy = Math.round(g.t.y / gridSize) * gridSize; g.el.style.left = gx + 'px'; g.el.style.top = gy + 'px'; g.t.x = gx; g.t.y = gy; socket.emit('token:move', { id: g.t.id, x: gx, y: gy }); });
      groupDrag = false; group = [];
    }
  });
  el.addEventListener('dblclick', (e) => {
    e.stopPropagation();
    if (el._token && Array.isArray(el._token.chest)) { openChest(el._token); return; }
    openTokenModal(el._token);
  });
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
  // Group operations when this token is part of a multi-selection.
  if (typeof selectedTokens !== 'undefined' && selectedTokens.has(t.id) && selectedTokens.size > 1) {
    const ids = [...selectedTokens];
    const n = ids.length;
    const gh = document.createElement('div'); gh.className = 'ctx-hdr'; gh.textContent = `${n} selected`; m.appendChild(gh);
    row('💥', `Damage all ${n}…`, () => {
      const amt = parseInt(prompt(`Damage to all ${n} selected:`, '5')); closeTokenCtx();
      if (amt > 0) ids.forEach((id) => { const g = tokenEls[id] && tokenEls[id]._token; if (!g) return;
        const temp = Number(g.temphp) || 0, absorbed = Math.min(temp, amt);
        socket.emit('token:update', { id, temphp: temp - absorbed, hp: Math.max(0, (Number(g.hp) || 0) - (amt - absorbed)) }); });
    });
    row('💚', `Heal all ${n}…`, () => {
      const amt = parseInt(prompt(`Heal all ${n} selected:`, '5')); closeTokenCtx();
      if (amt > 0) ids.forEach((id) => { const g = tokenEls[id] && tokenEls[id]._token; if (!g) return;
        const mx = Number(g.maxhp) || Infinity; socket.emit('token:update', { id, hp: Math.min(mx, (Number(g.hp) || 0) + amt) }); });
    });
    row('🗑️', `Delete all ${n}`, () => {
      closeTokenCtx();
      if (confirm(`Delete all ${n} selected tokens?`)) { ids.forEach((id) => socket.emit('token:remove', id)); if (typeof clearSelection === 'function') clearSelection(); }
    }, 'danger');
  }
  row('✏️', 'Edit…', () => { closeTokenCtx(); openTokenModal(t); });
  if (typeof window.hasStatBlock === 'function' && window.hasStatBlock(t.label)) {
    row('📖', 'Stat block', () => { closeTokenCtx(); window.showStatBlock(t.label); });
  }
  row('💥', 'Damage…', () => {
    const n = parseInt(prompt('Damage amount:', '5')); closeTokenCtx();
    if (n > 0) {
      const temp = Number(t.temphp) || 0;
      const absorbed = Math.min(temp, n);
      socket.emit('token:update', { id: t.id, temphp: temp - absorbed, hp: Math.max(0, tokenHP(t) - (n - absorbed)) });
    }
  });
  row('💚', 'Heal…', () => {
    const n = parseInt(prompt('Heal amount:', '5')); closeTokenCtx();
    if (n > 0) { const mx = Number(t.maxhp) || Infinity; socket.emit('token:update', { id: t.id, hp: Math.min(mx, tokenHP(t) + n) }); }
  });
  row('🧠', 'Concentration' + (t.conc ? ' ✓' : ''), () => {
    closeTokenCtx(); socket.emit('token:update', { id: t.id, conc: !t.conc });
  });
  if (me.isGm) row(t.hidden ? '👁️' : '🙈', t.hidden ? 'Reveal to players' : 'Hide from players', () => {
    closeTokenCtx(); socket.emit('token:update', { id: t.id, hidden: !t.hidden });
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
  if ((t.statuses && t.statuses.length) || t.conc) {
    row('🧹', 'Clear all conditions', () => {
      closeTokenCtx();
      socket.emit('token:update', { id: t.id, statuses: [], conc: false });
    });
  }
  row('📋', 'Duplicate', () => {
    closeTokenCtx();
    const c = { x: t.x + gridSize, y: t.y, color: t.color, label: t.label, size: t.size || 1,
      statuses: [...(t.statuses || [])], emoji: t.emoji || '', img: t.img || null,
      hp: t.hp ?? null, maxhp: t.maxhp ?? null, vision: t.vision ?? null, light: t.light ?? null };
    socket.emit('token:add', c);
  });
  (() => {
    const SZ = [[1, 'Medium'], [2, 'Large'], [3, 'Huge'], [4, 'Gargantuan']];
    const cur = Math.max(1, Math.min(4, Number(t.size) || 1));
    const name = (SZ.find(([n]) => n === cur) || SZ[0])[1];
    const nextName = (SZ.find(([n]) => n === (cur % 4) + 1) || SZ[0])[1];
    row('📐', `Size: ${name} → ${nextName}`, () => {
      closeTokenCtx();
      socket.emit('token:update', { id: t.id, size: (cur % 4) + 1 });
    });
  })();
  row('⬆️', 'Bring to front', () => {
    closeTokenCtx();
    const zs = Object.values(tokenEls).map((e) => Number(e._token && e._token.z) || 0);
    const top = zs.length ? Math.max(...zs) : 0;
    socket.emit('token:update', { id: t.id, z: top + 1 });
  });
  row('⬇️', 'Send to back', () => {
    closeTokenCtx();
    const zs = Object.values(tokenEls).map((e) => Number(e._token && e._token.z) || 0);
    const bot = zs.length ? Math.min(...zs) : 0;
    socket.emit('token:update', { id: t.id, z: bot - 1 });
  });
  row(t.ghost ? '👤' : '👻', t.ghost ? 'Solid (remove ghost)' : 'Ghost (50% opacity)', () => {
    closeTokenCtx(); socket.emit('token:update', { id: t.id, ghost: !t.ghost });
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
  $('tk-temp').value = t.temphp ? t.temphp : '';
  $('tk-vision').value = t.vision ?? ''; $('tk-light').value = t.light ?? '';
  $('tk-aura').value = t.aura ?? ''; $('tk-aura-color').value = t.auraColor || '#f2cf7a';
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
    temphp: $('tk-temp').value === '' ? 0 : Number($('tk-temp').value),
    vision: $('tk-vision').value === '' ? null : Number($('tk-vision').value),
    light: $('tk-light').value === '' ? null : Number($('tk-light').value),
    aura: $('tk-aura').value === '' ? null : Number($('tk-aura').value),
    auraColor: $('tk-aura-color').value,
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
  if (key !== combat._key) {
    const wasInit = combat._key !== '';
    combat.turnStart = Date.now(); combat._key = key;
    // GM announces the new turn to chat (once) so followers of the log always know.
    if (wasInit && me.isGm && list.length && list[turnIndex]) {
      socket.emit('chat', { text: `▶ ${list[turnIndex].name}'s turn — Round ${round || 1}` });
    }
    // Chime + flash when it becomes YOUR turn.
    const active = list.length ? list[turnIndex] : null;
    if (wasInit && active && (active.name === me.name || (cs && cs.name && active.name === cs.name))) {
      turnChime();
      flashHint("⚔️ It's your turn!");
    }
  }
  combat.list = list; combat.turnIndex = turnIndex; combat.round = round || 1;
  updateTurnBanner();
  highlightActiveToken();
  tickTimers(combat.round);
}

/* ============ EFFECT ROUND TIMERS (DM, per-device) ============ */
let effectTimers = [], _lastTimerRound = null;
function loadTimers() { try { effectTimers = JSON.parse(localStorage.getItem('dnd-timers') || '[]'); } catch { effectTimers = []; } }
function saveTimers() { try { localStorage.setItem('dnd-timers', JSON.stringify(effectTimers)); } catch {} }
function renderTimers() {
  const list = $('timer-list'); if (!list) return;
  list.innerHTML = '';
  if (!effectTimers.length) { list.innerHTML = '<span class="macro-empty">No active timers.</span>'; return; }
  effectTimers.forEach((t, i) => {
    const d = document.createElement('div'); d.className = 'timer-item';
    d.innerHTML = `<span class="ti-n">${escapeHtml(t.name)}</span><span class="ti-r">${t.rounds} rd</span><span class="ti-x" title="Remove">✕</span>`;
    d.querySelector('.ti-x').onclick = () => { effectTimers.splice(i, 1); saveTimers(); renderTimers(); };
    list.appendChild(d);
  });
}
function tickTimers(round) {
  if (round == null) return;
  if (_lastTimerRound === null) { _lastTimerRound = round; renderTimers(); return; }
  if (round > _lastTimerRound) {
    const dec = round - _lastTimerRound;
    effectTimers.forEach((t) => { t.rounds -= dec; });
    const expired = effectTimers.filter((t) => t.rounds <= 0);
    expired.forEach((t) => socket.emit('chat', { text: `⏱️ Effect ended: ${t.name}` }));
    effectTimers = effectTimers.filter((t) => t.rounds > 0);
    saveTimers(); renderTimers();
  }
  _lastTimerRound = round;
}
if ($('timer-add')) $('timer-add').onclick = () => {
  const name = $('timer-name').value.trim(), rounds = parseInt($('timer-rounds').value);
  if (!name || !(rounds > 0)) return;
  effectTimers.push({ name, rounds }); saveTimers(); renderTimers();
  $('timer-name').value = ''; $('timer-rounds').value = '';
};
if ($('timer-rounds')) $('timer-rounds').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('timer-add').click(); });
loadTimers(); renderTimers();

/* Short two-note chime for turn alerts. */
let _chimeCtx = null;
function turnChime() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    _chimeCtx = _chimeCtx || new AC();
    if (_chimeCtx.state === 'suspended') _chimeCtx.resume();
    const t0 = _chimeCtx.currentTime;
    [[880, 0], [1174.7, 0.12]].forEach(([f, dt]) => {
      const o = _chimeCtx.createOscillator(), g = _chimeCtx.createGain();
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t0 + dt);
      g.gain.exponentialRampToValueAtTime(0.12, t0 + dt + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dt + 0.35);
      o.connect(g); g.connect(_chimeCtx.destination);
      o.start(t0 + dt); o.stop(t0 + dt + 0.4);
    });
  } catch {}
}

/* Cast a spell from the library: consumes the lowest available slot ≥ its level. */
window.castSpell = function (name, level) {
  const who = (cs && cs.name) || me.name || 'Someone';
  if (!level) { socket.emit('chat', { text: `✨ ${who} casts ${name} (cantrip).` }); flashHint('✨ ' + name + ' cast'); return; }
  if (!cs) return;
  cs.slots = cs.slots || {};
  let use = 0;
  for (let l = level; l <= 9; l++) { const s = cs.slots[l]; if (s && s.max > 0 && s.used < s.max) { use = l; break; } }
  if (!use) { flashHint(`❌ No level-${level}+ spell slots left — take a rest!`); return; }
  cs.slots[use].used++;
  saveCS(); if (csBuilt) csRenderSlots();
  const left = cs.slots[use].max - cs.slots[use].used;
  const upcast = use > level ? ` (upcast with a level-${use} slot)` : '';
  socket.emit('chat', { text: `✨ ${who} casts ${name}${upcast} — level ${use} slot used, ${left} left.` });
  flashHint(`✨ ${name} — slot used (${left} left)`);
};

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
    const slow = s >= 60;
    banner.textContent = `⚔️ Round ${combat.round} · ${combat.list[combat.turnIndex].name} · ${mm}:${ss}${slow ? ' ⏳' : ''}`;
    banner.classList.remove('hidden');
    banner.classList.toggle('long-turn', slow);
  } else { banner.classList.add('hidden'); banner.classList.remove('long-turn'); }
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
[['fog-brush-1', 1], ['fog-brush-3', 3], ['fog-brush-5', 5]].forEach(([id, n]) => {
  const b = $(id); if (!b) return;
  b.onclick = () => {
    fogBrush = n;
    ['fog-brush-1', 'fog-brush-3', 'fog-brush-5'].forEach((x) => { const el = $(x); if (el) el.classList.toggle('active', x === id); });
  };
});
$('fog-cover-all').onclick = () => socket.emit('fog:all', true);
$('fog-clear-all').onclick = () => socket.emit('fog:all', false);
$('wall-clear').onclick = () => socket.emit('wall:clear');
$('light-toggle').onclick = () => socket.emit('light:active', !lighting);

function paintFog(e) {
  fogPainting = true;
  const c = boardCoords(e);
  const cx = Math.floor(c.x / gridSize), cy = Math.floor(c.y / gridSize);
  if (cx < 0 || cy < 0) return;
  const r = Math.floor(Math.max(1, fogBrush) / 2);
  let touchedFog = false, touchedWall = false;
  for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) {
    const x = cx + dx, y = cy + dy; if (x < 0 || y < 0) continue;
    const key = `${x},${y}`;
    if (paintTarget === 'wall') {
      if (walls[key]) continue;
      walls[key] = true; socket.emit('wall:cell', { key, on: true }); touchedWall = true;
    } else {
      const wantHidden = (paintTarget === 'hide');
      if (!!fog.hidden[key] === wantHidden) continue;
      if (wantHidden) fog.hidden[key] = true; else delete fog.hidden[key];
      socket.emit('fog:cell', { key, hidden: wantHidden }); touchedFog = true;
    }
  }
  if (touchedWall) { renderWalls(); refreshLighting(); }
  if (touchedFog) renderFog();
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
const CS_NUMF = ['level','ac','speed','hp','maxhp','temphp','hitDiceUsed','cp','sp','ep','gp','pp','xp'];

function csDefault() {
  return { name:'', pronouns:'', race:'', cls:'', level:1, xp:0, background:'', inspiration:false,
    ac:10, speed:30, hp:10, maxhp:10, temphp:0,
    scores:{str:10,dex:10,con:10,int:10,wis:10,cha:10},
    saves:{}, skills:{}, attacks:[], gear:[], conditions:[], notes:'', resUsed:{}, wildShape:null,
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
      <button class="cs-badge cs-roll" data-levelup title="Advance a level: roll or average the hit die + CON">⬆️ Level Up</button>
      <label class="cs-badge" title="Experience points">XP <b><input data-cs="xp" type="number" min="0" style="width:5.5em" /></b> <em data-xpnext style="font-style:normal;opacity:.7"></em></label>
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
    <div class="cs-sec"><div class="cs-sec-t">Inventory</div>
      <div id="cs-gear" class="cs-gear"></div>
      <div class="cs-gear-add"><input id="cs-gear-name" placeholder="Add item… (e.g. Shield)" /><button id="cs-gear-addbtn">Add</button></div>
      <textarea data-cs="inventory" placeholder="Other equipment, coins, consumables…"></textarea></div>
    <div class="cs-sec"><div class="cs-sec-t">Features &amp; Traits</div><textarea data-cs="features" placeholder="Class features, feats, racial traits…"></textarea></div>
  </div>`);
  h.push(`<div class="cs-sec"><div class="cs-sec-t">🎯 Class Resources — limited-use powers</div><div id="cs-res"></div></div>`);
  h.push(`<div class="cs-sec cs-cando-sec"><div class="cs-sec-t">🧭 What You Can Do — <span data-cando-cls>your class</span></div><div id="cs-cando"></div></div>`);
  const deathPips = (t) => [0,1,2].map((i) => `<button class="cs-dpip ${t}" data-death="${t}:${i}"></button>`).join('');
  h.push(`<div class="cs-grid cs-grid3">
    <div class="cs-sec"><div class="cs-sec-t">Spell Slots</div><div id="cs-slots" class="cs-slots"></div></div>
    <div class="cs-sec">
      <div class="cs-sec-t">Death Saves</div>
      <div class="cs-death"><span>Successes</span><div class="cs-dpips">${deathPips('succ')}</div></div>
      <div class="cs-death"><span>Failures</span><div class="cs-dpips">${deathPips('fail')}</div></div>
      <button class="cs-line-roll" data-deathroll style="margin-top:8px;width:100%">🎲 Roll Death Save</button>
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
  csRenderSlots(); csPopulateDeath(); csRenderGear(); csRenderCanDo(); csRenderRes();
}
/* Weights / hands / armor slots for common gear (SRD equipment tables). */
const ITEM_DB = {
  greataxe: { w: 7, h: 2 }, greatsword: { w: 6, h: 2 }, maul: { w: 10, h: 2 }, pike: { w: 18, h: 2 },
  glaive: { w: 6, h: 2 }, halberd: { w: 6, h: 2 }, 'heavy crossbow': { w: 18, h: 2 }, longbow: { w: 2, h: 2 },
  shortbow: { w: 2, h: 2 }, 'light crossbow': { w: 5, h: 2 },
  longsword: { w: 3, h: 1 }, shortsword: { w: 2, h: 1 }, rapier: { w: 2, h: 1 }, scimitar: { w: 3, h: 1 },
  battleaxe: { w: 4, h: 1 }, warhammer: { w: 2, h: 1 }, mace: { w: 4, h: 1 }, flail: { w: 2, h: 1 },
  handaxe: { w: 2, h: 1 }, dagger: { w: 1, h: 1 }, club: { w: 2, h: 1 }, spear: { w: 3, h: 1 },
  quarterstaff: { w: 4, h: 1 }, javelin: { w: 2, h: 1 }, sling: { w: 0, h: 1 }, shield: { w: 6, h: 1 },
  'chain mail': { w: 55, slot: 'armor' }, 'plate armor': { w: 65, slot: 'armor' }, plate: { w: 65, slot: 'armor' },
  'studded leather': { w: 13, slot: 'armor' }, 'leather armor': { w: 10, slot: 'armor' }, leather: { w: 10, slot: 'armor' },
  'scale mail': { w: 45, slot: 'armor' }, 'chain shirt': { w: 20, slot: 'armor' }, 'half plate': { w: 40, slot: 'armor' },
  'hide armor': { w: 12, slot: 'armor' }, breastplate: { w: 20, slot: 'armor' }, 'ring mail': { w: 40, slot: 'armor' }, 'padded armor': { w: 8, slot: 'armor' },
  'potion of healing': { w: 0.5 }, potion: { w: 0.5 }, rope: { w: 10 }, torch: { w: 1 }, bedroll: { w: 7 },
  rations: { w: 2 }, waterskin: { w: 5 }, tinderbox: { w: 1 }, 'grappling hook': { w: 4 },
  "dungeoneer's pack": { w: 55 }, "explorer's pack": { w: 55 }, "priest's pack": { w: 29 }, "scholar's pack": { w: 22 }, "burglar's pack": { w: 42 }, "diplomat's pack": { w: 36 }, "entertainer's pack": { w: 38 },
};
function itemInfo(name) {
  const k = String(name || '').trim().toLowerCase();
  if (ITEM_DB[k]) return ITEM_DB[k];
  const hit = Object.keys(ITEM_DB).sort((a, b) => b.length - a.length).find((key) => k.includes(key));
  return hit ? ITEM_DB[hit] : {};
}
function gearInfo(g) {
  const d = itemInfo(g.n);
  return { w: g.w !== undefined ? g.w : (d.w !== undefined ? d.w : 1), h: g.h !== undefined ? g.h : (d.h || 0), slot: g.slot || d.slot || null };
}
function csCarry() { return Math.max(1, Number(cs.scores.str) || 10) * 15; }   // 5E: STR × 15 lb
function csRenderGear() {
  const box = $('cs-gear'); if (!box) return;
  cs.gear = cs.gear || [];
  const escG = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  let total = 0;
  const rows = cs.gear.map((g, i) => {
    const inf = gearInfo(g);
    total += inf.w;
    const tags = `${inf.w ? inf.w + ' lb' : ''}${inf.h === 2 ? ' · 🤲 two-handed' : inf.h === 1 ? ' · ✋' : ''}${inf.slot === 'armor' ? ' · 🛡 armor' : ''}`;
    return `<div class="cs-gear-item ${g.on ? 'on' : ''}">
    <button class="cs-gear-tog" data-gear-tog="${i}" title="Toggle worn / stowed">${g.on ? '🟢 On' : '⚪ Off'}</button>
    <span class="cs-gear-n">${escG(g.n)} <em style="opacity:.6;font-size:11px">${tags}</em></span>
    <button class="cs-gear-rm" data-gear-rm="${i}" title="Remove">✕</button>
  </div>`;
  }).join('');
  const cap = csCarry();
  const over = total > cap;
  const spd = Number(cs.speed) || 30;
  const meter = `<div class="cs-carry ${over ? 'over' : ''}">⚖️ Carrying ${Math.round(total * 10) / 10} / ${cap} lb${over ? ` — OVER-ENCUMBERED! Speed halved to ${Math.floor(spd / 2)} ft. Drop something or raise STR.` : ''}</div>`;
  box.innerHTML = (rows || '<div style="font-size:12px;opacity:.65;padding:2px 0">No tracked gear — add items below, toggle On when equipped.</div>') + meter;
  // Speed badge shows the encumbrance penalty
  const spdIn = document.querySelector('#cs-body [data-cs="speed"]');
  if (spdIn) {
    const badge = spdIn.closest('.cs-badge');
    if (badge) {
      badge.classList.toggle('enc', over);
      badge.title = over ? `Over-encumbered: effective speed ${Math.floor(spd / 2)} ft (half of ${spd})` : '';
    }
  }
  if (over && !csRenderGear._warned) { csRenderGear._warned = true; flashHint(`⚖️ Over-encumbered — speed halved to ${Math.floor(spd / 2)} ft!`); }
  if (!over) csRenderGear._warned = false;
}
/* Sheet info bridge for the spell library's class/level gating. */
const CANTRIP_CASTERS = ['Bard', 'Cleric', 'Druid', 'Sorcerer', 'Warlock', 'Wizard'];
window.csInfo = function () {
  const clsName = String((cs && cs.cls) || '').trim();
  let maxSlot = 0;
  if (cs && cs.slots) for (let l = 9; l >= 1; l--) if (cs.slots[l] && cs.slots[l].max > 0) { maxSlot = l; break; }
  return { cls: clsName, isGm: me.isGm, maxSlot, cantrips: CANTRIP_CASTERS.includes(clsName) };
};

/* Limited-use class powers by class & level (Rage, Wild Shape, Ki, etc.). */
function classResources(clsName, lvl, chaMod) {
  const r = [];
  const add = (id, name, max, reset) => { if (max > 0) r.push({ id, name, max, reset }); };
  switch (clsName) {
    case 'Barbarian': add('rage', '🔥 Rage', lvl >= 20 ? 8 : lvl >= 17 ? 6 : lvl >= 12 ? 5 : lvl >= 6 ? 4 : lvl >= 3 ? 3 : 2, 'long'); break;
    case 'Bard': add('binsp', '🎶 Bardic Inspiration', Math.max(1, chaMod), lvl >= 5 ? 'short' : 'long'); break;
    case 'Cleric': if (lvl >= 2) add('cd', '🙏 Channel Divinity', lvl >= 18 ? 4 : lvl >= 6 ? 3 : 2, 'short'); break;
    case 'Druid': if (lvl >= 2) add('wild', '🐺 Wild Shape', lvl >= 17 ? 4 : lvl >= 6 ? 3 : 2, 'short'); break;
    case 'Fighter':
      add('sw', '💨 Second Wind', lvl >= 10 ? 4 : lvl >= 4 ? 3 : 2, 'short');
      if (lvl >= 2) add('surge', '⚡ Action Surge', lvl >= 17 ? 2 : 1, 'short');
      if (lvl >= 9) add('indom', '🛡 Indomitable', lvl >= 17 ? 3 : lvl >= 13 ? 2 : 1, 'long');
      break;
    case 'Monk': if (lvl >= 2) add('focus', '☯️ Focus Points', lvl, 'short'); break;
    case 'Paladin':
      add('loh', '✋ Lay on Hands (HP pool)', lvl * 5, 'long');
      if (lvl >= 3) add('cd', '🙏 Channel Divinity', lvl >= 11 ? 3 : 2, 'short');
      break;
    case 'Sorcerer': if (lvl >= 2) add('sp', '🔮 Sorcery Points', lvl, 'long'); break;
    case 'Wizard': add('ar', '📖 Arcane Recovery', 1, 'long'); break;
  }
  return r;
}
function csRenderRes() {
  const box = $('cs-res'); if (!box) return;
  const clsName = String(cs.cls || '').trim();
  const lvl = Number(cs.level) || 1;
  const list = classResources(clsName, lvl, csMod(cs.scores.cha));
  cs.resUsed = cs.resUsed || {};
  if (!list.length) { box.innerHTML = '<div style="font-size:12px;opacity:.65">No limited-use class powers' + (clsName ? ' at this level' : ' — set your class') + '.</div>'; return; }
  box.innerHTML = list.map((r) => {
    const used = Math.min(cs.resUsed[r.id] || 0, r.max);
    let ctl;
    if (r.max > 8) {
      ctl = `<button class="cs-res-btn" data-res-spend="${r.id}" data-max="${r.max}" title="Spend 1">−</button> <b>${r.max - used}</b> / ${r.max} <button class="cs-res-btn" data-res-restore="${r.id}" title="Restore 1">+</button>`;
    } else {
      ctl = Array.from({ length: r.max }, (_, i) => `<button class="cs-pip ${i < used ? 'on' : ''}" data-res-pip="${r.id}:${i}" title="Click to spend / restore"></button>`).join('');
    }
    return `<div class="cs-resrow"><span class="cs-res-n">${r.name}</span><div class="cs-pips">${ctl}</div><em class="cs-res-r" title="${r.reset === 'short' ? 'Recovers on a Short Rest' : 'Recovers on a Long Rest'}">${r.reset === 'short' ? '☕' : '🌙'}</em></div>`;
  }).join('') + '<div style="font-size:11px;opacity:.6;margin-top:4px">Click pips to spend · ☕ back on Short Rest · 🌙 back on Long Rest</div>';
  // Druids get a Wild Shape transform button (level 2+).
  if (clsName === 'Druid' && lvl >= 2) {
    box.innerHTML += cs.wildShape
      ? `<button class="lvl-opt" data-wildrevert style="margin-top:8px">↩️ Revert from ${escapeHtml(cs.wildShape.name)}</button>`
      : `<button class="lvl-opt" data-wildshape style="margin-top:8px">🐾 Wild Shape — transform into a beast</button>`;
  }
}

/* ============ DRUID WILD SHAPE ============ */
// SRD beasts a druid can become, gated by level (max CR & no fly/swim early).
const WILD_BEASTS = [
  { n: 'Rat', cr: 0, minLvl: 2, ac: 10, hp: 1, sp: '20 ft', str: 2, dex: 11, con: 9, atk: [{ name: 'Bite', bonus: 0, dmg: '1' }] },
  { n: 'Frog', cr: 0, minLvl: 2, ac: 11, hp: 1, sp: '20 ft, swim 20 ft', str: 1, dex: 13, con: 8, atk: [] },
  { n: 'Giant Rat', cr: '1/8', minLvl: 2, ac: 12, hp: 7, sp: '30 ft', str: 7, dex: 15, con: 11, atk: [{ name: 'Bite', bonus: 4, dmg: '1d4+2' }] },
  { n: 'Wolf', cr: '1/4', minLvl: 2, ac: 13, hp: 11, sp: '40 ft', str: 12, dex: 15, con: 12, atk: [{ name: 'Bite', bonus: 4, dmg: '2d4+2 + knock prone (DC 11)' }] },
  { n: 'Boar', cr: '1/4', minLvl: 2, ac: 11, hp: 11, sp: '40 ft', str: 13, dex: 11, con: 12, atk: [{ name: 'Tusk', bonus: 3, dmg: '1d6+1' }] },
  { n: 'Black Bear', cr: '1/2', minLvl: 2, ac: 11, hp: 19, sp: '40 ft, climb 30 ft', str: 15, dex: 10, con: 14, atk: [{ name: 'Bite', bonus: 3, dmg: '1d6+2' }, { name: 'Claws', bonus: 3, dmg: '2d4+2' }] },
  { n: 'Crocodile', cr: '1/2', minLvl: 2, ac: 12, hp: 19, sp: '20 ft, swim 30 ft', str: 15, dex: 10, con: 13, atk: [{ name: 'Bite', bonus: 4, dmg: '1d10+2 + grapple' }] },
  { n: 'Giant Spider', cr: 1, minLvl: 4, ac: 14, hp: 26, sp: '30 ft, climb 30 ft', str: 14, dex: 16, con: 12, atk: [{ name: 'Bite', bonus: 5, dmg: '1d8+3 + DC11 CON poison 2d8' }] },
  { n: 'Brown Bear', cr: 1, minLvl: 4, ac: 11, hp: 34, sp: '40 ft, climb 30 ft', str: 19, dex: 10, con: 16, atk: [{ name: 'Bite', bonus: 5, dmg: '1d8+4' }, { name: 'Claws', bonus: 5, dmg: '2d6+4' }] },
  { n: 'Dire Wolf', cr: 1, minLvl: 4, ac: 14, hp: 37, sp: '50 ft', str: 17, dex: 15, con: 15, atk: [{ name: 'Bite', bonus: 5, dmg: '2d6+3 + knock prone (DC 13)' }] },
  { n: 'Giant Eagle', cr: 1, minLvl: 8, fly: true, ac: 13, hp: 26, sp: '10 ft, fly 80 ft', str: 16, dex: 17, con: 13, atk: [{ name: 'Beak', bonus: 5, dmg: '1d6+3' }, { name: 'Talons', bonus: 5, dmg: '2d6+3' }] },
  { n: 'Giant Constrictor Snake', cr: 2, minLvl: 6, ac: 12, hp: 60, sp: '30 ft, swim 30 ft', str: 19, dex: 14, con: 12, atk: [{ name: 'Bite', bonus: 6, dmg: '2d6+4' }, { name: 'Constrict', bonus: 6, dmg: '2d8+4 + grapple' }] },
  { n: 'Polar Bear', cr: 2, minLvl: 6, ac: 12, hp: 42, sp: '40 ft, swim 30 ft', str: 20, dex: 10, con: 16, atk: [{ name: 'Bite', bonus: 7, dmg: '1d8+5' }, { name: 'Claws', bonus: 7, dmg: '2d6+5' }] },
  { n: 'Giant Shark', cr: 5, minLvl: 8, ac: 13, hp: 126, sp: 'swim 50 ft', str: 23, dex: 11, con: 21, atk: [{ name: 'Bite', bonus: 9, dmg: '3d10+6' }] },
];
function wildMaxCR(lvl) { return lvl >= 8 ? 1e9 : lvl >= 4 ? 1 : 0.5; }   // moon-druid-ish generous cap; UI still gates fly/swim by level
function crVal(cr) { return cr === '1/8' ? 0.125 : cr === '1/4' ? 0.25 : cr === '1/2' ? 0.5 : Number(cr); }
function openWildShape() {
  const lvl = Number(cs.level) || 1;
  // must have a Wild Shape use left
  const used = (cs.resUsed && cs.resUsed.wild) || 0;
  const maxUses = lvl >= 17 ? 4 : lvl >= 6 ? 3 : 2;
  if (used >= maxUses) { flashHint('🐾 No Wild Shape uses left — Short Rest to recover.'); return; }
  let m = $('wild-modal'); if (m) m.remove();
  m = document.createElement('div'); m.id = 'wild-modal'; m.className = 'overlay';
  const cap = wildMaxCR(lvl);
  const list = WILD_BEASTS.filter((b) => lvl >= b.minLvl && crVal(b.cr) <= cap && (lvl >= 8 || !b.fly));
  m.innerHTML = `<div class="sb-card lvl-card"><button class="sb-x">✕</button>
    <div class="sb-name">🐾 Wild Shape — become a beast</div>
    <div class="lvl-feat">Your game stats become the beast's (HP, AC, speed, attacks). Your mind, Wisdom, Intelligence & Charisma stay yours. Revert any time or when the beast form drops to 0 HP. Uses left: ${maxUses - used}/${maxUses}.</div>
    ${list.map((b) => `<div class="lvl-row" style="margin:4px 0"><span style="flex:1">${b.n} <em style="opacity:.65">CR ${b.cr} · AC ${b.ac} · ${b.hp} HP · ${b.sp}</em></span><button class="lvl-opt" data-beast="${escapeHtml(b.n)}">Transform</button></div>`).join('')}
    <div class="sb-foot">SRD 5.1 · CC-BY-4.0</div></div>`;
  document.body.appendChild(m);
  m.addEventListener('click', (e) => {
    if (e.target === m || e.target.classList.contains('sb-x')) { m.remove(); return; }
    const bb = e.target.closest('[data-beast]');
    if (bb) { doWildShape(WILD_BEASTS.find((x) => x.n === bb.dataset.beast)); m.remove(); }
  });
}
function doWildShape(b) {
  if (!b) return;
  // stash the humanoid form
  cs.wildShape = {
    name: b.name || b.n,
    orig: { hp: cs.hp, maxhp: cs.maxhp, ac: cs.ac, speed: cs.speed, attacks: JSON.parse(JSON.stringify(cs.attacks || [])),
      str: cs.scores.str, dex: cs.scores.dex, con: cs.scores.con },
  };
  cs.maxhp = b.hp; cs.hp = b.hp; cs.ac = b.ac;
  cs.speed = parseInt(b.sp, 10) || 30;
  cs.scores.str = b.str; cs.scores.dex = b.dex; cs.scores.con = b.con;
  cs.attacks = (b.atk || []).map((a) => ({ name: b.n + ' — ' + a.name, bonus: a.bonus, dmg: a.dmg }));
  cs.resUsed = cs.resUsed || {}; cs.resUsed.wild = (cs.resUsed.wild || 0) + 1;
  saveCS(); if (csBuilt) { csPopulate(); csRecompute(); csRenderAttacks(); } sendPartyStatus(); syncLinkedToken();
  socket.emit('chat', { text: `🐾 ${(cs.wildShape && cs.name) || me.name} Wild Shapes into a ${b.n}! (${b.hp} HP, AC ${b.ac}, ${b.sp})` });
  flashHint('🐾 You are now a ' + b.n + '!');
}
function revertWildShape() {
  if (!cs.wildShape) return;
  const o = cs.wildShape.orig, was = cs.wildShape.name;
  cs.ac = o.ac; cs.speed = o.speed; cs.attacks = o.attacks;
  cs.scores.str = o.str; cs.scores.dex = o.dex; cs.scores.con = o.con;
  cs.maxhp = o.maxhp;
  cs.hp = Number(cs.hp) > 0 ? o.hp : Math.max(1, o.hp);   // if beast dropped to 0, revert with your own HP (already tracked separately in true 5e; keep it simple)
  cs.wildShape = null;
  saveCS(); if (csBuilt) { csPopulate(); csRecompute(); csRenderAttacks(); } sendPartyStatus(); syncLinkedToken();
  socket.emit('chat', { text: `↩️ ${cs.name || me.name} reverts from ${was} to their true form.` });
  flashHint('↩️ Back to your true form');
}

/* "What You Can Do" — class powers unlocked at your level, upcoming ones locked. */
function csRenderCanDo() {
  const box = $('cs-cando'); if (!box) return;
  const clsName = String(cs.cls || '').trim();
  const lvl = Number(cs.level) || 1;
  const escC = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const tag = document.querySelector('#cs-body [data-cando-cls]');
  if (tag) tag.textContent = clsName ? `${clsName} ${lvl}` : 'your class';
  let h = '<div class="cando-h">Everyone, every turn</div>' +
    '<div class="cando-p on">Move up to your Speed · one <b>Action</b> (Attack, Dash, Disengage, Dodge, Help, Hide, Ready, Search, Use an Object, or Cast a Spell) · a <b>Bonus Action</b> if a feature grants one · one <b>Reaction</b> per round · one free object interaction (draw a weapon, open a door).</div>';
  const srd = window.SRD && window.SRD.classes[clsName];
  if (srd) {
    h += `<div class="cando-h">${escC(clsName)} powers</div>`;
    h += `<div class="cando-p on"><b>Lv 1</b> — ${escC(srd.sig)}</div>`;
    const feats = (window.SRD.features && window.SRD.features[clsName]) || {};
    let nextShown = 0;
    for (let l = 2; l <= 20; l++) {
      const f = feats[l]; if (!f) continue;
      const has = l <= lvl;
      if (!has && nextShown >= 2) continue;            // show only the next two locked ones
      if (!has) nextShown++;
      h += `<div class="cando-p ${has ? 'on' : 'off'}"><b>Lv ${l}</b> — ${escC(f)}${has ? '' : ' 🔒'}</div>`;
    }
    const asiLvls = [4, 8, 12, 16].concat(clsName === 'Fighter' ? [6, 14] : []).concat(clsName === 'Rogue' ? [10] : []);
    const gotASI = asiLvls.filter((l) => l <= lvl).length;
    if (gotASI) h += `<div class="cando-p on"><b>Ability Score Improvements</b> — ${gotASI} earned so far (next at level ${asiLvls.find((l) => l > lvl) || '—'}).</div>`;
    const ct = window.SRD.casterType && window.SRD.casterType[clsName];
    if (ct) {
      const KN = { Bard: [2, 3, 4], Cleric: [3, 4, 5], Druid: [2, 3, 4], Sorcerer: [4, 5, 6], Warlock: [2, 3, 4], Wizard: [3, 4, 5] };
      const kn = KN[clsName] ? KN[clsName][lvl >= 10 ? 2 : lvl >= 4 ? 1 : 0] : 0;
      h += `<div class="cando-p on">🔮 <b>Spellcaster</b> (${escC(srd.castAbil || '')})${ct === 'pact' ? ' — Pact slots refresh on a Short Rest' : ''}.${kn ? ` Cantrips known: <b>${kn}</b>.` : ' No cantrips — your magic comes through slots only.'} The Spells tab only lets you cast what a ${escC(clsName)} of your level really can.</div>`;
    }
  } else {
    h += '<div class="cando-p off">Set your Class up top (or pick one when joining) and this panel fills with everything your class can do at your level.</div>';
  }
  box.innerHTML = h;
}

/* Can this item be equipped? Enforces two hands total + one suit of armor. */
function gearCanEquip(idx) {
  const g = cs.gear[idx]; if (!g) return { ok: false };
  const inf = gearInfo(g);
  if (inf.slot === 'armor') {
    const worn = cs.gear.find((o, i) => i !== idx && o.on && gearInfo(o).slot === 'armor');
    if (worn) return { ok: false, why: `You're already wearing ${worn.n} — take it off first.` };
    return { ok: true };
  }
  if (inf.h > 0) {
    const used = cs.gear.reduce((s, o, i) => s + (i !== idx && o.on ? gearInfo(o).h : 0), 0);
    if (used + inf.h > 2) {
      const held = cs.gear.filter((o, i) => i !== idx && o.on && gearInfo(o).h > 0).map((o) => o.n).join(' + ');
      return { ok: false, why: `Not enough hands! ${g.n} needs ${inf.h === 2 ? 'both hands' : 'a hand'} and you're holding ${held}.` };
    }
  }
  return { ok: true };
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
  if (el.dataset.cs !== undefined) { const f = el.dataset.cs; cs[f] = CS_NUMF.includes(f) ? Number(el.value) || 0 : el.value; if (['name','hp','maxhp','ac'].includes(f)) sendPartyStatusDebounced(); if (['cls','level','speed','str'].includes(f)) { csRenderCanDo(); csRenderGear(); csRenderRes(); if (window.refreshSpellGates) window.refreshSpellGates(); } }
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
  if (e.target.closest('[data-levelup]')) { levelUp(); return; }
  if (e.target.closest('[data-deathroll]')) { rollSheetDeathSave(); return; }
  const rm = e.target.closest('[data-atk-rm]');
  if (rm) { cs.attacks.splice(Number(rm.dataset.atkRm), 1); csRenderAttacks(); saveCS(); return; }
  if (e.target.id === 'cs-atk-addbtn') {
    const nm = $('cs-atk-name').value.trim(); if (!nm) return;
    cs.attacks.push({ name: nm, bonus: Number($('cs-atk-bonus').value) || 0, dmg: $('cs-atk-dmg').value.trim() });
    $('cs-atk-name').value = ''; $('cs-atk-bonus').value = ''; $('cs-atk-dmg').value = '';
    csRenderAttacks(); saveCS(); return;
  }
  const gt = e.target.closest('[data-gear-tog]');
  if (gt) {
    const idx = Number(gt.dataset.gearTog), g = cs.gear[idx];
    if (g) {
      if (!g.on) { const chk = gearCanEquip(idx); if (!chk.ok) { flashHint('❌ ' + chk.why); return; } }
      g.on = !g.on;
      csRenderGear(); saveCS();
    }
    return;
  }
  const gr = e.target.closest('[data-gear-rm]');
  if (gr) { cs.gear.splice(Number(gr.dataset.gearRm), 1); csRenderGear(); saveCS(); return; }
  const rpip = e.target.closest('[data-res-pip]');
  if (rpip) {
    const parts = rpip.dataset.resPip.split(':');
    const id = parts[0], idx = Number(parts[1]);
    cs.resUsed = cs.resUsed || {};
    const used = cs.resUsed[id] || 0;
    cs.resUsed[id] = idx < used ? idx : idx + 1;   // click a lit pip to restore back to it, unlit to spend
    csRenderRes(); saveCS(); return;
  }
  if (e.target.closest('[data-wildshape]')) { openWildShape(); return; }
  if (e.target.closest('[data-wildrevert]')) { revertWildShape(); return; }
  const rsp = e.target.closest('[data-res-spend]');
  if (rsp) { const id = rsp.dataset.resSpend; cs.resUsed = cs.resUsed || {}; cs.resUsed[id] = Math.min(Number(rsp.dataset.max) || 99, (cs.resUsed[id] || 0) + 1); csRenderRes(); saveCS(); return; }
  const rrs = e.target.closest('[data-res-restore]');
  if (rrs) { const id = rrs.dataset.resRestore; cs.resUsed = cs.resUsed || {}; cs.resUsed[id] = Math.max(0, (cs.resUsed[id] || 0) - 1); csRenderRes(); saveCS(); return; }
  if (e.target.id === 'cs-gear-addbtn') {
    const nm = $('cs-gear-name').value.trim(); if (!nm) return;
    cs.gear = cs.gear || [];
    const inf = itemInfo(nm);
    cs.gear.push({ n: nm.slice(0, 60), on: false, w: inf.w !== undefined ? inf.w : 1, h: inf.h || 0, slot: inf.slot || null });
    $('cs-gear-name').value = '';
    csRenderGear(); saveCS(); return;
  }
}

function csRecompute() {
  const body = $('cs-body'); if (!body) return;
  const prof = csProf();
  body.querySelectorAll('[data-prof]').forEach((e) => e.textContent = csFmt(prof));
  body.querySelectorAll('[data-lvlnum]').forEach((e) => e.textContent = cs.level || 1);
  body.querySelectorAll('[data-xpnext]').forEach((e) => {
    const lvl = Number(cs.level) || 1;
    e.textContent = lvl >= 20 ? '(max)' : '/ ' + xpNext(lvl);
  });
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

/* Death save from the sheet: d20 with 5E rules, synced to pips + chat + linked token. */
function rollSheetDeathSave() {
  const who = cs.name || me.name;
  const d = 1 + Math.floor(Math.random() * 20);
  let msg;
  if (d === 20) {
    cs.hp = 1; cs.deathSucc = 0; cs.deathFail = 0;
    msg = `natural 20 — 💚 ${who} regains 1 HP and is back up!`;
  } else if (d === 1) {
    cs.deathFail = Math.min(3, (Number(cs.deathFail) || 0) + 2);
    msg = `natural 1 — two failures`;
  } else if (d >= 10) {
    cs.deathSucc = Math.min(3, (Number(cs.deathSucc) || 0) + 1);
    msg = `success`;
  } else {
    cs.deathFail = Math.min(3, (Number(cs.deathFail) || 0) + 1);
    msg = `failure`;
  }
  let tail = '';
  if (d !== 20 && cs.deathSucc >= 3) { tail = ' — 🕊️ stabilized!'; cs.deathSucc = 0; cs.deathFail = 0; }
  else if (cs.deathFail >= 3) { tail = ' — 💀 has died.'; }
  csPopulate(); csRecompute(); saveCS(); sendPartyStatus(); syncLinkedToken();
  socket.emit('chat', { text: `🎲 ${who} death save: ${d} (${msg})${tail}` });
}

/* DM milestone: broadcast levels the whole party (each player picks roll/average). */
if ($('milestone-btn')) $('milestone-btn').onclick = () => {
  if (!me.isGm) return;
  if (confirm('Declare a milestone? Every player with a character will level up.')) socket.emit('milestone');
};
socket.on('milestone', () => {
  if (!cs || !cs.cls || Number(cs.level) >= 20) return;   // only characters with a class level up
  flashHint('🎉 Milestone! Level up!');
  setTimeout(() => levelUp(), 400);
});

/* DM XP awards: 5E cumulative thresholds; crossing one nudges a level-up. */
const XP_LEVELS = [0, 0, 300, 900, 2700, 6500, 14000, 23000, 34000, 48000, 64000, 85000, 100000, 120000, 140000, 165000, 195000, 225000, 265000, 305000, 355000];
function xpNext(lvl) { return XP_LEVELS[Math.min(20, (Number(lvl) || 1) + 1)]; }
if ($('xp-award-btn')) $('xp-award-btn').onclick = () => {
  if (!me.isGm) return;
  const amt = parseInt(prompt('Award how much XP to each party member?', '300'), 10);
  if (amt > 0) socket.emit('xp:award', { amount: amt });
};
/* DM gives an item straight onto a player's sheet — optionally "from" an NPC (gifts!). */
if ($('item-give-btn')) $('item-give-btn').onclick = () => {
  if (!me.isGm) return;
  const to = prompt('Give an item to which player? (name)'); if (!to || !to.trim()) return;
  const item = prompt('What item? (e.g. Potion of Healing)'); if (!item || !item.trim()) return;
  const from = prompt('Who gives it? (NPC name — leave blank for the DM)') || '';
  socket.emit('item:give', { to: to.trim(), item: item.trim(), from: from.trim() });
};
socket.on('item:give', ({ item }) => {
  if (!cs || !item) return;
  cs.gear = cs.gear || [];
  const inf = itemInfo(item);
  cs.gear.push({ n: String(item).slice(0, 60), on: false, w: inf.w !== undefined ? inf.w : 1, h: inf.h || 0, slot: inf.slot || null });
  saveCS(); if (csBuilt) csRenderGear();
  flashHint('🎁 You received: ' + item);
});

/* ============ LOOT CHESTS (DM places, players double-click to loot) ============ */
if ($('chest-btn')) $('chest-btn').onclick = () => {
  if (!me.isGm) return;
  const raw = prompt("What's inside? (comma-separated items)", 'Potion of Healing, 25 gp, Dagger');
  if (raw === null) return;
  const items = raw.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 20);
  socket.emit('token:add', {
    x: gridSize * (2 + Math.floor(Math.random() * 6)),
    y: gridSize * (1 + Math.floor(Math.random() * 3)),
    color: '#7a5a2e', label: 'Chest', size: 1, statuses: [],
    emoji: '📦', chest: items,
  });
  flashHint('📦 Chest placed — double-click it to loot');
};
function openChest(t) {
  let m = $('chest-modal'); if (m) m.remove();
  m = document.createElement('div'); m.id = 'chest-modal'; m.className = 'overlay';
  const live = () => (tokenEls[t.id] && tokenEls[t.id]._token && tokenEls[t.id]._token.chest) || t.chest || [];
  const escC = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const items = live();
  m.innerHTML = `<div class="sb-card lvl-card">
    <button class="sb-x" title="Close">✕</button>
    <div class="sb-name">📦 ${escC(t.label || 'Chest')}</div>
    ${items.length ? items.map((it, i) => `<div class="lvl-row" style="margin:4px 0"><span style="flex:1">${escC(it)}</span><button class="lvl-opt" data-take="${i}">🖐 Take</button></div>`).join('') : '<div class="lvl-feat">Empty — someone got here first.</div>'}
  </div>`;
  document.body.appendChild(m);
  m.addEventListener('click', (e) => {
    if (e.target === m || e.target.classList.contains('sb-x')) { m.remove(); return; }
    const tb = e.target.closest('[data-take]');
    if (tb) {
      const i = Number(tb.dataset.take);
      const cur = live();
      const item = cur[i]; if (item === undefined) { m.remove(); return; }
      const rest = cur.slice(); rest.splice(i, 1);
      socket.emit('token:update', { id: t.id, chest: rest, label: rest.length ? (t.label || 'Chest') : 'Chest (empty)', emoji: rest.length ? '📦' : '🫙' });
      cs.gear = cs.gear || [];
      const inf = itemInfo(item);
      cs.gear.push({ n: String(item).slice(0, 60), on: false, w: inf.w !== undefined ? inf.w : 1, h: inf.h || 0, slot: inf.slot || null });
      saveCS(); if (csBuilt) csRenderGear();
      socket.emit('chat', { text: `🧰 ${(cs && cs.name) || me.name} takes ${item} from the ${t.label || 'chest'}.` });
      m.remove();
    }
  });
}
socket.on('xp:award', ({ amount }) => {
  if (!cs || (!cs.name && !cs.cls)) return;               // spectators without a character skip
  cs.xp = (Number(cs.xp) || 0) + (Number(amount) || 0);
  saveCS();
  if (csBuilt) { csPopulate(); csRecompute(); }
  const lvl = Number(cs.level) || 1;
  if (lvl < 20 && cs.xp >= xpNext(lvl)) {
    flashHint(`⭐ ${cs.xp} XP — enough for level ${lvl + 1}!`);
    if (cs.cls) setTimeout(() => levelUp(), 400);   // opens the level-up picker (closable)
  } else {
    flashHint(`⭐ +${amount} XP (${cs.xp} / ${xpNext(lvl)})`);
  }
});

/* Level up: opens a class-aware picker — HP roll/average, new features, ASI, spell slots. */
function levelUp() {
  const lvl = Number(cs.level) || 1;
  if (lvl >= 20) { alert('Already at level 20 — the pinnacle!'); return; }
  const next = lvl + 1;
  let die = 8;
  const clsName = String(cs.cls || '').trim();
  const srdCls = window.SRD && clsName && window.SRD.classes[clsName];
  if (srdCls) die = srdCls.hd;
  else { const m = String(cs.hitDiceTotal || '').match(/d(\d+)/i); if (m) die = parseInt(m[1], 10) || 8; }
  const conMod = csMod(cs.scores.con);
  const avg = Math.floor(die / 2) + 1;
  const asiLvls = [4, 8, 12, 16].concat(clsName === 'Fighter' ? [6, 14] : []).concat(clsName === 'Rogue' ? [10] : []);
  const isASI = asiLvls.includes(next);
  const isBoon = next === 19;
  const feats = (window.SRD && window.SRD.features && window.SRD.features[clsName]) || {};
  const featText = feats[next] || (next === 3 ? 'Choose your subclass!' : '');
  let slotNote = '';
  const ct = window.SRD && window.SRD.casterType && window.SRD.casterType[clsName];
  if (ct && window.SRD.slots) {
    if (ct === 'pact') { const p = window.SRD.slots.pact[next]; slotNote = `Pact Magic: ${p[0]} slot${p[0] > 1 ? 's' : ''} of level ${p[1]} — refresh on a Short Rest`; }
    else { const row = window.SRD.slots[ct][next] || []; slotNote = 'Spell slots: ' + row.map((n, i) => `${n}×${i + 1}${['st', 'nd', 'rd'][i] || 'th'}`).join(', '); }
  }
  let m = $('lvl-modal'); if (m) m.remove();
  m = document.createElement('div'); m.id = 'lvl-modal'; m.className = 'overlay';
  const state = { hp: null, hpNote: '', asi: [] };
  const abils = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
  m.innerHTML = `
    <div class="sb-card lvl-card">
      <button class="sb-x" title="Close">✕</button>
      <div class="sb-name">⬆️ Level ${lvl} → ${next}${clsName ? ' — ' + clsName : ''}</div>
      <div class="sb-h">❤️ Hit Points — 1d${die} ${csFmt(conMod)} CON</div>
      <div class="lvl-row">
        <button class="lvl-opt" data-hp="roll">🎲 Roll 1d${die}</button>
        <button class="lvl-opt" data-hp="avg">📏 Take average (${avg})</button>
        <span id="lvl-hp-out" class="lvl-out"></span>
      </div>
      ${featText ? `<div class="sb-h">✨ New at level ${next}</div><div class="lvl-feat">${featText}</div>` : ''}
      ${isASI ? `<div class="sb-h">💪 Ability Score Improvement — pick two +1s (same score twice = +2, max 20)</div>
      <div class="lvl-row" id="lvl-asi">${abils.map((a) => `<button class="lvl-opt" data-asi="${a}">${a.toUpperCase()} ${cs.scores[a]}</button>`).join('')}</div>
      <div class="lvl-out" id="lvl-asi-out">0 / 2 picked</div>` : ''}
      ${isBoon ? '<div class="sb-h">🌟 Epic Boon</div><div class="lvl-feat">Level 19: gain an Epic Boon feat — pick one with your DM and note it in Features.</div>' : ''}
      ${slotNote ? `<div class="sb-h">🔮 Spellcasting</div><div class="lvl-feat">${slotNote} <em>(applied automatically)</em></div>` : ''}
      <div class="lvl-row" style="margin-top:12px">
        <button id="lvl-confirm" class="lvl-confirm" disabled>Confirm Level ${next}</button>
      </div>
      <div class="sb-foot">SRD 5.2.1 · CC-BY-4.0</div>
    </div>`;
  document.body.appendChild(m);
  const ready = () => { $('lvl-confirm').disabled = !(state.hp !== null && (!isASI || state.asi.length === 2)); };
  m.addEventListener('click', (e) => {
    if (e.target === m || e.target.classList.contains('sb-x')) { m.remove(); return; }
    const hb = e.target.closest('[data-hp]');
    if (hb) {
      const roll = hb.dataset.hp === 'roll';
      const base = roll ? (1 + Math.floor(Math.random() * die)) : avg;
      state.hp = Math.max(1, base + conMod);
      state.hpNote = roll ? `rolled ${base} on the d${die}` : `took the average ${avg}`;
      $('lvl-hp-out').textContent = `+${state.hp} HP (${state.hpNote} ${csFmt(conMod)} CON)`;
      m.querySelectorAll('[data-hp]').forEach((b) => b.classList.toggle('on', b === hb));
      ready(); return;
    }
    const abBtn = e.target.closest('[data-asi]');
    if (abBtn && isASI) {
      const a = abBtn.dataset.asi;
      const already = state.asi.filter((x) => x === a).length;
      if (state.asi.length >= 2 || (Number(cs.scores[a]) + already + 1) > 20) return;
      state.asi.push(a);
      abBtn.textContent = `${a.toUpperCase()} ${Number(cs.scores[a]) + already + 1}`;
      abBtn.classList.add('on');
      $('lvl-asi-out').textContent = `${state.asi.length} / 2 picked — ${state.asi.map((x) => '+1 ' + x.toUpperCase()).join(', ')}`;
      ready(); return;
    }
    if (e.target.id === 'lvl-confirm' && !e.target.disabled) { applyLevelUp(next, die, state, featText); m.remove(); }
  });
}
function applyLevelUp(next, die, state, featText) {
  const oldProf = csProf();
  cs.level = next;
  cs.maxhp = (Number(cs.maxhp) || 0) + state.hp;
  cs.hp = (Number(cs.hp) || 0) + state.hp;
  cs.hitDiceTotal = next + 'd' + die;
  state.asi.forEach((a) => { cs.scores[a] = Math.min(20, (Number(cs.scores[a]) || 10) + 1); });
  const clsName = String(cs.cls || '').trim();
  const ct = window.SRD && window.SRD.casterType && window.SRD.casterType[clsName];
  if (ct && window.SRD.slots) {
    if (ct === 'pact') {
      const p = window.SRD.slots.pact[next];
      for (let l = 1; l <= 9; l++) if (cs.slots[l]) { cs.slots[l].max = 0; cs.slots[l].used = 0; }
      cs.slots[p[1]] = { max: p[0], used: 0 };
    } else {
      const row = window.SRD.slots[ct][next] || [];
      for (let l = 1; l <= 9; l++) {
        const mx = row[l - 1] || 0;
        cs.slots[l] = cs.slots[l] || { max: 0, used: 0 };
        cs.slots[l].max = mx;
        if (cs.slots[l].used > mx) cs.slots[l].used = mx;
      }
    }
  }
  if (featText && featText !== 'Choose your subclass!') cs.features = (cs.features ? cs.features + '\n' : '') + `Lv ${next}: ${featText}`;
  const newProf = csProf();
  saveCS(); if (csBuilt) { csPopulate(); csRecompute(); csRenderAttacks(); } sendPartyStatus(); syncLinkedToken();
  if (window.refreshSpellGates) window.refreshSpellGates();
  if ($('sh-level')) $('sh-level').value = cs.level;
  if ($('sh-hp')) $('sh-hp').value = cs.hp;
  if ($('sh-maxhp')) $('sh-maxhp').value = cs.maxhp;
  if (typeof saveSheet === 'function') saveSheet();
  const asiNote = state.asi.length ? ` ${state.asi.map((a) => '+1 ' + a.toUpperCase()).join(', ')}.` : '';
  const profNote = newProf > oldProf ? ` Proficiency rises to +${newProf}!` : '';
  socket.emit('chat', { text: `⬆️ ${cs.name || me.name} reaches level ${cs.level}! (${state.hpNote} = +${state.hp} HP → ${cs.hp}/${cs.maxhp}).${asiNote}${profNote}` });
}

function doRest(type) {
  const announce = (text) => socket.emit('chat', { text: `🛌 ${text}` });
  if (type === 'long') {
    cs.hp = Number(cs.maxhp) || cs.hp; cs.temphp = 0;
    for (let l = 1; l <= 9; l++) if (cs.slots[l]) cs.slots[l].used = 0;
    cs.resUsed = {};                                          // all class resources recover
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

/* ============ AMBIENT SOUNDSCAPES (synthesized in WebAudio — no audio files) ============ */
const AMB = (() => {
  let ctx = null, master = null, nodes = [], timers = [], current = 'off', vol = 0.4;
  function ensure() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      master = ctx.createGain(); master.gain.value = vol; master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') {
      ctx.resume();
      const once = () => { ctx.resume(); document.removeEventListener('pointerdown', once); };
      document.addEventListener('pointerdown', once);
    }
    return true;
  }
  function noiseBuf(brown) {
    const len = ctx.sampleRate * 2, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (brown) { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w;
    }
    return buf;
  }
  function noise(brown, filterType, freq, q, gain) {
    const src = ctx.createBufferSource(); src.buffer = noiseBuf(brown); src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = filterType; f.frequency.value = freq; f.Q.value = q || 0.7;
    const g = ctx.createGain(); g.gain.value = gain;
    src.connect(f); f.connect(g); g.connect(master); src.start();
    nodes.push(src, f, g);
    return { src, f, g };
  }
  function lfo(param, freq, depth, base) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.value = freq; g.gain.value = depth;
    if (base !== undefined) param.value = base;
    o.connect(g); g.connect(param); o.start();
    nodes.push(o, g);
  }
  function blip(freq, dur, gain, type) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type || 'sine'; o.frequency.value = freq;
    g.gain.setValueAtTime(gain, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
    o.connect(g); g.connect(master); o.start(); o.stop(ctx.currentTime + dur);
  }
  function every(msMin, msMax, fn) {
    const h = { t: 0 };
    const loop = () => { fn(); h.t = setTimeout(loop, msMin + Math.random() * (msMax - msMin)); };
    h.t = setTimeout(loop, msMin + Math.random() * (msMax - msMin));
    timers.push(h);
  }
  const BUILD = {
    rain() {
      noise(false, 'lowpass', 1400, 0.5, 0.14);
      const hiss = noise(false, 'highpass', 4000, 0.5, 0.03);
      lfo(hiss.g.gain, 0.11, 0.015, 0.03);
      every(400, 2500, () => blip(700 + Math.random() * 900, 0.05, 0.02, 'triangle'));
    },
    wind() {
      const w = noise(false, 'bandpass', 400, 1.4, 0.16);
      lfo(w.f.frequency, 0.07, 220, 420);
      lfo(w.g.gain, 0.05, 0.07, 0.14);
    },
    tavern() {
      const m = noise(true, 'lowpass', 500, 0.6, 0.22);
      lfo(m.g.gain, 0.23, 0.05, 0.2);
      every(3000, 9000, () => blip(1800 + Math.random() * 1200, 0.12, 0.03, 'sine'));
      every(5000, 14000, () => blip(300 + Math.random() * 150, 0.35, 0.02, 'sine'));
    },
    dungeon() {
      [55, 55.7].forEach((f) => {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = 'sine'; o.frequency.value = f; g.gain.value = 0.05;
        o.connect(g); g.connect(master); o.start(); nodes.push(o, g);
      });
      const sw = noise(true, 'lowpass', 240, 0.5, 0.05);
      lfo(sw.g.gain, 0.03, 0.035, 0.045);
      every(8000, 20000, () => blip(90 + Math.random() * 60, 1.2, 0.04, 'sine'));
    },
    fire() {
      noise(true, 'lowpass', 900, 0.6, 0.18);
      every(120, 700, () => blip(1500 + Math.random() * 2500, 0.03, 0.025, 'square'));
    },
    forest() {
      const w = noise(false, 'bandpass', 700, 1.2, 0.06);
      lfo(w.g.gain, 0.09, 0.03, 0.05);
      every(2500, 8000, () => {
        const t0 = ctx.currentTime;
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = 'sine';
        o.frequency.setValueAtTime(2400 + Math.random() * 1200, t0);
        o.frequency.exponentialRampToValueAtTime(1800 + Math.random() * 800, t0 + 0.18);
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(0.045, t0 + 0.03);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.2);
        o.connect(g); g.connect(master); o.start(t0); o.stop(t0 + 0.22);
      });
    },
  };
  function stop() {
    timers.forEach((h) => clearTimeout(h.t)); timers = [];
    nodes.forEach((n) => { try { if (n.stop) n.stop(); } catch {} try { n.disconnect(); } catch {} });
    nodes = [];
  }
  function set(type) {
    current = type || 'off';
    if (current === 'off') { stop(); return; }
    if (!ensure()) return;
    stop();
    if (BUILD[current]) BUILD[current]();
  }
  function setVol(v) { vol = v; if (master) master.gain.value = v; }
  return { set, setVol, cur: () => current };
})();
document.querySelectorAll('.amb').forEach((b) => {
  b.onclick = () => {
    if (!me.isGm) { flashHint('Only the DM sets the table ambience.'); return; }
    socket.emit('ambience:set', b.dataset.amb);
  };
});
function ambSyncUI(type) { document.querySelectorAll('.amb').forEach((x) => x.classList.toggle('active', x.dataset.amb === type)); }
socket.on('ambience:set', (type) => {
  ambSyncUI(type);
  AMB.set(type);
  flashHint(type === 'off' ? '🔇 Ambience off' : '🎵 Ambience: ' + type);
});
(function () { const v = $('amb-vol'); if (v) v.oninput = () => AMB.setVol(Number(v.value) / 100); })();

/* ============ SESSION LOG EXPORT ============ */
if ($('log-export')) $('log-export').onclick = () => {
  const lines = [...document.querySelectorAll('#chat-log .msg')].map((e) => e.textContent.trim()).filter(Boolean);
  if (!lines.length) { flashHint('Nothing in the log yet.'); return; }
  const head = `⚔️ AI D&D Tabletop — session log\nRoom: ${me.room || '?'} · Exported: ${new Date().toLocaleString()}\n${'—'.repeat(40)}\n\n`;
  const blob = new Blob([head + lines.join('\n')], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `session-${me.room || 'log'}-${new Date().toISOString().slice(0, 10)}.txt`;
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(a.href);
  flashHint('📜 Session log downloaded');
};

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

/* ============ TOKEN NAMEPLATES ============ */
(function () {
  const btn = $('names-btn'); if (!btn) return;
  const on = localStorage.getItem('dnd-names') === '1';
  document.body.classList.toggle('show-names', on);
  btn.classList.toggle('on', on);
  btn.onclick = () => {
    const now = document.body.classList.toggle('show-names');
    btn.classList.toggle('on', now);
    localStorage.setItem('dnd-names', now ? '1' : '0');
  };
})();

/* ============ SPELL / AoE TEMPLATES ============ */
$('aoe-btn').onclick = () => {
  const hidden = $('aoe-bar').classList.toggle('hidden');
  aoeMode = !hidden;
  $('aoe-btn').classList.toggle('on', aoeMode);
  if (aoeMode) { // turn off conflicting modes
    rulerMode = false; $('ruler-btn').classList.remove('on'); $('board').classList.remove('ruler-on');
  }
};
[['circle','aoe-circle'],['cone','aoe-cone'],['line','aoe-line'],['rect','aoe-rect']].forEach(([shape, id]) => {
  const btn = $(id); if (!btn) return;
  btn.onclick = () => {
    aoeShape = shape;
    ['aoe-circle','aoe-cone','aoe-line','aoe-rect'].forEach((x) => { const b = $(x); if (b) b.classList.toggle('active', x === id); });
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
  if (a.type === 'rect') return px >= Math.min(a.x, a.x2) && px <= Math.max(a.x, a.x2) && py >= Math.min(a.y, a.y2) && py <= Math.max(a.y, a.y2);
  const dx = a.x2 - a.x, dy = a.y2 - a.y, len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len, pxp = -uy, pyp = ux, half = len * 0.5;
  const bx = a.x + ux * len, by = a.y + uy * len;
  return pointInTri(px, py, { x: a.x, y: a.y }, { x: bx + pxp * half, y: by + pyp * half }, { x: bx - pxp * half, y: by - pyp * half });
}

const aoeSizeFt = () => Math.max(5, parseInt($('aoe-size').value) || 20);
const ft2px = (ft) => (ft / 5) * gridSize;

function previewFrom(e) {
  let c = snapPt(boardCoords(e));
  if (aoeShape === 'circle') return { type: 'circle', x: aoeStart.x, y: aoeStart.y, size: aoeSizeFt(), color: me.color };
  // Hold Shift to snap the cone/line direction to the nearest 45°.
  if (e.shiftKey && (aoeShape === 'cone' || aoeShape === 'line')) {
    const dx = c.x - aoeStart.x, dy = c.y - aoeStart.y;
    const dist = Math.hypot(dx, dy);
    const step = Math.PI / 4;
    const ang = Math.round(Math.atan2(dy, dx) / step) * step;
    c = { x: aoeStart.x + Math.cos(ang) * dist, y: aoeStart.y + Math.sin(ang) * dist };
  }
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
  if (a.type === 'rect') {
    const x = Math.min(a.x, a.x2), y = Math.min(a.y, a.y2);
    const w = Math.abs(a.x2 - a.x), h = Math.abs(a.y2 - a.y);
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}" ${common} />`;
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
  micMuted = false;
  if ($('mute-btn')) { $('mute-btn').classList.remove('hidden', 'muted'); $('mute-btn').textContent = '🔊 Mic'; }
  socket.emit('join', { roomId: me.room, name: me.name, color: me.color });
}
function stopVoice() {
  voiceOn = false; $('voice-btn').textContent = '🎙️ Voice: Off'; $('voice-btn').classList.remove('on');
  Object.values(peers).forEach((pc) => pc.close()); Object.keys(peers).forEach((k) => delete peers[k]);
  if (localStream) { localStream.getTracks().forEach((t) => t.stop()); localStream = null; }
  $('remote-audio-container').innerHTML = '';
  if ($('mute-btn')) $('mute-btn').classList.add('hidden');
}
/* Mute / unmute the local microphone without leaving voice chat. */
let micMuted = false;
if ($('mute-btn')) $('mute-btn').onclick = () => {
  if (!localStream) return;
  micMuted = !micMuted;
  localStream.getAudioTracks().forEach((t) => { t.enabled = !micMuted; });
  $('mute-btn').textContent = micMuted ? '🔇 Muted' : '🔊 Mic';
  $('mute-btn').classList.toggle('muted', micMuted);
  flashHint(micMuted ? '🔇 Microphone muted' : '🔊 Microphone live');
};
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
