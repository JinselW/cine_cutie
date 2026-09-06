/**
 * IP Matcher Engine — V0.1.1
 *
 * Evidence-only matcher: returns structured match evidence, no verdict.
 * The policy layer (IPComplianceAgent) interprets evidence → verdict.
 *
 * Matching layers:
 *   1. Exact match  — canonical name at word boundary
 *   2. Alias match  — known alias at word boundary
 *   3. Fuzzy match  — Levenshtein distance on name/alias words
 *   4. Keyword match — indirect descriptor keywords (candidate clue only)
 */

import { getNameIndex, getAliasIndex, getKeywordIndex, normalize } from './ipDatabase.js';

export const MatchType = Object.freeze({
  NONE: 'NONE',
  EXACT: 'EXACT',
  ALIAS: 'ALIAS',
  FUZZY: 'FUZZY',
  KEYWORD: 'KEYWORD',
  SEMANTIC: 'SEMANTIC',
  VISUAL: 'VISUAL',
  LVLM: 'LVLM',
});

export const IPStatus = Object.freeze({
  SAFE: 'SAFE',
  KNOWN_IP: 'KNOWN_IP',
  POSSIBLE_IP: 'POSSIBLE_IP',
  UNKNOWN: 'UNKNOWN',
});

// ---------------------------------------------------------------------------
// Levenshtein distance (iterative, two-row)
// ---------------------------------------------------------------------------

function levenshtein(a, b) {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let curr = new Array(b.length + 1);

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + cost,
      );
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}

function normalizedSimilarity(a, b) {
  const dist = levenshtein(a, b);
  const maxLen = Math.max(a.length, b.length);
  return maxLen === 0 ? 1 : 1 - dist / maxLen;
}

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

function extractWordNgrams(text, maxN = 4) {
  const words = text.split(/\s+/).filter(w => w.length > 0);
  const ngrams = [];
  for (let n = 1; n <= Math.min(maxN, words.length); n++) {
    for (let i = 0; i <= words.length - n; i++) {
      ngrams.push({ phrase: words.slice(i, i + n).join(' '), start: i, end: i + n });
    }
  }
  return ngrams;
}

// ---------------------------------------------------------------------------
// Layer 1: Exact match (word-boundary, case-insensitive)
// ---------------------------------------------------------------------------

function wordBoundaryRegex(escaped) {
  return new RegExp(`(?<![a-z0-9\u4e00-\u9fff])${escaped}(?![a-z0-9\u4e00-\u9fff])`);
}

function exactMatch(textNorm, nameIndex, aliasIndex) {
  const hits = [];

  for (const [normName, entry] of nameIndex) {
    const escaped = normName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (wordBoundaryRegex(escaped).test(textNorm)) {
      hits.push(makeHit(entry, MatchType.EXACT, 1.0, normName));
    }
  }

  for (const [normAlias, entry] of aliasIndex) {
    if (hits.some(h => h.entry === entry && h.matchType === MatchType.EXACT)) continue;
    const escaped = normAlias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (wordBoundaryRegex(escaped).test(textNorm)) {
      hits.push(makeHit(entry, MatchType.ALIAS, 0.95, normAlias));
    }
  }

  return hits;
}

// ---------------------------------------------------------------------------
// Layer 2: Fuzzy match (Levenshtein on individual words)
// ---------------------------------------------------------------------------

const FUZZY_THRESHOLD_BLOCK = 0.85;
const FUZZY_THRESHOLD_WARN = 0.70;

const FUZZY_STOPWORDS = new Set([
  'man', 'the', 'boy', 'girl', 'red', 'blue', 'big', 'bad', 'new', 'old',
  'hero', 'villain', 'dark', 'good', 'evil', 'war', 'love', 'king', 'queen',
  'son', 'god', 'day', 'night', 'fire', 'ice', 'star', 'sun', 'moon',
  'super', 'magic', 'wild', 'fast', 'strong', 'young', 'black', 'white',
  'green', 'yellow', 'gold', 'silver', 'iron', 'steel', 'power', 'storm',
]);

const FULL_NAME_THRESHOLD = 0.80;

function fuzzyMatch(textNorm, nameIndex, aliasIndex) {
  const textWords = textNorm.split(/\s+/).filter(w => w.length > 1);
  const hits = [];
  const seen = new Set();

  const allNames = [...nameIndex.entries(), ...aliasIndex.entries()];

  for (const [normName, entry] of allNames) {
    const nameWords = normName.split(/\s+/);
    const iterHits = [];
    const matchedNameWords = new Set();

    for (const nameWord of nameWords) {
      if (nameWord.length < 5 || FUZZY_STOPWORDS.has(nameWord)) continue;
      for (const textWord of textWords) {
        if (textWord.length < 5 || FUZZY_STOPWORDS.has(textWord)) continue;
        const sim = normalizedSimilarity(nameWord, textWord);
        if (sim >= FUZZY_THRESHOLD_WARN) {
          const key = `${entry.name}:${textWord}`;
          if (seen.has(key)) continue;
          seen.add(key);
          matchedNameWords.add(nameWord);
          iterHits.push(makeHit(entry, MatchType.FUZZY, sim, textWord, nameWord));
        }
      }
    }

    if (matchedNameWords.size > 0 && nameWords.length > 1) {
      const coverage = matchedNameWords.size / nameWords.length;
      if (coverage < 1) {
        for (const hit of iterHits) {
          hit.confidence *= coverage;
        }
      }
    }

    hits.push(...iterHits.filter(h => h.confidence >= FUZZY_THRESHOLD_WARN));

    const nameNoSpaces = normName.replace(/\s+/g, '');
    if (nameNoSpaces.length >= 4) {
      const textJoined = textWords.filter(w => !FUZZY_STOPWORDS.has(w) && w.length >= 3).join('');
      if (textJoined.length >= 4) {
        const sim = normalizedSimilarity(nameNoSpaces, textJoined);
        if (sim >= FULL_NAME_THRESHOLD) {
          const key = `${entry.name}:__fullname__`;
          if (!seen.has(key)) {
            seen.add(key);
            hits.push(makeHit(entry, MatchType.FUZZY, sim, textJoined, nameNoSpaces));
          }
        }
      }
    }
  }

  return hits;
}

// ---------------------------------------------------------------------------
// Layer 3: Keyword match (indirect descriptors — candidate clues only)
// ---------------------------------------------------------------------------

function keywordMatch(textNorm, keywordIndex) {
  const hits = [];
  const seen = new Set();

  for (const { keyword, entry } of keywordIndex) {
    if (keyword.length < 3) continue;
    if (textNorm.includes(keyword)) {
      const key = entry.name;
      if (seen.has(key)) continue;
      seen.add(key);
      hits.push(makeHit(entry, MatchType.KEYWORD, 0.6, keyword));
    }
  }

  return hits;
}

// ---------------------------------------------------------------------------
// Hit factory
// ---------------------------------------------------------------------------

function makeHit(entry, matchType, confidence, matchedText, targetWord) {
  const desc = targetWord
    ? `"${matchedText}" ≈ "${targetWord}" (${matchType}, sim=${confidence.toFixed(2)})`
    : `"${matchedText}" → ${entry.name} (${matchType})`;

  return {
    entry,
    matchType,
    confidence,
    matchedText,
    targetWord: targetWord || null,
    evidence: desc,
  };
}

// ---------------------------------------------------------------------------
// Aggregation: deduplicate by entry, keep best match per entry
// ---------------------------------------------------------------------------

function aggregateHits(hits) {
  if (hits.length === 0) {
    return { evidence: [] };
  }

  const matchTypePriority = {
    [MatchType.EXACT]: 4,
    [MatchType.ALIAS]: 3,
    [MatchType.FUZZY]: 2,
    [MatchType.KEYWORD]: 1,
  };

  const bestByEntry = new Map();
  for (const hit of hits) {
    const key = hit.entry.name;
    const existing = bestByEntry.get(key);
    if (!existing) {
      bestByEntry.set(key, hit);
    } else {
      const hitPri = matchTypePriority[hit.matchType] ?? 0;
      const existPri = matchTypePriority[existing.matchType] ?? 0;
      if (hitPri > existPri || (hitPri === existPri && hit.confidence > existing.confidence)) {
        bestByEntry.set(key, hit);
      }
    }
  }

  return { evidence: [...bestByEntry.values()] };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function scanText(text) {
  if (!text || typeof text !== 'string') {
    return { evidence: [] };
  }

  const textNorm = normalize(text);
  const nameIndex = getNameIndex();
  const aliasIndex = getAliasIndex();
  const keywordIndex = getKeywordIndex();

  const hits = [
    ...exactMatch(textNorm, nameIndex, aliasIndex),
    ...fuzzyMatch(textNorm, nameIndex, aliasIndex),
    ...keywordMatch(textNorm, keywordIndex),
  ];

  return aggregateHits(hits);
}

export function scanTexts(texts) {
  const allEvidence = [];

  const matchTypePriority = {
    [MatchType.EXACT]: 4,
    [MatchType.ALIAS]: 3,
    [MatchType.FUZZY]: 2,
    [MatchType.KEYWORD]: 1,
  };

  const deduped = new Map();

  for (const text of texts) {
    const result = scanText(text);
    for (const ev of result.evidence) {
      const key = ev.entry.name;
      const existing = deduped.get(key);
      if (!existing) {
        deduped.set(key, ev);
      } else {
        const mPri = matchTypePriority[ev.matchType] ?? 0;
        const ePri = matchTypePriority[existing.matchType] ?? 0;
        if (mPri > ePri || (mPri === ePri && ev.confidence > existing.confidence)) {
          deduped.set(key, ev);
        }
      }
    }
  }

  return { evidence: [...deduped.values()] };
}
