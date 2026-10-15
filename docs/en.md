# Homematic CCU

Brings the Homematic and Homematic IP devices of your **CCU3**, **RaspberryMatic** or **piVCCU**
into Gladys, in local: thermostats and radiator valves, window contacts, motion, smoke and water
detectors, switches and plugs with metering, shutters, dimmers, weather sensors, the buttons of
your remotes, the system variables and the programs of the CCU.

> **Developed without the hardware: feedback welcome.** The integration was written from the
> documentation of the CCU, the code of its web interface and real recordings of CCUs published
> by the aiohomematic project, but never run against a real CCU. Tell us what works and what does
> not: [github.com/guim31/gladys-homematic-ccu/issues](https://github.com/guim31/gladys-homematic-ccu/issues).

Not affiliated with eQ-3. Homematic and Homematic IP are trademarks of eQ-3 AG.

## Requirements

- A CCU3, a RaspberryMatic or a piVCCU, reachable from Gladys on its web port (80, or 443 in
  HTTPS). The devices are paired with the CCU, as usual: Gladys does not replace it.
- A CCU user with **administrator** rights: the integration reads the values through a short
  HomeMatic script, which the CCU only runs for an administrator. If the authentication is off on
  your CCU (the default), keep the user `Admin` and leave the password empty.
- Gladys 5.1 or later.

## Configuration

In Gladys, **Integrations → Homematic CCU → Configuration**:

- **CCU address**: its IP address or name, e.g. `192.168.1.50`. Write `https://192.168.1.50` if
  the CCU forwards its web interface to HTTPS.
- **User** and **Password**: an administrator of the CCU (`Admin` and an empty password when the
  authentication is off).
- **Accept a self-signed certificate**: on by default, the CCU signs its own HTTPS certificate.
- **Interfaces read**: Homematic IP (radio), Homematic (radio), Homematic Wired, Heating groups
  (Homematic IP). Untick a family to keep it out of Gladys.
- **System variables**: the visible ones are shown on the Homematic CCU device, or none.
- **Reading interval**: 30 s by default, from 10 s to 5 min.
- **Language of the names**: the language of the feature names given when a device is added.

Then open the **Discovery** tab, and add the devices you want. **Test the connection** reads the
CCU and says what it found: its firmware, the number of devices for Gladys, of programs and of
system variables.

**How the CCU is read.** The CCU announces its changes by calling back a server that the
integration would open; the Gladys sandbox gives integrations no inbound port, so the integration
reads instead: at each interval, **one** short script asks the CCU for the values it already
holds, those of the devices added to Gladys. Nothing goes over the radio, the duty cycle is not
spent, and the load on the CCU stays the same whatever the number of devices. A command is read
back three seconds after it is sent.

## Devices

One Gladys device per Homematic device, with the name it has in the CCU. A device with several
outputs gets numbered features (Switch 1, Switch 2…). Every device running on batteries has
**Low battery**. A device the CCU reports out of reach shows the "unreachable" badge.

### Thermostats and radiator valves

Homematic IP radiator valves and wall thermostats (HmIP-eTRV, HmIP-WTH, HmIP-BWTH, HmIP-STH…),
heating groups, Homematic HM-CC-RT-DN and HM-TC-IT-WM-W-EU:

- **Temperature**, **Humidity** (when the thermostat measures it);
- **Target temperature**, from 4.5 °C (off) to 30.5 °C, by half degrees;
- **Heating mode**: automatic (the weekly program of the CCU), heating (manual setpoint) or off
  (4.5 °C). Leaving "off" for "heating" sets 20 °C;
- **Heating**: whether the valve is open (Gladys has no feature type for a valve percentage);
- **Window (thermostat)**: the open window seen by the thermostat.

The relay of a wall thermostat that drives a floor heating is not a switch in Gladys: it follows
the regulation of the CCU.

### Window and door contacts

**Opening** for the contacts (HmIP-SWDO, HmIP-SCI, HM-Sec-SC…), **Window handle** for the handles
(HmIP-SRH, HM-Sec-RHS): a tilted handle counts as open.

### Motion, presence, smoke and water detectors

**Motion** and **Illuminance** (HmIP-SMI, HM-Sec-MDIR…), **Presence** (HmIP-SPI), **Smoke** (only
the detector that sees smoke: the others of the group, which only ring, stay at 0), **Water leak**
(HmIP-SWD, HM-Sec-WDS).

### Switches, plugs and energy meters

**Switch** for every output (HmIP-PS, HmIP-PSM, HmIP-BSM, HmIP-FSM, HmIP-DRSI4, HM-LC-Sw…), with
**Power**, **Energy** (kWh), **Voltage** and **Current** when the device measures them. An energy
meter interface (HmIP-ESI) gives its power (negative when you feed in) and its counters.

### Shutters, blinds and dimmers

**Position** (0 % closed, 100 % open) and **Shutter** (open, close, stop) for the shutter and blind
actuators (HmIP-BROLL, HmIP-FBL, HM-LC-Bl1…). **Light** and **Brightness** for the dimmers
(HmIP-BDT, HM-LC-Dim…).

### Weather and climate sensors

**Temperature**, **Humidity**, **Illuminance**, **Wind speed**, **Air pressure** and **Rain**,
whatever the sensor reports (HmIP-SWO, HmIP-STHO, HmIP-SRD, HM-WDS…).

### The Homematic CCU device

**Service messages** and **Alarm messages**: the counters of the CCU. Then one feature per visible
system variable, read-only: logical variables and alarms as on/off, the others as text (a list
shows its value name, a number its unit).

Locks, door openers, garage doors, window drives and sirens are never controllable from Gladys:
an error there would open the house or silence an alarm. Their batteries and buttons stay
readable.

## Scene trigger: Homematic button pressed

**Homematic button pressed** starts a scene when a key of a remote, of a wall switch or an input
is pressed (HmIP-WRC2/6, HmIP-BRC2, HmIP-KRCA, HmIP-DSD-PCB, HM-PB-2-WM55…). Filters: the device,
the **button number** (the channel of the key in the CCU, 1 for the first one), **short** or
**long** press. The scene can use the device name, the button number and the press.

Add the remote in Gladys first (its device shows its battery). The press is seen at the next
reading of the CCU: with a 10 s interval, within 10 s. Two presses of the same key between two
readings count as one.

## Scene action: Run a CCU program

**Run a CCU program** starts a program of the CCU by its name, as written in the CCU (Programs
and connections), case ignored. The name accepts scene variables. A disabled program is not run.

## Widget: Homematic CCU

The **Homematic CCU** widget shows the service and alarm messages of the CCU, the devices out of
reach and the low batteries among the devices added to Gladys, and up to four buttons that run
CCU programs: type their names, separated by commas, in the widget settings. Each button asks
for a confirmation.

## Scene examples

- **Doorbell**: trigger **Homematic button pressed** on the HmIP-DSD-PCB, button 1 → send a
  message with a camera image.
- **Leaving home**: long press on button 4 of the key ring remote → turn off the lights, then
  **Run a CCU program** "Leaving" to lower the heating.
- **Window open**: a window **Opening** at 0 (open) for 5 minutes → send a message "close the
  window, the heating is on".

## Troubleshooting

- **The CCU does not answer**: check the address, that Gladys reaches the CCU (same network, no
  firewall between them) and that the web interface opens in a browser.
- **The CCU redirects to HTTPS**: the CCU option "automatic forwarding to HTTPS" is on: write the
  address with `https://`.
- **User or password refused**: check them in the CCU (Settings → User management). The CCU also
  refuses a login when too many sessions are open: they expire after 30 minutes.
- **The CCU user must be an administrator**: give the user the administrator role, or use `Admin`.
- **A device is missing**: it must be finished in the CCU inbox, and its interface ticked. Search
  again in the Discovery tab after adding a device to the CCU.
- **A sensor feature is missing**: a feature appears once the CCU received a value for it; search
  again later.
- Logs: in Gladys, **Settings → System → Integrations**. Set `LOG_LEVEL=debug` to see each reading.

## Limits

- Developed without the hardware: feedback welcome.
- No real time: the values follow the reading interval (10 s at best), a button press too.
- No configuration of the devices (week programs, parameters), no pairing: use the CCU.
- The system variables are read-only; programs run, but cannot be edited.
- CUxD, CCU-Jack and other add-on interfaces are not read.
- One CCU per installation of the integration.
