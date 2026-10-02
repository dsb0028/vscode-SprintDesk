import { reviewedMarkdown } from './protocol';

export interface CriterionEvidence {
  criterion: string;
  content: string;
}

function evidenceSection(markdown: string): string {
  const reviewed = reviewedMarkdown(markdown);
  const headings = [...reviewed.matchAll(/(?:^|\n)## Evidence[ \t]*(?:\r?\n|$)/g)];
  if (headings.length !== 1) {
    throw new Error('Review requires exactly one ## Evidence section.');
  }
  const match = reviewed.match(
    /(?:^|\n)## Evidence[ \t]*\r?\n([\s\S]*?)(?=\n## |\s*$)/,
  );
  if (!match) {
    throw new Error('Review requires a non-empty ## Evidence section.');
  }
  return match[1];
}

export function assertCriterionEvidence(markdown: string, criteria: string[]): void {
  if (!criteria.length) {
    throw new Error('Review requires acceptance criteria before validating evidence.');
  }

  const section = evidenceSection(markdown);
  const headings = [...section.matchAll(/(?:^|\n)### Criterion (\d+)[ \t]*(?:\r?\n|$)/g)];
  const sectionHeadings = [...section.matchAll(/(?:^|\n)### .+(?:\r?\n|$)/g)];
  if (headings.length !== criteria.length || sectionHeadings.length !== criteria.length
    || headings.some((heading, index) => heading[1] !== `${index + 1}`)) {
    throw new Error('Evidence must include one ordered ### Criterion N subsection for every acceptance criterion.');
  }

  for (const [index, heading] of headings.entries()) {
    const contentStart = heading.index! + heading[0].length;
    const contentEnd = index + 1 < headings.length
      ? headings[index + 1].index!
      : section.length;
    if (!section.slice(contentStart, contentEnd).trim()) {
      throw new Error(`Evidence for Criterion ${index + 1} must not be blank.`);
    }
  }
}

export function renderCriterionEvidence(
  markdown: string, criteria: string[], evidence: CriterionEvidence[],
): string {
  if (!Array.isArray(evidence) || evidence.length !== criteria.length
    || evidence.some((entry, index) => !entry || entry.criterion !== criteria[index]
      || typeof entry.content !== 'string' || !entry.content.trim())) {
    throw new Error('Execution evidence must provide non-empty content for every exact acceptance criterion in order.');
  }

  const block = [
    '## Evidence',
    '',
    ...evidence.flatMap((entry, index) => [
      `### Criterion ${index + 1}`,
      '',
      entry.content.trim(),
      '',
    ]),
  ].join('\n').trimEnd();
  const sectionPattern = /(?:^|\n)## Evidence[ \t]*\r?\n[\s\S]*?(?=\n## |\s*$)/;
  const existing = markdown.match(sectionPattern);
  if (existing) {
    return markdown.replace(sectionPattern, `${existing[0].startsWith('\n') ? '\n' : ''}${block}`);
  }

  const insertBefore = markdown.indexOf('\n## 📝 Notes');
  if (insertBefore >= 0) {
    return `${markdown.slice(0, insertBefore).trimEnd()}\n\n${block}${markdown.slice(insertBefore)}`;
  }
  return `${markdown.trimEnd()}\n\n${block}\n`;
}
