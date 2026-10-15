// -----------------------------------------------------------------------------
// The real HTTP path (src/ccu/http.js) against the fake CCU served on a local
// port, Latin-1 answers of the old firmwares included; and the read-only probe
// script of the maintainers, run end to end against it.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import http from 'node:http';
import { promisify } from 'node:util';
import { CcuClient, ERROR_KINDS } from '../src/ccu/client.js';
import { FakeCcu } from './helpers/fakeCcu.js';

async function serve(t, ccu, { latin1 = false } = {}) {
  const server = http.createServer((request, response) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      const json = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const answer = ccu.handle(`http://ccu${request.url}`, { json });
      response.writeHead(answer.status, answer.headers);
      response.end(Buffer.from(answer.body, latin1 ? 'latin1' : 'utf8'));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}

test('the client talks to a CCU over HTTP, UTF-8 or Latin-1', async (t) => {
  for (const latin1 of [false, true]) {
    const ccu = new FakeCcu({ latin1 });
    ccu.devices[0].name = 'Küche Süd';
    const url = await serve(t, ccu, { latin1 });
    const client = new CcuClient({ url, username: 'Admin', password: 'secret' });
    const devices = await client.listDevices();
    assert.equal(devices[0].name, 'Küche Süd', latin1 ? 'latin1' : 'utf8');
    const values = await client.fetchAll('HmIP-RF');
    assert.ok(values.size > 100);
    await client.logout();
    assert.equal(ccu.sessions.size, 0);
  }
});

test('a closed port is "unreachable"', async () => {
  const client = new CcuClient({ url: 'http://127.0.0.1:9', username: 'Admin', password: '' });
  await assert.rejects(client.listInterfaces(), (err) => err.kind === ERROR_KINDS.UNREACHABLE);
});

test('the probe script runs read-only against a CCU', async (t) => {
  const ccu = new FakeCcu();
  const url = await serve(t, ccu);
  const { stdout } = await promisify(execFile)(
    process.execPath,
    ['scripts/probe.mjs', url, 'Admin'],
    { env: { ...process.env, CCU_PASSWORD: 'secret' }, cwd: new URL('..', import.meta.url) },
  );
  assert.match(stdout, /All checks passed/);
  assert.match(stdout, /refused as expected \(auth\)/);
  assert.match(stdout, /reading script: \d+\/\d+ datapoints/);
  assert.ok(!stdout.includes('secret'), 'never the password');
  assert.ok(!stdout.includes(ccu.devices[0].name), 'never a device name');
  assert.equal(ccu.writes.length, 0, 'nothing written');
  assert.equal(ccu.executed.length, 0, 'no program run');
  assert.equal(ccu.sessions.size, 0, 'sessions closed');
});
