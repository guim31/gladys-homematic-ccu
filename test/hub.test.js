// -----------------------------------------------------------------------------
// The hub against the fake CCU: discovery, readings, commands, button
// presses, transports, the CCU device and its system variables, programs,
// sessions and failures.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ERROR_TEXT } from '../src/texts.js';
import {
  CCU_HOST,
  FakeCcu,
  create,
  createClock,
  createWorld,
  discovered,
  hubIdsOf,
  idsOf,
} from './helpers/world.js';

async function world(t, options = {}) {
  const w = await createWorld(options);
  t.after(() => w.app.stop());
  return w;
}

const featureOf = (w, model, key) => {
  const device = discovered(w, model);
  return {
    device,
    feature: device.features.find((f) => f.external_id === idsOf(w, model).feature(key)),
  };
};

test('the devices are discovered at start, sorted, with the CCU device first', async (t) => {
  const w = await world(t);
  const devices = w.fake.discoveredDevices;
  assert.equal(devices[0].external_id, hubIdsOf(w).device);
  assert.equal(devices[0].name, 'Homematic CCU');
  const names = devices.slice(1).map((device) => device.name);
  assert.deepEqual(
    names,
    [...names].sort((a, b) => a.localeCompare(b)),
  );
  for (const device of devices) {
    assert.equal(device.should_poll, false);
  }
  assert.deepEqual(w.fake.connectionStatus.connected, true);
  // One script per interface at discovery.
  assert.equal(
    w.ccu.calls('ReGa.runScript').filter((r) => r.params.script.includes('fetch_all')).length,
    4,
  );
});

test('only the enabled interfaces are discovered', async (t) => {
  const w = await world(t, {
    config: { host: CCU_HOST, password: 'secret', interfaces: ['BidCos-RF'], language: 'en' },
  });
  const models = w.fake.discoveredDevices.slice(1).map((device) => device.model);
  assert.ok(models.length > 5);
  assert.ok(
    models.every((model) => /^HM-/.test(model)),
    models.join(),
  );
});

test('only the devices added to Gladys are read, in one script', async (t) => {
  const w = await world(t);
  const before = w.ccu.calls('ReGa.runScript').length;
  await w.hub.cycle();
  const [read] = w.ccu.calls('ReGa.runScript').slice(before);
  assert.match(read.params.script, /gladys_read_datapoints/);
  // Nothing added yet: only the two counters of the CCU.
  assert.match(read.params.script, /string sNames = "";/);
  assert.match(read.params.script, /string sVars = "41\t40";/);
  assert.equal(w.fake.states.length, 0);

  await create(w, ['HmIP-eTRV-2']);
  const states = w.fake.states.map((s) => s.device_feature_external_id);
  assert.ok(states.includes(idsOf(w, 'HmIP-eTRV-2').feature('1-temperature')));
  assert.ok(states.every((id) => id.startsWith(idsOf(w, 'HmIP-eTRV-2').device)));
  const count = w.ccu.calls('ReGa.runScript').length;
  await w.hub.cycle();
  assert.equal(w.ccu.calls('ReGa.runScript').length, count + 1, 'one request per reading');
});

test('only the changes are published, and a value that moves is published again', async (t) => {
  const w = await world(t);
  await create(w, ['HmIP-eTRV-2']);
  const temperature = idsOf(w, 'HmIP-eTRV-2').feature('1-temperature');
  const published = () => w.fake.states.length;
  const before = published();
  await w.hub.cycle();
  await w.hub.cycle();
  assert.equal(published(), before, 'nothing changed, nothing sent');
  w.ccu.set(w.ccu.dp('HmIP-eTRV-2', 1, 'ACTUAL_TEMPERATURE'), 22.4);
  await w.hub.cycle();
  assert.equal(published(), before + 1);
  assert.equal(w.fake.lastState(temperature), 22.4);
});

test('an unchanged value is sent again after the heartbeat delay', async (t) => {
  const clock = createClock();
  const w = await world(t, { clock, timings: { heartbeatMs: 60_000 } });
  await create(w, ['HmIP-SWDO-I']);
  const before = w.fake.states.length;
  clock.advance(30_000);
  await w.hub.cycle();
  assert.equal(w.fake.states.length, before);
  // The SDK dates the values with the real clock: wait past the heartbeat.
  const realNow = Date.now;
  Date.now = () => realNow() + 61_000;
  t.after(() => {
    Date.now = realNow;
  });
  await w.hub.cycle();
  assert.ok(w.fake.states.length > before, 'heartbeat sent');
});

test('switching a Homematic IP plug writes STATE on its first receiver', async (t) => {
  const w = await world(t);
  await create(w, ['HMIP-PSM']);
  const { device, feature } = featureOf(w, 'HMIP-PSM', '3-switch');
  const ack = await w.fake.setValue(device, feature, 0);
  assert.equal(ack.success, true, ack.error);
  const [write] = w.ccu.writes;
  assert.deepEqual(write, {
    iface: 'HmIP-RF',
    address: `${w.ccu.device('HMIP-PSM').address}:3`,
    valueKey: 'STATE',
    type: 'bool',
    value: false,
  });
  // The plug reports its new state on the transmitter: read back.
  await w.hub.cycle();
  assert.equal(w.fake.lastState(feature.external_id), 0);
});

test('thermostat commands: setpoint and modes, Homematic IP and BidCoS', async (t) => {
  const w = await world(t);
  await create(w, ['HmIP-eTRV-2', 'HM-CC-RT-DN']);
  const ip = (key) => featureOf(w, 'HmIP-eTRV-2', key);
  const rf = (key) => featureOf(w, 'HM-CC-RT-DN', key);

  let { device, feature } = ip('1-target');
  assert.equal((await w.fake.setValue(device, feature, 22.2)).success, true);
  ({ device, feature } = ip('1-mode'));
  assert.equal((await w.fake.setValue(device, feature, 0)).success, true);
  ({ device, feature } = rf('4-mode'));
  assert.equal((await w.fake.setValue(device, feature, 3)).success, true);
  assert.deepEqual(
    w.ccu.writes.map((write) => [write.valueKey, write.type, write.value]),
    [
      ['SET_POINT_TEMPERATURE', 'double', 22],
      ['CONTROL_MODE', 'int', 1],
      ['SET_POINT_TEMPERATURE', 'double', 4.5],
      ['AUTO_MODE', 'bool', true],
    ],
  );
  await w.hub.cycle();
  assert.equal(w.fake.lastState(ip('1-mode').feature.external_id), 0, 'off');
  assert.equal(w.fake.lastState(rf('4-mode').feature.external_id), 3, 'auto');

  ({ device, feature } = ip('1-mode'));
  const cooling = await w.fake.setValue(device, feature, 2);
  assert.equal(cooling.success, false);
});

test('a shutter opens, closes and stops; a dimmer sets its level', async (t) => {
  const w = await world(t);
  await create(w, ['HmIP-BROLL', 'HM-LC-Dim1T-Pl-3']);
  const shutter = featureOf(w, 'HmIP-BROLL', '4-shutter');
  for (const value of [1, -1, 0]) {
    assert.equal((await w.fake.setValue(shutter.device, shutter.feature, value)).success, true);
  }
  const position = featureOf(w, 'HmIP-BROLL', '4-position');
  await w.fake.setValue(position.device, position.feature, 30);
  const dimmer = featureOf(w, 'HM-LC-Dim1T-Pl-3', '1-brightness');
  await w.fake.setValue(dimmer.device, dimmer.feature, 75);
  assert.deepEqual(
    w.ccu.writes.map((write) => [write.address.split(':')[1], write.valueKey, write.value]),
    [
      ['4', 'LEVEL', 1],
      ['4', 'LEVEL', 0],
      ['4', 'STOP', true],
      ['4', 'LEVEL', 0.3],
      ['1', 'LEVEL', 0.75],
    ],
  );
  await w.hub.cycle();
  assert.equal(w.fake.lastState(position.feature.external_id), 30);
  assert.equal(w.fake.lastState(dimmer.feature.external_id), 75);
});

test('a read-only feature or an unknown device refuses the command', async (t) => {
  const w = await world(t);
  await create(w, ['HmIP-eTRV-2']);
  const { device, feature } = featureOf(w, 'HmIP-eTRV-2', '1-temperature');
  const ack = await w.fake.setValue(device, feature, 20);
  assert.equal(ack.success, false);
  assert.match(ack.error, /cannot be controlled/);
  const unknown = await w.fake.setValue(
    { ...device, external_id: w.gladys.externalIds('hm', 'NOPE').device },
    feature,
    1,
  );
  assert.equal(unknown.success, false);
  assert.equal(w.ccu.writes.length, 0);
});

test('a button press fires the scene trigger once; old presses never do', async (t) => {
  const clock = createClock();
  const ccu = new FakeCcu({ now: clock.now });
  // Pressed before the integration started.
  ccu.press('HmIP-WRC6', 1);
  const w = await world(t, { clock, ccu });
  await create(w, ['HmIP-WRC6', 'HM-PB-2-WM55']);
  await w.hub.cycle();
  assert.deepEqual(w.fake.sceneEvents, []);

  clock.advance(2_000);
  ccu.press('HmIP-WRC6', 3);
  ccu.press('HM-PB-2-WM55', 2, 'PRESS_LONG');
  await w.hub.cycle();
  await w.hub.cycle();
  const events = w.fake.sceneEvents
    .map((event) => [event.key, event.data])
    .sort((a, b) => a[1].button - b[1].button);
  assert.deepEqual(events, [
    [
      'button_pressed',
      {
        device: idsOf(w, 'HM-PB-2-WM55').device,
        device_name: ccu.device('HM-PB-2-WM55').name,
        button: 2,
        press: 'long',
      },
    ],
    [
      'button_pressed',
      {
        device: idsOf(w, 'HmIP-WRC6').device,
        device_name: ccu.device('HmIP-WRC6').name,
        button: 3,
        press: 'short',
      },
    ],
  ]);
});

test('a device out of reach shows the unreachable badge, then local again', async (t) => {
  const w = await world(t);
  await create(w, ['HmIP-SMI']);
  const id = idsOf(w, 'HmIP-SMI').device;
  const last = () =>
    w.fake.transports.filter((entry) => entry.device_external_id === id).at(-1)?.transport;
  assert.equal(last(), 'local');
  w.ccu.set(w.ccu.dp('HmIP-SMI', 0, 'UNREACH'), true);
  await w.hub.cycle();
  assert.equal(last(), 'unreachable');
  const count = w.fake.transports.length;
  await w.hub.cycle();
  assert.equal(w.fake.transports.length, count, 'sent once');
  w.ccu.set(w.ccu.dp('HmIP-SMI', 0, 'UNREACH'), false);
  await w.hub.cycle();
  assert.equal(last(), 'local');
});

test('the CCU device: message counters and system variables', async (t) => {
  const w = await world(t);
  await create(w, [], { hub: true });
  const ids = hubIdsOf(w);
  assert.equal(w.fake.lastState(ids.feature('service-messages')), 0);
  const presence = w.ccu.sysvars.find((sysvar) => sysvar.name === 'Anwesenheit');
  assert.equal(w.fake.lastState(ids.feature(`sysvar-${presence.id}`)), 1);
  const list = w.ccu.sysvars.find((sysvar) => sysvar.name === 'Belueftungsanlage_Stufe');
  const text = w.fake.states.findLast(
    (s) => s.device_feature_external_id === ids.feature(`sysvar-${list.id}`),
  );
  assert.equal(text.text, 'Normal');
  // Internal variables are not shown.
  const names =
    discovered(w, 'HmIP-SMI') && w.fake.discoveredDevices[0].features.map((f) => f.name);
  assert.ok(!names.includes('CCU_REBOOT'));
  assert.ok(!names.includes('Servicemeldungen'));

  w.ccu.sysvars.find((sysvar) => sysvar.id === '41').value = '3';
  presence.value = 'false';
  await w.hub.cycle();
  assert.equal(w.fake.lastState(ids.feature('service-messages')), 3);
  assert.equal(w.fake.lastState(ids.feature(`sysvar-${presence.id}`)), 0);
});

test('a CCU program runs by name, case and spaces ignored', async (t) => {
  const w = await world(t);
  const program = w.ccu.programs.find((entry) => entry.isActive);
  const ack = await w.fake.sceneAction('run_program', {
    program: `  ${program.name.toUpperCase()} `,
  });
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(ack.data.outputs, { program: program.name });
  assert.deepEqual(w.ccu.executed, [program.id]);

  const missing = await w.fake.sceneAction('run_program', { program: 'No such program' });
  assert.equal(missing.success, false);
  assert.match(missing.error, /No program named "No such program"/);

  const inactive = w.ccu.programs.find((entry) => !entry.isActive);
  if (inactive) {
    const refused = await w.fake.sceneAction('run_program', { program: inactive.name });
    assert.match(refused.error, /disabled/);
  }
  assert.deepEqual(w.ccu.executed, [program.id]);
});

test('an expired session is opened again, once', async (t) => {
  const w = await world(t);
  await create(w, ['HmIP-SMI']);
  const logins = () => w.ccu.calls('Session.login').length;
  const before = logins();
  w.ccu.expireSessions();
  await w.hub.cycle();
  assert.equal(logins(), before + 1);
  assert.equal(w.fake.connectionStatus.connected, true);
});

test('the session is renewed before it expires, and closed at the end', async () => {
  const clock = createClock();
  const w = await createWorld({ clock });
  clock.advance(6 * 60_000);
  await w.hub.cycle();
  assert.equal(w.ccu.calls('Session.renew').length, 1);
  // Readings every 4 minutes for 40 minutes: the session never expires.
  for (let i = 0; i < 10; i += 1) {
    clock.advance(4 * 60_000);
    await w.hub.cycle();
  }
  assert.equal(w.ccu.calls('Session.login').length, 1, 'renewed, never expired');
  await w.app.stop();
  assert.equal(w.ccu.calls('Session.logout').length, 1);
  assert.equal(w.ccu.sessions.size, 0);
});

test('a wrong password is reported, and not tried again at every reading', async (t) => {
  const clock = createClock();
  const w = await world(t, {
    clock,
    config: { host: CCU_HOST, username: 'Admin', password: 'wrong', language: 'en' },
  });
  assert.equal(w.fake.connectionStatus.connected, false);
  assert.deepEqual(w.fake.connectionStatus.message, ERROR_TEXT.auth);
  await w.hub.cycle();
  await w.hub.cycle();
  assert.equal(w.ccu.calls('Session.login').length, 1);
  clock.advance(6 * 60_000);
  await w.hub.cycle();
  assert.equal(w.ccu.calls('Session.login').length, 2);
});

test('a user without administrator rights is told so', async (t) => {
  const ccu = new FakeCcu({ users: { viewer: { password: 'pw', level: 'USER' } } });
  const w = await world(t, {
    ccu,
    config: { host: CCU_HOST, username: 'viewer', password: 'pw', language: 'en' },
  });
  assert.equal(w.fake.connectionStatus.connected, false);
  assert.deepEqual(w.fake.connectionStatus.message, ERROR_TEXT.not_admin);
});

test('a CCU that stops answering is reported, and its return too', async (t) => {
  const w = await world(t);
  await create(w, ['HmIP-SMI']);
  w.ccu.online = false;
  await w.hub.cycle();
  assert.deepEqual(w.fake.connectionStatus.message, ERROR_TEXT.unreachable);
  w.ccu.online = true;
  await w.hub.cycle();
  assert.equal(w.fake.connectionStatus.connected, true);
});

test('a CCU down at start is discovered once it answers', async (t) => {
  const ccu = new FakeCcu();
  ccu.online = false;
  const w = await world(t, { ccu });
  assert.equal(w.fake.connectionStatus.connected, false);
  ccu.online = true;
  await w.hub.cycle();
  assert.ok(w.fake.discoveredDevices.length > 40);
  assert.equal(w.fake.connectionStatus.connected, true);
});

test('"Search" in the Discovery tab discovers again; a failure is shown there', async (t) => {
  const w = await world(t);
  const smi = idsOf(w, 'HmIP-SMI').device;
  w.ccu.devices = w.ccu.devices.filter((device) => device.type !== 'HmIP-SMI');
  await w.fake.scanRequest();
  assert.ok(!w.fake.discoveredDevices.some((device) => device.external_id === smi));
  w.ccu.online = false;
  await assert.rejects(w.fake.scanRequest(), /does not answer/);
});

test('without an address the status asks for it, and nothing is read', async (t) => {
  const w = await world(t, { config: { language: 'en' } });
  assert.equal(w.fake.connectionStatus.connected, false);
  assert.match(w.fake.connectionStatus.message.en, /Enter the address/);
  assert.deepEqual(w.fake.discoveredDevices, []);
  assert.equal(w.ccu.requests.length, 0);
  const bad = await world(t, { config: { host: 'http://user:pw@192.0.2.10', language: 'en' } });
  assert.match(bad.fake.connectionStatus.message.en, /not understood/);
});

test('a new configuration is applied: a new session, the new interfaces', async (t) => {
  const w = await world(t);
  const count = w.fake.discoveredDevices.length;
  await w.fake.configUpdated({
    host: CCU_HOST,
    password: 'secret',
    interfaces: ['HmIP-RF'],
    language: 'en',
  });
  assert.ok(w.fake.discoveredDevices.length < count);
  assert.equal(w.ccu.calls('Session.login').length, 1, 'same connection, same session');
  await w.fake.configUpdated({ host: CCU_HOST, password: 'wrong', language: 'en' });
  assert.equal(w.fake.connectionStatus.connected, false);
});

test('"Test the connection" reports the firmware and the counts', async (t) => {
  const w = await world(t);
  const ack = await w.fake.action('test_connection', {});
  assert.equal(ack.success, true);
  assert.match(ack.data.en ?? ack.data.message?.en, /CCU reached \(firmware 3\.83\.6/);
  assert.match(ack.data.fr ?? ack.data.message?.fr, /appareil\(s\) pour Gladys/);
  w.ccu.online = false;
  const down = await w.fake.action('test_connection', {});
  assert.match(JSON.stringify(down.data), /does not answer/);
});

test('the first press ever of a key fires too (no value on the CCU before it)', async (t) => {
  const w = await world(t);
  await create(w, ['HmIP-WRC6']);
  const name = w.ccu.dp('HmIP-WRC6', 6, 'PRESS_LONG');
  assert.equal(w.ccu.datapoints.has(name), false, 'never pressed in the fixture');
  await w.hub.cycle();
  w.ccu.press('HmIP-WRC6', 6, 'PRESS_LONG');
  await w.hub.cycle();
  assert.deepEqual(
    w.fake.sceneEvents.map((event) => [event.data.button, event.data.press]),
    [[6, 'long']],
  );
});

test('when Gladys restarts, every state is sent again', async (t) => {
  const w = await world(t);
  await create(w, ['HmIP-SMI']);
  const motion = idsOf(w, 'HmIP-SMI').feature('1-motion');
  const sent = () => w.fake.states.filter((s) => s.device_feature_external_id === motion).length;
  assert.equal(sent(), 1);
  await w.gladys.disconnect();
  await w.gladys.connect();
  assert.equal(sent(), 2);
  assert.equal(w.fake.connectionStatus.connected, true);
});
