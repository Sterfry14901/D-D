/* ============================================================
   5E SPELL LIBRARY  —  D&D SRD 5.1, CC-BY-4.0
   Searchable spell cards (search + level filter). Player-facing.
   ============================================================ */
(function () {
  // s=school, t=casting time, r=range, c=components, d=duration, x=effect
  const SPELLS = [
    // ===== Cantrips =====
    { n: 'Acid Splash', l: 0, s: 'Conjuration', t: '1 action', r: '60 ft', c: 'V,S', d: 'Instant', x: 'One or two creatures within 5 ft of each other make a DEX save or take 1d6 acid (scales 5/11/17).' },
    { n: 'Chill Touch', l: 0, s: 'Necromancy', t: '1 action', r: '120 ft', c: 'V,S', d: '1 round', x: 'Ranged spell attack: 1d8 necrotic, target can\'t regain HP until your next turn (scales).' },
    { n: 'Dancing Lights', l: 0, s: 'Evocation', t: '1 action', r: '120 ft', c: 'V,S,M', d: 'Conc. 1 min', x: 'Create up to four torch-like lights or a glowing humanoid you can move 60 ft.' },
    { n: 'Fire Bolt', l: 0, s: 'Evocation', t: '1 action', r: '120 ft', c: 'V,S', d: 'Instant', x: 'Ranged spell attack: 1d10 fire; ignites flammable objects (scales 2d10/3d10/4d10).' },
    { n: 'Guidance', l: 0, s: 'Divination', t: '1 action', r: 'Touch', c: 'V,S', d: 'Conc. 1 min', x: 'Willing creature adds 1d4 to one ability check of its choice before the spell ends.' },
    { n: 'Light', l: 0, s: 'Evocation', t: '1 action', r: 'Touch', c: 'V,M', d: '1 hour', x: 'Object sheds bright light 20 ft + dim 20 ft. DEX save to avoid if cast on a creature.' },
    { n: 'Mage Hand', l: 0, s: 'Conjuration', t: '1 action', r: '30 ft', c: 'V,S', d: '1 minute', x: 'Spectral hand manipulates objects, opens doors, carries up to 10 lb (no attacks).' },
    { n: 'Mending', l: 0, s: 'Transmutation', t: '1 minute', r: 'Touch', c: 'V,S,M', d: 'Instant', x: 'Repairs a single break or tear in an object no larger than 1 ft.' },
    { n: 'Message', l: 0, s: 'Transmutation', t: '1 action', r: '120 ft', c: 'V,S,M', d: '1 round', x: 'Whisper a message to a creature you can see; it can reply in a whisper only you hear.' },
    { n: 'Minor Illusion', l: 0, s: 'Illusion', t: '1 action', r: '30 ft', c: 'S,M', d: '1 minute', x: 'Create a sound or an image of an object; Investigation check reveals the illusion.' },
    { n: 'Poison Spray', l: 0, s: 'Conjuration', t: '1 action', r: '10 ft', c: 'V,S', d: 'Instant', x: 'CON save or 1d12 poison (scales 2/3/4d12).' },
    { n: 'Prestidigitation', l: 0, s: 'Transmutation', t: '1 action', r: '10 ft', c: 'V,S', d: 'Up to 1 hour', x: 'Minor magical trick: clean, flavor, light a candle, small sensory effect, etc.' },
    { n: 'Produce Flame', l: 0, s: 'Conjuration', t: '1 action', r: 'Self / 30 ft', c: 'V,S', d: '10 minutes', x: 'Flame in hand sheds light; hurl for a ranged spell attack: 1d8 fire (scales).' },
    { n: 'Ray of Frost', l: 0, s: 'Evocation', t: '1 action', r: '60 ft', c: 'V,S', d: 'Instant', x: 'Ranged spell attack: 1d8 cold and −10 ft speed until your next turn (scales).' },
    { n: 'Sacred Flame', l: 0, s: 'Evocation', t: '1 action', r: '60 ft', c: 'V,S', d: 'Instant', x: 'DEX save (no benefit from cover) or 1d8 radiant (scales 2/3/4d8).' },
    { n: 'Shocking Grasp', l: 0, s: 'Evocation', t: '1 action', r: 'Touch', c: 'V,S', d: 'Instant', x: 'Melee spell attack (adv. vs metal armor): 1d8 lightning; target can\'t take reactions.' },
    { n: 'Spare the Dying', l: 0, s: 'Necromancy', t: '1 action', r: 'Touch', c: 'V,S', d: 'Instant', x: 'Stabilize a creature at 0 HP (it becomes stable).' },
    { n: 'Thaumaturgy', l: 0, s: 'Transmutation', t: '1 action', r: '30 ft', c: 'V', d: 'Up to 1 min', x: 'Minor wonder: booming voice, flickering flames, tremors, opened doors, etc.' },
    { n: 'Vicious Mockery', l: 0, s: 'Enchantment', t: '1 action', r: '60 ft', c: 'V', d: 'Instant', x: 'WIS save or 1d4 psychic and disadvantage on its next attack (scales).' },
    // ===== Level 1 =====
    { n: 'Bless', l: 1, s: 'Enchantment', t: '1 action', r: '30 ft', c: 'V,S,M', d: 'Conc. 1 min', x: 'Up to 3 creatures add 1d4 to attack rolls and saving throws.' },
    { n: 'Burning Hands', l: 1, s: 'Evocation', t: '1 action', r: 'Self (15-ft cone)', c: 'V,S', d: 'Instant', x: 'DEX save; 3d6 fire (half on save). +1d6 per slot above 1st.' },
    { n: 'Charm Person', l: 1, s: 'Enchantment', t: '1 action', r: '30 ft', c: 'V,S', d: '1 hour', x: 'WIS save or the humanoid is charmed by you (ends if you harm it).' },
    { n: 'Chromatic Orb', l: 1, s: 'Evocation', t: '1 action', r: '90 ft', c: 'V,S,M', d: 'Instant', x: 'Ranged spell attack: 3d8 of a chosen element. +1d8 per slot above 1st.' },
    { n: 'Command', l: 1, s: 'Enchantment', t: '1 action', r: '60 ft', c: 'V', d: '1 round', x: 'WIS save or the target obeys a one-word command (approach, drop, flee, grovel, halt).' },
    { n: 'Cure Wounds', l: 1, s: 'Evocation', t: '1 action', r: 'Touch', c: 'V,S', d: 'Instant', x: 'Heal 1d8 + spellcasting mod. +1d8 per slot above 1st.' },
    { n: 'Detect Magic', l: 1, s: 'Divination', t: '1 action', r: 'Self (30 ft)', c: 'V,S', d: 'Conc. 10 min', x: 'Sense the presence and school of magic within 30 ft (ritual).' },
    { n: 'Disguise Self', l: 1, s: 'Illusion', t: '1 action', r: 'Self', c: 'V,S', d: '1 hour', x: 'Change your appearance (and clothing/gear). Investigation vs your spell DC to see through.' },
    { n: 'Faerie Fire', l: 1, s: 'Evocation', t: '1 action', r: '60 ft', c: 'V', d: 'Conc. 1 min', x: 'DEX save; outlined creatures shed light and attacks against them have advantage.' },
    { n: 'Feather Fall', l: 1, s: 'Transmutation', t: '1 reaction', r: '60 ft', c: 'V,M', d: '1 minute', x: 'Up to 5 falling creatures descend 60 ft/round and take no falling damage.' },
    { n: 'Fog Cloud', l: 1, s: 'Conjuration', t: '1 action', r: '120 ft', c: 'V,S', d: 'Conc. 1 hour', x: '20-ft-radius sphere of fog heavily obscures the area. Bigger with higher slots.' },
    { n: 'Goodberry', l: 1, s: 'Transmutation', t: '1 action', r: 'Touch', c: 'V,S,M', d: 'Instant', x: 'Create 10 berries; eating one restores 1 HP and feeds for a day (last 24 hours).' },
    { n: 'Grease', l: 1, s: 'Conjuration', t: '1 action', r: '60 ft', c: 'V,S,M', d: '1 minute', x: '10-ft square of difficult terrain; DEX save or fall prone (and on entering).' },
    { n: 'Guiding Bolt', l: 1, s: 'Evocation', t: '1 action', r: '120 ft', c: 'V,S', d: '1 round', x: 'Ranged spell attack: 4d6 radiant; next attack vs target has advantage. +1d6/slot.' },
    { n: 'Healing Word', l: 1, s: 'Evocation', t: '1 bonus action', r: '60 ft', c: 'V', d: 'Instant', x: 'Heal 1d4 + spellcasting mod at range. +1d4 per slot above 1st.' },
    { n: 'Hex', l: 1, s: 'Enchantment', t: '1 bonus action', r: '90 ft', c: 'V,S,M', d: 'Conc. 1 hour', x: '+1d6 necrotic on your hits vs target; it has disadvantage on a chosen ability.' },
    { n: "Hunter's Mark", l: 1, s: 'Divination', t: '1 bonus action', r: '90 ft', c: 'V', d: 'Conc. 1 hour', x: '+1d6 damage on your weapon hits vs the marked target; advantage to track it.' },
    { n: 'Inflict Wounds', l: 1, s: 'Necromancy', t: '1 action', r: 'Touch', c: 'V,S', d: 'Instant', x: 'Melee spell attack: 3d10 necrotic. +1d10 per slot above 1st.' },
    { n: 'Mage Armor', l: 1, s: 'Abjuration', t: '1 action', r: 'Touch', c: 'V,S,M', d: '8 hours', x: 'Willing unarmored target\'s base AC becomes 13 + DEX modifier.' },
    { n: 'Magic Missile', l: 1, s: 'Evocation', t: '1 action', r: '120 ft', c: 'V,S', d: 'Instant', x: 'Three darts auto-hit for 1d4+1 force each. +1 dart per slot above 1st.' },
    { n: 'Protection from Evil and Good', l: 1, s: 'Abjuration', t: '1 action', r: 'Touch', c: 'V,S,M', d: 'Conc. 10 min', x: 'Certain creature types have disadvantage to attack the warded target.' },
    { n: 'Shield', l: 1, s: 'Abjuration', t: '1 reaction', r: 'Self', c: 'V,S', d: '1 round', x: '+5 AC until your next turn, including vs the triggering attack; blocks Magic Missile.' },
    { n: 'Silent Image', l: 1, s: 'Illusion', t: '1 action', r: '60 ft', c: 'V,S,M', d: 'Conc. 10 min', x: 'Create a movable visual illusion up to a 15-ft cube. Investigation to disbelieve.' },
    { n: 'Sleep', l: 1, s: 'Enchantment', t: '1 action', r: '90 ft', c: 'V,S,M', d: '1 minute', x: '5d8 HP of creatures (lowest first) fall unconscious. +2d8 per slot above 1st.' },
    { n: 'Thunderwave', l: 1, s: 'Evocation', t: '1 action', r: 'Self (15-ft cube)', c: 'V,S', d: 'Instant', x: 'CON save; 2d8 thunder and pushed 10 ft (half + no push on save). +1d8/slot.' },
    // ===== Level 2 =====
    { n: 'Aid', l: 2, s: 'Abjuration', t: '1 action', r: '30 ft', c: 'V,S,M', d: '8 hours', x: 'Up to 3 creatures gain +5 max and current HP. +5 per slot above 2nd.' },
    { n: 'Blur', l: 2, s: 'Illusion', t: '1 action', r: 'Self', c: 'V', d: 'Conc. 1 min', x: 'Attackers have disadvantage unless they don\'t rely on sight.' },
    { n: 'Darkness', l: 2, s: 'Evocation', t: '1 action', r: '60 ft', c: 'V,M', d: 'Conc. 10 min', x: '15-ft-radius magical darkness that normal light and darkvision can\'t penetrate.' },
    { n: 'Enhance Ability', l: 2, s: 'Transmutation', t: '1 action', r: 'Touch', c: 'V,S,M', d: 'Conc. 1 hour', x: 'Advantage on one ability\'s checks (plus a rider like temp HP or better jumps).' },
    { n: 'Flaming Sphere', l: 2, s: 'Conjuration', t: '1 action', r: '60 ft', c: 'V,S,M', d: 'Conc. 1 min', x: '5-ft fiery sphere; DEX save 2d6 fire, move it 30 ft/turn (bonus action). +1d6/slot.' },
    { n: 'Heat Metal', l: 2, s: 'Transmutation', t: '1 action', r: '60 ft', c: 'V,S,M', d: 'Conc. 1 min', x: 'Metal object glows; 2d8 fire each turn, CON save or drop it. +1d8/slot.' },
    { n: 'Hold Person', l: 2, s: 'Enchantment', t: '1 action', r: '60 ft', c: 'V,S,M', d: 'Conc. 1 min', x: 'WIS save or a humanoid is paralyzed; repeats saves each turn. +1 target/slot.' },
    { n: 'Invisibility', l: 2, s: 'Illusion', t: '1 action', r: 'Touch', c: 'V,S,M', d: 'Conc. 1 hour', x: 'Target is invisible until it attacks or casts a spell. +1 target per slot above 2nd.' },
    { n: 'Lesser Restoration', l: 2, s: 'Abjuration', t: '1 action', r: 'Touch', c: 'V,S', d: 'Instant', x: 'End one disease or the blinded, deafened, paralyzed, or poisoned condition.' },
    { n: 'Mirror Image', l: 2, s: 'Illusion', t: '1 action', r: 'Self', c: 'V,S', d: '1 minute', x: 'Three duplicates; attacks may hit a decoy instead of you.' },
    { n: 'Misty Step', l: 2, s: 'Conjuration', t: '1 bonus action', r: 'Self', c: 'V', d: 'Instant', x: 'Teleport up to 30 ft to an unoccupied space you can see.' },
    { n: 'Moonbeam', l: 2, s: 'Evocation', t: '1 action', r: '120 ft', c: 'V,S,M', d: 'Conc. 1 min', x: '5-ft beam; CON save 2d10 radiant, move it 60 ft/turn. +1d10 per slot above 2nd.' },
    { n: 'Scorching Ray', l: 2, s: 'Evocation', t: '1 action', r: '120 ft', c: 'V,S', d: 'Instant', x: 'Three rays, each a ranged spell attack for 2d6 fire. +1 ray per slot above 2nd.' },
    { n: 'See Invisibility', l: 2, s: 'Divination', t: '1 action', r: 'Self', c: 'V,S,M', d: '1 hour', x: 'See invisible creatures and objects and into the Ethereal Plane.' },
    { n: 'Shatter', l: 2, s: 'Evocation', t: '1 action', r: '60 ft', c: 'V,S,M', d: 'Instant', x: '10-ft sphere; CON save 3d8 thunder (half on save). +1d8 per slot above 2nd.' },
    { n: 'Silence', l: 2, s: 'Illusion', t: '1 action', r: '120 ft', c: 'V,S', d: 'Conc. 10 min', x: '20-ft sphere: no sound; blocks verbal components and thunder damage (ritual).' },
    { n: 'Spider Climb', l: 2, s: 'Transmutation', t: '1 action', r: 'Touch', c: 'V,S,M', d: 'Conc. 1 hour', x: 'Target can climb walls and ceilings, hands free, at its walking speed.' },
    { n: 'Spiritual Weapon', l: 2, s: 'Evocation', t: '1 bonus action', r: '60 ft', c: 'V,S', d: '1 minute', x: 'Floating weapon: melee spell attack 1d8 + mod; move it 20 ft. +1d8 per two slots.' },
    { n: 'Suggestion', l: 2, s: 'Enchantment', t: '1 action', r: '30 ft', c: 'V,M', d: 'Conc. 8 hours', x: 'WIS save or the target pursues a reasonable course of action you suggest.' },
    { n: 'Web', l: 2, s: 'Conjuration', t: '1 action', r: '60 ft', c: 'V,S,M', d: 'Conc. 1 hour', x: '20-ft cube of webs (difficult terrain); DEX save or restrained.' },
    // ===== Level 3 =====
    { n: 'Animate Dead', l: 3, s: 'Necromancy', t: '1 minute', r: '10 ft', c: 'V,S,M', d: 'Instant', x: 'Raise a skeleton or zombie under your control (re-assert control daily).' },
    { n: 'Beacon of Hope', l: 3, s: 'Abjuration', t: '1 action', r: '30 ft', c: 'V,S', d: 'Conc. 1 min', x: 'Allies gain advantage on WIS saves & death saves and max healing.' },
    { n: 'Bestow Curse', l: 3, s: 'Necromancy', t: '1 action', r: 'Touch', c: 'V,S', d: 'Conc. 1 min', x: 'WIS save or a curse (disadvantage, wasted turns, or +1d8 necrotic from you).' },
    { n: 'Call Lightning', l: 3, s: 'Conjuration', t: '1 action', r: '120 ft', c: 'V,S', d: 'Conc. 10 min', x: 'Storm cloud; DEX save 3d10 lightning each turn. +1d10 per slot above 3rd.' },
    { n: 'Counterspell', l: 3, s: 'Abjuration', t: '1 reaction', r: '60 ft', c: 'S', d: 'Instant', x: 'Interrupt a spell of 3rd level or lower; higher requires an ability check (DC 10 + level).' },
    { n: 'Dispel Magic', l: 3, s: 'Abjuration', t: '1 action', r: '120 ft', c: 'V,S', d: 'Instant', x: 'End spells of 3rd level or lower; higher needs a check (DC 10 + spell level).' },
    { n: 'Fireball', l: 3, s: 'Evocation', t: '1 action', r: '150 ft', c: 'V,S,M', d: 'Instant', x: '20-ft sphere; DEX save 8d6 fire (half on save). +1d6 per slot above 3rd.' },
    { n: 'Fly', l: 3, s: 'Transmutation', t: '1 action', r: 'Touch', c: 'V,S,M', d: 'Conc. 10 min', x: 'Target gains a 60-ft flying speed. +1 target per slot above 3rd.' },
    { n: 'Haste', l: 3, s: 'Transmutation', t: '1 action', r: '30 ft', c: 'V,S,M', d: 'Conc. 1 min', x: '+2 AC, double speed, advantage on DEX saves, one extra action. Lethargy when it ends.' },
    { n: 'Hypnotic Pattern', l: 3, s: 'Illusion', t: '1 action', r: '120 ft', c: 'S,M', d: 'Conc. 1 min', x: '30-ft cube; WIS save or charmed and incapacitated (breaks on damage).' },
    { n: 'Lightning Bolt', l: 3, s: 'Evocation', t: '1 action', r: 'Self (100-ft line)', c: 'V,S,M', d: 'Instant', x: '100-ft line; DEX save 8d6 lightning (half). +1d6 per slot above 3rd.' },
    { n: 'Major Image', l: 3, s: 'Illusion', t: '1 action', r: '120 ft', c: 'V,S,M', d: 'Conc. 10 min', x: 'Detailed image with sound, smell, and temperature, up to a 20-ft cube.' },
    { n: 'Mass Healing Word', l: 3, s: 'Evocation', t: '1 bonus action', r: '60 ft', c: 'V', d: 'Instant', x: 'Up to 6 creatures heal 1d4 + mod. +1d4 per slot above 3rd.' },
    { n: 'Revivify', l: 3, s: 'Necromancy', t: '1 action', r: 'Touch', c: 'V,S,M', d: 'Instant', x: 'Return a creature dead ≤1 minute to life with 1 HP (needs 300 gp diamond).' },
    { n: 'Sleet Storm', l: 3, s: 'Conjuration', t: '1 action', r: '150 ft', c: 'V,S,M', d: 'Conc. 1 min', x: '40-ft area: difficult terrain, dim/obscured, DEX save or fall prone; breaks concentration.' },
    { n: 'Slow', l: 3, s: 'Transmutation', t: '1 action', r: '120 ft', c: 'V,S,M', d: 'Conc. 1 min', x: 'Up to 6 creatures; WIS save or halved speed, −2 AC & DEX saves, one action only.' },
    { n: 'Spirit Guardians', l: 3, s: 'Conjuration', t: '1 action', r: 'Self (15 ft)', c: 'V,S,M', d: 'Conc. 10 min', x: 'Spirits; enemies\' speed halved, WIS save 3d8 radiant/necrotic. +1d8 per slot.' },
    { n: 'Vampiric Touch', l: 3, s: 'Necromancy', t: '1 action', r: 'Self', c: 'V,S', d: 'Conc. 1 min', x: 'Melee spell attack 3d6 necrotic; heal half the damage dealt. +1d6 per slot.' },
    { n: 'Water Breathing', l: 3, s: 'Transmutation', t: '1 action', r: '30 ft', c: 'V,S,M', d: '24 hours', x: 'Up to 10 creatures can breathe underwater (ritual).' },
    // ===== Level 4 =====
    { n: 'Banishment', l: 4, s: 'Abjuration', t: '1 action', r: '60 ft', c: 'V,S,M', d: 'Conc. 1 min', x: 'CHA save or banish target to another plane; extraplanar targets don\'t return.' },
    { n: 'Blight', l: 4, s: 'Necromancy', t: '1 action', r: '30 ft', c: 'V,S', d: 'Instant', x: 'CON save 8d8 necrotic (half); plants auto-fail. +1d8 per slot above 4th.' },
    { n: 'Dimension Door', l: 4, s: 'Conjuration', t: '1 action', r: '500 ft', c: 'V', d: 'Instant', x: 'Teleport yourself (and one willing creature) up to 500 ft.' },
    { n: 'Freedom of Movement', l: 4, s: 'Abjuration', t: '1 action', r: 'Touch', c: 'V,S,M', d: '1 hour', x: 'Ignore difficult terrain; immune to being grappled/restrained/paralyzed movement effects.' },
    { n: 'Greater Invisibility', l: 4, s: 'Illusion', t: '1 action', r: 'Touch', c: 'V,S', d: 'Conc. 1 min', x: 'Target is invisible even while attacking and casting.' },
    { n: 'Ice Storm', l: 4, s: 'Evocation', t: '1 action', r: '300 ft', c: 'V,S,M', d: 'Instant', x: '20-ft cylinder; DEX save 2d8 bludgeoning + 4d6 cold; area becomes difficult terrain.' },
    { n: 'Polymorph', l: 4, s: 'Transmutation', t: '1 action', r: '60 ft', c: 'V,S,M', d: 'Conc. 1 hour', x: 'WIS save or transform target into a beast (uses beast\'s stats & HP).' },
    { n: 'Stoneskin', l: 4, s: 'Abjuration', t: '1 action', r: 'Touch', c: 'V,S,M', d: 'Conc. 1 hour', x: 'Target has resistance to nonmagical bludgeoning, piercing, and slashing.' },
    { n: 'Wall of Fire', l: 4, s: 'Evocation', t: '1 action', r: '120 ft', c: 'V,S,M', d: 'Conc. 1 min', x: '60-ft wall; DEX save 5d8 fire on one side. +1d8 per slot above 4th.' },
    { n: 'Death Ward', l: 4, s: 'Abjuration', t: '1 action', r: 'Touch', c: 'V,S', d: '8 hours', x: 'First time target would drop to 0 HP it drops to 1 instead (once).' },
    { n: 'Confusion', l: 4, s: 'Enchantment', t: '1 action', r: '90 ft', c: 'V,S,M', d: 'Conc. 1 min', x: '10-ft sphere; WIS save or act randomly each turn. +5 ft radius per slot.' },
    // ===== Level 5 =====
    { n: 'Cone of Cold', l: 5, s: 'Evocation', t: '1 action', r: 'Self (60-ft cone)', c: 'V,S,M', d: 'Instant', x: 'CON save 8d8 cold (half). +1d8 per slot above 5th.' },
    { n: 'Dominate Person', l: 5, s: 'Enchantment', t: '1 action', r: '60 ft', c: 'V,S', d: 'Conc. 1 min', x: 'WIS save or you control a humanoid; new save on taking damage.' },
    { n: 'Flame Strike', l: 5, s: 'Evocation', t: '1 action', r: '60 ft', c: 'V,S,M', d: 'Instant', x: '10-ft cylinder; DEX save 4d6 fire + 4d6 radiant (half). +1d6 per slot above 5th.' },
    { n: 'Greater Restoration', l: 5, s: 'Abjuration', t: '1 action', r: 'Touch', c: 'V,S,M', d: 'Instant', x: 'End a charm, petrification, curse, ability reduction, or one exhaustion level.' },
    { n: 'Hold Monster', l: 5, s: 'Enchantment', t: '1 action', r: '90 ft', c: 'V,S,M', d: 'Conc. 1 min', x: 'WIS save or any creature is paralyzed; repeats saves. +1 target per slot.' },
    { n: 'Mass Cure Wounds', l: 5, s: 'Evocation', t: '1 action', r: '60 ft', c: 'V,S', d: 'Instant', x: 'Up to 6 creatures heal 3d8 + mod. +1d8 per slot above 5th.' },
    { n: 'Raise Dead', l: 5, s: 'Necromancy', t: '1 hour', r: 'Touch', c: 'V,S,M', d: 'Instant', x: 'Return a creature dead ≤10 days to life (500 gp diamond); −4 penalty fades over time.' },
    { n: 'Telekinesis', l: 5, s: 'Transmutation', t: '1 action', r: '60 ft', c: 'V,S', d: 'Conc. 10 min', x: 'Move a creature (contested check) or a 1,000-lb object with your mind.' },
    { n: 'Wall of Force', l: 5, s: 'Evocation', t: '1 action', r: '120 ft', c: 'V,S,M', d: 'Conc. 10 min', x: 'Invisible wall nothing physical can pass; immune to most damage. Blocked only by Disintegrate.' },
    { n: 'Cloudkill', l: 5, s: 'Conjuration', t: '1 action', r: '120 ft', c: 'V,S', d: 'Conc. 10 min', x: '20-ft fog; CON save 5d8 poison, moves 10 ft/turn. +1d8 per slot above 5th.' },
    // ===== Level 6 =====
    { n: 'Chain Lightning', l: 6, s: 'Evocation', t: '1 action', r: '150 ft', c: 'V,S,M', d: 'Instant', x: 'Main + 3 arcs; DEX save 10d8 lightning (half). +1 target per slot above 6th.' },
    { n: 'Disintegrate', l: 6, s: 'Transmutation', t: '1 action', r: '60 ft', c: 'V,S,M', d: 'Instant', x: 'DEX save or 10d6+40 force; reduced to dust at 0 HP. +3d6 per slot above 6th.' },
    { n: 'Heal', l: 6, s: 'Evocation', t: '1 action', r: '60 ft', c: 'V,S', d: 'Instant', x: 'Restore 70 HP and end blindness, deafness, and disease. +10 HP per slot above 6th.' },
    { n: 'Harm', l: 6, s: 'Necromancy', t: '1 action', r: '60 ft', c: 'V,S', d: 'Instant', x: 'CON save 14d6 necrotic (max HP reduced to match; half on save).' },
    { n: 'True Seeing', l: 6, s: 'Divination', t: '1 action', r: 'Touch', c: 'V,S,M', d: '1 hour', x: 'Truesight 120 ft: see through illusions, invisibility, darkness, and into the Ethereal.' },
    { n: 'Sunbeam', l: 6, s: 'Evocation', t: '1 action', r: 'Self (60-ft line)', c: 'V,S,M', d: 'Conc. 1 min', x: 'CON save 6d8 radiant + blinded (half, no blind); re-fire each turn.' },
    { n: 'Circle of Death', l: 6, s: 'Necromancy', t: '1 action', r: '150 ft', c: 'V,S,M', d: 'Instant', x: '60-ft sphere; CON save 8d6 necrotic (half). +2d6 per slot above 6th.' },
    // ===== Level 7 =====
    { n: 'Finger of Death', l: 7, s: 'Necromancy', t: '1 action', r: '60 ft', c: 'V,S', d: 'Instant', x: 'CON save 7d8+30 necrotic (half); a slain humanoid rises as your zombie.' },
    { n: 'Teleport', l: 7, s: 'Conjuration', t: '1 action', r: '10 ft', c: 'V', d: 'Instant', x: 'Instantly travel up to 8 creatures a great distance (accuracy varies by familiarity).' },
    { n: 'Fire Storm', l: 7, s: 'Evocation', t: '1 action', r: '150 ft', c: 'V,S', d: 'Instant', x: 'Up to ten 10-ft cubes; DEX save 7d10 fire (half).' },
    { n: 'Reverse Gravity', l: 7, s: 'Transmutation', t: '1 action', r: '100 ft', c: 'V,S,M', d: 'Conc. 1 min', x: 'Objects and creatures in a 50-ft cylinder fall upward (DEX save to grab something).' },
    { n: 'Prismatic Spray', l: 7, s: 'Evocation', t: '1 action', r: 'Self (60-ft cone)', c: 'V,S', d: 'Instant', x: 'Random colored rays: fire/acid/lightning/poison/cold damage, restrain, blind, or banish.' },
    // ===== Level 8 =====
    { n: 'Power Word Stun', l: 8, s: 'Enchantment', t: '1 action', r: '60 ft', c: 'V', d: 'Instant', x: 'Target with ≤150 HP is stunned (CON save each turn to end). No save to apply.' },
    { n: 'Dominate Monster', l: 8, s: 'Enchantment', t: '1 action', r: '60 ft', c: 'V,S', d: 'Conc. 1 hour', x: 'WIS save or you control any creature; new save on taking damage.' },
    { n: 'Sunburst', l: 8, s: 'Evocation', t: '1 action', r: '150 ft', c: 'V,S,M', d: 'Instant', x: '60-ft sphere of sunlight; CON save 12d6 radiant + blinded 1 min (half, no blind).' },
    { n: 'Feeblemind', l: 8, s: 'Enchantment', t: '1 action', r: '150 ft', c: 'V,S,M', d: 'Instant', x: 'INT save 4d6 psychic; on fail INT & CHA drop to 1 (can\'t cast) until cured.' },
    { n: 'Incendiary Cloud', l: 8, s: 'Conjuration', t: '1 action', r: '150 ft', c: 'V,S', d: 'Conc. 1 min', x: '20-ft cloud; DEX save 10d8 fire, moves 10 ft/turn, obscures the area.' },
    // ===== Level 9 =====
    { n: 'Wish', l: 9, s: 'Conjuration', t: '1 action', r: 'Self', c: 'V', d: 'Instant', x: 'Duplicate any 8th-level-or-lower spell, or reshape reality (with risk/strain for big asks).' },
    { n: 'Meteor Swarm', l: 9, s: 'Evocation', t: '1 action', r: '1 mile', c: 'V,S', d: 'Instant', x: 'Four 40-ft spheres; DEX save 20d6 fire + 20d6 bludgeoning (half).' },
    { n: 'Power Word Kill', l: 9, s: 'Enchantment', t: '1 action', r: '60 ft', c: 'V', d: 'Instant', x: 'A creature with 100 HP or fewer dies instantly. No save.' },
    { n: 'Time Stop', l: 9, s: 'Transmutation', t: '1 action', r: 'Self', c: 'V', d: 'Instant', x: 'Take 1d4+1 turns in a row; ends if you affect another creature or its gear.' },
    { n: 'True Resurrection', l: 9, s: 'Necromancy', t: '1 hour', r: 'Touch', c: 'V,S,M', d: 'Instant', x: 'Return a creature dead ≤200 years to life with a fresh body, curing all conditions.' },
    { n: 'Mass Heal', l: 9, s: 'Evocation', t: '1 action', r: '60 ft', c: 'V,S', d: 'Instant', x: 'Restore up to 700 HP split among creatures; also ends blindness, deafness, disease.' },
    { n: 'Foresight', l: 9, s: 'Divination', t: '1 minute', r: 'Touch', c: 'V,S,M', d: '8 hours', x: 'Target has advantage on attacks, checks, and saves; attackers have disadvantage.' },
  ];

  const SCHOOL_ABBR = { Abjuration: 'Abj', Conjuration: 'Conj', Divination: 'Div', Enchantment: 'Ench', Evocation: 'Evoc', Illusion: 'Illus', Necromancy: 'Necro', Transmutation: 'Trans' };
  let built = false, lvlFilter = 'all';

  function esc(s) { return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }
  function lvlName(l) { return l === 0 ? 'Cantrip' : 'Lvl ' + l; }

  function renderChips() {
    const bar = document.getElementById('spell-lvls'); if (!bar) return;
    const opts = [['all', 'All'], [0, 'Cantrip'], [1, '1'], [2, '2'], [3, '3'], [4, '4'], [5, '5'], [6, '6'], [7, '7'], [8, '8'], [9, '9']];
    bar.innerHTML = '';
    opts.forEach(([v, label]) => {
      const b = document.createElement('button');
      b.className = 'spell-lvl' + (String(v) === String(lvlFilter) ? ' on' : '');
      b.textContent = label;
      b.onclick = () => { lvlFilter = v; renderChips(); apply(); };
      bar.appendChild(b);
    });
  }

  function apply() {
    const box = document.getElementById('spell-content'); if (!box) return;
    const q = (document.getElementById('spell-q').value || '').trim().toLowerCase();
    let list = SPELLS.slice();
    if (lvlFilter !== 'all') list = list.filter((s) => String(s.l) === String(lvlFilter));
    if (q) list = list.filter((s) => (s.n + ' ' + s.s + ' ' + s.x).toLowerCase().includes(q));
    list.sort((a, b) => a.l - b.l || a.n.localeCompare(b.n));
    if (!list.length) { box.innerHTML = '<div class="rules-empty">No spells match.</div>'; return; }
    box.innerHTML = list.map((s) => {
      const dm = s.x.match(/(\d+)d(\d+)/);
      const rb = dm ? `<button class="sb-roll spell-roll" data-name="${esc(s.n)}" data-n="${dm[1]}" data-die="${dm[2]}" title="Roll ${dm[0]}">🎲 ${dm[0]}</button>` : '';
      const cb = `<button class="spell-cast" data-cast="${esc(s.n)}" data-lv="${s.l}" title="${s.l === 0 ? 'Cast cantrip (no slot needed)' : 'Cast — uses a spell slot from your sheet'}">✨ Cast</button>`;
      return `
      <div class="spell">
        <div class="spell-h"><span class="spell-n">${esc(s.n)}</span><span class="spell-lv">${esc(lvlName(s.l))} · ${esc(SCHOOL_ABBR[s.s] || s.s)}</span></div>
        <div class="spell-meta">${esc(s.t)} · ${esc(s.r)} · ${esc(s.c)} · ${esc(s.d)}</div>
        <div class="spell-x">${esc(s.x)} ${rb} ${cb}</div>
      </div>`;
    }).join('');
  }

  function init() {
    if (built) return;
    const q = document.getElementById('spell-q'); if (!q) return;
    built = true;
    const cnt = document.getElementById('spell-count'); if (cnt) cnt.textContent = SPELLS.length + ' spells';
    renderChips(); apply();
    q.addEventListener('input', apply);
    const box = document.getElementById('spell-content');
    if (box) box.addEventListener('click', (e) => {
      const cbtn = e.target.closest && e.target.closest('.spell-cast');
      if (cbtn) { if (typeof window.castSpell === 'function') window.castSpell(cbtn.dataset.cast, parseInt(cbtn.dataset.lv, 10) || 0); return; }
      const rb = e.target.closest && e.target.closest('.spell-roll'); if (!rb) return;
      const n = parseInt(rb.dataset.n, 10) || 0, die = parseInt(rb.dataset.die, 10) || 0;
      let sum = 0; const rolls = [];
      for (let i = 0; i < n; i++) { const r = 1 + Math.floor(Math.random() * die); sum += r; rolls.push(r); }
      if (typeof window.emitChat === 'function') window.emitChat(`🔮 ${rb.dataset.name} — ${n}d${die}: ${sum} (${rolls.join('+')})`);
    });
  }
  if (document.readyState !== 'loading') init();
  else document.addEventListener('DOMContentLoaded', init);
})();
