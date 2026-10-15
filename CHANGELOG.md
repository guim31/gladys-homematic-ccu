# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- The Homematic and Homematic IP devices of a CCU3, RaspberryMatic or piVCCU in Gladys, in local,
  through the JSON API of the CCU web interface: thermostats and radiator valves (temperature,
  humidity, target temperature, heating mode, heating, open window), window and door contacts and
  handles, motion, presence, smoke and water detectors, switches and plugs with power, energy,
  voltage and current, energy meter interfaces, shutters, blinds and dimmers, weather and climate
  sensors, low battery, and the "unreachable" badge.
- The Homematic CCU device: the service and alarm message counters and the visible system
  variables of the CCU, read-only.
- Scene trigger "Homematic button pressed" (remotes, wall switches, inputs; short or long press)
  and scene action "Run a CCU program".
- Dashboard widget "Homematic CCU": service and alarm messages, devices out of reach, low
  batteries, and up to four buttons that run CCU programs.
- The CCU is read by the integration itself, one short script per interval (10 s to 5 min), with
  no radio traffic; only the changes are sent to Gladys.
- Locks, door openers, garage doors, window drives and sirens are never controllable.
- Feature names, messages and documentation in English, French, German and Spanish.

[Unreleased]: https://github.com/guim31/gladys-homematic-ccu/commits/main
