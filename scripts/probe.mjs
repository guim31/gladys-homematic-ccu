#!/usr/bin/env node
// -----------------------------------------------------------------------------
// Read-only probe of a real CCU (CCU3, RaspberryMatic, piVCCU), for the
// maintainers: it runs the real client of the integration against the CCU
// and says what works, without changing anything on it.
//
//   node scripts/probe.mjs <address> [user]
//   CCU_PASSWORD=... node scripts/probe.mjs https://192.0.2.10 Admin
//
// What it does, in order:
//   1. logs in with a deliberately wrong password: the CCU must refuse it
//      (error 501), the integration then reports "password refused";
//   2. logs in with the given user (password from CCU_PASSWORD, empty when
//      unset: a CCU with the authentication off);
//   3. lists the interfaces, the devices, the system variables and the
//      programs (counts and models only);
//   4. runs the discovery script on each interface, then the reading script
//      of the integration on a sample of datapoints (values, timestamps,
//      button presses, the two message counters);
//   5. builds the Gladys devices the integration would publish;
//   6. closes its sessions.
// Nothing is written to the CCU: no setValue, no program run, no variable set.
// It never prints the password, a session id, or the names of your devices.
// -----------------------------------------------------------------------------

import { CcuClient, ERROR_KINDS } from '../src/ccu/client.js';
import { INTERFACES, parseHostUrl } from '../src/config.js';
import {
  PRESS_PARAMETERS,
  dpName,
  normalizeCcuDevice,
  profileOf,
} from '../src/homematic/profiles.js';

const [address, user = 'Admin'] = process.argv.slice(2);
const url = parseHostUrl(address);
if (!url) {
  console.error('Usage: CCU_PASSWORD=... node scripts/probe.mjs <address> [user]');
  process.exit(2);
}
const password = process.env.CCU_PASSWORD ?? '';
const insecure = process.env.CCU_STRICT_TLS !== '1';

const step = (text) => console.log(`\n== ${text}`);
const ok = (text) => console.log(`   ok    ${text}`);
const ko = (text) => console.log(`   FAIL  ${text}`);
const info = (text) => console.log(`         ${text}`);

let failures = 0;
const check = (condition, good, bad) => {
  if (condition) {
    ok(good);
  } else {
    failures += 1;
    ko(bad);
  }
};

step(`CCU at ${url} (self-signed certificate ${insecure ? 'accepted' : 'refused'})`);

step('1. A wrong password is refused');
const wrong = new CcuClient({
  url,
  username: user,
  password: 'gladys-probe-wrong-password',
  insecure,
});
try {
  await wrong.listInterfaces();
  if (password === '') {
    ok('accepted: the authentication is off on this CCU (any password works)');
  } else {
    failures += 1;
    ko('a wrong password was accepted');
  }
  await wrong.logout();
} catch (err) {
  check(
    err.kind === ERROR_KINDS.AUTH,
    `refused as expected (${err.kind})`,
    `unexpected error: ${err.kind} ${err.message}`,
  );
}

step(`2. Login as "${user}"`);
const client = new CcuClient({ url, username: user, password, insecure });
let interfaces;
try {
  interfaces = await client.listInterfaces();
  ok(`logged in; interfaces: ${interfaces.map((entry) => entry.name).join(', ')}`);
} catch (err) {
  ko(`${err.kind}: ${err.message}`);
  process.exit(1);
}

step('3. Devices, system variables, programs');
const [rawDevices, sysvars, programs, version] = await Promise.all([
  client.listDevices(),
  client.listSysVars(),
  client.listPrograms(),
  client.getVersion(),
]);
info(`firmware: ${version ?? 'not readable (CCU.getVersion needs an administrator)'}`);
const devices = rawDevices.map(normalizeCcuDevice).filter(Boolean);
const models = new Map();
for (const device of devices) {
  models.set(
    `${device.iface} ${device.model}`,
    (models.get(`${device.iface} ${device.model}`) ?? 0) + 1,
  );
}
ok(`${devices.length} devices, ${sysvars.length} system variables, ${programs.length} programs`);
for (const [model, count] of [...models].sort()) {
  info(`${count} × ${model}`);
}

step('4. Scripts (ReGa.runScript, needs an administrator)');
const values = new Map();
for (const iface of INTERFACES.filter((name) => interfaces.some((entry) => entry.name === name))) {
  try {
    const started = Date.now();
    const found = await client.fetchAll(iface);
    for (const [name, value] of found) {
      values.set(name, value);
    }
    ok(`fetch_all_device_data ${iface}: ${found.size} values in ${Date.now() - started} ms`);
  } catch (err) {
    failures += 1;
    ko(`fetch_all_device_data ${iface}: ${err.kind} ${err.message}`);
  }
}
const published = [];
const sample = [];
for (const device of devices) {
  const profile = profileOf(device, (name) => values.has(name));
  if (!profile) {
    continue;
  }
  published.push({ device, profile });
  sample.push(...profile.features.flatMap((spec) => spec.reads));
  for (const channel of profile.buttons) {
    PRESS_PARAMETERS.forEach((parameter) => sample.push(dpName(device, channel, parameter)));
  }
}
try {
  const names = [...new Set(sample)].slice(0, 400);
  const started = Date.now();
  const read = await client.read(names, ['40', '41']);
  const presses = [...read.datapoints.keys()].filter((name) => name.includes('.PRESS_')).length;
  check(
    read.datapoints.size > 0 || names.length === 0,
    `reading script: ${read.datapoints.size}/${names.length} datapoints, ${presses} with a press timestamp, in ${Date.now() - started} ms`,
    'reading script: no datapoint read back',
  );
  const sameAsDiscovery = [...read.datapoints].filter(
    ([name, entry]) => values.has(name) && values.get(name) === entry.value,
  ).length;
  info(`${sameAsDiscovery} values identical to the discovery script`);
  check(
    read.sysvars.has('40') && read.sysvars.has('41'),
    `message counters: service ${read.sysvars.get('41')?.value}, alarm ${read.sysvars.get('40')?.value}`,
    'message counters (ids 40/41) not read',
  );
} catch (err) {
  failures += 1;
  ko(`reading script: ${err.kind ?? ''} ${err.message}`);
}

step('5. What Gladys would get');
const features = published.reduce((sum, entry) => sum + entry.profile.features.length, 0);
ok(`${published.length} devices, ${features} features`);
const kinds = new Map();
for (const { profile } of published) {
  for (const spec of profile.features) {
    kinds.set(spec.kind, (kinds.get(spec.kind) ?? 0) + 1);
  }
}
info([...kinds].map(([kind, count]) => `${kind} ${count}`).join(', '));
const skipped = devices.filter((device) => !published.some((entry) => entry.device === device));
info(`not published: ${[...new Set(skipped.map((device) => device.model))].join(', ') || 'none'}`);

step('6. Logout');
await client.logout();
ok('session closed');

console.log(failures ? `\n${failures} check(s) failed.` : '\nAll checks passed.');
process.exit(failures ? 1 : 0);
