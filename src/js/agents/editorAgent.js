import { BaseAgent } from './baseAgent.js';
import { RetryAgent } from './retryAgent.js';
import { checkConsistency } from '../providers/consistency.js';
import { getActiveProvider } from '../providers/registry.js';
import { createArtifact, ArtifactKind, ArtifactStatus } from '../artifacts/artifactTypes.js';
import { QCVerdict, Severity } from './qcTypes.js';

const MAX_RETRIES = 1;

export class EditorAgent extends BaseAgent {
  #retryAgent;

  constructor() {
    super({ name: 'Post-Production Artist', stepId: 'postProduction' });
    this.#retryAgent = new RetryAgent();
  }

  async run(ctx, _token) {
    let result = null;
    let bestResult = null;
    let bestVerdict = null;
    let retries = 0;
    let feedback = null;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const callCtx = feedback ? { ...ctx, retryFeedback: feedback } : ctx;
      result = await this.#callProvider(callCtx, _token);

      const l1Valid = this.#validateL1(result);
      if (!l1Valid) {
        if (attempt < MAX_RETRIES) {
          retries++;
          feedback = 'Structural validation failed: result must have finalVideo field';
          continue;
        }
        break;
      }

      const l2Check = checkConsistency('postProduction', result, ctx.entities || {});

      if (l2Check.verdict === QCVerdict.PASS) {
        bestResult = result;
        bestVerdict = l2Check;
        break;
      }

      if (bestVerdict === null || this.#isBetterVerdict(l2Check, bestVerdict)) {
        bestResult = result;
        bestVerdict = l2Check;
      }

      if (l2Check.verdict === QCVerdict.FAIL && l2Check.severity >= Severity.HIGH) {
        if (attempt < MAX_RETRIES) {
          retries++;
          feedback = this.#buildFeedback(l2Check);
          continue;
        }
        break;
      }

      if (l2Check.verdict === QCVerdict.CONDITIONAL_PASS) {
        if (attempt < MAX_RETRIES) {
          retries++;
          feedback = this.#buildFeedback(l2Check);
          continue;
        }
        break;
      }

      break;
    }

    if (!result || !this.#validateL1(result)) {
      result = { episodes: [], finalVideo: '', status: 'failed' };
    }

    const hasFinal = !!result.finalVideo;

    return {
      artifacts: [createArtifact({
        kind: ArtifactKind.FINAL_VIDEO,
        stepId: 'postProduction',
        data: bestResult || result,
        status: hasFinal ? ArtifactStatus.COMPLETE : ArtifactStatus.FAILED,
      })],
      metadata: {
        retries,
        renderStatus: result.status || 'failed',
        qualityScore: bestVerdict?.verdict === QCVerdict.PASS ? 10 : bestVerdict?.verdict === QCVerdict.CONDITIONAL_PASS ? 7 : 5,
        consistencyIssues: bestVerdict?.issues || [],
      },
    };
  }

  #validateL1(result) {
    return result && typeof result === 'object' && 'finalVideo' in result;
  }

  #isBetterVerdict(newCheck, oldCheck) {
    const rank = { [QCVerdict.PASS]: 3, [QCVerdict.CONDITIONAL_PASS]: 2, [QCVerdict.FAIL]: 1 };
    return (rank[newCheck.verdict] || 0) > (rank[oldCheck.verdict] || 0);
  }

  #buildFeedback(check) {
    const parts = ['Previous output had consistency issues:'];
    check.issues.forEach(issue => parts.push(`- ${issue}`));
    parts.push('Please regenerate addressing these issues.');
    return parts.join('\n');
  }

  async #callProvider(ctx, token) {
    const provider = getActiveProvider('render');
    if (!provider) return null;
    try {
      const items = (ctx.videoClips?.clips || []).map(c => ({
        id: c.shot_id,
        videoPath: c.videoPath,
        status: c.status,
      }));
      const result = await provider.generate({ items, signal: token?.signal });
      return {
        episodes: (ctx.storyboard?.episodes || []).map(ep => ({ episode: ep.episode })),
        finalVideo: result.finalVideo,
        status: result.status,
      };
    } catch {
      return null;
    }
  }
}
