# Homematic CCU for Gladys Assistant

A [Gladys Assistant](https://gladysassistant.com) integration for the **Homematic CCU3**,
**RaspberryMatic** and **piVCCU**: the Homematic (BidCoS) and Homematic IP devices paired with your
CCU, in Gladys, in local.

> **Developed without the hardware: feedback welcome.** Written from the documentation of the CCU,
> the code of its web interface and real CCU recordings published by aiohomematic, never run
> against a real CCU yet. Please report what works and what does not in the
> [issues](https://github.com/guim31/gladys-homematic-ccu/issues).

Not affiliated with eQ-3. Homematic and Homematic IP are trademarks of eQ-3 AG.

## What it does

- **Devices**: one Gladys device per Homematic device, its features chosen from its channel types:
  - thermostats and radiator valves (temperature, humidity, target temperature, heating mode
    auto / heating / off, heating on or not, open window);
  - window and door contacts, window handles;
  - motion, presence, smoke and water detectors;
  - switches and plugs, with power, energy, voltage and current; energy meter interfaces;
  - shutters and blinds (position, open / close / stop), dimmers;
  - weather and climate sensors (temperature, humidity, illuminance, wind, pressure, rain);
  - low battery on every battery device, the "unreachable" badge when the CCU loses a device.
- **The Homematic CCU device**: the service and alarm message counters of the CCU, and its visible
  system variables (read-only).
- **Scene trigger** "Homematic button pressed": a key of a remote, a wall switch or an input,
  short or long press.
- **Scene action** "Run a CCU program", by name.
- **Widget** "Homematic CCU": service and alarm messages, devices out of reach, low batteries, and
  up to four buttons that run CCU programs.
- **Safety**: locks, door openers, garage doors, window drives and sirens are never controllable
  from Gladys.

The full user documentation is in [docs/en.md](docs/en.md) (also in
[French](docs/fr.md), [German](docs/de.md) and [Spanish](docs/es.md)).

## Requirements

- A CCU3, RaspberryMatic or piVCCU reachable from Gladys on its web port (80 or 443).
- A CCU user with administrator rights (`Admin` with an empty password when the CCU has its
  authentication off).
- Gladys Assistant 5.1 or later.

## Installation

In Gladys: **Integrations → Install from GitHub**, then
`https://github.com/guim31/gladys-homematic-ccu`. Fill in the address of the CCU (and the user and
password if the authentication is on), open the **Discovery** tab and add your devices.

## How it works

The integration talks to the JSON API of the CCU web interface (`/api/homematic.cgi`), the path
every CCU3, RaspberryMatic and piVCCU answers on.

- **No push, a reading timer.** The CCU sends its changes by calling an XML-RPC server the client
  opens (`init`); the Gladys sandbox gives an integration no inbound port, so the integration reads
  instead. At each interval (30 s by default, 10 s to 5 min), **one** HomeMatic script (`ReGa.runScript`)
  returns the values and timestamps the CCU logic layer already holds, for the devices added to
  Gladys only: no radio traffic, no duty cycle spent, one request whatever the number of devices.
  The timestamps tell a new button press from an old one. A command is read back 3 s after it is
  sent.
- **Discovery.** `Device.listAllDetail` gives the devices and their channel types; the
  `fetch_all_device_data` script of aiohomematic, one per interface, tells which values exist.
- **Commands.** `Interface.setValue`, typed as the CCU expects (`bool`, `int`, `double`): a
  Homematic IP output is switched on its first virtual receiver channel and read on its
  transmitter channel, the channels taken from the model tables of aiohomematic.
- **Gladys never polls** (`should_poll: false`): the integration reads on its own timer
  (Gladys#3198). Only changed states are published, and every value again every 6 hours.

Read-only probe of a real CCU, for the maintainers (prints no password, no session id, no device
name):

```bash
CCU_PASSWORD=... node scripts/probe.mjs https://192.0.2.10 Admin
```

## Limits

- No real time: values and button presses follow the reading interval.
- No pairing nor device configuration (week programs, parameters): the CCU does that.
- System variables are read-only; programs can be run, not edited.
- CUxD, CCU-Jack and other add-on interfaces are not read. One CCU per installation.
- Gladys has no feature type for a valve percentage: a thermostat shows whether it heats.

## Development

```bash
npm install
npm test               # node --test, against the SDK's fake Gladys and a fake CCU
npm run lint
npm run format:check
```

The tests run the integration against an in-memory CCU (`test/helpers/fakeCcu.js`) that answers
like the WebUI JSON API, fed with real CCU data: see [test/fixtures/ccu](test/fixtures/ccu/README.md).

## Credits

- [aiohomematic](https://github.com/SukramJ/aiohomematic) (formerly `hahomematic`, MIT, SukramJ and
  Daniel Perna), the library of the Home Assistant integration
  [homematicip_local](https://github.com/SukramJ/homematicip_local): its `fetch_all_device_data`
  script, its model tables, and the CCU session recordings the test fixtures come from.
- [ioBroker.hm-rega](https://github.com/ioBroker/ioBroker.hm-rega) (MIT, hobbyquaker), where the
  datapoint script comes from.
- The eQ-3 [OCCU](https://github.com/eq-3/occu) web interface code, read to follow the JSON API
  exactly (not copied).

## License

[Apache-2.0](LICENSE).
