/* ============================================================
   MAGIC ITEMS  —  D&D SRD 5.1, CC-BY-4.0
   Searchable magic-item browser (search + rarity filter).
   ============================================================ */
(function () {
  // r = rarity, y = type, a = attunement (bool), x = effect
  const ITEMS = [
    { n: 'Potion of Healing', r: 'Common', y: 'Potion', a: false, x: 'Regain 2d4+2 HP as a bonus action when you drink it.' },
    { n: 'Potion of Greater Healing', r: 'Uncommon', y: 'Potion', a: false, x: 'Regain 4d4+4 HP.' },
    { n: 'Potion of Climbing', r: 'Common', y: 'Potion', a: false, x: 'Climbing speed equal to walking speed for 1 hour; advantage on Athletics to climb.' },
    { n: 'Potion of Fire Resistance', r: 'Uncommon', y: 'Potion', a: false, x: 'Resistance to fire damage for 1 hour.' },
    { n: 'Potion of Giant Strength (Hill)', r: 'Uncommon', y: 'Potion', a: false, x: 'Your Strength becomes 21 for 1 hour.' },
    { n: 'Potion of Flying', r: 'Very Rare', y: 'Potion', a: false, x: 'Flying speed equal to walking speed for 1 hour (can hover).' },
    { n: 'Potion of Invisibility', r: 'Very Rare', y: 'Potion', a: false, x: 'Become invisible for 1 hour (ends if you attack or cast).' },
    { n: 'Potion of Heroism', r: 'Rare', y: 'Potion', a: false, x: '10 temp HP and the effect of Bless for 1 hour.' },
    { n: 'Oil of Sharpness', r: 'Very Rare', y: 'Potion', a: false, x: 'Coated weapon gains +3 to attack and damage for 1 hour.' },
    { n: 'Bag of Holding', r: 'Uncommon', y: 'Wondrous item', a: false, x: 'Holds 500 lb / 64 cubic ft in an extradimensional space; always weighs 15 lb.' },
    { n: 'Cloak of Protection', r: 'Uncommon', y: 'Wondrous item', a: true, x: '+1 to AC and saving throws while worn.' },
    { n: 'Ring of Protection', r: 'Rare', y: 'Ring', a: true, x: '+1 to AC and saving throws while worn.' },
    { n: 'Cloak of Elvenkind', r: 'Uncommon', y: 'Wondrous item', a: true, x: 'Advantage on Stealth; others have disadvantage to see you with the hood up.' },
    { n: 'Boots of Elvenkind', r: 'Uncommon', y: 'Wondrous item', a: false, x: 'Advantage on Stealth checks that rely on moving silently.' },
    { n: 'Boots of Speed', r: 'Rare', y: 'Wondrous item', a: true, x: 'Bonus action to double your speed; opportunity attacks vs you have disadvantage (10 min/day).' },
    { n: 'Winged Boots', r: 'Uncommon', y: 'Wondrous item', a: true, x: 'Flying speed equal to your walking speed for up to 4 hours (regains 2/day).' },
    { n: 'Boots of Levitation', r: 'Rare', y: 'Wondrous item', a: true, x: 'Cast levitate on yourself at will.' },
    { n: 'Bracers of Defense', r: 'Rare', y: 'Wondrous item', a: true, x: '+2 AC while wearing no armor and no shield.' },
    { n: 'Amulet of Health', r: 'Rare', y: 'Wondrous item', a: true, x: 'Your Constitution becomes 19.' },
    { n: 'Belt of Hill Giant Strength', r: 'Rare', y: 'Wondrous item', a: true, x: 'Your Strength becomes 21.' },
    { n: 'Gauntlets of Ogre Power', r: 'Uncommon', y: 'Wondrous item', a: true, x: 'Your Strength becomes 19.' },
    { n: 'Headband of Intellect', r: 'Uncommon', y: 'Wondrous item', a: true, x: 'Your Intelligence becomes 19.' },
    { n: 'Ring of Free Action', r: 'Rare', y: 'Ring', a: true, x: 'Difficult terrain costs no extra movement; can\'t be paralyzed or restrained by magic.' },
    { n: 'Ring of Regeneration', r: 'Very Rare', y: 'Ring', a: true, x: 'Regain 1d6 HP every 10 minutes; regrow lost body parts.' },
    { n: 'Ring of Invisibility', r: 'Legendary', y: 'Ring', a: true, x: 'Turn invisible as an action; ends when you act or dismiss it.' },
    { n: 'Ring of Spell Storing', r: 'Rare', y: 'Ring', a: true, x: 'Stores up to 5 levels of spells to cast later.' },
    { n: 'Ring of Telekinesis', r: 'Very Rare', y: 'Ring', a: true, x: 'Cast telekinesis at will (no material components).' },
    { n: 'Ring of Feather Falling', r: 'Rare', y: 'Ring', a: true, x: 'Feather fall triggers on you automatically when you fall.' },
    { n: 'Pearl of Power', r: 'Uncommon', y: 'Wondrous item', a: true, x: 'Bonus action: regain one expended spell slot (≤3rd level), once per day.' },
    { n: 'Wand of Magic Missiles', r: 'Uncommon', y: 'Wand', a: false, x: '7 charges; expend to cast magic missile (1 charge = 1st level, +1 dart per extra charge).' },
    { n: 'Wand of Fireballs', r: 'Rare', y: 'Wand', a: true, x: '7 charges; cast fireball (3rd level for 1 charge, +1 level per extra charge).' },
    { n: 'Wand of the War Mage +1', r: 'Uncommon', y: 'Wand', a: true, x: '+1 to spell attack rolls; ignore half and three-quarters cover with spell attacks.' },
    { n: 'Wand of Web', r: 'Uncommon', y: 'Wand', a: true, x: '7 charges; cast web (save DC 15).' },
    { n: 'Staff of Fire', r: 'Very Rare', y: 'Staff', a: true, x: '10 charges; resistance to fire; cast burning hands, fireball, or wall of fire.' },
    { n: 'Staff of Healing', r: 'Rare', y: 'Staff', a: true, x: '10 charges; cast cure wounds, lesser restoration, or mass cure wounds.' },
    { n: 'Staff of the Magi', r: 'Legendary', y: 'Staff', a: true, x: '50 charges; spell absorption; cast a huge list of arcane spells; can be broken for a retributive strike.' },
    { n: 'Staff of Power', r: 'Very Rare', y: 'Staff', a: true, x: '+2 to attack, damage, AC, and saves; 20 charges of powerful spells.' },
    { n: 'Weapon +1', r: 'Uncommon', y: 'Weapon', a: false, x: '+1 bonus to attack and damage rolls (magical).' },
    { n: 'Weapon +2', r: 'Rare', y: 'Weapon', a: false, x: '+2 bonus to attack and damage rolls (magical).' },
    { n: 'Weapon +3', r: 'Very Rare', y: 'Weapon', a: false, x: '+3 bonus to attack and damage rolls (magical).' },
    { n: 'Flame Tongue', r: 'Rare', y: 'Weapon', a: true, x: 'Bonus action to ignite: +2d6 fire damage on hits; sheds bright light 40 ft.' },
    { n: 'Frost Brand', r: 'Very Rare', y: 'Weapon', a: true, x: '+1d6 cold damage; resistance to fire; sheds light near flames.' },
    { n: 'Sun Blade', r: 'Rare', y: 'Weapon', a: true, x: 'Radiant longsword: +2 to hit/damage, +1d8 radiant vs undead; sheds sunlight.' },
    { n: 'Dagger of Venom', r: 'Rare', y: 'Weapon', a: false, x: '+1 dagger; once/day coat with poison (DC 15 CON or 2d10 poison + poisoned).' },
    { n: 'Holy Avenger', r: 'Legendary', y: 'Weapon', a: true, x: 'Paladin-only: +3 sword, +2d10 radiant vs fiends/undead, aura of magic-resistance.' },
    { n: 'Vorpal Sword', r: 'Legendary', y: 'Weapon', a: true, x: '+3 sword; ignore slashing resistance; a natural 20 can sever the target\'s head.' },
    { n: 'Armor +1', r: 'Rare', y: 'Armor', a: false, x: '+1 bonus to AC (magical armor).' },
    { n: 'Adamantine Armor', r: 'Uncommon', y: 'Armor', a: false, x: 'Any critical hit against you becomes a normal hit.' },
    { n: 'Mithral Armor', r: 'Uncommon', y: 'Armor', a: false, x: 'No Strength requirement and no Stealth disadvantage.' },
    { n: 'Shield +1', r: 'Uncommon', y: 'Armor', a: false, x: '+1 bonus to AC beyond a normal shield.' },
    { n: 'Immovable Rod', r: 'Uncommon', y: 'Rod', a: false, x: 'Press the button to fix it in place (holds up to 8,000 lb).' },
    { n: 'Rod of Lordly Might', r: 'Legendary', y: 'Rod', a: true, x: '+3 mace that transforms into several weapons and tools with special powers.' },
    { n: 'Broom of Flying', r: 'Uncommon', y: 'Wondrous item', a: false, x: 'Command it to fly (50-ft speed, carries 400 lb); comes when called within 1 mile.' },
    { n: 'Portable Hole', r: 'Rare', y: 'Wondrous item', a: false, x: 'Unfolds into a 10-ft-deep extradimensional pit; refold to carry.' },
    { n: 'Eyes of the Eagle', r: 'Uncommon', y: 'Wondrous item', a: true, x: 'Advantage on Perception checks that rely on sight.' },
    { n: 'Goggles of Night', r: 'Uncommon', y: 'Wondrous item', a: false, x: 'Darkvision 60 ft (or +60 ft if you already have it).' },
    { n: 'Gem of Seeing', r: 'Rare', y: 'Wondrous item', a: true, x: '3 charges; cast true seeing by peering through the gem.' },
    { n: 'Hat of Disguise', r: 'Uncommon', y: 'Wondrous item', a: true, x: 'Cast disguise self at will.' },
    { n: 'Helm of Telepathy', r: 'Uncommon', y: 'Wondrous item', a: true, x: 'Cast detect thoughts and suggestion; communicate telepathically.' },
    { n: 'Necklace of Fireballs', r: 'Rare', y: 'Wondrous item', a: false, x: 'Beads you can hurl as fireballs of varying strength.' },
    { n: 'Slippers of Spider Climbing', r: 'Uncommon', y: 'Wondrous item', a: true, x: 'Climb difficult surfaces, including ceilings, with your hands free.' },
    { n: 'Periapt of Wound Closure', r: 'Uncommon', y: 'Wondrous item', a: true, x: 'Stabilize automatically when dying; double HP from Hit Dice.' },
    { n: 'Cloak of the Manta Ray', r: 'Uncommon', y: 'Wondrous item', a: false, x: 'Breathe underwater; swim speed 60 ft while the hood is up.' },
    { n: 'Driftglobe', r: 'Uncommon', y: 'Wondrous item', a: false, x: 'Sheds light (as light or daylight); can hover and follow you.' },
    { n: 'Bag of Tricks', r: 'Uncommon', y: 'Wondrous item', a: false, x: 'Pull out a fuzzy ball and throw it to summon a random creature (3/day).' },
    { n: 'Decanter of Endless Water', r: 'Uncommon', y: 'Wondrous item', a: false, x: 'Command word produces a stream, fountain, or geyser of fresh water.' },
    { n: 'Deck of Many Things', r: 'Legendary', y: 'Wondrous item', a: false, x: 'Draw cards for wildly good or catastrophic magical effects. Extremely dangerous.' },
  ];

  const RARITY = ['Common', 'Uncommon', 'Rare', 'Very Rare', 'Legendary'];
  const RCOLOR = { Common: '#b7b7b7', Uncommon: '#5fae54', Rare: '#4a90d9', 'Very Rare': '#a566d6', Legendary: '#d9a434' };
  let built = false, rarFilter = 'all';

  function esc(s) { return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }

  function renderChips() {
    const bar = document.getElementById('item-rars'); if (!bar) return;
    bar.innerHTML = '';
    [['all', 'All']].concat(RARITY.map((r) => [r, r])).forEach(([v, label]) => {
      const b = document.createElement('button');
      b.className = 'spell-lvl' + (String(v) === String(rarFilter) ? ' on' : '');
      b.textContent = label;
      b.onclick = () => { rarFilter = v; renderChips(); apply(); };
      bar.appendChild(b);
    });
  }

  function apply() {
    const box = document.getElementById('item-content'); if (!box) return;
    const q = (document.getElementById('item-q').value || '').trim().toLowerCase();
    let list = ITEMS.slice();
    if (rarFilter !== 'all') list = list.filter((i) => i.r === rarFilter);
    if (q) list = list.filter((i) => (i.n + ' ' + i.y + ' ' + i.x).toLowerCase().includes(q));
    list.sort((a, b) => RARITY.indexOf(a.r) - RARITY.indexOf(b.r) || a.n.localeCompare(b.n));
    if (!list.length) { box.innerHTML = '<div class="rules-empty">No items match.</div>'; return; }
    box.innerHTML = list.map((i) => {
      const dm = i.x.match(/(\d+)d(\d+)(?:\s*\+\s*(\d+))?/);
      const rb = dm ? `<button class="sb-roll item-roll" data-name="${esc(i.n)}" data-n="${dm[1]}" data-die="${dm[2]}" data-mod="${dm[3] || 0}" title="Roll ${dm[0]}">🎲 ${dm[0]}</button>` : '';
      return `
      <div class="spell" style="border-left:3px solid ${RCOLOR[i.r]}">
        <div class="spell-h"><span class="spell-n">${esc(i.n)}</span><span class="spell-lv" style="color:${RCOLOR[i.r]}">${esc(i.r)}</span></div>
        <div class="spell-meta">${esc(i.y)}${i.a ? ' · requires attunement' : ''}</div>
        <div class="spell-x">${esc(i.x)} ${rb}</div>
      </div>`;
    }).join('');
  }

  // Expose for the loot generator (weighted by rarity)
  window.MAGIC_ITEMS = ITEMS;
  window.rollLootItem = function (tier) {
    // tier 1-4 caps the rarity ceiling
    const ceilings = { 1: 'Uncommon', 2: 'Rare', 3: 'Very Rare', 4: 'Legendary' };
    const cap = RARITY.indexOf(ceilings[tier] || 'Rare');
    const pool = ITEMS.filter((i) => RARITY.indexOf(i.r) <= cap);
    return pool[Math.floor(Math.random() * pool.length)];
  };

  function init() {
    if (built) return;
    const q = document.getElementById('item-q'); if (!q) return;
    built = true;
    const c = document.getElementById('item-count'); if (c) c.textContent = ITEMS.length + ' items';
    renderChips(); apply();
    q.addEventListener('input', apply);
    const box = document.getElementById('item-content');
    if (box) box.addEventListener('click', (e) => {
      const rb = e.target.closest && e.target.closest('.item-roll'); if (!rb) return;
      const n = parseInt(rb.dataset.n, 10) || 0, die = parseInt(rb.dataset.die, 10) || 0, dmod = parseInt(rb.dataset.mod, 10) || 0;
      let sum = 0; const rolls = [];
      for (let k = 0; k < n; k++) { const r = 1 + Math.floor(Math.random() * die); sum += r; rolls.push(r); }
      sum += dmod;
      if (typeof window.emitChat === 'function') window.emitChat(`💎 ${rb.dataset.name} — ${n}d${die}${dmod ? '+' + dmod : ''}: ${sum} (${rolls.join('+')}${dmod ? '+' + dmod : ''})`);
    });
  }
  if (document.readyState !== 'loading') init();
  else document.addEventListener('DOMContentLoaded', init);
})();
