// -----------------------------------------------------------------------------
// Client of the JSON API of the CCU WebUI (`/api/homematic.cgi`, JSON-RPC 1.1),
// the one path every CCU3, RaspberryMatic and piVCCU answers on its web port.
//
// What the code of the WebUI (eQ-3 OCCU, `WebUI/www/api`) says, and this
// client follows:
//   - `Session.login` gives a session id, or error 501 "invalid credentials or
//     too many sessions"; the session expires unless `Session.renew` is called
//     (the other calls do not extend it). An expired session reads as error
//     400 "access denied": log in again, once.
//   - `ReGa.runScript` needs an ADMIN user (error 400 otherwise);
//     `Interface.setValue` takes the XML-RPC type of the value (`bool`, `int`,
//     `double`, `string`); every parameter travels as a string, as
//     aiohomematic sends them.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { httpRequest } from './http.js';
import { fetchAllScript, parseFetchAll, parseRead, readScript } from './scripts.js';

const logger = createLogger({ name: 'homematic-ccu' });

export const API_PATH = '/api/homematic.cgi';

export const ERROR_KINDS = Object.freeze({
  UNREACHABLE: 'unreachable', // no answer, connection refused, timeout
  TLS: 'tls', // the HTTPS certificate is refused
  REDIRECT: 'redirect', // HTTP redirected to HTTPS ("automatic forwarding to HTTPS")
  NOT_CCU: 'not_ccu', // something answers, but not the CCU JSON API
  AUTH: 'auth', // user or password refused, or no free session
  NOT_ADMIN: 'not_admin', // the user is not an administrator: scripts are refused
  STARTING: 'starting', // the CCU answers 503: its logic layer is (re)starting
  API: 'api', // any other error of the JSON API
});

export class CcuError extends Error {
  constructor(kind, message, { code } = {}) {
    super(message);
    this.name = 'CcuError';
    this.kind = kind;
    this.code = code;
  }
}

// Session.renew well before the CCU session timeout (30 minutes).
const RENEW_MS = 5 * 60_000;
// A refused password is not tried again at every reading.
const AUTH_RETRY_MS = 5 * 60_000;
const TLS_CODES = /CERT|SELF_SIGNED|TLS|SSL|UNABLE_TO_VERIFY|UNABLE_TO_GET_ISSUER/;

// Interface.setValue type of each kind of value the integration writes.
export const VALUE_TYPES = Object.freeze({ BOOL: 'bool', INT: 'int', DOUBLE: 'double' });

export class CcuClient {
  /**
   * @param {object} options
   * @param {string} options.url base URL of the CCU WebUI (`http(s)://host[:port]`)
   * @param {string} options.username
   * @param {string} options.password
   * @param {boolean} [options.insecure] accept a self-signed certificate
   * @param {Function} [options.request] HTTP seam (src/ccu/http.js)
   * @param {() => number} [options.now]
   */
  constructor({ url, username, password, insecure = false, request = httpRequest, now }) {
    this.url = url;
    this.username = username;
    this.password = password;
    this.insecure = insecure;
    this.request = request;
    this.now = now ?? (() => Date.now());
    this.sessionId = null;
    this.renewedAt = 0;
    this.loggingIn = null;
    this.authFailure = null;
  }

  // --- Transport ---------------------------------------------------------------

  /** One JSON-RPC request; resolves with `result`, throws a CcuError. */
  async post(method, params, { timeoutMs } = {}) {
    let response;
    try {
      response = await this.request(`${this.url}${API_PATH}`, {
        json: { version: '1.1', method, params, id: 0 },
        insecure: this.insecure,
        timeoutMs,
      });
    } catch (err) {
      const code = String(err.code ?? '');
      if (TLS_CODES.test(code) || TLS_CODES.test(String(err.message))) {
        throw new CcuError(ERROR_KINDS.TLS, `TLS: ${err.message}`);
      }
      throw new CcuError(ERROR_KINDS.UNREACHABLE, `${method}: ${err.message}`);
    }
    if (response.status >= 300 && response.status < 400) {
      throw new CcuError(ERROR_KINDS.REDIRECT, `${method}: HTTP ${response.status} redirect`);
    }
    if (response.status === 503) {
      throw new CcuError(ERROR_KINDS.STARTING, `${method}: HTTP 503`);
    }
    let body;
    try {
      body = JSON.parse(response.body);
    } catch {
      throw new CcuError(
        ERROR_KINDS.NOT_CCU,
        `${method}: HTTP ${response.status}, not a JSON-RPC answer`,
      );
    }
    if (!body || typeof body !== 'object' || !('result' in body || 'error' in body)) {
      throw new CcuError(ERROR_KINDS.NOT_CCU, `${method}: not a JSON-RPC answer`);
    }
    if (body.error) {
      const code = Number(body.error.code);
      const message = String(body.error.message ?? '').split('\n')[0];
      throw new CcuError(ERROR_KINDS.API, `${method}: error ${code} ${message}`, { code });
    }
    return body.result;
  }

  // --- Session -----------------------------------------------------------------

  async login() {
    if (this.authFailure && this.now() - this.authFailure.at < AUTH_RETRY_MS) {
      throw this.authFailure.error;
    }
    this.loggingIn ??= (async () => {
      try {
        const sessionId = await this.post('Session.login', {
          username: this.username,
          password: this.password,
        });
        if (typeof sessionId !== 'string' || !sessionId) {
          throw new CcuError(ERROR_KINDS.NOT_CCU, 'Session.login: no session id');
        }
        this.sessionId = sessionId;
        this.renewedAt = this.now();
        this.authFailure = null;
        logger.debug('Logged in to the CCU');
        return sessionId;
      } catch (err) {
        if (err.kind === ERROR_KINDS.API && err.code === 501) {
          const error = new CcuError(
            ERROR_KINDS.AUTH,
            'Session.login refused: invalid credentials or too many sessions',
            { code: 501 },
          );
          this.authFailure = { at: this.now(), error };
          throw error;
        }
        if (err.kind === ERROR_KINDS.API && err.code === 503) {
          throw new CcuError(ERROR_KINDS.STARTING, err.message, { code: 503 });
        }
        throw err;
      } finally {
        this.loggingIn = null;
      }
    })();
    return this.loggingIn;
  }

  async logout() {
    const sessionId = this.sessionId;
    this.sessionId = null;
    if (!sessionId) {
      return;
    }
    try {
      await this.post('Session.logout', { _session_id_: sessionId }, { timeoutMs: 5_000 });
    } catch (err) {
      logger.debug(`Session.logout failed: ${err.message}`);
    }
  }

  async session() {
    if (!this.sessionId) {
      return { sessionId: await this.login(), fresh: true };
    }
    if (this.now() - this.renewedAt >= RENEW_MS) {
      try {
        await this.post('Session.renew', { _session_id_: this.sessionId });
        this.renewedAt = this.now();
      } catch (err) {
        if (err.kind !== ERROR_KINDS.API) {
          throw err;
        }
        this.sessionId = null;
        return { sessionId: await this.login(), fresh: true };
      }
    }
    return { sessionId: this.sessionId, fresh: false };
  }

  /**
   * A call in the session. "Access denied" on an old session means it
   * expired: log in again and retry once. On a fresh one, the user lacks
   * the rights.
   */
  async call(method, params = {}, options = {}) {
    let { sessionId, fresh } = await this.session();
    for (;;) {
      try {
        return await this.post(method, { _session_id_: sessionId, ...params }, options);
      } catch (err) {
        if (err.kind !== ERROR_KINDS.API || err.code !== 400) {
          throw err;
        }
        if (fresh) {
          throw new CcuError(ERROR_KINDS.NOT_ADMIN, `${method}: access denied`, { code: 400 });
        }
        logger.debug(`${method}: session expired, logging in again`);
        this.sessionId = null;
        ({ sessionId, fresh } = await this.session());
      }
    }
  }

  // --- The API calls the integration uses ------------------------------------------

  /** @returns {Promise<string>} what the script wrote */
  async runScript(script, { timeoutMs = 30_000 } = {}) {
    const result = await this.call('ReGa.runScript', { script }, { timeoutMs });
    return typeof result === 'string' ? result : '';
  }

  /** @returns {Promise<Array<{ name: string }>>} */
  async listInterfaces() {
    const result = await this.call('Interface.listInterfaces');
    return Array.isArray(result) ? result : [];
  }

  /** Every device the CCU finished configuring, with its channels. */
  async listDevices() {
    const result = await this.call('Device.listAllDetail', {}, { timeoutMs: 30_000 });
    return Array.isArray(result) ? result : [];
  }

  async listSysVars() {
    const result = await this.call('SysVar.getAll');
    return Array.isArray(result) ? result : [];
  }

  async listPrograms() {
    const result = await this.call('Program.getAll');
    return Array.isArray(result) ? result : [];
  }

  /** @returns {Promise<boolean>} whether the CCU ran the program */
  async executeProgram(id) {
    const result = await this.call('Program.execute', { id: String(id) });
    return result === true || result === 'true';
  }

  async getVersion() {
    try {
      const version = await this.call('CCU.getVersion');
      return typeof version === 'string' ? version : null;
    } catch (err) {
      if (err.kind === ERROR_KINDS.API || err.kind === ERROR_KINDS.NOT_ADMIN) {
        return null;
      }
      throw err;
    }
  }

  /**
   * @param {string} iface
   * @param {string} address channel address, `<device>:<channel>`
   * @param {string} parameter
   * @param {'bool'|'int'|'double'} type
   * @param {boolean|number} value
   */
  async setValue(iface, address, parameter, type, value) {
    const text =
      type === VALUE_TYPES.BOOL ? (value ? '1' : '0') : String(Number.isFinite(value) ? value : 0);
    await this.call('Interface.setValue', {
      interface: iface,
      address,
      valueKey: parameter,
      type,
      value: text,
    });
  }

  /** Every value of one interface (device discovery). */
  async fetchAll(iface) {
    return parseFetchAll(await this.runScript(fetchAllScript(iface)));
  }

  /** The values and timestamps of the given datapoints and system variables. */
  async read(names, sysvarIds) {
    return parseRead(await this.runScript(readScript(names, sysvarIds)));
  }
}
