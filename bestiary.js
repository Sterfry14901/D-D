/* ============================================================
   MONSTER STAT BLOCKS  —  D&D SRD 5.1, CC-BY-4.0
   Full stat blocks + viewer. window.showStatBlock(name) opens a modal.
   Ability array order: STR DEX CON INT WIS CHA
   ============================================================ */
(function () {
  const SB = {
    'Rat': { m: 'Tiny beast', ac: 10, hp: '1 (1d4−1)', sp: '20 ft', a: [2, 11, 9, 2, 10, 4], sen: 'Darkvision 30 ft, PP 10', cr: '0',
      act: [['Bite', '+0 to hit, 1 piercing.']] },
    'Bat': { m: 'Tiny beast', ac: 12, hp: '1 (1d4−1)', sp: '5 ft, fly 30 ft', a: [2, 15, 8, 2, 12, 4], sen: 'Blindsight 60 ft, PP 11', cr: '0',
      act: [['Bite', '+0 to hit, 1 piercing.']] },
    'Commoner': { m: 'Medium humanoid', ac: 10, hp: '4 (1d8)', sp: '30 ft', a: [10, 10, 10, 10, 10, 10], sen: 'PP 10', cr: '0',
      act: [['Club', '+2 to hit, 1d4 bludgeoning.']] },
    'Kobold': { m: 'Small humanoid', ac: 12, hp: '5 (2d6−2)', sp: '30 ft', a: [7, 15, 9, 8, 7, 8], sen: 'Darkvision 60 ft, PP 8', cr: '1/8',
      tr: [['Sunlight Sensitivity', 'Disadvantage on attacks & Perception in sunlight.'], ['Pack Tactics', 'Advantage if an ally is within 5 ft of the target.']],
      act: [['Dagger', '+4 to hit, 1d4+2 piercing.'], ['Sling', '+4 to hit, 30/120 ft, 1d4+2 bludgeoning.']] },
    'Giant Rat': { m: 'Small beast', ac: 12, hp: '7 (2d6)', sp: '30 ft', a: [7, 15, 11, 2, 10, 4], sen: 'Darkvision 60 ft, PP 10', cr: '1/8',
      tr: [['Pack Tactics', 'Advantage if an ally is within 5 ft of the target.']],
      act: [['Bite', '+4 to hit, 1d4+2 piercing.']] },
    'Goblin': { m: 'Small humanoid', ac: 15, hp: '7 (2d6)', sp: '30 ft', a: [8, 14, 10, 10, 8, 8], sen: 'Darkvision 60 ft, PP 9', cr: '1/4',
      tr: [['Nimble Escape', 'Disengage or Hide as a bonus action each turn.']],
      act: [['Scimitar', '+4 to hit, 1d6+2 slashing.'], ['Shortbow', '+4 to hit, 80/320 ft, 1d6+2 piercing.']] },
    'Bandit': { m: 'Medium humanoid', ac: 12, hp: '11 (2d8+2)', sp: '30 ft', a: [11, 12, 12, 10, 10, 10], sen: 'PP 10', cr: '1/8',
      act: [['Scimitar', '+3 to hit, 1d6+1 slashing.'], ['Light Crossbow', '+3 to hit, 80/320 ft, 1d8+1 piercing.']] },
    'Guard': { m: 'Medium humanoid', ac: 16, hp: '11 (2d8+2)', sp: '30 ft', a: [13, 12, 12, 10, 11, 10], sen: 'PP 12', cr: '1/8',
      act: [['Spear', '+3 to hit, 1d6+1 (1d8+1 two-handed) piercing.']] },
    'Cultist': { m: 'Medium humanoid', ac: 12, hp: '9 (2d8)', sp: '30 ft', a: [11, 12, 10, 10, 11, 10], sen: 'PP 10', cr: '1/8',
      act: [['Scimitar', '+3 to hit, 1d6+1 slashing.']] },
    'Wolf': { m: 'Medium beast', ac: 13, hp: '11 (2d8+2)', sp: '40 ft', a: [12, 15, 12, 3, 12, 6], sen: 'PP 13', cr: '1/4',
      tr: [['Pack Tactics', 'Advantage if an ally is within 5 ft of the target.']],
      act: [['Bite', '+4 to hit, 2d4+2 piercing; DC 11 STR save or knocked prone.']] },
    'Boar': { m: 'Medium beast', ac: 11, hp: '11 (2d8+2)', sp: '40 ft', a: [13, 11, 12, 2, 9, 5], sen: 'PP 9', cr: '1/4',
      tr: [['Charge', 'Move 20+ ft then hit: +1d6 and DC 11 STR save or prone.'], ['Relentless (Recharges after Short/Long Rest)', 'Drop to 1 HP instead of 0 once.']],
      act: [['Tusk', '+3 to hit, 1d6+1 slashing.']] },
    'Skeleton': { m: 'Medium undead', ac: 13, hp: '13 (2d8+4)', sp: '30 ft', a: [10, 14, 15, 6, 8, 5], sen: 'Darkvision 60 ft, PP 9', cr: '1/4',
      tr: [['Vulnerabilities/Immunities', 'Vuln. bludgeoning; immune poison & exhaustion.']],
      act: [['Shortsword', '+4 to hit, 1d6+2 piercing.'], ['Shortbow', '+4 to hit, 80/320 ft, 1d6+2 piercing.']] },
    'Zombie': { m: 'Medium undead', ac: 8, hp: '22 (3d8+9)', sp: '20 ft', a: [13, 6, 16, 3, 6, 5], sen: 'Darkvision 60 ft, PP 8', cr: '1/4',
      tr: [['Undead Fortitude', 'When reduced to 0 HP (not radiant/crit), DC 5+damage CON save to drop to 1 instead.']],
      act: [['Slam', '+3 to hit, 1d6+1 bludgeoning.']] },
    'Orc': { m: 'Medium humanoid', ac: 13, hp: '15 (2d8+6)', sp: '30 ft', a: [16, 12, 16, 7, 11, 10], sen: 'Darkvision 60 ft, PP 10', cr: '1/2',
      tr: [['Aggressive', 'Bonus action: move up to its speed toward an enemy.']],
      act: [['Greataxe', '+5 to hit, 1d12+3 slashing.'], ['Javelin', '+5 to hit, 30/120 ft, 1d6+3 piercing.']] },
    'Hobgoblin': { m: 'Medium humanoid', ac: 18, hp: '11 (2d8+2)', sp: '30 ft', a: [13, 12, 12, 10, 10, 9], sen: 'Darkvision 60 ft, PP 10', cr: '1/2',
      tr: [['Martial Advantage (1/turn)', '+2d6 damage vs a target with an ally within 5 ft.']],
      act: [['Longsword', '+3 to hit, 1d8+1 (1d10+1 two-handed) slashing.'], ['Longbow', '+3 to hit, 150/600 ft, 1d8+1 piercing.']] },
    'Lizardfolk': { m: 'Medium humanoid', ac: 15, hp: '22 (4d8+4)', sp: '30 ft, swim 30 ft', a: [15, 10, 13, 7, 12, 7], sen: 'PP 13', cr: '1/2',
      tr: [['Hold Breath', 'Can hold breath for 15 minutes.']],
      act: [['Multiattack', 'Two melee attacks (one bite, one weapon).'], ['Bite', '+4 to hit, 1d6+2 piercing.'], ['Spiked Shield', '+4 to hit, 1d6+2 piercing.']] },
    'Scout': { m: 'Medium humanoid', ac: 13, hp: '16 (3d8+3)', sp: '30 ft', a: [11, 14, 12, 11, 13, 11], sen: 'PP 15', cr: '1/2',
      tr: [['Keen Hearing and Sight', 'Advantage on Perception (hearing/sight).']],
      act: [['Multiattack', 'Two melee or two ranged attacks.'], ['Shortsword', '+4 to hit, 1d6+2 piercing.'], ['Longbow', '+4 to hit, 150/600 ft, 1d8+2 piercing.']] },
    'Thug': { m: 'Medium humanoid', ac: 11, hp: '32 (5d8+10)', sp: '30 ft', a: [15, 11, 14, 10, 10, 11], sen: 'PP 10', cr: '1/2',
      tr: [['Pack Tactics', 'Advantage if an ally is within 5 ft of the target.']],
      act: [['Multiattack', 'Two melee attacks.'], ['Mace', '+4 to hit, 1d6+2 bludgeoning.'], ['Heavy Crossbow', '+2 to hit, 100/400 ft, 1d10 piercing.']] },
    'Gnoll': { m: 'Medium humanoid', ac: 15, hp: '22 (5d8)', sp: '30 ft', a: [14, 12, 11, 6, 10, 7], sen: 'Darkvision 60 ft, PP 10', cr: '1/2',
      tr: [['Rampage', 'On reducing a creature to 0 HP: bonus-action move + bite.']],
      act: [['Bite', '+4 to hit, 1d4+2 piercing.'], ['Spear', '+4 to hit, 1d6+2 piercing.'], ['Longbow', '+3 to hit, 150/600 ft, 1d8 piercing.']] },
    'Ghoul': { m: 'Medium undead', ac: 12, hp: '22 (5d8)', sp: '30 ft', a: [13, 15, 10, 7, 10, 6], sen: 'Darkvision 60 ft, PP 10', cr: '1',
      tr: [['Immunities', 'Immune poison; can\'t be charmed or exhausted.']],
      act: [['Bite', '+2 to hit, 2d6+2 piercing.'], ['Claws', '+4 to hit, 2d4+2 slashing; DC 10 CON save or paralyzed 1 min (elves immune).']] },
    'Giant Spider': { m: 'Large beast', ac: 14, hp: '26 (4d10+4)', sp: '30 ft, climb 30 ft', a: [14, 16, 12, 2, 11, 4], sen: 'Blindsight 10 ft, darkvision 60 ft, PP 10', cr: '1',
      tr: [['Spider Climb', 'Climb difficult surfaces, hands free.'], ['Web Sense/Walker', 'Sense & move on webs normally.']],
      act: [['Bite', '+5 to hit, 1d8+3 piercing + DC 11 CON save 2d8 poison (half).'], ['Web (Recharge 5–6)', 'DC 12 DEX save or restrained; 60/30 ft range.']] },
    'Dire Wolf': { m: 'Large beast', ac: 14, hp: '37 (5d10+10)', sp: '50 ft', a: [17, 15, 15, 3, 12, 7], sen: 'PP 13', cr: '1',
      tr: [['Pack Tactics', 'Advantage if an ally is within 5 ft of the target.']],
      act: [['Bite', '+5 to hit, 2d6+3 piercing; DC 13 STR save or prone.']] },
    'Brown Bear': { m: 'Large beast', ac: 11, hp: '34 (4d10+12)', sp: '40 ft, climb 30 ft', a: [19, 10, 16, 2, 13, 7], sen: 'PP 13', cr: '1',
      act: [['Multiattack', 'One bite and one claws.'], ['Bite', '+5 to hit, 1d8+4 piercing.'], ['Claws', '+5 to hit, 2d6+4 slashing.']] },
    'Giant Eagle': { m: 'Large beast', ac: 13, hp: '26 (4d10+4)', sp: '10 ft, fly 80 ft', a: [16, 17, 13, 8, 14, 10], sen: 'PP 14', cr: '1',
      act: [['Multiattack', 'One beak and one talons.'], ['Beak', '+5 to hit, 1d6+3 piercing.'], ['Talons', '+5 to hit, 2d6+3 slashing.']] },
    'Bugbear': { m: 'Medium humanoid', ac: 16, hp: '27 (5d8+5)', sp: '30 ft', a: [15, 14, 13, 8, 11, 9], sen: 'Darkvision 60 ft, PP 10', cr: '1',
      tr: [['Brute', 'Melee weapons deal +1 die of damage (included).'], ['Surprise Attack', '+2d6 damage vs a surprised target on the first turn.']],
      act: [['Morningstar', '+4 to hit, 2d8+2 piercing.'], ['Javelin', '+4 to hit, 30/120 ft, 2d6+2 (melee) / 1d6+2 piercing.']] },
    'Goblin Boss': { m: 'Small humanoid', ac: 17, hp: '21 (6d6)', sp: '30 ft', a: [10, 14, 10, 10, 8, 10], sen: 'Darkvision 60 ft, PP 9', cr: '1',
      tr: [['Nimble Escape', 'Disengage or Hide as a bonus action.']],
      act: [['Multiattack', 'Two scimitar attacks (2nd has disadvantage).'], ['Scimitar', '+4 to hit, 1d6+2 slashing.'], ['Javelin', '+4 to hit, 30/120 ft, 1d6+2 piercing.']] },
    'Ogre': { m: 'Large giant', ac: 11, hp: '59 (7d10+21)', sp: '40 ft', a: [19, 8, 16, 5, 7, 7], sen: 'Darkvision 60 ft, PP 8', cr: '2',
      act: [['Greatclub', '+6 to hit, 2d8+4 bludgeoning.'], ['Javelin', '+6 to hit, 30/120 ft, 2d6+4 piercing.']] },
    'Gargoyle': { m: 'Medium elemental', ac: 15, hp: '52 (7d8+21)', sp: '30 ft, fly 60 ft', a: [15, 11, 16, 6, 11, 7], sen: 'Darkvision 60 ft, PP 10', cr: '2',
      tr: [['False Appearance', 'Indistinguishable from a statue while motionless.']],
      act: [['Multiattack', 'One bite and one claws.'], ['Bite', '+4 to hit, 1d6+2 piercing.'], ['Claws', '+4 to hit, 1d6+2 slashing.']] },
    'Priest': { m: 'Medium humanoid', ac: 13, hp: '27 (5d8+5)', sp: '25 ft', a: [10, 10, 12, 13, 16, 13], sen: 'PP 13', cr: '2',
      tr: [['Spellcasting', 'Cleric DC 13, +5. Cantrips: sacred flame, light. 1st: cure wounds, guiding bolt. 2nd: spiritual weapon, hold person. 3rd: spirit guardians, dispel magic.']],
      act: [['Mace', '+2 to hit, 1d6 bludgeoning.']] },
    'Cult Fanatic': { m: 'Medium humanoid', ac: 13, hp: '33 (6d8+6)', sp: '30 ft', a: [11, 14, 12, 10, 13, 14], sen: 'PP 11', cr: '2',
      tr: [['Spellcasting', 'Cleric DC 11, +3. Cantrips: sacred flame, thaumaturgy. 1st: command, inflict wounds, shield of faith. 2nd: hold person, spiritual weapon.'], ['Dark Devotion', 'Advantage vs charm & fear.']],
      act: [['Multiattack', 'Two dagger attacks.'], ['Dagger', '+4 to hit, 1d4+2 piercing.']] },
    'Bandit Captain': { m: 'Medium humanoid', ac: 15, hp: '65 (10d8+20)', sp: '30 ft', a: [15, 16, 14, 14, 11, 14], sen: 'PP 10', cr: '2',
      act: [['Multiattack', 'Two scimitar attacks and one dagger.'], ['Scimitar', '+5 to hit, 1d6+3 slashing.'], ['Dagger', '+5 to hit, 20/60 ft, 1d4+3 piercing.']],
      rc: [['Parry', '+2 AC vs one melee attack (must see attacker, be wielding a melee weapon).']] },
    'Berserker': { m: 'Medium humanoid', ac: 13, hp: '67 (9d8+27)', sp: '30 ft', a: [16, 12, 17, 9, 11, 9], sen: 'PP 10', cr: '2',
      tr: [['Reckless', 'Can attack with advantage; attacks against it have advantage until its next turn.']],
      act: [['Greataxe', '+5 to hit, 1d12+3 slashing.']] },
    'Werewolf': { m: 'Medium humanoid (shapechanger)', ac: 12, hp: '58 (9d8+18)', sp: '30 ft (40 ft wolf)', a: [15, 13, 14, 10, 11, 10], sen: 'PP 14', cr: '3',
      tr: [['Shapechanger', 'Transform into wolf/hybrid/human.'], ['Immunity', 'Immune to nonmagical, non-silvered weapon damage.']],
      act: [['Multiattack (humanoid/hybrid)', 'Two attacks.'], ['Bite (wolf/hybrid)', '+4 to hit, 1d8+2 piercing; DC 12 CON save or curse of lycanthropy.'], ['Claws (hybrid)', '+4 to hit, 2d4+2 slashing.']] },
    'Owlbear': { m: 'Large monstrosity', ac: 13, hp: '59 (7d10+21)', sp: '40 ft', a: [20, 12, 17, 3, 12, 7], sen: 'Darkvision 60 ft, PP 13', cr: '3',
      tr: [['Keen Sight and Smell', 'Advantage on Perception (sight/smell).']],
      act: [['Multiattack', 'One beak and one claws.'], ['Beak', '+7 to hit, 1d10+5 piercing.'], ['Claws', '+7 to hit, 2d8+5 slashing.']] },
    'Basilisk': { m: 'Medium monstrosity', ac: 15, hp: '52 (8d8+16)', sp: '20 ft', a: [16, 8, 15, 2, 8, 7], sen: 'Darkvision 60 ft, PP 9', cr: '3',
      tr: [['Petrifying Gaze', 'A creature starting its turn within 30 ft and meeting its eyes: DC 12 CON save, on fail restrained then petrified.']],
      act: [['Bite', '+5 to hit, 2d6+3 piercing + 2d6 poison.']] },
    'Manticore': { m: 'Large monstrosity', ac: 14, hp: '68 (8d10+24)', sp: '30 ft, fly 50 ft', a: [17, 16, 17, 7, 12, 8], sen: 'Darkvision 60 ft, PP 11', cr: '3',
      tr: [['Tail Spikes', 'Has 24 tail spikes; regrows after a long rest.']],
      act: [['Multiattack', 'One bite and two claws, or three tail spikes.'], ['Bite', '+5 to hit, 1d8+3 piercing.'], ['Claw', '+5 to hit, 1d6+3 slashing.'], ['Tail Spike', '+5 to hit, 100/200 ft, 1d8+3 piercing.']] },
    'Knight': { m: 'Medium humanoid', ac: 18, hp: '52 (8d8+16)', sp: '30 ft', a: [16, 11, 14, 11, 11, 15], sen: 'PP 10', cr: '3',
      tr: [['Brave', 'Advantage on saves vs being frightened.']],
      act: [['Multiattack', 'Two greatsword attacks.'], ['Greatsword', '+5 to hit, 2d6+3 slashing.'], ['Heavy Crossbow', '+2 to hit, 100/400 ft, 1d10 piercing.']],
      rc: [['Parry', '+2 AC vs one melee attack.']] },
    'Veteran': { m: 'Medium humanoid', ac: 17, hp: '58 (9d8+18)', sp: '30 ft', a: [16, 13, 14, 10, 11, 10], sen: 'PP 12', cr: '3',
      act: [['Multiattack', 'Two longsword attacks and one shortsword.'], ['Longsword', '+5 to hit, 1d8+3 slashing.'], ['Shortsword', '+5 to hit, 1d6+3 piercing.'], ['Heavy Crossbow', '+3 to hit, 100/400 ft, 1d10+1 piercing.']] },
    'Wight': { m: 'Medium undead', ac: 14, hp: '45 (6d8+18)', sp: '30 ft', a: [15, 14, 16, 10, 13, 15], sen: 'Darkvision 60 ft, PP 13', cr: '3',
      tr: [['Sunlight Sensitivity', 'Disadvantage on attacks & Perception in sunlight.']],
      act: [['Multiattack', 'Two longsword or two life drain attacks.'], ['Life Drain', '+4 to hit, 1d6+2 necrotic; DC 13 CON save or max HP reduced.'], ['Longsword', '+4 to hit, 1d8+2 slashing.']] },
    'Mummy': { m: 'Medium undead', ac: 11, hp: '58 (9d8+18)', sp: '20 ft', a: [16, 8, 15, 6, 10, 12], sen: 'Darkvision 60 ft, PP 10', cr: '3',
      tr: [['Vulnerability', 'Vulnerable to fire.']],
      act: [['Multiattack', 'One dreadful glare and one rotting fist.'], ['Rotting Fist', '+5 to hit, 2d6+3 bludgeoning + 3d6 necrotic; DC 12 CON save or mummy rot.'], ['Dreadful Glare', 'DC 11 WIS save or frightened 1 min (+ paralyzed if fails badly).']] },
    'Wraith': { m: 'Medium undead', ac: 13, hp: '67 (9d8+27)', sp: '0 ft, fly 60 ft (hover)', a: [6, 16, 16, 12, 14, 15], sen: 'Darkvision 60 ft, PP 12', cr: '5',
      tr: [['Incorporeal Movement', 'Move through creatures/objects (1d10 force if it ends inside).'], ['Sunlight Sensitivity', 'Disadvantage in sunlight.']],
      act: [['Life Drain', '+6 to hit, 4d8+3 necrotic; DC 14 CON save or max HP reduced.']] },
    'Vampire Spawn': { m: 'Medium undead', ac: 15, hp: '82 (11d8+33)', sp: '30 ft', a: [16, 16, 16, 11, 10, 12], sen: 'Darkvision 60 ft, PP 13', cr: '5',
      tr: [['Regeneration', 'Regain 10 HP at start of turn if it has ≥1 HP and not in sunlight/running water.'], ['Weaknesses', 'Radiant damage, sunlight, running water stop regeneration; can\'t enter homes uninvited.']],
      act: [['Multiattack', 'Two attacks (one may be a bite).'], ['Claws', '+6 to hit, 2d4+3 slashing; DC 13 STR grapple.'], ['Bite', '+6 to hit vs grappled/restrained, 1d6+3 piercing + 2d6 necrotic (heals spawn).']] },
    'Troll': { m: 'Large giant', ac: 15, hp: '84 (8d10+40)', sp: '30 ft', a: [18, 13, 20, 7, 9, 7], sen: 'Darkvision 60 ft, PP 12', cr: '5',
      tr: [['Regeneration', 'Regain 10 HP at start of turn unless it took acid or fire damage this turn.']],
      act: [['Multiattack', 'One bite and two claws.'], ['Bite', '+7 to hit, 1d6+4 piercing.'], ['Claw', '+7 to hit, 2d6+4 slashing.']] },
    'Flesh Golem': { m: 'Medium construct', ac: 9, hp: '93 (11d8+44)', sp: '30 ft', a: [19, 9, 18, 6, 10, 5], sen: 'Darkvision 60 ft, PP 10', cr: '5',
      tr: [['Immutable Form', 'Immune to shape-change.'], ['Lightning Absorption', 'Heals from lightning damage.'], ['Magic Resistance', 'Advantage on saves vs spells.']],
      act: [['Multiattack', 'Two slam attacks.'], ['Slam', '+7 to hit, 2d8+4 bludgeoning.']] },
    'Air Elemental': { m: 'Large elemental', ac: 15, hp: '90 (12d10+24)', sp: 'fly 90 ft (hover)', a: [14, 20, 14, 6, 10, 6], sen: 'Darkvision 60 ft, PP 10', cr: '5',
      tr: [['Air Form', 'Move through 1-inch spaces; resistance to nonmagical weapons.']],
      act: [['Multiattack', 'Two slam attacks.'], ['Slam', '+8 to hit, 2d8+5 bludgeoning.'], ['Whirlwind (Recharge 4–6)', 'DC 13 STR save 3d8 bludgeoning + flung.']] },
    'Fire Elemental': { m: 'Large elemental', ac: 13, hp: '102 (12d10+36)', sp: '50 ft', a: [10, 17, 16, 6, 10, 7], sen: 'Darkvision 60 ft, PP 10', cr: '5',
      tr: [['Fire Form', 'Ignites creatures/objects it touches; immune to fire; water damages it.'], ['Illumination', 'Sheds bright light 30 ft.']],
      act: [['Multiattack', 'Two touch attacks.'], ['Touch', '+6 to hit, 2d6+3 fire + ignite (1d10/turn).']] },
    'Water Elemental': { m: 'Large elemental', ac: 14, hp: '114 (12d10+48)', sp: '30 ft, swim 90 ft', a: [18, 14, 18, 5, 10, 8], sen: 'Darkvision 60 ft, PP 10', cr: '5',
      tr: [['Water Form', 'Move through 1-inch spaces; resistance to nonmagical weapons.'], ['Freeze', 'Cold damage can freeze it (restrained).']],
      act: [['Multiattack', 'Two slam attacks.'], ['Slam', '+7 to hit, 2d8+4 bludgeoning.'], ['Whelm (Recharge 4–6)', 'DC 15 STR save; engulf, 2d8+4 bludgeoning.']] },
    'Earth Elemental': { m: 'Large elemental', ac: 17, hp: '126 (12d10+60)', sp: '30 ft, burrow 30 ft', a: [20, 8, 20, 5, 10, 5], sen: 'Darkvision 60 ft, tremorsense 60 ft, PP 10', cr: '5',
      tr: [['Earth Glide', 'Burrow through earth/stone without disturbing it.'], ['Siege Monster', 'Double damage to objects & structures.']],
      act: [['Multiattack', 'Two slam attacks.'], ['Slam', '+8 to hit, 2d8+5 bludgeoning.']] },
    'Mage': { m: 'Medium humanoid', ac: 12, hp: '40 (9d8)', sp: '30 ft', a: [9, 14, 11, 17, 12, 11], sen: 'PP 11', cr: '6',
      tr: [['Spellcasting', 'Wizard DC 14, +6. Cantrips: fire bolt, light, mage hand, prestidigitation. 1st: shield, magic missile, detect magic. 2nd: misty step, suggestion. 3rd: counterspell, fireball, fly. 4th: greater invisibility, ice storm. 5th: cone of cold.']],
      act: [['Dagger', '+5 to hit, 1d4+2 piercing.']] },
    'Ettin': { m: 'Large giant', ac: 12, hp: '85 (10d10+30)', sp: '40 ft', a: [21, 8, 17, 6, 10, 8], sen: 'Darkvision 60 ft, PP 14', cr: '4',
      tr: [['Two Heads', 'Advantage vs blinded/charmed/deafened/frightened/stunned/knocked out; always alert.']],
      act: [['Multiattack', 'One battleaxe and one morningstar.'], ['Battleaxe', '+7 to hit, 2d8+5 slashing.'], ['Morningstar', '+7 to hit, 2d8+5 piercing.']] },
    'Hill Giant': { m: 'Huge giant', ac: 13, hp: '105 (10d12+40)', sp: '40 ft', a: [21, 8, 19, 5, 9, 6], sen: 'PP 12', cr: '5',
      act: [['Multiattack', 'Two greatclub attacks.'], ['Greatclub', '+8 to hit, 3d8+5 bludgeoning.'], ['Rock', '+8 to hit, 60/240 ft, 3d10+5 bludgeoning.']] },
    'Stone Giant': { m: 'Huge giant', ac: 17, hp: '126 (11d12+55)', sp: '40 ft', a: [23, 15, 20, 10, 12, 9], sen: 'Darkvision 60 ft, PP 14', cr: '7',
      act: [['Multiattack', 'Two greatclub attacks.'], ['Greatclub', '+9 to hit, 3d8+6 bludgeoning.'], ['Rock', '+9 to hit, 60/240 ft, 4d10+6 bludgeoning; DC 17 STR save or prone.']] },
    'Frost Giant': { m: 'Huge giant', ac: 15, hp: '138 (12d12+60)', sp: '40 ft', a: [23, 9, 21, 9, 10, 12], sen: 'PP 13', cr: '8',
      tr: [['Immunity', 'Immune to cold damage.']],
      act: [['Multiattack', 'Two greataxe attacks.'], ['Greataxe', '+9 to hit, 3d12+6 slashing.'], ['Rock', '+9 to hit, 60/240 ft, 4d10+6 bludgeoning.']] },
    'Fire Giant': { m: 'Huge giant', ac: 18, hp: '162 (13d12+78)', sp: '30 ft', a: [25, 9, 23, 10, 14, 13], sen: 'PP 16', cr: '9',
      tr: [['Immunity', 'Immune to fire damage.']],
      act: [['Multiattack', 'Two greatsword attacks.'], ['Greatsword', '+11 to hit, 6d6+7 slashing.'], ['Rock', '+11 to hit, 60/240 ft, 4d10+7 bludgeoning.']] },
    'Ghost': { m: 'Medium undead', ac: 11, hp: '45 (10d8)', sp: '0 ft, fly 40 ft (hover)', a: [7, 13, 10, 10, 12, 17], sen: 'Darkvision 60 ft, PP 11', cr: '4',
      tr: [['Incorporeal Movement', 'Move through objects/creatures (1d10 force if it ends inside).'], ['Etherealness', 'Can enter the Ethereal Plane.']],
      act: [['Withering Touch', '+5 to hit, 4d6+3 necrotic.'], ['Horrifying Visage', 'DC 13 WIS save or frightened 1 min (may age).'], ['Possession (Recharge 6)', 'DC 13 CHA save or be possessed by the ghost.']] },
    'Assassin': { m: 'Medium humanoid', ac: 15, hp: '78 (12d8+24)', sp: '30 ft', a: [11, 16, 14, 13, 11, 10], sen: 'PP 13', cr: '8',
      tr: [['Assassinate', 'Advantage vs any creature that hasn\'t acted; hits vs surprised are crits.'], ['Sneak Attack (1/turn)', '+4d6 with advantage or an ally adjacent.']],
      act: [['Multiattack', 'Two shortsword attacks.'], ['Shortsword', '+6 to hit, 1d6+3 piercing + DC 15 CON save 7d6 poison (half).'], ['Light Crossbow', '+6 to hit, 80/320 ft, 1d8+3 + poison as above.']] },
    'Mind Flayer': { m: 'Medium aberration', ac: 15, hp: '71 (13d8+13)', sp: '30 ft', a: [11, 12, 12, 19, 17, 17], sen: 'Darkvision 120 ft, PP 17', cr: '7',
      tr: [['Magic Resistance', 'Advantage on saves vs spells.'], ['Innate Spellcasting (psionics)', 'At will: detect thoughts, levitate; 1/day: dominate monster, plane shift.']],
      act: [['Tentacles', '+7 to hit, 2d10+1 psychic + DC 15 INT grapple/stun.'], ['Extract Brain', 'Vs incapacitated grappled creature: 10d10 piercing (kills → eats brain).'], ['Mind Blast (Recharge 5–6)', '60-ft cone, DC 15 INT save 4d8+4 psychic + stunned 1 min.']] },
    'Vampire': { m: 'Medium undead (shapechanger)', ac: 16, hp: '144 (17d8+68)', sp: '30 ft', a: [18, 18, 18, 17, 15, 18], sen: 'Darkvision 120 ft, PP 17', cr: '13',
      tr: [['Regeneration', 'Regain 20 HP/turn if ≥1 HP and not in sunlight/running water.'], ['Misty Escape', 'On dropping to 0 (not sunlight/stake), turn to mist and flee to rest.'], ['Legendary Resistance (3/day)', 'Choose to succeed a failed save.']],
      act: [['Multiattack (vampire form)', 'Two attacks (one may be a bite).'], ['Unarmed Strike', '+9 to hit, 1d8+4 + DC 18 STR grapple.'], ['Bite', 'Vs grappled/willing/restrained: 1d6+4 + 3d6 necrotic (heals vampire).'], ['Charm', 'DC 17 WIS save or charmed.']] },
    'Lich': { m: 'Medium undead', ac: 17, hp: '135 (18d8+54)', sp: '30 ft', a: [11, 16, 16, 20, 14, 16], sen: 'Truesight 120 ft, PP 19', cr: '21',
      tr: [['Legendary Resistance (3/day)', 'Succeed a failed save.'], ['Rejuvenation', 'Reforms in 1d10 days from its phylactery.'], ['Spellcasting', 'Wizard DC 20, +12. Access to the full wizard list (e.g., power word kill, finger of death, disintegrate, cloudkill, counterspell, fireball).']],
      act: [['Paralyzing Touch', '+12 to hit, 3d6 cold + DC 18 CON save or paralyzed 1 min.']],
      rc: [['Legendary Actions (3/turn)', 'Cantrip; Paralyzing Touch (2); Frightening Gaze (2); Disrupt Life (3): 6d6 necrotic to living within 20 ft.']] },
    'Young Dragon': { m: 'Large dragon', ac: 18, hp: '178 (17d10+85)', sp: '40 ft, fly 80 ft', a: [23, 14, 21, 14, 11, 19], sen: 'Blindsight 30 ft, darkvision 120 ft, PP 17', cr: '10',
      tr: [['Breath Weapon (Recharge 5–6)', '~40-ft area, DC 17 save, ~11d6 elemental damage (half on save).']],
      act: [['Multiattack', 'One bite and two claws.'], ['Bite', '+10 to hit, 2d10+6 piercing + 1d6 element.'], ['Claw', '+10 to hit, 2d6+6 slashing.']] },
  };

  // Alias so the bestiary buttons/token labels resolve to a block
  const ALIAS = { 'Wyrmling Dragon': null, 'Wyrmling': null, 'Acolyte': 'Priest', 'Imp': null };

  function ab(v) { const m = Math.floor((v - 10) / 2); return v + ' (' + (m >= 0 ? '+' : '') + m + ')'; }
  function esc(s) { return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }

  let sbCreature = '';
  // Parse a "+7 to hit ... 2d6+4" style action into a rollable button.
  function rollBtn(name, text) {
    const h = text.match(/([+−+-]?\d+)\s*to hit/);
    if (!h) return '';
    const hit = parseInt(h[1].replace('−', '-'), 10);
    const d = text.match(/(\d+)d(\d+)(?:\s*([+−-])\s*(\d+))?/);
    let dn = 0, die = 0, dmod = 0;
    if (d) { dn = +d[1]; die = +d[2]; dmod = d[3] ? (d[3] === '+' ? 1 : -1) * (+d[4]) : 0; }
    return `<button class="sb-roll" data-name="${esc(name)}" data-hit="${hit}" data-n="${dn}" data-die="${die}" data-mod="${dmod}" title="Roll to hit + damage">🎲</button>`;
  }
  function actionRow(t) {
    return `<div class="sb-p"><b>${esc(t[0])}.</b> ${esc(t[1])} ${rollBtn(t[0], t[1])}</div>`;
  }

  window.hasStatBlock = function (name) { const k = ALIAS[name] !== undefined ? ALIAS[name] : name; return !!(k && SB[k]); };

  window.showStatBlock = function (name) {
    const key = ALIAS[name] !== undefined ? ALIAS[name] : name;
    const s = key && SB[key];
    sbCreature = name;
    let modal = document.getElementById('sb-modal');
    if (!modal) {
      modal = document.createElement('div'); modal.id = 'sb-modal'; modal.className = 'overlay hidden';
      modal.innerHTML = '<div class="sb-card"><button class="sb-x" title="Close">✕</button><div id="sb-body"></div></div>';
      document.body.appendChild(modal);
      modal.addEventListener('click', (e) => {
        const ac = e.target.closest && e.target.closest('.sb-abil');
        if (ac) {
          e.stopPropagation();
          const mod = parseInt(ac.dataset.mod, 10) || 0;
          const d20 = 1 + Math.floor(Math.random() * 20);
          const total = d20 + mod;
          const crit = d20 === 20 ? ' 💥nat 20' : d20 === 1 ? ' ⚠️nat 1' : '';
          if (typeof window.emitChat === 'function') window.emitChat(`🎲 ${sbCreature} — ${ac.dataset.abil} save/check: ${total} (d20 ${d20}${mod >= 0 ? '+' + mod : mod})${crit}`);
          return;
        }
        const rb = e.target.closest && e.target.closest('.sb-roll');
        if (rb) {
          e.stopPropagation();
          const hit = parseInt(rb.dataset.hit, 10) || 0;
          const n = parseInt(rb.dataset.n, 10) || 0, die = parseInt(rb.dataset.die, 10) || 0, dmod = parseInt(rb.dataset.mod, 10) || 0;
          const d20 = 1 + Math.floor(Math.random() * 20);
          const toHit = d20 + hit;
          let dmgTxt = '';
          if (n && die) {
            let sum = 0; const rolls = [];
            for (let i = 0; i < n; i++) { const r = 1 + Math.floor(Math.random() * die); sum += r; rolls.push(r); }
            sum += dmod;
            dmgTxt = ` · damage ${Math.max(0, sum)} (${n}d${die}${dmod ? (dmod > 0 ? '+' + dmod : dmod) : ''}: ${rolls.join('+')}${dmod ? (dmod > 0 ? '+' + dmod : dmod) : ''})`;
          }
          const crit = d20 === 20 ? ' 💥CRIT' : d20 === 1 ? ' ⚠️nat 1' : '';
          if (typeof window.emitChat === 'function') window.emitChat(`🎲 ${sbCreature} — ${rb.dataset.name}: to hit ${toHit} (d20 ${d20}${hit >= 0 ? '+' + hit : hit})${crit}${dmgTxt}`);
          return;
        }
        if (e.target === modal || e.target.classList.contains('sb-x')) modal.classList.add('hidden');
      });
    }
    const body = document.getElementById('sb-body');
    if (!s) { body.innerHTML = `<div class="sb-name">${esc(name)}</div><div class="sb-none">No detailed stat block yet for this creature.</div>`; }
    else {
      const abil = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'];
      body.innerHTML = `
        <div class="sb-name">${esc(name)}</div>
        <div class="sb-type">${esc(s.m)}</div>
        <div class="sb-line"><b>AC</b> ${esc(String(s.ac))} &nbsp; <b>HP</b> ${esc(s.hp)} &nbsp; <b>Speed</b> ${esc(s.sp)}</div>
        <div class="sb-abils">${s.a.map((v, i) => { const m = Math.floor((v - 10) / 2); return `<div class="sb-abil" data-abil="${abil[i]}" data-mod="${m}" title="Roll a d20 ${m >= 0 ? '+' : ''}${m} save/check"><span>${abil[i]}</span>${ab(v)}</div>`; }).join('')}</div>
        <div class="sb-line"><b>Senses</b> ${esc(s.sen)} &nbsp; <b>CR</b> ${esc(s.cr)}</div>
        ${(s.tr || []).map((t) => `<div class="sb-p"><b>${esc(t[0])}.</b> ${esc(t[1])}</div>`).join('')}
        ${s.act ? '<div class="sb-h">Actions</div>' : ''}
        ${(s.act || []).map(actionRow).join('')}
        ${s.rc ? '<div class="sb-h">Reactions / Legendary</div>' : ''}
        ${(s.rc || []).map(actionRow).join('')}
        <div class="sb-foot">SRD 5.1 · CC-BY-4.0</div>`;
    }
    modal.classList.remove('hidden');
  };

  // Render an arbitrary stat block (e.g. live Open5e data) in the same modal,
  // with the same clickable ability checks and rollable attack buttons.
  window.showStatBlockData = function (name, s, foot) {
    window.showStatBlock(name); // ensures the modal + click handlers exist
    sbCreature = name;
    if (!s) return;
    const abil = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'];
    document.getElementById('sb-body').innerHTML = `
      <div class="sb-name">${esc(name)}</div>
      <div class="sb-type">${esc(s.m)}</div>
      <div class="sb-line"><b>AC</b> ${esc(String(s.ac))} &nbsp; <b>HP</b> ${esc(s.hp)} &nbsp; <b>Speed</b> ${esc(s.sp)}</div>
      <div class="sb-abils">${s.a.map((v, i) => { const m = Math.floor((v - 10) / 2); return `<div class="sb-abil" data-abil="${abil[i]}" data-mod="${m}" title="Roll a d20 ${m >= 0 ? '+' : ''}${m} save/check"><span>${abil[i]}</span>${ab(v)}</div>`; }).join('')}</div>
      <div class="sb-line"><b>Senses</b> ${esc(s.sen)} &nbsp; <b>CR</b> ${esc(s.cr)}</div>
      ${(s.tr || []).map((t) => `<div class="sb-p"><b>${esc(t[0])}.</b> ${esc(t[1])}</div>`).join('')}
      ${(s.act && s.act.length) ? '<div class="sb-h">Actions</div>' : ''}
      ${(s.act || []).map(actionRow).join('')}
      ${(s.rc && s.rc.length) ? '<div class="sb-h">Reactions / Legendary</div>' : ''}
      ${(s.rc || []).map(actionRow).join('')}
      <div class="sb-foot">${esc(foot || 'Open5e')}</div>`;
  };
})();
