// -----------------------------------------------------------------------------
// What the integration writes at the default level (info): the lifecycle
// only. A normal reading writes nothing, a failure that repeats is logged
// once, and its end once. Never a password or a session id.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CCU_HOST, PASSWORD, createClock, createWorld, create } from './helpers/world.js';

/** Capture the lines of the SDK logger at LOG_LEVEL=info. */
function captureLogs(t, level = 'info') {
  const previous = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = level;
  t.after(() => {
    process.env.LOG_LEVEL = previous;
  });
  const lines = [];
  const record =
    (stream) =>
    (...args) =>
      lines.push({
        stream,
        text: args.map((arg) => (arg instanceof Error ? arg.stack : String(arg))).join(' '),
      });
  t.mock.method(console, 'log', record('out'));
  t.mock.method(console, 'error', record('err'));
  return {
    lines,
    clear: () => lines.splice(0),
    texts: () => lines.map((line) => line.text),
  };
}

async function world(t, options = {}) {
  const clock = createClock();
  const w = await createWorld({ clock, ...options });
  t.after(() => w.app.stop());
  return w;
}

test('a normal reading cycle writes nothing at info', async (t) => {
  const logs = captureLogs(t);
  const w = await world(t);
  assert.ok(
    logs.texts().some((text) => text.includes('Connected to the CCU')),
    'the start is logged',
  );
  await create(w, ['HmIP-eTRV-2', 'HmIP-WRC6', 'HMIP-PSM'], { hub: true });
  logs.clear();

  for (let i = 0; i < 5; i += 1) {
    w.clock.advance(6 * 60_000); // the session is renewed too
    w.ccu.set(w.ccu.dp('HmIP-eTRV-2', 1, 'ACTUAL_TEMPERATURE'), 20 + i);
    w.ccu.press('HmIP-WRC6', 1);
    await w.hub.cycle();
  }
  assert.ok(w.fake.sceneEvents.length >= 4);
  assert.deepEqual(logs.texts(), []);
});

test('a CCU that stays down is logged once, and once when it is back', async (t) => {
  const logs = captureLogs(t);
  const w = await world(t);
  logs.clear();

  w.ccu.online = false;
  for (let i = 0; i < 6; i += 1) {
    w.clock.advance(30_000);
    await w.hub.cycle();
  }
  const down = logs.lines.filter((line) => line.stream === 'err');
  assert.equal(down.length, 1, logs.texts().join('\n'));
  assert.equal(logs.lines.length, 1);

  logs.clear();
  w.ccu.online = true;
  await w.hub.cycle();
  await w.hub.cycle();
  assert.equal(logs.lines.length, 1, logs.texts().join('\n'));
  assert.match(logs.lines[0].text, /CCU answers again/);
});

test('a refused password is logged once; never the password', async (t) => {
  const logs = captureLogs(t);
  const w = await world(t, {
    config: { host: CCU_HOST, username: 'Admin', password: 'wrong-password', language: 'en' },
  });
  for (let i = 0; i < 5; i += 1) {
    w.clock.advance(6 * 60_000); // past the login back-off
    await w.hub.cycle();
  }
  const warnings = logs.lines.filter((line) => line.stream === 'err');
  assert.equal(warnings.length, 1, logs.texts().join('\n'));
  assert.ok(!logs.texts().join('\n').includes('wrong-password'), 'never the password');
});

test('a user command is one line at info', async (t) => {
  const logs = captureLogs(t);
  const w = await world(t);
  await create(w, ['HMIP-PSM']);
  logs.clear();
  const device = w.fake.discoveredDevices.find((d) => d.model === 'HMIP-PSM');
  await w.fake.setValue(device, device.features[0], 1);
  assert.equal(logs.lines.length, 1, logs.texts().join('\n'));
  logs.clear();
  await w.fake.sceneAction('run_program', { program: w.ccu.programs[0].name });
  assert.equal(logs.lines.length, 1, logs.texts().join('\n'));
});

test('Gladys refusing the states is logged once', async (t) => {
  const logs = captureLogs(t);
  const w = await world(t);
  await create(w, ['HmIP-eTRV-2']);
  logs.clear();
  w.gladys.publishChangedStates = async () => {
    throw new Error('HTTP 500');
  };
  for (let i = 0; i < 4; i += 1) {
    w.ccu.set(w.ccu.dp('HmIP-eTRV-2', 1, 'ACTUAL_TEMPERATURE'), 18 + i);
    await w.hub.cycle();
  }
  assert.equal(logs.lines.length, 1, logs.texts().join('\n'));
  assert.match(logs.lines[0].text, /States refused/);
});

test('LOG_LEVEL=debug shows each reading problem; never the password or the session id', async (t) => {
  const logs = captureLogs(t, 'debug');
  const w = await world(t);
  w.ccu.online = false;
  await w.hub.cycle();
  await w.hub.cycle();
  w.ccu.online = true;
  w.ccu.expireSessions();
  await w.hub.cycle();
  const text = logs.texts().join('\n');
  assert.match(text, /\[DEBUG\].*again/);
  assert.ok(!text.includes(PASSWORD), 'never the password');
  for (let i = 1; i < w.ccu.nextSession; i += 1) {
    assert.ok(!text.includes(`sid${String(i).padStart(7, '0')}`), 'never a session id');
  }
});
