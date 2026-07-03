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
      fog: { active: false, hidden: {} }, // hidden: { "cx,cy": true }
      walls: {},               // "cx,cy": true — sight-blocking wall cells
      lighting: false,         // dynamic line-of-sight active
      aoes: [],                // area-of-effect templates [{id,type,x,y,x2,y2,size,color}]
    });
  }
  return rooms.get(id);
}

function broadcastPlayers(roomId) {
  const room = rooms.get(roomId);
  if (room) io.to(roomId).emit('players', Object.values(room.players));
}
function isGm(room, socketId) { return !!room.players[socketId]?.isGm; }
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
  if (!OPENAI_API_KEY) {
    return "⚠️ No OPENAI_API_KEY set on the server, so I'm running as a stub DM. Add your key to the .env file and restart to bring me to life. (For now: the tavern door creaks open, and adventure awaits...)";
  }
  const payload = {
    model: OPENAI_MODEL,
    messages: [{ role: 'system', content: DM_SYSTEM_PROMPT }, ...messages],
    temperature: 0.9,
    max_tokens: 500,
  };
  try {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_API_KEY}` },
      body: JSON.stringify(payload),
    });
    if (!r.ok) {
      console.error('OpenAI error:', await r.text());
      return `⚠️ The DM stumbled (OpenAI API error ${r.status}). Check your API key/billing.`;
    }
    const data = await r.json();
    return data.choices?.[0]?.message?.content?.trim() || '...(the DM ponders silently)';
  } catch (e) {
    console.error('OpenAI fetch failed:', e);
    return '⚠️ Could not reach the AI DM service.';
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
      tokens: room.tokens,
      chat: room.chat.slice(-100),
      mapImage: room.mapImage,
      gridSize: room.gridSize,
      initiative: room.initiative,
      turnIndex: room.turnIndex,
      fog: room.fog,
      walls: room.walls,
      lighting: room.lighting,
      aoes: room.aoes,
      youId: socket.id,
      isGm: gm,
      gmClaimed: !!room.gmPassword,
    });
    broadcastPlayers(joinedRoom);
    socket.to(joinedRoom).emit('peer-joined', { peerId: socket.id, name: room.players[socket.id].name });
    pushSystem(joinedRoom, `${room.players[socket.id].name} joined the table${gm ? ' as GM' : ''}.`);
  });

  // ---- Tokens ----
  socket.on('token:add', (token) => {
    const room = rooms.get(joinedRoom); if (!room) return;
    token.id = token.id || 't_' + rid();
    token.ownerId = socket.id;
    room.tokens[token.id] = token;
    io.to(joinedRoom).emit('token:add', token);
  });
  socket.on('token:move', ({ id, x, y }) => {
    const room = rooms.get(joinedRoom); if (!room || !room.tokens[id]) return;
    room.tokens[id].x = x; room.tokens[id].y = y;
    socket.to(joinedRoom).emit('token:move', { id, x, y });
  });
  socket.on('token:update', (token) => {
    const room = rooms.get(joinedRoom); if (!room || !room.tokens[token.id]) return;
    room.tokens[token.id] = { ...room.tokens[token.id], ...token };
    io.to(joinedRoom).emit('token:update', room.tokens[token.id]);
  });
  socket.on('token:remove', (id) => {
    const room = rooms.get(joinedRoom); if (!room) return;
    delete room.tokens[id];
    io.to(joinedRoom).emit('token:remove', id);
  });

  // ---- Map / grid ----
  socket.on('map:set', (dataUrl) => {
    const room = rooms.get(joinedRoom); if (!room) return;
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
    io.to(joinedRoom).emit('init:state', { list: room.initiative, turnIndex: room.turnIndex });
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
    room.turnIndex = 0;
    emitInit();
  });
  socket.on('init:turn', (dir) => {
    const room = rooms.get(joinedRoom); if (!room || room.initiative.length === 0) return;
    room.turnIndex = (room.turnIndex + (dir === 'prev' ? -1 : 1) + room.initiative.length) % room.initiative.length;
    emitInit();
  });
  socket.on('init:clear', () => {
    const room = rooms.get(joinedRoom); if (!room) return;
    room.initiative = []; room.turnIndex = 0; emitInit();
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

  // ---- Save / Load campaign ----
  socket.on('campaign:get', () => {
    const room = rooms.get(joinedRoom); if (!room) return;
    socket.emit('campaign:data', {
      tokens: room.tokens, mapImage: room.mapImage, gridSize: room.gridSize,
      initiative: room.initiative, turnIndex: room.turnIndex, fog: room.fog,
      walls: room.walls, lighting: room.lighting, aoes: room.aoes,
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
    // push full fresh state to everyone
    for (const sid of Object.keys(room.players)) {
      io.to(sid).emit('state', {
        tokens: room.tokens, chat: room.chat.slice(-100), mapImage: room.mapImage,
        gridSize: room.gridSize, initiative: room.initiative, turnIndex: room.turnIndex,
        fog: room.fog, walls: room.walls, lighting: room.lighting, aoes: room.aoes,
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
      socket.to(joinedRoom).emit('peer-left', { peerId: socket.id });
      broadcastPlayers(joinedRoom);
      pushSystem(joinedRoom, `${name} left the table.`);
    }
  });
});

loadRooms();
httpServer.listen(PORT, () => {
  console.log(`\n  ⚔️  D&D VTT running:  http://localhost:${PORT}`);
  console.log(`  AI DM: ${OPENAI_API_KEY ? 'enabled (' + OPENAI_MODEL + ')' : 'STUB MODE — add OPENAI_API_KEY to .env'}\n`);
});
