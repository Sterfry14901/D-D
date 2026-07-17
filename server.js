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

const PORT = process.env.PORT || 3000;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
// Point this at any OpenAI-compatible endpoint — e.g. a local Ollama / LM Studio
// server for a free, never-runs-out AI DM:  OPENAI_BASE_URL=http://localhost:11434/v1
const OPENAI_BASE_URL = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
const LOCAL_AI = !/api\.openai\.com/.test(OPENAI_BASE_URL);

// ---- In-memory game state. One "room" = one campaign table. ----
const rooms = new Map();

// ---- Persistence: auto-save rooms to disk so campaigns survive restarts. ----
const DATA_FILE = join(__dirname, 'rooms-data.json');
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
  // A local OpenAI-compatible server (Ollama/LM Studio) needs no key.
  if (!OPENAI_API_KEY && !LOCAL_AI) {
    return "⚠️ No OPENAI_API_KEY set on the server, so I'm running as a stub DM. Add your key (or point OPENAI_BASE_URL at a local model) and restart. (For now: the tavern door creaks open, and adventure awaits...)";
  }
  const payload = {
    model: OPENAI_MODEL,
    messages: [{ role: 'system', content: DM_SYSTEM_PROMPT }, ...messages],
    temperature: 0.9,
    max_tokens: 500,
  };
  // Retry up to 3 times on transient 429/5xx with exponential backoff.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(OPENAI_BASE_URL + '/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(OPENAI_API_KEY ? { Authorization: `Bearer ${OPENAI_API_KEY}` } : {}) },
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

  // ---- WebRTC voice signaling ----
  socket.on('rtc:signal', ({ to, data }) => { io.to(to).emit('rtc:signal', { from: socket.id, data }); });

  socket.on('disconnect', () => {
    if (!joinedRoom) return;
    const room = rooms.get(joinedRoom);
    if (room && room.players[socket.id]) {
      const name = room.players[socket.id].name;
      delete room.players[socket.id];
      delete room.partyStatus[socket.id];
      socket.to(joinedRoom).emit('peer-left', { peerId: socket.id });
      broadcastPlayers(joinedRoom);
      broadcastParty(joinedRoom);
      pushSystem(joinedRoom, `${name} left the table.`);
    }
  });
});

loadRooms();
httpServer.listen(PORT, () => {
  console.log(`\n  ⚔️  D&D VTT running:  http://localhost:${PORT}`);
  console.log(`  AI DM: ${(OPENAI_API_KEY || LOCAL_AI) ? 'enabled (' + OPENAI_MODEL + (LOCAL_AI ? ' @ ' + OPENAI_BASE_URL + ' — local, free' : '') + ')' : 'STUB MODE — add OPENAI_API_KEY or OPENAI_BASE_URL'}\n`);
});
