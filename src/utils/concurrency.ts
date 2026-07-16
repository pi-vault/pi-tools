/**
 * Run async tasks with a bounded concurrency limit.
 * Returns PromiseSettledResult<T>[] preserving the original task order.
 *
 * Uses a simple worker-pool pattern: `maxConcurrent` workers pull tasks
 * from a shared index counter until all tasks are consumed.
 */
export async function fetchWithConcurrencyLimit<T>(
  tasks: (() => Promise<T>)[],
  maxConcurrent: number,
): Promise<PromiseSettledResult<T>[]> {
  const results: PromiseSettledResult<T>[] = new Array(tasks.length);
  let nextIndex = 0;

  async function runNext(): Promise<void> {
    while (nextIndex < tasks.length) {
      const index = nextIndex++;
      try {
        const value = await tasks[index]();
        results[index] = { status: "fulfilled", value };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  }

  const workers = Array.from(
    { length: Math.min(maxConcurrent, tasks.length) },
    () => runNext(),
  );
  await Promise.all(workers);
  return results;
}
