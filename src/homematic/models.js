// -----------------------------------------------------------------------------
// Model tables, taken from aiohomematic (MIT, SukramJ, Daniel Perna), the
// library of the Home Assistant integration `homematicip_local`:
// `aiohomematic/model/custom/{switch,light,cover}.py`.
//
// A Homematic IP actuator has one STATE channel (the `*_TRANSMITTER`, what
// the output really does) followed by three `*_VIRTUAL_RECEIVER` channels the
// commands are sent to; only the first receiver is the "real" one, the other
// two are logic channels combined by the device. These tables give, per
// model, the receiver channel of each output. A model missing from them falls
// back to the generic rule of src/homematic/profiles.js (the first receiver
// after each transmitter), which gives the same channels for every model
// below (test/profiles.test.js checks it on the fixtures).
// -----------------------------------------------------------------------------

const table = (entries) => {
  const map = new Map();
  for (const [models, channels] of entries) {
    for (const model of Array.isArray(models) ? models : [models]) {
      map.set(model.toUpperCase(), channels);
    }
  }
  return map;
};

// _IP_SWITCH_REGISTRATIONS, plus HmIP-SMO230.
export const IP_SWITCH_CHANNELS = table([
  [
    ['ELV-SH-BS2', 'HmIP-BS2', 'HmIP-PCBS2'],
    [4, 8],
  ],
  [
    [
      'ELV-SH-PSMCI',
      'ELV-SH-SW1-BAT',
      'HmIP-DRSI1',
      'HmIP-FSI',
      'HmIP-PCBS',
      'HmIP-PCBS-BAT',
      'HmIP-PS',
      'HmIP-USBSM',
      'HmIP-WGC',
    ],
    [3],
  ],
  [['HmIP-BSL', 'HmIP-BSM'], [4]],
  ['HmIP-DRSI4', [6, 10, 14, 18]],
  ['HmIP-FS6', [2]],
  ['HmIP-FSM', [2]],
  ['HmIP-MOD-OC8', [10, 14, 18, 22, 26, 30, 34, 38]],
  ['HmIP-SCTH230', [8]],
  ['HmIP-SMO230', [10]],
  ['HmIP-WGT', [4]],
  ['HmIP-WHS2', [2, 6]],
  ['HmIP-WRC6-230', [9]],
  ['HmIPW-DRS', [2, 6, 10, 14, 18, 22, 26, 30]],
  ['HmIPW-FIO6', [8, 12, 16, 20, 24, 28]],
]);

// _IP_DIMMER_REGISTRATIONS.
export const IP_DIMMER_CHANNELS = table([
  ['HmIP-BDT', [4]],
  ['HmIP-DRDI3', [5, 9, 13]],
  ['HmIP-FDT', [2]],
  ['HmIP-PDT', [3]],
  ['HmIP-WGT', [2]],
  ['HmIPW-DRD3', [2, 6, 10]],
]);

// IP cover and IP blind registrations.
export const IP_COVER_CHANNELS = table([
  [['HmIP-BROLL', 'HmIP-FROLL'], [4]],
  [['HmIP-BBL', 'HmIP-FBL'], [4]],
  ['HmIP-DRBLI4', [10, 14, 18, 22]],
  ['HmIPW-DRBL4', [2, 6, 10, 14]],
]);

/** Receiver channels of `model` for one kind of output, or null when not listed. */
export function tableChannels(kind, model) {
  const tables = {
    switch: IP_SWITCH_CHANNELS,
    dimmer: IP_DIMMER_CHANNELS,
    cover: IP_COVER_CHANNELS,
  };
  const key = String(model).toUpperCase();
  const listed = [IP_SWITCH_CHANNELS, IP_DIMMER_CHANNELS, IP_COVER_CHANNELS].some((map) =>
    map.has(key),
  );
  if (!listed) {
    return null;
  }
  // A model listed in one table has no output of the other kinds: the
  // backlight dimmers of an HmIP-BSL are not lights.
  return tables[kind].get(key) ?? [];
}

// Doors, locks, garage doors, window drives, sirens and alarm actuators:
// nothing of theirs is ever controllable from Gladys (an error there opens
// the house or silences an alarm). Their sensors and buttons stay readable.
export const SECURITY_MODELS = [
  /^HM-Sec-Key/i,
  /^HM-Sec-Win/i,
  /^HM-Sec-Sir/i,
  /^HM-Sec-SFA/i,
  /^HmIP-DL[DPS]/i,
  /^HmIP-FWI/i,
  /^HmIP-WKP/i,
  /^HmIP-MOD-(HO|TM)/i,
  /^HmIP-ASIR/i,
  /^HmIPW?-DRAP/i,
];

// Parts of the CCU itself, not devices of the house: the virtual remotes of
// the CCU, its radio modules and access points.
export const CCU_MODELS = [
  /^HMW?-RCV-50$/i,
  /^HmIP-RCV-50$/i,
  /^RPI-RF-MOD$/i,
  /^HmIP-CCU3$/i,
  /^HmIP-RFUSB/i,
  /^HmIP-HAP/i,
  /^HmIPW?-DRAP/i,
  /^HM-LGW/i,
  /^HMW-LGW/i,
];

export const isSecurityModel = (model) => SECURITY_MODELS.some((re) => re.test(String(model)));
export const isCcuModel = (model) => CCU_MODELS.some((re) => re.test(String(model)));
