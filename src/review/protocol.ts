import { createHash, createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';

export interface Enrollment {
  version: 1;
  projectId: string;
  reviewerId: string;
  reviewerName: string;
  keyId: string;
  publicKey: string;
}

export interface ReviewSnapshot {
  version: 1;
  projectId: string;
  taskId: string;
  createdAt: string;
  metadata: Record<string, unknown>;
  criteria: string[];
  markdown: string;
  evidence: { path: string; content: string }[];
}

export interface ReceiptPayload {
  version: 1;
  intent: 'review' | 'complete';
  projectId: string;
  taskId: string;
  createdAt: string;
  incarnation: string;
  reviewerId: string;
  keyId: string;
  snapshotDigest: string;
  expectedStatus: 'under-review';
  operationId: string;
  sequence: number;
  timestamp: string;
  criteria: { criterion: string; result: 'met' | 'needs work' }[];
  evidencePaths: string[];
  reviewOperationId?: string;
}

export interface SignedReceipt {
  payload: ReceiptPayload;
  signature: string;
}

export interface SnapshotResponse {
  snapshot: ReviewSnapshot;
  status: string;
  workStatus?: string;
  reviewReceipt?: SignedReceipt;
  completionReceipt?: SignedReceipt;
  review?: unknown;
  humanVerification?: unknown;
}

export function canonical(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonical).join(',')}]`;
  }
  if (typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().filter(key => record[key] !== undefined)
      .map(key => `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`;
  }
  throw new Error('Unsupported canonical value');
}

export function digest(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex');
}

export function keyId(publicKey: string): string {
  const key = createPublicKey(publicKey);
  if (key.asymmetricKeyType !== 'ed25519') {
    throw new Error('Reviewer key must be Ed25519');
  }
  return createHash('sha256').update(key.export({ type: 'spki', format: 'der' })).digest('hex');
}

export function signReceipt(payload: ReceiptPayload, privateKey: string): SignedReceipt {
  const key = createPrivateKey(privateKey);
  if (key.asymmetricKeyType !== 'ed25519') {
    throw new Error('Reviewer key must be Ed25519');
  }
  return { payload, signature: sign(null, Buffer.from(canonical(payload)), key).toString('base64') };
}

export function verifyReceipt(receipt: SignedReceipt, enrollment: Enrollment): void {
  const p = receipt.payload;
  if (!p || typeof receipt.signature !== 'string' || !/^[A-Za-z0-9+/]{86}==$/.test(receipt.signature)
    || p.version !== 1 || enrollment.version !== 1 || p.projectId !== enrollment.projectId
    || p.reviewerId !== enrollment.reviewerId || p.keyId !== enrollment.keyId
    || keyId(enrollment.publicKey) !== enrollment.keyId
    || p.expectedStatus !== 'under-review'
    || !['review', 'complete'].includes(p.intent)
    || !Number.isSafeInteger(p.sequence) || p.sequence < 1
    || !/^[a-f0-9]{64}$/.test(p.snapshotDigest)
    || [p.operationId, p.incarnation, p.taskId, p.createdAt, p.timestamp].some(value =>
      typeof value !== 'string' || value.length === 0)
    || !Number.isFinite(Date.parse(p.timestamp)) || !Number.isFinite(Date.parse(p.createdAt))
    || !Array.isArray(p.criteria) || p.criteria.length === 0
    || p.criteria.some(entry => typeof entry.criterion !== 'string'
      || !['met', 'needs work'].includes(entry.result))
    || !Array.isArray(p.evidencePaths) || p.evidencePaths.some(item => typeof item !== 'string')) {
    throw new Error('Invalid reviewer authorization payload');
  }
  if (!verify(null, Buffer.from(canonical(p)), enrollment.publicKey,
    Buffer.from(receipt.signature, 'base64'))) {
    throw new Error('Invalid reviewer signature');
  }
}

export function reviewedMarkdown(markdown: string): string {
  return markdown.replace(/\r\n/g, '\n')
    .replace(/(?:^|\n)### Review Handoff\n[\s\S]*?(?=\n## |\s*$)/, '')
    .trimEnd();
}
