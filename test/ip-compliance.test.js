/**
 * IPComplianceAgent V0.1.2 — Regression Tests
 *
 * 14 categories:
 *   1. Explicit positive (exact name match)
 *   2. Alias positive
 *   3. Typo/fuzzy positive
 *   4. Indirect keyword positive (WARN only, never BLOCK)
 *   5. Generic description negative
 *   6. Near-miss negative
 *   7. Cross-IP collision
 *   8. Short-word collision
 *   9. Keyword-only case
 *  10. ipStatus taxonomy
 *  11. Likeness policy (maxAction=WARN caps even exact matches)
 *  12. Orchestrator interface
 *  13. Structured result schema
 *  14. Database schema (with maxAction)
 *  15. Policy-driven: confidence ≠ risk ≠ action ≠ verdict separation
 *  16. Policy-driven: maxAction enforcement
 */

import assert from 'node:assert/strict';
import { getIPComplianceAgent, IPStatus, MatchType, getDatabase } from '../src/js/agents/ipComplianceAgent.js';
import { scanText, scanTexts } from '../src/js/compliance/ipMatcher.js';
import { QCVerdict, Severity } from '../src/js/agents/qcTypes.js';

const agent = getIPComplianceAgent();
let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}`);
    console.log(`    ${e.message}`);
  }
}

// =========================================================================
// 1. Explicit positive — exact name match
// =========================================================================
console.log('\n1. Explicit positive (exact name)');

test('canonical name "Spider-Man" → FAIL/KNOWN_IP/CRITICAL', () => {
  const r = agent.checkText('Spider-Man swings through the city');
  assert.equal(r.verdict, QCVerdict.FAIL);
  assert.equal(r.ipStatus, IPStatus.KNOWN_IP);
  assert.equal(r.risk, 'CRITICAL');
  assert.ok(r.findings.some(f => f.candidateIp === 'Spider-Man' && f.matchType === MatchType.EXACT));
});

test('canonical name "Mickey Mouse" → FAIL/KNOWN_IP', () => {
  const r = agent.checkText('a character like Mickey Mouse with round ears');
  assert.equal(r.verdict, QCVerdict.FAIL);
  assert.equal(r.ipStatus, IPStatus.KNOWN_IP);
});

test('canonical name "Batman" → FAIL/KNOWN_IP', () => {
  const r = agent.checkText('Batman patrols Gotham at night');
  assert.equal(r.verdict, QCVerdict.FAIL);
  assert.equal(r.ipStatus, IPStatus.KNOWN_IP);
});

test('canonical name "Pikachu" → FAIL/KNOWN_IP', () => {
  const r = agent.checkText('Pikachu uses thunderbolt');
  assert.equal(r.verdict, QCVerdict.FAIL);
});

// =========================================================================
// 2. Alias positive
// =========================================================================
console.log('\n2. Alias positive');

test('alias "peter parker" → FAIL/KNOWN_IP (Spider-Man)', () => {
  const r = agent.checkText('peter parker saves the day');
  assert.equal(r.verdict, QCVerdict.FAIL);
  assert.equal(r.ipStatus, IPStatus.KNOWN_IP);
  assert.ok(r.findings.some(f => f.candidateIp === 'Spider-Man'));
});

test('alias "the dark knight" → FAIL/KNOWN_IP (Batman)', () => {
  const r = agent.checkText('the dark knight returns');
  assert.equal(r.verdict, QCVerdict.FAIL);
  assert.ok(r.findings.some(f => f.candidateIp === 'Batman'));
});

test('alias "tony stark" → FAIL/KNOWN_IP (Iron Man)', () => {
  const r = agent.checkText('tony stark builds a new suit');
  assert.equal(r.verdict, QCVerdict.FAIL);
  assert.ok(r.findings.some(f => f.candidateIp === 'Iron Man'));
});

test('alias "bruce wayne" → FAIL/KNOWN_IP (Batman)', () => {
  const r = agent.checkText('bruce wayne attends a gala');
  assert.equal(r.verdict, QCVerdict.FAIL);
  assert.ok(r.findings.some(f => f.candidateIp === 'Batman'));
});

test('alias "coca cola" → FAIL/KNOWN_IP (Coca-Cola brand)', () => {
  const r = agent.checkText('drinking a coca cola');
  assert.equal(r.verdict, QCVerdict.FAIL);
  assert.ok(r.findings.some(f => f.candidateIp === 'Coca-Cola'));
});

// =========================================================================
// 3. Typo/fuzzy positive
// =========================================================================
console.log('\n3. Typo/fuzzy positive');

test('typo "spderman" → fuzzy match Spider-Man', () => {
  const r = agent.checkText('spderman is here');
  assert.ok(r.findings.some(f => f.candidateIp === 'Spider-Man' && f.matchType === MatchType.FUZZY));
});

test('typo "batmen" → fuzzy match Batman', () => {
  const r = agent.checkText('batmen returns');
  assert.ok(r.findings.some(f => f.candidateIp === 'Batman' && f.matchType === MatchType.FUZZY));
});

test('typo "pikachuu" → fuzzy match Pikachu', () => {
  const r = agent.checkText('pikachuu thunderbolt');
  assert.ok(r.findings.some(f => f.candidateIp === 'Pikachu' && f.matchType === MatchType.FUZZY));
});

// =========================================================================
// 4. Indirect keyword positive (WARN only)
// =========================================================================
console.log('\n4. Indirect keyword positive');

test('keyword "web shooter" → WARN/POSSIBLE_IP (Spider-Man)', () => {
  const r = agent.checkText('a hero with a web shooter');
  assert.equal(r.verdict, QCVerdict.CONDITIONAL_PASS);
  assert.equal(r.ipStatus, IPStatus.POSSIBLE_IP);
  assert.ok(r.findings.some(f => f.candidateIp === 'Spider-Man' && f.matchType === MatchType.KEYWORD));
});

test('keyword "infinity gauntlet" → WARN (Thanos)', () => {
  const r = agent.checkText('the infinity gauntlet glows');
  assert.equal(r.verdict, QCVerdict.CONDITIONAL_PASS);
  assert.ok(r.findings.some(f => f.candidateIp === 'Thanos' && f.matchType === MatchType.KEYWORD));
});

test('keyword "glass slipper" → WARN (Cinderella)', () => {
  const r = agent.checkText('she lost a glass slipper');
  assert.equal(r.verdict, QCVerdict.CONDITIONAL_PASS);
  assert.ok(r.findings.some(f => f.candidateIp === 'Cinderella' && f.matchType === MatchType.KEYWORD));
});

// =========================================================================
// 5. Generic description negative
// =========================================================================
console.log('\n5. Generic description negative');

test('generic hero description → PASS/SAFE', () => {
  const r = agent.checkText('a brave firefighter saves the town');
  assert.equal(r.verdict, QCVerdict.PASS);
  assert.equal(r.ipStatus, IPStatus.SAFE);
  assert.equal(r.findings.length, 0);
});

test('generic landscape → PASS/SAFE', () => {
  const r = agent.checkText('a beautiful sunset over the mountains with a calm lake');
  assert.equal(r.verdict, QCVerdict.PASS);
  assert.equal(r.ipStatus, IPStatus.SAFE);
});

test('generic sci-fi scene → PASS/SAFE', () => {
  const r = agent.checkText('a robot walks through a neon-lit city street in the rain');
  assert.equal(r.verdict, QCVerdict.PASS);
  assert.equal(r.ipStatus, IPStatus.SAFE);
});

test('generic fantasy → PASS/SAFE', () => {
  const r = agent.checkText('a warrior climbs a snowy mountain carrying an ancient relic');
  assert.equal(r.verdict, QCVerdict.PASS);
  assert.equal(r.ipStatus, IPStatus.SAFE);
});

// =========================================================================
// 6. Near-miss negative
// =========================================================================
console.log('\n6. Near-miss negative');

test('"spider" alone → no match (not "spider-man")', () => {
  const r = agent.checkText('a spider crawls on the wall');
  assert.ok(r.verdict !== QCVerdict.FAIL, `expected not FAIL, got ${r.verdict}`);
});

test('"man in bat costume" → no Batman match', () => {
  const r = agent.checkText('a man in a bat costume at a party');
  const batmanFindings = r.findings.filter(f => f.candidateIp === 'Batman');
  assert.equal(batmanFindings.length, 0, 'should not match Batman');
});

test('"iron gate" → no Iron Man match', () => {
  const r = agent.checkText('a house with an iron gate');
  const ironManFindings = r.findings.filter(f => f.candidateIp === 'Iron Man');
  assert.equal(ironManFindings.length, 0, 'should not match Iron Man');
});

// =========================================================================
// 7. Cross-IP collision
// =========================================================================
console.log('\n7. Cross-IP collision');

test('"super strength" → Mr. Incredible keyword, not Superman', () => {
  const r = agent.checkText('a hero with super strength');
  const supermanFindings = r.findings.filter(f => f.candidateIp === 'Superman');
  assert.equal(supermanFindings.length, 0, 'should not match Superman');
});

test('"straw hat" → Luffy keyword, not generic', () => {
  const r = agent.checkText('a pirate wearing a straw hat');
  assert.ok(r.findings.some(f => f.candidateIp === 'Monkey D. Luffy'));
});

test('"trump" → Donald Trump likeness, not generic', () => {
  const r = agent.checkText('trump gives a speech');
  assert.ok(r.findings.some(f => f.candidateIp === 'Donald Trump'));
});

// =========================================================================
// 8. Short-word collision
// =========================================================================
console.log('\n8. Short-word collision');

test('"man" alone → no fuzzy match across Man-IPs', () => {
  const r = agent.checkText('a man walks down the street');
  const manIPs = r.findings.filter(f =>
    ['Spider-Man', 'Iron Man', 'Batman', 'Superman', 'Ant-Man'].includes(f.candidateIp)
    && f.matchType === MatchType.FUZZY
  );
  assert.equal(manIPs.length, 0, 'short word "man" should not fuzzy-match');
});

test('"red" alone → no fuzzy match', () => {
  const r = agent.checkText('a red car drives by');
  const redFindings = r.findings.filter(f => f.matchType === MatchType.FUZZY && f.matched === 'red');
  assert.equal(redFindings.length, 0);
});

test('"tall" vs "wall-e" → no match (min word length 5)', () => {
  const r = agent.checkText('a tall building');
  const wallEFindings = r.findings.filter(f => f.candidateIp === 'Wall-E');
  assert.equal(wallEFindings.length, 0);
});

test('"cap" alone → no Captain America match', () => {
  const r = agent.checkText('she wore a blue cap');
  const capFindings = r.findings.filter(f => f.candidateIp === 'Captain America' && f.matchType === MatchType.FUZZY);
  assert.equal(capFindings.length, 0);
});

// =========================================================================
// 9. Keyword-only case (never BLOCK)
// =========================================================================
console.log('\n9. Keyword-only case (never BLOCK)');

test('keyword-only → CONDITIONAL_PASS, never FAIL', () => {
  const r = agent.checkText('a hero with a vibranium shield');
  assert.equal(r.verdict, QCVerdict.CONDITIONAL_PASS);
  assert.ok(r.risk === 'LOW' || r.risk === 'MEDIUM', `risk should be LOW/MEDIUM, got ${r.risk}`);
});

test('keyword "mjolnir" → WARN, not BLOCK', () => {
  const r = agent.checkText('the warrior lifts mjolnir');
  assert.equal(r.verdict, QCVerdict.CONDITIONAL_PASS);
  assert.ok(r.findings.some(f => f.matchType === MatchType.KEYWORD));
});

test('keyword "let it go" → WARN (Elsa), not BLOCK', () => {
  const r = agent.checkText('she sings let it go');
  assert.notEqual(r.verdict, QCVerdict.FAIL);
});

// =========================================================================
// Additional: ipStatus taxonomy
// =========================================================================
console.log('\n10. ipStatus taxonomy');

test('no matches → SAFE', () => {
  const r = agent.checkText('a quiet morning in the countryside');
  assert.equal(r.ipStatus, IPStatus.SAFE);
});

test('exact match → KNOWN_IP', () => {
  const r = agent.checkText('Mickey Mouse waves hello');
  assert.equal(r.ipStatus, IPStatus.KNOWN_IP);
});

test('fuzzy match → POSSIBLE_IP', () => {
  const r = agent.checkText('spderman swings by');
  assert.equal(r.ipStatus, IPStatus.POSSIBLE_IP);
});

// =========================================================================
// Additional: Likeness policy (maxAction=WARN caps even exact matches)
// =========================================================================
console.log('\n11. Likeness policy');

test('likeness exact match → action=WARN, CONDITIONAL_PASS (capped by maxAction)', () => {
  const r = agent.checkText('taylor swift performs on stage');
  const f = r.findings.find(f => f.candidateIp === 'Taylor Swift');
  assert.ok(f, 'should have Taylor Swift finding');
  assert.equal(f.matchType, MatchType.EXACT);
  assert.equal(f.risk, 'CRITICAL', 'raw risk is CRITICAL for exact match');
  assert.equal(f.action, 'WARN', 'action capped to WARN by maxAction');
  assert.equal(f.verdict, QCVerdict.CONDITIONAL_PASS);
  assert.equal(r.ipStatus, IPStatus.KNOWN_IP);
});

test('likeness "elon musk" → action=WARN, not BLOCK', () => {
  const r = agent.checkText('elon musk launches a rocket');
  const f = r.findings.find(f => f.candidateIp === 'Elon Musk');
  assert.ok(f, 'should have Elon Musk finding');
  assert.equal(f.risk, 'CRITICAL', 'raw risk is CRITICAL for exact');
  assert.equal(f.action, 'WARN', 'action capped by maxAction=WARN');
  assert.equal(f.verdict, QCVerdict.CONDITIONAL_PASS);
});

// =========================================================================
// Additional: Orchestrator interface compatibility
// =========================================================================
console.log('\n12. Orchestrator interface');

test('checkStepOutput returns { verdict, issues } for orchestrator', () => {
  const data = { title: 'Spider-Man Adventure', logline: 'A web-slinger saves the day' };
  const r = agent.checkStepOutput('script', data);
  assert.ok('verdict' in r, 'must have verdict');
  assert.ok('issues' in r, 'must have issues');
  assert.ok(Array.isArray(r.issues), 'issues must be array');
  assert.equal(r.verdict, QCVerdict.FAIL);
  assert.ok(r.issues.length > 0);
});

test('checkStepOutput PASS returns empty issues', () => {
  const data = { title: 'A Quiet Morning', logline: 'A farmer tends his fields' };
  const r = agent.checkStepOutput('script', data);
  assert.equal(r.verdict, QCVerdict.PASS);
  assert.equal(r.issues.length, 0);
});

// =========================================================================
// Additional: Structured result schema
// =========================================================================
console.log('\n13. Structured result schema');

test('finding has all required fields', () => {
  const r = agent.checkText('Spider-Man swings');
  const f = r.findings.find(f => f.candidateIp === 'Spider-Man');
  assert.ok(f, 'should have Spider-Man finding');
  for (const field of ['verdict', 'severity', 'risk', 'action', 'matched', 'candidateIp', 'candidateId', 'candidateType', 'candidateOwner', 'matchType', 'confidence', 'evidence', 'recommendation']) {
    assert.ok(field in f, `finding must have field "${field}"`);
  }
});

test('PASS finding has null recommendation', () => {
  const r = agent.checkText('a quiet morning');
  assert.equal(r.findings.length, 0);
});

test('FAIL finding has recommendation', () => {
  const r = agent.checkText('Mickey Mouse');
  const f = r.findings[0];
  assert.ok(f.recommendation, 'FAIL finding should have recommendation');
});

// =========================================================================
// Additional: Database schema
// =========================================================================
console.log('\n14. Database schema');

test('entries have unified schema (id, type, owner, policy with maxAction)', () => {
  const { all } = getDatabase();
  for (const entry of all) {
    assert.ok(entry.id, `entry "${entry.name}" must have id`);
    assert.ok(entry.type, `entry "${entry.name}" must have type`);
    assert.ok('owner' in entry, `entry "${entry.name}" must have owner`);
    assert.ok(entry.policy, `entry "${entry.name}" must have policy`);
    assert.ok(entry.policy.riskLevel, `entry "${entry.name}" must have policy.riskLevel`);
    assert.ok(entry.policy.maxAction, `entry "${entry.name}" must have policy.maxAction`);
  }
});

// =========================================================================
// 15. Policy-driven: confidence ≠ risk ≠ action ≠ verdict
// =========================================================================
console.log('\n15. Confidence ≠ risk ≠ action ≠ verdict');

test('finding exposes all four distinct fields', () => {
  const r = agent.checkText('Spider-Man swings');
  const f = r.findings.find(f => f.candidateIp === 'Spider-Man');
  assert.ok(f, 'should have Spider-Man finding');
  assert.equal(typeof f.confidence, 'number', 'confidence is numeric');
  assert.ok(['NONE', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(f.risk), 'risk is taxonomy value');
  assert.ok(['ALLOW', 'REVIEW', 'WARN', 'BLOCK'].includes(f.action), 'action is taxonomy value');
  assert.ok([QCVerdict.PASS, QCVerdict.CONDITIONAL_PASS, QCVerdict.FAIL].includes(f.verdict), 'verdict is QCVerdict');
});

test('likeness: high confidence does NOT mean BLOCK', () => {
  const r = agent.checkText('taylor swift');
  const f = r.findings.find(f => f.candidateIp === 'Taylor Swift');
  assert.ok(f);
  assert.ok(f.confidence >= 0.85, 'exact match confidence should be high');
  assert.equal(f.action, 'WARN', 'maxAction=WARN caps action');
  assert.notEqual(f.verdict, QCVerdict.FAIL, 'must not FAIL');
});

test('keyword: high confidence still only WARN', () => {
  const r = agent.checkText('a hero with a web shooter');
  const f = r.findings.find(f => f.candidateIp === 'Spider-Man' && f.matchType === MatchType.KEYWORD);
  assert.ok(f);
  assert.ok(f.confidence > 0, 'keyword has confidence');
  assert.equal(f.action, 'REVIEW', 'keyword → LOW risk → REVIEW action');
  assert.equal(f.verdict, QCVerdict.CONDITIONAL_PASS);
});

test('UNKNOWN ipStatus when no match types fit known categories', () => {
  const r = agent.checkText('a quiet morning');
  assert.equal(r.ipStatus, IPStatus.SAFE);
  assert.equal(r.risk, 'NONE');
});

// =========================================================================
// 16. Policy-driven: maxAction enforcement
// =========================================================================
console.log('\n16. maxAction enforcement');

test('character (maxAction=BLOCK) + exact → BLOCK/FAIL', () => {
  const r = agent.checkText('Mickey Mouse');
  const f = r.findings.find(f => f.candidateIp === 'Mickey Mouse');
  assert.ok(f);
  assert.equal(f.action, 'BLOCK');
  assert.equal(f.verdict, QCVerdict.FAIL);
});

test('brand (maxAction=BLOCK) + alias → BLOCK/FAIL', () => {
  const r = agent.checkText('drinking a coca cola');
  const f = r.findings.find(f => f.candidateIp === 'Coca-Cola');
  assert.ok(f);
  assert.equal(f.action, 'BLOCK');
  assert.equal(f.verdict, QCVerdict.FAIL);
});

test('likeness (maxAction=WARN) + exact → WARN, never BLOCK', () => {
  const r = agent.checkText('elon musk');
  const f = r.findings.find(f => f.candidateIp === 'Elon Musk');
  assert.ok(f);
  assert.equal(f.matchType, MatchType.EXACT);
  assert.notEqual(f.action, 'BLOCK', 'likeness must never BLOCK');
  assert.equal(f.action, 'WARN');
  assert.notEqual(f.verdict, QCVerdict.FAIL);
});

test('keyword-only match → action never exceeds WARN regardless of policy', () => {
  const r = agent.checkText('a hero with a vibranium shield');
  for (const f of r.findings) {
    assert.equal(f.matchType, MatchType.KEYWORD);
    assert.ok(f.action !== 'BLOCK', `keyword match for ${f.candidateIp} must not BLOCK`);
  }
  assert.notEqual(r.verdict, QCVerdict.FAIL);
});

test('fuzzy match on character (maxAction=BLOCK) → can BLOCK', () => {
  const r = agent.checkText('spderman');
  const f = r.findings.find(f => f.candidateIp === 'Spider-Man');
  assert.ok(f);
  assert.equal(f.matchType, MatchType.FUZZY);
  assert.equal(f.action, 'BLOCK', 'fuzzy on HIGH/maxAction=BLOCK → BLOCK');
  assert.equal(f.verdict, QCVerdict.FAIL);
});

// =========================================================================
// Summary
// =========================================================================
console.log(`\n${'='.repeat(60)}`);
console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed > 0) {
  console.log('SOME TESTS FAILED');
  process.exit(1);
} else {
  console.log('ALL TESTS PASSED');
}
