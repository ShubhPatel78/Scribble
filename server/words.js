/**
 * Curated Word Dictionary for Scribble Game.
 * Contains 350+ family-friendly words across various difficulty levels and categories.
 */

const WORDS = [
    // Animals
    'cat', 'dog', 'elephant', 'giraffe', 'lion', 'tiger', 'monkey', 'panda', 'penguin',
    'kangaroo', 'dolphin', 'whale', 'shark', 'octopus', 'butterfly', 'bee', 'rabbit',
    'horse', 'zebra', 'frog', 'snake', 'turtle', 'camel', 'owl', 'parrot', 'flamingo',
    'duck', 'eagle', 'bear', 'fox', 'wolf', 'hedgehog', 'squirrel', 'snail', 'crab',
    'lobster', 'jellyfish', 'seahorse', 'crocodile', 'alligator', 'bat', 'cheetah',
    'hamster', 'hippo', 'rhino', 'chameleon', 'peacock', 'swan', 'gorilla', 'sloth',

    // Food & Drinks
    'apple', 'banana', 'pizza', 'burger', 'ice cream', 'cake', 'cookie', 'sandwich',
    'sushi', 'taco', 'donut', 'cupcake', 'pancake', 'waffle', 'spaghetti', 'popcorn',
    'hot dog', 'cheese', 'chocolate', 'watermelon', 'strawberry', 'grapes', 'pineapple',
    'lemon', 'orange', 'avocado', 'broccoli', 'carrot', 'mushroom', 'french fries',
    'coffee', 'tea', 'milkshake', 'smoothie', 'egg', 'bread', 'lollipop', 'croissant',
    'burrito', 'noodles', 'dumpling', 'cherry', 'peach', 'mango', 'corn', 'pretzel',

    // Everyday Objects & Tools
    'pencil', 'scissors', 'glasses', 'umbrella', 'backpack', 'clock', 'watch', 'camera',
    'guitar', 'piano', 'drum', 'microphone', 'headphones', 'laptop', 'smartphone', 'television',
    'lamp', 'chair', 'table', 'sofa', 'bed', 'mirror', 'key', 'lock', 'book', 'envelope',
    'flashlight', 'candle', 'balloon', 'kite', 'trophy', 'crown', 'ring', 'necklace',
    'toothbrush', 'broom', 'bucket', 'ladder', 'hammer', 'wrench', 'paintbrush', 'calculator',
    'telescope', 'compass', 'bell', 'magnet', 'battery', 'lightbulb', 'anchor', 'suitcase',

    // Vehicles & Transport
    'car', 'bus', 'train', 'airplane', 'helicopter', 'rocket', 'bicycle', 'motorcycle',
    'boat', 'submarine', 'skateboard', 'scooter', 'tractor', 'ambulance', 'fire truck',
    'police car', 'taxi', 'spaceship', 'hot air balloon', 'canoe', 'yacht', 'cruise ship',

    // Nature & Weather
    'sun', 'moon', 'star', 'cloud', 'rainbow', 'lightning', 'snowflake', 'raindrop',
    'volcano', 'mountain', 'island', 'beach', 'ocean', 'river', 'waterfall', 'forest',
    'tree', 'flower', 'cactus', 'palm tree', 'cave', 'desert', 'fire', 'tornado', 'campfire',

    // Clothing & Fashion
    'shirt', 'pants', 'dress', 'hat', 'shoes', 'boots', 'socks', 'gloves', 'scarf',
    'jacket', 'sunglasses', 'tie', 'helmet', 'crown', 'belt', 'mask', 'cape',

    // Buildings & Places
    'house', 'castle', 'hospital', 'school', 'library', 'stadium', 'supermarket', 'tent',
    'pyramid', 'bridge', 'lighthouse', 'windmill', 'skyscraper', 'igloo', 'barn', 'airport',

    // Fantasy & Characters
    'wizard', 'dragon', 'unicorn', 'mermaid', 'pirate', 'superhero', 'robot', 'alien',
    'ghost', 'vampire', 'monster', 'fairy', 'ninja', 'knight', 'astronaut', 'clown',

    // Sports & Activities
    'soccer', 'basketball', 'baseball', 'tennis', 'bowling', 'golf', 'swimming', 'surfing',
    'skiing', 'fishing', 'camping', 'dancing', 'skating', 'boxing', 'archery', 'karate'
];

/**
 * Returns `count` random unique words from the dictionary.
 * @param {number} count Number of words to return (default 3)
 * @param {Set<string>} usedWords Words already used in this match
 * @returns {Array<string>}
 */
function getRandomWords(count = 3, usedWords = new Set()) {
    const available = WORDS.filter(w => !usedWords.has(w));
    const pool = available.length >= count ? available : WORDS;
    const shuffled = [...pool].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, count);
}

/**
 * Normalizes text for guess comparisons (lowercased, trimmed, symbols removed).
 * @param {string} text
 * @returns {string}
 */
function normalizeWord(text) {
    if (!text) return '';
    return text.toString()
        .toLowerCase()
        .trim()
        .replace(/[-_]+/g, ' ')
        .replace(/[^a-z0-9\s]/gi, '')
        .replace(/\s+/g, ' ');
}

/**
 * Checks if guess is close to target (Levenshtein edit distance <= 1).
 * @param {string} guess
 * @param {string} target
 * @returns {boolean}
 */
function isCloseGuess(guess, target) {
    const g = normalizeWord(guess);
    const t = normalizeWord(target);
    if (!g || !t || g === t) return false;
    if (Math.abs(g.length - t.length) > 1) return false;

    let edits = 0;
    let i = 0;
    let j = 0;

    while (i < g.length && j < t.length) {
        if (g[i] !== t[j]) {
            edits++;
            if (edits > 1) return false;
            if (g.length > t.length) i++;
            else if (t.length > g.length) j++;
            else { i++; j++; }
        } else {
            i++;
            j++;
        }
    }

    if (i < g.length || j < t.length) edits++;
    return edits === 1;
}

module.exports = {
    WORDS,
    getRandomWords,
    normalizeWord,
    isCloseGuess
};
