export type ReviewPhase = 'enroll' | 'load' | 'criterion' | 'summary' | 'complete'
  | 'completionSummary' | 'reviewed' | 'done' | 'uncertain' | 'error' | 'revoked';

export interface ActionContext {
  authority: boolean;
  task: boolean;
  draft: boolean;
  blocked: boolean;
  pending: boolean;
  retry: boolean;
  revoked: boolean;
}

const PHASE_ACTIONS: Record<ReviewPhase, readonly string[]> = {
  enroll: ['enroll'],
  load: ['load', 'revoke', 'mirror'],
  criterion: ['met', 'needs work', 'needs-evidence', 'evidence', 'discard', 'revoke'],
  summary: ['confirm-review', 'discard', 'revoke'],
  complete: ['complete-summary', 'new-review', 'load', 'revoke'],
  completionSummary: ['confirm-complete', 'cancel', 'revoke'],
  reviewed: ['load', 'revoke'],
  done: ['load', 'revoke'],
  uncertain: ['reconcile', 'retry', 'unblock'],
  error: ['load', 'discard', 'reset', 'unblock', 'revoke', 'mirror', 'reconcile', 'retry'],
  revoked: ['recover', 'reconcile', 'retry', 'unblock']
};

export function availableActions(phase: ReviewPhase, context: ActionContext): string[] {
  return PHASE_ACTIONS[phase].filter(action => {
    if (action === 'enroll') { return !context.pending && (!context.authority || context.revoked); }
    if (!context.authority) { return false; }
    if (action === 'retry') { return context.retry; }
    if (action === 'reconcile') { return context.task; }
    if (action === 'recover') { return context.revoked && !context.pending; }
    if (action === 'unblock') { return context.task && context.blocked && !context.pending; }
    if (action === 'reset') { return context.task && !context.pending; }
    if (action === 'discard') { return context.draft && !context.pending; }
    if (action === 'mirror' || action === 'revoke') { return !context.revoked && !context.pending; }
    if (action === 'new-review') { return !context.revoked && !context.pending; }
    if (['met', 'needs work', 'needs-evidence', 'evidence', 'confirm-review',
      'confirm-complete', 'complete-summary'].includes(action)) {
      return context.task && !context.revoked && !context.pending;
    }
    return !context.revoked;
  });
}

export function errorHelp(message: string, pendingIntent: boolean, blockedIdentity = false): string {
  if (pendingIntent) {
    return 'A signed operation is saved locally but its outcome is not verified. Check submission result first. '
      + 'If needed, retry only the same saved receipt; do not start a new signature or replace your key.';
  }
  if (/TAMPER|UNATTESTED|projection|ledger entry|receipt differs/i.test(message)) {
    return 'Approval is unverified. Actual source and independent local authority do not agree. '
      + 'Inspect the details; do not repair approval by editing files or trust the remote status alone.';
  }
  if (blockedIdentity) {
    return 'This remembered identity is blocked. Check the pinned workspace and actual task source. '
      + 'Use explicit original-identity recovery only after confirming it was not deleted or recreated; '
      + 'a genuinely replaced task requires explicit identity reset. Do not re-enroll or transfer decisions.';
  }
  if (/changed|Snapshot|invalidated|digest/i.test(message)) {
    return 'Reviewed content changed. Inspect the current evidence and explicitly discard the old draft '
      + 'before a fresh review. Previous decisions cannot carry over.';
  }
  if (/key|enroll|authority|lease|placement|local desktop/i.test(message)) {
    return 'Check local host placement and authority details. Do not replace an existing key for a transport '
      + 'failure. Use explicit authority recovery only after resolving the reported cause.';
  }
  return 'The operation did not verify successfully. Read the diagnostic and reload/check the exact task '
    + 'before continuing. No approval can be inferred from this error.';
}
