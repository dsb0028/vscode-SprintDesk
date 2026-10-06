/**
 * Mechanical review-verdict arithmetic only. This module selects no rating, authenticates no
 * evidence/consent and reuses the canonical review-policy thresholds exactly as supplied; it
 * never duplicates rubric anchor text or report-schema validation. A quality verdict computed
 * here never by itself authorizes implementation, status mutation, signing or human acceptance.
 */

import type {
  EvidenceScoredReviewReport, EvidenceUnavailableReviewReport, ReviewReport, ReviewVerdict,
  SixDimensionReviewReport,
} from './reviewReports';
import { ReviewPolicy, ReviewerProfile } from './reviewPolicy';

export type { ReviewReport };

export type ReviewVerdictResult =
  | { readonly verdict: ReviewVerdict; readonly sum: number; readonly mean: number }
  | { readonly verdict: ReviewVerdict; readonly rawTotal: number; readonly effectiveScore: number }
  | { readonly verdict: 'BLOCKED' };

type SixDimensionStage = 'planning' | 'translation' | 'test_code';

function reviewerProfileFor(stage: SixDimensionStage, policy: ReviewPolicy): ReviewerProfile {
  return policy.reviewers[stage];
}

function hasMandatoryFinding(report: ReviewReport): boolean {
  return report.findings.some(finding => finding.mandatory);
}

function evaluateSixDimension(report: SixDimensionReviewReport, policy: ReviewPolicy): ReviewVerdictResult {
  const sum = report.dimensions.reduce((total, dimension) => total + dimension.rating, 0);
  const mean = sum / report.dimensions.length;

  if (report.blockers.length > 0) {
    return Object.freeze({ verdict: 'BLOCKED' as const, sum, mean });
  }
  if (hasMandatoryFinding(report)) {
    return Object.freeze({ verdict: 'CHANGES_REQUIRED' as const, sum, mean });
  }

  const profile = reviewerProfileFor(report.binding.stage as SixDimensionStage, policy);
  const minimumRating = Math.min(...report.dimensions.map(dimension => dimension.rating));
  const verdict: ReviewVerdict = (mean >= profile.minimum_average && minimumRating >= profile.minimum_dimension)
    ? 'QUALITY_VERIFIED'
    : 'CHANGES_REQUIRED';
  return Object.freeze({ verdict, sum, mean });
}

function evaluateEvidenceScored(report: EvidenceScoredReviewReport, policy: ReviewPolicy): ReviewVerdictResult {
  const rawTotal = report.dimensions.reduce((total, dimension) => total + dimension.rating, 0);
  const minimumScore = policy.evidence_validator.minimum_score;
  const effectiveScore = hasMandatoryFinding(report) ? Math.min(rawTotal, minimumScore - 1) : rawTotal;

  if (report.blockers.length > 0) {
    return Object.freeze({ verdict: 'BLOCKED' as const, rawTotal, effectiveScore });
  }
  const verdict: ReviewVerdict = effectiveScore >= minimumScore ? 'QUALITY_VERIFIED' : 'CHANGES_REQUIRED';
  return Object.freeze({ verdict, rawTotal, effectiveScore });
}

function evaluateEvidenceUnavailable(_report: EvidenceUnavailableReviewReport): ReviewVerdictResult {
  return Object.freeze({ verdict: 'BLOCKED' as const });
}

export function evaluateReviewReport(report: ReviewReport, policy: ReviewPolicy): ReviewVerdictResult {
  if (report.evaluation === 'unavailable') {
    return evaluateEvidenceUnavailable(report);
  }
  if (report.binding.stage === 'evidence') {
    return evaluateEvidenceScored(report as EvidenceScoredReviewReport, policy);
  }
  return evaluateSixDimension(report as SixDimensionReviewReport, policy);
}
