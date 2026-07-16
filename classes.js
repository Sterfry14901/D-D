/* ============================================================
   CLASSES · SPECIES · BACKGROUNDS  (SRD 5.2.1, CC-BY-4.0)
   This work includes material from the System Reference Document 5.2.1
   ("SRD 5.2.1") by Wizards of the Coast LLC, available at
   https://www.dndbeyond.com/srd — licensed under CC-BY-4.0
   (https://creativecommons.org/licenses/by/4.0/legalcode).
   Core traits below are quoted from the SRD; feature summaries are
   original wording. Renders into #chars-body with search + subtabs.
   ============================================================ */
(function () {
  const CLASSES = [
    { n: 'Barbarian', primary: 'Strength', hd: 'd12', saves: 'Strength & Constitution',
      skills: 'Choose 2: Animal Handling, Athletics, Intimidation, Nature, Perception, Survival',
      weapons: 'Simple & Martial', armor: 'Light & Medium armor, Shields', tools: '—',
      equip: '(A) Greataxe, 4 Handaxes, Explorer’s Pack, 15 GP; or (B) 75 GP',
      sig: 'Rage — enter a primal fury as a Bonus Action for bonus melee damage, resistance to bludgeoning/piercing/slashing, and advantage on Strength checks & saves.' },
    { n: 'Bard', primary: 'Charisma', hd: 'd8', saves: 'Dexterity & Charisma',
      skills: 'Choose any 3 skills', weapons: 'Simple', armor: 'Light armor', tools: '3 Musical Instruments',
      equip: '(A) Leather Armor, 2 Daggers, an Instrument, Entertainer’s Pack, 19 GP; or (B) 90 GP',
      sig: 'Bardic Inspiration — give an ally a d6 to add to an attack, check, or save. Full spellcaster (Charisma).' },
    { n: 'Cleric', primary: 'Wisdom', hd: 'd8', saves: 'Wisdom & Charisma',
      skills: 'Choose 2: History, Insight, Medicine, Persuasion, Religion',
      weapons: 'Simple', armor: 'Light & Medium armor, Shields', tools: '—',
      equip: '(A) Chain Shirt, Shield, Mace, Holy Symbol, Priest’s Pack, 7 GP; or (B) 110 GP',
      sig: 'Divine spellcasting (Wisdom) + a Divine Order (Protector or Thaumaturge). Channels the power of a deity.' },
    { n: 'Druid', primary: 'Wisdom', hd: 'd8', saves: 'Intelligence & Wisdom',
      skills: 'Choose 2: Animal Handling, Arcana, Insight, Medicine, Nature, Perception, Religion, Survival',
      weapons: 'Simple', armor: 'Light armor, Shields (non-metal)', tools: 'Herbalism Kit',
      equip: '(A) Leather Armor, Shield, Sickle, Druidic Focus, Explorer’s Pack, Herbalism Kit, 9 GP; or (B) 50 GP',
      sig: 'Druidic + Primal Order. Prepares nature spells (Wisdom) and later takes Wild Shape to become beasts.' },
    { n: 'Fighter', primary: 'Strength or Dexterity', hd: 'd10', saves: 'Strength & Constitution',
      skills: 'Choose 2: Acrobatics, Animal Handling, Athletics, History, Insight, Intimidation, Persuasion, Perception, Survival',
      weapons: 'Simple & Martial', armor: 'Light, Medium, Heavy armor, Shields', tools: '—',
      equip: '(A) Chain Mail, Greatsword, Flail, 8 Javelins, Dungeoneer’s Pack, 4 GP; or (B) Studded Leather, Scimitar, Shortsword, Longbow, 20 Arrows, Quiver, Pack, 11 GP',
      sig: 'Fighting Style, Second Wind (regain HP as a Bonus Action), and Weapon Mastery. The master of martial combat.' },
    { n: 'Monk', primary: 'Dexterity & Wisdom', hd: 'd8', saves: 'Strength & Dexterity',
      skills: 'Choose 2: Acrobatics, Athletics, History, Insight, Religion, Stealth',
      weapons: 'Simple & Martial weapons with the Light property', armor: 'None', tools: 'One Artisan’s Tool or Instrument',
      equip: '(A) Spear, 5 Daggers, Artisan’s Tools/Instrument, Explorer’s Pack, 11 GP; or (B) 50 GP',
      sig: 'Martial Arts — unarmed strikes scale with a Martial Arts die and use Dexterity; later powered by Focus (ki).' },
    { n: 'Paladin', primary: 'Strength & Charisma', hd: 'd10', saves: 'Wisdom & Charisma',
      skills: 'Choose 2: Athletics, Insight, Intimidation, Medicine, Persuasion, Religion',
      weapons: 'Simple & Martial', armor: 'Light, Medium, Heavy armor, Shields', tools: '—',
      equip: '(A) Chain Mail, Shield, Longsword, 6 Javelins, Holy Symbol, Priest’s Pack, 9 GP; or (B) 150 GP',
      sig: 'Lay On Hands (a pool of healing) and Spellcasting (Charisma). A holy warrior bound by an oath.' },
    { n: 'Ranger', primary: 'Dexterity & Wisdom', hd: 'd10', saves: 'Strength & Dexterity',
      skills: 'Choose 3: Animal Handling, Athletics, Insight, Investigation, Nature, Perception, Stealth, Survival',
      weapons: 'Simple & Martial', armor: 'Light & Medium armor, Shields', tools: '—',
      equip: '(A) Studded Leather, Scimitar, Shortsword, Longbow, 20 Arrows, Quiver, Druidic Focus, Explorer’s Pack, 7 GP; or (B) 150 GP',
      sig: 'Favored Enemy — always have Hunter’s Mark prepared and cast it a few times per day. Half-caster (Wisdom).' },
    { n: 'Rogue', primary: 'Dexterity', hd: 'd8', saves: 'Dexterity & Intelligence',
      skills: 'Choose 4: Acrobatics, Athletics, Deception, Insight, Intimidation, Investigation, Perception, Persuasion, Sleight of Hand, Stealth',
      weapons: 'Simple & Martial weapons with Finesse or Light', armor: 'Light armor', tools: 'Thieves’ Tools',
      equip: '(A) Leather Armor, 2 Daggers, Shortsword, Shortbow, 20 Arrows, Quiver, Thieves’ Tools, Burglar’s Pack, 8 GP; or (B) 100 GP',
      sig: 'Sneak Attack — extra damage when you have advantage or an ally is near, plus Expertise and Thieves’ Cant.' },
    { n: 'Sorcerer', primary: 'Charisma', hd: 'd6', saves: 'Constitution & Charisma',
      skills: 'Choose 2: Arcana, Deception, Insight, Intimidation, Persuasion, Religion',
      weapons: 'Simple', armor: 'None', tools: '—',
      equip: '(A) Spear, 2 Daggers, Arcane Focus (crystal), Dungeoneer’s Pack, 28 GP; or (B) 50 GP',
      sig: 'Innate Sorcery — an inborn wellspring of magic (Charisma) plus a Sorcerous Origin; later bends spells with Metamagic.' },
    { n: 'Warlock', primary: 'Charisma', hd: 'd8', saves: 'Wisdom & Charisma',
      skills: 'Choose 2: Arcana, Deception, History, Intimidation, Investigation, Nature, Religion',
      weapons: 'Simple', armor: 'Light armor', tools: '—',
      equip: '(A) Leather Armor, Sickle, 2 Daggers, Arcane Focus (orb), Book of occult lore, Scholar’s Pack, 15 GP; or (B) 100 GP',
      sig: 'Pact Magic (Charisma) drawn from an otherworldly patron, plus Eldritch Invocations that customize your power.' },
    { n: 'Wizard', primary: 'Intelligence', hd: 'd6', saves: 'Intelligence & Wisdom',
      skills: 'Choose 2: Arcana, History, Insight, Investigation, Medicine, Nature, Religion',
      weapons: 'Simple', armor: 'None', tools: '—',
      equip: '(A) 2 Daggers, Arcane Focus (quarterstaff), Robe, Spellbook, Scholar’s Pack, 5 GP; or (B) 55 GP',
      sig: 'Spellbook & Ritual Adept — prepare Intelligence spells from a growing book and cast rituals without a slot.' },
  ];

  const SPECIES = [
    { n: 'Dragonborn', type: 'Humanoid', size: 'Medium', speed: '30 ft',
      traits: 'Draconic Ancestry; Breath Weapon (a cone/line dealing your ancestry’s damage, DEX save); Damage Resistance to your ancestry’s type; Darkvision 60 ft.' },
    { n: 'Dwarf', type: 'Humanoid', size: 'Medium', speed: '30 ft',
      traits: 'Darkvision 120 ft; Dwarven Resilience (advantage vs. Poisoned, resistance to poison); Dwarven Toughness (+1 HP/level); Stonecunning (Tremorsense on stone).' },
    { n: 'Elf', type: 'Humanoid', size: 'Medium', speed: '30 ft',
      traits: 'Darkvision 60 ft; Elven Lineage (Drow / High / Wood, granting cantrips & extras); Fey Ancestry (advantage vs. Charmed); Keen Senses; Trance (4-hour Long Rest).' },
    { n: 'Gnome', type: 'Humanoid', size: 'Small', speed: '30 ft',
      traits: 'Darkvision 60 ft; Gnomish Cunning (advantage on INT/WIS/CHA saves); Gnomish Lineage (Forest or Rock) granting minor magic.' },
    { n: 'Goliath', type: 'Humanoid', size: 'Medium', speed: '35 ft',
      traits: 'Giant Ancestry (a supernatural boon from a giant kind); Large Form (briefly grow Large); Powerful Build (count as one size larger for carrying).' },
    { n: 'Halfling', type: 'Humanoid', size: 'Small', speed: '30 ft',
      traits: 'Brave (advantage vs. Frightened); Halfling Nimbleness (move through larger creatures’ spaces); Luck (reroll a natural 1 on d20 tests); Naturally Stealthy.' },
    { n: 'Human', type: 'Humanoid', size: 'Small or Medium', speed: '30 ft',
      traits: 'Resourceful (Heroic Inspiration each Long Rest); Skillful (one extra skill proficiency); Versatile (an Origin feat of your choice).' },
    { n: 'Orc', type: 'Humanoid', size: 'Medium', speed: '30 ft',
      traits: 'Adrenaline Rush (Dash as a Bonus Action and gain temp HP); Darkvision 120 ft; Relentless Endurance (drop to 1 HP instead of 0, once per Long Rest).' },
    { n: 'Tiefling', type: 'Humanoid', size: 'Small or Medium', speed: '30 ft',
      traits: 'Darkvision 60 ft; Fiendish Legacy (Abyssal / Chthonic / Infernal — resistance + scaling spells); Otherworldly Presence (Thaumaturgy cantrip).' },
    { n: 'Half-Elf', type: 'Humanoid (SRD 5.1)', size: 'Medium', speed: '30 ft',
      traits: 'Darkvision 60 ft; Fey Ancestry (advantage vs. Charmed, immune to magical sleep); Skill Versatility (two extra skill proficiencies); one extra language.' },
    { n: 'Half-Orc', type: 'Humanoid (SRD 5.1)', size: 'Medium', speed: '30 ft',
      traits: 'Darkvision 60 ft; Menacing (Intimidation proficiency); Relentless Endurance (drop to 1 HP instead of 0, once per Long Rest); Savage Attacks (extra crit die).' },
  ];

  const BACKGROUNDS = [
    { n: 'Acolyte', abilities: 'Intelligence, Wisdom, Charisma', feat: 'Magic Initiate (Cleric)',
      skills: 'Insight & Religion', tool: 'Calligrapher’s Supplies' },
    { n: 'Criminal', abilities: 'Dexterity, Constitution, Intelligence', feat: 'Alert',
      skills: 'Sleight of Hand & Stealth', tool: 'Thieves’ Tools' },
    { n: 'Sage', abilities: 'Constitution, Intelligence, Wisdom', feat: 'Magic Initiate (Wizard)',
      skills: 'Arcana & History', tool: 'Calligrapher’s Supplies' },
    { n: 'Soldier', abilities: 'Strength, Dexterity, Constitution', feat: 'Savage Attacker',
      skills: 'Athletics & Intimidation', tool: 'Gaming Set' },
    { n: 'Artisan', abilities: 'Strength, Dexterity, Intelligence', feat: 'Crafter',
      skills: 'Investigation & Persuasion', tool: 'Artisan’s Tools (your craft)' },
    { n: 'Charlatan', abilities: 'Dexterity, Constitution, Charisma', feat: 'Skilled',
      skills: 'Deception & Sleight of Hand', tool: 'Forgery Kit' },
    { n: 'Entertainer', abilities: 'Strength, Dexterity, Charisma', feat: 'Musician',
      skills: 'Acrobatics & Performance', tool: 'Musical Instrument' },
    { n: 'Farmer', abilities: 'Strength, Constitution, Wisdom', feat: 'Tough',
      skills: 'Animal Handling & Nature', tool: 'Carpenter’s Tools' },
    { n: 'Guard', abilities: 'Strength, Intelligence, Wisdom', feat: 'Alert',
      skills: 'Athletics & Perception', tool: 'Gaming Set' },
    { n: 'Guide', abilities: 'Dexterity, Constitution, Wisdom', feat: 'Magic Initiate (Druid)',
      skills: 'Stealth & Survival', tool: 'Cartographer’s Tools' },
    { n: 'Hermit', abilities: 'Constitution, Wisdom, Charisma', feat: 'Healer',
      skills: 'Medicine & Religion', tool: 'Herbalism Kit' },
    { n: 'Merchant', abilities: 'Constitution, Intelligence, Charisma', feat: 'Lucky',
      skills: 'Animal Handling & Persuasion', tool: 'Navigator’s Tools' },
    { n: 'Noble', abilities: 'Strength, Intelligence, Charisma', feat: 'Skilled',
      skills: 'History & Persuasion', tool: 'Gaming Set' },
    { n: 'Sailor', abilities: 'Strength, Dexterity, Wisdom', feat: 'Tavern Brawler',
      skills: 'Acrobatics & Perception', tool: 'Navigator’s Tools' },
    { n: 'Scribe', abilities: 'Dexterity, Intelligence, Wisdom', feat: 'Skilled',
      skills: 'Investigation & Perception', tool: 'Calligrapher’s Supplies' },
    { n: 'Wayfarer', abilities: 'Dexterity, Wisdom, Charisma', feat: 'Lucky',
      skills: 'Insight & Stealth', tool: 'Thieves’ Tools' },
  ];

  function esc(s) { return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }

  let sub = 'classes', q = '';

  function classCard(c) {
    return `<div class="ch-card">
      <div class="ch-name">${esc(c.n)}</div>
      <div class="ch-grid">
        <div><span>Primary</span>${esc(c.primary)}</div>
        <div><span>Hit Die</span>${esc(c.hd)}</div>
        <div><span>Saves</span>${esc(c.saves)}</div>
        <div><span>Armor</span>${esc(c.armor)}</div>
        <div><span>Weapons</span>${esc(c.weapons)}</div>
        <div><span>Tools</span>${esc(c.tools)}</div>
      </div>
      <div class="ch-p"><b>Skills.</b> ${esc(c.skills)}</div>
      <div class="ch-p"><b>Starting Equipment.</b> ${esc(c.equip)}</div>
      <div class="ch-sig">${esc(c.sig)}</div>
    </div>`;
  }
  function spCard(s) {
    return `<div class="ch-card">
      <div class="ch-name">${esc(s.n)}</div>
      <div class="ch-grid">
        <div><span>Type</span>${esc(s.type)}</div>
        <div><span>Size</span>${esc(s.size)}</div>
        <div><span>Speed</span>${esc(s.speed)}</div>
      </div>
      <div class="ch-p"><b>Traits.</b> ${esc(s.traits)}</div>
    </div>`;
  }
  function bgCard(b) {
    return `<div class="ch-card">
      <div class="ch-name">${esc(b.n)}</div>
      <div class="ch-grid">
        <div><span>Ability Scores</span>${esc(b.abilities)}</div>
        <div><span>Origin Feat</span>${esc(b.feat)}</div>
        <div><span>Skills</span>${esc(b.skills)}</div>
        <div><span>Tool</span>${esc(b.tool)}</div>
      </div>
    </div>`;
  }

  function render() {
    const body = document.getElementById('chars-body'); if (!body) return;
    const ql = q.trim().toLowerCase();
    let list, cards, count;
    if (sub === 'species') {
      list = SPECIES.filter((s) => !ql || (s.n + ' ' + s.traits).toLowerCase().includes(ql));
      cards = list.map(spCard).join(''); count = `${list.length} species`;
    } else if (sub === 'backgrounds') {
      list = BACKGROUNDS.filter((b) => !ql || (b.n + ' ' + b.abilities + ' ' + b.feat + ' ' + b.skills).toLowerCase().includes(ql));
      cards = list.map(bgCard).join(''); count = `${list.length} backgrounds`;
    } else {
      list = CLASSES.filter((c) => !ql || (c.n + ' ' + c.primary + ' ' + c.skills + ' ' + c.sig).toLowerCase().includes(ql));
      cards = list.map(classCard).join(''); count = `${list.length} classes`;
    }
    body.innerHTML =
      `<div class="ch-subs">
        <button data-sub="classes" class="${sub === 'classes' ? 'active' : ''}">Classes</button>
        <button data-sub="species" class="${sub === 'species' ? 'active' : ''}">Species</button>
        <button data-sub="backgrounds" class="${sub === 'backgrounds' ? 'active' : ''}">Backgrounds</button>
      </div>
      <div class="rules-search"><input id="ch-q" type="text" placeholder="Search classes, species, backgrounds…" value="${esc(q)}" /></div>
      <div class="rules-content">${cards || '<div class="sb-none">No matches.</div>'}</div>
      <div class="rules-foot">${count} · SRD 5.2.1 · CC-BY-4.0</div>`;
    body.querySelectorAll('.ch-subs button').forEach((b) => { b.onclick = () => { sub = b.dataset.sub; render(); }; });
    const inp = document.getElementById('ch-q');
    if (inp) { inp.oninput = () => { q = inp.value; const pos = inp.selectionStart; render(); const n = document.getElementById('ch-q'); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch {} } }; }
  }

  function init() { if (document.getElementById('chars-body')) render(); }
  if (document.readyState !== 'loading') init();
  else document.addEventListener('DOMContentLoaded', init);

  /* ---- Machine-readable SRD data for character creation (window.SRD) ---- */
  // SRD weapon stats for the starting kits: die, damage type, finesse?, ranged?
  const WEAPONS = {
    Greataxe:   { die: '1d12', type: 'slashing' },
    Handaxe:    { die: '1d6',  type: 'slashing', thrown: '20/60' },
    Dagger:     { die: '1d4',  type: 'piercing', fin: true, thrown: '20/60' },
    Mace:       { die: '1d6',  type: 'bludgeoning' },
    Sickle:     { die: '1d4',  type: 'slashing' },
    Quarterstaff:{ die: '1d6', type: 'bludgeoning' },
    Greatsword: { die: '2d6',  type: 'slashing' },
    Flail:      { die: '1d8',  type: 'bludgeoning' },
    Javelin:    { die: '1d6',  type: 'piercing', thrown: '30/120' },
    Spear:      { die: '1d6',  type: 'piercing', thrown: '20/60' },
    Scimitar:   { die: '1d6',  type: 'slashing', fin: true },
    Shortsword: { die: '1d6',  type: 'piercing', fin: true },
    Longsword:  { die: '1d8',  type: 'slashing' },
    Longbow:    { die: '1d8',  type: 'piercing', rng: '150/600' },
    Shortbow:   { die: '1d6',  type: 'piercing', rng: '80/320' },
    'Unarmed Strike': { die: '1d6', type: 'bludgeoning', fin: true },
  };
  // Weapons found in each class's starting kit (option A)
  const CLASS_WEAPONS = {
    Barbarian: ['Greataxe', 'Handaxe'],
    Bard: ['Dagger'],
    Cleric: ['Mace'],
    Druid: ['Sickle', 'Quarterstaff'],
    Fighter: ['Greatsword', 'Flail', 'Javelin'],
    Monk: ['Spear', 'Dagger', 'Unarmed Strike'],
    Paladin: ['Longsword', 'Javelin'],
    Ranger: ['Scimitar', 'Shortsword', 'Longbow'],
    Rogue: ['Dagger', 'Shortsword', 'Shortbow'],
    Sorcerer: ['Spear', 'Dagger'],
    Warlock: ['Sickle', 'Dagger'],
    Wizard: ['Dagger'],
  };
  // Class token themes: signature color + emoji for the battle map
  const CLASS_THEME = {
    Barbarian: ['#c15b36', '🪓'], Bard: ['#ab6dac', '🎶'], Cleric: ['#c9a441', '🙏'],
    Druid: ['#7a853b', '🌿'], Fighter: ['#8a5a42', '⚔️'], Monk: ['#51a5c5', '👊'],
    Paladin: ['#b59e54', '🛡️'], Ranger: ['#507f62', '🏹'], Rogue: ['#5c5e57', '🗡️'],
    Sorcerer: ['#992e2e', '🔥'], Warlock: ['#7b469b', '👁️'], Wizard: ['#2a50a1', '🧙'],
  };
  // Level-1 spellcasting (SRD 5.2.1): [first-level slots, casting ability]
  const CLASS_CASTING = {
    Bard: [2, 'Charisma'], Cleric: [2, 'Wisdom'], Druid: [2, 'Wisdom'],
    Paladin: [2, 'Charisma'], Ranger: [2, 'Wisdom'], Sorcerer: [2, 'Charisma'],
    Warlock: [1, 'Charisma (Pact Magic — slots refresh on a Short Rest)'], Wizard: [2, 'Intelligence'],
  };
  const ABIL_KEY = { strength: 'str', dexterity: 'dex', constitution: 'con', intelligence: 'int', wisdom: 'wis', charisma: 'cha' };
  function saveKeys(text) {
    return String(text).toLowerCase().split(/[&,]| and | or /).map((s) => ABIL_KEY[s.trim()]).filter(Boolean);
  }
  window.SRD = { classes: {}, species: {}, backgrounds: {} };
  CLASSES.forEach((c) => {
    window.SRD.classes[c.n] = {
      hd: parseInt(String(c.hd).replace('d', ''), 10) || 8,
      prim: saveKeys(c.primary),
      saves: saveKeys(c.saves),
      skills: c.skills, weapons: c.weapons, armor: c.armor, tools: c.tools,
      equipA: String(c.equip).split(/;\s*or\s*|\s*or \(B\)/i)[0].replace(/^\(A\)\s*/, '').trim(),
      sig: c.sig,
      atk: CLASS_WEAPONS[c.n] || [],
      color: (CLASS_THEME[c.n] || [])[0] || null,
      emoji: (CLASS_THEME[c.n] || [])[1] || '',
      slots1: (CLASS_CASTING[c.n] || [0])[0],
      castAbil: (CLASS_CASTING[c.n] || [])[1] || null,
    };
  });
  window.SRD.weapons = WEAPONS;
  SPECIES.forEach((s) => {
    window.SRD.species[s.n] = { speed: parseInt(s.speed, 10) || 30, size: s.size, traits: s.traits };
  });
  BACKGROUNDS.forEach((b) => {
    window.SRD.backgrounds[b.n] = {
      skills: String(b.skills).split(/\s*&\s*|\s*,\s*/).map((x) => x.trim()).filter(Boolean),
      feat: b.feat, abilities: b.abilities, tool: b.tool,
    };
  });

  // Compact per-level feature summaries (SRD 5.2.1). Universal extras handled in the
  // level-up wizard: ASI at 4/8/12/16 (+Fighter 6/14, Rogue 10), Epic Boon at 19.
  const LEVEL_FEATURES = {
    Barbarian: { 2: 'Reckless Attack · Danger Sense', 3: 'Subclass choice · Primal Knowledge', 5: 'Extra Attack · Fast Movement', 7: 'Feral Instinct · Instinctive Pounce', 9: 'Brutal Strike', 11: 'Relentless Rage', 13: 'Improved Brutal Strike', 15: 'Persistent Rage', 17: 'Improved Brutal Strike (2 dice)', 18: 'Indomitable Might', 20: 'Primal Champion (+4 STR & CON)' },
    Bard: { 2: 'Expertise · Jack of All Trades', 3: 'Subclass choice', 5: 'Font of Inspiration', 7: 'Countercharm', 9: 'Expertise (2 more skills)', 10: 'Magical Secrets', 18: 'Superior Inspiration', 20: 'Words of Creation' },
    Cleric: { 2: 'Channel Divinity', 3: 'Subclass choice', 5: 'Sear Undead', 7: 'Blessed Strikes', 10: 'Divine Intervention', 14: 'Improved Blessed Strikes', 20: 'Greater Divine Intervention' },
    Druid: { 2: 'Wild Shape · Wild Companion', 3: 'Subclass choice', 5: 'Wild Resurgence', 7: 'Elemental Fury', 15: 'Improved Elemental Fury', 18: 'Beast Spells', 20: 'Archdruid' },
    Fighter: { 2: 'Action Surge · Tactical Mind', 3: 'Subclass choice', 5: 'Extra Attack · Tactical Shift', 9: 'Indomitable · Tactical Master', 11: 'Two Extra Attacks', 13: 'Indomitable (2) · Studied Attacks', 17: 'Action Surge (2) · Indomitable (3)', 20: 'Three Extra Attacks' },
    Monk: { 2: "Monk's Focus · Unarmored Movement", 3: 'Subclass choice · Deflect Attacks', 4: 'Slow Fall', 5: 'Extra Attack · Stunning Strike', 6: 'Empowered Strikes', 7: 'Evasion', 9: 'Acrobatic Movement', 10: 'Heightened Focus · Self-Restoration', 13: 'Deflect Energy', 14: 'Disciplined Survivor', 15: 'Perfect Focus', 18: 'Superior Defense', 20: 'Body and Mind (+4 DEX & WIS)' },
    Paladin: { 2: "Fighting Style · Paladin's Smite", 3: 'Subclass choice · Channel Divinity', 5: 'Extra Attack · Faithful Steed', 6: 'Aura of Protection', 9: 'Abjure Foes', 10: 'Aura of Courage', 11: 'Radiant Strikes', 14: 'Restoring Touch', 18: 'Aura Expansion' },
    Ranger: { 2: 'Deft Explorer · Fighting Style', 3: 'Subclass choice', 5: 'Extra Attack', 6: 'Roving', 9: 'Expertise', 10: 'Tireless', 13: 'Relentless Hunter', 14: "Nature's Veil", 17: 'Precise Hunter', 18: 'Feral Senses', 20: 'Foe Slayer' },
    Rogue: { 2: 'Cunning Action', 3: 'Subclass choice · Steady Aim', 5: 'Cunning Strike · Uncanny Dodge', 7: 'Evasion · Reliable Talent', 11: 'Improved Cunning Strike', 14: 'Devious Strikes', 15: 'Slippery Mind', 18: 'Elusive', 20: 'Stroke of Luck' },
    Sorcerer: { 2: 'Font of Magic · Metamagic', 3: 'Subclass choice', 5: 'Sorcerous Restoration', 7: 'Sorcery Incarnate', 20: 'Arcane Apotheosis' },
    Warlock: { 2: 'Magical Cunning', 3: 'Subclass choice · Pact Boon', 9: 'Contact Patron', 11: 'Mystic Arcanum (6th-level spell)', 13: 'Mystic Arcanum (7th)', 15: 'Mystic Arcanum (8th)', 17: 'Mystic Arcanum (9th)', 20: 'Eldritch Master' },
    Wizard: { 2: 'Scholar', 3: 'Subclass choice', 5: 'Memorize Spell', 18: 'Spell Mastery', 20: 'Signature Spells' },
  };
  // Spell slot progressions (SRD): slots per spell level, indexed by character level.
  const FULL_SLOTS = { 1: [2], 2: [3], 3: [4, 2], 4: [4, 3], 5: [4, 3, 2], 6: [4, 3, 3], 7: [4, 3, 3, 1], 8: [4, 3, 3, 2], 9: [4, 3, 3, 3, 1], 10: [4, 3, 3, 3, 2], 11: [4, 3, 3, 3, 2, 1], 12: [4, 3, 3, 3, 2, 1], 13: [4, 3, 3, 3, 2, 1, 1], 14: [4, 3, 3, 3, 2, 1, 1], 15: [4, 3, 3, 3, 2, 1, 1, 1], 16: [4, 3, 3, 3, 2, 1, 1, 1], 17: [4, 3, 3, 3, 2, 1, 1, 1, 1], 18: [4, 3, 3, 3, 3, 1, 1, 1, 1], 19: [4, 3, 3, 3, 3, 2, 1, 1, 1], 20: [4, 3, 3, 3, 3, 2, 2, 1, 1] };
  const HALF_SLOTS = { 1: [2], 2: [2], 3: [3], 4: [3], 5: [4, 2], 6: [4, 2], 7: [4, 3], 8: [4, 3], 9: [4, 3, 2], 10: [4, 3, 2], 11: [4, 3, 3], 12: [4, 3, 3], 13: [4, 3, 3, 1], 14: [4, 3, 3, 1], 15: [4, 3, 3, 2], 16: [4, 3, 3, 2], 17: [4, 3, 3, 3, 1], 18: [4, 3, 3, 3, 1], 19: [4, 3, 3, 3, 2], 20: [4, 3, 3, 3, 2] };
  const PACT_SLOTS = { 1: [1, 1], 2: [2, 1], 3: [2, 2], 4: [2, 2], 5: [2, 3], 6: [2, 3], 7: [2, 4], 8: [2, 4], 9: [2, 5], 10: [2, 5], 11: [3, 5], 12: [3, 5], 13: [3, 5], 14: [3, 5], 15: [3, 5], 16: [3, 5], 17: [4, 5], 18: [4, 5], 19: [4, 5], 20: [4, 5] };
  window.SRD.features = LEVEL_FEATURES;
  window.SRD.slots = { full: FULL_SLOTS, half: HALF_SLOTS, pact: PACT_SLOTS };
  window.SRD.casterType = { Bard: 'full', Cleric: 'full', Druid: 'full', Sorcerer: 'full', Wizard: 'full', Paladin: 'half', Ranger: 'half', Warlock: 'pact' };

  /* ---- Populate the join-screen pickers ---- */
  function fillJoin() {
    const opt = (v, label) => `<option value="${esc(v)}">${esc(label || v)}</option>`;
    const jc = document.getElementById('join-class');
    if (jc && jc.options.length <= 1) {
      jc.innerHTML = opt('', '— choose later —') + CLASSES.map((c) => opt(c.n)).join('');
      // Picking a class tints your token to the class color (still overridable)
      jc.addEventListener('change', () => {
        const t = CLASS_THEME[jc.value];
        const col = document.getElementById('join-color');
        if (t && col) col.value = t[0];
      });
    }
    const js = document.getElementById('join-species');
    if (js && js.options.length <= 1) js.innerHTML = opt('', '— choose later —') + SPECIES.map((s) => opt(s.n)).join('');
    const jb = document.getElementById('join-bg');
    if (jb && jb.options.length <= 1) jb.innerHTML = opt('', '— choose later —') + BACKGROUNDS.map((b) => opt(b.n)).join('');
  }
  if (document.readyState !== 'loading') fillJoin();
  else document.addEventListener('DOMContentLoaded', fillJoin);
})();
