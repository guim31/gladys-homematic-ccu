// -----------------------------------------------------------------------------
// The "Homematic CCU" dashboard widget: its content fits the core budget, its
// counts follow the devices added to Gladys, its buttons run CCU programs.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { WIDGET_KEY } from '../src/hub.js';
import { programNames } from '../src/widgets.js';
import { create, createWorld } from './helpers/world.js';

async function world(t, options) {
  const w = await createWorld(options);
  t.after(() => w.app.stop());
  return w;
}

const content = async (w, settings = {}) => {
  const ack = await w.fake.widgetGet(WIDGET_KEY, { settings, language: 'en', units: 'metric' });
  assert.equal(ack.success, true, ack.error);
  return ack.data.content;
};

const budget = (components) => {
  const count = (types) => components.filter((c) => types.includes(c.type)).length;
  assert.ok(components.length <= 8, 'at most 8 components');
  assert.ok(count(['text']) <= 2, 'at most 2 texts');
  assert.ok(count(['button']) <= 4, 'at most 4 buttons');
  assert.ok(count(['status']) <= 1, 'one status list');
};

test('the widget counts the devices added to Gladys, within the budget', async (t) => {
  const w = await world(t);
  await create(w, ['HmIP-SWO-PR', 'HmIP-SMI', 'HmIP-eTRV-2'], { hub: true });
  w.ccu.set(w.ccu.dp('HmIP-SMI', 0, 'UNREACH'), true);
  w.ccu.sysvars.find((sysvar) => sysvar.id === '41').value = '2';
  await w.hub.cycle();
  const result = await content(w, { programs: 'A, B, C, D, E' });
  budget(result.components);
  assert.deepEqual(validateWidgetContent(result), []);
  const status = result.components.find((c) => c.type === 'status');
  const value = (label) => status.items.find((item) => item.label.en === label).value;
  assert.equal(value('Service messages'), 2);
  assert.equal(value('Alarm messages'), 0);
  assert.equal(value('Devices out of reach'), 1);
  // The weather station of the fixtures reports a low battery.
  assert.equal(value('Low batteries'), 1);
  for (const item of status.items) {
    assert.ok(String(item.value).length <= 40);
  }
});

test('the program buttons are numbered, confirmed, and run the program', async (t) => {
  const w = await world(t);
  const [first, second] = w.ccu.programs.filter((program) => program.isActive);
  const settings = { programs: `${first.name}; ${second.name}, ${first.name}` };
  const buttons = (await content(w, settings)).components.filter((c) => c.type === 'button');
  assert.deepEqual(
    buttons.map((button) => [
      button.action.key,
      button.action.params.program,
      button.action.confirm,
    ]),
    [
      ['run_1', first.name, true],
      ['run_2', second.name, true],
    ],
  );
  for (const button of buttons) {
    assert.ok(button.label.length <= 24);
  }
  const ack = await w.fake.widgetAction(
    WIDGET_KEY,
    'run_2',
    { program: second.name },
    { settings },
  );
  assert.equal(ack.success, true, ack.error);
  assert.match(JSON.stringify(ack.data), /started/);
  assert.deepEqual(w.ccu.executed, [second.id]);
  const unknown = await w.fake.widgetAction(WIDGET_KEY, 'run_1', { program: 'Nope' }, { settings });
  assert.equal(unknown.success, false);
});

test('program names: trimmed, unique, four at most', () => {
  assert.deepEqual(programNames({ programs: ' a , b;; A\nc,d,e ' }), ['a', 'b', 'c', 'd']);
  assert.deepEqual(programNames({}), []);
  assert.deepEqual(programNames({ programs: 42 }), []);
});

test('the widget explains a CCU that does not answer, or no address', async (t) => {
  const w = await world(t);
  w.ccu.online = false;
  await w.hub.cycle();
  const down = await content(w);
  budget(down.components);
  assert.deepEqual(validateWidgetContent(down), []);
  assert.match(JSON.stringify(down), /does not answer/);
  const empty = await world(t, { config: { host: '', language: 'en' } });
  const none = await content(empty);
  assert.match(JSON.stringify(none), /Enter the address/);
});

test('the widget is refreshed when its counts change, not at every reading', async (t) => {
  const w = await world(t);
  await create(w, ['HmIP-SMI']);
  const refreshes = () => w.fake.widgetRefreshes.length;
  const before = refreshes();
  await w.hub.cycle();
  await w.hub.cycle();
  assert.equal(refreshes(), before);
  w.ccu.set(w.ccu.dp('HmIP-SMI', 0, 'UNREACH'), true);
  await w.hub.cycle();
  assert.equal(refreshes(), before + 1);
});
