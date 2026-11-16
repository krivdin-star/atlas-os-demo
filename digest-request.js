export class DigestTimeoutError extends Error {}

export async function requestDigest(baseUrl, session, digest, timeoutMs = 8000, signal, publicKey) {
  if (!publicKey) return requestAtlas(baseUrl, 'atlas-read-digest', { session, digest }, timeoutMs, signal);
  let hedge;
  const routes = { primary: 'waiting', fallback: 'waiting' };
  try {
    return await withDeadline(async requestSignal => {
      const read = async (route, url, values, headers) => {
        routes[route] = 'pending';
        let result;
        try { result = await post(url, values, headers, requestSignal); }
        catch (error) {
          routes[route] = /^Digest HTTP \d{3}$/u.test(error.message)
            ? error.message.replace('Digest ', '') : 'network';
          throw error;
        }
        routes[route] = 'response';
        if (result?.error === 'unauthorized' || result?.error === 'not_found') return result;
        if (!['pc', 'phone'].includes(result?.kind) || !Object.hasOwn(result, 'digest')) {
          routes[route] = 'invalid_response';
          throw new Error('Invalid digest response');
        }
        return result;
      };
      let startFallback;
      const fallback = new Promise((resolve, reject) => {
        let started = false;
        startFallback = () => {
          if (started || requestSignal.aborted) return;
          started = true;
          clearTimeout(hedge);
          read('fallback', baseUrl + '/rest/v1/rpc/atlas_open_digest', { p_session: session, p_digest: digest },
            { apikey: publicKey, 'Content-Type': 'application/json' }).then(resolve, reject);
        };
        hedge = setTimeout(startFallback, Math.min(1500, timeoutMs / 2));
      });
      const primary = read('primary', baseUrl + '/functions/v1/atlas-read-digest', { session, digest },
        { 'Content-Type': 'text/plain;charset=UTF-8' }).catch(error => {
        startFallback();
        throw error;
      });
      return Promise.any([primary, fallback]);
    }, timeoutMs, signal);
  } catch (error) {
    error.connection = { ...routes };
    throw error;
  } finally { clearTimeout(hedge); }
}

async function post(url, values, headers, signal) {
  const response = await fetch(url, {
    method: 'POST', headers, body: JSON.stringify(values),
    referrerPolicy: 'no-referrer', cache: 'no-store', signal,
  });
  if (!response.ok) throw new Error('Digest HTTP ' + response.status);
  return response.json();
}

export function requestAtlas(baseUrl, functionName, values, timeoutMs = 8000, signal) {
  return withDeadline(requestSignal => post(baseUrl + '/functions/v1/' + functionName,
    values, { 'Content-Type': 'text/plain;charset=UTF-8' }, requestSignal), timeoutMs, signal);
}

async function withDeadline(run, timeoutMs, signal) {
  const controller = new AbortController();
  if (signal?.aborted) throw signal.reason;
  let rejectCancelled;
  const cancelled = new Promise((_, reject) => { rejectCancelled = reject; });
  const cancel = () => {
    controller.abort();
    rejectCancelled(signal.reason ?? new DOMException('Aborted', 'AbortError'));
  };
  signal?.addEventListener('abort', cancel, { once: true });
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new DigestTimeoutError('Digest request timed out'));
      controller.abort();
    }, timeoutMs);
  });
  try {
    return await Promise.race([deadline, cancelled, run(controller.signal)]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
    controller.abort();
  }
}
