import { CancellationToken } from '../orchestrator/cancellationToken.js';

export class BaseAgent {
  constructor({ name, stepId }) {
    this.name = name;
    this.stepId = stepId;
  }

  async process(ctx, token) {
    if (!(token instanceof CancellationToken)) {
      token = new CancellationToken();
    }
    await token.throwIfCancelled();
    await token.waitIfPaused();

    const result = await this.run(ctx, token);

    return {
      artifacts: result.artifacts ?? [],
      intervention: result.intervention ?? null,
      metadata: result.metadata ?? {},
    };
  }

  async run(_ctx, _token) {
    throw new Error(`${this.name}: run() not implemented`);
  }
}
