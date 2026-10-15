// -----------------------------------------------------------------------------
// Integration configuration: defaults (they mirror the `default` values of the
// manifest `config_schema`, see test/manifest.test.js) and normalization, so
// the rest of the code never deals with strings, blanks or `undefined`.
// -----------------------------------------------------------------------------

export const LANGUAGES = ['en', 'fr', 'de', 'es'];

// The CCU interfaces the integration can read. VirtualDevices holds the
// heating groups of Homematic IP; CUxD and the other add-ons are not read.
export const INTERFACES = ['HmIP-RF', 'BidCos-RF', 'BidCos-Wired', 'VirtualDevices'];

// Reading intervals offered in the configuration, in seconds. One reading is
// one script run on the CCU, whatever the number of devices.
export const POLL_INTERVALS = ['10', '15', '30', '60', '120', '300'];

// Which system variables of the CCU become features of the "CCU" device.
export const SYSVAR_MODES = ['visible', 'none'];

export const DEFAULT_CONFIG = {
  host: '',
  username: 'Admin',
  password: '',
  allow_self_signed: true,
  interfaces: [...INTERFACES],
  sysvars: 'visible',
  poll_interval: '30',
  language: 'fr',
};

/**
 * Parse the address typed by the user into a base URL: a bare host or IP
 * (`192.0.2.10`, `ccu3-webui`), or the URL copied from the browser
 * (`https://192.0.2.10/pages/index.htm`). HTTP by default, the path dropped.
 * @param {unknown} raw
 * @returns {string|null} `http(s)://host[:port]`, null when unusable
 */
export function parseHostUrl(raw) {
  if (typeof raw !== 'string') {
    return null;
  }
  const text = raw.trim();
  if (!text) {
    return null;
  }
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `http://${text}`;
  let url;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) {
    return null;
  }
  // Credentials in the address would end up in the logs.
  if (url.username || url.password) {
    return null;
  }
  return url.origin;
}

/**
 * @param {Record<string, unknown>} raw the configuration returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const text = (key) => (typeof source[key] === 'string' ? source[key].trim() : '');
  const pick = (key, list) => {
    const value = source[key] === undefined || source[key] === null ? '' : String(source[key]);
    return list.includes(value) ? value : DEFAULT_CONFIG[key];
  };
  const typedHost = text('host');
  const interfaces = Array.isArray(source.interfaces)
    ? INTERFACES.filter((name) => source.interfaces.includes(name))
    : [...DEFAULT_CONFIG.interfaces];
  const selfSigned = source.allow_self_signed;

  return {
    url: parseHostUrl(typedHost),
    hostTyped: typedHost !== '',
    username: text('username') || DEFAULT_CONFIG.username,
    // Kept as typed: spaces may be part of a password.
    password: typeof source.password === 'string' ? source.password : '',
    allowSelfSigned: selfSigned === undefined ? true : selfSigned === true || selfSigned === 'true',
    interfaces,
    sysvars: pick('sysvars', SYSVAR_MODES),
    pollIntervalMs: Number(pick('poll_interval', POLL_INTERVALS)) * 1000,
    language: LANGUAGES.includes(source.language) ? source.language : DEFAULT_CONFIG.language,
  };
}
