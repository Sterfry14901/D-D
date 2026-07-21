/* Public-domain illustration library (Wikimedia Commons, Pearson Scott Foresman,
   old-book engravings). All entries below are public domain. Loaded from the curated
   list at the user's shared doc. Images are served via Wikimedia's Special:FilePath
   endpoint, which redirects to the real media file. */
(function () {
  const FP = 'https://commons.wikimedia.org/wiki/Special:FilePath/';
  // Build a media URL for a Commons filename, optionally scaled to `w` px wide.
  window.pdArt = (file, w) => FP + encodeURIComponent(file) + (w ? '?width=' + w : '');

  // Creature / character art: { q: search terms (space-separated), f: Commons filename }
  window.PD_ART = [
    // --- purpose-built D&D line art ---
    { q: 'basilisk lizard', f: 'DnD Basilisk.png' },
    { q: 'black pudding ooze', f: 'DnD Black pudding.png' },
    { q: 'centaur', f: 'DnD Centaur.png' },
    { q: 'chimera', f: 'DnD Chimera.png' },
    { q: 'cockatrice', f: 'DnD Cockatrice.png' },
    { q: 'djinni djinn genie air', f: 'DnD Djinn.png' },
    { q: 'dragon wyrm', f: 'DnD Dragon.png' },
    { q: 'dryad tree fey', f: 'DnD Dryad.png' },
    { q: 'efreeti efreet fire genie', f: 'DnD Efreeti.png' },
    { q: 'gargoyle', f: 'DnD Gargoyle.png' },
    { q: 'ghoul undead', f: 'DnD Ghoul.png' },
    { q: 'giant frost hill stone fire', f: 'DnD Giant.png' },
    { q: 'gnoll hyena', f: 'DnD Gnoll.png' },
    { q: 'goblin', f: 'DnD Goblin.png' },
    { q: 'gorgon bull', f: 'Dnd Gorgon.png' },
    { q: 'gray ooze grey slime', f: 'DnD Gray Ooze.png' },
    { q: 'griffon griffin', f: 'DnD Griffon.png' },
    { q: 'hippogriff', f: 'DnD Hippogriff.png' },
    { q: 'hobgoblin', f: 'DnD Hobgoblin.png' },
    { q: 'hydra', f: 'DnD Hydra.png' },
    { q: 'invisible stalker air', f: 'DnD Invisible stalker.png' },
    { q: 'kobold', f: 'DnD kobold.png' },
    { q: 'werewolf lycanthrope wolf', f: 'DnD Lycantrop.png' },
    { q: 'manticore', f: 'DnD Manticore.png' },
    { q: 'medusa snake gorgon', f: 'DnD Medusa.png' },
    { q: 'minotaur bull', f: 'DnD Minotaur.png' },
    { q: 'mummy undead', f: 'DnD Mummy.png' },
    { q: 'ochre jelly ooze', f: 'DnD Ochre Jelly.png' },
    { q: 'ogre', f: 'DnD Ogre.png' },
    { q: 'orc', f: 'DnD Orc.png' },
    { q: 'pegasus horse winged', f: 'DnD Pegasus.png' },
    { q: 'purple worm', f: 'DnD PurpleWorm.png' },
    { q: 'roc bird giant eagle', f: 'DnD Roc.png' },
    { q: 'skeleton undead', f: 'DnD skelleton.png' },
    { q: 'specter spectre ghost undead', f: 'DnD Spectre.png' },
    { q: 'earth elemental stone', f: 'DnD Stone Elemental.png' },
    { q: 'treant tree ent', f: 'DnD treant.png' },
    { q: 'troll', f: 'DnD Troll.png' },
    { q: 'unicorn horse', f: 'DnD Unicorn.png' },
    { q: 'sprite pixie fairy fey', f: 'DnD Pixie.jpg' },
    // --- animals & beasts (Pearson Scott Foresman) ---
    { q: 'ape gorilla', f: 'Ape1 (PSF).png' },
    { q: 'baboon monkey', f: 'Baboon (PSF).png' },
    { q: 'badger', f: 'Badger (PSF).png' },
    { q: 'bat', f: 'Bat (PSF).jpg' },
    { q: 'boar pig', f: 'Boar (PSF).png' },
    { q: 'crab', f: 'Crab (PSF).png' },
    { q: 'crocodile alligator', f: 'Crocodile (PSF).png' },
    { q: 'deer stag', f: 'Deer 1 (PSF).png' },
    { q: 'eagle bird', f: 'Bald Eagle (PSF).png' },
    { q: 'elk moose', f: 'Elk 1 (PSF).png' },
    { q: 'goat', f: 'Goat (PSF).png' },
    { q: 'hawk bird', f: 'Hawk (PSF).png' },
    { q: 'hyena', f: 'Hyena (PSF).png' },
    { q: 'jackal dog', f: 'Jackal (PSF).png' },
    { q: 'lion cat', f: 'Lion (PSF).png' },
    { q: 'owl bird', f: 'Owl (PSF).png' },
    { q: 'scorpion', f: 'Scorpion (PSF).png' },
    { q: 'wolf dog', f: 'Wolf (PSF) cleaned 2.png' },
    { q: 'tiger cat', f: 'Tiger 2 (PSF).png' },
    { q: 'vulture bird', f: 'Vulture 2 (PSF).png' },
    { q: 'weasel', f: 'Weasel (PSF).png' },
    { q: 'camel', f: 'Camel (PSF).jpg' },
    { q: 'cat', f: 'Cat (Siamese) (PSF).jpg' },
    { q: 'polar bear', f: 'Polar Bear (PSF).png' },
    { q: 'black bear brown bear', f: 'Black bear (PSF).png' },
    { q: 'octopus kraken', f: 'Octopus (PSF).png' },
    { q: 'triceratops dinosaur', f: 'Triceratops (PSF).png' },
    { q: 'tyrannosaurus rex dinosaur trex', f: 'Tyrannosaurus (PSF).png' },
    { q: 'plesiosaur dinosaur sea', f: 'Plesiosaur (PSF).png' },
    { q: 'sphinx', f: 'Sphinx (PSF).png' },
    { q: 'centipede', f: 'Centipede (PSF).png' },
    { q: 'mule donkey', f: 'Mule (PSF).png' },
    { q: 'warhorse horse riding', f: 'Horse (PSF).png' },
    { q: 'shark reef', f: 'Shark (PSF).png' },
    { q: 'hunter shark hammerhead', f: 'Hammerhead Shark (PSF).png' },
    { q: 'satyr faun', f: 'Satyr (PSF).png' },
    { q: 'lizard iguana', f: 'Iguana (PSF).png' },
    { q: 'giant lizard monitor', f: 'Monitor Lizard (PSF).png' },
    { q: 'snake serpent rattlesnake poisonous', f: 'Rattlesnake Mivart.png' },
    { q: 'frog toad', f: 'Bullfrog (PSF).jpg' },
    { q: 'mammoth elephant', f: 'Woolly mammoths.jpg' },
    // --- humanoid NPCs (via period gear / figures) ---
    { q: 'bandit thief cutlass rogue', f: 'Cutlass (PSF).jpg' },
    { q: 'guard soldier chainmail', f: 'Mail (PSF).png' },
    { q: 'knight helmet veteran', f: 'Helmet - Medieval Knight (PSF).png' },
    { q: 'mage wizard robe', f: 'Caftan 2 (PSF).png' },
    { q: 'priest cleric acolyte cope', f: 'Cope (PSF).png' },
    { q: 'scout archer bowman ranger', f: 'Bowman (PSF).png' },
    { q: 'thug commoner humanoid', f: 'Humanoid (PSF).png' },
  ];

  // Place art for cities — matched by keyword against city name/kind, in order.
  window.PD_PLACE = [
    { k: 'port harbor harbour dock', f: 'Quay (PSF).png' },
    { k: 'hold mountain dwarf forge iron', f: 'Forge (PSF).png' },
    { k: 'keep fort castle citadel', f: 'Castle (PSF).png' },
    { k: 'tower spire', f: 'Tower (PSF).png' },
    { k: 'temple shrine cathedral holy', f: 'Cathedral (PSF).jpg' },
    { k: 'village hamlet farm brook', f: 'Thatch hut (PSF).png' },
    { k: 'city capital', f: 'American art and American art collections; essays on artistic subjects (1889) (14596602947).jpg' },
    { k: 'town', f: 'Half - Timbered (PSF).png' },
  ];
  window.pdPlaceFor = (city) => {
    const hay = ((city && city.name || '') + ' ' + (city && city.kind || '')).toLowerCase();
    for (const p of window.PD_PLACE) if (p.k.split(' ').some((w) => hay.includes(w))) return p.f;
    return 'Half - Timbered (PSF).png';
  };
})();
