export function createDigestLoader({ visible, start, read, loaded, failed }) {
  let active;
  let pending = false;

  function pause() {
    if (!active) return;
    pending = true;
    active.abort();
    active = null;
  }

  async function refresh() {
    pause();
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
      if (active === attempt) failed(error);
    } finally {
      if (active === attempt) active = null;
    }
  }

  return { refresh, pause, resume() { if (pending && visible()) void refresh(); } };
}
