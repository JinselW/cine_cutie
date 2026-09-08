const REVISION_MARKER = 'USER REVISION REQUIREMENT (must be satisfied):';

export function normalizeFeedback(feedback) {
  return typeof feedback === 'string' ? feedback.trim() : '';
}

export function feedbackDirective(feedback) {
  const normalized = normalizeFeedback(feedback);
  return normalized ? `${REVISION_MARKER} ${normalized}` : '';
}

export function appendFeedback(prompt, feedback) {
  const base = String(prompt || '').trim();
  const directive = feedbackDirective(feedback);
  if (!directive || base.includes(directive)) return base;
  return [base, directive].filter(Boolean).join('\n\n');
}

export function appendPromptGuidance(prompt, { feedback, suggestions = [] } = {}) {
  let result = String(prompt || '').trim();
  const notes = suggestions.filter(Boolean).join('; ');
  if (notes) result = `${result}\n\nQUALITY IMPROVEMENTS: ${notes}`.trim();
  return appendFeedback(result, feedback);
}

