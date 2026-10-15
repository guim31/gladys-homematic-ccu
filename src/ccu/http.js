// -----------------------------------------------------------------------------
// The one function that talks to the network: an HTTP(S) POST with a JSON
// body, on node:http / node:https. Not on fetch: fetch cannot accept the
// self-signed certificate of one server only (the CCU serves HTTPS with a
// self-signed certificate by default), node:https can, per request.
//
// The client takes this function as a parameter: the tests replace it with an
// in-memory CCU (test/helpers/fakeCcu.js).
// -----------------------------------------------------------------------------

import http from 'node:http';
import https from 'node:https';

// A full `fetch_all_device_data` of a large installation is a few hundred KB.
const MAX_BODY_BYTES = 8 * 1024 * 1024;

const utf8 = new TextDecoder('utf-8', { fatal: true });
const latin1 = new TextDecoder('latin1');

/**
 * The CCU answers in UTF-8 since its 3.x firmwares, in ISO-8859-1 before:
 * decode as UTF-8, fall back to Latin-1 when the bytes are not valid UTF-8.
 * @param {Uint8Array} bytes
 */
export function decodeText(bytes) {
  try {
    return utf8.decode(bytes);
  } catch {
    return latin1.decode(bytes);
  }
}

/**
 * @param {string} url absolute URL
 * @param {object} [options]
 * @param {unknown} [options.json] body, sent as JSON
 * @param {boolean} [options.insecure] accept a certificate that does not verify (HTTPS only)
 * @param {number} [options.timeoutMs]
 * @returns {Promise<{ status: number, headers: Record<string, string>, body: string }>}
 */
export function httpRequest(url, { json, insecure = false, timeoutMs = 15_000 } = {}) {
  const target = new URL(url);
  const isHttps = target.protocol === 'https:';
  const payload = Buffer.from(JSON.stringify(json ?? {}));

  return new Promise((resolve, reject) => {
    const request = (isHttps ? https : http).request(
      target,
      {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          'content-length': payload.length,
        },
        timeout: timeoutMs,
        ...(isHttps ? { rejectUnauthorized: !insecure } : {}),
      },
      (response) => {
        const chunks = [];
        let size = 0;
        response.on('data', (chunk) => {
          size += chunk.length;
          if (size > MAX_BODY_BYTES) {
            request.destroy(new Error('Response too large'));
            return;
          }
          chunks.push(chunk);
        });
        response.on('end', () =>
          resolve({
            status: response.statusCode ?? 0,
            headers: response.headers,
            body: decodeText(Buffer.concat(chunks)),
          }),
        );
        response.on('error', reject);
      },
    );
    request.on('timeout', () => {
      const error = new Error(`Timed out after ${timeoutMs} ms`);
      error.code = 'ETIMEDOUT';
      request.destroy(error);
    });
    request.on('error', reject);
    request.end(payload);
  });
}
