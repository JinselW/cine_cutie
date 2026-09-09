import { QCAgent } from './qcAgent.js';
import { QCVerdict } from './qcTypes.js';
import { evaluateDeliveryBaseline } from './deliveryQC.js';

export { DELIVERY_QC_LIMITS, evaluateDeliveryBaseline } from './deliveryQC.js';

export class DeliveryQCAgent {
  constructor() {
    this.name = 'Delivery QC Agent';
    this.stepId = 'deliveryQC';
    this.creativeReviewer = new QCAgent({ stepId: 'postProduction' });
  }

  async process(ctx) {
    const technical = evaluateDeliveryBaseline(ctx.data, { expectedDuration: ctx.totalDuration });
    const creative = await this.creativeReviewer.process(ctx);
    const verdict = technical.verdict === QCVerdict.FAIL || creative?.verdict === QCVerdict.FAIL
      ? QCVerdict.FAIL
      : technical.verdict === QCVerdict.CONDITIONAL_PASS || creative?.verdict === QCVerdict.CONDITIONAL_PASS
        ? QCVerdict.CONDITIONAL_PASS : QCVerdict.PASS;
    return {
      verdict,
      score: creative?.score == null ? technical.score : Math.min(technical.score, creative.score),
      severity: technical.severity ?? creative?.severity ?? null,
      issues: [...technical.issues, ...(creative?.issues || [])],
      suggestions: creative?.suggestions || [],
      feedbackSatisfied: creative?.feedbackSatisfied ?? !ctx.feedback,
      technical,
      creative,
      repairPlan: technical.repairPlan,
    };
  }
}
