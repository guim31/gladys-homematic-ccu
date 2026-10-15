// -----------------------------------------------------------------------------
// The devices published to Gladys: one per Homematic device the CCU knows
// (its features from src/homematic/profiles.js), and the "Homematic CCU"
// device that carries the service and alarm message counters and the system
// variables of the CCU.
//
// External ids: `gladys.externalIds('hm', <device address>)` — the serial of
// the device, unique and permanent — and `gladys.externalIds('ccu', 'ccu')`
// for the CCU itself (one CCU per integration). Feature keys come from the
// profiles (`<channel>-<what>`) and from the ReGa id of each system variable.
// -----------------------------------------------------------------------------

import { NAMES } from './texts.js';

export const DEVICE_TYPE = 'hm';
export const HUB_TYPE = 'ccu';
export const HUB_PLATFORM_ID = 'ccu';
export const HUB_NAME = 'Homematic CCU';
export const MODEL_PARAM = 'HOMEMATIC_MODEL';
export const ADDRESS_PARAM = 'HOMEMATIC_ADDRESS';

// ReGa ids of the two counters every CCU keeps (aiohomematic ignores them as
// system variables for the same reason: they are the CCU's own).
export const ALARM_MESSAGES_ID = '40';
export const SERVICE_MESSAGES_ID = '41';

// Gladys refuses an empty text state.
export const EMPTY_TEXT = '-';
const MAX_TEXT = 255;

export const deviceIds = (gladys, address) => gladys.externalIds(DEVICE_TYPE, address);
export const hubIds = (gladys) => gladys.externalIds(HUB_TYPE, HUB_PLATFORM_ID);

const names = (language) => NAMES[language] ?? NAMES.en;

/**
 * Feature names, numbered when a device has several of a kind ("Switch 1",
 * "Switch 2"), in the order of their channels.
 */
function featureNames(features, language) {
  const counts = new Map();
  for (const spec of features) {
    counts.set(spec.name, (counts.get(spec.name) ?? 0) + 1);
  }
  const seen = new Map();
  return features.map((spec) => {
    const base = names(language)[spec.name] ?? spec.name;
    if (counts.get(spec.name) === 1) {
      return base;
    }
    const rank = (seen.get(spec.name) ?? 0) + 1;
    seen.set(spec.name, rank);
    return `${base} ${rank}`;
  });
}

const featureDefinition = (spec) => ({
  category: spec.category,
  type: spec.type,
  ...(spec.unit ? { unit: spec.unit } : {}),
  read_only: !spec.write,
  has_feedback: Boolean(spec.write) && spec.reads.length > 0,
  keep_history: true,
  min: spec.min,
  max: spec.max,
});

/**
 * The discovery payload of one Homematic device.
 * @param {object} gladys SDK client
 * @param {object} device normalizeCcuDevice() result
 * @param {object} profile profileOf() result
 * @param {string} language feature names language
 */
export function buildDevice(gladys, device, profile, language) {
  const ids = deviceIds(gladys, device.address);
  const labels = featureNames(profile.features, language);
  return {
    name: device.name,
    external_id: ids.device,
    model: device.model,
    // Gladys does not poll: the integration reads the CCU on its own timer.
    should_poll: false,
    params: [
      { name: MODEL_PARAM, value: device.model },
      { name: ADDRESS_PARAM, value: device.address },
    ],
    features: profile.features.map((spec, index) => ({
      ...featureDefinition(spec),
      name: labels[index],
      external_id: ids.feature(spec.key),
    })),
  };
}

// --- The CCU device ------------------------------------------------------------------

/**
 * A system variable of `SysVar.getAll`, normalized; null when not shown.
 * LOGIC and ALARM variables are binary features, the others texts (Gladys has
 * no generic number type: a NUMBER shows with its unit).
 */
export function normalizeSysVar(raw) {
  if (!raw || typeof raw !== 'object' || !/^\d+$/.test(String(raw.id))) {
    return null;
  }
  const type = String(raw.type ?? '').toUpperCase();
  return {
    id: String(raw.id),
    name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : `#${raw.id}`,
    type,
    unit: typeof raw.unit === 'string' ? raw.unit.trim() : '',
    values: type === 'LIST' && typeof raw.valueList === 'string' ? raw.valueList.split(';') : [],
    visible: raw.isVisible !== false && raw.isVisible !== 'false',
    internal: raw.isInternal === true || raw.isInternal === 'true',
  };
}

const BINARY_SYSVARS = new Set(['LOGIC', 'ALARM']);

/** The value Gladys gets for a system variable: 0/1, or `{ text }`. */
export function sysVarState(sysvar, value) {
  if (value === undefined || value === null) {
    return null;
  }
  if (BINARY_SYSVARS.has(sysvar.type)) {
    if (typeof value === 'boolean') {
      return value ? 1 : 0;
    }
    if (typeof value === 'number') {
      return value ? 1 : 0;
    }
    return value === 'true' ? 1 : value === 'false' || value === '' ? 0 : null;
  }
  let text;
  if (sysvar.type === 'LIST') {
    const index = Number(value);
    text = Number.isInteger(index) ? (sysvar.values[index] ?? String(value)) : String(value);
  } else if (sysvar.type === 'NUMBER' && typeof value === 'number') {
    const rounded = Math.round(value * 1000) / 1000;
    text = sysvar.unit ? `${rounded} ${sysvar.unit}` : String(rounded);
  } else {
    text = String(value);
  }
  text = text.trim().slice(0, MAX_TEXT);
  return { text: text || EMPTY_TEXT };
}

/**
 * The discovery payload of the CCU device.
 * @param {object} gladys SDK client
 * @param {object[]} sysvars normalizeSysVar() results to show
 * @param {string} language
 */
export function buildHubDevice(gladys, sysvars, language) {
  const ids = hubIds(gladys);
  const label = names(language);
  const counter = (key, name) => ({
    category: 'counter-sensor',
    type: 'integer',
    read_only: true,
    has_feedback: false,
    keep_history: true,
    min: 0,
    max: 65000,
    name,
    external_id: ids.feature(key),
  });
  return {
    name: HUB_NAME,
    external_id: ids.device,
    model: 'CCU',
    should_poll: false,
    features: [
      counter('service-messages', label.service_messages),
      counter('alarm-messages', label.alarm_messages),
      ...sysvars.map((sysvar) => ({
        ...(BINARY_SYSVARS.has(sysvar.type)
          ? { category: 'input', type: 'binary', min: 0, max: 1 }
          : { category: 'text', type: 'text', min: 0, max: 0 }),
        read_only: true,
        has_feedback: false,
        keep_history: true,
        name: sysvar.name,
        external_id: ids.feature(`sysvar-${sysvar.id}`),
      })),
    ],
  };
}

/** The system variables shown on the CCU device, by configuration mode. */
export function shownSysVars(sysvars, mode) {
  if (mode === 'none') {
    return [];
  }
  const seen = new Set();
  return sysvars.filter((sysvar) => {
    // Feature names are unique on a device.
    if (!sysvar.visible || sysvar.internal || seen.has(sysvar.name)) {
      return false;
    }
    seen.add(sysvar.name);
    return [...BINARY_SYSVARS, 'LIST', 'NUMBER', 'STRING'].includes(sysvar.type);
  });
}
