import { BaseAgent } from './baseAgent.js';
import { QCAgent, reportScore } from './qcAgent.js';
import { getActiveProvider } from '../providers/registry.js';
import { createArtifact, ArtifactKind, ArtifactStatus } from '../artifacts/artifactTypes.js';
import { QCVerdict } from './qcTypes.js';

export class EditorAgent extends BaseAgent {
  #qcAgent;

  constructor() {
    super({ name: 'Post-Production Artist', stepId: 'postProduction' });
    this.#qcAgent = new QCAgent({ stepId: 'postProduction' });
  }

  async run(ctx, _token) {
    let result = await this.#callProvider(ctx, _token);
    if (!this.#validateL1(result)) {
      result = { episodes: [], finalVideo: '', status: 'failed' };
    }

    const finalData = result;
    const hasFinal = !!finalData.finalVideo;

    // Post-production concatenation is deterministic — a single unified QC decision,
    // no regeneration. qcAgent.process folds the consistency hard gate into the score.
    const crit = await this.#qcAgent.process({ data: finalData, entities: ctx.entities || {}, ...ctx });
    reportScore(crit.score, '🎬');

    return {
      artifacts: [createArtifact({
        kind: ArtifactKind.FINAL_VIDEO,
        stepId: 'postProduction',
        data: finalData,
        status: hasFinal ? ArtifactStatus.COMPLETE : ArtifactStatus.FAILED,
      })],
      metadata: {
        retries: 0,
        renderStatus: finalData.status || 'failed',
        qualityScore: crit.score,
        consistencyIssues: crit.consistency?.issues || [],
        verdict: crit.verdict ?? (hasFinal ? null : QCVerdict.FAIL),
      },
    };
  }

  #validateL1(result) {
    return result && typeof result === 'object' && 'finalVideo' in result;
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
