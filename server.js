// D&D VTT — realtime server
// Express serves the client; Socket.io handles rooms, state sync,
// the AI Dungeon Master (OpenAI proxy), and WebRTC voice signaling.

import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, { maxHttpBufferSize: 30e6 }); // 30MB — allows large hi-res uploaded map images

app.use(express.static(__dirname));
app.get('/health', (_req, res) => res.json({ ok: true }));
// Verify which AI backend is wired up (handy for confirming an Ollama / local model).
app.get('/ai-status', (_req, res) => {
  const c = effectiveAI();
  let host = '';
  try { host = new URL(c.baseUrl).host; } catch { host = c.baseUrl; }
  res.json({
    backend: c.local ? 'local / self-hosted (Ollama-compatible)' : 'OpenAI',
    baseUrlHost: host,
    model: c.model,
    apiKeySet: !!c.key,
    source: c.source,                 // 'in-app' (set via the game) or 'env' (Render)
    ready: c.ready,
    note: c.local
      ? 'Pointing at a local/self-hosted model' + (c.source === 'in-app' ? ' set in-app by the DM.' : '.') + ' Make sure that server is reachable and has the model pulled.'
      : (c.key ? 'Using OpenAI with a key.' : 'No AI configured — stub DM. Set it in-app (🧠 badge) or point OPENAI_BASE_URL at a local model.'),
  });
});

const PORT = process.env.PORT || 3000;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
// Point this at any OpenAI-compatible endpoint — e.g. a local Ollama / LM Studio
// server for a free, never-runs-out AI DM:  OPENAI_BASE_URL=http://localhost:11434/v1
const OPENAI_BASE_URL = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
const LOCAL_AI = !/api\.openai\.com/.test(OPENAI_BASE_URL);

// ---- In-memory game state. One "room" = one campaign table. ----
const rooms = new Map();
// Pending player-to-player trade offers: offerId -> {roomId, fromId, fromName, toId, item, ts}
const pendingTrades = new Map();

// ---- Persistence: auto-save rooms to disk so campaigns survive restarts. ----
const DATA_FILE = join(__dirname, 'rooms-data.json');

// ---- In-app AI backend config (DM can point the DM at Ollama without touching Render) ----
const AI_CONFIG_FILE = join(__dirname, 'ai-config.json');
let runtimeAI = null;   // { baseUrl, model, key } set from inside the game, overrides env
try { if (fs.existsSync(AI_CONFIG_FILE)) runtimeAI = JSON.parse(fs.readFileSync(AI_CONFIG_FILE, 'utf8')); } catch {}
function saveAIConfig() {
  try { runtimeAI ? fs.writeFileSync(AI_CONFIG_FILE, JSON.stringify(runtimeAI)) : (fs.existsSync(AI_CONFIG_FILE) && fs.unlinkSync(AI_CONFIG_FILE)); } catch (e) { console.error('saveAIConfig:', e.message); }
}
// The config actually used for a DM call — in-app override wins over Render env.
function effectiveAI() {
  const base = (runtimeAI && runtimeAI.baseUrl) ? String(runtimeAI.baseUrl).replace(/\/+$/, '') : OPENAI_BASE_URL;
  const model = (runtimeAI && runtimeAI.model) ? runtimeAI.model : OPENAI_MODEL;
  const key = runtimeAI ? (runtimeAI.key || '') : OPENAI_API_KEY;
  const local = !/api\.openai\.com/.test(base);
  return { baseUrl: base, model, key, local, ready: local || !!key, source: runtimeAI ? 'in-app' : 'env' };
}
let saveTimer = null;

function saveRooms() {
  try {
    const out = {};
    for (const [id, room] of rooms) {
      // Players are connection-bound (socket ids) — don't persist them.
      out[id] = {
        tokens: room.tokens,
        chat: room.chat.slice(-200),
        mapImage: room.mapImage,
        gridSize: room.gridSize,
        gmPassword: room.gmPassword,
        initiative: room.initiative,
        turnIndex: room.turnIndex,
        fog: room.fog,
        walls: room.walls,
        lighting: room.lighting,
        aoes: room.aoes,
        handout: room.handout,
        weather: room.weather,
        ambience: room.ambience,
        notes: room.notes,
        quests: room.quests || { main: '', sides: [] },
        drawings: (room.drawings || []).slice(-500),
      };
    }
    fs.writeFileSync(DATA_FILE, JSON.stringify(out));
  } catch (e) { console.error('saveRooms failed:', e.message); }
}

// Debounced save — coalesces bursts of changes into one write.
function markDirty() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => { saveTimer = null; saveRooms(); }, 3000);
}

function loadRooms() {
  try {
    if (!fs.existsSync(DATA_FILE)) return;
    const raw = fs.readFileSync(DATA_FILE, 'utf8').trim();
    if (!raw) return;
    const data = JSON.parse(raw);
    for (const [id, room] of Object.entries(data)) {
      rooms.set(id, {
        tokens: room.tokens || {},
        chat: room.chat || [],
        mapImage: room.mapImage || null,
        gridSize: room.gridSize || 70,
        players: {},
        gmPassword: room.gmPassword || null,
        initiative: room.initiative || [],
        turnIndex: room.turnIndex || 0,
        fog: room.fog || { active: false, hidden: {} },
        walls: room.walls || {},
        lighting: !!room.lighting,
        aoes: room.aoes || [],
        handout: room.handout || null,
        weather: room.weather || 'clear',
        ambience: room.ambience || 'off',
        notes: room.notes || '',
        quests: room.quests || { main: '', sides: [] },
        drawings: room.drawings || [],
        round: room.round || 1,
        partyStatus: {},
        sheets: {},
      });
    }
    console.log(`  Restored ${rooms.size} saved room(s) from disk.`);
  } catch (e) { console.error('loadRooms failed:', e.message); }
}

// Save on graceful shutdown (Render sends SIGTERM on restart / spin-down).
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => { saveRooms(); process.exit(0); });
}
// Periodic safety-net autosave.
setInterval(saveRooms, 30000);

function getRoom(id) {
  if (!rooms.has(id)) {
    rooms.set(id, {
      tokens: {},
      chat: [],
      mapImage: null,
      gridSize: 70,
      players: {},            // socketId -> {id, name, color, isGm}
      gmPassword: null,        // first GM to set a password claims the role
      initiative: [],          // [{id, name, init}]
      turnIndex: 0,
      round: 1,                // combat round counter
      fog: { active: false, hidden: {} }, // hidden: { "cx,cy": true }
      walls: {},               // "cx,cy": true — sight-blocking wall cells
      lighting: false,         // dynamic line-of-sight active
      aoes: [],                // area-of-effect templates [{id,type,x,y,x2,y2,size,color}]
      handout: null,           // image data-url currently shown to the table
      weather: 'clear',        // atmosphere overlay: clear|rain|snow|fog|embers
      ambience: 'off',         // synced soundscape: off|rain|wind|tavern|dungeon|fire|forest
      notes: '',               // shared campaign journal text
      quests: { main: '', sides: [] },  // quest log — DM/AI set, everyone sees
      drawings: [],            // freehand map annotations [{points:[[x,y]...], color, w}]
      partyStatus: {},         // socketId -> {name, hp, maxhp, ac} (live sheet HP)
      sheets: {},              // socketId -> full sheet summary (DM read-only oversight)
    });
  }
  return rooms.get(id);
}

function broadcastPlayers(roomId) {
  const room = rooms.get(roomId);
  if (room) io.to(roomId).emit('players', Object.values(room.players));
}
function broadcastParty(roomId) {
  const room = rooms.get(roomId);
  if (room) io.to(roomId).emit('party:list', Object.values(room.partyStatus));
}
function isGm(room, socketId) { return !!room.players[socketId]?.isGm; }
// Send the whole party's sheet summaries to every GM in the room (DM-only oversight).
function sendSheetsToGms(roomId) {
  const room = rooms.get(roomId); if (!room) return;
  const list = Object.values(room.sheets || {});
  for (const sid of Object.keys(room.players)) {
    if (room.players[sid]?.isGm) io.to(sid).emit('sheets:update', list);
  }
}
// Snapshot of the "everyone ready?" tally: who's a player, who has confirmed.
function readyState(room) {
  const names = Object.values(room.players || {}).filter((p) => !p.isGm).map((p) => p.name);
  const ready = room.ready || {};
  const readyNames = names.filter((n) => ready[n]);
  return { players: names, ready: readyNames, allReady: names.length > 0 && readyNames.length === names.length };
}
// Who may move/edit/remove a token: the DM (all), or the token's owner
// (matched by stable player name, or by the current socket id, or if unowned).
function canControlToken(room, socketId, tok) {
  if (!tok) return false;
  if (isGm(room, socketId)) return true;
  const myName = room.players[socketId]?.name;
  if (tok.owner && myName && tok.owner === myName) return true;
  if (tok.ownerId && tok.ownerId === socketId) return true;
  if (!tok.owner && !tok.ownerId) return true;   // legacy/unowned tokens stay movable
  return false;
}
// Airtight GM layer: hidden tokens never leave the server for non-GM players.
function tokensFor(room, socketId) {
  if (isGm(room, socketId)) return room.tokens;
  const out = {};
  for (const [id, t] of Object.entries(room.tokens || {})) if (!t || !t.hidden) out[id] = t;
  return out;
}
// Emit a token event per-socket, respecting each viewer's visibility.
function emitTokenPerSocket(room, ev, token, extra) {
  for (const sid of Object.keys(room.players || {})) {
    if (token && token.hidden && !isGm(room, sid)) {
      io.to(sid).emit('token:remove', token.id); // players must not hold a hidden token
    } else {
      io.to(sid).emit(ev, extra || token);
    }
  }
}
function rid() { return Math.random().toString(36).slice(2, 9); }

// ---- AI Dungeon Master ----
const DM_SYSTEM_PROMPT = `You are a masterful Dungeon Master running a Dungeons & Dragons 5th Edition game.
Narrate vividly but concisely (2-5 sentences unless a big set-piece). Describe scenes, voice NPCs,
and react to player actions and dice rolls. When players attempt risky actions, ask for a specific
ability check or saving throw (e.g. "Make a DC 14 Dexterity save"). Keep the story moving, offer
real choices, and never decide a player's actions for them. Stay in character as the narrator/world.
You may roll dice yourself when the story calls for it (attacks, damage, random events) — state the
result inline, e.g. "The goblin's arrow flies wide (rolled 7 vs AC 15)." A BATTLEFIELD STATE line may
be provided listing tokens and their current HP; use it to narrate wounds, bloodied foes, and deaths
accurately, and never contradict a creature's stated HP.`;

async function callOpenAIDM(messages) {
  const cfg = effectiveAI();
  // A local OpenAI-compatible server (Ollama/LM Studio) needs no key.
  if (!cfg.ready) {
    return "⚠️ No AI is configured yet, so I'm a stub DM. As the DM, click the 🧠 badge (top bar) and paste your Ollama tunnel URL — or set OPENAI_API_KEY. (For now: the tavern door creaks open, and adventure awaits...)";
  }
  const payload = {
    model: cfg.model,
    messages: [{ role: 'system', content: DM_SYSTEM_PROMPT }, ...messages],
    temperature: 0.9,
    max_tokens: 500,
  };
  // Retry up to 3 times on transient 429/5xx with exponential backoff.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(cfg.baseUrl + '/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(cfg.key ? { Authorization: `Bearer ${cfg.key}` } : {}) },
        body: JSON.stringify(payload),
      });
      if (r.ok) {
        const data = await r.json();
        return data.choices?.[0]?.message?.content?.trim() || '...(the DM ponders silently)';
      }
      const body = await r.text();
      console.error('OpenAI error', r.status, body);
      // 429 or 5xx → wait and retry (honor Retry-After if present)
      if ((r.status === 429 || r.status >= 500) && attempt < 2) {
        const ra = parseFloat(r.headers.get('retry-after')) || 0;
        const wait = ra ? ra * 1000 : 1200 * Math.pow(2, attempt);
        await new Promise((res) => setTimeout(res, Math.min(wait, 8000)));
        continue;
      }
      // Out of retries or a non-retryable error → explain clearly.
      if (r.status === 429) {
        const outOfQuota = /insufficient_quota|exceeded your current quota|billing/i.test(body);
        return outOfQuota
          ? "⚠️ The AI DM is out of OpenAI credits. This is a billing issue on the API key — add credits at platform.openai.com → Billing, then try again. (Everything else in the app keeps working without the AI DM.)"
          : "⚠️ The AI DM is being rate-limited by OpenAI (too many requests too fast). Wait a few seconds and ask again — the rest of the table works normally in the meantime.";
      }
      if (r.status === 401) return "⚠️ The AI DM's OpenAI key was rejected (401). Double-check OPENAI_API_KEY in your Render settings.";
      return `⚠️ The DM stumbled (OpenAI error ${r.status}). The rest of the app is unaffected — try again shortly.`;
    } catch (e) {
      console.error('OpenAI fetch failed:', e);
      if (attempt < 2) { await new Promise((res) => setTimeout(res, 1000 * (attempt + 1))); continue; }
      return '⚠️ Could not reach the AI DM service — check the server’s network. The table still works without it.';
    }
  }
}

function battlefieldSummary(room) {
  const toks = Object.values(room.tokens || {});
  if (!toks.length) return null;
  const parts = toks.map((t) => {
    const name = t.label || t.name || 'token';
    const hp = t.hp, maxhp = t.maxhp ?? t.maxHp;
    if (hp != null && maxhp != null && Number(maxhp) > 0) {
      const status = hp <= 0 ? 'DOWN' : hp <= maxhp / 2 ? 'bloodied' : 'healthy';
      return `${name} (${hp}/${maxhp} HP, ${status})`;
    }
    return name;
  }).filter((p) => p && p !== 'token');
  return `BATTLEFIELD STATE — ${parts.join('; ')}.`;
}

function buildDMContext(room) {
  const msgs = room.chat.slice(-20)
    .filter((m) => m.role === 'player' || m.role === 'dm' || m.role === 'roll')
    .map((m) => {
      if (m.role === 'dm') return { role: 'assistant', content: m.text };
      const who = m.role === 'roll' ? 'DICE' : m.author;
      return { role: 'user', content: `${who}: ${m.text}` };
    });
  const bf = battlefieldSummary(room);
  if (bf) msgs.unshift({ role: 'user', content: bf });
  return msgs;
}

function pushSystem(roomId, text) {
  const room = rooms.get(roomId);
  if (!room) return;
  const msg = { id: 'm_' + rid(), author: 'System', role: 'system', text, ts: Date.now() };
  room.chat.push(msg);
  io.to(roomId).emit('chat', msg);
}

io.on('connection', (socket) => {
  let joinedRoom = null;

  socket.on('join', ({ roomId, name, color, gmPassword }) => {
    joinedRoom = roomId || 'default';
    socket.join(joinedRoom);
    const room = getRoom(joinedRoom);

    // GM role resolution via password
    let gm = false;
    if (gmPassword && gmPassword.trim()) {
      if (!room.gmPassword) { room.gmPassword = gmPassword.trim(); gm = true; }
      else if (room.gmPassword === gmPassword.trim()) { gm = true; }
    }
    room.players[socket.id] = { id: socket.id, name: name || 'Adventurer', color: color || '#c0392b', isGm: gm };

    socket.emit('state', {
      tokens: tokensFor(room, socket.id),
      chat: room.chat.slice(-100),
      mapImage: room.mapImage,
      gridSize: room.gridSize,
      initiative: room.initiative,
      turnIndex: room.turnIndex,
      round: room.round,
      fog: room.fog,
      walls: room.walls,
      lighting: room.lighting,
      aoes: room.aoes,
      handout: room.handout,
      weather: room.weather,
      ambience: room.ambience || 'off',
      notes: room.notes || '',
      quests: room.quests || { main: '', sides: [] },
      drawings: room.drawings || [],
      youId: socket.id,
      isGm: gm,
      gmClaimed: !!room.gmPassword,
    });
    broadcastPlayers(joinedRoom);
    broadcastParty(joinedRoom);
    if (gm) io.to(socket.id).emit('sheets:update', Object.values(room.sheets || {}));  // DM sees everyone's sheets on join
    socket.to(joinedRoom).emit('peer-joined', { peerId: socket.id, name: room.players[socket.id].name });
    pushSystem(joinedRoom, `${room.players[socket.id].name} joined the table${gm ? ' as GM' : ''}.`);
  });

  // ---- Tokens ----
  socket.on('token:add', (token) => {
    const room = rooms.get(joinedRoom); if (!room) return;
    token.id = token.id || 't_' + rid();
    token.ownerId = socket.id;
    token.owner = room.players[socket.id]?.name || null;   // stable ownership by name
    room.tokens[token.id] = token;
    emitTokenPerSocket(room, 'token:add', token);
    markDirty();
  });
  socket.on('token:move', ({ id, x, y }) => {
    const room = rooms.get(joinedRoom); if (!room || !room.tokens[id]) return;
    if (!canControlToken(room, socket.id, room.tokens[id])) return;   // only your own token (DM moves all)
    room.tokens[id].x = x; room.tokens[id].y = y;
    const t = room.tokens[id];
    // Hidden tokens: only GMs (other than the mover) receive live movement.
    for (const sid of Object.keys(room.players || {})) {
      if (sid === socket.id) continue;
      if (t.hidden && !isGm(room, sid)) continue;
      io.to(sid).emit('token:move', { id, x, y });
    }
  });
  socket.on('token:update', (token) => {
    const room = rooms.get(joinedRoom); if (!room || !room.tokens[token.id]) return;
    if (!canControlToken(room, socket.id, room.tokens[token.id])) return;   // only your own token
    const { owner, ownerId, ...safe } = token;   // players can't reassign ownership
    room.tokens[token.id] = { ...room.tokens[token.id], ...safe };
    emitTokenPerSocket(room, 'token:update', room.tokens[token.id]);
    markDirty();
  });
  socket.on('token:remove', (id) => {
    const room = rooms.get(joinedRoom); if (!room || !room.tokens[id]) return;
    if (!canControlToken(room, socket.id, room.tokens[id])) return;   // only your own token (DM removes all)
    delete room.tokens[id];
    io.to(joinedRoom).emit('token:remove', id);
    markDirty();
  });
  // DM calls for initiative — every player rolls their own DEX-based init.
  socket.on('init:rollcall', () => {
    const room = rooms.get(joinedRoom); if (!room || !isGm(room, socket.id)) return;
    io.to(joinedRoom).emit('init:rollcall');
    pushSystem(joinedRoom, '⚔️ Roll for initiative!');
  });

  // ---- "Everyone ready?" checkpoint ----
  socket.on('ready:ask', () => {
    const room = rooms.get(joinedRoom); if (!room || !isGm(room, socket.id)) return;
    room.ready = {};                       // reset the tally
    io.to(joinedRoom).emit('ready:ask');
    io.to(joinedRoom).emit('ready:state', readyState(room));
  });
  socket.on('ready:set', ({ ready }) => {
    const room = rooms.get(joinedRoom); if (!room) return;
    const p = room.players[socket.id]; if (!p || p.isGm) return;
    room.ready = room.ready || {};
    room.ready[p.name] = !!ready;
    io.to(joinedRoom).emit('ready:state', readyState(room));
  });

  // ---- DM sets the AI backend from inside the game (overrides Render env) ----
  socket.on('ai:config:set', ({ baseUrl, model, key }, ack) => {
    const room = rooms.get(joinedRoom); if (!room || !isGm(room, socket.id)) return;
    let b = String(baseUrl || '').trim();
    if (!/^https?:\/\//i.test(b)) { if (typeof ack === 'function') ack({ ok: false, error: 'URL must start with http:// or https://' }); return; }
    if (!/\/v1$/.test(b.replace(/\/+$/, ''))) b = b.replace(/\/+$/, '') + '/v1';   // be forgiving: append /v1
    runtimeAI = { baseUrl: b.replace(/\/+$/, ''), model: String(model || 'llama3.1').trim().slice(0, 60), key: String(key || '').slice(0, 200) };
    saveAIConfig();
    console.log('AI backend set in-app →', runtimeAI.baseUrl, runtimeAI.model);
    if (typeof ack === 'function') ack({ ok: true, status: effectiveAI() });
  });
  socket.on('ai:config:clear', (_x, ack) => {
    const room = rooms.get(joinedRoom); if (!room || !isGm(room, socket.id)) return;
    runtimeAI = null; saveAIConfig();
    if (typeof ack === 'function') ack({ ok: true, status: effectiveAI() });
  });
  // DM taps "Test connection" — do a tiny real call to the AI backend and report back.
  socket.on('ai:test', async (_x, ack) => {
    const room = rooms.get(joinedRoom);
    if (!room || !isGm(room, socket.id)) { if (typeof ack === 'function') ack({ ok: false, error: 'DM only' }); return; }
    const cfg = effectiveAI();
    if (!cfg.ready) { if (typeof ack === 'function') ack({ ok: false, error: 'No AI configured yet.' }); return; }
    try {
      const reply = await callOpenAIDM([{ role: 'user', content: 'Reply with exactly one short word.' }]);
      const failed = /^⚠️/.test(reply);
      if (typeof ack === 'function') ack({ ok: !failed, sample: String(reply).slice(0, 140), backend: cfg.local ? 'local (Ollama)' : 'OpenAI', model: cfg.model });
    } catch (e) {
      if (typeof ack === 'function') ack({ ok: false, error: String(e && e.message || e).slice(0, 140) });
    }
  });

  // DM reassigns who controls a token (by player name; empty = DM controls it).
  socket.on('token:assign', ({ id, owner }) => {
    const room = rooms.get(joinedRoom); if (!room || !isGm(room, socket.id) || !room.tokens[id]) return;
    const name = String(owner || '').slice(0, 40);
    room.tokens[id].owner = name || null;
    room.tokens[id].ownerId = null;   // name-based from now on, survives reconnects
    emitTokenPerSocket(room, 'token:update', room.tokens[id]);
    markDirty();
  });

  // ---- Map / grid ----
  socket.on('map:set', (dataUrl) => {
    const room = rooms.get(joinedRoom); if (!room || !isGm(room, socket.id)) return;  // DM-only battle maps
    room.mapImage = dataUrl;
    io.to(joinedRoom).emit('map:set', dataUrl);
  });
  socket.on('grid:set', (size) => {
    const room = rooms.get(joinedRoom); if (!room) return;
    room.gridSize = size;
    io.to(joinedRoom).emit('grid:set', size);
  });

  // ---- Ping (Alt-click beacon) ----
  socket.on('ping', ({ x, y }) => {
    const room = rooms.get(joinedRoom); if (!room) return;
    const p = room.players[socket.id];
    io.to(joinedRoom).emit('ping', { x, y, color: p?.color || '#d9b154', name: p?.name || '' });
  });

  // ---- Initiative tracker ----
  function emitInit() {
    const room = rooms.get(joinedRoom);
    io.to(joinedRoom).emit('init:state', { list: room.initiative, turnIndex: room.turnIndex, round: room.round });
  }
  socket.on('init:add', ({ name, init }) => {
    const room = rooms.get(joinedRoom); if (!room) return;
    room.initiative.push({ id: 'i_' + rid(), name: name || '?', init: Number(init) || 0 });
    emitInit();
  });
  socket.on('init:remove', (id) => {
    const room = rooms.get(joinedRoom); if (!room) return;
    room.initiative = room.initiative.filter((e) => e.id !== id);
    if (room.turnIndex >= room.initiative.length) room.turnIndex = 0;
    emitInit();
  });
  socket.on('init:sort', () => {
    const room = rooms.get(joinedRoom); if (!room) return;
    room.initiative.sort((a, b) => b.init - a.init);
    room.turnIndex = 0; room.round = 1;
    emitInit();
  });
  socket.on('init:turn', (dir) => {
    const room = rooms.get(joinedRoom); if (!room || room.initiative.length === 0) return;
    const next = room.turnIndex + (dir === 'prev' ? -1 : 1);
    if (next >= room.initiative.length) room.round += 1;          // wrapped forward → new round
    else if (next < 0 && room.round > 1) room.round -= 1;          // wrapped back → previous round
    room.turnIndex = (next + room.initiative.length) % room.initiative.length;
    emitInit();
  });
  socket.on('init:clear', () => {
    const room = rooms.get(joinedRoom); if (!room) return;
    room.initiative = []; room.turnIndex = 0; room.round = 1; emitInit();
  });
  socket.on('init:reorder', (orderIds) => {
    const room = rooms.get(joinedRoom); if (!room || !Array.isArray(orderIds)) return;
    const activeId = room.initiative[room.turnIndex] ? room.initiative[room.turnIndex].id : null;
    const byId = new Map(room.initiative.map((e) => [e.id, e]));
    const next = [];
    orderIds.forEach((id) => { if (byId.has(id)) { next.push(byId.get(id)); byId.delete(id); } });
    byId.forEach((e) => next.push(e)); // keep any not listed
    if (next.length !== room.initiative.length) return; // safety: no drops
    room.initiative = next;
    const idx = next.findIndex((e) => e.id === activeId);
    if (idx >= 0) room.turnIndex = idx;
    emitInit();
  });

  // ---- Fog of war (GM only) ----
  socket.on('fog:active', (active) => {
    const room = rooms.get(joinedRoom); if (!room || !isGm(room, socket.id)) return;
    room.fog.active = !!active;
    io.to(joinedRoom).emit('fog:state', room.fog);
  });
  socket.on('fog:cell', ({ key, hidden }) => {
    const room = rooms.get(joinedRoom); if (!room || !isGm(room, socket.id)) return;
    if (hidden) room.fog.hidden[key] = true; else delete room.fog.hidden[key];
    io.to(joinedRoom).emit('fog:cell', { key, hidden });
  });
  socket.on('fog:all', (hidden) => {
    const room = rooms.get(joinedRoom); if (!room || !isGm(room, socket.id)) return;
    if (hidden) {
      const cols = Math.ceil(2100 / room.gridSize), rowsN = Math.ceil(1400 / room.gridSize);
      room.fog.hidden = {};
      for (let cx = 0; cx < cols; cx++) for (let cy = 0; cy < rowsN; cy++) room.fog.hidden[`${cx},${cy}`] = true;
    } else { room.fog.hidden = {}; }
    room.fog.active = true;
    io.to(joinedRoom).emit('fog:state', room.fog);
  });

  // ---- Dynamic lighting: walls (GM only) ----
  socket.on('light:active', (active) => {
    const room = rooms.get(joinedRoom); if (!room || !isGm(room, socket.id)) return;
    room.lighting = !!active;
    io.to(joinedRoom).emit('light:state', { lighting: room.lighting, walls: room.walls });
  });
  socket.on('wall:cell', ({ key, on }) => {
    const room = rooms.get(joinedRoom); if (!room || !isGm(room, socket.id)) return;
    if (on) room.walls[key] = true; else delete room.walls[key];
    io.to(joinedRoom).emit('wall:cell', { key, on });
  });
  socket.on('wall:clear', () => {
    const room = rooms.get(joinedRoom); if (!room || !isGm(room, socket.id)) return;
    room.walls = {};
    io.to(joinedRoom).emit('light:state', { lighting: room.lighting, walls: room.walls });
  });

  // ---- Area-of-effect spell templates (any player) ----
  socket.on('aoe:add', (a) => {
    const room = rooms.get(joinedRoom); if (!room || !a) return;
    a.id = 'a_' + rid();
    room.aoes.push(a);
    if (room.aoes.length > 40) room.aoes.shift(); // keep it bounded
    io.to(joinedRoom).emit('aoe:add', a);
  });
  socket.on('aoe:remove', (id) => {
    const room = rooms.get(joinedRoom); if (!room) return;
    room.aoes = room.aoes.filter((a) => a.id !== id);
    io.to(joinedRoom).emit('aoe:remove', id);
  });
  socket.on('aoe:clear', () => {
    const room = rooms.get(joinedRoom); if (!room) return;
    room.aoes = [];
    io.to(joinedRoom).emit('aoe:clear');
  });

  // ---- Shared handout / image board ----
  socket.on('handout:show', (dataUrl) => {
    const room = rooms.get(joinedRoom); if (!room || !dataUrl) return;
    room.handout = dataUrl;
    io.to(joinedRoom).emit('handout:show', dataUrl);
  });
  socket.on('handout:clear', () => {
    const room = rooms.get(joinedRoom); if (!room) return;
    room.handout = null;
    io.to(joinedRoom).emit('handout:clear');
  });

  // ---- Party status (live sheet HP/AC) ----
  socket.on('party:status', (st) => {
    const room = rooms.get(joinedRoom); if (!room || !st) return;
    room.partyStatus[socket.id] = {
      name: String(st.name || 'Adventurer').slice(0, 24),
      hp: Number(st.hp) || 0, maxhp: Number(st.maxhp) || 0, ac: Number(st.ac) || 0,
      level: Math.max(1, Math.min(20, Number(st.level) || 1)),
    };
    broadcastParty(joinedRoom);
  });

  // ---- Full sheet summary → DM read-only oversight ----
  // Players push a compact, sanitized snapshot of their sheet. Only GMs receive it.
  // This is the anti-cheat window: the DM can see everyone's gear/currency so items
  // must be bought, earned, or traded — not fabricated.
  socket.on('sheet:push', (s) => {
    const room = rooms.get(joinedRoom); if (!room || !s) return;
    const clip = (v, n) => String(v == null ? '' : v).slice(0, n);
    const num = (v) => Number(v) || 0;
    const gearIn = Array.isArray(s.gear) ? s.gear.slice(0, 60) : [];
    const gear = gearIn.map((g) => ({
      name: clip(g && g.name, 60),
      qty: Math.max(1, Math.min(9999, num(g && g.qty) || 1)),
      wt: Math.max(0, num(g && g.wt)),
      on: !!(g && g.on),
    })).filter((g) => g.name);
    room.sheets[socket.id] = {
      id: socket.id,
      owner: clip(room.players[socket.id]?.name, 24),
      name: clip(s.name, 32) || 'Adventurer',
      cls: clip(s.cls, 24), level: Math.max(1, Math.min(20, num(s.level) || 1)),
      hp: num(s.hp), maxhp: num(s.maxhp), ac: num(s.ac),
      xp: num(s.xp),
      coins: {
        cp: num(s.cp), sp: num(s.sp), ep: num(s.ep), gp: num(s.gp), pp: num(s.pp),
      },
      gear,
      updated: Date.now(),
    };
    sendSheetsToGms(joinedRoom);
  });

  // ---- Player-to-player trading ----
  // A offers one item to B. Nothing moves until B accepts, so items change hands
  // by agreement — you can't shove gear onto someone, and you can't duplicate it.
  socket.on('trade:offer', ({ toId, item } = {}) => {
    const room = rooms.get(joinedRoom); if (!room) return;
    const from = room.players[socket.id]; if (!from) return;
    const to = room.players[toId]; if (!to || toId === socket.id) return;
    const name = String((item && item.name) || '').slice(0, 60); if (!name) return;
    const clean = {
      name, qty: Math.max(1, Math.min(9999, Number(item && item.qty) || 1)),
      wt: Math.max(0, Number(item && item.wt) || 0), on: false,
    };
    // cap outstanding offers per sender to avoid spam
    let mine = 0; for (const t of pendingTrades.values()) if (t.fromId === socket.id) mine++;
    if (mine > 12) { io.to(socket.id).emit('chat', { system: true, text: '⚠️ Too many pending trade offers. Wait for some to resolve.', ts: Date.now() }); return; }
    const offerId = 'tr_' + Math.random().toString(36).slice(2, 10);
    pendingTrades.set(offerId, { roomId: joinedRoom, fromId: socket.id, fromName: from.name, toId, item: clean, ts: Date.now() });
    io.to(toId).emit('trade:incoming', { offerId, fromName: from.name, item: clean });
    io.to(socket.id).emit('chat', { system: true, text: `🤝 You offered ${clean.name} to ${to.name}. Waiting for them to accept…`, ts: Date.now() });
  });

  socket.on('trade:respond', ({ offerId, accept } = {}) => {
    const t = pendingTrades.get(offerId); if (!t) return;
    if (t.toId !== socket.id || t.roomId !== joinedRoom) return;  // only the offeree can respond
    pendingTrades.delete(offerId);
    const room = rooms.get(joinedRoom); if (!room) return;
    const to = room.players[socket.id];
    const fromStillHere = !!room.players[t.fromId];
    if (accept) {
      if (fromStillHere) io.to(t.fromId).emit('trade:take', { item: t.item, toName: to ? to.name : 'someone' });
      io.to(socket.id).emit('trade:give', { item: t.item, fromName: t.fromName });
      pushSystem(joinedRoom, `🤝 ${t.fromName} traded ${t.item.name} to ${to ? to.name : 'someone'}.`);
    } else if (fromStillHere) {
      io.to(t.fromId).emit('trade:declined', { toName: to ? to.name : 'They', item: t.item });
    }
  });

  // ---- Weather / atmosphere ----
  socket.on('weather:set', (type) => {
    const room = rooms.get(joinedRoom); if (!room || !isGm(room, socket.id)) return;  // DM controls the weather
    const allowed = ['clear', 'rain', 'snow', 'fog', 'embers'];
    room.weather = allowed.includes(type) ? type : 'clear';
    io.to(joinedRoom).emit('weather:set', room.weather);
  });

  // ---- Ambience (synced, locally-synthesized soundscape) ----
  socket.on('ambience:set', (type) => {
    const room = rooms.get(joinedRoom); if (!room || !isGm(room, socket.id)) return;
    const allowed = ['off', 'rain', 'wind', 'tavern', 'dungeon', 'fire', 'forest'];
    room.ambience = allowed.includes(type) ? type : 'off';
    io.to(joinedRoom).emit('ambience:set', room.ambience);
    markDirty();
  });

  // ---- Shared campaign journal ----
  socket.on('notes:set', (text) => {
    const room = rooms.get(joinedRoom); if (!room) return;
    room.notes = String(text || '').slice(0, 20000);
    // broadcast to everyone else (sender already has it locally)
    socket.to(joinedRoom).emit('notes:set', room.notes);
  });

  // ---- Quest log (DM only sets; everyone sees) ----
  socket.on('quest:set', (q) => {
    const room = rooms.get(joinedRoom); if (!room || !isGm(room, socket.id)) return;
    const main = String((q && q.main) || '').slice(0, 500);
    const sides = Array.isArray(q && q.sides)
      ? q.sides.slice(0, 8).map((s) => ({
          text: String((s && s.text) || '').slice(0, 300),
          done: !!(s && s.done),
        })).filter((s) => s.text)
      : [];
    // NEW: full multi-quest board — many main + side quests can run at once.
    const list = Array.isArray(q && q.list)
      ? q.list.slice(0, 40).map((it) => ({
          id: String((it && it.id) || ('q_' + rid())).slice(0, 40),
          title: String((it && it.title) || '').slice(0, 300),
          kind: (it && it.kind === 'side') ? 'side' : 'main',
          done: !!(it && it.done),
        })).filter((it) => it.title)
      : [];
    room.quests = { main, sides, list };
    io.to(joinedRoom).emit('quest:update', room.quests);
    markDirty();
  });

  // ---- Freehand map drawing ----
  socket.on('draw:add', (stroke) => {
    const room = rooms.get(joinedRoom); if (!room || !stroke || !Array.isArray(stroke.points)) return;
    if (!room.drawings) room.drawings = [];
    room.drawings.push(stroke);
    if (room.drawings.length > 1000) room.drawings.shift();
    socket.to(joinedRoom).emit('draw:add', stroke);
  });
  socket.on('draw:clear', () => {
    const room = rooms.get(joinedRoom); if (!room) return;
    room.drawings = [];
    io.to(joinedRoom).emit('draw:clear');
  });

  // ---- Save / Load campaign ----
  socket.on('campaign:get', () => {
    const room = rooms.get(joinedRoom); if (!room) return;
    socket.emit('campaign:data', {
      tokens: room.tokens, mapImage: room.mapImage, gridSize: room.gridSize,
      initiative: room.initiative, turnIndex: room.turnIndex, fog: room.fog,
      walls: room.walls, lighting: room.lighting, aoes: room.aoes, handout: room.handout,
      weather: room.weather,
      savedAt: Date.now(), room: joinedRoom,
    });
  });
  socket.on('campaign:load', (data) => {
    const room = rooms.get(joinedRoom); if (!room || !isGm(room, socket.id) || !data) return;
    room.tokens = data.tokens || {};
    room.mapImage = data.mapImage || null;
    room.gridSize = data.gridSize || 70;
    room.initiative = data.initiative || [];
    room.turnIndex = data.turnIndex || 0;
    room.fog = data.fog || { active: false, hidden: {} };
    room.walls = data.walls || {};
    room.lighting = !!data.lighting;
    room.aoes = data.aoes || [];
    room.handout = data.handout || null;
    room.weather = data.weather || 'clear';
    // push full fresh state to everyone
    for (const sid of Object.keys(room.players)) {
      io.to(sid).emit('state', {
        tokens: tokensFor(room, sid), chat: room.chat.slice(-100), mapImage: room.mapImage,
        gridSize: room.gridSize, initiative: room.initiative, turnIndex: room.turnIndex,
        fog: room.fog, walls: room.walls, lighting: room.lighting, aoes: room.aoes,
        handout: room.handout, weather: room.weather, round: room.round,
        notes: room.notes || '', quests: room.quests || { main: '', sides: [] },
        youId: sid, isGm: room.players[sid].isGm, gmClaimed: !!room.gmPassword,
      });
    }
    pushSystem(joinedRoom, 'The GM loaded a saved campaign.');
  });

  // ---- Chat / rolls / DM ----
  socket.on('chat', ({ text }) => {
    const room = rooms.get(joinedRoom); if (!room) return;
    const p = room.players[socket.id];
    const msg = { id: 'm_' + rid(), author: p?.name || 'Someone', role: 'player', text, ts: Date.now() };
    room.chat.push(msg); io.to(joinedRoom).emit('chat', msg);
  });
  socket.on('roll', ({ formula, result, detail }) => {
    const room = rooms.get(joinedRoom); if (!room) return;
    const p = room.players[socket.id];
    const msg = { id: 'm_' + rid(), author: p?.name || 'Someone', role: 'roll', text: `rolled ${formula} → ${result}  (${detail})`, ts: Date.now() };
    room.chat.push(msg); io.to(joinedRoom).emit('chat', msg);
  });
  // GM milestone: level up every character at the table.
  socket.on('milestone', () => {
    const room = rooms.get(joinedRoom); if (!room || !isGm(room, socket.id)) return;
    pushSystem(joinedRoom, '🎉 The DM declares a milestone — the party levels up!');
    io.to(joinedRoom).emit('milestone');
  });
  // GM gives an item to a named player's sheet.
  socket.on('item:give', ({ to, item, from }) => {
    const room = rooms.get(joinedRoom); if (!room || !isGm(room, socket.id) || !item || !String(item).trim()) return;
    const target = Object.values(room.players).find((p) => p.name.toLowerCase() === String(to || '').trim().toLowerCase());
    if (!target) { io.to(socket.id).emit('chat', { id: 'm_' + rid(), author: 'System', role: 'system', text: `No player named "${to}" at the table.`, ts: Date.now() }); return; }
    const clean = String(item).slice(0, 60);
    const giver = String(from || '').trim().slice(0, 40);
    io.to(target.id).emit('item:give', { item: clean });
    pushSystem(joinedRoom, giver ? `💝 ${giver} gives ${target.name}: ${clean}` : `🎁 The DM gives ${target.name}: ${clean}`);
  });
  // DM taps "AI loot" → the AI invents a themed item and it lands on a player's sheet.
  socket.on('loot:ai', async ({ to, theme } = {}) => {
    const room = rooms.get(joinedRoom); if (!room || !isGm(room, socket.id)) return;
    const target = Object.values(room.players).find((p) => p.name.toLowerCase() === String(to || '').trim().toLowerCase());
    if (!target) { io.to(socket.id).emit('chat', { id: 'm_' + rid(), author: 'System', role: 'system', text: `No player named "${to}" at the table.`, ts: Date.now() }); return; }
    const th = theme && String(theme).trim() ? `themed around: ${String(theme).trim().slice(0, 60)}` : 'suitable for a fantasy adventurer';
    io.to(joinedRoom).emit('dm:thinking', true);
    const reply = await callOpenAIDM([{ role: 'user', content:
      `Invent ONE balanced, fun D&D treasure or magic item ${th}. Respond in exactly this format:\nITEM: <short item name, at most 6 words>\n<one vivid sentence describing it and what it does>` }]);
    io.to(joinedRoom).emit('dm:thinking', false);
    if (/^⚠️/.test(reply)) { io.to(socket.id).emit('chat', { id: 'm_' + rid(), author: 'System', role: 'system', text: reply, ts: Date.now() }); return; }
    const m = reply.match(/ITEM:\s*(.+)/i);
    const name = String(m ? m[1] : reply.split('\n')[0]).replace(/[*_`#]/g, '').trim().slice(0, 60) || 'Mysterious Trinket';
    const desc = reply.replace(/ITEM:\s*.+\n?/i, '').replace(/[*_`#]/g, '').trim().slice(0, 240);
    io.to(target.id).emit('item:give', { item: name });
    pushSystem(joinedRoom, `✨ The DM bestows upon ${target.name}: ${name}${desc ? ' — ' + desc : ''}`);
  });
  // DM stocks a monster/token with AI-generated loot (players loot it once it drops).
  socket.on('loot:aiToken', async ({ id, theme } = {}) => {
    const room = rooms.get(joinedRoom); if (!room || !isGm(room, socket.id)) return;
    const tok = room.tokens[id]; if (!tok) return;
    const th = theme && String(theme).trim() ? `carried by a ${String(theme).trim().slice(0, 40)}` : 'for a defeated foe';
    io.to(joinedRoom).emit('dm:thinking', true);
    const reply = await callOpenAIDM([{ role: 'user', content:
      `List 2 to 4 pieces of D&D loot ${th}. Reply with ONLY a comma-separated list (for example: 14 gp, Rusty Shortsword, Potion of Healing). No sentences, no extra words.` }]);
    io.to(joinedRoom).emit('dm:thinking', false);
    if (/^⚠️/.test(reply)) { io.to(socket.id).emit('chat', { id: 'm_' + rid(), author: 'System', role: 'system', text: reply, ts: Date.now() }); return; }
    const items = String(reply).replace(/^[^0-9a-z]*/i, '').split(/[,\n]/).map((s) => s.replace(/[*_`#]/g, '').trim()).filter(Boolean).slice(0, 8);
    tok.chest = items;
    emitTokenPerSocket(room, 'token:update', tok);
    markDirty();
    io.to(socket.id).emit('chat', { id: 'm_' + rid(), author: 'System', role: 'system', text: `💰 ${tok.label || 'It'} now carries: ${items.join(', ')} (players can loot it once it's downed).`, ts: Date.now() });
  });
  // GM XP award: every character at the table gains XP.
  socket.on('xp:award', (data) => {
    const room = rooms.get(joinedRoom); if (!room || !isGm(room, socket.id)) return;
    const amt = Math.max(1, Math.min(500000, parseInt(data && data.amount, 10) || 0));
    if (!(amt > 0)) return;
    pushSystem(joinedRoom, `⭐ The DM awards ${amt} XP to each party member!`);
    io.to(joinedRoom).emit('xp:award', { amount: amt });
  });

  // Private whisper: player → GM(s), or GM → a named player. Not persisted to room history.
  socket.on('chat:whisper', ({ to, text }) => {
    const room = rooms.get(joinedRoom); if (!room || !text || !text.trim()) return;
    const from = room.players[socket.id]; if (!from) return;
    const sysTo = (t) => io.to(socket.id).emit('chat', { id: 'm_' + rid(), author: 'System', role: 'system', text: t, ts: Date.now() });
    const targets = [];
    let label;
    if (from.isGm && to && to.trim()) {
      const tName = to.trim().toLowerCase();
      for (const [sid, pl] of Object.entries(room.players)) if ((pl.name || '').toLowerCase() === tName) targets.push(sid);
      if (!targets.length) { sysTo(`No player named "${to.trim()}" is at the table.`); return; }
      label = `→ ${to.trim()}`;
    } else {
      for (const [sid, pl] of Object.entries(room.players)) if (pl.isGm) targets.push(sid);
      if (!targets.length) { sysTo('No GM is at the table to whisper to.'); return; }
      label = '→ GM';
    }
    const msg = { id: 'm_' + rid(), author: from.name || 'Someone', role: 'whisper', whisperTo: label, text: text.trim(), ts: Date.now() };
    const set = new Set(targets); set.add(socket.id);
    set.forEach((sid) => io.to(sid).emit('chat', msg));
  });
  socket.on('dm:ask', async ({ text }) => {
    const room = rooms.get(joinedRoom); if (!room) return;
    const p = room.players[socket.id];
    if (text && text.trim()) {
      const userMsg = { id: 'm_' + rid(), author: p?.name || 'Someone', role: 'player', text, ts: Date.now() };
      room.chat.push(userMsg); io.to(joinedRoom).emit('chat', userMsg);
    }
    io.to(joinedRoom).emit('dm:thinking', true);
    const reply = await callOpenAIDM(buildDMContext(room));
    const dmMsg = { id: 'm_' + rid(), author: 'Dungeon Master', role: 'dm', text: reply, ts: Date.now() };
    room.chat.push(dmMsg);
    io.to(joinedRoom).emit('dm:thinking', false);
    io.to(joinedRoom).emit('chat', dmMsg);
  });

  // DM taps "Recap" → the AI writes a short "Previously on…" from the recent transcript.
  socket.on('dm:recap', async () => {
    const room = rooms.get(joinedRoom); if (!room || !isGm(room, socket.id)) return;
    const transcript = (room.chat || []).slice(-60)
      .filter((m) => m.role === 'player' || m.role === 'dm')
      .map((m) => `${m.role === 'dm' ? 'DM' : (m.author || 'Player')}: ${m.text}`)
      .join('\n').slice(-4000);
    if (!transcript.trim()) { pushSystem(joinedRoom, 'No story yet to recap — play a little first!'); return; }
    io.to(joinedRoom).emit('dm:thinking', true);
    const reply = await callOpenAIDM([{ role: 'user', content:
      'Write a short, dramatic "Previously on…" recap (3-5 sentences) of the adventure so far, based only on this session transcript. Speak as the narrator, past tense, capture the key events, choices, and cliffhangers.\n\nTRANSCRIPT:\n' + transcript }]);
    const dmMsg = { id: 'm_' + rid(), author: 'Dungeon Master', role: 'dm', text: '📖 Previously… ' + reply, ts: Date.now() };
    room.chat.push(dmMsg);
    io.to(joinedRoom).emit('dm:thinking', false);
    io.to(joinedRoom).emit('chat', dmMsg);
  });

  // DM improvises on the fly — the AI invents an NPC or describes a location.
  socket.on('dm:improv', async ({ kind } = {}) => {
    const room = rooms.get(joinedRoom); if (!room || !isGm(room, socket.id)) return;
    const prompts = {
      npc: 'Invent a memorable D&D NPC the party just met. Give: a name, race, a vivid one-line appearance, their demeanor, a secret they hide, and one line of dialogue in quotes. Keep it to 3-4 sentences. Start with the name in bold-ish plain text.',
      place: 'Vividly describe the location the party has just entered — sights, sounds, smells, and one intriguing detail worth investigating. 3-4 sentences, present tense, second person ("you see…").',
      hook: 'Give the party a fresh adventure hook right now: a rumor, a stranger’s plea, or a strange event, with a clear reason to act. 2-3 sentences.',
    };
    const p = prompts[kind] || prompts.npc;
    const tag = kind === 'place' ? '🏰 ' : kind === 'hook' ? '🎣 ' : '🎭 ';
    io.to(joinedRoom).emit('dm:thinking', true);
    const reply = await callOpenAIDM([{ role: 'user', content: p }]);
    const dmMsg = { id: 'm_' + rid(), author: 'Dungeon Master', role: 'dm', text: tag + reply, ts: Date.now() };
    room.chat.push(dmMsg);
    io.to(joinedRoom).emit('dm:thinking', false);
    io.to(joinedRoom).emit('chat', dmMsg);
  });

  // ---- WebRTC voice signaling ----
  socket.on('rtc:signal', ({ to, data }) => { io.to(to).emit('rtc:signal', { from: socket.id, data }); });

  socket.on('disconnect', () => {
    if (!joinedRoom) return;
    const room = rooms.get(joinedRoom);
    if (room && room.players[socket.id]) {
      const name = room.players[socket.id].name;
      delete room.players[socket.id];
      delete room.partyStatus[socket.id];
      delete room.sheets[socket.id];
      for (const [oid, t] of pendingTrades) if (t.fromId === socket.id || t.toId === socket.id) pendingTrades.delete(oid);
      socket.to(joinedRoom).emit('peer-left', { peerId: socket.id });
      broadcastPlayers(joinedRoom);
      broadcastParty(joinedRoom);
      sendSheetsToGms(joinedRoom);
      pushSystem(joinedRoom, `${name} left the table.`);
    }
  });
});

loadRooms();
httpServer.listen(PORT, () => {
  console.log(`\n  ⚔️  D&D VTT running:  http://localhost:${PORT}`);
  console.log(`  AI DM: ${(OPENAI_API_KEY || LOCAL_AI) ? 'enabled (' + OPENAI_MODEL + (LOCAL_AI ? ' @ ' + OPENAI_BASE_URL + ' — local, free' : '') + ')' : 'STUB MODE — add OPENAI_API_KEY or OPENAI_BASE_URL'}\n`);
});
