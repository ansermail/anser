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

// Coalesce event bursts into at most one refresh per interval. Manual actions
// continue to use coalesceRefresh above so their feedback stays immediate.
export function throttledRefresh(work: () => Promise<void>, intervalMs = 1000) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running: Promise<void> | null = null;
  let pending = false;
  function run() {
    running = Promise.resolve()
      .then(work)
      .catch(() => {})
      .finally(() => {
        running = null;
        if (pending) {
          pending = false;
          schedule();
        }
      });
  }
  function schedule() {
    if (timer || running) return;
    timer = setTimeout(() => {
      timer = null;
      pending = false;
      run();
    }, intervalMs);
  }
  return function refresh(): Promise<void> {
    pending = true;
    schedule();
    return Promise.resolve();
  };
}
