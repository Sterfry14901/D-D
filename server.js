// D&D VTT — realtime server
// Express serves the client; Socket.io handles rooms, state sync,
// the AI Dungeon Master (OpenAI proxy), and WebRTC voice signaling.

import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, { maxHttpBufferSize: 5e6 }); // 5MB for map images

app.use(express.static(__dirname));
app.get('/health', (_req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3000;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

// ---- In-memory game state. One "room" = one campaign table. ----
// For a hobby game this is fine; swap for a DB later if you want persistence.
const rooms = new Map();

function getRoom(id) {
  if (!rooms.has(id)) {
    rooms.set(id, {
      tokens: {},          // id -> {id,x,y,color,label,size,ownerId,img}
      chat: [],            // {id,author,role,text,ts}  role: player|dm|system|roll
      mapImage: null,      // dataURL background, or null for plain grid
      gridSize: 70,        // px per cell
      players: {},         // socketId -> {name, color}
    });
  }
  return rooms.get(id);
}

function broadcastPlayers(roomId) {
  const room = rooms.get(roomId);
  if (room) io.to(roomId).emit('players', Object.values(room.players));
}

// ---- AI Dungeon Master ----
const DM_SYSTEM_PROMPT = `You are a masterful Dungeon Master running a Dungeons & Dragons 5th Edition game.
Narrate vividly but concisely (2-5 sentences unless a big set-piece). Describe scenes, voice NPCs,
and react to player actions and dice rolls. When players attempt risky actions, ask for a specific
ability check or saving throw (e.g. "Make a DC 14 Dexterity save"). Keep the story moving, offer
real choices, and never decide a player's actions for them. Stay in character as the narrator/world.`;

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
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify(payload),
    });
    if (!r.ok) {
      const err = await r.text();
      console.error('OpenAI error:', err);
      return `⚠️ The DM stumbled (OpenAI API error ${r.status}). Check your API key/billing.`;
    }
    const data = await r.json();
    return data.choices?.[0]?.message?.content?.trim() || '...(the DM ponders silently)';
  } catch (e) {
    console.error('OpenAI fetch failed:', e);
    return '⚠️ Could not reach the AI DM service.';
  }
}

// Build a compact running transcript for the model from recent chat.
function buildDMContext(room) {
  const recent = room.chat.slice(-20);
  return recent
    .filter((m) => m.role === 'player' || m.role === 'dm' || m.role === 'roll')
    .map((m) => {
      if (m.role === 'dm') return { role: 'assistant', content: m.text };
      const who = m.role === 'roll' ? 'DICE' : m.author;
      return { role: 'user', content: `${who}: ${m.text}` };
    });
}

io.on('connection', (socket) => {
  let joinedRoom = null;

  socket.on('join', ({ roomId, name, color }) => {
    joinedRoom = roomId || 'default';
    socket.join(joinedRoom);
    const room = getRoom(joinedRoom);
    room.players[socket.id] = { id: socket.id, name: name || 'Adventurer', color: color || '#c0392b' };

    // Send full current state to the new player.
    socket.emit('state', {
      tokens: room.tokens,
      chat: room.chat.slice(-100),
      mapImage: room.mapImage,
      gridSize: room.gridSize,
      youId: socket.id,
    });
    broadcastPlayers(joinedRoom);

    // Tell existing peers a new voice peer arrived (for WebRTC mesh).
    socket.to(joinedRoom).emit('peer-joined', { peerId: socket.id, name: room.players[socket.id].name });

    pushSystem(joinedRoom, `${room.players[socket.id].name} joined the table.`);
  });

  // ---- Token movement / creation / deletion ----
  socket.on('token:add', (token) => {
    const room = rooms.get(joinedRoom);
    if (!room) return;
    token.id = token.id || 't_' + Math.random().toString(36).slice(2, 9);
    token.ownerId = socket.id;
    room.tokens[token.id] = token;
    io.to(joinedRoom).emit('token:add', token);
  });

  socket.on('token:move', ({ id, x, y }) => {
    const room = rooms.get(joinedRoom);
    if (!room || !room.tokens[id]) return;
    room.tokens[id].x = x;
    room.tokens[id].y = y;
    socket.to(joinedRoom).emit('token:move', { id, x, y });
  });

  socket.on('token:update', (token) => {
    const room = rooms.get(joinedRoom);
    if (!room || !room.tokens[token.id]) return;
    room.tokens[token.id] = { ...room.tokens[token.id], ...token };
    io.to(joinedRoom).emit('token:update', room.tokens[token.id]);
  });

  socket.on('token:remove', (id) => {
    const room = rooms.get(joinedRoom);
    if (!room) return;
    delete room.tokens[id];
    io.to(joinedRoom).emit('token:remove', id);
  });

  // ---- Map background ----
  socket.on('map:set', (dataUrl) => {
    const room = rooms.get(joinedRoom);
    if (!room) return;
    room.mapImage = dataUrl;
    io.to(joinedRoom).emit('map:set', dataUrl);
  });

  socket.on('grid:set', (size) => {
    const room = rooms.get(joinedRoom);
    if (!room) return;
    room.gridSize = size;
    io.to(joinedRoom).emit('grid:set', size);
  });

  // ---- Chat (player text) ----
  socket.on('chat', ({ text }) => {
    const room = rooms.get(joinedRoom);
    if (!room) return;
    const player = room.players[socket.id];
    const msg = {
      id: 'm_' + Math.random().toString(36).slice(2, 9),
      author: player?.name || 'Someone',
      role: 'player',
      text,
      ts: Date.now(),
    };
    room.chat.push(msg);
    io.to(joinedRoom).emit('chat', msg);
  });

  // ---- Dice rolls (shared) ----
  socket.on('roll', ({ formula, result, detail }) => {
    const room = rooms.get(joinedRoom);
    if (!room) return;
    const player = room.players[socket.id];
    const msg = {
      id: 'm_' + Math.random().toString(36).slice(2, 9),
      author: player?.name || 'Someone',
      role: 'roll',
      text: `rolled ${formula} → ${result}  (${detail})`,
      ts: Date.now(),
    };
    room.chat.push(msg);
    io.to(joinedRoom).emit('chat', msg);
  });

  // ---- Ask the AI Dungeon Master ----
  socket.on('dm:ask', async ({ text }) => {
    const room = rooms.get(joinedRoom);
    if (!room) return;
    const player = room.players[socket.id];

    if (text && text.trim()) {
      const userMsg = {
        id: 'm_' + Math.random().toString(36).slice(2, 9),
        author: player?.name || 'Someone',
        role: 'player',
        text,
        ts: Date.now(),
      };
      room.chat.push(userMsg);
      io.to(joinedRoom).emit('chat', userMsg);
    }

    io.to(joinedRoom).emit('dm:thinking', true);
    const reply = await callOpenAIDM(buildDMContext(room));
    const dmMsg = {
      id: 'm_' + Math.random().toString(36).slice(2, 9),
      author: 'Dungeon Master',
      role: 'dm',
      text: reply,
      ts: Date.now(),
    };
    room.chat.push(dmMsg);
    io.to(joinedRoom).emit('dm:thinking', false);
    io.to(joinedRoom).emit('chat', dmMsg);
  });

  // ---- WebRTC voice signaling (mesh: each peer connects to each other) ----
  socket.on('rtc:signal', ({ to, data }) => {
    io.to(to).emit('rtc:signal', { from: socket.id, data });
  });

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

function pushSystem(roomId, text) {
  const room = rooms.get(roomId);
  if (!room) return;
  const msg = {
    id: 'm_' + Math.random().toString(36).slice(2, 9),
    author: 'System',
    role: 'system',
    text,
    ts: Date.now(),
  };
  room.chat.push(msg);
  io.to(roomId).emit('chat', msg);
}

httpServer.listen(PORT, () => {
  console.log(`\n  ⚔️  D&D VTT running:  http://localhost:${PORT}`);
  console.log(`  AI DM: ${OPENAI_API_KEY ? 'enabled (' + OPENAI_MODEL + ')' : 'STUB MODE — add OPENAI_API_KEY to .env'}\n`);
});
