// -----------------------------------------------------------------------------
// What each Homematic device becomes in Gladys, from the fixtures: the channel
// of each output, the values of each feature, the safety rules.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  IP_COVER_CHANNELS,
  IP_DIMMER_CHANNELS,
  IP_SWITCH_CHANNELS,
} from '../src/homematic/models.js';
import {
  COVER_STATE,
  OPENING,
  OPERATING_STATE,
  THERMOSTAT_MODE,
  normalizeCcuDevice,
  outputsOf,
  profileOf,
} from '../src/homematic/profiles.js';

const devices = JSON.parse(
  readFileSync(new URL('./fixtures/ccu/devices.json', import.meta.url), 'utf8'),
);
const values = JSON.parse(
  readFileSync(new URL('./fixtures/ccu/values.json', import.meta.url), 'utf8'),
);
const known = (name) => name in values;

const device = (model) => normalizeCcuDevice(devices.find((entry) => entry.type === model));
const profile = (model, override = {}) => {
  const p = profileOf(device(model), known);
  const get = (name) => (name in override ? override[name] : values[name]);
  return { ...p, byKey: Object.fromEntries(p.features.map((spec) => [spec.key, spec])), get };
};
const dp = (model, channel, parameter) => {
  const d = device(model);
  return `${d.iface}.${d.address}:${channel}.${parameter}`;
};

test('the generic output rule gives the channels of the aiohomematic tables', () => {
  // On every Homematic IP model of the fixtures listed in a table.
  let checked = 0;
  for (const raw of devices) {
    const d = normalizeCcuDevice(raw);
    for (const [table, kinds] of [
      [IP_SWITCH_CHANNELS, ['switch']],
      [IP_DIMMER_CHANNELS, ['dimmer']],
      [IP_COVER_CHANNELS, ['cover']],
    ]) {
      const listed = table.get(d.model.toUpperCase());
      if (!listed) {
        continue;
      }
      checked += 1;
      const generic = [];
      for (const [index, type] of d.channels) {
        const receiver = type.replace('_TRANSMITTER', '_VIRTUAL_RECEIVER');
        if (type.endsWith('_TRANSMITTER') && d.channels.get(index + 1) === receiver) {
          generic.push(index + 1);
        }
      }
      const found = outputsOf(d)
        .filter((output) => kinds.includes(output.kind))
        .map((output) => output.command);
      assert.deepEqual(found, listed, `${d.model}: table`);
      assert.ok(
        listed.every((channel) => generic.includes(channel)),
        `${d.model}: generic rule ${generic}`,
      );
    }
  }
  assert.ok(checked >= 6, `only ${checked} models checked`);
});

test('a Homematic IP plug: state read on the transmitter, commands to the first receiver', () => {
  const p = profile('HMIP-PSM');
  const sw = p.byKey['3-switch'];
  assert.deepEqual(sw.reads, [dp('HMIP-PSM', 2, 'STATE')]);
  assert.equal(sw.value(p.get), 1);
  assert.deepEqual(sw.write(0), [
    { address: `${device('HMIP-PSM').address}:3`, parameter: 'STATE', type: 'bool', value: false },
  ]);
  assert.equal(p.byKey['6-power'].category, 'switch');
  assert.equal(p.byKey['6-energy'].unit, 'kilowatt-hour');
  // 21352.9 Wh → kWh, 180 mA → A.
  assert.equal(
    p.byKey['6-energy'].value(p.get),
    Math.round(values[dp('HMIP-PSM', 6, 'ENERGY_COUNTER')]) / 1000,
  );
  assert.equal(p.byKey['6-current'].value(p.get), values[dp('HMIP-PSM', 6, 'CURRENT')] / 1000);
  assert.equal(Object.keys(p.byKey).filter((key) => key.endsWith('switch')).length, 1);
});

test('a four-channel actuator gives four switches, a dimmer a light', () => {
  const drsi4 = profile('HmIP-DRSI4');
  assert.deepEqual(
    drsi4.features.filter((spec) => spec.kind === 'switch').map((spec) => spec.key),
    ['6-switch', '10-switch', '14-switch', '18-switch'],
  );
  const bdt = profile('HmIP-BDT');
  assert.equal(bdt.byKey['4-brightness'].reads[0], dp('HmIP-BDT', 3, 'LEVEL'));
  assert.deepEqual(bdt.byKey['4-brightness'].write(42), [
    { address: `${device('HmIP-BDT').address}:4`, parameter: 'LEVEL', type: 'double', value: 0.42 },
  ]);
  assert.equal(bdt.byKey['4-light'].write(1)[0].value, 1);
  // An HmIP-BSM has one switch: its key channels are buttons.
  const bsm = profile('HmIP-BSM');
  assert.deepEqual(
    Object.keys(bsm.byKey).filter((key) => key.endsWith('switch')),
    ['4-switch'],
  );
  assert.deepEqual(bsm.buttons, [1, 2]);
});

test('Homematic IP thermostat: temperature, setpoint, mode, heating, window', () => {
  const p = profile('HmIP-eTRV-2');
  const address = `${device('HmIP-eTRV-2').address}:1`;
  assert.equal(p.byKey['1-temperature'].value(p.get), 21.6);
  assert.equal(p.byKey['1-target'].value(p.get), 19);
  assert.equal(p.byKey['1-mode'].value(p.get), THERMOSTAT_MODE.AUTO);
  assert.equal(p.byKey['1-heating'].value(p.get), OPERATING_STATE.IDLE);
  assert.equal(p.byKey['1-window'].value(p.get), OPENING.CLOSED);
  // Manual mode, a setpoint of 4.5 °C is "off".
  const manual = profile('HmIP-eTRV-2', {
    [dp('HmIP-eTRV-2', 1, 'SET_POINT_MODE')]: 1,
    [dp('HmIP-eTRV-2', 1, 'LEVEL')]: 0.35,
    [dp('HmIP-eTRV-2', 1, 'WINDOW_STATE')]: 1,
  });
  assert.equal(manual.byKey['1-mode'].value(manual.get), THERMOSTAT_MODE.HEATING);
  assert.equal(manual.byKey['1-heating'].value(manual.get), OPERATING_STATE.HEATING);
  assert.equal(manual.byKey['1-window'].value(manual.get), OPENING.OPEN);
  const off = profile('HmIP-eTRV-2', { [dp('HmIP-eTRV-2', 1, 'SET_POINT_TEMPERATURE')]: 4.5 });
  assert.equal(off.byKey['1-mode'].value(off.get), THERMOSTAT_MODE.OFF);

  const mode = p.byKey['1-mode'];
  assert.deepEqual(mode.write(THERMOSTAT_MODE.AUTO, p.get), [
    { address, parameter: 'CONTROL_MODE', type: 'int', value: 0 },
  ]);
  assert.deepEqual(mode.write(THERMOSTAT_MODE.OFF, p.get), [
    { address, parameter: 'CONTROL_MODE', type: 'int', value: 1 },
    { address, parameter: 'SET_POINT_TEMPERATURE', type: 'double', value: 4.5 },
  ]);
  assert.deepEqual(mode.write(THERMOSTAT_MODE.HEATING, p.get), [
    { address, parameter: 'CONTROL_MODE', type: 'int', value: 1 },
  ]);
  assert.deepEqual(mode.write(THERMOSTAT_MODE.HEATING, off.get), [
    { address, parameter: 'CONTROL_MODE', type: 'int', value: 1 },
    { address, parameter: 'SET_POINT_TEMPERATURE', type: 'double', value: 20 },
  ]);
  assert.throws(() => mode.write(THERMOSTAT_MODE.COOLING, p.get), /Unsupported/);
  // Half degrees, within 4.5..30.5.
  assert.equal(p.byKey['1-target'].write(21.3)[0].value, 21.5);
  assert.equal(p.byKey['1-target'].write(45)[0].value, 30.5);
});

test('Homematic (BidCoS) thermostat: modes through AUTO_MODE and MANU_MODE', () => {
  const p = profile('HM-CC-RT-DN');
  const address = `${device('HM-CC-RT-DN').address}:4`;
  const mode = p.byKey['4-mode'];
  assert.equal(mode.value(p.get), THERMOSTAT_MODE.AUTO);
  assert.deepEqual(mode.write(THERMOSTAT_MODE.AUTO, p.get), [
    { address, parameter: 'AUTO_MODE', type: 'bool', value: true },
  ]);
  assert.deepEqual(mode.write(THERMOSTAT_MODE.HEATING, p.get), [
    { address, parameter: 'MANU_MODE', type: 'double', value: 21 },
  ]);
  assert.deepEqual(mode.write(THERMOSTAT_MODE.OFF, p.get), [
    { address, parameter: 'MANU_MODE', type: 'double', value: 4.5 },
  ]);
  assert.deepEqual(p.byKey['4-target'].write(19)[0], {
    address,
    parameter: 'SET_TEMPERATURE',
    type: 'double',
    value: 19,
  });
  assert.equal(p.byKey['4-heating'].value(p.get), OPERATING_STATE.HEATING);
});

test('a combined room thermostat reports its temperature once', () => {
  const p = profile('HM-TC-IT-WM-W-EU');
  assert.deepEqual(
    p.features.filter((spec) => spec.kind === 'temperature').map((spec) => spec.key),
    ['2-temperature'],
  );
});

test('opening sensors: Gladys 0 = open, 1 = closed; a tilted handle is open', () => {
  const swdo = profile('HmIP-SWDO-I');
  assert.equal(swdo.byKey['1-contact'].value(swdo.get), OPENING.CLOSED);
  const open = profile('HmIP-SWDO-I', { [dp('HmIP-SWDO-I', 1, 'STATE')]: 1 });
  assert.equal(open.byKey['1-contact'].value(open.get), OPENING.OPEN);
  const rf = profile('HM-Sec-SC-2', { [dp('HM-Sec-SC-2', 1, 'STATE')]: true });
  assert.equal(rf.byKey['1-contact'].value(rf.get), OPENING.OPEN);
  for (const [state, expected] of [
    [0, OPENING.CLOSED],
    [1, OPENING.OPEN],
    [2, OPENING.OPEN],
  ]) {
    const srh = profile('HmIP-SRH', { [dp('HmIP-SRH', 1, 'STATE')]: state });
    assert.equal(srh.byKey['1-handle'].value(srh.get), expected, `handle state ${state}`);
  }
});

test('smoke: only the detector that sees smoke reports it', () => {
  const status = dp('HmIP-SWSD', 1, 'SMOKE_DETECTOR_ALARM_STATUS');
  for (const [value, expected] of [
    [0, 0],
    [1, 1],
    [2, 0],
    [3, 0],
  ]) {
    const p = profile('HmIP-SWSD', { [status]: value });
    assert.equal(p.byKey['1-smoke'].value(p.get), expected, `alarm status ${value}`);
  }
  const water = profile('HM-Sec-WDS-2', { [dp('HM-Sec-WDS-2', 1, 'STATE')]: 2 });
  assert.equal(water.byKey['1-leak'].value(water.get), 1);
});

test('covers: position in percent, open / close / stop', () => {
  const p = profile('HmIP-BROLL');
  const address = `${device('HmIP-BROLL').address}:4`;
  assert.equal(p.byKey['4-position'].reads[0], dp('HmIP-BROLL', 3, 'LEVEL'));
  assert.equal(p.byKey['4-position'].value(p.get), 50);
  const shutter = p.byKey['4-shutter'];
  assert.deepEqual(shutter.write(COVER_STATE.OPEN), [
    { address, parameter: 'LEVEL', type: 'double', value: 1 },
  ]);
  assert.deepEqual(shutter.write(COVER_STATE.CLOSE), [
    { address, parameter: 'LEVEL', type: 'double', value: 0 },
  ]);
  assert.deepEqual(shutter.write(COVER_STATE.STOP), [
    { address, parameter: 'STOP', type: 'bool', value: true },
  ]);
  const moving = profile('HmIP-BROLL', { [dp('HmIP-BROLL', 3, 'ACTIVITY_STATE')]: 2 });
  assert.equal(moving.byKey['4-shutter'].value(moving.get), COVER_STATE.CLOSE);
  // HmIP "unknown level" (1.005) is not a position.
  const unknown = profile('HmIP-BROLL', { [dp('HmIP-BROLL', 3, 'LEVEL')]: 1.005 });
  assert.equal(unknown.byKey['4-position'].value(unknown.get), null);
  const rf = profile('HM-LC-Bl1-FM');
  assert.equal(rf.byKey['1-position'].reads[0], dp('HM-LC-Bl1-FM', 1, 'LEVEL'));
});

test('locks, doors, garage doors and sirens are never controllable', () => {
  for (const model of ['HmIP-DLD', 'HM-Sec-Key', 'HmIP-MOD-HO', 'HmIP-ASIR-2']) {
    const p = profileOf(device(model), known);
    for (const spec of p?.features ?? []) {
      assert.equal(spec.write, undefined, `${model}: ${spec.key} is controllable`);
    }
  }
});

test('a thermostat relay follows the regulation: no switch on a wall thermostat', () => {
  const p = profile('HmIP-BWTH');
  assert.equal(p.features.filter((spec) => spec.kind === 'switch').length, 0);
});

test('the parts of the CCU itself are not devices', () => {
  for (const model of ['RPI-RF-MOD', 'HmIP-RCV-50', 'HmIP-HAP']) {
    assert.equal(profileOf(device(model), known), null, model);
  }
});

test('a sensor value the CCU never received is not a feature', () => {
  const p = profileOf(device('HmIP-SWO-PR'), (name) => known(name) && !name.endsWith('.RAINING'));
  assert.ok(!p.features.some((spec) => spec.kind === 'rain'));
  assert.ok(p.features.some((spec) => spec.kind === 'wind'));
});

test('a device the CCU has not finished configuring is skipped', () => {
  const raw = structuredClone(devices.find((entry) => entry.type === 'HmIP-SMI'));
  raw.isReady = 'false';
  assert.equal(profileOf(normalizeCcuDevice(raw), known), null);
  assert.equal(normalizeCcuDevice({ name: 'no address' }), null);
});
