// During a download burst, run one refresh at a time and remember only one
// pending refresh. The next run reads the latest query, never a queued old one.
export function coalesceRefresh(work: () => Promise<void>) {
  let running: Promise<void> | null = null;
  let pending = false;
  return function refresh(): Promise<void> {
    pending = true;
    if (running) return running;
    running = (async () => {
      do {
        pending = false;
        await work();
      } while (pending);
    })().finally(() => {
      running = null;
      if (pending) return refresh();
    });
    return running;
  };
}
