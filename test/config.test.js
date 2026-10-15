import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, INTERFACES, normalizeConfig, parseHostUrl } from '../src/config.js';

test('the CCU address: bare host or IP, URL copied from the browser, never credentials', () => {
  assert.equal(parseHostUrl('192.0.2.10'), 'http://192.0.2.10');
  assert.equal(parseHostUrl(' ccu3-webui '), 'http://ccu3-webui');
  assert.equal(parseHostUrl('https://192.0.2.10/pages/index.htm?sid=@x@'), 'https://192.0.2.10');
  assert.equal(parseHostUrl('192.0.2.10:8080'), 'http://192.0.2.10:8080');
  assert.equal(parseHostUrl('http://Admin:pw@192.0.2.10'), null);
  assert.equal(parseHostUrl('ftp://192.0.2.10'), null);
  assert.equal(parseHostUrl(''), null);
  assert.equal(parseHostUrl(undefined), null);
});

test('defaults: Admin, self-signed accepted, every interface, 30 s, French names', () => {
  const config = normalizeConfig({});
  assert.equal(config.url, null);
  assert.equal(config.hostTyped, false);
  assert.equal(config.username, 'Admin');
  assert.equal(config.password, '');
  assert.equal(config.allowSelfSigned, true);
  assert.deepEqual(config.interfaces, INTERFACES);
  assert.equal(config.sysvars, 'visible');
  assert.equal(config.pollIntervalMs, 30_000);
  assert.equal(config.language, 'fr');
  assert.deepEqual(normalizeConfig(DEFAULT_CONFIG), config);
});

test('values are normalized; unknown ones fall back to the defaults', () => {
  const config = normalizeConfig({
    host: 'https://192.0.2.10',
    username: '  ',
    password: ' with spaces ',
    allow_self_signed: false,
    interfaces: ['BidCos-RF', 'CUxD', 'HmIP-RF'],
    sysvars: 'all',
    poll_interval: 7,
    language: 'it',
  });
  assert.equal(config.url, 'https://192.0.2.10');
  assert.equal(config.username, 'Admin');
  assert.equal(config.password, ' with spaces ');
  assert.equal(config.allowSelfSigned, false);
  assert.deepEqual(config.interfaces, ['HmIP-RF', 'BidCos-RF']);
  assert.equal(config.sysvars, 'visible');
  assert.equal(config.pollIntervalMs, 30_000);
  assert.equal(config.language, 'fr');
  assert.equal(normalizeConfig({ poll_interval: 300 }).pollIntervalMs, 300_000);
  assert.equal(normalizeConfig({ host: 'x y' }).hostTyped, true);
  assert.equal(normalizeConfig(null).url, null);
});
