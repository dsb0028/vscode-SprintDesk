import { Task, TaskReview, HumanVerification } from '../data/types';
import { canonical, digest, Enrollment, ReviewSnapshot, SignedReceipt, verifyReceipt } from './protocol';
import { assertCriterionEvidence } from './evidence';

export function receiptReview(receipt: SignedReceipt): TaskReview {
  const p = receipt.payload;
  return {
    summary: p.criteria.every(entry => entry.result === 'met') ? 'accepted' : 'further work required',
    reviewerId: p.reviewerId,
    reviewedAt: p.timestamp,
    criteria: p.criteria.map(entry => ({
      ...entry, reviewerId: p.reviewerId, verifiedAt: p.timestamp,
    })),
  };
}

export function needsModification(receipt: SignedReceipt): boolean {
  return receipt.payload.criteria.some(entry => entry.result === 'needs work');
}

export function receiptVerification(receipt: SignedReceipt, enrollment: Enrollment): HumanVerification {
  return {
    reviewerId: enrollment.reviewerId,
    reviewerName: enrollment.reviewerName,
    approvedAt: receipt.payload.timestamp,
  };
}

export function taskMetadata(task: Task): Record<string, unknown> {
  const metadata: Record<string, unknown> = { ...task };
  for (const field of ['review', 'humanVerification', 'reviewReceipt', 'completionReceipt',
    'status', 'workStatus', 'updatedAt']) {
    delete metadata[field];
  }
  return metadata;
}

function same(left: unknown, right: unknown): boolean {
  return canonical(left ?? null) === canonical(right ?? null);
}

export function protectedChange(before: Task | undefined, after: Task): boolean {
  if (!before) {
    return after.status === 'done' || after.status === 'needs-modification' || after.workStatus === 'done' || !!after.humanVerification
      || !!after.reviewReceipt || !!after.completionReceipt
      || !!after.review && (after.review.summary !== 'pending'
        || !!after.review.reviewerId || !!after.review.reviewedAt
        || after.review.criteria.some(entry => entry.result || entry.reviewerId || entry.verifiedAt));
  }
  return (after.status === 'done' && before.status !== 'done')
    || (after.status === 'needs-modification' && before.status !== 'needs-modification')
    || (after.workStatus === 'done' && before.workStatus !== 'done')
    || !same(before.humanVerification, after.humanVerification)
    || !same(before.reviewReceipt, after.reviewReceipt)
    || !same(before.completionReceipt, after.completionReceipt)
    || (!same(before.review, after.review) && (!!before.reviewReceipt
      || after.review?.summary !== 'pending'
      || !!after.review?.reviewerId || !!after.review?.reviewedAt
      || !!after.review?.criteria.some(entry => entry.result || entry.reviewerId || entry.verifiedAt)));
}

export function authorizeChange(
  before: Task, after: Task, snapshot: ReviewSnapshot, enrollment: Enrollment,
): void {
  assertCriterionEvidence(snapshot.markdown, snapshot.criteria);
  const isCompletion = !same(before.completionReceipt, after.completionReceipt);
  const receipt = isCompletion ? after.completionReceipt : after.reviewReceipt;
  if (!receipt) {
    throw new Error('Protected task writes require signed local UI approval');
  }
  verifyReceipt(receipt, enrollment);
  const p = receipt.payload;
  const prior = before.completionReceipt ?? before.reviewReceipt;
  if (before.status !== 'under-review' || p.taskId !== before.id || p.createdAt !== before.createdAt
    || p.snapshotDigest !== digest(snapshot) || !same(taskMetadata(before), taskMetadata(after))
    || p.criteria.length !== snapshot.criteria.length
    || p.criteria.some((entry, index) => entry.criterion !== snapshot.criteria[index])
    || (prior && (p.sequence <= prior.payload.sequence || p.operationId === prior.payload.operationId
      || p.incarnation !== prior.payload.incarnation))) {
    throw new Error('Stale, replayed or mismatched signed approval');
  }
  if (isCompletion) {
    const review = before.reviewReceipt;
    if (!review) {
      throw new Error('Completion requires a current signed accepted review');
    }
    verifyReceipt(review, enrollment);
    if (p.intent !== 'complete' || p.reviewOperationId !== review.payload.operationId
      || review.payload.snapshotDigest !== p.snapshotDigest
      || !same(p.criteria, review.payload.criteria)
      || !p.criteria.every(entry => entry.result === 'met')
      || !same(before.review, receiptReview(review))
      || after.status !== 'done' || after.workStatus !== 'done'
      || !same(after.humanVerification, receiptVerification(receipt, enrollment))
      || !same(after.review, before.review) || !same(after.reviewReceipt, before.reviewReceipt)) {
      throw new Error('Completion needs separate signed intent and an all-met current review');
    }
  } else if (p.intent !== 'review'
    || after.status !== (needsModification(receipt) ? 'needs-modification' : 'under-review')
    || after.workStatus !== before.workStatus || !same(after.review, receiptReview(receipt))
    || !same(before.humanVerification, after.humanVerification)
    || !same(before.completionReceipt, after.completionReceipt)) {
    throw new Error('Review approval must preserve lifecycle state except for a signed needs-work rework transition');
  }
}
