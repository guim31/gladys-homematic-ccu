# CCU fixtures

The data the fake CCU of the tests (`test/helpers/fakeCcu.js`) serves. All of it comes from the
session recordings published by [aiohomematic](https://github.com/SukramJ/aiohomematic) (MIT) in
`aiohomematic_test_support/data`:

- **Homematic IP devices (28)**: `full_session_randomized_ccu.zip`, a real CCU (RaspberryMatic
  3.83.6) recorded by aiohomematic, its addresses randomized by the project (`VCU…`). The answers
  of `Device.listAllDetail`, of the `fetch_all_device_data` script, of `SysVar.getAll` and of
  `Program.getAll` are kept as recorded, for a subset of the devices. The one IP address found in
  them was replaced by 192.0.2.40; the variables holding a counter or an identifier of the
  installation were dropped.
- **Homematic (BidCoS), Homematic Wired and the remaining Homematic IP models (22)**:
  `full_session_godevccu.zip`, the device and paramset descriptions of
  [godevccu](https://github.com/SukramJ/godevccu), the virtual CCU of the project. These are the
  real descriptions of the models (channel types, parameters), but godevccu holds no values: the
  values of these devices in `values.json` are plausible defaults (20.5 °C, 230.1 V, level 0.5…),
  and their names were made up.

| File              | What                                                                    |
| ----------------- | ----------------------------------------------------------------------- |
| `devices.json`    | `Device.listAllDetail`: devices, interfaces, channels and channel types |
| `values.json`     | datapoint name → value, as `fetch_all_device_data` returns them         |
| `sysvars.json`    | `SysVar.getAll`                                                         |
| `programs.json`   | `Program.getAll` (20 programs)                                          |
| `interfaces.json` | `Interface.listInterfaces`                                              |

The JSON API answers follow the code of the CCU web interface (eQ-3 OCCU, `WebUI/www/api`):
sessions, privilege levels, error codes, `Interface.setValue` types.
