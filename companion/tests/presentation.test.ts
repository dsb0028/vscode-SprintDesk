import assert from 'node:assert/strict';
import { ActionContext, availableActions, errorHelp } from '../src/presentation';

const context: ActionContext = {
  authority: true, task: true, draft: true, blocked: false, pending: false, retry: false, revoked: false
};

assert.deepEqual(availableActions('summary', context), ['confirm-review', 'discard', 'revoke']);
assert(!availableActions('summary', context).includes('confirm-complete'));
assert(availableActions('completionSummary', context).includes('confirm-complete'));
assert(!availableActions('completionSummary', context).includes('confirm-review'));
assert(!availableActions('complete', context).includes('confirm-complete'));
assert(!availableActions('done', context).includes('new-review'));
assert.deepEqual(availableActions('enroll', { ...context, authority: false }), ['enroll']);
assert.deepEqual(availableActions('error', { ...context, authority: false }), []);
const pending = { ...context, pending: true, retry: true };
assert.deepEqual(availableActions('uncertain', pending), ['reconcile', 'retry']);
assert(!availableActions('error', pending).includes('reset'));
assert(!availableActions('error', pending).includes('discard'));
assert(!availableActions('error', pending).includes('revoke'));
assert(!availableActions('uncertain', context).includes('retry'));
assert(availableActions('error', { ...context, blocked: true }).includes('unblock'));
assert(!availableActions('error', context).includes('unblock'));
assert(availableActions('revoked', { ...context, revoked: true }).includes('recover'));
assert(!availableActions('revoked', { ...pending, revoked: true }).includes('recover'));
assert.match(errorHelp('transport timeout', true), /same saved receipt/);
assert.match(errorHelp('TAMPER WARNING', false), /unverified/);
assert.match(errorHelp('Snapshot changed', false), /Previous decisions cannot carry over/);
assert.match(errorHelp('Local key missing', false), /Do not replace/);
assert.match(errorHelp('Unexpected failure', false), /No approval can be inferred/);
assert.match(errorHelp('Task read failed', false, true), /confirming it was not deleted or recreated/);
console.log('PASS presentation action guards and truthful error guidance');
