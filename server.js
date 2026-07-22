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

// ---- The world: cities with location-bound vendors, linked by travel routes. ----
// Vendors start empty; the DM AI-stocks them (themed by vendor type). The party has a
// current location (party.at); you can only trade with vendors in the city you're in.
let _vid = 0;
function mkVendor(name, type) { return { id: 'v' + (++_vid), name, type, items: [], open: true }; }
function buildStarterWorld() {
  return {
    party: { at: 'havenbrook', transport: { horse: false, wagon: false, boat: false } },
    vote: null,   // {to, mode, byName, yes:[socketIds], no:[socketIds]}
    clock: { day: 1, hour: 8 },   // in-world time; travel advances it
    encounterChance: 35,          // % chance of a random encounter per journey
    cities: {
      havenbrook: {
        id: 'havenbrook', name: 'Havenbrook', kind: 'town',
        desc: 'A walled farming town of timber and thatch, ringed by barley fields. A safe first step for new adventurers.',
        vendors: [mkVendor("Brannoc's Goods", 'general'), mkVendor('The Iron Hearth', 'blacksmith')],
        links: [{ to: 'portcael', modes: { walk: 12, horse: 5, wagon: 7 } }, { to: 'ironhold', modes: { walk: 16, horse: 7 } }],
      },
      portcael: {
        id: 'portcael', name: 'Port Cael', kind: 'city',
        desc: 'A salt-worn harbor city where tall ships crowd the docks and every third face is a smuggler. Boats leave for the mountain river-road.',
        vendors: [mkVendor('Dockside Sundries', 'general'), mkVendor("Merryweather's Wagon", 'wagon'), mkVendor('The Bilge Rat', 'fence')],
        links: [{ to: 'havenbrook', modes: { walk: 12, horse: 5, wagon: 7 } }, { to: 'ironhold', modes: { boat: 8, walk: 20 } }],
      },
      ironhold: {
        id: 'ironhold', name: 'Ironhold', kind: 'city',
        desc: 'A dwarven mountain hold of black stone and forge-fire, famed for arms and the arcane vaults cut deep beneath it.',
        vendors: [mkVendor('Deepdelve Arms', 'blacksmith'), mkVendor('The Arcane Vault', 'magic')],
        links: [{ to: 'havenbrook', modes: { walk: 16, horse: 7 } }, { to: 'portcael', modes: { boat: 8, walk: 20 } }],
      },
    },
  };
}
const MODE_LABEL = { walk: '🥾 on foot', horse: '🐴 on horseback', wagon: '🛒 by wagon', boat: '⛵ by boat' };
// Mode-specific travel encounter tables — 25 each (100 total). The DM can pick from a
// list or anyone can roll a d20 against the table for how the party is travelling.
const ENCOUNTERS = {
  walk: [
    'masked highwaymen step from the treeline, demanding a toll of 10 gp a head.',
    'cutpurses trail the party into a narrow defile, hands drifting toward hidden knives.',
    'a lone hooded figure at a crossroads offers a "map to buried coin"… for a price.',
    'a gaunt, hungry wolf pack paces the party at the wood\'s edge.',
    'an overturned merchant\'s cart blocks the path — genuine misfortune, or bait for an ambush?',
    'a troll squats beneath a rope bridge, collecting a grisly "crossing fee."',
    'bandits have felled a tree across the road and wait behind it with crossbows.',
    'a wandering peddler hawks dubious potions and very real gossip.',
    'a press-gang of army deserters sizes the party up as easy marks.',
    'a rockslide blocks the pass — and the stones were moved on purpose.',
    'a column of refugees warns of raiders burning villages on the road ahead.',
    'a giant spider\'s web strung between the trees glints with old, picked-clean bones.',
    'a pilgrim begs an escort to the next shrine, promising a blessing in return.',
    'a goblin toll-booth (three goblins, one very official-looking hat) demands "the road tax."',
    'a wounded knight slumps against a milestone, whispering of an ambush just ahead.',
    'strange standing stones hum faintly; a Religion check reveals an old warding circle.',
    'a hunter\'s snare-line crosses the trail; something large is already thrashing in one.',
    'a talking raven lands on a branch and offers a riddle for a shiny coin.',
    'a mud-slick ford runs high and fast — Strength (Athletics) to cross without losing gear.',
    'a hedge-witch offers a night\'s shelter and a warm meal… with unsettling curiosity.',
    'a will-o\'-wisp bobs off the path, promising treasure deeper in the marsh.',
    'brigands demand the party\'s boots and cloaks "for the toll of the low road."',
    'a merchant guard mistakes the party for the thieves who robbed him yesterday.',
    'a swarm of stirges bursts from a hollow log at dusk.',
    'an old signpost has been turned to point every road the wrong way.',
  ],
  horse: [
    'a rival band of riders challenges the party to a race for a purse of gold.',
    'one mount pulls up lame — a stone in the shoe, or something worse in the tendon.',
    'a mounted patrol of the local lord halts the party for questioning and papers.',
    'horse-thieves try to cut the picket line in the night and scatter the mounts.',
    'a low branch and a spooked horse — DEX save or be thrown from the saddle.',
    'a fallen tree spans the road; a running jump (Animal Handling) or the long way around.',
    'a courier gallops past, then wheels back — she carries urgent, dangerous news.',
    'wolves give chase across open ground, testing the horses\' nerve and speed.',
    'a broken fence spills livestock across the road in a bawling, dust-choked mess.',
    'a toll-knight bars a stone bridge, refusing passage to any who won\'t joust him.',
    'the mounts shy hard at a smell of blood carried on the wind.',
    'a bog to one side; ride the firm verge (Nature check) or risk miring a horse.',
    'a hooded rider paces the party for a mile, then peels off toward a hidden camp.',
    'a farrier\'s wagon offers to re-shoe the horses — cheap, but the nails look brittle.',
    'a stampede of wild horses thunders across the plain; a chance to rope a fine one.',
    'raiders on light steeds harry the flanks, loosing arrows and wheeling away.',
    'a river crossing: swim the horses (Athletics) or seek a ford hours upstream.',
    'a saddle-girth frays at the worst moment on a steep, shale-strewn descent.',
    'a noble\'s hunt crosses the road, hounds baying, and demands the party yield the way.',
    'a lone foal follows the party, and its protective dam is not far behind.',
    'a dust cloud on the horizon resolves into an approaching cavalry company.',
    'a snake in the grass spooks the lead horse into a full bolt.',
    'a mounted herald proclaims a bounty — and the description sounds oddly like a party member.',
    'thin ice over a frozen stream cracks under a hoof.',
    'a windmill\'s turning sails panic the horses as the party passes too close.',
  ],
  wagon: [
    'a wagon wheel shatters in a rut — a Tinker\'s tools or Strength repair, or a long delay.',
    'the axle groans under the load; shed weight or risk it snapping on the next hill.',
    'a caravan of other merchants offers to travel together for safety — and to talk trade.',
    'a mudhole swallows a wheel to the hub; everyone out to push (group Athletics).',
    'a toll-keeper inspects the cargo far too closely, hinting a bribe would speed things.',
    'a stowaway is found curled among the crates — a runaway, a spy, or a thief.',
    'bandits roll a burning hay-cart across the road to force the wagon to stop.',
    'a bridge\'s timbers look rotten; test the weight or ford the shallow stream beside it.',
    'a peddler flags the wagon down to barter for a lift and pays in rumor.',
    'the draft horses balk at a narrow cliff-road with a long drop on one side.',
    'a wheel-rut reveals old coins spilled by some earlier, unluckier traveler.',
    'a checkpoint of the local militia searches for smuggled goods, crate by crate.',
    'the tarp tears in a gust and cargo scatters down the muddy slope.',
    'a family whose own wagon broke down begs to load their belongings aboard.',
    'a lame ox blocks a mountain switchback, its owner refusing to move without help.',
    'raiders demand "cargo tax" — half the load, or a fight over the reins.',
    'a rockfall half-buries the road; dig out a path or unload and carry the goods across.',
    'a friendly caravan-master warns the bridge ahead has been claimed by a river hag.',
    'the brake fails on a long downgrade and the wagon begins to run away.',
    'a swarm of flies signals a rotting carcass — and the predators feeding on it.',
    'a wandering tinker offers to grease the axles and mend the harness for a coin.',
    'a fork in the road: the fast route is rumored haunted, the safe route adds a day.',
    'a fallen highwayman\'s body lies in the road — and his coin purse is suspiciously full.',
    'a herd crossing forces an hour\'s halt while drovers curse and whistle.',
    'a wheel throws a spoke just as thunder promises a road-drowning storm.',
  ],
  boat: [
    'a black-sailed pirate cutter closes fast off the port bow.',
    'a squall rolls in — all hands and Strength checks at the rigging.',
    'the water goes glassy and still; something vast passes slow beneath the hull.',
    'smugglers signal from a hidden cove, offering illicit cargo at a fence\'s price.',
    'a merfolk envoy surfaces, wary and curious, bearing news of the depths.',
    'a derelict ship drifts abeam, sails in tatters, decks silent and swept clean.',
    'a sea serpent\'s coils break the surface a bowshot away.',
    'the ship is becalmed for hours; tempers — and fresh water — run thin.',
    'a reef looms in the fog; a hard Wisdom (Survival) check to thread the gap.',
    'ghostly lanterns bob on the water, luring the ship toward the rocks.',
    'a whale breaches close enough to swamp the deck with its wake.',
    'a rival trader signals a challenge to race to the next port for cargo rights.',
    'a man clings to floating wreckage, hailing the ship in a language none aboard know.',
    'a waterspout stalks across the party\'s course, dark and roaring.',
    'sahuagin raiders scale the hull in the dead of the night watch.',
    'a fog bank swallows the ship; navigate by stars (if any show) or drift blind.',
    'a pod of dolphins escorts the ship — sailors call it luck; the captain looks nervous.',
    'a floating shrine bobs past; leaving an offering is said to calm the sea.',
    'the current drags the ship toward a maelstrom on the horizon.',
    'a customs cutter demands to board and inspect the hold for contraband.',
    'a giant squid\'s tentacle curls over the gunwale, groping for a sailor.',
    'an island appears that is not on any chart, its beach strewn with old crates.',
    'the ship springs a leak below the waterline; bail and patch (group check) or sink lower.',
    'a becalmed rival ship signals for aid — or is it a lure for an ambush?',
    'a storm of flying fish and worse comes aboard on a freak green wave.',
  ],
};
function encTable(mode) { return ENCOUNTERS[mode] || ENCOUNTERS.walk; }
function rollEncounter(mode) { const t = encTable(mode); return t[Math.floor(Math.random() * t.length)]; }
const VTYPE_LABEL = { general: '🏪 General store', blacksmith: '⚒️ Blacksmith', wagon: '🛒 Wagon merchant', fence: '🗡️ Fence (black market)', magic: '✨ Arcane vault', tavern: '🍺 Tavern', alchemist: '⚗️ Alchemist' };

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
        round: room.round || 1,
        shop: room.shop || { open: false, name: 'Market', items: [] },
        world: room.world || null,       // #179: the DM's built world survives restarts
        trial: room.trial || null,       // #180: trial days used survive restarts
        partyCode: room.partyCode || null, // #193: party invite code survives restarts
        npcs: (room.npcs || []).slice(-100), // #196: NPC memory survives restarts
        scenes: (room.scenes || []).slice(0, 20), // #214: prepped scenes survive restarts
        notebook: room.notebook || {},   // #218: private player notebooks survive restarts
        opts: room.opts || { maneuvers: false }, // #220: optional rules survive restarts
        session: room.session || { when: '', note: '' }, // #222: next session survives restarts
      };
    }
    fs.writeFileSync(DATA_FILE, JSON.stringify(out));
  } catch (e) { console.error('saveRooms failed:', e.message); }
}

// ---- #200 ElevenLabs TTS proxy — cinematic AI DM voices ----
// Key lives ONLY in the ELEVENLABS_API_KEY env var; the browser never sees it.
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY || '';
const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || 'JBFqnCBsd6RMkjVDRZzb'; // "George" — warm British narrator
app.get('/api/tts-status', (req, res) => res.json({ ok: !!ELEVENLABS_API_KEY }));
app.post('/api/tts', express.json({ limit: '8kb' }), async (req, res) => {
  try {
    if (!ELEVENLABS_API_KEY) return res.status(503).json({ error: 'no-key' });
    const text = String((req.body && req.body.text) || '').slice(0, 600);
    if (!text.trim()) return res.status(400).json({ error: 'empty' });
    const vid = /^[A-Za-z0-9]{10,40}$/.test(String((req.body && req.body.voice) || '')) ? req.body.voice : ELEVENLABS_VOICE_ID;
    const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${vid}?output_format=mp3_22050_32`, {
      method: 'POST',
      headers: { 'xi-api-key': ELEVENLABS_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, model_id: 'eleven_turbo_v2_5', voice_settings: { stability: 0.5, similarity_boost: 0.75 } }),
    });
    if (!r.ok) { const t = await r.text().catch(() => ''); return res.status(502).json({ error: 'elevenlabs ' + r.status, detail: t.slice(0, 140) }); }
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'no-store');
    res.send(Buffer.from(await r.arrayBuffer()));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---- #195 Discord integrations: webhooks for bugs / status / patch notes ----
const DISCORD_BUG_WEBHOOK = process.env.DISCORD_BUG_WEBHOOK || '';
const DISCORD_STATUS_WEBHOOK = process.env.DISCORD_STATUS_WEBHOOK || '';
const DISCORD_PATCH_WEBHOOK = process.env.DISCORD_PATCH_WEBHOOK || '';
async function postDiscord(url, payload) {
  if (!url) return false;
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    return res.ok;
  } catch (e) { console.error('Discord webhook failed:', e.message); return false; }
}
// On boot: tell the Discord we're back online, and post the patch note once per note.
setTimeout(async () => {
  await postDiscord(DISCORD_STATUS_WEBHOOK, { content: '🟢 **Realms of Fate** updated and back online — https://d-d-cfqn.onrender.com' });
  const note = (process.env.DEPLOY_NOTE || '').trim();
  if (note && DISCORD_PATCH_WEBHOOK) {
    try {
      const nf = DATA_FILE + '.note';
      const last = fs.existsSync(nf) ? fs.readFileSync(nf, 'utf8') : '';
      if (note !== last) {
        await postDiscord(DISCORD_PATCH_WEBHOOK, { content: '📜 **Patch notes** — ' + note.slice(0, 1800) });
        fs.writeFileSync(nf, note);
      }
    } catch (e) { /* non-fatal */ }
  }
}, 6000);

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
        shop: room.shop || { open: false, name: 'Market', items: [] },
        world: room.world || buildStarterWorld(),   // #179: restore the built world
        trial: room.trial || null,                  // #180: restore trial usage
        partyCode: room.partyCode || null,          // #193: restore party invite code
        npcs: room.npcs || [],                      // #196: restore NPC memory
        scenes: room.scenes || [],                  // #214: restore prepped scenes
        notebook: room.notebook || {},              // #218: restore player notebooks
        opts: room.opts || { maneuvers: false },    // #220: restore optional rules
        session: room.session || { when: '', note: '' }, // #222: restore next session
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
      shop: { open: false, name: 'Market', items: [] },  // DM shop: players buy items with coins
      world: buildStarterWorld(),  // travelable world: cities, vendors, routes
      npcs: [],                // #196 NPC memory: [{id,name,desc,notes,ts}] — AI DM stays consistent
      scenes: [],              // #214 Scene Prep: up to 20 prepped {map + monster tokens + weather}
      notebook: {},            // #218 Player Notebook: playerName -> [{id,ts,text,img}] (private)
      opts: { maneuvers: false }, // #220 optional rules the DM can switch on
      session: { when: '', note: '' }, // #222 next-session banner (DM sets, all see)
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
// ---- Quest engine helpers ----
function sanitizeQuest(it) {
  if (!it) return null;
  const q = {
    id: String(it.id || ('q_' + rid())).slice(0, 40),
    title: String(it.title || '').slice(0, 300),
    kind: it.kind === 'side' ? 'side' : 'main',
    done: !!it.done,
  };
  if (it.giver) q.giver = String(it.giver).slice(0, 60);
  if (Array.isArray(it.objectives)) {
    q.objectives = it.objectives.slice(0, 6).map((o) => ({
      text: String((o && o.text) || '').slice(0, 200),
      type: ['visit', 'kill', 'custom'].includes(o && o.type) ? o.type : 'custom',
      target: o && o.target ? String(o.target).slice(0, 60) : undefined,
      count: o && o.count ? Math.max(1, Math.min(99, Math.floor(Number(o.count)) || 1)) : undefined,
      progress: o && o.progress ? Math.max(0, Math.floor(Number(o.progress)) || 0) : 0,
      done: !!(o && o.done),
    })).filter((o) => o.text);
  }
  if (it.rewards) {
    q.rewards = {
      xp: Math.max(0, Math.floor(Number(it.rewards.xp) || 0)),
      gp: Math.max(0, Math.floor(Number(it.rewards.gp) || 0)),
      items: Array.isArray(it.rewards.items) ? it.rewards.items.slice(0, 6).map((s) => String(s).slice(0, 60)).filter(Boolean) : [],
    };
  }
  return q;
}
function questAnnounceIfReady(roomId, quest) {
  if (!quest.objectives || !quest.objectives.length) return;
  if (quest.objectives.every((o) => o.done)) pushSystem(roomId, `📜 All objectives complete for "${quest.title}" — ready to turn in!`);
}
// Auto-complete "visit" objectives when the party arrives somewhere.
function questCheckVisit(roomId, cityId) {
  const room = rooms.get(roomId); if (!room || !room.quests || !room.quests.list) return;
  let changed = false;
  for (const quest of room.quests.list) {
    if (quest.done || !quest.objectives) continue;
    for (const o of quest.objectives) {
      if (o.done || o.type !== 'visit' || !o.target) continue;
      if (String(o.target).toLowerCase() === String(cityId).toLowerCase()) {
        o.done = true; changed = true;
        pushSystem(roomId, `📜 Objective complete: ${o.text} ("${quest.title}")`);
        questAnnounceIfReady(roomId, quest);
      }
    }
  }
  if (changed) { io.to(roomId).emit('quest:update', room.quests); markDirty(); }
}
// Advance "kill" objectives when a matching creature drops to 0 HP.
function questCheckKill(roomId, tokenName) {
  const room = rooms.get(roomId); if (!room || !room.quests || !room.quests.list || !tokenName) return;
  const nm = String(tokenName).toLowerCase();
  let changed = false;
  for (const quest of room.quests.list) {
    if (quest.done || !quest.objectives) continue;
    for (const o of quest.objectives) {
      if (o.done || o.type !== 'kill' || !o.target) continue;
      if (nm.includes(String(o.target).toLowerCase())) {
        o.progress = (o.progress || 0) + 1; changed = true;
        const need = o.count || 1;
        if (o.progress >= need) {
          o.done = true;
          pushSystem(roomId, `📜 Objective complete: ${o.text} ("${quest.title}")`);
          questAnnounceIfReady(roomId, quest);
        } else {
          pushSystem(roomId, `📜 ${o.text} — ${o.progress}/${need} ("${quest.title}")`);
        }
      }
    }
  }
  if (changed) { io.to(roomId).emit('quest:update', room.quests); markDirty(); }
}
function broadcastShop(roomId) {
  const room = rooms.get(roomId); if (!room) return;
  if (!room.shop) room.shop = { open: false, name: 'Market', items: [] };
  io.to(roomId).emit('shop:state', room.shop);
}
function broadcastWorld(roomId) {
  const room = rooms.get(roomId); if (!room) return;
  if (!room.world) room.world = buildStarterWorld();
  io.to(roomId).emit('world:state', room.world);
}
function findVendor(world, cityId, vendorId) {
  const c = world && world.cities && world.cities[cityId]; if (!c) return null;
  return (c.vendors || []).find((v) => v.id === vendorId) || null;
}
// Fastest route between two cities using only the travel modes the party can use
// (foot is always allowed; horse/wagon/boat require ownership). Dijkstra on hours.
function findRoute(world, from, to, ownedModes) {
  if (!world || !world.cities[from] || !world.cities[to]) return null;
  const allow = (m) => m === 'walk' || (ownedModes && ownedModes[m]);
  const dist = { [from]: 0 }; const prev = {}; const seen = {};
  while (true) {
    let u = null, best = Infinity;
    for (const k of Object.keys(dist)) if (!seen[k] && dist[k] < best) { best = dist[k]; u = k; }
    if (u == null) break;
    if (u === to) break;
    seen[u] = true;
    for (const link of (world.cities[u].links || [])) {
      let cheapest = Infinity, cheapMode = null;
      for (const m of Object.keys(link.modes || {})) if (allow(m) && link.modes[m] < cheapest) { cheapest = link.modes[m]; cheapMode = m; }
      if (cheapMode == null) continue;
      const nd = dist[u] + cheapest;
      if (nd < (dist[link.to] == null ? Infinity : dist[link.to])) { dist[link.to] = nd; prev[link.to] = { from: u, mode: cheapMode, hours: cheapest }; }
    }
  }
  if (dist[to] == null) return null;
  const legs = []; let cur = to;
  while (cur !== from) { const p = prev[cur]; if (!p) return null; legs.unshift({ from: p.from, to: cur, mode: p.mode, hours: p.hours }); cur = p.from; }
  return { hours: dist[to], legs };
}
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
  // #196 NPC memory — remind the DM who the party already knows so it stays consistent.
  const npcs = (room.npcs || []).slice(-12);
  if (npcs.length) {
    const lines = npcs.map((n) => `- ${n.name}: ${(n.desc || '').replace(/\s+/g, ' ').slice(0, 160)}${n.notes ? ' | Notes: ' + String(n.notes).slice(0, 100) : ''}`);
    msgs.unshift({ role: 'user', content: 'NPCS THE PARTY ALREADY KNOWS (stay consistent with these people — same names, personalities, secrets; reference them when it fits):\n' + lines.join('\n') });
  }
  return msgs;
}
// #196 helpers
function broadcastNpcs(roomId) {
  const room = rooms.get(roomId);
  if (room) io.to(roomId).emit('npc:state', room.npcs || []);
}
function rememberNpc(room, roomId, name, desc, notes) {
  room.npcs = room.npcs || [];
  const nm = String(name || '').trim().slice(0, 60);
  if (!nm) return null;
  const existing = room.npcs.find((n) => n.name.toLowerCase() === nm.toLowerCase());
  if (existing) {
    if (desc) existing.desc = String(desc).slice(0, 500);
    if (notes !== undefined) existing.notes = String(notes || '').slice(0, 300);
    existing.ts = Date.now();
  } else {
    room.npcs.push({ id: 'n_' + rid(), name: nm, desc: String(desc || '').slice(0, 500), notes: String(notes || '').slice(0, 300), ts: Date.now() });
    if (room.npcs.length > 100) room.npcs.shift();
  }
  markDirty(); broadcastNpcs(roomId);
  return existing || room.npcs[room.npcs.length - 1];
}

function pushSystem(roomId, text) {
  const room = rooms.get(roomId);
  if (!room) return;
  const msg = { id: 'm_' + rid(), author: 'System', role: 'system', text, ts: Date.now() };
  room.chat.push(msg);
  io.to(roomId).emit('chat', msg);
}

/* ============ #178 DM Pro licensing — DMs pay, players always free ============
   Modes (env DM_PRO_MODE): 'off' (default; anyone can GM) or 'required'
   (taking the GM role needs a valid license). Keys are verified against:
     1. DM_LICENSE_KEYS  — comma-separated always-valid keys (owner/comps)
     2. Gumroad          — GUMROAD_PRODUCT_ID via the public license-verify API
   Results are cached 24h so Gumroad hiccups never lock out a working DM.
   The server never stores payment data; players are never gated on anything. */
const DM_PRO_MODE = (process.env.DM_PRO_MODE || 'off').trim().toLowerCase();
const DM_PRO_URL = (process.env.DM_PRO_URL || '').trim();
const DM_LICENSE_KEYS = new Set(String(process.env.DM_LICENSE_KEYS || '')
  .split(',').map((s) => s.trim()).filter(Boolean));
const GUMROAD_PRODUCT_ID = (process.env.GUMROAD_PRODUCT_ID || '').trim();
const licenseCache = new Map();               // key -> { ok, plan, at }
const LICENSE_TTL = 24 * 60 * 60 * 1000;

async function verifyLicense(rawKey) {
  const key = String(rawKey || '').trim();
  if (!key || key.length > 200) return { ok: false, reason: 'empty' };
  if (DM_LICENSE_KEYS.has(key)) return { ok: true, plan: 'owner' };
  const cached = licenseCache.get(key);
  if (cached && Date.now() - cached.at < LICENSE_TTL) return cached;
  if (!GUMROAD_PRODUCT_ID) return { ok: false, reason: 'no-store' };
  try {
    const r = await fetch('https://api.gumroad.com/v2/licenses/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        product_id: GUMROAD_PRODUCT_ID, license_key: key, increment_uses_count: 'false',
      }),
    });
    const d = await r.json().catch(() => ({}));
    const p = d && d.purchase;
    const bad = !d || d.success !== true || !p || p.refunded || p.chargebacked ||
      p.subscription_ended_at || p.subscription_failed_at;
    const res = bad
      ? { ok: false, reason: 'invalid', at: Date.now() }
      : { ok: true, plan: p.recurrence ? 'subscription' : 'lifetime', at: Date.now() };
    licenseCache.set(key, res);
    return res;
  } catch {
    if (cached) return cached;                // Gumroad down: trust last known state
    return { ok: false, reason: 'network' };
  }
}
const gmNeedsLicense = () => DM_PRO_MODE === 'required';

/* #186 Instant demo — rooms named demo_* come pre-loaded with a small adventure
   so first-time visitors see a living table in one click instead of an empty grid. */
function seedDemoRoom(roomId, room) {
  if (room._demoSeeded || Object.keys(room.tokens).length) return;
  room._demoSeeded = true;
  const g = room.gridSize || 70;
  room.tokens = {
    demo_hero:  { id: 'demo_hero', x: g * 2, y: g * 3, label: 'Aria', name: 'Aria the Ranger', color: '#2e7d32', emoji: '🏹', hp: 24, maxhp: 24, ac: 15, size: 1, statuses: [] },
    demo_gob1:  { id: 'demo_gob1', x: g * 6, y: g * 2, label: 'Goblin', name: 'Goblin', color: '#7a2318', emoji: '👺', hp: 7, maxhp: 7, ac: 15, size: 1, statuses: [], atk: [{ name: 'Scimitar', bonus: 4, dmg: '1d6+2' }], chest: ['12 gp', 'Rusty scimitar'] },
    demo_gob2:  { id: 'demo_gob2', x: g * 7, y: g * 4, label: 'Goblin', name: 'Goblin', color: '#7a2318', emoji: '👺', hp: 7, maxhp: 7, ac: 15, size: 1, statuses: [], atk: [{ name: 'Scimitar', bonus: 4, dmg: '1d6+2' }] },
    demo_wolf:  { id: 'demo_wolf', x: g * 5, y: g * 5, label: 'Wolf', name: 'Wolf', color: '#4a4a55', emoji: '🐺', hp: 11, maxhp: 11, ac: 13, size: 1, statuses: [], atk: [{ name: 'Bite', bonus: 4, dmg: '2d4+2' }] },
  };
  room.quests = room.quests || { main: '', sides: [] };
  room.quests.list = [sanitizeQuest({
    title: 'Clear the Old Road', kind: 'main', giver: 'Reeve Aldric of Havenbrook',
    objectives: [
      { text: 'Drive off the goblin ambushers', type: 'kill', target: 'Goblin', count: 2 },
      { text: 'Report back to the Reeve', type: 'custom' },
    ],
    rewards: { xp: 150, gp: 25, items: ['Potion of Healing'] },
  })];
  room.shop = { open: true, name: 'The Gilded Griffin', items: [
    { id: 'ds1', name: 'Potion of Healing', price: 50, stock: 3, weight: 0.5 },
    { id: 'ds2', name: 'Rope (50 ft)', price: 1, stock: 5, weight: 10 },
    { id: 'ds3', name: 'Torch', price: 1, stock: 10, weight: 1 },
    { id: 'ds4', name: 'Longsword', price: 15, stock: 2, weight: 3 },
    { id: 'ds5', name: 'Shield', price: 10, stock: 2, weight: 6 },
  ] };
  room.notes = 'WELCOME TO THE DEMO!\n\nYou are the Dungeon Master. Try these:\n• Right-click a Goblin → ⚔️ Attack → target Aria (the server rolls everything)\n• Open the 📜 Quest board — dropping both goblins completes the objective automatically\n• Open the 🌍 World tab — click a city on the map to travel; encounters can happen on the road\n• Open the 🏪 shop — players buy with their own gold\n\nHave fun — everything here is yours to break.';
  room.chat.push({ id: 'm_demo1', author: 'System', role: 'system', text: '🎲 Welcome, Dungeon Master! Two goblins and a wolf ambush the road ahead. Check the 📓 notes for a 60-second tour.', ts: Date.now() });
}

/* #180 Free trial: an unlicensed DM may run each room for DM_PRO_TRIAL distinct
   calendar days (default 3) before the paywall. Tied to the room so restarting
   the trial means abandoning the campaign — honest friction, no accounts needed. */
const DM_PRO_TRIAL = Math.max(0, Math.min(30, Number(process.env.DM_PRO_TRIAL ?? 3) || 0));
function trialCheck(room) {                 // -> { allowed, left, used }
  if (!DM_PRO_TRIAL) return { allowed: false, left: 0, used: 0 };
  room.trial = room.trial || { days: [] };
  const today = new Date().toISOString().slice(0, 10);
  if (!room.trial.days.includes(today)) {
    if (room.trial.days.length >= DM_PRO_TRIAL) return { allowed: false, left: 0, used: room.trial.days.length };
    room.trial.days.push(today);
    markDirty();
  }
  return { allowed: true, left: DM_PRO_TRIAL - room.trial.days.length, used: room.trial.days.length };
}

io.on('connection', (socket) => {
  let joinedRoom = null;

  socket.on('join', async ({ roomId, name, color, gmPassword, license }) => {
    // #193 Party code: a player typed an RF-XXXXX code into the GM password box →
    // teleport them into the game that owns that code (as a player, never as GM).
    const codeTry = (gmPassword || '').trim().toUpperCase();
    if (/^RF-[A-Z0-9]{5}$/.test(codeTry)) {
      let target = null;
      for (const [rid, r] of rooms) { if (r && r.partyCode === codeTry) { target = rid; break; } }
      if (target) { roomId = target; gmPassword = ''; }
    }
    joinedRoom = roomId || 'default';
    socket.join(joinedRoom);
    const room = getRoom(joinedRoom);
    if (joinedRoom.startsWith('demo_')) seedDemoRoom(joinedRoom, room);   // #186 instant demo

    // GM role resolution via password (+ DM Pro license when required)
    let gm = false;
    const pw = (gmPassword || '').trim();
    if (pw && (!room.gmPassword || room.gmPassword === pw)) {
      let allowed = true;
      if (gmNeedsLicense()) {
        const lic = await verifyLicense(license);
        allowed = lic.ok;
        socket.data = socket.data || {};
        if (allowed) socket.data.license = String(license || '').trim();
        else {
          const tr = trialCheck(room);                        // #180 free trial
          if (tr.allowed) {
            allowed = true;
            socket.emit('license:trial', { used: tr.used, total: DM_PRO_TRIAL, left: tr.left, url: DM_PRO_URL });
          } else {
            socket.data.pendingGmPw = pw;
            socket.emit('license:required', { url: DM_PRO_URL, reason: DM_PRO_TRIAL ? 'trial-over' : 'required' });
          }
        }
      }
      if (allowed) { if (!room.gmPassword) room.gmPassword = pw; gm = true; }
    }
    room.players[socket.id] = { id: socket.id, name: name || 'Adventurer', color: color || '#c0392b', isGm: gm };

    socket.emit('scene:list', sceneMeta(room));   // #214 prepped scenes arrive with the join
    socket.emit('note:list', (room.notebook || {})[room.players[socket.id].name] || []); // #218 your private notebook
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
      opts: room.opts || {},          // #220 optional rules (martial maneuvers, …)
      session: room.session || { when: '', note: '' }, // #222 next-session banner
      notes: room.notes || '',
      quests: room.quests || { main: '', sides: [] },
      drawings: room.drawings || [],
      shop: room.shop || { open: false, name: 'Market', items: [] },
      world: room.world || buildStarterWorld(),
      youId: socket.id,
      isGm: gm,
      gmClaimed: !!room.gmPassword,
      licenseMode: DM_PRO_MODE,
      proUrl: DM_PRO_URL,
      roomId: joinedRoom,               // #193: real room (party codes can redirect)
      partyCode: gm ? (room.partyCode || null) : null,
      npcs: room.npcs || [],            // #196: NPC memory
    });
    broadcastPlayers(joinedRoom);
    broadcastParty(joinedRoom);
    if (gm) io.to(socket.id).emit('sheets:update', Object.values(room.sheets || {}));  // DM sees everyone's sheets on join
    socket.to(joinedRoom).emit('peer-joined', { peerId: socket.id, name: room.players[socket.id].name });
    pushSystem(joinedRoom, `${room.players[socket.id].name} joined the table${gm ? ' as GM' : ''}.`);
  });

  // ---- #193 Party code: GM mints a shareable code for this game ----
  socket.on('invite:make', (ack) => {
    const done = (r) => { if (typeof ack === 'function') ack(r); };
    if (!joinedRoom) return done({ ok: false, error: 'not in a room' });
    const room = getRoom(joinedRoom);
    const p = room.players[socket.id];
    if (!p || !p.isGm) return done({ ok: false, error: 'GM only' });
    if (!room.partyCode) {
      const A = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O/1/I/L lookalikes
      room.partyCode = 'RF-' + Array.from({ length: 5 }, () => A[Math.floor(Math.random() * A.length)]).join('');
      markDirty();
    }
    done({ ok: true, code: room.partyCode, room: joinedRoom });
  });

  // ---- #195 In-game bug reports → Discord #bug-reports ----
  socket.on('bug:report', async ({ text }, ack) => {
    const done = (r) => { if (typeof ack === 'function') ack(r); };
    const t = String(text || '').trim().slice(0, 900);
    if (!t) return done({ ok: false, error: 'empty' });
    socket.data = socket.data || {};
    const now = Date.now();
    if (socket.data.lastBug && now - socket.data.lastBug < 60000) return done({ ok: false, error: 'Slow down — one report per minute.' });
    socket.data.lastBug = now;
    const room = joinedRoom && rooms.get(joinedRoom);
    const who = room && room.players[socket.id] ? room.players[socket.id].name : 'Anonymous';
    if (!DISCORD_BUG_WEBHOOK) return done({ ok: false, error: 'no-webhook' });
    const ok = await postDiscord(DISCORD_BUG_WEBHOOK, {
      embeds: [{
        title: '🐛 In-game bug report', color: 0xe74c3c, description: t,
        fields: [
          { name: 'Player', value: String(who).slice(0, 60), inline: true },
          { name: 'Room', value: String(joinedRoom || '—').slice(0, 60), inline: true },
        ],
        timestamp: new Date().toISOString(),
      }],
    });
    done(ok ? { ok: true } : { ok: false, error: 'no-webhook' });
  });

  // ---- #196 NPC memory: DM curates the cast, the AI stays consistent ----
  socket.on('npc:add', ({ name, desc, notes } = {}, ack) => {
    const done = (r) => { if (typeof ack === 'function') ack(r); };
    const room = rooms.get(joinedRoom);
    if (!room || !isGm(room, socket.id)) return done({ ok: false, error: 'GM only' });
    const n = rememberNpc(room, joinedRoom, name, desc, notes);
    done(n ? { ok: true, id: n.id } : { ok: false, error: 'name required' });
  });
  socket.on('npc:update', ({ id, name, desc, notes } = {}, ack) => {
    const done = (r) => { if (typeof ack === 'function') ack(r); };
    const room = rooms.get(joinedRoom);
    if (!room || !isGm(room, socket.id)) return done({ ok: false, error: 'GM only' });
    const n = (room.npcs || []).find((x) => x.id === id);
    if (!n) return done({ ok: false, error: 'not found' });
    if (name) n.name = String(name).trim().slice(0, 60);
    if (desc !== undefined) n.desc = String(desc || '').slice(0, 500);
    if (notes !== undefined) n.notes = String(notes || '').slice(0, 300);
    n.ts = Date.now();
    markDirty(); broadcastNpcs(joinedRoom);
    done({ ok: true });
  });
  socket.on('npc:del', ({ id } = {}, ack) => {
    const done = (r) => { if (typeof ack === 'function') ack(r); };
    const room = rooms.get(joinedRoom);
    if (!room || !isGm(room, socket.id)) return done({ ok: false, error: 'GM only' });
    const before = (room.npcs || []).length;
    room.npcs = (room.npcs || []).filter((x) => x.id !== id);
    markDirty(); broadcastNpcs(joinedRoom);
    done({ ok: room.npcs.length < before });
  });

  // ---- #185 Custom world map image + city pin positions ----
  // Works with any map tool (Azgaar, Worldographer, hextml, bought map packs):
  // the DM exports a PNG/JPG, uploads it here, and pins the cities on it.
  socket.on('world:mapImage', ({ img } = {}) => {
    const room = rooms.get(joinedRoom); if (!room || !isGm(room, socket.id) || !room.world) return;
    if (img === null || img === '') { room.world.mapImage = null; }
    else if (typeof img === 'string' && /^data:image\/(png|jpe?g|webp);base64,/.test(img) && img.length < 3000000) {
      room.world.mapImage = img;
    } else return;
    broadcastWorld(joinedRoom);
    markDirty();
    pushSystem(joinedRoom, room.world.mapImage ? '🗺️ The DM unfurled a new map of the realm.' : '🗺️ The DM returned to the old parchment map.');
  });
  socket.on('world:cityPos', ({ id, x, y } = {}) => {
    const room = rooms.get(joinedRoom); if (!room || !isGm(room, socket.id) || !room.world) return;
    const c = room.world.cities[id]; if (!c) return;
    c.x = Math.max(2, Math.min(98, Number(x) || 0));
    c.y = Math.max(4, Math.min(72, Number(y) || 0));
    broadcastWorld(joinedRoom);
    markDirty();
  });

  // ---- #181 Combat assistant: server-resolved attacks ----
  // combat:attack { attackerId, targetId, bonus, dmg, adv } -> rolls to-hit vs the
  // target's AC, applies damage on a hit (temp HP first), announces everything,
  // and feeds the same downed/quest hooks as a manual HP change. Server-rolled,
  // so nobody can fudge the dice.
  socket.on('combat:attack', ({ attackerId, targetId, bonus, dmg, adv } = {}) => {
    const room = rooms.get(joinedRoom); if (!room) return;
    const atk = room.tokens[attackerId], tgt = room.tokens[targetId];
    if (!atk || !tgt || attackerId === targetId) return;
    if (!canControlToken(room, socket.id, atk)) return;          // you may only swing your own tokens
    const b = Math.max(-5, Math.min(20, Number(bonus) || 0));
    const mode = adv === 'adv' ? 'adv' : adv === 'dis' ? 'dis' : 'normal';
    const d20 = () => 1 + Math.floor(Math.random() * 20);
    const r1 = d20(), r2 = d20();
    const nat = mode === 'adv' ? Math.max(r1, r2) : mode === 'dis' ? Math.min(r1, r2) : r1;
    const rollTxt = mode === 'normal' ? `d20(${nat})` : `d20(${r1},${r2} ${mode === 'adv' ? 'adv' : 'dis'}→${nat})`;
    const total = nat + b;
    const acKnown = Number(tgt.ac) > 0;
    const ac = acKnown ? Number(tgt.ac) : 10;
    const aName = atk.label || atk.name || 'Attacker';
    const tName = tgt.label || tgt.name || 'Target';
    const crit = nat === 20, fumble = nat === 1;
    const hit = !fumble && (crit || total >= ac);
    const acTxt = `AC ${ac}${acKnown ? '' : ' (assumed)'}`;
    if (!hit) {
      pushSystem(joinedRoom, `⚔️ ${aName} attacks ${tName}: ${rollTxt}${b ? (b > 0 ? '+' + b : b) : ''} = ${total} vs ${acTxt} — ${fumble ? 'NAT 1, MISS!' : 'miss.'}`);
      return;
    }
    // Parse damage like "2d6+3", "1d8", "d6+1", or a flat "5". Crits double the dice.
    const spec = String(dmg || '').trim().toLowerCase().replace(/\s+/g, '');
    let dmgTotal = 0, dmgTxt = spec || '0';
    const m = spec.match(/^(\d*)d(\d+)([+-]\d+)?$/);
    if (m) {
      let n = Math.max(1, Math.min(20, Number(m[1]) || 1));
      const sides = Math.max(2, Math.min(100, Number(m[2])));
      const flat = Number(m[3]) || 0;
      if (crit) n *= 2;
      const rolls = Array.from({ length: n }, () => 1 + Math.floor(Math.random() * sides));
      dmgTotal = rolls.reduce((a, x) => a + x, 0) + flat;
      dmgTxt = `${n}d${sides}${flat ? (flat > 0 ? '+' + flat : flat) : ''} [${rolls.join(',')}]`;
    } else {
      dmgTotal = Math.max(0, Math.min(999, Math.floor(Number(spec)) || 0));
      if (crit) dmgTotal *= 2;
      dmgTxt = String(dmgTotal);
    }
    // Apply: temp HP soaks first, then real HP (never below 0).
    const prevHp = Number(tgt.hp) || 0;
    const temp = Number(tgt.temphp) || 0;
    const absorbed = Math.min(temp, dmgTotal);
    tgt.temphp = temp - absorbed;
    tgt.hp = Math.max(0, prevHp - (dmgTotal - absorbed));
    emitTokenPerSocket(room, 'token:update', tgt);
    markDirty();
    const hpTxt = (Number(tgt.maxhp) || 0) > 0 ? ` ${tName}: ${tgt.hp}/${tgt.maxhp} HP${tgt.hp <= 0 ? ' — DOWN!' : ''}` : '';
    pushSystem(joinedRoom, `⚔️ ${aName} attacks ${tName}: ${rollTxt}${b ? (b > 0 ? '+' + b : b) : ''} = ${total} vs ${acTxt} — ${crit ? '💥 CRIT!' : 'HIT!'} ${dmgTotal} damage (${dmgTxt}).${absorbed ? ` (${absorbed} soaked by temp HP.)` : ''}${hpTxt}`);
    if (prevHp > 0 && tgt.hp <= 0 && (Number(tgt.maxhp) || 0) > 0) {
      questCheckKill(joinedRoom, tgt.name || tgt.label);          // kill objectives advance
    }
  });

  // ---- #190 Heal / direct damage with server announcements ----
  socket.on('combat:heal', ({ targetId, amount, kind } = {}) => {
    const room = rooms.get(joinedRoom); if (!room) return;
    const tgt = room.tokens[targetId]; if (!tgt) return;
    if (!canControlToken(room, socket.id, tgt)) return;
    const amt = Math.max(1, Math.min(999, Math.floor(Number(amount) || 0)));
    const who = room.players[socket.id]?.name || 'Someone';
    const nm = tgt.label || tgt.name || 'token';
    const prevHp = Number(tgt.hp) || 0;
    const mx = Number(tgt.maxhp) || 0;
    if (kind === 'heal') {
      tgt.hp = mx > 0 ? Math.min(mx, prevHp + amt) : prevHp + amt;
      pushSystem(joinedRoom, `💚 ${who} heals ${nm} for ${amt}. ${nm}: ${tgt.hp}${mx > 0 ? '/' + mx : ''} HP.`);
    } else {
      const temp = Number(tgt.temphp) || 0;
      const absorbed = Math.min(temp, amt);
      tgt.temphp = temp - absorbed;
      tgt.hp = Math.max(0, prevHp - (amt - absorbed));
      pushSystem(joinedRoom, `💥 ${who} deals ${amt} damage to ${nm}.${absorbed ? ` (${absorbed} soaked by temp HP.)` : ''} ${nm}: ${tgt.hp}${mx > 0 ? '/' + mx : ''} HP${tgt.hp <= 0 && mx > 0 ? ' — DOWN!' : ''}`);
      if (prevHp > 0 && tgt.hp <= 0 && mx > 0) questCheckKill(joinedRoom, tgt.name || tgt.label);
    }
    emitTokenPerSocket(room, 'token:update', tgt);
    markDirty();
  });

  // ---- #178 DM Pro license ----
  socket.on('license:activate', async ({ key } = {}) => {
    socket.data = socket.data || {};
    socket.data.licTries = (socket.data.licTries || 0) + 1;
    if (socket.data.licTries > 12) { socket.emit('license:status', { ok: false, reason: 'too-many' }); return; }
    const lic = await verifyLicense(key);
    if (!lic.ok) { socket.emit('license:status', { ok: false, reason: lic.reason || 'invalid' }); return; }
    socket.data.license = String(key || '').trim();
    socket.emit('license:status', { ok: true, plan: lic.plan || 'pro' });
    // Blocked at join but knew the room's GM password? Promote them now.
    const room = joinedRoom && rooms.get(joinedRoom);
    const pend = socket.data.pendingGmPw;
    if (room && pend && (!room.gmPassword || room.gmPassword === pend) && room.players[socket.id]) {
      if (!room.gmPassword) room.gmPassword = pend;
      room.players[socket.id].isGm = true;
      delete socket.data.pendingGmPw;
      socket.emit('license:promoted', {});
      broadcastPlayers(joinedRoom);
      io.to(socket.id).emit('sheets:update', Object.values(room.sheets || {}));
      pushSystem(joinedRoom, `${room.players[socket.id].name} is now the GM (DM Pro).`);
    }
  });
  socket.on('license:check', async ({ key } = {}) => {
    const lic = await verifyLicense(key);
    socket.emit('license:status', { ok: !!lic.ok, plan: lic.plan || null, reason: lic.ok ? null : (lic.reason || 'invalid') });
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
    const prevHp = Number(room.tokens[token.id].hp) || 0;
    const { owner, ownerId, ...safe } = token;   // players can't reassign ownership
    room.tokens[token.id] = { ...room.tokens[token.id], ...safe };
    emitTokenPerSocket(room, 'token:update', room.tokens[token.id]);
    markDirty();
    // quest hook: creature just dropped → advance matching kill objectives
    const t = room.tokens[token.id];
    if (prevHp > 0 && (Number(t.hp) || 0) <= 0 && (Number(t.maxhp) || 0) > 0) {
      questCheckKill(joinedRoom, t.name || t.label);
    }
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

  // ---- #214 Scene Prep — DM saves up to 20 prepped scenes (map + monsters + weather), reveals in one click ----
  function gmNamesOf(room) { return new Set(Object.values(room.players || {}).filter((p) => p.isGm).map((p) => p.name)); }
  function sceneMeta(room) { return (room.scenes || []).map((s) => ({ id: s.id, name: s.name, n: (s.tokens || []).length, hasMap: !!s.map, ts: s.ts })); }
  socket.on('scene:list', () => {
    const room = rooms.get(joinedRoom); if (!room) return;
    socket.emit('scene:list', sceneMeta(room));
  });
  socket.on('scene:save', ({ name } = {}) => {
    const room = rooms.get(joinedRoom); if (!room || !isGm(room, socket.id)) return;
    room.scenes = room.scenes || [];
    if (room.scenes.length >= 20) {
      socket.emit('chat', { id: 'm_' + rid(), author: 'System', role: 'dm', text: '⚠️ Scene shelf is full (20 max) — delete one first.', ts: Date.now() });
      return;
    }
    const gms = gmNamesOf(room);
    // Snapshot the scenery: everything NOT owned by a real player (monsters, props, hidden ambushers).
    const tokens = Object.values(room.tokens).filter((t) => !t.owner || gms.has(t.owner)).map((t) => JSON.parse(JSON.stringify(t)));
    room.scenes.push({ id: 's_' + rid(), name: String(name || 'Scene').slice(0, 40), map: room.mapImage || null, weather: room.weather || null, tokens, ts: Date.now() });
    markDirty();
    io.to(joinedRoom).emit('scene:list', sceneMeta(room));
  });
  socket.on('scene:load', ({ id } = {}) => {
    const room = rooms.get(joinedRoom); if (!room || !isGm(room, socket.id)) return;
    const sc = (room.scenes || []).find((s) => s.id === id); if (!sc) return;
    const gms = gmNamesOf(room);
    // Clear current scenery — player-owned tokens stay right where they are.
    for (const tid of Object.keys(room.tokens)) {
      const t = room.tokens[tid];
      if (!t.owner || gms.has(t.owner)) { delete room.tokens[tid]; io.to(joinedRoom).emit('token:remove', tid); }
    }
    room.mapImage = sc.map || null;
    io.to(joinedRoom).emit('map:set', room.mapImage);
    if (sc.weather) { room.weather = sc.weather; io.to(joinedRoom).emit('weather:set', room.weather); }
    for (const t of (sc.tokens || [])) {
      const nt = JSON.parse(JSON.stringify(t));
      nt.id = 't_' + rid(); nt.ownerId = socket.id; nt.owner = room.players[socket.id]?.name || null;
      room.tokens[nt.id] = nt;
      emitTokenPerSocket(room, 'token:add', nt);      // hidden ambush monsters stay hidden from players
    }
    const msg = { id: 'm_' + rid(), author: 'System', role: 'dm', text: `🎬 Scene change: ${sc.name}`, ts: Date.now() };
    room.chat.push(msg); io.to(joinedRoom).emit('chat', msg);
    markDirty();
  });
  socket.on('scene:del', ({ id } = {}) => {
    const room = rooms.get(joinedRoom); if (!room || !isGm(room, socket.id)) return;
    room.scenes = (room.scenes || []).filter((s) => s.id !== id);
    markDirty();
    io.to(joinedRoom).emit('scene:list', sceneMeta(room));
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
    const prev = room.partyStatus[socket.id];
    const nm = String(st.name || 'Adventurer').slice(0, 24);
    const hp = Number(st.hp) || 0, maxhp = Number(st.maxhp) || 0;
    room.partyStatus[socket.id] = {
      name: nm, hp, maxhp, ac: Number(st.ac) || 0,
      level: Math.max(1, Math.min(20, Number(st.level) || 1)),
    };
    // Alert the DM when a player drops to 0 HP or gets back up (only on the transition).
    if (prev && maxhp > 0) {
      const wasUp = prev.hp > 0, isUp = hp > 0;
      if (wasUp && !isUp) {
        for (const sid of Object.keys(room.players)) if (room.players[sid]?.isGm) io.to(sid).emit('chat', { id: 'm_' + rid(), author: 'System', role: 'system', text: `⚠️ ${nm} is DOWN at 0 HP — death saves needed!`, ts: Date.now() });
      } else if (!wasUp && isUp) {
        for (const sid of Object.keys(room.players)) if (room.players[sid]?.isGm) io.to(sid).emit('chat', { id: 'm_' + rid(), author: 'System', role: 'system', text: `💚 ${nm} is back up (${hp}/${maxhp} HP).`, ts: Date.now() });
      }
    }
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
    const toName = to ? to.name : 'someone';
    if (accept) {
      if (t.kind === 'coin') {
        if (fromStillHere) io.to(t.fromId).emit('trade:coinTake', { coin: t.coin, amt: t.amt, toName });
        io.to(socket.id).emit('trade:coinGive', { coin: t.coin, amt: t.amt, fromName: t.fromName });
        pushSystem(joinedRoom, `🤝 ${t.fromName} gave ${t.amt} ${t.coin} to ${toName}.`);
      } else {
        if (fromStillHere) io.to(t.fromId).emit('trade:take', { item: t.item, toName });
        io.to(socket.id).emit('trade:give', { item: t.item, fromName: t.fromName });
        pushSystem(joinedRoom, `🤝 ${t.fromName} traded ${t.item.name} to ${toName}.`);
      }
    } else if (fromStillHere) {
      const label = t.kind === 'coin' ? `${t.amt} ${t.coin}` : (t.item ? t.item.name : 'the trade');
      io.to(t.fromId).emit('trade:declined', { toName: to ? to.name : 'They', item: { name: label } });
    }
  });

  // ---- Coin trading (same accept flow, different payload) ----
  socket.on('trade:coinOffer', ({ toId, coin, amt } = {}) => {
    const room = rooms.get(joinedRoom); if (!room) return;
    const from = room.players[socket.id]; if (!from) return;
    const to = room.players[toId]; if (!to || toId === socket.id) return;
    const COINS = ['cp', 'sp', 'ep', 'gp', 'pp'];
    if (!COINS.includes(coin)) return;
    const n = Math.floor(Number(amt) || 0); if (n < 1 || n > 1e7) return;
    let mine = 0; for (const t of pendingTrades.values()) if (t.fromId === socket.id) mine++;
    if (mine > 12) { io.to(socket.id).emit('chat', { system: true, text: '⚠️ Too many pending trade offers. Wait for some to resolve.', ts: Date.now() }); return; }
    const offerId = 'tc_' + Math.random().toString(36).slice(2, 10);
    pendingTrades.set(offerId, { roomId: joinedRoom, fromId: socket.id, fromName: from.name, toId, kind: 'coin', coin, amt: n, ts: Date.now() });
    io.to(toId).emit('trade:coinIncoming', { offerId, fromName: from.name, coin, amt: n });
    io.to(socket.id).emit('chat', { system: true, text: `🤝 You offered ${n} ${coin} to ${to.name}. Waiting for them to accept…`, ts: Date.now() });
  });

  // ---- DM Shop: players buy items with coins ----
  socket.on('shop:set', ({ name, items } = {}) => {
    const room = rooms.get(joinedRoom); if (!room || !isGm(room, socket.id)) return;
    if (!room.shop) room.shop = { open: false, name: 'Market', items: [] };
    if (typeof name === 'string') room.shop.name = name.slice(0, 40) || 'Market';
    if (Array.isArray(items)) {
      room.shop.items = items.slice(0, 60).map((it, i) => ({
        id: (it && it.id) || 'si_' + Math.random().toString(36).slice(2, 8),
        name: String((it && it.name) || '').slice(0, 60),
        price: Math.max(0, Math.floor(Number(it && it.price) || 0)),
        wt: Math.max(0, Number(it && it.wt) || 0),
        stock: (it && it.stock != null) ? Math.floor(Number(it.stock)) : -1,  // -1 = unlimited
      })).filter((it) => it.name);
    }
    markDirty();
    broadcastShop(joinedRoom);
  });
  socket.on('shop:open', (open) => {
    const room = rooms.get(joinedRoom); if (!room || !isGm(room, socket.id)) return;
    if (!room.shop) room.shop = { open: false, name: 'Market', items: [] };
    room.shop.open = !!open;
    markDirty();
    broadcastShop(joinedRoom);
    pushSystem(joinedRoom, room.shop.open ? `🏪 ${room.shop.name} is now open for business.` : `🏪 ${room.shop.name} has closed.`);
  });
  // A player bought something. Coin deduction + item add happen client-side (coins are
  // client-held); the server decrements stock and announces the sale so the DM sees it.
  socket.on('shop:buy', ({ id } = {}) => {
    const room = rooms.get(joinedRoom); if (!room || !room.shop || !room.shop.open) return;
    const buyer = room.players[socket.id]; if (!buyer) return;
    const it = room.shop.items.find((x) => x.id === id); if (!it) return;
    if (it.stock === 0) { io.to(socket.id).emit('chat', { system: true, text: `⚠️ ${it.name} is sold out.`, ts: Date.now() }); return; }
    if (it.stock > 0) it.stock -= 1;
    markDirty();
    broadcastShop(joinedRoom);
    pushSystem(joinedRoom, `🛒 ${buyer.name} bought ${it.name} for ${it.price} gp.`);
  });
  // A player sells an item back to the shop. Coin add + item removal are client-side
  // (same trust model as buying); the server announces the sale and restocks.
  socket.on('shop:sell', ({ name } = {}) => {
    const room = rooms.get(joinedRoom); if (!room || !room.shop || !room.shop.open) return;
    const seller = room.players[socket.id]; if (!seller) return;
    const nm = String(name || '').trim().toLowerCase(); if (!nm) return;
    const it = room.shop.items.find((x) => String(x.name).toLowerCase() === nm); if (!it) return;
    if (it.stock >= 0) it.stock += 1;  // the item goes back on the shelf
    const sell = Math.floor(Number(it.price) / 2);
    markDirty();
    broadcastShop(joinedRoom);
    pushSystem(joinedRoom, `🪙 ${seller.name} sold ${it.name} for ${sell} gp.`);
  });

  // DM one-click: let the AI stock the shop with themed items + prices.
  socket.on('shop:ai', async ({ theme } = {}) => {
    const room = rooms.get(joinedRoom); if (!room || !isGm(room, socket.id)) return;
    if (!room.shop) room.shop = { open: false, name: 'Market', items: [] };
    const th = theme && String(theme).trim() ? String(theme).trim().slice(0, 50) : 'a fantasy general store';
    io.to(joinedRoom).emit('dm:thinking', true);
    const reply = await callOpenAIDM([{ role: 'user', content:
      `Stock a D&D shop themed as "${th}". List 6 to 8 items for sale. Reply with ONLY one item per line in the exact format: Name | price_in_gp | weight_in_lb. Example:\nPotion of Healing | 50 | 0.5\nRope, Hempen (50 ft) | 1 | 10\nNo intro, no numbering, no extra text.` }]);
    io.to(joinedRoom).emit('dm:thinking', false);
    if (/^⚠️/.test(reply)) { io.to(socket.id).emit('chat', { id: 'm_' + rid(), author: 'System', role: 'system', text: reply, ts: Date.now() }); return; }
    const items = String(reply).split(/\n+/).map((ln) => {
      const parts = ln.split('|').map((s) => s.replace(/[*_`#]/g, '').trim());
      const name = (parts[0] || '').replace(/^[-\d.\)\s]+/, '').slice(0, 60);
      if (!name) return null;
      const price = Math.max(0, Math.floor(Number(String(parts[1]).replace(/[^0-9.]/g, '')) || 0));
      const wt = Math.max(0, Number(String(parts[2]).replace(/[^0-9.]/g, '')) || 0);
      return { id: 'si_' + Math.random().toString(36).slice(2, 8), name, price, wt, stock: -1 };
    }).filter(Boolean).slice(0, 12);
    if (!items.length) { io.to(socket.id).emit('chat', { id: 'm_' + rid(), author: 'System', role: 'system', text: '⚠️ The AI reply could not be parsed into shop items. Try again.', ts: Date.now() }); return; }
    room.shop.items = items;
    markDirty();
    broadcastShop(joinedRoom);
    io.to(socket.id).emit('chat', { id: 'm_' + rid(), author: 'System', role: 'system', text: `🏪 Stocked the shop with ${items.length} items. Open it when you're ready to sell.`, ts: Date.now() });
  });

  // ================= THE WORLD: travel + location-bound vendors =================
  // DM moves the party between linked cities (DM has final say). Players can propose a
  // destination and vote; the DM confirms the move.
  socket.on('world:travel', ({ to, mode } = {}) => {
    const room = rooms.get(joinedRoom); if (!room || !isGm(room, socket.id)) return;
    const w = room.world; if (!w) return;
    const here = w.cities[w.party.at]; const dest = w.cities[to];
    if (!here || !dest) return;
    const link = (here.links || []).find((l) => l.to === to);
    if (!link || !link.modes[mode]) { io.to(socket.id).emit('chat', { id: 'm_' + rid(), author: 'System', role: 'system', text: `⚠️ No ${mode} route from ${here.name} to ${dest ? dest.name : to}.`, ts: Date.now() }); return; }
    // mounts/vehicles must be owned; foot is always free
    w.party.transport = w.party.transport || { horse: false, wagon: false, boat: false };
    if (mode !== 'walk' && !w.party.transport[mode]) {
      const need = { horse: 'horses', wagon: 'a wagon', boat: 'a ship or passage' }[mode] || 'transport';
      io.to(socket.id).emit('chat', { id: 'm_' + rid(), author: 'System', role: 'system', text: `⚠️ The party has no ${need} — acquire ${need} before traveling ${MODE_LABEL[mode] || 'that way'}.`, ts: Date.now() }); return;
    }
    const hours = link.modes[mode];
    w.party.at = to; w.vote = null;
    questCheckVisit(joinedRoom, to);
    // advance the in-world clock
    w.clock = w.clock || { day: 1, hour: 8 };
    w.clock.hour += hours; while (w.clock.hour >= 24) { w.clock.hour -= 24; w.clock.day += 1; }
    // roll for a road/sea encounter
    const chance = Math.max(0, Math.min(100, Number(w.encounterChance != null ? w.encounterChance : 35)));
    const hit = (Math.floor(Math.random() * 100) + 1) <= chance;
    const enc = hit ? rollEncounter(mode) : null;
    markDirty(); broadcastWorld(joinedRoom);
    const hh = String(w.clock.hour).padStart(2, '0');
    pushSystem(joinedRoom, `🧭 The party travels from ${here.name} to ${dest.name} ${MODE_LABEL[mode] || 'by road'} — about ${hours} hours. It is now Day ${w.clock.day}, ${hh}:00.`);
    if (enc) {
      pushSystem(joinedRoom, `⚔️ On the journey — ${enc}`);
      for (const sid of Object.keys(room.players)) if (room.players[sid]?.isGm) io.to(sid).emit('travel:encounter', { text: enc, mode });
    }
  });
  // DM grants (or revokes) the party's mounts and vehicles as they buy/earn them.
  socket.on('world:grantTransport', ({ kind, val } = {}) => {
    const room = rooms.get(joinedRoom); if (!room || !isGm(room, socket.id) || !room.world) return;
    const KINDS = ['horse', 'wagon', 'boat']; if (!KINDS.includes(kind)) return;
    const w = room.world; w.party.transport = w.party.transport || { horse: false, wagon: false, boat: false };
    w.party.transport[kind] = !!val;
    markDirty(); broadcastWorld(joinedRoom);
    const label = { horse: '🐴 horses', wagon: '🛒 a wagon', boat: '⛵ a ship' }[kind];
    pushSystem(joinedRoom, val ? `The party acquires ${label}!` : `The party no longer has ${label}.`);
  });
  // DM tunes how often journeys are interrupted, or forces an encounter now.
  socket.on('world:travelConfig', ({ chance } = {}) => {
    const room = rooms.get(joinedRoom); if (!room || !isGm(room, socket.id) || !room.world) return;
    if (chance != null) room.world.encounterChance = Math.max(0, Math.min(100, Math.floor(Number(chance) || 0)));
    markDirty(); broadcastWorld(joinedRoom);
  });
  socket.on('world:encounterNow', ({ mode } = {}) => {
    const room = rooms.get(joinedRoom); if (!room || !isGm(room, socket.id) || !room.world) return;
    const m = ENCOUNTERS[mode] ? mode : 'walk';
    const enc = rollEncounter(m);
    pushSystem(joinedRoom, `⚔️ ${enc}`);
    for (const sid of Object.keys(room.players)) if (room.players[sid]?.isGm) io.to(sid).emit('travel:encounter', { text: enc, mode: m });
  });
  // Anyone can roll a d20 on the current travel-mode encounter table.
  socket.on('world:encounterRoll', ({ mode } = {}) => {
    const room = rooms.get(joinedRoom); if (!room || !room.world) return;
    const m = ENCOUNTERS[mode] ? mode : 'walk';
    const t = encTable(m);
    const roll = Math.floor(Math.random() * 20) + 1;
    const enc = t[roll - 1] || t[0];
    const who = room.players[socket.id]?.name || 'Someone';
    pushSystem(joinedRoom, `🎲 ${who} rolls a d20 travel check (${MODE_LABEL[m] || m}) — ${roll}: ${enc}`);
    for (const sid of Object.keys(room.players)) if (room.players[sid]?.isGm) io.to(sid).emit('travel:encounter', { text: enc, mode: m, roll });
  });
  // DM browses a mode's full table, then picks a specific encounter.
  socket.on('world:encounterList', ({ mode } = {}) => {
    const room = rooms.get(joinedRoom); if (!room || !isGm(room, socket.id)) return;
    const m = ENCOUNTERS[mode] ? mode : 'walk';
    io.to(socket.id).emit('world:encounterList', { mode: m, list: encTable(m) });
  });
  socket.on('world:encounterPick', ({ mode, index } = {}) => {
    const room = rooms.get(joinedRoom); if (!room || !isGm(room, socket.id) || !room.world) return;
    const m = ENCOUNTERS[mode] ? mode : 'walk';
    const t = encTable(m); const i = Math.max(0, Math.min(t.length - 1, Math.floor(Number(index) || 0)));
    const enc = t[i];
    pushSystem(joinedRoom, `⚔️ ${enc}`);
    for (const sid of Object.keys(room.players)) if (room.players[sid]?.isGm) io.to(sid).emit('travel:encounter', { text: enc, mode: m });
  });
  // The party takes a long rest — at an inn if the city has a tavern, else making camp.
  // Advances the world clock 8 hours and triggers everyone's long-rest recovery.
  socket.on('world:rest', () => {
    const room = rooms.get(joinedRoom); if (!room || !room.world) return;
    const w = room.world; const here = w.cities[w.party.at];
    const hasInn = here && (here.vendors || []).some((v) => v.type === 'tavern');
    w.clock = w.clock || { day: 1, hour: 8 };
    w.clock.hour += 8; while (w.clock.hour >= 24) { w.clock.hour -= 24; w.clock.day += 1; }
    markDirty(); broadcastWorld(joinedRoom);
    io.to(joinedRoom).emit('world:rest', { inn: hasInn });
    const hh = String(w.clock.hour).padStart(2, '0');
    pushSystem(joinedRoom, hasInn
      ? `🛏️ The party takes rooms at an inn in ${here.name} and rests the night. It is now Day ${w.clock.day}, ${hh}:00.`
      : `🏕️ The party makes camp and takes a long rest. It is now Day ${w.clock.day}, ${hh}:00.`);
  });
  // Multi-hop journey to any city — auto-routes the fastest path using owned transport.
  socket.on('world:travelTo', ({ to } = {}) => {
    const room = rooms.get(joinedRoom); if (!room || !isGm(room, socket.id) || !room.world) return;
    const w = room.world; const from = w.party.at; const dest = w.cities[to];
    if (!dest || to === from) return;
    w.party.transport = w.party.transport || { horse: false, wagon: false, boat: false };
    const route = findRoute(w, from, to, w.party.transport);
    if (!route) { io.to(socket.id).emit('chat', { id: 'm_' + rid(), author: 'System', role: 'system', text: `⚠️ No route to ${dest.name} with your current transport — acquire horses/a wagon/a ship, or build a linking road.`, ts: Date.now() }); return; }
    w.party.at = to; w.vote = null;
    questCheckVisit(joinedRoom, to);
    w.clock = w.clock || { day: 1, hour: 8 };
    w.clock.hour += route.hours; while (w.clock.hour >= 24) { w.clock.hour -= 24; w.clock.day += 1; }
    // roll an encounter per leg, but announce at most two so chat isn't flooded
    const chance = Math.max(0, Math.min(100, Number(w.encounterChance != null ? w.encounterChance : 35)));
    const encs = [];
    for (const leg of route.legs) if ((Math.floor(Math.random() * 100) + 1) <= chance) encs.push({ leg, text: rollEncounter(leg.mode) });
    markDirty(); broadcastWorld(joinedRoom);
    const path = [w.cities[from].name, ...route.legs.map((l) => w.cities[l.to].name)].join(' → ');
    const hh = String(w.clock.hour).padStart(2, '0');
    pushSystem(joinedRoom, `🧭 The party journeys ${path} — ${route.hours} hours over ${route.legs.length} leg${route.legs.length > 1 ? 's' : ''}. It is now Day ${w.clock.day}, ${hh}:00.`);
    for (const e of encs.slice(0, 2)) {
      pushSystem(joinedRoom, `⚔️ En route (${w.cities[e.leg.from].name}→${w.cities[e.leg.to].name}) — ${e.text}`);
      for (const sid of Object.keys(room.players)) if (room.players[sid]?.isGm) io.to(sid).emit('travel:encounter', { text: e.text, mode: e.leg.mode });
    }
  });
  // A player proposes travel; opens a vote.
  socket.on('world:propose', ({ to, mode } = {}) => {
    const room = rooms.get(joinedRoom); if (!room) return;
    const w = room.world; if (!w) return;
    const p = room.players[socket.id]; if (!p) return;
    const here = w.cities[w.party.at]; const dest = w.cities[to]; if (!here || !dest) return;
    const link = (here.links || []).find((l) => l.to === to); if (!link || !link.modes[mode]) return;
    w.vote = { to, mode, byName: p.name, yes: [socket.id], no: [] };
    broadcastWorld(joinedRoom);
    pushSystem(joinedRoom, `🗳️ ${p.name} proposes traveling to ${dest.name} ${MODE_LABEL[mode] || ''} — cast your vote in the World tab. (The DM has the final call.)`);
  });
  socket.on('world:vote', ({ yes } = {}) => {
    const room = rooms.get(joinedRoom); if (!room) return;
    const w = room.world; if (!w || !w.vote) return;
    w.vote.yes = w.vote.yes.filter((id) => id !== socket.id);
    w.vote.no = w.vote.no.filter((id) => id !== socket.id);
    if (yes) w.vote.yes.push(socket.id); else w.vote.no.push(socket.id);
    broadcastWorld(joinedRoom);
  });
  socket.on('world:voteCancel', () => {
    const room = rooms.get(joinedRoom); if (!room || !room.world) return;
    const p = room.players[socket.id];
    if (!isGm(room, socket.id) && !(room.world.vote && room.world.vote.byName === (p && p.name))) return;
    room.world.vote = null; broadcastWorld(joinedRoom);
  });
  // Vendor buy — must be standing in the city, vendor must be open. Coins/items are
  // handled client-side (same trust model as the shop); server decrements stock + announces.
  socket.on('world:vendorBuy', ({ cityId, vendorId, itemId } = {}) => {
    const room = rooms.get(joinedRoom); if (!room || !room.world) return;
    const w = room.world; const buyer = room.players[socket.id]; if (!buyer) return;
    if (w.party.at !== cityId) { io.to(socket.id).emit('chat', { id: 'm_' + rid(), author: 'System', role: 'system', text: `⚠️ You must travel to that city first.`, ts: Date.now() }); return; }
    const v = findVendor(w, cityId, vendorId); if (!v || !v.open) return;
    const it = (v.items || []).find((x) => x.id === itemId); if (!it) return;
    if (it.stock === 0) { io.to(socket.id).emit('chat', { id: 'm_' + rid(), author: 'System', role: 'system', text: `⚠️ ${it.name} is sold out.`, ts: Date.now() }); return; }
    if (it.stock > 0) it.stock -= 1;
    markDirty(); broadcastWorld(joinedRoom);
    pushSystem(joinedRoom, `🛒 ${buyer.name} bought ${it.name} from ${v.name} for ${it.price} gp.`);
  });
  socket.on('world:vendorSell', ({ cityId, vendorId, name } = {}) => {
    const room = rooms.get(joinedRoom); if (!room || !room.world) return;
    const w = room.world; const seller = room.players[socket.id]; if (!seller) return;
    if (w.party.at !== cityId) return;
    const v = findVendor(w, cityId, vendorId); if (!v || !v.open) return;
    const nm = String(name || '').trim().toLowerCase(); if (!nm) return;
    const it = (v.items || []).find((x) => String(x.name).toLowerCase() === nm);
    if (!it) { io.to(socket.id).emit('chat', { id: 'm_' + rid(), author: 'System', role: 'system', text: `⚠️ ${v.name} won't buy that.`, ts: Date.now() }); return; }
    if (it.stock >= 0) it.stock += 1;
    const sell = Math.floor(Number(it.price) / (v.type === 'fence' ? 3 : 2));  // fences pay worse
    markDirty(); broadcastWorld(joinedRoom);
    pushSystem(joinedRoom, `🪙 ${seller.name} sold ${it.name} to ${v.name} for ${sell} gp.`);
  });
  // DM stocks a vendor with the AI, themed by the vendor's type.
  socket.on('world:vendorAI', async ({ cityId, vendorId } = {}) => {
    const room = rooms.get(joinedRoom); if (!room || !isGm(room, socket.id) || !room.world) return;
    const v = findVendor(room.world, cityId, vendorId); if (!v) return;
    const themeByType = {
      general: 'a fantasy general store (rations, rope, torches, tools, basic gear)',
      blacksmith: 'a blacksmith and armorer (weapons and armor, 5e prices)',
      wagon: 'a traveling wagon merchant (curios, trinkets, potions, odd but useful gear)',
      fence: 'a black-market fence (stolen goods, lockpicks, poisons, cheap and shady)',
      magic: 'an arcane vault (scrolls, minor magic items, spell components — pricey)',
      alchemist: 'an alchemist (potions, oils, reagents)',
      tavern: 'a tavern larder (food, drink, a room for the night)',
    };
    const th = themeByType[v.type] || 'a fantasy shop';
    io.to(joinedRoom).emit('dm:thinking', true);
    const reply = await callOpenAIDM([{ role: 'user', content:
      `Stock ${th} named "${v.name}". List 6 to 9 items. Reply with ONLY one item per line as: Name | price_in_gp | weight_in_lb. No intro, no numbering.` }]);
    io.to(joinedRoom).emit('dm:thinking', false);
    if (/^⚠️/.test(reply)) { io.to(socket.id).emit('chat', { id: 'm_' + rid(), author: 'System', role: 'system', text: reply, ts: Date.now() }); return; }
    const items = String(reply).split(/\n+/).map((ln) => {
      const parts = ln.split('|').map((s) => s.replace(/[*_`#]/g, '').trim());
      const nm = (parts[0] || '').replace(/^[-\d.\)\s]+/, '').slice(0, 60); if (!nm) return null;
      return { id: 'si_' + Math.random().toString(36).slice(2, 8), name: nm, price: Math.max(0, Math.floor(Number(String(parts[1]).replace(/[^0-9.]/g, '')) || 0)), wt: Math.max(0, Number(String(parts[2]).replace(/[^0-9.]/g, '')) || 0), stock: -1 };
    }).filter(Boolean).slice(0, 12);
    if (!items.length) { io.to(socket.id).emit('chat', { id: 'm_' + rid(), author: 'System', role: 'system', text: '⚠️ Could not parse AI stock. Try again.', ts: Date.now() }); return; }
    v.items = items; markDirty(); broadcastWorld(joinedRoom);
    io.to(socket.id).emit('chat', { id: 'm_' + rid(), author: 'System', role: 'system', text: `🏪 Stocked ${v.name} with ${items.length} items.`, ts: Date.now() });
  });
  // DM manual vendor edit (stock list + open/close + rename).
  socket.on('world:vendorSet', ({ cityId, vendorId, name, items, open } = {}) => {
    const room = rooms.get(joinedRoom); if (!room || !isGm(room, socket.id) || !room.world) return;
    const v = findVendor(room.world, cityId, vendorId); if (!v) return;
    if (typeof name === 'string' && name.trim()) v.name = name.trim().slice(0, 40);
    if (typeof open === 'boolean') v.open = open;
    if (Array.isArray(items)) {
      v.items = items.slice(0, 60).map((it) => ({
        id: (it && it.id) || 'si_' + Math.random().toString(36).slice(2, 8),
        name: String((it && it.name) || '').slice(0, 60),
        price: Math.max(0, Math.floor(Number(it && it.price) || 0)),
        wt: Math.max(0, Number(it && it.wt) || 0),
        stock: (it && it.stock != null) ? Math.floor(Number(it.stock)) : -1,
      })).filter((it) => it.name);
    }
    markDirty(); broadcastWorld(joinedRoom);
  });

  // ---- DM world-builder: create cities, routes, and vendors one at a time ----
  socket.on('world:cityAdd', ({ name, desc, kind } = {}) => {
    const room = rooms.get(joinedRoom); if (!room || !isGm(room, socket.id) || !room.world) return;
    const nm = String(name || '').trim().slice(0, 40); if (!nm) return;
    const base = nm.toLowerCase().replace(/[^a-z0-9]+/g, '') || 'city';
    let id = base; let n = 2; while (room.world.cities[id]) id = base + n++;
    room.world.cities[id] = { id, name: nm, kind: String(kind || 'town').slice(0, 16), desc: String(desc || '').slice(0, 400), vendors: [], links: [] };
    markDirty(); broadcastWorld(joinedRoom);
    io.to(socket.id).emit('chat', { id: 'm_' + rid(), author: 'System', role: 'system', text: `🗺️ Added ${nm} to the world. Link it to another city so the party can travel there.`, ts: Date.now() });
  });
  socket.on('world:cityRemove', ({ cityId } = {}) => {
    const room = rooms.get(joinedRoom); if (!room || !isGm(room, socket.id) || !room.world) return;
    const w = room.world; if (!w.cities[cityId] || Object.keys(w.cities).length <= 1) return;
    delete w.cities[cityId];
    for (const c of Object.values(w.cities)) c.links = (c.links || []).filter((l) => l.to !== cityId);
    if (w.party.at === cityId) w.party.at = Object.keys(w.cities)[0];
    if (w.vote && w.vote.to === cityId) w.vote = null;
    markDirty(); broadcastWorld(joinedRoom);
  });
  socket.on('world:cityLink', ({ from, to, mode, hours, twoWay } = {}) => {
    const room = rooms.get(joinedRoom); if (!room || !isGm(room, socket.id) || !room.world) return;
    const w = room.world; if (!w.cities[from] || !w.cities[to] || from === to) return;
    const MODES = ['walk', 'horse', 'wagon', 'boat']; if (!MODES.includes(mode)) return;
    const h = Math.max(1, Math.min(2000, Math.floor(Number(hours) || 1)));
    const addLink = (a, b) => {
      const city = w.cities[a]; city.links = city.links || [];
      let link = city.links.find((l) => l.to === b);
      if (!link) { link = { to: b, modes: {} }; city.links.push(link); }
      link.modes[mode] = h;
    };
    addLink(from, to); if (twoWay !== false) addLink(to, from);
    markDirty(); broadcastWorld(joinedRoom);
    io.to(socket.id).emit('chat', { id: 'm_' + rid(), author: 'System', role: 'system', text: `🧭 Route linked: ${w.cities[from].name} ↔ ${w.cities[to].name} (${mode}, ${h}h).`, ts: Date.now() });
  });
  socket.on('world:cityUnlink', ({ from, to } = {}) => {
    const room = rooms.get(joinedRoom); if (!room || !isGm(room, socket.id) || !room.world) return;
    const w = room.world;
    if (w.cities[from]) w.cities[from].links = (w.cities[from].links || []).filter((l) => l.to !== to);
    if (w.cities[to]) w.cities[to].links = (w.cities[to].links || []).filter((l) => l.to !== from);
    markDirty(); broadcastWorld(joinedRoom);
  });
  socket.on('world:vendorAdd', ({ cityId, name, type } = {}) => {
    const room = rooms.get(joinedRoom); if (!room || !isGm(room, socket.id) || !room.world) return;
    const c = room.world.cities[cityId]; if (!c) return;
    const nm = String(name || '').trim().slice(0, 40); if (!nm) return;
    const TYPES = ['general', 'blacksmith', 'wagon', 'fence', 'magic', 'alchemist', 'tavern'];
    c.vendors = c.vendors || [];
    c.vendors.push(mkVendor(nm, TYPES.includes(type) ? type : 'general'));
    markDirty(); broadcastWorld(joinedRoom);
  });
  socket.on('world:vendorRemove', ({ cityId, vendorId } = {}) => {
    const room = rooms.get(joinedRoom); if (!room || !isGm(room, socket.id) || !room.world) return;
    const c = room.world.cities[cityId]; if (!c) return;
    c.vendors = (c.vendors || []).filter((v) => v.id !== vendorId);
    markDirty(); broadcastWorld(joinedRoom);
  });
  // DM invents a whole city with the AI (name, description, and a few themed vendors).
  socket.on('world:cityAI', async ({ theme } = {}) => {
    const room = rooms.get(joinedRoom); if (!room || !isGm(room, socket.id) || !room.world) return;
    const th = theme && String(theme).trim() ? String(theme).trim().slice(0, 60) : 'a fantasy settlement';
    io.to(joinedRoom).emit('dm:thinking', true);
    const reply = await callOpenAIDM([{ role: 'user', content:
      `Invent a D&D location themed as "${th}". Reply in EXACTLY this format and nothing else:\nNAME: <city name>\nKIND: <one word: town, city, village, port, keep, or hold>\nDESC: <two sentences of vivid description>\nVENDORS: <comma-separated list of 2-4 as name:type, where type is one of general, blacksmith, wagon, fence, magic, alchemist, tavern>` }]);
    io.to(joinedRoom).emit('dm:thinking', false);
    if (/^⚠️/.test(reply)) { io.to(socket.id).emit('chat', { id: 'm_' + rid(), author: 'System', role: 'system', text: reply, ts: Date.now() }); return; }
    const grab = (k) => { const m = reply.match(new RegExp(k + ':\\s*(.+)', 'i')); return m ? m[1].trim() : ''; };
    const nm = grab('NAME').replace(/[*_`#]/g, '').slice(0, 40); if (!nm) { io.to(socket.id).emit('chat', { id: 'm_' + rid(), author: 'System', role: 'system', text: '⚠️ Could not parse the AI city. Try again.', ts: Date.now() }); return; }
    const base = nm.toLowerCase().replace(/[^a-z0-9]+/g, '') || 'city'; let id = base, n = 2; while (room.world.cities[id]) id = base + n++;
    const TYPES = ['general', 'blacksmith', 'wagon', 'fence', 'magic', 'alchemist', 'tavern'];
    const vendors = grab('VENDORS').split(',').map((s) => { const [vn, vt] = s.split(':').map((x) => x.replace(/[*_`#]/g, '').trim()); return vn ? mkVendor(vn.slice(0, 40), TYPES.includes((vt || '').toLowerCase()) ? vt.toLowerCase() : 'general') : null; }).filter(Boolean).slice(0, 4);
    room.world.cities[id] = { id, name: nm, kind: (grab('KIND') || 'town').toLowerCase().replace(/[^a-z]/g, '').slice(0, 12) || 'town', desc: grab('DESC').slice(0, 400), vendors, links: [] };
    markDirty(); broadcastWorld(joinedRoom);
    io.to(socket.id).emit('chat', { id: 'm_' + rid(), author: 'System', role: 'system', text: `🗺️ The AI conjured ${nm} with ${vendors.length} vendors. Link it to the map so the party can reach it.`, ts: Date.now() });
  });

  // ---- DM heals or damages one player's sheet HP straight from the oversight viewer ----
  socket.on('dm:hpOne', ({ targetId, amt } = {}) => {
    const room = rooms.get(joinedRoom); if (!room || !isGm(room, socket.id)) return;
    const to = room.players[targetId]; if (!to) return;
    const n = Math.floor(Number(amt) || 0); if (n === 0 || n < -999 || n > 999) return;
    io.to(targetId).emit('dm:hpApply', { amt: n });
    pushSystem(joinedRoom, n > 0 ? `❤️ The DM healed ${to.name} for ${n} HP.` : `💥 The DM dealt ${Math.abs(n)} damage to ${to.name}.`);
  });

  // ---- DM grants coins straight to a player (reward or refund) ----
  socket.on('dm:grantCoin', ({ targetId, coin, amt } = {}) => {
    const room = rooms.get(joinedRoom); if (!room || !isGm(room, socket.id)) return;
    const to = room.players[targetId]; if (!to) return;
    const COINS = ['cp', 'sp', 'ep', 'gp', 'pp']; if (!COINS.includes(coin)) return;
    const n = Math.floor(Number(amt) || 0); if (n === 0 || n < -1e7 || n > 1e7) return;
    io.to(targetId).emit('trade:coinGive', { coin, amt: n, fromName: 'The DM' });
    pushSystem(joinedRoom, n > 0 ? `💰 The DM gave ${n} ${coin} to ${to.name}.` : `💰 The DM took ${Math.abs(n)} ${coin} from ${to.name}.`);
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

  // ---- #220 Optional rules: DM flips switches, whole room updates ----
  socket.on('opts:set', (patch) => {
    const room = rooms.get(joinedRoom); if (!room || !isGm(room, socket.id) || !patch) return;
    room.opts = room.opts || {};
    if (typeof patch.maneuvers === 'boolean') room.opts.maneuvers = patch.maneuvers;
    io.to(joinedRoom).emit('opts:set', room.opts);
    markDirty();
  });

  // ---- #222 Next-session banner: DM sets, everyone sees ----
  socket.on('session:set', (s) => {
    const room = rooms.get(joinedRoom); if (!room || !isGm(room, socket.id) || !s) return;
    room.session = {
      when: String(s.when || '').slice(0, 80),
      note: String(s.note || '').slice(0, 200),
    };
    io.to(joinedRoom).emit('session:set', room.session);
    markDirty();
  });

  // ---- #218 Player Notebook: private per-player notes with photos/sketches ----
  socket.on('note:add', (n) => {
    const room = rooms.get(joinedRoom); if (!room || !n) return;
    const me = room.players[socket.id]; if (!me) return;
    const text = String(n.text || '').slice(0, 4000);
    let img = null;
    if (typeof n.img === 'string' && /^data:image\/(jpeg|png|webp);base64,/.test(n.img) && n.img.length <= 350000) img = n.img;
    if (!text && !img) return;
    room.notebook = room.notebook || {};
    const list = room.notebook[me.name] = room.notebook[me.name] || [];
    if (list.length >= 40) return socket.emit('note:list', list); // per-player cap
    // whole-room notebook budget so save files stay sane
    try { if (JSON.stringify(room.notebook).length > 6000000) return socket.emit('note:list', list); } catch (e) {}
    list.push({ id: rid(), ts: Date.now(), text, img });
    socket.emit('note:list', list);   // private: only the author sees their notebook
    markDirty();
  });
  socket.on('note:del', (id) => {
    const room = rooms.get(joinedRoom); if (!room) return;
    const me = room.players[socket.id]; if (!me || !room.notebook) return;
    const list = room.notebook[me.name]; if (!list) return;
    const i = list.findIndex((n) => n.id === id); if (i < 0) return;
    list.splice(i, 1);
    socket.emit('note:list', list);
    markDirty();
  });

  // ---- Quest log (DM only sets; everyone sees) ----
  // ---- QUEST ENGINE: quests with objectives + rewards that pay through the economy ----
  socket.on('quest:offer', (q) => {
    const room = rooms.get(joinedRoom); if (!room || !isGm(room, socket.id)) return;
    const quest = sanitizeQuest(q); if (!quest || !quest.title) return;
    room.quests = room.quests || { main: '', sides: [], list: [] };
    room.quests.list = room.quests.list || [];
    if (room.quests.list.length >= 40) return;
    room.quests.list.push(quest);
    io.to(joinedRoom).emit('quest:update', room.quests);
    markDirty();
    const objs = (quest.objectives || []).length;
    pushSystem(joinedRoom, `📜 New ${quest.kind} quest: "${quest.title}"${quest.giver ? ` — from ${quest.giver}` : ''}${objs ? ` (${objs} objective${objs > 1 ? 's' : ''})` : ''}.`);
  });
  socket.on('quest:objective', ({ questId, idx, done } = {}) => {
    const room = rooms.get(joinedRoom); if (!room || !room.quests || !room.quests.list) return;
    const quest = room.quests.list.find((x) => x.id === questId); if (!quest || !quest.objectives) return;
    const o = quest.objectives[Math.floor(Number(idx))]; if (!o) return;
    if (o.type === 'visit') return;  // visit objectives complete only by actually traveling there
    o.done = !!done;
    io.to(joinedRoom).emit('quest:update', room.quests);
    markDirty();
    if (o.done) questAnnounceIfReady(joinedRoom, quest);
  });
  socket.on('quest:turnIn', ({ questId } = {}) => {
    const room = rooms.get(joinedRoom); if (!room || !isGm(room, socket.id) || !room.quests || !room.quests.list) return;
    const quest = room.quests.list.find((x) => x.id === questId); if (!quest || quest.done) return;
    quest.done = true;
    io.to(joinedRoom).emit('quest:update', room.quests);
    markDirty();
    const rw = quest.rewards || {};
    const xp = Math.max(0, Math.floor(Number(rw.xp) || 0));
    const gp = Math.max(0, Math.floor(Number(rw.gp) || 0));
    // pay every player (not the GM); items are announced for the DM to hand out
    for (const sid of Object.keys(room.players)) {
      if (!room.players[sid].isGm && (xp || gp)) io.to(sid).emit('quest:reward', { title: quest.title, xp, gp });
    }
    const bits = [];
    if (xp) bits.push(`${xp} XP each`); if (gp) bits.push(`${gp} gp each`);
    if (Array.isArray(rw.items) && rw.items.length) bits.push(`items: ${rw.items.join(', ')} (DM hands out)`);
    pushSystem(joinedRoom, `🏆 Quest complete: "${quest.title}"!${bits.length ? ' Rewards — ' + bits.join(' · ') + '.' : ''}`);
  });
  // AI writes a quest in strict format; DM triggers, quest posts directly to the board.
  socket.on('quest:aiOffer', async ({ theme } = {}) => {
    const room = rooms.get(joinedRoom); if (!room || !isGm(room, socket.id)) return;
    const w = room.world; const here = w && w.cities[w.party.at];
    const th = theme && String(theme).trim() ? String(theme).trim().slice(0, 60) : (here ? `an adventure starting in ${here.name}` : 'a fantasy adventure');
    io.to(joinedRoom).emit('dm:thinking', true);
    const reply = await callOpenAIDM([{ role: 'user', content:
      `Write one D&D quest themed as "${th}". Reply in EXACTLY this format, nothing else:\nTITLE: <short title>\nKIND: <main or side>\nGIVER: <who offers it>\nOBJ: <objective 1>\nOBJ: <objective 2>\nOBJ: <objective 3 (optional)>\nXP: <number>\nGP: <number>` }]);
    io.to(joinedRoom).emit('dm:thinking', false);
    if (/^⚠️/.test(reply)) { io.to(socket.id).emit('chat', { id: 'm_' + rid(), author: 'System', role: 'system', text: reply, ts: Date.now() }); return; }
    const grab = (k) => { const m = reply.match(new RegExp('^\\s*' + k + ':\\s*(.+)$', 'im')); return m ? m[1].replace(/[*_`#]/g, '').trim() : ''; };
    const title = grab('TITLE').slice(0, 120);
    if (!title) { io.to(socket.id).emit('chat', { id: 'm_' + rid(), author: 'System', role: 'system', text: '⚠️ Could not parse the AI quest. Try again.', ts: Date.now() }); return; }
    const objectives = [...reply.matchAll(/^\s*OBJ:\s*(.+)$/gim)].map((m) => ({ text: m[1].replace(/[*_`#]/g, '').trim().slice(0, 200), type: 'custom', done: false })).filter((o) => o.text).slice(0, 4);
    const quest = sanitizeQuest({
      title, kind: /side/i.test(grab('KIND')) ? 'side' : 'main', giver: grab('GIVER').slice(0, 60),
      objectives, rewards: { xp: Number(grab('XP').replace(/[^0-9]/g, '')) || 100, gp: Number(grab('GP').replace(/[^0-9]/g, '')) || 10 },
    });
    room.quests = room.quests || { main: '', sides: [], list: [] };
    room.quests.list = room.quests.list || [];
    room.quests.list.push(quest);
    io.to(joinedRoom).emit('quest:update', room.quests);
    markDirty();
    pushSystem(joinedRoom, `📜 New ${quest.kind} quest: "${quest.title}"${quest.giver ? ` — from ${quest.giver}` : ''} (${quest.objectives.length} objectives, ${quest.rewards.xp} XP + ${quest.rewards.gp} gp).`);
  });

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
      ? q.list.slice(0, 40).map((it) => sanitizeQuest(it)).filter((it) => it && it.title)
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

  // ---- #179 Save / Load campaign 2.0 — everything, GM-only ----
  socket.on('campaign:get', () => {
    const room = rooms.get(joinedRoom); if (!room || !isGm(room, socket.id)) return;   // GM-only: saves include hidden tokens
    socket.emit('campaign:data', {
      v: 2,
      tokens: room.tokens, mapImage: room.mapImage, gridSize: room.gridSize,
      initiative: room.initiative, turnIndex: room.turnIndex, fog: room.fog,
      walls: room.walls, lighting: room.lighting, aoes: room.aoes, handout: room.handout,
      weather: room.weather, ambience: room.ambience || 'off', round: room.round || 1,
      notes: room.notes || '', quests: room.quests || { main: '', sides: [] },
      drawings: (room.drawings || []).slice(-500),
      shop: room.shop || { open: false, name: 'Market', items: [] },
      world: room.world || null,
      npcs: room.npcs || [],              // #196
      chat: room.chat.slice(-200),
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
    room.round = Number(data.round) || 1;
    if (data.ambience) room.ambience = data.ambience;
    if (typeof data.notes === 'string') room.notes = data.notes;
    if (data.quests) room.quests = { main: String(data.quests.main || ''), sides: Array.isArray(data.quests.sides) ? data.quests.sides : [], list: Array.isArray(data.quests.list) ? data.quests.list.map(sanitizeQuest) : (room.quests && room.quests.list) || [] };
    if (Array.isArray(data.drawings)) room.drawings = data.drawings.slice(-500);
    if (data.shop && typeof data.shop === 'object') room.shop = { open: !!data.shop.open, name: String(data.shop.name || 'Market').slice(0, 40), items: Array.isArray(data.shop.items) ? data.shop.items.slice(0, 200) : [] };
    if (Array.isArray(data.npcs)) { room.npcs = data.npcs.slice(0, 100).map((n) => ({ id: String(n.id || 'n_' + rid()), name: String(n.name || '').slice(0, 60), desc: String(n.desc || '').slice(0, 500), notes: String(n.notes || '').slice(0, 300), ts: Number(n.ts) || Date.now() })).filter((n) => n.name); broadcastNpcs(joinedRoom); }  // #196
    if (data.world && data.world.cities && data.world.party) room.world = data.world;
    if (Array.isArray(data.chat) && data.chat.length) room.chat = data.chat.slice(-200);
    markDirty();
    // push full fresh state to everyone
    for (const sid of Object.keys(room.players)) {
      io.to(sid).emit('state', {
        tokens: tokensFor(room, sid), chat: room.chat.slice(-100), mapImage: room.mapImage,
        gridSize: room.gridSize, initiative: room.initiative, turnIndex: room.turnIndex,
        fog: room.fog, walls: room.walls, lighting: room.lighting, aoes: room.aoes,
        handout: room.handout, weather: room.weather, round: room.round,
        ambience: room.ambience || 'off',
        notes: room.notes || '', quests: room.quests || { main: '', sides: [] },
        drawings: room.drawings || [],
        shop: room.shop || { open: false, name: 'Market', items: [] },
        world: room.world || buildStarterWorld(),
        youId: sid, isGm: room.players[sid].isGm, gmClaimed: !!room.gmPassword,
        licenseMode: DM_PRO_MODE, proUrl: DM_PRO_URL,
      });
    }
    pushSystem(joinedRoom, '📂 The GM loaded a saved campaign — map, quests, shop and world restored.');
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
    // #208 Nat 20 / Nat 1 callouts — find the d20 faces in any of our roll formats
    const f = String(formula || ''), det = String(detail || '');
    let faces = [];
    const tagged = [...det.matchAll(/d20\s*\[([\d,\s]+)\]/gi)];
    if (tagged.length) {
      faces = tagged.flatMap((m) => m[1].split(',').map((n) => parseInt(n, 10)));
    } else if (/d20\b/i.test(f) && [...f.matchAll(/d(\d+)/gi)].every((m) => m[1] === '20')) {
      const picked = [...det.matchAll(/\[[\d,\s]+\]\s*→\s*(\d+)/g)].map((m) => parseInt(m[1], 10));
      faces = picked.length ? picked
        : [...det.matchAll(/\[([\d,\s]+)\]/g)].flatMap((m) => m[1].split(',').map((n) => parseInt(n, 10)));
    }
    faces = faces.filter(Number.isFinite);
    let crit = '';
    if (faces.includes(20)) crit = '  💥 NATURAL 20!';
    else if (faces.includes(1)) crit = '  💀 CRITICAL FAIL — natural 1!';
    const msg = { id: 'm_' + rid(), author: p?.name || 'Someone', role: 'roll', text: `rolled ${formula} → ${result}  (${detail})${crit}`, ts: Date.now() };
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
    // #196: auto-remember improvised NPCs so the AI never forgets them
    if ((kind || 'npc') === 'npc' && reply && !/^⚠️/.test(reply)) {
      const first = String(reply).trim().replace(/^\*+/, '');
      const m = first.match(/^([A-Z][\w'’-]+(?: [A-Z][\w'’-]+){0,3})/);
      if (m) {
        rememberNpc(room, joinedRoom, m[1], reply, '');
        pushSystem(joinedRoom, `🧠 The DM will remember ${m[1]} (see Journal → People you've met).`);
      }
    }
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
