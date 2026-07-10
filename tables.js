/* ============================================================
   ROLLABLE RANDOM TABLES  (Roll20-style)
   Built-in generic/SRD-flavored tables + custom tables (localStorage).
   Rolls post to the shared chat via window.emitChat.
   ============================================================ */
(function () {
  const BUILTIN = {
    'Wild Magic Surge': [
      'Roll on this table at the start of each of your turns for 1 minute, then this effect ends.',
      'A creature within 60 ft becomes poisoned for 1 hour.',
      'You turn invisible until you attack or cast a spell.',
      'A modron appears for 1 minute, then vanishes.',
      'You cast Fireball centered on yourself (3rd level).',
      'You cast Magic Missile as a 5th-level spell.',
      'Your height changes by 1d10 inches (odd shrink / even grow).',
      'You cast Confusion centered on yourself.',
      'You regain your lowest-level expended spell slot.',
      'For the next minute, you can see any invisible creature within 30 ft.',
      'A unicorn appears within 5 ft, then disappears 1 minute later.',
      'You can\'t speak for 1 minute; pink bubbles float out when you try.',
      'A spectral shield grants +2 AC and immunity to Magic Missile for 1 minute.',
      'You are immune to being intoxicated by alcohol for 5 days.',
      'Your hair falls out but grows back in 24 hours.',
      'For 1 minute, any flammable object you touch that isn\'t worn ignites.',
      'You regain 2d10 hit points.',
      'You turn into a potted plant until the start of your next turn (incapacitated, AC 5).',
      'For 1 minute you can teleport up to 20 ft as a bonus action.',
      'You cast Levitate on yourself.',
    ],
    'Trinkets': [
      'A mummified goblin hand.', 'A crystal that faintly glows in moonlight.',
      'A gold coin from a lost kingdom.', 'A tiny music box that plays an unknown tune.',
      'A silver spoon with an "M" engraved.', 'A pair of dice that always roll sixes… when no one watches.',
      'A small idol of a forgotten god.', 'A rope of intricately knotted human hair.',
      'A glass eye that seems to follow you.', 'A dried scrap of a giant\'s toenail.',
      'A vial of dragon blood, mostly evaporated.', 'A key that fits no lock you\'ve found.',
      'A single playing card from an unknown deck.', 'A locket with a portrait of a stranger.',
      'A brass ring that never tarnishes.', 'A map to a place that no longer exists.',
    ],
    'Tavern Names': [
      'The Prancing Pony', 'The Drunken Griffon', 'The Wet Whistle', 'The Salty Siren',
      'The Gilded Goblet', 'The Weary Traveler', 'The Cackling Crone', 'The Rusty Nail',
      'The Silver Tankard', 'The Laughing Ogre', 'The Broken Wheel', 'The Sleeping Dragon',
      'The Roaring Hearth', 'The Copper Kettle', 'The Black Boar', 'The Wandering Minstrel',
    ],
    'Weather': [
      'Clear and pleasant.', 'Light rain, muddy roads.', 'Heavy fog — vision limited to 60 ft.',
      'Bitter cold wind (disadvantage on ranged attacks).', 'Sweltering heat — CON checks or exhaustion.',
      'Thunderstorm rolling in.', 'Light snow beginning to fall.', 'Overcast and gloomy.',
    ],
    'Wilderness Encounter (low level)': [
      '2d4 goblins scouting for a raiding party.', 'A lone wolf, injured and desperate.',
      'A traveling merchant with a broken wheel.', '1d4 bandits demanding a toll.',
      'A giant spider lurking in the trees.', 'A frightened commoner fleeing something.',
      'Tracks of a large beast crossing the road.', 'A druid tending a wounded stag.',
      'A swarm of bats erupting from a cave.', 'An abandoned campsite, recently used.',
      'A pack of 1d4 wolves hunting.', 'A pilgrim seeking directions to a shrine.',
    ],
    'NPC Quirk': [
      'Speaks in the third person.', 'Constantly polishes a lucky coin.',
      'Never finishes sentences.', 'Laughs nervously at bad news.',
      'Has an imaginary friend they consult.', 'Distrusts anyone wearing red.',
      'Collects buttons obsessively.', 'Hums an old war song.',
      'Refers to everyone as "friend."', 'Flinches at loud noises.',
      'Insists on shaking hands twice.', 'Believes they were royalty in a past life.',
    ],
    'Plot Hook': [
      'A child has gone missing near the old mill.', 'A noble offers gold to recover a stolen heirloom.',
      'Livestock are vanishing without a trace.', 'A sealed letter must reach a distant town by dawn.',
      'Strange lights appear over the ruins each night.', 'A merchant caravan never arrived.',
      'The village well has turned bitter and foul.', 'An old map hints at a nearby hidden vault.',
      'A stranger claims to know one of the party\'s secrets.', 'The dead are not resting easy in the graveyard.',
    ],
    'Treasure (gems & art)': [
      'A polished piece of obsidian (10 gp).', 'A small silver ring set with a moonstone (50 gp).',
      'A carved ivory statuette (75 gp).', 'A gold locket with a painted portrait (100 gp).',
      'A jade figurine of a coiled serpent (250 gp).', 'A cluster of tiny amethysts (100 gp).',
      'A jeweled dagger, ceremonial (300 gp).', 'A string of matched black pearls (500 gp).',
      'A silver chalice etched with runes (150 gp).', 'A bloodstone the size of a thumb (50 gp).',
    ],
  };

  function loadCustom() { try { return JSON.parse(localStorage.getItem('dnd-tables') || '{}'); } catch { return {}; } }
  function saveCustom(o) { try { localStorage.setItem('dnd-tables', JSON.stringify(o)); } catch {} }
  function allTables() { return Object.assign({}, BUILTIN, loadCustom()); }

  function renderSelect() {
    const sel = document.getElementById('rt-select'); if (!sel) return;
    const cur = sel.value;
    const tables = allTables();
    sel.innerHTML = Object.keys(tables).map((n) => `<option>${n.replace(/</g, '&lt;')}</option>`).join('');
    if (cur && tables[cur]) sel.value = cur;
  }

  function init() {
    const sel = document.getElementById('rt-select'); if (!sel) return;
    renderSelect();
    document.getElementById('rt-roll').onclick = () => {
      const tables = allTables();
      const list = tables[sel.value]; if (!list || !list.length) return;
      const pick = list[Math.floor(Math.random() * list.length)];
      const prev = document.getElementById('rt-preview'); if (prev) prev.textContent = '→ ' + pick;
      if (typeof window.emitChat === 'function') window.emitChat(`🎲 ${sel.value}: ${pick}`);
    };
    document.getElementById('rt-new').onclick = () => {
      const name = (prompt('New table name:') || '').trim(); if (!name) return;
      const body = prompt('Entries — one per line:'); if (!body) return;
      const entries = body.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
      if (!entries.length) return;
      const cust = loadCustom(); cust[name] = entries; saveCustom(cust);
      renderSelect(); sel.value = name;
    };
  }
  if (document.readyState !== 'loading') init();
  else document.addEventListener('DOMContentLoaded', init);
})();
