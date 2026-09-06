/**
 * IPComplianceAgent — V0.1.2
 *
 * Policy-driven layer over the evidence-only matcher.
 * Evaluates match evidence against entry policies (maxAction) to produce verdicts.
 *
 * Architecture:
 *   ipMatcher  → raw evidence (what was found)
 *   this agent → policy evaluation (what it means)
 *
 * Four distinct concepts:
 *   confidence — identification certainty (0..1, from matcher)
 *   risk       — compliance exposure (CRITICAL..NONE, from matchType+confidence)
 *   action     — enforcement level (BLOCK/WARN/REVIEW/ALLOW, capped by policy.maxAction)
 *   verdict    — final QC decision (FAIL/CONDITIONAL_PASS/PASS, derived from action)
 *
 * ipStatus taxonomy:
 *   SAFE       — no IP references detected
 *   KNOWN_IP   — exact/alias match against a known IP entry
 *   POSSIBLE_IP — fuzzy or keyword match, needs review
 *   UNKNOWN    — reserved for future semantic/visual checks
 */

import { scanText, scanTexts, MatchType, IPStatus } from '../compliance/ipMatcher.js';
import { getDatabase } from '../compliance/ipDatabase.js';
import { QCVerdict, Severity } from './qcTypes.js';

// ---------------------------------------------------------------------------
// Text extraction from step outputs
// ---------------------------------------------------------------------------

function extractTextFromStep(stepId, data) {
  if (!data) return [];
  const texts = [];

  switch (stepId) {
    case 'script': {
      if (data.title) texts.push(data.title);
      if (data.logline) texts.push(data.logline);
      if (data.synopsis) texts.push(data.synopsis);
      for (const ch of (data.characters || [])) {
        if (ch.name) texts.push(ch.name);
        if (ch.desc) texts.push(ch.desc);
        if (ch.appearance) texts.push(ch.appearance);
      }
      for (const s of (data.settings || [])) {
        if (s.name) texts.push(s.name);
        if (s.desc) texts.push(s.desc);
      }
      break;
    }

    case 'characterDesign': {
      for (const ch of (data.characters || [])) {
        if (ch.name) texts.push(ch.name);
        if (ch.appearance) texts.push(ch.appearance);
        if (ch.prompt) texts.push(ch.prompt);
      }
      break;
    }

    case 'storyboard': {
      for (const ep of (data.episodes || [])) {
        for (const seg of (ep.segments || [])) {
          if (seg.narration) texts.push(seg.narration);
          for (const shot of (seg.shots || [])) {
            if (shot.description) texts.push(shot.description);
            if (shot.prompt) texts.push(shot.prompt);
            if (shot.dialogue) texts.push(shot.dialogue);
          }
        }
      }
      break;
    }

    case 'referenceImages': {
      for (const shot of (data.shots || [])) {
        if (shot.prompt) texts.push(shot.prompt);
        if (shot.negativePrompt) texts.push(shot.negativePrompt);
      }
      break;
    }

    case 'videoGeneration': {
      for (const clip of (data.clips || [])) {
        if (clip.prompt) texts.push(clip.prompt);
        if (clip.negativePrompt) texts.push(clip.negativePrompt);
      }
      break;
    }

    case 'postProduction': {
      if (data.title) texts.push(data.title);
      if (data.subtitle) texts.push(data.subtitle);
      break;
    }
  }

  return texts.filter(t => typeof t === 'string' && t.length > 0);
}

// ---------------------------------------------------------------------------
// Policy evaluation: evidence → findings with verdict
// ---------------------------------------------------------------------------

function computeRisk(matchType, confidence) {
  switch (matchType) {
    case MatchType.EXACT:   return 'CRITICAL';
    case MatchType.ALIAS:   return 'HIGH';
    case MatchType.FUZZY:   return confidence >= 0.85 ? 'HIGH' : 'MEDIUM';
    case MatchType.KEYWORD: return 'LOW';
    default:                return 'LOW';
  }
}

const ACTION_ORDER = ['ALLOW', 'REVIEW', 'WARN', 'BLOCK'];

function riskToAction(risk) {
  switch (risk) {
    case 'CRITICAL':
    case 'HIGH':     return 'BLOCK';
    case 'MEDIUM':   return 'WARN';
    case 'LOW':      return 'REVIEW';
    default:         return 'ALLOW';
  }
}

function actionToVerdict(action) {
  switch (action) {
    case 'BLOCK':  return QCVerdict.FAIL;
    case 'WARN':
    case 'REVIEW': return QCVerdict.CONDITIONAL_PASS;
    default:       return QCVerdict.PASS;
  }
}

function capAction(action, maxAction) {
  const idx = ACTION_ORDER.indexOf(action);
  const maxIdx = ACTION_ORDER.indexOf(maxAction);
  return idx > maxIdx ? maxAction : action;
}

function evaluateEvidence(evidence) {
  return evidence.map(ev => {
    const { entry, matchType, confidence, matchedText, evidence: evDesc } = ev;
    const maxAction = entry.policy?.maxAction || 'BLOCK';

    const risk = computeRisk(matchType, confidence);
    let action = riskToAction(risk);

    if (matchType === MatchType.KEYWORD) {
      action = capAction(action, 'WARN');
    }
    action = capAction(action, maxAction);

    const verdict = actionToVerdict(action);

    let severity;
    switch (risk) {
      case 'CRITICAL': severity = Severity.CRITICAL; break;
      case 'HIGH':     severity = Severity.HIGH; break;
      case 'MEDIUM':   severity = Severity.MEDIUM; break;
      case 'LOW':      severity = Severity.LOW; break;
      default:         severity = Severity.LOW;
    }

    let recommendation;
    if (verdict === QCVerdict.FAIL) {
      recommendation = `Remove or replace reference to "${entry.name}" (${entry.owner || entry.type}).`;
    } else if (verdict === QCVerdict.CONDITIONAL_PASS) {
      recommendation = matchType === MatchType.KEYWORD
        ? `Review: indirect descriptor may evoke "${entry.name}". Consider rephrasing if unintended.`
        : `Review: possible reference to "${entry.name}". Verify intent.`;
    } else {
      recommendation = null;
    }

    return {
      verdict,
      severity,
      risk,
      action,
      matched: matchedText,
      candidateIp: entry.name,
      candidateId: entry.id,
      candidateType: entry.type,
      candidateOwner: entry.owner,
      matchType,
      confidence,
      evidence: evDesc,
      recommendation,
    };
  });
}

function determineIpStatus(findings) {
  if (findings.length === 0) return IPStatus.SAFE;

  const hasExactOrAlias = findings.some(
    f => f.matchType === MatchType.EXACT || f.matchType === MatchType.ALIAS,
  );
  if (hasExactOrAlias) return IPStatus.KNOWN_IP;

  const hasFuzzyOrKeyword = findings.some(
    f => f.matchType === MatchType.FUZZY || f.matchType === MatchType.KEYWORD,
  );
  if (hasFuzzyOrKeyword) return IPStatus.POSSIBLE_IP;

  return IPStatus.UNKNOWN;
}

function buildResult(findings) {
  const ipStatus = determineIpStatus(findings);

  const verdictOrder = [QCVerdict.PASS, QCVerdict.CONDITIONAL_PASS, QCVerdict.FAIL];
  const riskOrder = ['NONE', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

  let worstVerdict = QCVerdict.PASS;
  let worstRisk = 'NONE';
  let worstSeverity = null;

  for (const f of findings) {
    if (verdictOrder.indexOf(f.verdict) > verdictOrder.indexOf(worstVerdict)) {
      worstVerdict = f.verdict;
    }
    if (riskOrder.indexOf(f.risk) > riskOrder.indexOf(worstRisk)) {
      worstRisk = f.risk;
    }
    if (f.severity != null && (worstSeverity == null || f.severity < worstSeverity)) {
      worstSeverity = f.severity;
    }
  }

  const issues = findings
    .filter(f => f.verdict !== QCVerdict.PASS)
    .map(f => {
      const prefix = f.verdict === QCVerdict.FAIL ? 'IP BLOCK' : 'IP WARN';
      return `${prefix}: "${f.matched}" → ${f.candidateIp} (${f.candidateOwner || f.candidateType}) via ${f.matchType} [${f.risk}]`;
    });

  return {
    verdict: worstVerdict,
    severity: worstSeverity,
    ipStatus,
    risk: worstRisk,
    issues,
    findings,
  };
}

// ---------------------------------------------------------------------------
// IPComplianceAgent class
// ---------------------------------------------------------------------------

export class IPComplianceAgent {
  constructor() {
    this.name = 'IPComplianceAgent';
  }

  checkText(text) {
    const { evidence } = scanText(text);
    const findings = evaluateEvidence(evidence);
    return buildResult(findings);
  }

  checkTexts(texts) {
    const { evidence } = scanTexts(texts);
    const findings = evaluateEvidence(evidence);
    return buildResult(findings);
  }

  checkStepOutput(stepId, data) {
    const texts = extractTextFromStep(stepId, data);
    if (texts.length === 0) {
      return { verdict: QCVerdict.PASS, severity: null, ipStatus: IPStatus.SAFE, risk: 'NONE', issues: [], findings: [] };
    }
    const { evidence } = scanTexts(texts);
    const findings = evaluateEvidence(evidence);
    return buildResult(findings);
  }

  checkUserInput(userInput) {
    const { evidence } = scanText(userInput);
    const findings = evaluateEvidence(evidence);
    return buildResult(findings);
  }

  // -----------------------------------------------------------------------
  // Future extension interfaces (stubs)
  // -----------------------------------------------------------------------

  async semanticCheck(_text) {
    return { evidence: [], ipStatus: IPStatus.UNKNOWN };
  }

  async visualCheck(_imagePath) {
    return { evidence: [], ipStatus: IPStatus.UNKNOWN };
  }

  async lvlmCheck(_imagePath, _referenceEntry) {
    return { verdict: IPStatus.UNKNOWN, score: 0, confidence: 0, reason: 'Not implemented' };
  }

  async videoCheck(_videoPath) {
    return { evidence: [], ipStatus: IPStatus.UNKNOWN };
  }
}

let _instance = null;
export function getIPComplianceAgent() {
  if (!_instance) _instance = new IPComplianceAgent();
  return _instance;
}

export { MatchType, IPStatus };
export { getDatabase };
