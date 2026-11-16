export function createDigestLoader({ visible, start, read, loaded, failed, retryDelays = [1500, 4000] }) {
  let active;
  let pending = false;
  let retryTimer;
  let failures = 0;

  function pause() {
    clearTimeout(retryTimer);
    if (!active) return;
    pending = true;
    active.abort();
    active = null;
  }

  async function refresh(reset = true) {
    pause();
    if (reset) failures = 0;
    start();
    if (!visible()) {
      pending = true;
      return;
    }
    pending = false;
    const attempt = new AbortController();
    active = attempt;

    try {
      const result = await read(attempt.signal);
      if (active === attempt) loaded(result);
    } catch (error) {
      if (active === attempt) {
        pending = true;
        const delay = retryDelays[failures++];
        failed(error, { retrying: delay !== undefined });
        if (delay !== undefined) retryTimer = setTimeout(() => {
          if (pending && visible()) void refresh(false);
        }, delay);
      }
    } finally {
      if (active === attempt) active = null;
    }
  }

  return {
    refresh, pause,
    stop() { pause(); pending = false; },
    resume() { if (pending && !active && visible()) void refresh(false); },
    reconnect() { if ((pending || active) && visible()) void refresh(); },
  };
}
