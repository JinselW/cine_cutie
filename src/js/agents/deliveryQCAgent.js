import { evaluateDeliveryBaseline } from './deliveryQC.js';

export { DELIVERY_QC_LIMITS, evaluateDeliveryBaseline } from './deliveryQC.js';

export class DeliveryQCAgent {
  constructor() {
    this.name = 'Delivery QC Agent';
    this.stepId = 'deliveryQC';
  }

  async process(ctx) {
    const technical = evaluateDeliveryBaseline(ctx.data, { expectedDuration: ctx.totalDuration });
    return {
      verdict: technical.verdict,
      score: null,
      severity: technical.severity,
      issues: technical.issues,
      suggestions: technical.repairPlan ? [technical.repairPlan.reason] : [],
      feedbackSatisfied: !ctx.feedback,
      technical,
      creative: null,
      repairPlan: technical.repairPlan,
    };
  }
}
