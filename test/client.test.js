// -----------------------------------------------------------------------------
// The JSON API client and the script parsing: formats written by ReGa (real
// output of `fetch_all_device_data` from the aiohomematic recording), ISO-8859-1
// of the old firmwares, errors of the network and of the API, no script
// injection through a name.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CcuClient, ERROR_KINDS } from '../src/ccu/client.js';
import { decodeText } from '../src/ccu/http.js';
import {
  escapeControlCharacters,
  fetchAllScript,
  parseFetchAll,
  parseRead,
  readScript,
  uriDecode,
} from '../src/ccu/scripts.js';
import { FakeCcu, createNetwork, regaEncode } from './helpers/fakeCcu.js';

const URL = 'http://192.0.2.10';

const client = (request, options = {}) =>
  new CcuClient({ url: URL, username: 'Admin', password: 'secret', request, ...options });

test('fetch_all output: UriEncode names and strings, plain numbers and booleans', () => {
  // As written by the CCU of the aiohomematic recording (randomized addresses).
  const output =
    '{"HmIP%2DRF%2EVCU4036764%3A0%2ELOW%5FBAT":false,\n' +
    '"HmIP%2DRF%2EVCU4036764%3A0%2EOPERATING%5FVOLTAGE":4.400000,\n' +
    '"HmIP%2DRF%2EVCU4851772%3A0%2EIP%5FADDRESS":"192%2E0%2E2%2E40",\n' +
    '"HmIP%2DRF%2EVCU4036764%3A0%2ERSSI%5FDEVICE":-71}';
  const values = parseFetchAll(output);
  assert.deepEqual(Object.fromEntries(values), {
    'HmIP-RF.VCU4036764:0.LOW_BAT': false,
    'HmIP-RF.VCU4036764:0.OPERATING_VOLTAGE': 4.4,
    'HmIP-RF.VCU4851772:0.IP_ADDRESS': '192.0.2.40',
    'HmIP-RF.VCU4036764:0.RSSI_DEVICE': -71,
  });
});

test('UriEncode strings decode in UTF-8 and in ISO-8859-1', () => {
  assert.equal(uriDecode(regaEncode('Küche Süd')), 'Küche Süd');
  assert.equal(uriDecode(regaEncode('Küche Süd', { latin1: true })), 'Küche Süd');
  assert.equal(uriDecode('plain'), 'plain');
  assert.equal(decodeText(Buffer.from('Wohnzimmer Ä', 'latin1')), 'Wohnzimmer Ä');
  assert.equal(decodeText(Buffer.from('Wohnzimmer Ä', 'utf8')), 'Wohnzimmer Ä');
});

test('the read script output: values and timestamps', () => {
  const read = parseRead(
    '{"dp":{"HmIP-RF.A:1.STATE":[true,1760000001],"HmIP-RF.A:1.LEVEL":[0.500000,1760000002],' +
      '"HmIP-RF.A:1.TEXT":["a%20b",1760000003]},"sv":{"40":[3,1760000004]}}',
  );
  assert.deepEqual(read.datapoints.get('HmIP-RF.A:1.STATE'), { value: true, ts: 1760000001 });
  assert.deepEqual(read.datapoints.get('HmIP-RF.A:1.LEVEL'), { value: 0.5, ts: 1760000002 });
  assert.equal(read.datapoints.get('HmIP-RF.A:1.TEXT').value, 'a b');
  assert.deepEqual(read.sysvars.get('40'), { value: 3, ts: 1760000004 });
  assert.deepEqual(parseRead('{"dp":{},"sv":{}}').datapoints.size, 0);
});

test('a raw control character inside a string is escaped, structure kept', () => {
  assert.equal(escapeControlCharacters('{"a":"x\ty",\n"b":1}'), '{"a":"x\\u0009y",\n"b":1}');
  assert.deepEqual(parseFetchAll('{"n%2E1":"x\ty",\n"n%2E2":2}').get('n.1'), 'x\ty');
});

test('no name ever breaks out of the script string', () => {
  assert.throws(() => readScript(['HmIP-RF.A:1.STATE"; dom.Delete'], []), /Invalid datapoint/);
  assert.throws(() => readScript([], ['40; x']), /Invalid variable/);
  assert.throws(() => fetchAllScript('HmIP-RF"'), /Invalid interface/);
  const script = readScript(['HmIP-RF.A:1.STATE', 'BidCos-RF.B:2.LEVEL'], ['40', '41']);
  assert.match(script, /string sNames = "HmIP-RF\.A:1\.STATE\tBidCos-RF\.B:2\.LEVEL";/);
  assert.match(script, /string sVars = "40\t41";/);
  assert.match(fetchAllScript('HmIP-RF'), /string sUse_Interface = "HmIP-RF";/);
});

test('every parameter is sent as a string, booleans as 1 / 0', async () => {
  const ccu = new FakeCcu();
  const c = client(createNetwork({ [URL]: ccu }).request);
  const address = `${ccu.device('HMIP-PSM').address}:3`;
  await c.setValue('HmIP-RF', address, 'STATE', 'bool', true);
  await c.setValue('HmIP-RF', address, 'ON_TIME', 'double', 2.5);
  const params = ccu.calls('Interface.setValue').map((request) => request.params);
  for (const param of params) {
    for (const value of Object.values(param)) {
      assert.equal(typeof value, 'string');
    }
  }
  assert.deepEqual(
    params.map((param) => [param.type, param.value]),
    [
      ['bool', '1'],
      ['double', '2.5'],
    ],
  );
});

test('network and HTTP errors are sorted into kinds', async () => {
  const fail = (error) => async () => {
    throw error;
  };
  const kind = async (request) => {
    try {
      await client(request).listInterfaces();
    } catch (err) {
      return err.kind;
    }
    return null;
  };
  assert.equal(
    await kind(fail(Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }))),
    ERROR_KINDS.UNREACHABLE,
  );
  assert.equal(
    await kind(
      fail(
        Object.assign(new Error('self-signed certificate'), {
          code: 'DEPTH_ZERO_SELF_SIGNED_CERT',
        }),
      ),
    ),
    ERROR_KINDS.TLS,
  );
  const ccu = new FakeCcu();
  const network = createNetwork({ [URL]: ccu });
  ccu.mode = 'redirect';
  assert.equal(await kind(network.request), ERROR_KINDS.REDIRECT);
  ccu.mode = 'html';
  assert.equal(await kind(network.request), ERROR_KINDS.NOT_CCU);
  ccu.mode = 'starting';
  assert.equal(await kind(network.request), ERROR_KINDS.STARTING);
});

test('login: 501 is a refused password; the session id goes with every call', async () => {
  const ccu = new FakeCcu();
  const network = createNetwork({ [URL]: ccu });
  const refused = new CcuClient({
    url: URL,
    username: 'Admin',
    password: 'nope',
    request: network.request,
  });
  await assert.rejects(refused.listDevices(), (err) => err.kind === ERROR_KINDS.AUTH);
  const c = client(network.request);
  await c.listDevices();
  await c.listSysVars();
  const [login, ...calls] = ccu.requests.filter(
    (r) => r.params.username !== 'Admin' || r.params.password === 'secret',
  );
  assert.equal(login.method, 'Session.login');
  for (const call of calls.filter((r) => r.method !== 'Session.login')) {
    assert.match(call.params._session_id_, /^sid/);
  }
});

test('the scripts read the fake CCU in the format of the real one', async () => {
  const ccu = new FakeCcu();
  const c = client(createNetwork({ [URL]: ccu }).request);
  const values = await c.fetchAll('HmIP-RF');
  const temperature = ccu.dp('HmIP-eTRV-2', 1, 'ACTUAL_TEMPERATURE');
  assert.equal(values.get(temperature), 21.6);
  assert.ok([...values.keys()].every((name) => name.startsWith('HmIP-RF.')));
  const read = await c.read([temperature, 'HmIP-RF.NOPE:1.STATE'], ['40', '41', '999']);
  assert.equal(read.datapoints.get(temperature).value, 21.6);
  assert.ok(read.datapoints.get(temperature).ts > 0);
  assert.equal(read.datapoints.has('HmIP-RF.NOPE:1.STATE'), false);
  assert.deepEqual([...read.sysvars.keys()], ['40', '41']);
});
