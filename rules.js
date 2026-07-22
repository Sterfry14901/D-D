/* ============================================================
   5E RULES & DM GUIDE  —  D&D SRD 5.1, CC-BY-4.0
   Quick-reference in-app rules browser (search + categories).
   ============================================================ */
(function () {
  const RULES = {
    Conditions: [
      { t: 'Blinded', b: "Can't see; automatically fails checks requiring sight. Attacks against the creature have advantage; the creature's attacks have disadvantage." },
      { t: 'Charmed', b: "Can't attack the charmer or target them with harmful abilities/effects. The charmer has advantage on social checks with the creature." },
      { t: 'Deafened', b: "Can't hear; automatically fails checks requiring hearing." },
      { t: 'Frightened', b: 'Disadvantage on checks and attacks while the source of fear is in line of sight. Can\'t willingly move closer to the source.' },
      { t: 'Grappled', b: "Speed becomes 0, can't benefit from bonuses to speed. Ends if the grappler is incapacitated or the creature is moved out of reach." },
      { t: 'Incapacitated', b: "Can't take actions or reactions." },
      { t: 'Invisible', b: 'Impossible to see without special sense; heavily obscured for hiding. Attacks against it have disadvantage; its attacks have advantage.' },
      { t: 'Paralyzed', b: 'Incapacitated, can\'t move or speak. Fails STR and DEX saves. Attacks against it have advantage. Any hit within 5 ft is a critical hit.' },
      { t: 'Petrified', b: 'Transformed to stone: incapacitated, unaware, weight ×10, stops aging. Attacks have advantage; fails STR/DEX saves; resistance to all damage; immune to poison & disease.' },
      { t: 'Poisoned', b: 'Disadvantage on attack rolls and ability checks.' },
      { t: 'Prone', b: 'Can only crawl (costs extra movement) or stand (costs half speed). Disadvantage on attacks. Attacks within 5 ft have advantage; ranged attacks have disadvantage.' },
      { t: 'Restrained', b: "Speed 0. Attacks against it have advantage; its attacks have disadvantage. Disadvantage on DEX saves." },
      { t: 'Stunned', b: 'Incapacitated, can\'t move, can speak only falteringly. Fails STR and DEX saves. Attacks against it have advantage.' },
      { t: 'Unconscious', b: 'Incapacitated, can\'t move or speak, unaware, drops what it\'s holding and falls prone. Fails STR/DEX saves. Attacks have advantage; any hit within 5 ft is a critical hit.' },
      { t: 'Exhaustion', b: '1: disadv. on ability checks. 2: speed halved. 3: disadv. on attacks & saves. 4: HP max halved. 5: speed 0. 6: death. A long rest removes one level (with food & drink).' },
    ],
    'Combat Actions': [
      { t: 'Attack', b: 'Make one melee or ranged attack. Some features (Extra Attack) let you attack more than once.' },
      { t: 'Cast a Spell', b: 'Cast a spell with a casting time of 1 action. Bonus-action spells use your bonus action instead.' },
      { t: 'Dash', b: 'Gain extra movement equal to your speed for the turn (after modifiers).' },
      { t: 'Disengage', b: "Your movement doesn't provoke opportunity attacks for the rest of the turn." },
      { t: 'Dodge', b: 'Until your next turn, attacks against you have disadvantage (if you can see the attacker) and you make DEX saves with advantage. Lost if incapacitated or speed 0.' },
      { t: 'Help', b: 'Give an ally advantage on their next ability check, or on their next attack against a creature within 5 ft of you (before your next turn).' },
      { t: 'Hide', b: 'Make a Dexterity (Stealth) check. If it beats a foe\'s passive Perception and you\'re unseen, you\'re hidden.' },
      { t: 'Ready', b: 'Choose a trigger and a prepared action/movement. When the trigger occurs you may use your reaction to act. Readied spells must be held with concentration.' },
      { t: 'Search', b: 'Devote attention to finding something — a Wisdom (Perception) or Intelligence (Investigation) check.' },
      { t: 'Use an Object', b: 'Interact with a second object, or use an object that requires an action.' },
      { t: 'Grapple', b: 'Special melee attack (Attack action). Contested Athletics vs. target\'s Athletics or Acrobatics. On success the target is Grappled (speed 0).' },
      { t: 'Shove', b: 'Special melee attack. Contested Athletics vs. Athletics/Acrobatics. On success, push the target 5 ft or knock it prone.' },
      { t: 'Two-Weapon Fighting', b: 'When you Attack with a light melee weapon in one hand, use a bonus action to attack with a different light melee weapon in the other. No ability mod to the bonus damage unless negative.' },
      { t: 'Opportunity Attack', b: 'When a creature you can see leaves your reach, use your reaction to make one melee attack against it. Disengage avoids this.' },
      { t: 'Bonus Action / Reaction', b: 'One bonus action and one reaction per round, only when a feature/spell allows. Reactions reset at the start of your turn.' },
    ],
    'Movement & Cover': [
      { t: 'Speed & Movement', b: 'Move up to your speed on your turn, split before/after actions. Standing from prone costs half your speed.' },
      { t: 'Difficult Terrain', b: 'Each foot of movement costs 1 extra foot (rubble, deep snow, dense foliage, a creature\'s space, etc.).' },
      { t: 'Half Cover (+2 AC)', b: 'Target has +2 AC and +2 DEX saves. From low walls, furniture, a creature, a narrow tree trunk.' },
      { t: 'Three-Quarters Cover (+5 AC)', b: 'Target has +5 AC and +5 DEX saves. From a portcullis, arrow slit, or thick tree trunk.' },
      { t: 'Total Cover', b: "Can't be targeted directly by an attack or spell (fully concealed)." },
      { t: 'Jumping', b: 'Long jump: distance in feet equal to your STR score (with a 10-ft running start; half without). High jump: 3 + STR modifier feet (half without a running start).' },
      { t: 'Climbing / Swimming / Crawling', b: 'Each foot costs 1 extra foot (2 in difficult terrain). The DM may require an Athletics check for tricky surfaces or rough water.' },
      { t: 'Squeezing', b: 'Move into a space at least half your size: each foot costs 1 extra; disadvantage on attacks & DEX saves; attacks against you have advantage.' },
    ],
    'Resting & Healing': [
      { t: 'Short Rest', b: 'At least 1 hour of light activity. Spend Hit Dice: roll the die + your CON modifier to regain HP. Recovers some class features.' },
      { t: 'Long Rest', b: 'At least 8 hours (≤2 hours watch/light activity). Regain all HP and up to half your total Hit Dice (minimum 1). One long rest per 24 hours.' },
      { t: 'Hit Dice', b: 'You have Hit Dice equal to your level (die type by class). Spend on a short rest to heal; regain half on a long rest.' },
      { t: 'Temporary HP', b: "A buffer that absorbs damage first. Doesn't stack (take the higher). Lost on a long rest. Not restored by healing." },
      { t: 'Damage Resistance / Vulnerability', b: 'Resistance = take half damage of that type. Vulnerability = take double. Apply after other modifiers; resistance & vulnerability to the same type cancel out (only once each).' },
    ],
    'Death & Dying': [
      { t: 'Dropping to 0 HP', b: 'A creature falls unconscious and is dying (unless the damage kills it outright).' },
      { t: 'Death Saving Throws', b: 'At the start of your turn while dying, roll d20 (no modifiers). 10+ = success, 9 or less = failure. 3 successes = stable; 3 failures = dead. Nat 20 = regain 1 HP; nat 1 = two failures.' },
      { t: 'Instant Death', b: 'If remaining damage after reaching 0 HP equals or exceeds your HP maximum, you die instantly.' },
      { t: 'Stabilizing', b: 'A DC 10 Medicine check (Help action) or any healing stabilizes a dying creature (0 HP, no more death saves). A stable creature regains 1 HP after 1d4 hours.' },
      { t: 'Damage at 0 HP', b: 'Taking any damage while at 0 HP causes one death save failure (two on a critical hit or if it would be instant death).' },
    ],
    'Checks & DCs': [
      { t: 'Typical DCs', b: 'Very easy 5 · Easy 10 · Medium 15 · Hard 20 · Very hard 25 · Nearly impossible 30.' },
      { t: 'Advantage / Disadvantage', b: 'Roll 2d20, take the higher (advantage) or lower (disadvantage). Multiple sources don\'t stack; if you have both, you roll a single normal d20.' },
      { t: 'Passive Checks', b: 'Score = 10 + all modifiers. Advantage adds +5, disadvantage −5. Used for hidden things (e.g., passive Perception vs. Stealth).' },
      { t: 'Proficiency Bonus', b: 'By level: 1–4 +2 · 5–8 +3 · 9–12 +4 · 13–16 +5 · 17–20 +6. Add to attacks, saves, and skills you\'re proficient in.' },
      { t: 'Group Checks', b: 'Everyone rolls; if at least half succeed, the group succeeds.' },
      { t: 'Working Together', b: 'The Help action grants advantage when the helper could meaningfully assist.' },
    ],
    Skills: [
      { t: 'Athletics (STR)', b: 'Climbing, jumping, swimming in rough conditions, and grappling/shoving contests.' },
      { t: 'Acrobatics (DEX)', b: 'Keeping your balance, tumbling, staying on your feet on ice or a rocking deck, escaping a grapple.' },
      { t: 'Sleight of Hand (DEX)', b: 'Palming an object, planting something on someone, lifting a coin purse, manual trickery.' },
      { t: 'Stealth (DEX)', b: 'Hiding from enemies, sneaking past guards, moving without being noticed. Opposed by passive Perception.' },
      { t: 'Arcana (INT)', b: 'Recalling lore about spells, magic items, eldritch symbols, planes of existence, and magical traditions.' },
      { t: 'History (INT)', b: 'Recalling lore about historical events, legendary people, ancient kingdoms, wars, and lost civilizations.' },
      { t: 'Investigation (INT)', b: 'Deducing from clues: searching for hidden objects, finding a weak point, examining a scene of a crime.' },
      { t: 'Nature (INT)', b: 'Recalling lore about terrain, plants and animals, weather, and natural cycles.' },
      { t: 'Religion (INT)', b: 'Recalling lore about deities, rites, prayers, holy symbols, and cult practices.' },
      { t: 'Animal Handling (WIS)', b: "Calming a domesticated animal, keeping a mount from being spooked, intuiting an animal's intentions." },
      { t: 'Insight (WIS)', b: "Reading a creature's true intentions — detecting lies, predicting someone's next move from body language." },
      { t: 'Medicine (WIS)', b: 'Stabilizing a dying companion (DC 10) or diagnosing an illness.' },
      { t: 'Perception (WIS)', b: 'Spotting, hearing, or otherwise detecting something — noticing an ambush, overhearing a conversation. The most-rolled skill in the game.' },
      { t: 'Survival (WIS)', b: 'Following tracks, hunting, navigating wilderness, predicting weather, avoiding natural hazards.' },
      { t: 'Deception (CHA)', b: 'Convincingly hiding the truth — misleading, fast-talking, keeping a straight face, con jobs and disguises.' },
      { t: 'Intimidation (CHA)', b: 'Influencing through threats, hostile posture, or violence — extracting information, making a show of force.' },
      { t: 'Performance (CHA)', b: 'Delighting an audience with music, dance, acting, storytelling, or another entertainment.' },
      { t: 'Persuasion (CHA)', b: 'Influencing with tact and good nature — negotiating, requesting aid, inspiring a crowd, etiquette.' },
    ],
    'DM: Encounters': [
      { t: 'XP Thresholds per Character', b: 'Easy / Medium / Hard / Deadly by level — L1: 25/50/75/100 · L2: 50/100/150/200 · L3: 75/150/225/400 · L4: 125/250/375/500 · L5: 250/500/750/1100 · L6: 300/600/900/1400. Sum each column across the party for the party budget.' },
      { t: 'Encounter Multiplier', b: 'Multiply total monster XP by count: 1 monster ×1 · 2 ×1.5 · 3–6 ×2 · 7–10 ×2.5 · 11–14 ×3 · 15+ ×4. Compare the adjusted XP to the party thresholds. (Use next tier up for small parties, down for 6+.)' },
      { t: 'Building a Fight', b: 'Pick monsters, total their XP, apply the multiplier, and compare to your party budget. Mixing a "boss" with minions raises effective difficulty via the multiplier.' },
      { t: 'Adventuring Day', b: 'A party can handle roughly 6–8 medium/hard encounters between long rests (about 2 short rests). Track their resource drain, not just single fights.' },
      { t: 'Awarding XP', b: 'Divide total monster XP (unmodified) among the party. Or use milestone leveling — advance when the story hits key beats.' },
    ],
    'DM: Environment': [
      { t: 'Falling', b: '1d6 bludgeoning per 10 ft fallen (max 20d6), and the creature lands prone unless it avoids the damage.' },
      { t: 'Suffocating', b: 'Hold breath for 1 + CON modifier minutes (min 30 sec). Then survive rounds equal to CON modifier (min 1); at 0, drop to 0 HP and start dying.' },
      { t: 'Vision & Light', b: 'Lightly obscured (dim light, fog): disadvantage on Perception. Heavily obscured (darkness): effectively blinded into that area. Darkvision sees dim as bright and darkness as dim (shades of gray).' },
      { t: 'Hiding & Being Unseen', b: 'You can\'t hide from a creature that can see you clearly. An unseen attacker has advantage; being unseen doesn\'t hide the noise of an attack.' },
      { t: 'Object AC & HP (guide)', b: 'Fragile/resilient and size set an object\'s AC (≈11–19) and HP. Objects are immune to poison & psychic; usually fail on massive damage.' },
    ],
    'DM: Traps & Hazards': [
      { t: 'Trap Basics', b: 'Spotting a trap is usually Perception (or Investigation of its mechanism); disabling is often thieves\' tools or a clever workaround. Typical DCs run 10 (obvious) to 20 (well hidden). Trap attack bonuses run +3 to +8 and save DCs 10–20, scaling with how dangerous the trap is meant to be.' },
      { t: 'Trap Damage by Level', b: 'Setback / Dangerous / Deadly per tier — Lv 1–4: 1d10 / 2d10 / 4d10 · Lv 5–10: 2d10 / 4d10 / 10d10 · Lv 11–16: 4d10 / 10d10 / 18d10 · Lv 17–20: 10d10 / 18d10 / 24d10.' },
      { t: 'Sample Traps', b: 'Falling net (DC 10 STR to escape being restrained) · Hidden pit (falling damage; spiked pits add +2d10 piercing) · Poison darts (+8 atk, 1d4 piercing + DC 15 CON or 2d10 poison) · Rolling sphere (DC 15 DEX save or 10d10 bludgeoning) · Collapsing roof (triggered by a tripwire; heavy bludgeoning in the area).' },
      { t: 'Poison Basics', b: 'Four delivery types: Contact (touch), Ingested (eaten or drunk), Inhaled (breathed in), Injury (enters through a wound). Most call for a CON save vs. the poison\'s DC. Basic poison (vial, 100 gp): coats one weapon or 3 pieces of ammo for 1 minute; a hit forces a DC 10 CON save or 1d4 poison damage.' },
      { t: 'Sample Poisons', b: 'Serpent venom (injury, DC 11, 3d6 poison, half on save) · Drow poison (injury, DC 13 or poisoned 1 hr; fail by 5+ also falls unconscious) · Assassin\'s blood (ingested, DC 10, 1d12 poison + poisoned 24 hr) · Purple worm poison (injury, DC 19, 12d6 poison, half on save).' },
      { t: 'Diseases (samples)', b: 'Sewer plague (from filth-tainted wounds; DC 11 CON after 1d4 days — exhaustion, and rest restores less) · Sight rot (from fouled water; vision blurs, then blinds; cured by a rare herb salve) · Cackle fever (stress triggers fits of mad laughter; DC 13 CON or 5d10 psychic and incapacitated during a fit).' },
      { t: 'Madness (optional rule)', b: 'Short-term (1d10 minutes), long-term (1d10 × 10 hours), or indefinite (lasts until cured) effects from cosmic horrors, curses, or trauma. Calm emotions can suppress madness; lesser restoration ends short/long-term, and greater restoration or remove curse handles indefinite madness.' },
    ],
    'Travel & Mounts': [
      { t: 'Travel Pace', b: 'Fast: 400 ft/min, 4 mph, 30 mi/day (\u22125 passive Perception). Normal: 300 ft/min, 3 mph, 24 mi/day. Slow: 200 ft/min, 2 mph, 18 mi/day (can move stealthily).' },
      { t: 'Forced March', b: 'Travel beyond 8 hours a day: at the end of each extra hour, CON save DC 10 + 1 per hour past 8, or gain one level of exhaustion.' },
      { t: 'Food & Water', b: 'Need 1 lb of food per day (half rations count as half a day). You can go without food for 3 + CON modifier days; after that, one exhaustion level per day. Water: 1 gallon/day (2 in hot weather); half rations force a DC 15 CON save or exhaustion; none means automatic exhaustion.' },
      { t: 'Mounted Combat', b: 'Mounting or dismounting costs half your speed. A controlled mount moves on your initiative and can only Dash, Disengage, or Dodge. If you\'re knocked prone, or the mount is moved against its will, make a DC 10 DEX save or land prone within 5 ft. Independent mounts keep their own initiative and act freely.' },
      { t: 'Underwater Combat', b: 'Melee attacks have disadvantage unless using a dagger, javelin, shortsword, spear, or trident. Ranged weapon attacks auto-miss beyond normal range and have disadvantage within it (crossbows, nets, and thrown javelin-like weapons excepted). Creatures with a swim speed ignore these penalties. Fully immersed creatures have resistance to fire damage.' },
    ],
    'Spellcasting': [
      { t: 'Concentration', b: 'Some spells require concentration. Taking damage forces a CON save (DC 10 or half the damage, whichever is higher) or you lose the spell. Only one concentration spell at a time; casting another ends the first.' },
      { t: 'Spell Slots', b: 'Casting a spell expends a slot of its level or higher. Cantrips are free. Regain slots on a long rest (Warlocks on a short rest).' },
      { t: 'Components (V/S/M)', b: 'Verbal (speech), Somatic (a free hand), Material (an item or a focus/component pouch). Costly components must be provided; those consumed are used up.' },
      { t: 'Ritual Casting', b: 'A spell with the ritual tag can be cast as a ritual (+10 minutes) without expending a slot, if the caster has the ritual feature.' },
      { t: 'Attacks & Saves', b: 'Spell attack bonus = proficiency + spellcasting mod. Save DC = 8 + proficiency + spellcasting mod.' },
    ],
  };

  let rulesBuilt = false;
  let activeCat = null;

  function esc(s) { return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }

  function renderCats() {
    const bar = document.getElementById('rules-cats'); if (!bar) return;
    bar.innerHTML = '';
    Object.keys(RULES).forEach((cat) => {
      const b = document.createElement('button');
      b.className = 'rules-cat' + (cat === activeCat ? ' on' : '');
      b.textContent = cat;
      b.onclick = () => { activeCat = cat; document.getElementById('rules-q').value = ''; renderCats(); renderList(RULES[cat], cat); };
      bar.appendChild(b);
    });
  }

  function renderList(items, heading) {
    const box = document.getElementById('rules-content'); if (!box) return;
    if (!items.length) { box.innerHTML = '<div class="rules-empty">No matching rules.</div>'; return; }
    box.innerHTML = (heading ? `<div class="rules-heading">${esc(heading)}</div>` : '') +
      items.map((r) => `<div class="rule"><div class="rule-t">${esc(r.t)}${r._cat ? `<span class="rule-cat">${esc(r._cat)}</span>` : ''}</div><div class="rule-b">${esc(r.b)}</div></div>`).join('');
  }

  function search(q) {
    q = q.trim().toLowerCase();
    if (!q) { activeCat = activeCat || Object.keys(RULES)[0]; renderCats(); renderList(RULES[activeCat], activeCat); return; }
    activeCat = null; renderCats();
    const hits = [];
    Object.entries(RULES).forEach(([cat, arr]) => arr.forEach((r) => {
      if ((r.t + ' ' + r.b).toLowerCase().includes(q)) hits.push(Object.assign({ _cat: cat }, r));
    }));
    renderList(hits, `Results for “${q}” (${hits.length})`);
  }

  function initRules() {
    if (rulesBuilt) return;
    const q = document.getElementById('rules-q'); if (!q) return;
    rulesBuilt = true;
    activeCat = Object.keys(RULES)[0];
    renderCats();
    renderList(RULES[activeCat], activeCat);
    q.addEventListener('input', () => search(q.value));
  }

  if (document.readyState !== 'loading') initRules();
  else document.addEventListener('DOMContentLoaded', initRules);
})();
