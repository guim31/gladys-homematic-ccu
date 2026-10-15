// -----------------------------------------------------------------------------
// A complete test world: the SDK's fake Gladys, a fake CCU on a fake network
// and a manual clock, with the integration wired on top through
// registerHandlers. No timer runs unless `timers: true` (with node:test mock
// timers): the tests read the CCU with `world.hub.cycle()`.
// -----------------------------------------------------------------------------

import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../../src/app.js';
import { DEVICE_TYPE, hubIds } from '../../src/devices.js';
import { FakeCcu, createNetwork } from './fakeCcu.js';

// The integration logs its lifecycle; keep the test output readable.
process.env.LOG_LEVEL ??= 'silent';

export const CCU_HOST = '192.0.2.10';
export const CCU_URL = `http://${CCU_HOST}`;
export const PASSWORD = 'secret';

export const DEFAULT_TEST_CONFIG = {
  host: CCU_HOST,
  username: 'Admin',
  password: PASSWORD,
  language: 'en',
};

/** A manual clock, shared by the hub and the fake CCU. */
export function createClock(start = Date.UTC(2026, 9, 15, 10, 0, 0)) {
  const clock = {
    time: start,
    now: () => clock.time,
    advance(ms) {
      clock.time += ms;
    },
  };
  return clock;
}

/**
 * @param {object} [options]
 * @param {FakeCcu} [options.ccu]
 * @param {object} [options.config] raw integration config
 * @param {Array} [options.devices] devices already created in Gladys
 * @param {boolean} [options.connect]
 */
export async function createWorld({
  clock = createClock(),
  ccu,
  config = DEFAULT_TEST_CONFIG,
  devices = [],
  connect = true,
  timings = {},
  timers = false,
} = {}) {
  const fakeCcu = ccu ?? new FakeCcu({ now: clock.now });
  const network = createNetwork({ [CCU_URL]: fakeCcu });
  const gladys = createFakeGladys({ config, devices });
  const app = registerHandlers(gladys, {
    request: network.request,
    timers,
    timings,
    now: clock.now,
  });
  if (connect) {
    await gladys.connect();
    await app.ready;
  }
  return { gladys, fake: gladys.fake, network, ccu: fakeCcu, app, hub: app.hub, clock };
}

/** External ids of a Homematic device of the fixtures, by model. */
export const idsOf = (world, model) =>
  world.gladys.externalIds(DEVICE_TYPE, world.ccu.device(model).address);
export const hubIdsOf = (world) => hubIds(world.gladys);

/** The discovered device of a model. */
export const discovered = (world, model) =>
  world.fake.discoveredDevices.find((device) => device.external_id === idsOf(world, model).device);

/** Add discovered devices in Gladys, as the user would (all by default). */
export async function createAll(world, filter = () => true) {
  for (const device of world.fake.discoveredDevices.filter(filter)) {
    await world.fake.deviceCreated(device);
  }
}

/** Add the devices of these models (and the CCU device when `hub`). */
export async function create(world, models, { hub = false } = {}) {
  const wanted = new Set(models.map((model) => idsOf(world, model).device));
  if (hub) {
    wanted.add(hubIds(world.gladys).device);
  }
  await createAll(world, (device) => wanted.has(device.external_id));
}

export { FakeCcu };
