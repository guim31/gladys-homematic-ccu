// -----------------------------------------------------------------------------
// What a Homematic device becomes in Gladys: its features, how each one reads
// its value from the CCU datapoints, and which datapoints a command writes.
//
// The mapping goes by CHANNEL TYPE (`HEATING_CLIMATECONTROL_TRANSCEIVER`,
// `SHUTTER_CONTACT`, `SWITCH_VIRTUAL_RECEIVER`...), which the CCU gives for
// every channel and which is shared by every model of a family, Homematic
// (BidCoS) and Homematic IP alike; the model tables of aiohomematic
// (src/homematic/models.js) only pick the output channels of the HmIP
// actuators. A datapoint is named `<interface>.<address>:<channel>.<PARAMETER>`
// (e.g. `HmIP-RF.0001D3C99C3C93:1.ACTUAL_TEMPERATURE`), the name the CCU logic
// layer gives it.
//
// Feature keys (`<channel>-<what>`) are permanent: they make the external
// ids of the features, and Gladys keys the history and the scenes on them.
// -----------------------------------------------------------------------------

import { isCcuModel, isSecurityModel, tableChannels } from './models.js';

// Values Gladys gives to some features (server/utils/constants.js).
export const THERMOSTAT_MODE = Object.freeze({ OFF: 0, HEATING: 1, COOLING: 2, AUTO: 3 });
export const OPERATING_STATE = Object.freeze({ IDLE: 0, HEATING: 1 });
export const COVER_STATE = Object.freeze({ STOP: 0, OPEN: 1, CLOSE: -1 });
// Gladys: 0 = open, 1 = closed (OPENING_SENSOR_STATE), the reverse of intuition.
export const OPENING = Object.freeze({ OPEN: 0, CLOSED: 1 });

// Homematic thermostats: 4.5 °C is "off", 30.5 °C "fully open".
export const OFF_TEMPERATURE = 4.5;
export const MAX_TEMPERATURE = 30.5;
// The setpoint sent when a thermostat set to "off" is switched back to heating.
export const HEAT_TEMPERATURE = 20;

// HmIP SMOKE_DETECTOR_ALARM_STATUS: 1 = this detector sees smoke.
const PRIMARY_ALARM = 1;

const round = (value, digits = 2) => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};
const num = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const bool = (value) =>
  typeof value === 'boolean' ? value : num(value) === null ? null : value !== 0;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

// The Gladys side of each kind of feature. Bounds are display bounds: Gladys
// never enforces them on a state, but a gauge places its needle with them.
const KINDS = {
  temperature: {
    category: 'temperature-sensor',
    type: 'decimal',
    unit: 'celsius',
    min: -40,
    max: 80,
  },
  target: {
    category: 'thermostat',
    type: 'target-temperature',
    unit: 'celsius',
    min: OFF_TEMPERATURE,
    max: MAX_TEMPERATURE,
  },
  mode: { category: 'thermostat', type: 'mode', min: 0, max: 3 },
  heating: { category: 'thermostat', type: 'operating-state', min: 0, max: 2 },
  humidity: { category: 'humidity-sensor', type: 'decimal', unit: 'percent', min: 0, max: 100 },
  opening: { category: 'opening-sensor', type: 'binary', min: 0, max: 1 },
  motion: { category: 'motion-sensor', type: 'binary', min: 0, max: 1 },
  presence: { category: 'presence-sensor', type: 'binary', min: 0, max: 1 },
  illuminance: { category: 'light-sensor', type: 'decimal', unit: 'lux', min: 0, max: 200000 },
  smoke: { category: 'smoke-sensor', type: 'binary', min: 0, max: 1 },
  leak: { category: 'leak-sensor', type: 'binary', min: 0, max: 1 },
  rain: { category: 'rain-sensor', type: 'binary', min: 0, max: 1 },
  wind: { category: 'speed-sensor', type: 'decimal', unit: 'kilometer-per-hour', min: 0, max: 200 },
  pressure: { category: 'pressure-sensor', type: 'decimal', unit: 'hPa', min: 500, max: 1100 },
  battery_low: { category: 'battery-low', type: 'binary', min: 0, max: 1 },
  switch: { category: 'switch', type: 'binary', min: 0, max: 1 },
  power: { category: 'switch', type: 'power', unit: 'watt', min: 0, max: 167772 },
  energy: { category: 'switch', type: 'energy', unit: 'kilowatt-hour', min: 0, max: 1000000 },
  voltage: { category: 'switch', type: 'voltage', unit: 'volt', min: 0, max: 400 },
  current: { category: 'switch', type: 'current', unit: 'ampere', min: 0, max: 66 },
  // A meter read by an HmIP-ESI counts the feed-in as a negative power.
  meter_power: {
    category: 'energy-sensor',
    type: 'power',
    unit: 'watt',
    min: -167772,
    max: 167772,
  },
  meter_energy: {
    category: 'energy-sensor',
    type: 'index',
    unit: 'kilowatt-hour',
    min: 0,
    max: 1000000,
  },
  meter_voltage: { category: 'energy-sensor', type: 'voltage', unit: 'volt', min: 0, max: 400 },
  meter_current: { category: 'energy-sensor', type: 'current', unit: 'ampere', min: 0, max: 66 },
  light: { category: 'light', type: 'binary', min: 0, max: 1 },
  brightness: { category: 'light', type: 'brightness', min: 0, max: 100 },
  position: { category: 'shutter', type: 'position', unit: 'percent', min: 0, max: 100 },
  shutter: { category: 'shutter', type: 'state', min: -1, max: 1 },
};

// The name of each feature, in the four languages of the Gladys interface.
// Keyed by `name` in the feature specs below (src/texts.js gives NAMES).
export const NAME_KEYS = [
  'temperature',
  'target',
  'mode',
  'heating',
  'humidity',
  'window',
  'contact',
  'handle',
  'motion',
  'presence',
  'illuminance',
  'smoke',
  'leak',
  'rain',
  'wind',
  'pressure',
  'battery_low',
  'switch',
  'power',
  'energy',
  'voltage',
  'current',
  'light',
  'brightness',
  'position',
  'shutter',
];

// --- Datapoints -----------------------------------------------------------------

export const dpName = (device, channel, parameter) =>
  `${device.iface}.${device.address}:${channel}.${parameter}`;

/**
 * A Homematic device of `Device.listAllDetail`, normalized.
 * @returns {null|{ address, name, model, iface, channels: Map<number, string> }}
 */
export function normalizeCcuDevice(raw) {
  if (!raw || typeof raw !== 'object' || typeof raw.address !== 'string') {
    return null;
  }
  const channels = new Map();
  for (const channel of Array.isArray(raw.channels) ? raw.channels : []) {
    const index = Number(channel?.index);
    if (Number.isInteger(index) && typeof channel.channelType === 'string') {
      channels.set(index, channel.channelType);
    }
  }
  return {
    address: raw.address,
    name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : raw.address,
    model: typeof raw.type === 'string' ? raw.type : '',
    iface: typeof raw.interface === 'string' ? raw.interface : '',
    ready: raw.isReady !== false && raw.isReady !== 'false',
    channels,
  };
}

// --- Feature builders -------------------------------------------------------------
// Each builder returns feature specs:
//   { key, name, kind, reads: [datapoint], value(get) → number|null, write?(value, get) → [command] }
// where `get(datapoint)` is the last value read and a command is
// { address, parameter, type: 'bool'|'int'|'double', value }.

const feature = (key, name, kind, reads, value, write) => ({
  key,
  name,
  kind,
  reads,
  value,
  ...(write ? { write } : {}),
});

function thermostatIp(device, channel, has) {
  const dp = (parameter) => dpName(device, channel, parameter);
  const address = `${device.address}:${channel}`;
  const setpoint = dp('SET_POINT_TEMPERATURE');
  const specs = [
    feature(
      `${channel}-temperature`,
      'temperature',
      'temperature',
      [dp('ACTUAL_TEMPERATURE')],
      (get) => num(get(dp('ACTUAL_TEMPERATURE'))),
    ),
    feature(
      `${channel}-target`,
      'target',
      'target',
      [setpoint],
      (get) => num(get(setpoint)),
      (value) => [
        {
          address,
          parameter: 'SET_POINT_TEMPERATURE',
          type: 'double',
          value: clampSetpoint(value),
        },
      ],
    ),
    feature(
      `${channel}-mode`,
      'mode',
      'mode',
      [dp('SET_POINT_MODE'), setpoint],
      (get) => ipMode(get(dp('SET_POINT_MODE')), get(setpoint)),
      (value, get) => ipModeCommands(address, value, get(setpoint)),
    ),
  ];
  if (has('LEVEL')) {
    specs.push(heatingFeature(channel, dp('LEVEL'), (level) => level > 0));
  }
  if (has('HUMIDITY')) {
    specs.push(
      feature(`${channel}-humidity`, 'humidity', 'humidity', [dp('HUMIDITY')], (get) =>
        num(get(dp('HUMIDITY'))),
      ),
    );
  }
  if (has('WINDOW_STATE')) {
    specs.push(
      feature(`${channel}-window`, 'window', 'opening', [dp('WINDOW_STATE')], (get) =>
        openingOf(get(dp('WINDOW_STATE'))),
      ),
    );
  }
  return specs;
}

// HmIP SET_POINT_MODE: 0 automatic, 1 manual, 2 party/holiday. A setpoint of
// 4.5 °C is "off" whatever the mode.
function ipMode(mode, setpoint) {
  if (num(setpoint) !== null && setpoint <= OFF_TEMPERATURE) {
    return THERMOSTAT_MODE.OFF;
  }
  if (num(mode) === null) {
    return null;
  }
  return mode === 0 ? THERMOSTAT_MODE.AUTO : THERMOSTAT_MODE.HEATING;
}

// What aiohomematic sends: CONTROL_MODE 0 (auto) or 1 (manual), and the
// setpoint for "off" (4.5 °C) or for heating when it was off.
function ipModeCommands(address, value, setpoint) {
  const mode = Number(value);
  if (mode === THERMOSTAT_MODE.AUTO) {
    return [{ address, parameter: 'CONTROL_MODE', type: 'int', value: 0 }];
  }
  if (mode === THERMOSTAT_MODE.OFF) {
    return [
      { address, parameter: 'CONTROL_MODE', type: 'int', value: 1 },
      { address, parameter: 'SET_POINT_TEMPERATURE', type: 'double', value: OFF_TEMPERATURE },
    ];
  }
  if (mode === THERMOSTAT_MODE.HEATING) {
    const commands = [{ address, parameter: 'CONTROL_MODE', type: 'int', value: 1 }];
    if (num(setpoint) === null || setpoint <= OFF_TEMPERATURE) {
      commands.push({
        address,
        parameter: 'SET_POINT_TEMPERATURE',
        type: 'double',
        value: HEAT_TEMPERATURE,
      });
    }
    return commands;
  }
  throw unsupported(`thermostat mode ${value}`);
}

function thermostatRf(device, channel, has) {
  const dp = (parameter) => dpName(device, channel, parameter);
  const address = `${device.address}:${channel}`;
  const setpoint = dp('SET_TEMPERATURE');
  const specs = [
    feature(
      `${channel}-temperature`,
      'temperature',
      'temperature',
      [dp('ACTUAL_TEMPERATURE')],
      (get) => num(get(dp('ACTUAL_TEMPERATURE'))),
    ),
    feature(
      `${channel}-target`,
      'target',
      'target',
      [setpoint],
      (get) => num(get(setpoint)),
      (value) => [
        { address, parameter: 'SET_TEMPERATURE', type: 'double', value: clampSetpoint(value) },
      ],
    ),
    feature(
      `${channel}-mode`,
      'mode',
      'mode',
      [dp('CONTROL_MODE'), setpoint],
      (get) => rfMode(get(dp('CONTROL_MODE')), get(setpoint)),
      (value, get) => rfModeCommands(address, value, get(setpoint)),
    ),
  ];
  if (has('VALVE_STATE')) {
    specs.push(heatingFeature(channel, dp('VALVE_STATE'), (valve) => valve > 0));
  }
  if (has('ACTUAL_HUMIDITY')) {
    specs.push(
      feature(`${channel}-humidity`, 'humidity', 'humidity', [dp('ACTUAL_HUMIDITY')], (get) =>
        num(get(dp('ACTUAL_HUMIDITY'))),
      ),
    );
  }
  return specs;
}

// BidCoS CONTROL_MODE: 0 auto, 1 manual, 2 party, 3 boost.
function rfMode(mode, setpoint) {
  if (num(setpoint) !== null && setpoint <= OFF_TEMPERATURE) {
    return THERMOSTAT_MODE.OFF;
  }
  if (num(mode) === null) {
    return null;
  }
  return mode === 0 ? THERMOSTAT_MODE.AUTO : THERMOSTAT_MODE.HEATING;
}

// BidCoS thermostats change mode through actions: AUTO_MODE, MANU_MODE(setpoint).
function rfModeCommands(address, value, setpoint) {
  const mode = Number(value);
  if (mode === THERMOSTAT_MODE.AUTO) {
    return [{ address, parameter: 'AUTO_MODE', type: 'bool', value: true }];
  }
  if (mode === THERMOSTAT_MODE.OFF) {
    return [{ address, parameter: 'MANU_MODE', type: 'double', value: OFF_TEMPERATURE }];
  }
  if (mode === THERMOSTAT_MODE.HEATING) {
    const target =
      num(setpoint) === null || setpoint <= OFF_TEMPERATURE ? HEAT_TEMPERATURE : setpoint;
    return [{ address, parameter: 'MANU_MODE', type: 'double', value: target }];
  }
  throw unsupported(`thermostat mode ${value}`);
}

const clampSetpoint = (value) => {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw unsupported(`temperature ${value}`);
  }
  // Half degrees, the step of every Homematic thermostat.
  return clamp(Math.round(number * 2) / 2, OFF_TEMPERATURE, MAX_TEMPERATURE);
};

// The valve opening tells whether the radiator heats: Gladys has no feature
// type for a valve percentage, it has "operating state" (idle / heating).
function heatingFeature(channel, datapoint, isOpen) {
  return feature(`${channel}-heating`, 'heating', 'heating', [datapoint], (get) => {
    const value = num(get(datapoint));
    if (value === null) {
      return null;
    }
    return isOpen(value) ? OPERATING_STATE.HEATING : OPERATING_STATE.IDLE;
  });
}

// SHUTTER_CONTACT STATE: false/0 = closed, true/1 = open. WINDOW_STATE of a
// thermostat: 0 = closed, 1 = open.
function openingOf(value) {
  const open = bool(value);
  if (open === null) {
    return null;
  }
  return open ? OPENING.OPEN : OPENING.CLOSED;
}

function contact(device, channel) {
  const state = dpName(device, channel, 'STATE');
  return [
    feature(`${channel}-contact`, 'contact', 'opening', [state], (get) => openingOf(get(state))),
  ];
}

// ROTARY_HANDLE STATE: 0 closed, 1 tilted, 2 open. Tilted counts as open.
function handle(device, channel) {
  const state = dpName(device, channel, 'STATE');
  return [
    feature(`${channel}-handle`, 'handle', 'opening', [state], (get) => {
      const value = num(get(state));
      if (value === null) {
        return null;
      }
      return value === 0 ? OPENING.CLOSED : OPENING.OPEN;
    }),
  ];
}

const binary = (device, channel, parameter, key, name, kind, isOn = (value) => bool(value)) => {
  const datapoint = dpName(device, channel, parameter);
  return feature(`${channel}-${key}`, name, kind, [datapoint], (get) => {
    const value = get(datapoint);
    if (value === undefined || value === null) {
      return null;
    }
    const on = isOn(value);
    return on === null ? null : on ? 1 : 0;
  });
};

const measure = (
  device,
  channel,
  parameter,
  key,
  name,
  kind,
  convert = (value) => value,
  digits = 2,
) => {
  const datapoint = dpName(device, channel, parameter);
  return feature(`${channel}-${key}`, name, kind, [datapoint], (get) => {
    const value = num(get(datapoint));
    return value === null ? null : round(convert(value), digits);
  });
};

function motion(device, channel, has) {
  const specs = [binary(device, channel, 'MOTION', 'motion', 'motion', 'motion')];
  if (has('ILLUMINATION')) {
    specs.push(
      measure(device, channel, 'ILLUMINATION', 'illuminance', 'illuminance', 'illuminance'),
    );
  }
  return specs;
}

function presence(device, channel, has) {
  const specs = [
    binary(device, channel, 'PRESENCE_DETECTION_STATE', 'presence', 'presence', 'presence'),
  ];
  if (has('ILLUMINATION')) {
    specs.push(
      measure(device, channel, 'ILLUMINATION', 'illuminance', 'illuminance', 'illuminance'),
    );
  }
  return specs;
}

function smoke(device, channel, has) {
  if (has('SMOKE_DETECTOR_ALARM_STATUS')) {
    return [
      binary(device, channel, 'SMOKE_DETECTOR_ALARM_STATUS', 'smoke', 'smoke', 'smoke', (value) =>
        num(value) === null ? null : value === PRIMARY_ALARM,
      ),
    ];
  }
  return [binary(device, channel, 'STATE', 'smoke', 'smoke', 'smoke')];
}

function waterIp(device, channel) {
  return [binary(device, channel, 'ALARMSTATE', 'leak', 'leak', 'leak')];
}

// BidCoS water detector STATE: 0 dry, 1 wet, 2 water.
function waterRf(device, channel) {
  return [
    binary(device, channel, 'STATE', 'leak', 'leak', 'leak', (value) =>
      num(value) === null ? null : value > 0,
    ),
  ];
}

// Weather and climate sensors: whatever of these the channel has.
function climate(device, channel, has) {
  const specs = [];
  const temperature = ['ACTUAL_TEMPERATURE', 'TEMPERATURE'].find(has);
  if (temperature) {
    specs.push(measure(device, channel, temperature, 'temperature', 'temperature', 'temperature'));
  }
  const humidity = ['HUMIDITY', 'ACTUAL_HUMIDITY'].find(has);
  if (humidity) {
    specs.push(measure(device, channel, humidity, 'humidity', 'humidity', 'humidity'));
  }
  if (has('ILLUMINATION')) {
    specs.push(
      measure(device, channel, 'ILLUMINATION', 'illuminance', 'illuminance', 'illuminance'),
    );
  }
  if (has('WIND_SPEED')) {
    specs.push(measure(device, channel, 'WIND_SPEED', 'wind', 'wind', 'wind'));
  }
  if (has('AIR_PRESSURE')) {
    specs.push(measure(device, channel, 'AIR_PRESSURE', 'pressure', 'pressure', 'pressure'));
  }
  if (has('RAINING')) {
    specs.push(binary(device, channel, 'RAINING', 'rain', 'rain', 'rain'));
  }
  return specs;
}

function brightnessSensor(device, channel, has) {
  const parameter = ['CURRENT_ILLUMINATION', 'ILLUMINATION'].find(has);
  return parameter
    ? [measure(device, channel, parameter, 'illuminance', 'illuminance', 'illuminance')]
    : [];
}

// ENERGIE_METER_TRANSMITTER / POWERMETER: watts, Wh counters, mA.
function meter(device, channel, has, { onSwitch }) {
  const prefix = onSwitch ? '' : 'meter_';
  const specs = [];
  if (has('POWER')) {
    specs.push(measure(device, channel, 'POWER', 'power', 'power', `${prefix}power`));
  }
  if (has('ENERGY_COUNTER')) {
    specs.push(
      measure(
        device,
        channel,
        'ENERGY_COUNTER',
        'energy',
        'energy',
        `${prefix}energy`,
        (wh) => wh / 1000,
        3,
      ),
    );
  }
  if (has('VOLTAGE')) {
    specs.push(measure(device, channel, 'VOLTAGE', 'voltage', 'voltage', `${prefix}voltage`));
  }
  if (has('CURRENT')) {
    specs.push(
      measure(
        device,
        channel,
        'CURRENT',
        'current',
        'current',
        `${prefix}current`,
        (ma) => ma / 1000,
        3,
      ),
    );
  }
  return specs;
}

// --- Outputs: switches, dimmers, covers ----------------------------------------------

/** One output: state read on `state`, commands sent to `command` (same channel on BidCoS). */
function switchOutput(device, { state, command }) {
  const datapoint = dpName(device, state, 'STATE');
  const address = `${device.address}:${command}`;
  return [
    feature(
      `${command}-switch`,
      'switch',
      'switch',
      [datapoint],
      (get) => {
        const on = bool(get(datapoint));
        return on === null ? null : on ? 1 : 0;
      },
      (value) => [{ address, parameter: 'STATE', type: 'bool', value: Number(value) === 1 }],
    ),
  ];
}

const levelPercent = (level) => {
  const value = num(level);
  // HmIP reports 1.005 / 1.01 for "unknown / old level": out of range.
  return value === null || value < 0 || value > 1 ? null : Math.round(value * 100);
};

function dimmerOutput(device, { state, command }) {
  const level = dpName(device, state, 'LEVEL');
  const address = `${device.address}:${command}`;
  return [
    feature(
      `${command}-light`,
      'light',
      'light',
      [level],
      (get) => {
        const percent = levelPercent(get(level));
        return percent === null ? null : percent > 0 ? 1 : 0;
      },
      (value) => [
        { address, parameter: 'LEVEL', type: 'double', value: Number(value) === 1 ? 1 : 0 },
      ],
    ),
    feature(
      `${command}-brightness`,
      'brightness',
      'brightness',
      [level],
      (get) => levelPercent(get(level)),
      (value) => [{ address, parameter: 'LEVEL', type: 'double', value: toLevel(value) }],
    ),
  ];
}

function coverOutput(device, { state, command }) {
  const level = dpName(device, state, 'LEVEL');
  const activity = dpName(device, state, 'ACTIVITY_STATE');
  const direction = dpName(device, state, 'DIRECTION');
  const address = `${device.address}:${command}`;
  return [
    feature(
      `${command}-position`,
      'position',
      'position',
      [level],
      (get) => levelPercent(get(level)),
      (value) => [{ address, parameter: 'LEVEL', type: 'double', value: toLevel(value) }],
    ),
    feature(
      `${command}-shutter`,
      'shutter',
      'shutter',
      [activity, direction],
      (get) => {
        // HmIP ACTIVITY_STATE and BidCoS DIRECTION: 1 up, 2 down, else still.
        const moving = num(get(activity) ?? get(direction));
        if (moving === null) {
          return null;
        }
        return moving === 1
          ? COVER_STATE.OPEN
          : moving === 2
            ? COVER_STATE.CLOSE
            : COVER_STATE.STOP;
      },
      (value) => {
        const state = Number(value);
        if (state === COVER_STATE.OPEN) {
          return [{ address, parameter: 'LEVEL', type: 'double', value: 1 }];
        }
        if (state === COVER_STATE.CLOSE) {
          return [{ address, parameter: 'LEVEL', type: 'double', value: 0 }];
        }
        if (state === COVER_STATE.STOP) {
          return [{ address, parameter: 'STOP', type: 'bool', value: true }];
        }
        throw unsupported(`shutter state ${value}`);
      },
    ),
  ];
}

const toLevel = (percent) => {
  const number = Number(percent);
  if (!Number.isFinite(number)) {
    throw unsupported(`level ${percent}`);
  }
  return round(clamp(number, 0, 100) / 100, 3);
};

export function unsupported(what) {
  const error = new Error(`Unsupported value: ${what}`);
  error.unsupported = true;
  return error;
}

const IP_GROUPS = {
  SWITCH_TRANSMITTER: { kind: 'switch', receiver: 'SWITCH_VIRTUAL_RECEIVER', table: 'switch' },
  DIMMER_TRANSMITTER: { kind: 'dimmer', receiver: 'DIMMER_VIRTUAL_RECEIVER', table: 'dimmer' },
  SHUTTER_TRANSMITTER: { kind: 'cover', receiver: 'SHUTTER_VIRTUAL_RECEIVER', table: 'cover' },
  BLIND_TRANSMITTER: { kind: 'cover', receiver: 'BLIND_VIRTUAL_RECEIVER', table: 'cover' },
};

// BidCoS actuators: state and commands on the same channel.
const RF_OUTPUTS = { SWITCH: 'switch', DIMMER: 'dimmer', BLIND: 'cover', JALOUSIE: 'cover' };

const OUTPUT_BUILDERS = { switch: switchOutput, dimmer: dimmerOutput, cover: coverOutput };

/**
 * The outputs of a device: `{ kind, state, command }` per output.
 * HmIP: the transmitter (state) and its first virtual receiver (commands),
 * the receiver channels taken from the aiohomematic tables when the model is
 * listed there. BidCoS: one channel does both.
 */
export function outputsOf(device) {
  const outputs = [];
  for (const [index, type] of [...device.channels].sort((a, b) => a[0] - b[0])) {
    const group = IP_GROUPS[type];
    if (group) {
      const listed = tableChannels(group.table, device.model);
      const command = index + 1;
      const isReceiver = device.channels.get(command) === group.receiver;
      if (listed ? listed.includes(command) && isReceiver : isReceiver) {
        outputs.push({ kind: group.kind, state: index, command });
      }
    } else if (RF_OUTPUTS[type]) {
      outputs.push({ kind: RF_OUTPUTS[type], state: index, command: index });
    }
  }
  return outputs;
}

// Channel types read as sensors. A channel type missing here is not read.
const SENSORS = {
  HEATING_CLIMATECONTROL_TRANSCEIVER: thermostatIp,
  CLIMATECONTROL_RT_TRANSCEIVER: thermostatRf,
  THERMALCONTROL_TRANSMIT: thermostatRf,
  SHUTTER_CONTACT: contact,
  ROTARY_HANDLE_TRANSCEIVER: handle,
  ROTARY_HANDLE_SENSOR: handle,
  MOTIONDETECTOR_TRANSCEIVER: motion,
  MOTION_DETECTOR: motion,
  PRESENCEDETECTOR_TRANSCEIVER: presence,
  SMOKE_DETECTOR: smoke,
  WATER_DETECTION_TRANSMITTER: waterIp,
  WATERDETECTIONSENSOR: waterRf,
  WEATHER: climate,
  WEATHER_TRANSMIT: climate,
  CLIMATE_TRANSCEIVER: climate,
  RAIN_DETECTION_TRANSMITTER: climate,
  BRIGHTNESS_TRANSMITTER: brightnessSensor,
};

const METERS = new Set(['ENERGIE_METER_TRANSMITTER', 'POWERMETER']);
const THERMOSTATS = new Set([
  'HEATING_CLIMATECONTROL_TRANSCEIVER',
  'CLIMATECONTROL_RT_TRANSCEIVER',
  'THERMALCONTROL_TRANSMIT',
]);

// Button channels: their presses fire the "Button pressed" scene trigger.
const BUTTON_CHANNELS = new Set(['KEY_TRANSCEIVER', 'KEY', 'MULTI_MODE_INPUT_TRANSMITTER']);
export const PRESS_PARAMETERS = ['PRESS_SHORT', 'PRESS_LONG'];

/**
 * The Gladys view of one Homematic device.
 * @param {object} device normalizeCcuDevice() result
 * @param {(datapoint: string) => boolean} known whether the CCU holds a value for it
 * @returns {null|{ features: object[], buttons: number[], unreach: string|null }}
 */
export function profileOf(device, known) {
  if (!device || !device.ready || isCcuModel(device.model)) {
    return null;
  }
  const security = isSecurityModel(device.model);
  const types = new Set(device.channels.values());
  const hasThermostat = [...types].some((type) => THERMOSTATS.has(type));
  const specs = [];

  // Battery: on the maintenance channel, or on the sensor channel of old
  // BidCoS models.
  const lowBattery = [...device.channels.keys()]
    .sort((a, b) => a - b)
    .flatMap((channel) => ['LOW_BAT', 'LOWBAT'].map((parameter) => [channel, parameter]))
    .find(([channel, parameter]) => known(dpName(device, channel, parameter)));
  if (lowBattery) {
    specs.push(
      binary(device, lowBattery[0], lowBattery[1], 'battery-low', 'battery_low', 'battery_low'),
    );
  }

  for (const [channel, type] of [...device.channels].sort((a, b) => a[0] - b[0])) {
    const has = (parameter) => known(dpName(device, channel, parameter));
    const builder = SENSORS[type];
    if (!builder) {
      continue;
    }
    // A combined room thermostat (HM-TC-IT-WM-W-EU) reports its temperature
    // twice: the thermostat channel is enough.
    if (hasThermostat && !THERMOSTATS.has(type) && type.startsWith('WEATHER')) {
      continue;
    }
    specs.push(...builder(device, channel, has));
  }

  // The outputs. Not on a thermostat: its relay follows the regulation, and
  // never on a lock, a door or a siren.
  const outputs = hasThermostat || security ? [] : outputsOf(device);
  for (const output of outputs) {
    specs.push(...OUTPUT_BUILDERS[output.kind](device, output));
  }
  const onSwitch = outputs.some((output) => output.kind === 'switch');
  for (const [channel, type] of [...device.channels].sort((a, b) => a[0] - b[0])) {
    if (METERS.has(type)) {
      const has = (parameter) => known(dpName(device, channel, parameter));
      specs.push(...meter(device, channel, has, { onSwitch }));
    }
  }

  // Sensor values the CCU never received are not features (a weather
  // station without a rain sensor), except the controls.
  const features = specs.filter(
    (spec) => spec.write || spec.reads.length === 0 || spec.reads.some((name) => known(name)),
  );

  const buttons = [...device.channels]
    .filter(([, type]) => BUTTON_CHANNELS.has(type))
    .map(([channel]) => channel)
    .sort((a, b) => a - b);

  const unreach = known(dpName(device, 0, 'UNREACH')) ? dpName(device, 0, 'UNREACH') : null;

  if (features.length === 0) {
    return null;
  }
  return { features: features.map((spec) => ({ ...spec, ...KINDS[spec.kind] })), buttons, unreach };
}

export { KINDS };
