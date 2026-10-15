// -----------------------------------------------------------------------------
// The reading timer of the container. Gladys never polls a device published
// with should_poll: false (and Gladys 5.2 never polls the devices created
// without should_poll, GladysAssistant/Gladys#3198): the CCU must be read by
// the hub's own timer, with no onPoll at all.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CCU_HOST, create, createClock, createWorld, idsOf } from './helpers/world.js';

/** Let the timer callback and the fake network settle. */
const settle = async () => {
  for (let i = 0; i < 30; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
};

const config = { host: CCU_HOST, username: 'Admin', password: 'secret', poll_interval: '60' };

test('the internal timer reads the CCU without any onPoll from Gladys', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const clock = createClock();
  const w = await createWorld({ clock, config, timers: true });
  t.after(() => w.app.stop());
  const polled = t.mock.method(w.hub, 'pollDevice');
  await create(w, ['HmIP-eTRV-2']);

  const device = w.fake.discoveredDevices.find(
    (d) => d.external_id === idsOf(w, 'HmIP-eTRV-2').device,
  );
  assert.equal(device.should_poll, false, 'Gladys is not asked to poll');
  const reads = () =>
    w.ccu.calls('ReGa.runScript').filter((r) => r.params.script.includes('gladys_read')).length;
  const before = reads();
  const temperature = idsOf(w, 'HmIP-eTRV-2').feature('1-temperature');

  for (const value of [18.5, 19, 19.5]) {
    w.ccu.set(w.ccu.dp('HmIP-eTRV-2', 1, 'ACTUAL_TEMPERATURE'), value);
    clock.advance(60_000);
    t.mock.timers.tick(60_000);
    await settle();
    assert.equal(w.fake.lastState(temperature), value);
  }
  assert.equal(reads() - before, 3, 'one reading per interval');
  assert.equal(polled.mock.callCount(), 0, 'no onPoll involved');
});

test('a command is read back soon, before the next interval', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const clock = createClock();
  const w = await createWorld({ clock, config, timers: true, timings: { afterCommandMs: 3_000 } });
  t.after(() => w.app.stop());
  await create(w, ['HMIP-PSM']);
  const device = w.fake.discoveredDevices.find((d) => d.model === 'HMIP-PSM');
  const feature = device.features.find((f) => f.external_id.endsWith(':3-switch'));
  await w.fake.setValue(device, feature, 0);
  t.mock.timers.tick(3_000);
  await settle();
  assert.equal(w.fake.lastState(feature.external_id), 0);
});

test('onPoll reads now, unless a reading is recent', async (t) => {
  const clock = createClock();
  const w = await createWorld({ clock, config });
  t.after(() => w.app.stop());
  await create(w, ['HmIP-SMI']);
  const device = w.fake.discoveredDevices.find((d) => d.model === 'HmIP-SMI');
  const count = () => w.ccu.calls('ReGa.runScript').length;
  const before = count();
  await w.fake.poll(device);
  assert.equal(count(), before, 'just read');
  clock.advance(40_000);
  await w.fake.poll(device);
  assert.equal(count(), before + 1);
});

test('the timer stops with the integration', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const w = await createWorld({ config, timers: true });
  await w.app.stop();
  const before = w.ccu.requests.length;
  t.mock.timers.tick(10 * 60_000);
  await settle();
  assert.equal(w.ccu.requests.length, before);
});
