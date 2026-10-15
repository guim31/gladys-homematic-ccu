// -----------------------------------------------------------------------------
// Dashboard widget (manifest `widgets`, Gladys 5.1+): the health of the CCU at
// a glance — service and alarm messages, devices out of reach, low
// batteries — and up to four buttons that run CCU programs chosen in the
// widget settings.
//
// The counts cover the devices added to Gladys. The program buttons ask for
// a confirmation: a program may open a door or arm an alarm, whatever the
// CCU does with it. Action keys are numbered (`run_1`...): the core drops a
// button whose key is already taken.
// -----------------------------------------------------------------------------

import { WIDGET_KEY } from './hub.js';
import { CONNECTION_TEXT, ERROR_TEXT, actionMessage } from './texts.js';

export const MAX_PROGRAM_BUTTONS = 4;
const MAX_BUTTON_LABEL = 24;

export const TEXT = {
  serviceMessages: {
    en: 'Service messages',
    fr: 'Messages de service',
    de: 'Servicemeldungen',
    es: 'Mensajes de servicio',
  },
  alarmMessages: {
    en: 'Alarm messages',
    fr: "Messages d'alarme",
    de: 'Alarmmeldungen',
    es: 'Mensajes de alarma',
  },
  unreachable: {
    en: 'Devices out of reach',
    fr: 'Appareils injoignables',
    de: 'Nicht erreichbare Geräte',
    es: 'Dispositivos sin conexión',
  },
  lowBattery: {
    en: 'Low batteries',
    fr: 'Piles faibles',
    de: 'Schwache Batterien',
    es: 'Baterías bajas',
  },
  noReading: {
    en: 'No reading of the CCU yet.',
    fr: 'Pas encore de lecture de la CCU.',
    de: 'Noch keine Abfrage der CCU.',
    es: 'Todavía no se ha leído la CCU.',
  },
  caption: {
    en: 'Counts of the devices added to Gladys',
    fr: 'Décompte des appareils ajoutés à Gladys',
    de: 'Zählung der zu Gladys hinzugefügten Geräte',
    es: 'Recuento de los dispositivos añadidos a Gladys',
  },
};

/** The program names typed in the widget settings, at most four. */
export function programNames(settings) {
  const raw = typeof settings?.programs === 'string' ? settings.programs : '';
  const seen = new Set();
  return raw
    .split(/[,;\n]/)
    .map((name) => name.trim())
    .filter((name) => {
      const key = name.toLowerCase();
      if (!name || seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .slice(0, MAX_PROGRAM_BUTTONS);
}

const shorten = (text) =>
  text.length > MAX_BUTTON_LABEL ? `${text.slice(0, MAX_BUTTON_LABEL - 1)}…` : text;

function buttons(settings) {
  return programNames(settings).map((name, index) => ({
    type: 'button',
    label: shorten(name),
    icon: 'play',
    style: 'secondary',
    action: { key: `run_${index + 1}`, params: { program: name }, confirm: true },
  }));
}

export const WIDGETS = {
  [WIDGET_KEY]: {
    async get(hub, { settings = {} } = {}) {
      const summary = hub.summary();
      const components = [];
      if (!summary.configured) {
        components.push({ type: 'text', variant: 'body', text: CONNECTION_TEXT.noHost });
        return { ttl_seconds: 300, components };
      }
      if (summary.error) {
        components.push({
          type: 'text',
          variant: 'body',
          text: ERROR_TEXT[summary.error.kind] ?? ERROR_TEXT.api,
        });
      } else if (!summary.read) {
        components.push({ type: 'text', variant: 'body', text: TEXT.noReading });
      }
      if (summary.read) {
        const count = (value) => value ?? '-';
        const tone = (value, color) => (value ? color : 'success');
        components.push({ type: 'text', variant: 'caption', text: TEXT.caption });
        components.push({
          type: 'status',
          items: [
            {
              label: TEXT.serviceMessages,
              value: count(summary.serviceMessages),
              icon: 'tool',
              color: tone(summary.serviceMessages, 'warning'),
            },
            {
              label: TEXT.alarmMessages,
              value: count(summary.alarmMessages),
              icon: 'bell',
              color: tone(summary.alarmMessages, 'danger'),
            },
            {
              label: TEXT.unreachable,
              value: summary.unreachable,
              icon: 'wifi-off',
              color: tone(summary.unreachable, 'warning'),
            },
            {
              label: TEXT.lowBattery,
              value: summary.lowBattery,
              icon: 'battery',
              color: tone(summary.lowBattery, 'warning'),
            },
          ],
        });
      }
      components.push(...buttons(settings));
      return { ttl_seconds: 60, components };
    },

    async action(hub, { actionKey, params = {} }) {
      if (!/^run_\d+$/.test(actionKey)) {
        throw new Error(`Unknown action ${actionKey}`);
      }
      const program = await hub.runProgram(params.program);
      return actionMessage('programStarted', program.name);
    },
  },
};
