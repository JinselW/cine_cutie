import { FailureType } from './qcTypes.js';

export const ItemRetryStrategy = Object.freeze({
  RETRY_SAME: 'RETRY_SAME',
  REWRITE_PROMPT: 'REWRITE_PROMPT',
  CHANGE_SEED: 'CHANGE_SEED',
  SWAP_REFERENCE: 'SWAP_REFERENCE',
  GIVE_UP: 'GIVE_UP',
});

const MAX_ITEM_ATTEMPTS = 3;

export class RetryAgent {
  constructor({ name = 'RetryAgent' } = {}) {
    this.name = name;
  }

  buildRetryMessages(originalMessages, previousResult, feedback) {
    return [
      ...originalMessages,
      { role: 'assistant', content: JSON.stringify(previousResult) },
      { role: 'user', content: feedback },
    ];
  }

  planItemRetry(failedItems, lineage, { availableReferences, feedback } = {}) {
    const plans = [];

    for (const item of failedItems) {
      const history = lineage[item.itemId]?.attempts || [];
      const attemptCount = history.length;

      if (attemptCount >= MAX_ITEM_ATTEMPTS) {
        plans.push({ itemId: item.itemId, strategy: ItemRetryStrategy.GIVE_UP, overrides: {} });
        continue;
      }

      const lastAttempt = history[history.length - 1];
      const strategy = this.#pickStrategy(item, lastAttempt, { availableReferences, attemptCount });

      const overrides = {};
      const baseSeed = lastAttempt?.seed ?? 42;

      switch (strategy) {
        case ItemRetryStrategy.REWRITE_PROMPT:
          overrides.promptOverrides = feedback || `Regenerate with improved prompt for ${item.itemId}`;
          overrides.seed = baseSeed + 1;
          break;
        case ItemRetryStrategy.CHANGE_SEED:
          overrides.seed = baseSeed + attemptCount * 7 + 1;
          break;
        case ItemRetryStrategy.SWAP_REFERENCE: {
          const usedRefId = lastAttempt?.referenceId;
          const candidates = (availableReferences || []).filter(r => r.id !== usedRefId);
          if (candidates.length > 0) {
            overrides.referenceOverrides = { [item.itemId]: candidates[0].id };
            overrides.seed = baseSeed;
          } else {
            overrides.seed = baseSeed + attemptCount * 13 + 1;
          }
          break;
        }
        case ItemRetryStrategy.RETRY_SAME:
        default:
          overrides.seed = baseSeed;
          break;
      }

      if (feedback) {
        overrides.feedbackMessages = { [item.itemId]: feedback };
      }

      plans.push({ itemId: item.itemId, strategy, overrides });
    }

    return plans;
  }

  #pickStrategy(item, lastAttempt, { availableReferences, attemptCount }) {
    const error = item.error || lastAttempt?.error || '';

    if (/reference|image.*not.*found|invalid.*ref/i.test(error) && availableReferences?.length > 1) {
      return ItemRetryStrategy.SWAP_REFERENCE;
    }

    if (/prompt|content.*policy|quality/i.test(error) && attemptCount === 0) {
      return ItemRetryStrategy.REWRITE_PROMPT;
    }

    if (attemptCount > 0 && attemptCount < MAX_ITEM_ATTEMPTS) {
      return ItemRetryStrategy.CHANGE_SEED;
    }

    return ItemRetryStrategy.RETRY_SAME;
  }
}
