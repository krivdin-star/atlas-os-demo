export class DigestTimeoutError extends Error {}

export async function requestDigest(baseUrl, session, digest, timeoutMs = 8000) {
  const controller = new AbortController();
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new DigestTimeoutError('Digest request timed out'));
      controller.abort();
    }, timeoutMs);
  });
  const request = async () => {
    const response = await fetch(baseUrl + '/functions/v1/atlas-read-digest', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify({ session, digest }),
      referrerPolicy: 'no-referrer',
      signal: controller.signal,
    });
    if (!response.ok) throw new Error('Digest HTTP ' + response.status);
    return response.json();
  };
  try {
    return await Promise.race([deadline, request()]);
  } finally {
    clearTimeout(timer);
  }
}
