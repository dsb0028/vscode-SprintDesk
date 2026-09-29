import * as path from 'path';
import yaml from 'js-yaml';
import { getHost, getSecureStore, ISecureStore } from '../../host';

/** A registered SprintDesk human reviewer. No other fields are persisted. */
export interface ReviewerRecord {
  id: string;
  displayName: string;
}

export const REVIEWER_ID_MAX_LENGTH = 128;
export const REVIEWER_DISPLAY_NAME_MAX_LENGTH = 200;

const REGISTRY_RELATIVE_PATH = ['.SprintDesk', 'data', 'reviewers.yml'];
const REGISTRY_LIST_KEY = 'reviewers';
const REVIEWER_FIELDS = ['id', 'displayName'];

/** Trims a reviewer identifier, matching the registration normalization contract. */
export function normalizeReviewerId(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** Trims and collapses inner whitespace in a reviewer display name. */
export function normalizeReviewerDisplayName(value: unknown): string {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseRegistryDocument(content: string): ReviewerRecord[] {
  let document: unknown;
  try {
    document = yaml.load(content);
  } catch {
    throw new Error('The reviewer registry contains malformed YAML');
  }

  if (!isPlainObject(document)) {
    throw new Error("The reviewer registry must be a mapping with a 'reviewers' list");
  }
  const unknownKeys = Object.keys(document).filter(key => key !== REGISTRY_LIST_KEY);
  if (unknownKeys.length > 0) {
    throw new Error(`The reviewer registry contains unsupported top-level keys: ${unknownKeys.join(', ')}`);
  }
  const entries = document[REGISTRY_LIST_KEY];
  if (!Array.isArray(entries)) {
    throw new Error("The reviewer registry field 'reviewers' must be a list");
  }

  return validateRecords(entries.map((entry, index) => parseRegistryEntry(entry, index)));
}

function parseRegistryEntry(entry: unknown, index: number): ReviewerRecord {
  const position = index + 1;
  if (!isPlainObject(entry)) {
    throw new Error(`Reviewer record ${position} must be a mapping`);
  }
  const unknownFields = Object.keys(entry).filter(field => !REVIEWER_FIELDS.includes(field));
  if (unknownFields.length > 0) {
    throw new Error(`Reviewer record ${position} contains unsupported fields: ${unknownFields.join(', ')}`);
  }
  if (typeof entry.id !== 'string' || typeof entry.displayName !== 'string') {
    throw new Error(`Reviewer record ${position} must define string 'id' and 'displayName' values`);
  }
  return buildRecord(entry.id, entry.displayName, `Reviewer record ${position}`);
}

function buildRecord(rawId: string, rawDisplayName: string, subject: string): ReviewerRecord {
  const id = normalizeReviewerId(rawId);
  const displayName = normalizeReviewerDisplayName(rawDisplayName);
  if (!id || id.length > REVIEWER_ID_MAX_LENGTH) {
    throw new Error(`${subject} must define an id between 1 and ${REVIEWER_ID_MAX_LENGTH} characters`);
  }
  if (!displayName || displayName.length > REVIEWER_DISPLAY_NAME_MAX_LENGTH) {
    throw new Error(
      `${subject} must define a displayName between 1 and ${REVIEWER_DISPLAY_NAME_MAX_LENGTH} characters`
    );
  }
  return { id, displayName };
}

function validateRecords(records: ReviewerRecord[]): ReviewerRecord[] {
  const seen = new Set<string>();
  records.forEach((record, index) => {
    if (seen.has(record.id)) {
      throw new Error(`Reviewer record ${index + 1} duplicates an already registered reviewer id`);
    }
    seen.add(record.id);
  });
  return records;
}

/**
 * The single persistence boundary for SprintDesk human reviewers.
 *
 * Records live in `.SprintDesk/data/reviewers.yml`, are listed in insertion
 * order, are written atomically under a cross-process lock, and never appear in
 * error messages.
 *
 * This registry is independent of the workforce employee registry in
 * `.SprintDesk/workforce/employees.yml`. Reviewer authority is never inferred
 * from employee records, and this store neither reads nor writes them.
 */
export class ReviewerStore {
  readonly filePath: string;
  readonly lockPath: string;
  private readonly secureStore: ISecureStore;

  constructor(workspaceRoot?: string) {
    const root = workspaceRoot || getHost().getWorkspaceRoot() || '';
    this.filePath = path.join(root, ...REGISTRY_RELATIVE_PATH);
    this.lockPath = `${this.filePath}.lock`;
    this.secureStore = getSecureStore();
  }

  /**
   * Returns every registered reviewer in stable insertion order.
   *
   * A workspace with no registry file has no registered reviewers and reads as
   * an empty list without creating the file.
   */
  list(): ReviewerRecord[] {
    const content = this.secureStore.readSecureText(this.filePath);
    if (content === undefined) {
      return [];
    }
    return parseRegistryDocument(content);
  }

  count(): number {
    return this.list().length;
  }

  /** Resolves a reviewer by normalized id, falling back to an exact display name. */
  find(idOrDisplayName: string | undefined): ReviewerRecord | undefined {
    const id = normalizeReviewerId(idOrDisplayName);
    if (!id) {
      return undefined;
    }
    const records = this.list();
    const displayName = normalizeReviewerDisplayName(idOrDisplayName);
    return records.find(record => record.id === id)
      || records.find(record => record.displayName === displayName);
  }

  has(idOrDisplayName: string | undefined): boolean {
    return this.find(idOrDisplayName) !== undefined;
  }

  /** Appends a reviewer, rejecting normalized-equivalent duplicate identifiers. */
  register(input: { reviewerId: string; displayName: string }): ReviewerRecord {
    const record = buildRecord(input.reviewerId, input.displayName, 'The reviewer');
    return this.secureStore.withFileLock(this.lockPath, () => {
      const records = this.list();
      if (records.some(existing => existing.id === record.id)) {
        throw new Error('Reviewer already registered');
      }
      if (records.some(existing => existing.displayName === record.displayName)) {
        throw new Error('Reviewer name is already in use');
      }
      this.writeRegistry([...records, record]);
      return record;
    });
  }

  private writeRegistry(records: ReviewerRecord[]): void {
    const validated = validateRecords(records).map(record => ({
      id: record.id,
      displayName: record.displayName
    }));
    this.secureStore.writeSecureText(this.filePath, yaml.dump({ [REGISTRY_LIST_KEY]: validated }));
  }
}
