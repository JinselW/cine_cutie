export const FailureType = Object.freeze({
  SCHEMA_VIOLATION: 'SCHEMA_VIOLATION',
  QUALITY_BELOW_THRESHOLD: 'QUALITY_BELOW_THRESHOLD',
  CONSISTENCY_BREAK: 'CONSISTENCY_BREAK',
  PROVIDER_ERROR: 'PROVIDER_ERROR',
  TIMEOUT: 'TIMEOUT',
  CANCELLED: 'CANCELLED',
  CONTENT_POLICY: 'CONTENT_POLICY',
  UNKNOWN: 'UNKNOWN',
});

export const QCVerdict = Object.freeze({
  PASS: 'PASS',
  FAIL: 'FAIL',
  CONDITIONAL_PASS: 'CONDITIONAL_PASS',
});

export const Severity = Object.freeze({
  CRITICAL: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
});

export const RetryStrategy = Object.freeze({
  NONE: 'NONE',
  IMMEDIATE: 'IMMEDIATE',
  WITH_FEEDBACK: 'WITH_FEEDBACK',
  FALLBACK: 'FALLBACK',
});

export function maxRetriesFor(severity) {
  switch (severity) {
    case Severity.CRITICAL: return 0;
    case Severity.HIGH: return 1;
    case Severity.MEDIUM: return 2;
    case Severity.LOW: return 3;
    default: return 2;
  }
}
