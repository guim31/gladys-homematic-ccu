// -----------------------------------------------------------------------------
// The hub: one CCU, its devices discovered and published to Gladys, read on a
// timer of the container, their states published when they change, the
// button presses turned into scene events, and the commands of Gladys sent to
// the CCU.
//
// Why a timer: the CCU pushes its changes through an XML-RPC callback server
// that the integration would open, and the Gladys sandbox gives the
// container no inbound port. So the hub reads, one script per interval
// (src/ccu/scripts.js), and Gladys never polls (should_poll: false;
// Gladys 5.2 also never polls a device created without it, Gladys#3198).
// -----------------------------------------------------------------------------

import { DEVICE_TRANSPORTS, createLogger } from '@gladysassistant/integration-sdk';
import { CcuClient } from './ccu/client.js';
import {
  ALARM_MESSAGES_ID,
  SERVICE_MESSAGES_ID,
  buildDevice,
  buildHubDevice,
  deviceIds,
  hubIds,
  normalizeSysVar,
  shownSysVars,
  sysVarState,
} from './devices.js';
import { PRESS_PARAMETERS, dpName, normalizeCcuDevice, profileOf } from './homematic/profiles.js';
import { ACTION_TEXT, CONNECTION_TEXT, ERROR_TEXT, REPORT_TEXT, each, pick } from './texts.js';

const logger = createLogger({ name: 'homematic-hub' });

export const WIDGET_KEY = 'ccu_status';

// Scene trigger keys (manifest `scene_triggers`): permanent once published.
export const TRIGGERS = Object.freeze({ BUTTON_PRESSED: 'button_pressed' });
export const PRESS_TYPES = Object.freeze({ PRESS_SHORT: 'short', PRESS_LONG: 'long' });

export const HUB_TIMINGS = {
  // A command is followed by a reading this soon, to show its effect.
  afterCommandMs: 3_000,
  // Unchanged values are sent again this often, so Gladys keeps them fresh
  // (it shows "no recent value" after 48 h).
  heartbeatMs: 6 * 60 * 60_000,
};

const sameConnection = (a, b) =>
  a &&
  b &&
  a.url === b.url &&
  a.username === b.username &&
  a.password === b.password &&
  a.allowSelfSigned === b.allowSelfSigned;

export class HomematicHub {
  /**
   * @param {object} options
   * @param {object} options.gladys GladysIntegration (or the SDK's fake Gladys)
   * @param {Function} [options.request] HTTP seam (src/ccu/http.js)
   * @param {boolean} [options.timers] periodic timers (off in tests)
   * @param {object} [options.timings] HUB_TIMINGS overrides
   * @param {() => number} [options.now]
   */
  constructor({ gladys, request, timers = true, timings, now }) {
    this.gladys = gladys;
    this.request = request;
    this.timersEnabled = timers;
    this.timings = { ...HUB_TIMINGS, ...timings };
    this.now = now ?? (() => Date.now());
    this.config = null;
    this.client = null;
    /** Discovery result: devices by Gladys external id. */
    this.known = new Map();
    /** System variables shown on the CCU device, by id. */
    this.sysvars = new Map();
    this.discovered = false;
    this.lastRead = null; // { at, datapoints, sysvars }
    this.readAt = 0;
    this.error = null; // { kind, message } of the last failed request
    this.presses = new Map(); // datapoint → last press timestamp seen
    this.baselined = new Set(); // devices whose presses were read once
    this.transports = new Map();
    this.connection = null;
    this.summaryKey = null;
    this.pollTimer = null;
    this.soonTimer = null;
    this.cycling = null;
    this.wasConnected = false;
    this.stopped = false;
    /** Problems already logged at their level, by key: repeats go to debug. */
    this.warned = new Set();
  }

  // --- Logs ------------------------------------------------------------------------
  // Info keeps the lifecycle only (CCU connected, lost, back, user commands).
  // A problem that repeats every cycle is logged once, then at debug until it
  // clears. LOG_LEVEL=debug shows everything.

  problem(key, message, level = 'warn') {
    if (this.warned.has(key)) {
      logger.debug(message);
      return;
    }
    this.warned.add(key);
    logger[level](message);
  }

  resolved(key, message) {
    if (this.warned.delete(key) && message) {
      logger.info(message);
    }
  }

  // --- Lifecycle ---------------------------------------------------------------------

  async start(config) {
    await this.reconfigure(config);
  }

  /** Gladys reconnected (it restarted): send everything again. */
  async resync(config) {
    this.transports.clear();
    this.connection = null;
    this.summaryKey = null;
    this.gladys.forgetPublishedStates();
    await this.reconfigure(config);
  }

  async reconfigure(config) {
    const previous = this.config;
    this.config = config;
    if (!sameConnection(previous, config) || !this.client) {
      await this.client?.logout();
      this.client = config.url
        ? new CcuClient({
            url: config.url,
            username: config.username,
            password: config.password,
            insecure: config.allowSelfSigned,
            request: this.request,
            now: this.now,
          })
        : null;
      this.error = null;
      this.lastRead = null;
      this.presses.clear();
      this.baselined.clear();
    }
    this.discovered = false;
    await this.cycle();
    this.schedulePoll();
  }

  async stop() {
    this.stopped = true;
    clearTimeout(this.pollTimer);
    clearTimeout(this.soonTimer);
    await this.cycling?.catch(() => {});
    await this.client?.logout();
  }

  schedulePoll() {
    clearTimeout(this.pollTimer);
    if (!this.timersEnabled || this.stopped || !this.config) {
      return;
    }
    this.pollTimer = setTimeout(async () => {
      try {
        await this.cycle();
        this.resolved('cycle');
      } catch (err) {
        this.problem('cycle', `Reading cycle failed: ${err.message}`, 'error');
      }
      this.schedulePoll();
    }, this.config.pollIntervalMs);
  }

  /** One reading soon (after a command), on top of the regular timer. */
  scheduleSoon() {
    clearTimeout(this.soonTimer);
    if (!this.timersEnabled || this.stopped) {
      return;
    }
    this.soonTimer = setTimeout(() => {
      this.cycle().catch((err) => logger.debug(`Reading after a command failed: ${err.message}`));
    }, this.timings.afterCommandMs);
    this.soonTimer.unref?.();
  }

  /** Discover when not done yet, then read. Concurrent calls share the work. */
  cycle() {
    this.cycling ??= (async () => {
      try {
        if (!this.client) {
          await this.publishNoCcu();
          return;
        }
        if (!this.discovered) {
          await this.discover();
        }
        if (this.discovered) {
          await this.poll();
        }
      } finally {
        this.cycling = null;
      }
    })();
    return this.cycling;
  }

  async publishNoCcu() {
    this.known.clear();
    this.sysvars.clear();
    await this.gladys.publishDiscoveredDevices([]);
    await this.publishConnectionStatus();
  }

  // --- Discovery -----------------------------------------------------------------------

  /**
   * Read the devices, interfaces, values and system variables of the CCU and
   * publish the devices. A failure is reported, not thrown: the next cycle
   * tries again.
   * @returns {Promise<boolean>}
   */
  async discover() {
    try {
      const [interfaces, rawDevices, rawSysVars] = await Promise.all([
        this.client.listInterfaces(),
        this.client.listDevices(),
        this.client.listSysVars(),
      ]);
      const present = new Set(interfaces.map((entry) => entry?.name));
      const enabled = this.config.interfaces.filter((name) => present.has(name));
      // One script per interface: the values the CCU holds tell which
      // features exist (a weather station without a rain sensor...).
      const values = new Map();
      for (const iface of enabled) {
        for (const [name, value] of await this.client.fetchAll(iface)) {
          values.set(name, value);
        }
      }
      const known = new Map();
      const devices = [];
      for (const raw of rawDevices) {
        const device = normalizeCcuDevice(raw);
        if (!device || !enabled.includes(device.iface)) {
          continue;
        }
        const profile = profileOf(device, (name) => values.has(name));
        if (!profile) {
          continue;
        }
        const payload = buildDevice(this.gladys, device, profile, this.config.language);
        const features = new Map(
          profile.features.map((spec) => [
            deviceIds(this.gladys, device.address).feature(spec.key),
            spec,
          ]),
        );
        known.set(payload.external_id, { device, profile, features });
        devices.push(payload);
      }
      const sysvars = shownSysVars(
        rawSysVars.map(normalizeSysVar).filter(Boolean),
        this.config.sysvars,
      );
      this.known = known;
      this.sysvars = new Map(sysvars.map((sysvar) => [sysvar.id, sysvar]));
      devices.sort((a, b) => a.name.localeCompare(b.name));
      await this.gladys.publishDiscoveredDevices([
        buildHubDevice(this.gladys, sysvars, this.config.language),
        ...devices,
      ]);
      this.discovered = true;
      logger.info(
        `CCU devices found: ${devices.length} for Gladys (${enabled.join(', ') || 'no interface'})`,
      );
      return true;
    } catch (err) {
      if (!err.kind) {
        throw err;
      }
      await this.failed(err);
      return false;
    }
  }

  /** "Search" in the Discovery tab, or a new configuration. */
  async rediscover() {
    if (!this.client) {
      await this.publishNoCcu();
      return;
    }
    this.discovered = false;
    await this.cycle();
    if (this.error) {
      // The Discovery tab shows the reason.
      throw new Error(pick(ERROR_TEXT[this.error.kind], this.config.language));
    }
  }

  /** The user added a device: Gladys dropped what was sent before, read it now. */
  async onDeviceCreated(device) {
    if (!this.known.has(device.external_id) && device.external_id !== hubIds(this.gladys).device) {
      return;
    }
    await this.cycle();
    this.gladys.requestWidgetRefresh(WIDGET_KEY);
  }

  // --- Reading -----------------------------------------------------------------------------

  /** The devices the user added to Gladys, with what the discovery knows of them. */
  createdDevices() {
    const created = [];
    for (const device of this.gladys.devices ?? []) {
      const entry = this.known.get(device.external_id);
      if (entry) {
        created.push({ gladysDevice: device, ...entry });
      }
    }
    return created;
  }

  hubCreated() {
    const id = hubIds(this.gladys).device;
    return (this.gladys.devices ?? []).some((device) => device.external_id === id);
  }

  /** Gladys asks for a refresh (onPoll): read now, unless a reading is recent. */
  async pollDevice() {
    if (this.now() - this.readAt < this.config.pollIntervalMs / 2) {
      return;
    }
    await this.cycle();
  }

  async poll() {
    const created = this.createdDevices();
    const names = new Set();
    for (const { device, profile } of created) {
      for (const spec of profile.features) {
        spec.reads.forEach((name) => names.add(name));
      }
      for (const channel of profile.buttons) {
        PRESS_PARAMETERS.forEach((parameter) => names.add(dpName(device, channel, parameter)));
      }
      if (profile.unreach) {
        names.add(profile.unreach);
      }
    }
    const sysvarIds = [SERVICE_MESSAGES_ID, ALARM_MESSAGES_ID];
    if (this.hubCreated()) {
      sysvarIds.push(...this.sysvars.keys());
    }
    let read;
    try {
      read = await this.client.read([...names], sysvarIds);
    } catch (err) {
      if (!err.kind) {
        throw err;
      }
      await this.failed(err);
      return;
    }
    this.readAt = this.now();
    this.lastRead = { at: this.readAt, ...read };
    await this.succeeded();
    await this.publishStates(created, read);
    await this.firePresses(created, read.datapoints);
    await this.publishTransports(created, read.datapoints);
    this.refreshWidgetIfChanged();
  }

  async succeeded() {
    if (this.error) {
      logger.info('CCU answers again');
    } else if (!this.wasConnected) {
      logger.info('Connected to the CCU');
    }
    this.wasConnected = true;
    this.error = null;
    await this.publishConnectionStatus();
  }

  async failed(err) {
    const previous = this.error?.kind;
    this.error = { kind: err.kind, message: err.message };
    // One line when the problem starts or changes, not one per reading.
    if (previous !== err.kind) {
      logger.warn(`CCU: ${err.message}`);
    } else {
      logger.debug(`CCU: ${err.message} (again)`);
    }
    await this.publishConnectionStatus();
    if (previous !== err.kind) {
      this.gladys.requestWidgetRefresh(WIDGET_KEY);
    }
  }

  async publishStates(created, read) {
    const states = [];
    for (const { features } of created) {
      const get = (name) => read.datapoints.get(name)?.value;
      for (const [externalId, spec] of features) {
        if (spec.reads.length === 0) {
          continue;
        }
        const value = spec.value(get);
        if (value !== null && value !== undefined) {
          states.push({ device_feature_external_id: externalId, state: value });
        }
      }
    }
    if (this.hubCreated()) {
      const ids = hubIds(this.gladys);
      const counter = (id) => {
        const value = read.sysvars.get(id)?.value;
        return typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : null;
      };
      for (const [key, id] of [
        ['service-messages', SERVICE_MESSAGES_ID],
        ['alarm-messages', ALARM_MESSAGES_ID],
      ]) {
        const value = counter(id);
        if (value !== null) {
          states.push({ device_feature_external_id: ids.feature(key), state: value });
        }
      }
      for (const [id, sysvar] of this.sysvars) {
        const state = sysVarState(sysvar, read.sysvars.get(id)?.value);
        if (state === null) {
          continue;
        }
        states.push({
          device_feature_external_id: ids.feature(`sysvar-${id}`),
          ...(typeof state === 'object' ? { text: state.text } : { state }),
        });
      }
    }
    if (states.length === 0) {
      return;
    }
    try {
      await this.gladys.publishChangedStates(states, { heartbeat: this.timings.heartbeatMs });
      this.resolved('states');
    } catch (err) {
      this.problem('states', `States refused by Gladys: ${err.message}`);
    }
  }

  /**
   * A press is a new timestamp on PRESS_SHORT / PRESS_LONG. The first reading
   * only learns the timestamps: an old press never fires a scene.
   */
  async firePresses(created, datapoints) {
    for (const { gladysDevice, device, profile } of created) {
      const baselined = this.baselined.has(gladysDevice.external_id);
      this.baselined.add(gladysDevice.external_id);
      for (const channel of profile.buttons) {
        for (const parameter of PRESS_PARAMETERS) {
          const name = dpName(device, channel, parameter);
          const ts = datapoints.get(name)?.ts;
          if (!ts) {
            continue;
          }
          const previous = this.presses.get(name);
          this.presses.set(name, ts);
          // A key never pressed has no value on the CCU yet: on a device
          // already read once, its first value is a press.
          const isNew = previous === undefined ? baselined : ts > previous;
          if (!isNew) {
            continue;
          }
          try {
            await this.gladys.publishSceneEvent(TRIGGERS.BUTTON_PRESSED, {
              device: gladysDevice.external_id,
              device_name: gladysDevice.name ?? device.name,
              button: channel,
              press: PRESS_TYPES[parameter],
            });
            this.resolved('scene-event');
          } catch (err) {
            this.problem('scene-event', `Scene event refused by Gladys: ${err.message}`);
          }
        }
      }
    }
  }

  async publishTransports(created, datapoints) {
    const entries = [];
    for (const { gladysDevice, profile } of created) {
      const unreach = profile.unreach ? datapoints.get(profile.unreach)?.value : undefined;
      const transport =
        unreach === true || unreach === 1 ? DEVICE_TRANSPORTS.UNREACHABLE : DEVICE_TRANSPORTS.LOCAL;
      if (this.transports.get(gladysDevice.external_id) !== transport) {
        entries.push({ external_id: gladysDevice.external_id, transport });
      }
    }
    for (let at = 0; at < entries.length; at += 100) {
      const batch = entries.slice(at, at + 100);
      try {
        await this.gladys.publishTransports(batch);
        for (const entry of batch) {
          this.transports.set(entry.external_id, entry.transport);
        }
        this.resolved('transports');
      } catch (err) {
        this.problem('transports', `Transports refused by Gladys: ${err.message}`);
      }
    }
  }

  // --- Connection status and summary --------------------------------------------------------

  connectionStatus() {
    if (!this.config?.url) {
      return {
        connected: false,
        message: this.config?.hostTyped ? CONNECTION_TEXT.invalidHost : CONNECTION_TEXT.noHost,
      };
    }
    if (this.error) {
      return { connected: false, message: ERROR_TEXT[this.error.kind] ?? ERROR_TEXT.api };
    }
    return { connected: true };
  }

  async publishConnectionStatus() {
    const status = this.connectionStatus();
    const key = JSON.stringify(status);
    if (key === this.connection) {
      return;
    }
    try {
      await this.gladys.setConnectionStatus(status.connected, status.message);
      this.connection = key;
      this.resolved('connection-status');
    } catch (err) {
      this.problem('connection-status', `Connection status refused by Gladys: ${err.message}`);
    }
  }

  /** What the widget shows. */
  summary() {
    const created = this.createdDevices();
    const datapoints = this.lastRead?.datapoints ?? new Map();
    const counter = (id) => {
      const value = this.lastRead?.sysvars.get(id)?.value;
      return typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : null;
    };
    let unreachable = 0;
    let lowBattery = 0;
    for (const { profile, features } of created) {
      if (profile.unreach && datapoints.get(profile.unreach)?.value === true) {
        unreachable += 1;
      }
      for (const spec of features.values()) {
        if (spec.kind === 'battery_low') {
          const get = (name) => datapoints.get(name)?.value;
          if (spec.value(get) === 1) {
            lowBattery += 1;
          }
        }
      }
    }
    return {
      configured: Boolean(this.config?.url),
      error: this.error,
      read: Boolean(this.lastRead),
      devices: created.length,
      serviceMessages: counter(SERVICE_MESSAGES_ID),
      alarmMessages: counter(ALARM_MESSAGES_ID),
      unreachable,
      lowBattery,
    };
  }

  refreshWidgetIfChanged() {
    const key = JSON.stringify(this.summary());
    if (key !== this.summaryKey) {
      this.summaryKey = key;
      this.gladys.requestWidgetRefresh(WIDGET_KEY);
    }
  }

  // --- Commands ----------------------------------------------------------------------------------

  requireClient() {
    if (!this.client) {
      throw new Error(pick(ACTION_TEXT.notConfigured, this.config?.language));
    }
    return this.client;
  }

  /** A Gladys command on a feature: the datapoints it writes, in order. */
  async setValue(device, feature, value) {
    const client = this.requireClient();
    const entry = this.known.get(device.external_id);
    const spec = entry?.features.get(feature.external_id);
    if (!entry || !spec) {
      throw new Error(pick(ACTION_TEXT.unknownDevice, this.config.language));
    }
    if (!spec.write) {
      throw new Error(pick(ACTION_TEXT.readOnly, this.config.language));
    }
    const get = (name) => this.lastRead?.datapoints.get(name)?.value;
    const commands = spec.write(value, get);
    try {
      for (const command of commands) {
        await client.setValue(
          entry.device.iface,
          command.address,
          command.parameter,
          command.type,
          command.value,
        );
      }
    } catch (err) {
      if (err.kind) {
        logger.warn(`${entry.device.name}: command refused: ${err.message}`);
        throw new Error(pick(ERROR_TEXT[err.kind] ?? ERROR_TEXT.api, this.config.language), {
          cause: err,
        });
      }
      throw err;
    }
    logger.info(`${entry.device.name}: ${spec.key} set to ${value}`);
    this.scheduleSoon();
  }

  /**
   * Run a program of the CCU, by name (case and spaces ignored) or by id.
   * @returns {Promise<{ id: string, name: string }>}
   */
  async runProgram(reference) {
    const client = this.requireClient();
    const language = this.config.language;
    const wanted =
      typeof reference === 'string' || typeof reference === 'number'
        ? String(reference).trim()
        : '';
    if (!wanted) {
      throw new Error(pick(ACTION_TEXT.noProgram, language));
    }
    const normalize = (text) =>
      String(text ?? '')
        .trim()
        .replace(/\s+/g, ' ')
        .toLowerCase();
    let program;
    try {
      const programs = await client.listPrograms();
      program =
        programs.find((entry) => normalize(entry?.name) === normalize(wanted)) ??
        programs.find((entry) => String(entry?.id) === wanted);
      if (!program) {
        throw new Error(pick(ACTION_TEXT.programNotFound, language)(wanted));
      }
      if (program.isActive === false || program.isActive === 'false') {
        throw new Error(pick(ACTION_TEXT.programInactive, language)(program.name));
      }
      if (!(await client.executeProgram(program.id))) {
        throw new Error(pick(ACTION_TEXT.programRefused, language)(program.name));
      }
    } catch (err) {
      if (err.kind) {
        logger.warn(`Program "${wanted}": ${err.message}`);
        throw new Error(pick(ERROR_TEXT[err.kind] ?? ERROR_TEXT.api, language), { cause: err });
      }
      throw err;
    }
    logger.info(`Program "${program.name}" started`);
    return { id: String(program.id), name: String(program.name) };
  }

  // --- Reports ------------------------------------------------------------------------------------

  /** "Test the connection": discover now and report in every language. */
  async testConnection() {
    if (!this.client) {
      return this.connectionStatus().message;
    }
    this.discovered = false;
    await this.cycle();
    if (this.error) {
      return ERROR_TEXT[this.error.kind] ?? ERROR_TEXT.api;
    }
    let version = null;
    let programs = 0;
    try {
      [version, programs] = await Promise.all([
        this.client.getVersion(),
        this.client.listPrograms().then((list) => list.length),
      ]);
    } catch (err) {
      logger.debug(`Report details unavailable: ${err.message}`);
    }
    const devices = this.known.size;
    const sysvars = this.sysvars.size;
    return each(
      REPORT_TEXT,
      (text) => `${text.ok(version)} ${text.counts(devices, programs, sysvars)}`,
    );
  }
}
