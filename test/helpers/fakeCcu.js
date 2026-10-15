// -----------------------------------------------------------------------------
// An in-memory CCU answering the JSON API of its WebUI (`/api/homematic.cgi`)
// the way the eQ-3 code does (OCCU `WebUI/www/api`): sessions, privilege
// levels, error codes 400 / 501, `Interface.setValue` typing, and the two
// HomeMatic scripts of the integration, whose output it writes in the format
// ReGa writes (UriEncode'd names and strings, floats with six decimals).
//
// Its devices, values, system variables and programs come from
// test/fixtures/ccu (see the README there). The devices react to commands the
// way the real ones do: a Homematic IP output reports its new state on its
// transmitter channel, a thermostat changes mode.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';

const fixture = (name) =>
  JSON.parse(readFileSync(new URL(`../fixtures/ccu/${name}.json`, import.meta.url), 'utf8'));

export const FIXTURES = {
  devices: fixture('devices'),
  values: fixture('values'),
  sysvars: fixture('sysvars'),
  programs: fixture('programs'),
  interfaces: fixture('interfaces'),
};

export const FIRMWARE = '3.83.6.20250824';
const LEVELS = { NONE: 0, GUEST: 1, USER: 2, ADMIN: 8 };
const METHOD_LEVELS = {
  'Session.login': 'NONE',
  'Session.logout': 'NONE',
  'Session.renew': 'GUEST',
  'Interface.listInterfaces': 'GUEST',
  'Interface.setValue': 'GUEST',
  'Device.listAllDetail': 'GUEST',
  'SysVar.getAll': 'USER',
  'Program.getAll': 'USER',
  'Program.execute': 'USER',
  'CCU.getVersion': 'ADMIN',
  'ReGa.runScript': 'ADMIN',
};
const SESSION_TTL_MS = 30 * 60_000;

/** ReGa `UriEncode()`: every byte but letters and digits as %XX. */
export function regaEncode(text, { latin1 = false } = {}) {
  const bytes = latin1 ? Buffer.from(String(text), 'latin1') : Buffer.from(String(text), 'utf8');
  let out = '';
  for (const byte of bytes) {
    const char = String.fromCharCode(byte);
    out += /[A-Za-z0-9]/.test(char) ? char : `%${byte.toString(16).toUpperCase().padStart(2, '0')}`;
  }
  return out;
}

/** What ReGa `Write()` prints for a number: floats with six decimals. */
const regaNumber = (value) => (Number.isInteger(value) ? String(value) : value.toFixed(6));

const typedSysVar = (sysvar) => {
  switch (sysvar.type) {
    case 'LOGIC':
    case 'ALARM':
      return sysvar.value === 'true';
    case 'NUMBER':
    case 'LIST':
      return Number(sysvar.value);
    default:
      return String(sysvar.value ?? '');
  }
};

export class FakeCcu {
  /**
   * @param {object} [options]
   * @param {() => number} [options.now]
   * @param {Record<string, { password: string, level: string }>} [options.users]
   * @param {boolean} [options.latin1] write UriEncode'd strings in ISO-8859-1 (old firmwares)
   */
  constructor({
    now = () => Date.now(),
    users = { Admin: { password: 'secret', level: 'ADMIN' } },
    latin1 = false,
  } = {}) {
    this.now = now;
    this.users = users;
    this.latin1 = latin1;
    this.devices = structuredClone(FIXTURES.devices);
    this.interfaces = structuredClone(FIXTURES.interfaces).concat({
      name: 'BidCos-Wired',
      port: 32000,
      info: 'BidCos-Wired',
    });
    this.sysvars = structuredClone(FIXTURES.sysvars);
    this.programs = structuredClone(FIXTURES.programs);
    /** Datapoint name → { value, ts } (ts in seconds). */
    this.datapoints = new Map();
    const start = Math.floor(now() / 1000) - 3600;
    for (const [name, value] of Object.entries(FIXTURES.values)) {
      this.datapoints.set(name, { value, ts: start });
    }
    this.sessions = new Map();
    this.nextSession = 1;
    this.online = true;
    this.requests = [];
    this.writes = [];
    this.executed = [];
    // Test switches: answer as something else than a CCU.
    this.mode = 'ccu'; // 'ccu' | 'redirect' | 'html' | 'starting'
  }

  // --- Test helpers ------------------------------------------------------------------

  device(type) {
    return this.devices.find((device) => device.type === type);
  }

  dp(type, channel, parameter) {
    const device = this.device(type);
    return `${device.interface}.${device.address}:${channel}.${parameter}`;
  }

  get(name) {
    return this.datapoints.get(name)?.value;
  }

  /** A value changes on the CCU (a device reported it). */
  set(name, value) {
    const previous = this.datapoints.get(name);
    this.datapoints.set(name, {
      value,
      ts: Math.max(Math.floor(this.now() / 1000), (previous?.ts ?? 0) + 1),
    });
  }

  /** A button is pressed on a device. */
  press(type, channel, kind = 'PRESS_SHORT') {
    this.set(this.dp(type, channel, kind), true);
  }

  /** The requests of one method. */
  calls(method) {
    return this.requests.filter((request) => request.method === method);
  }

  expireSessions() {
    this.sessions.clear();
  }

  // --- HTTP --------------------------------------------------------------------------

  handle(url, { json } = {}) {
    if (this.mode === 'redirect') {
      return { status: 301, headers: { location: url.replace('http:', 'https:') }, body: '' };
    }
    if (this.mode === 'html') {
      return { status: 404, headers: {}, body: '<html>Not found</html>' };
    }
    if (this.mode === 'starting') {
      return { status: 503, headers: {}, body: '' };
    }
    if (!url.endsWith('/api/homematic.cgi')) {
      return { status: 404, headers: {}, body: 'not found' };
    }
    const { method, params = {} } = json ?? {};
    this.requests.push({ method, params });
    let result;
    try {
      result = this.dispatch(method, params);
    } catch (err) {
      return this.answer(null, {
        name: 'JSONRPCError',
        code: err.code ?? 300,
        message: err.message,
      });
    }
    return this.answer(result, null);
  }

  answer(result, error) {
    return {
      status: 200,
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ id: 0, version: '1.1', result, error }),
    };
  }

  level(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session || this.now() - session.renewedAt > SESSION_TTL_MS) {
      return 0;
    }
    return LEVELS[this.users[session.user]?.level] ?? 0;
  }

  dispatch(method, params) {
    const required = METHOD_LEVELS[method];
    if (required === undefined) {
      throw Object.assign(new Error(`method not found (${method})`), { code: 401 });
    }
    if (required !== 'NONE') {
      const level = this.level(params._session_id_);
      if (LEVELS[required] > level) {
        throw Object.assign(new Error(`access denied ("${required}" needed ${level})`), {
          code: 400,
        });
      }
    }
    switch (method) {
      case 'Session.login': {
        const user = this.users[params.username];
        if (!user || user.password !== params.password) {
          throw Object.assign(new Error('invalid credentials or too many sessions'), {
            code: 501,
          });
        }
        const sessionId = `sid${String(this.nextSession++).padStart(7, '0')}`;
        this.sessions.set(sessionId, { user: params.username, renewedAt: this.now() });
        return sessionId;
      }
      case 'Session.logout':
        this.sessions.delete(params._session_id_);
        return true;
      case 'Session.renew':
        this.sessions.get(params._session_id_).renewedAt = this.now();
        return true;
      case 'Interface.listInterfaces':
        return this.interfaces;
      case 'Device.listAllDetail':
        return this.devices;
      case 'SysVar.getAll':
        return this.sysvars;
      case 'Program.getAll':
        return this.programs;
      case 'Program.execute': {
        const program = this.programs.find((entry) => entry.id === params.id);
        this.executed.push(params.id);
        return Boolean(program);
      }
      case 'CCU.getVersion':
        return FIRMWARE;
      case 'Interface.setValue':
        return this.setValue(params);
      case 'ReGa.runScript':
        return this.runScript(params.script);
      default:
        throw Object.assign(new Error('not implemented'), { code: 300 });
    }
  }

  // --- Interface.setValue -----------------------------------------------------------------

  setValue({ interface: iface, address, valueKey, type, value }) {
    for (const key of ['interface', 'address', 'valueKey', 'type', 'value']) {
      if (typeof arguments[0][key] !== 'string') {
        throw Object.assign(new Error(`missing argument (${key})`), { code: 402 });
      }
    }
    let parsed;
    if (type === 'bool') {
      parsed = value === '1' || value === 'true';
    } else if (type === 'int') {
      parsed = Number.parseInt(value, 10);
    } else if (type === 'double') {
      parsed = Number.parseFloat(value);
    } else if (type === 'string') {
      parsed = value;
    } else {
      throw Object.assign(new Error(`internal error: unknown type ${type}`), { code: 200 });
    }
    this.writes.push({ iface, address, valueKey, type, value: parsed });
    const [deviceAddress, channelText] = address.split(':');
    const device = this.devices.find((entry) => entry.address === deviceAddress);
    const channel = Number(channelText);
    const channelType = device?.channels.find((entry) => entry.index === channel)?.channelType;
    if (!device || !channelType || device.interface !== iface) {
      throw Object.assign(new Error('internal error: unknown address'), { code: 200 });
    }
    const dp = (index, key) => `${iface}.${deviceAddress}:${index}.${key}`;
    // What the devices do with a command.
    switch (valueKey) {
      case 'AUTO_MODE':
        this.set(dp(channel, 'CONTROL_MODE'), 0);
        return true;
      case 'MANU_MODE':
        this.set(dp(channel, 'CONTROL_MODE'), 1);
        this.set(dp(channel, 'SET_TEMPERATURE'), parsed);
        return true;
      case 'CONTROL_MODE':
        this.set(dp(channel, 'SET_POINT_MODE'), parsed);
        return true;
      case 'STOP':
        return true;
      default:
        this.set(dp(channel, valueKey), parsed);
        if (channelType.endsWith('_VIRTUAL_RECEIVER')) {
          this.set(dp(channel - 1, valueKey), parsed);
        }
        return true;
    }
  }

  // --- ReGa scripts -----------------------------------------------------------------------

  encodeValue(value) {
    if (typeof value === 'boolean') {
      return value ? 'true' : 'false';
    }
    if (typeof value === 'number') {
      return regaNumber(value);
    }
    return `"${regaEncode(value, { latin1: this.latin1 })}"`;
  }

  runScript(script) {
    if (script.includes('!# name: fetch_all_device_data.fn')) {
      const iface = script.match(/string sUse_Interface = "([^"]*)";/)[1];
      const addresses = new Set(
        this.devices.filter((device) => device.interface === iface).map((device) => device.address),
      );
      const lines = [];
      for (const [name, { value }] of this.datapoints) {
        const [prefix, rest] = [
          name.slice(0, name.indexOf('.')),
          name.slice(name.indexOf('.') + 1),
        ];
        if (prefix !== iface || !addresses.has(rest.split(':')[0])) {
          continue;
        }
        lines.push(`"${regaEncode(name, { latin1: this.latin1 })}":${this.encodeValue(value)}`);
      }
      return `{${lines.join(',\n')}}`;
    }
    if (script.includes('!# name: gladys_read_datapoints')) {
      const names = script
        .match(/string sNames = "([^"]*)";/)[1]
        .split('\t')
        .filter(Boolean);
      const vars = script
        .match(/string sVars = "([^"]*)";/)[1]
        .split('\t')
        .filter(Boolean);
      const dps = names
        .filter((name) => this.datapoints.has(name))
        .map((name) => {
          const { value, ts } = this.datapoints.get(name);
          return `"${name}":[${this.encodeValue(value)},${ts}]`;
        });
      const svs = vars
        .map((id) => this.sysvars.find((sysvar) => sysvar.id === id))
        .filter(Boolean)
        .map((sysvar) => `"${sysvar.id}":[${this.encodeValue(typedSysVar(sysvar))},1760000000]`);
      return `{"dp":{${dps.join(',')}},"sv":{${svs.join(',')}}}`;
    }
    return '';
  }
}

/**
 * A fake network of CCUs, by base URL. An unknown address or a CCU switched
 * off fails like the network does.
 * @param {Record<string, FakeCcu>} ccus
 */
export function createNetwork(ccus) {
  return {
    ccus,
    async request(url, options = {}) {
      const target = new URL(url);
      const ccu = ccus[target.origin];
      if (!ccu || !ccu.online) {
        const error = new Error(
          ccu ? `Timed out after ${options.timeoutMs} ms` : 'connect ECONNREFUSED',
        );
        error.code = ccu ? 'ETIMEDOUT' : 'ECONNREFUSED';
        throw error;
      }
      return ccu.handle(url, options);
    },
  };
}
