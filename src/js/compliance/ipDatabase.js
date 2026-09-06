/**
 * IP Compliance Database — V0.1.1
 *
 * Unified entry schema:
 *   { id, name, type, owner, aliases, keywords, policy }
 *
 * type:   character | brand | likeness
 * policy: { riskLevel: HIGH | MEDIUM | LOW }
 *
 * Sources: CopyCat (Princeton NLP, arXiv:2406.14526), GAI_IP_Infringement (Sony AI).
 */

export const IPType = Object.freeze({
  CHARACTER: 'character',
  BRAND: 'brand',
  LIKENESS: 'likeness',
});

export const RiskCategory = IPType;

// ---------------------------------------------------------------------------
// Character IP — 51 entries
// ---------------------------------------------------------------------------

const CHARACTER_IP = [
  { id: 'ip001', name: 'Mickey Mouse', type: IPType.CHARACTER, owner: 'Disney', aliases: ['mickey', 'mickey mouse', 'mr mouse'], keywords: ['mouse ears', 'round ears', 'red shorts', 'white gloves', 'yellow shoes'], policy: { riskLevel: 'HIGH', maxAction: 'BLOCK' } },
  { id: 'ip002', name: 'Mario', type: IPType.CHARACTER, owner: 'Nintendo', aliases: ['super mario', 'mario bros'], keywords: ['plumber', 'red cap', 'red hat', 'blue overalls', 'mushroom', 'super star', 'fire flower'], policy: { riskLevel: 'HIGH', maxAction: 'BLOCK' } },
  { id: 'ip003', name: 'Spider-Man', type: IPType.CHARACTER, owner: 'Marvel', aliases: ['spiderman', 'spider man', 'peter parker', 'spidey'], keywords: ['web shooter', 'red and blue suit', 'web pattern', 'spider symbol', 'wall crawling'], policy: { riskLevel: 'HIGH', maxAction: 'BLOCK' } },
  { id: 'ip004', name: 'Batman', type: IPType.CHARACTER, owner: 'DC Comics', aliases: ['the batman', 'bat man', 'bruce wayne', 'the dark knight', 'caped crusader'], keywords: ['bat symbol', 'cape and cowl', 'utility belt', 'batmobile', 'gotham', 'dark knight'], policy: { riskLevel: 'HIGH', maxAction: 'BLOCK' } },
  { id: 'ip005', name: 'Superman', type: IPType.CHARACTER, owner: 'DC Comics', aliases: ['super man', 'clark kent', 'man of steel'], keywords: ['s symbol', 'cape', 'blue suit', 'red boots', 'flying', 'metropolis', 'fortress of solitude'], policy: { riskLevel: 'HIGH', maxAction: 'BLOCK' } },
  { id: 'ip006', name: 'Iron Man', type: IPType.CHARACTER, owner: 'Marvel', aliases: ['ironman', 'tony stark', 'the iron man'], keywords: ['arc reactor', 'red and gold armor', 'iron suit', 'repulsor', 'jarvis'], policy: { riskLevel: 'HIGH', maxAction: 'BLOCK' } },
  { id: 'ip007', name: 'Captain America', type: IPType.CHARACTER, owner: 'Marvel', aliases: ['cap', 'steve rogers'], keywords: ['vibranium shield', 'star on chest', 'red white blue', 'shield throw'], policy: { riskLevel: 'HIGH', maxAction: 'BLOCK' } },
  { id: 'ip008', name: 'Black Panther', type: IPType.CHARACTER, owner: 'Marvel', aliases: ['t\'challa', 'tchalla', 'king of wakanda'], keywords: ['vibranium suit', 'wakanda', 'panther habit', 'cat king'], policy: { riskLevel: 'HIGH', maxAction: 'BLOCK' } },
  { id: 'ip009', name: 'Thor', type: IPType.CHARACTER, owner: 'Marvel', aliases: ['thor odinson', 'god of thunder'], keywords: ['mjolnir', 'stormbreaker', 'lightning', 'asgard', 'bifrost', 'winged helmet'], policy: { riskLevel: 'HIGH', maxAction: 'BLOCK' } },
  { id: 'ip010', name: 'Hulk', type: IPType.CHARACTER, owner: 'Marvel', aliases: ['incredible hulk', 'bruce banner', 'the hulk'], keywords: ['green skin', 'huge muscles', 'smash', 'rage'], policy: { riskLevel: 'HIGH', maxAction: 'BLOCK' } },
  { id: 'ip011', name: 'Thanos', type: IPType.CHARACTER, owner: 'Marvel', aliases: ['the mad titan'], keywords: ['infinity gauntlet', 'purple skin', 'infinity stones', 'snap', 'chin cleft'], policy: { riskLevel: 'HIGH', maxAction: 'BLOCK' } },
  { id: 'ip012', name: 'Pikachu', type: IPType.CHARACTER, owner: 'Nintendo / The Pokémon Company', aliases: ['pika pika'], keywords: ['electric mouse', 'yellow fur', 'red cheeks', 'lightning bolt tail', 'thunderbolt'], policy: { riskLevel: 'HIGH', maxAction: 'BLOCK' } },
  { id: 'ip013', name: 'Sonic The Hedgehog', type: IPType.CHARACTER, owner: 'Sega', aliases: ['sonic'], keywords: ['blue hedgehog', 'red shoes', 'golden rings', 'speed', 'spin dash'], policy: { riskLevel: 'HIGH', maxAction: 'BLOCK' } },
  { id: 'ip014', name: 'Link', type: IPType.CHARACTER, owner: 'Nintendo', aliases: ['the hero of time'], keywords: ['green tunic', 'hylian shield', 'master sword', 'elf ears', 'triforce', 'hyrule'], policy: { riskLevel: 'HIGH', maxAction: 'BLOCK' } },
  { id: 'ip015', name: 'Doraemon', type: IPType.CHARACTER, owner: 'Shin-Ei Animation / Fujiko F. Fujio', aliases: ['doraemon cat', 'machine cat'], keywords: ['blue robot cat', 'fourth dimensional pocket', 'copper', 'no ears', 'round body'], policy: { riskLevel: 'HIGH', maxAction: 'BLOCK' } },
  { id: 'ip016', name: 'Naruto', type: IPType.CHARACTER, owner: 'Pierrot / Shueisha', aliases: ['naruto uzumaki', 'naruto uzumake'], keywords: ['leaf headband', 'orange jumpsuit', 'whisker marks', 'rasengan', 'nine tails', 'konoha'], policy: { riskLevel: 'HIGH', maxAction: 'BLOCK' } },
  { id: 'ip017', name: 'Monkey D. Luffy', type: IPType.CHARACTER, owner: 'Toei Animation / Shueisha', aliases: ['luffy', 'straw hat luffy'], keywords: ['straw hat', 'rubber body', 'gum gum', 'one piece', 'pirate king'], policy: { riskLevel: 'HIGH', maxAction: 'BLOCK' } },
  { id: 'ip018', name: 'SpongeBob SquarePants', type: IPType.CHARACTER, owner: 'Nickelodeon', aliases: ['spongebob', 'sponge bob'], keywords: ['yellow sponge', 'square pants', 'krusty krab', 'patrick', 'bikini bottom'], policy: { riskLevel: 'HIGH', maxAction: 'BLOCK' } },
  { id: 'ip019', name: 'Pac-Man', type: IPType.CHARACTER, owner: 'Bandai Namco', aliases: ['pacman', 'pac man'], keywords: ['yellow circle', 'maze', 'ghosts', 'power pellet', 'waka waka'], policy: { riskLevel: 'HIGH', maxAction: 'BLOCK' } },
  { id: 'ip020', name: 'Kirby', type: IPType.CHARACTER, owner: 'HAL Laboratory', aliases: ['king dedede'], keywords: ['pink ball', 'copy ability', 'star rod', 'dream land', 'inhale'], policy: { riskLevel: 'HIGH', maxAction: 'BLOCK' } },
  { id: 'ip021', name: 'Elsa', type: IPType.CHARACTER, owner: 'Disney', aliases: ['elsa of arendelle', 'snow queen', 'frozen queen'], keywords: ['ice powers', 'frozen', 'let it go', 'ice castle', 'blonde braid', 'blue dress'], policy: { riskLevel: 'HIGH', maxAction: 'BLOCK' } },
  { id: 'ip022', name: 'Cinderella', type: IPType.CHARACTER, owner: 'Disney', aliases: ['cinderella princess'], keywords: ['glass slipper', 'pumpkin carriage', 'blue dress', 'fairy godmother', 'midnight'], policy: { riskLevel: 'HIGH', maxAction: 'BLOCK' } },
  { id: 'ip023', name: 'Snow White', type: IPType.CHARACTER, owner: 'Disney', aliases: ['snow white princess'], keywords: ['seven dwarfs', 'apple', 'evil queen', 'magic mirror', 'blue and yellow dress'], policy: { riskLevel: 'HIGH', maxAction: 'BLOCK' } },
  { id: 'ip024', name: 'Rapunzel', type: IPType.CHARACTER, owner: 'Disney', aliases: ['tangled rapunzel'], keywords: ['long golden hair', 'frying pan', 'tower', 'floating lights', 'purple dress'], policy: { riskLevel: 'HIGH', maxAction: 'BLOCK' } },
  { id: 'ip025', name: 'Ariel', type: IPType.CHARACTER, owner: 'Disney', aliases: ['ariel mermaid', 'little mermaid'], keywords: ['mermaid', 'red hair', 'seashell bikini', 'green tail', 'under the sea', 'triton'], policy: { riskLevel: 'HIGH', maxAction: 'BLOCK' } },
  { id: 'ip026', name: 'Princess Jasmine', type: IPType.CHARACTER, owner: 'Disney', aliases: ['jasmine', 'aladdin jasmine'], keywords: ['tiger', 'magic carpet', 'agrabah', 'blue harem pants', 'gold tiara'], policy: { riskLevel: 'HIGH', maxAction: 'BLOCK' } },
  { id: 'ip027', name: 'Maleficent', type: IPType.CHARACTER, owner: 'Disney', aliases: ['maleficent mistress of evil'], keywords: ['black horns', 'green fire', 'raven', 'dark fairy', 'black wings', 'staff'], policy: { riskLevel: 'HIGH', maxAction: 'BLOCK' } },
  { id: 'ip028', name: 'Peter Pan', type: IPType.CHARACTER, owner: 'Disney', aliases: ['peter pan boy'], keywords: ['flying', 'neverland', 'tinker bell', 'lost boys', 'captain hook', 'green tights'], policy: { riskLevel: 'HIGH', maxAction: 'BLOCK' } },
  { id: 'ip029', name: 'Tinker Bell', type: IPType.CHARACTER, owner: 'Disney', aliases: ['tinkerbell', 'tink'], keywords: ['fairy', 'pixie dust', 'wings', 'green dress', 'blonde ponytail'], policy: { riskLevel: 'HIGH', maxAction: 'BLOCK' } },
  { id: 'ip030', name: 'Winnie-the-Pooh', type: IPType.CHARACTER, owner: 'Disney / A.A. Milne', aliases: ['winnie the pooh', 'pooh bear', 'winnie'], keywords: ['yellow bear', 'red shirt', 'honey pot', 'hundred acre wood', 'piglet'], policy: { riskLevel: 'HIGH', maxAction: 'BLOCK' } },
  { id: 'ip031', name: 'Piglet', type: IPType.CHARACTER, owner: 'Disney / A.A. Milne', aliases: ['piglet pig'], keywords: ['small pig', 'pink', 'scarf', 'timid', 'hundred acre wood'], policy: { riskLevel: 'HIGH', maxAction: 'BLOCK' } },
  { id: 'ip032', name: 'Donald Duck', type: IPType.CHARACTER, owner: 'Disney', aliases: ['donald'], keywords: ['white feathers', 'blue sailor shirt', 'red bow tie', 'no pants', 'temper'], policy: { riskLevel: 'HIGH', maxAction: 'BLOCK' } },
  { id: 'ip033', name: 'Goofy', type: IPType.CHARACTER, owner: 'Disney', aliases: ['goofy dog'], keywords: ['tall hat', 'vest', 'clumsy', 'gawrsh', 'orange turtleneck'], policy: { riskLevel: 'HIGH', maxAction: 'BLOCK' } },
  { id: 'ip034', name: 'Buzz Lightyear', type: IPType.CHARACTER, owner: 'Pixar', aliases: ['buzz'], keywords: ['space ranger', 'laser', 'wings', 'to infinity and beyond', 'purple and green'], policy: { riskLevel: 'HIGH', maxAction: 'BLOCK' } },
  { id: 'ip035', name: 'Woody', type: IPType.CHARACTER, owner: 'Pixar', aliases: ['sheriff woody'], keywords: ['cowboy', 'pull string', 'sheriff badge', 'bo peep', 'toy story'], policy: { riskLevel: 'HIGH', maxAction: 'BLOCK' } },
  { id: 'ip036', name: 'Nemo', type: IPType.CHARACTER, owner: 'Pixar', aliases: ['nemo fish'], keywords: ['clownfish', 'orange and white', 'small fin', 'reef', 'dory'], policy: { riskLevel: 'HIGH', maxAction: 'BLOCK' } },
  { id: 'ip037', name: 'Mr. Incredible', type: IPType.CHARACTER, owner: 'Pixar', aliases: ['mr incredible', 'incredible', 'bob parr'], keywords: ['super strength', 'red suit', 'incredibles', 'elastic girl'], policy: { riskLevel: 'HIGH', maxAction: 'BLOCK' } },
  { id: 'ip038', name: 'Wall-E', type: IPType.CHARACTER, owner: 'Pixar', aliases: ['wall e', 'walle'], keywords: ['trash robot', 'compactor', 'eve', 'plant', 'binocular eyes'], policy: { riskLevel: 'HIGH', maxAction: 'BLOCK' } },
  { id: 'ip039', name: 'Olaf', type: IPType.CHARACTER, owner: 'Disney', aliases: ['olaf snowman'], keywords: ['snowman', 'carrot nose', 'summer', 'warm hugs', 'stick arms'], policy: { riskLevel: 'HIGH', maxAction: 'BLOCK' } },
  { id: 'ip040', name: 'Groot', type: IPType.CHARACTER, owner: 'Marvel', aliases: ['baby groot', 'i am groot'], keywords: ['tree creature', 'i am groot', 'sprout', 'guardians', 'wooden body'], policy: { riskLevel: 'HIGH', maxAction: 'BLOCK' } },
  { id: 'ip041', name: 'Yoda', type: IPType.CHARACTER, owner: 'Lucasfilm', aliases: ['master yoda'], keywords: ['green skin', 'pointed ears', 'small old', 'lightsaber', 'the force', 'jedi master'], policy: { riskLevel: 'HIGH', maxAction: 'BLOCK' } },
  { id: 'ip042', name: 'Astro Boy', type: IPType.CHARACTER, owner: 'Tezuka Productions', aliases: ['astroboy', 'mighty atom', 'tetsuwan atom'], keywords: ['robot boy', 'jet boots', 'pointy hair', 'red boots', 'atom'], policy: { riskLevel: 'HIGH', maxAction: 'BLOCK' } },
  { id: 'ip043', name: 'Cuphead', type: IPType.CHARACTER, owner: 'Studio MDHR', aliases: ['cup head'], keywords: ['cup head', 'straw', '1930s cartoon', 'rubber hose', 'mugman'], policy: { riskLevel: 'HIGH', maxAction: 'BLOCK' } },
  { id: 'ip044', name: 'Kung Fu Panda', type: IPType.CHARACTER, owner: 'DreamWorks', aliases: ['po', 'po panda', 'dragon warrior'], keywords: ['panda', 'martial arts', 'dragon scroll', 'furious five', 'noodles'], policy: { riskLevel: 'HIGH', maxAction: 'BLOCK' } },
  { id: 'ip045', name: 'Puss in Boots', type: IPType.CHARACTER, owner: 'DreamWorks', aliases: ['puss in boots cat'], keywords: ['cat', 'boots', 'hat with feather', 'sword', 'shrek', 'spanish accent'], policy: { riskLevel: 'HIGH', maxAction: 'BLOCK' } },
  { id: 'ip046', name: 'Lightning McQueen', type: IPType.CHARACTER, owner: 'Pixar', aliases: ['mcqueen', 'lightning mcqueen'], keywords: ['red race car', 'ka-chow', 'number 95', 'rust-eze', 'radiator springs'], policy: { riskLevel: 'HIGH', maxAction: 'BLOCK' } },
  { id: 'ip047', name: 'Chun-Li', type: IPType.CHARACTER, owner: 'Capcom', aliases: ['chun li'], keywords: ['blue qipao', 'ox horns hair', 'strong legs', 'street fighter', 'spinning bird kick'], policy: { riskLevel: 'HIGH', maxAction: 'BLOCK' } },
  { id: 'ip048', name: 'Judy Hopps', type: IPType.CHARACTER, owner: 'Disney', aliases: ['judy', 'officer hopps'], keywords: ['rabbit officer', 'purple eyes', 'zootopia', 'police bunny', 'nick wilde'], policy: { riskLevel: 'HIGH', maxAction: 'BLOCK' } },
  { id: 'ip049', name: 'Mike Wazowski', type: IPType.CHARACTER, owner: 'Pixar', aliases: ['mike wazowski', 'mike'], keywords: ['one eye', 'green monster', 'monsters inc', 'sulley', 'scarer'], policy: { riskLevel: 'HIGH', maxAction: 'BLOCK' } },
  { id: 'ip050', name: 'Squirtle', type: IPType.CHARACTER, owner: 'Nintendo / The Pokémon Company', aliases: ['squirtle turtle'], keywords: ['turtle', 'water gun', 'shell on back', 'blue', 'pokémon'], policy: { riskLevel: 'HIGH', maxAction: 'BLOCK' } },
  { id: 'ip051', name: 'Bulbasaur', type: IPType.CHARACTER, owner: 'Nintendo / The Pokémon Company', aliases: ['bulbasaur dinosaur'], keywords: ['bulb on back', 'green dinosaur', 'vine whip', 'seed', 'pokémon'], policy: { riskLevel: 'HIGH', maxAction: 'BLOCK' } },
];

// ---------------------------------------------------------------------------
// Brand / Trademark IP
// ---------------------------------------------------------------------------

const BRAND_IP = [
  { id: 'ip052', name: 'Nike', type: IPType.BRAND, owner: 'Nike Inc.', aliases: ['nike swoosh', 'just do it'], keywords: ['swoosh', 'just do it'], policy: { riskLevel: 'HIGH', maxAction: 'BLOCK' } },
  { id: 'ip053', name: 'Coca-Cola', type: IPType.BRAND, owner: 'The Coca-Cola Company', aliases: ['coca cola', 'coke'], keywords: ['red can', 'contour bottle', 'coca cola'], policy: { riskLevel: 'HIGH', maxAction: 'BLOCK' } },
  { id: 'ip054', name: 'Apple', type: IPType.BRAND, owner: 'Apple Inc.', aliases: ['apple logo', 'apple inc'], keywords: ['apple logo', 'bitten apple', 'macbook', 'iphone'], policy: { riskLevel: 'HIGH', maxAction: 'BLOCK' } },
  { id: 'ip055', name: 'Ferrari', type: IPType.BRAND, owner: 'Ferrari N.V.', aliases: ['ferrari car'], keywords: ['prancing horse', 'red car', 'ferrari logo'], policy: { riskLevel: 'HIGH', maxAction: 'BLOCK' } },
  { id: 'ip056', name: 'McDonald\'s', type: IPType.BRAND, owner: 'McDonald\'s Corp.', aliases: ['mcdonalds', 'mcdonald'], keywords: ['golden arches', 'big mac', 'mcdonald\'s', 'happy meal'], policy: { riskLevel: 'HIGH', maxAction: 'BLOCK' } },
  { id: 'ip057', name: 'Louis Vuitton', type: IPType.BRAND, owner: 'LVMH', aliases: ['louis vuitton', 'lv'], keywords: ['lv monogram', 'lv pattern', 'damier'], policy: { riskLevel: 'HIGH', maxAction: 'BLOCK' } },
  { id: 'ip058', name: 'Google', type: IPType.BRAND, owner: 'Alphabet Inc.', aliases: ['google logo'], keywords: ['google logo', 'google search'], policy: { riskLevel: 'HIGH', maxAction: 'BLOCK' } },
  { id: 'ip059', name: 'Mercedes-Benz', type: IPType.BRAND, owner: 'Mercedes-Benz Group', aliases: ['mercedes', 'benz'], keywords: ['three pointed star', 'mercedes logo'], policy: { riskLevel: 'HIGH', maxAction: 'BLOCK' } },
  { id: 'ip060', name: 'Starbucks', type: IPType.BRAND, owner: 'Starbucks Corp.', aliases: ['starbucks coffee'], keywords: ['siren logo', 'green cup', 'frappuccino'], policy: { riskLevel: 'HIGH', maxAction: 'BLOCK' } },
  { id: 'ip061', name: 'Adidas', type: IPType.BRAND, owner: 'Adidas AG', aliases: ['adidas logo'], keywords: ['three stripes', 'trefoil', 'adidas'], policy: { riskLevel: 'HIGH', maxAction: 'BLOCK' } },
];

// ---------------------------------------------------------------------------
// Likeness (real people)
// ---------------------------------------------------------------------------

const LIKENESS_IP = [
  { id: 'ip062', name: 'Taylor Swift', type: IPType.LIKENESS, owner: null, aliases: ['taylor swift singer'], keywords: [], policy: { riskLevel: 'MEDIUM', maxAction: 'WARN' } },
  { id: 'ip063', name: 'Elon Musk', type: IPType.LIKENESS, owner: null, aliases: ['elon musk'], keywords: [], policy: { riskLevel: 'MEDIUM', maxAction: 'WARN' } },
  { id: 'ip064', name: 'Donald Trump', type: IPType.LIKENESS, owner: null, aliases: ['trump', 'president trump'], keywords: [], policy: { riskLevel: 'MEDIUM', maxAction: 'WARN' } },
  { id: 'ip065', name: 'Beyoncé', type: IPType.LIKENESS, owner: null, aliases: ['beyonce', 'beyonce knowles'], keywords: [], policy: { riskLevel: 'MEDIUM', maxAction: 'WARN' } },
  { id: 'ip066', name: 'Tom Cruise', type: IPType.LIKENESS, owner: null, aliases: ['tom cruise'], keywords: [], policy: { riskLevel: 'MEDIUM', maxAction: 'WARN' } },
];

// ---------------------------------------------------------------------------
// Build indexes
// ---------------------------------------------------------------------------

const ALL_IP = [...CHARACTER_IP, ...BRAND_IP, ...LIKENESS_IP];

const _nameIndex = new Map();
const _aliasIndex = new Map();
const _keywordIndex = [];

function _normalize(s) {
  return s.toLowerCase().replace(/['\u2019]/g, '').replace(/[^a-z0-9\u4e00-\u9fff\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

for (const entry of ALL_IP) {
  const normName = _normalize(entry.name);
  _nameIndex.set(normName, entry);
  for (const alias of entry.aliases) {
    _aliasIndex.set(_normalize(alias), entry);
  }
  for (const kw of entry.keywords) {
    _keywordIndex.push({ keyword: _normalize(kw), entry });
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function getDatabase() {
  return { characters: CHARACTER_IP, brands: BRAND_IP, likeness: LIKENESS_IP, all: ALL_IP };
}

export function getNameIndex() { return _nameIndex; }
export function getAliasIndex() { return _aliasIndex; }
export function getKeywordIndex() { return _keywordIndex; }
export function normalize(s) { return _normalize(s); }
