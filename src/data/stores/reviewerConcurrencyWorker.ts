import { ReviewerStore } from './ReviewerStore';

/**
 * Registers a deterministic block of reviewers from a separate process so the
 * registry lock can be exercised under real cross-process contention.
 */
function main(): void {
  const [workspaceRoot, prefix, countArgument] = process.argv.slice(2);
  const store = new ReviewerStore(workspaceRoot);
  const count = Number.parseInt(countArgument, 10);

  for (let index = 0; index < count; index += 1) {
    store.register({ reviewerId: `${prefix}-${index}`, displayName: `Reviewer ${prefix} ${index}` });
  }
}

try {
  main();
} catch (error: unknown) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
