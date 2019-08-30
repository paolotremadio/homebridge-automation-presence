const { forEach, values, cloneDeep } = require('lodash');
const fakegatoHistory = require('fakegato-history');
const logger = require('homeautomation-winston-logger');
const moment = require('moment');
const debug = require('debug')('homebridge-automation-presence');

const logEvent = require('./logger/message/event');
const logSnapshot = require('./logger/message/snapshot');
const initState = require('./state/init');
const statePersist = require('./state/persist');
const mergePersisted = require('./state/merge-persisted-state');
const isTriggeredReducer = require('./state/is-triggered-reducer');
const Api = require('./api');

const pkginfo = require('../package');

let Characteristic;
let Service;
let UUIDGen;
let FakeGatoHistoryService;
let storagePath;

class AutomationPresence {
  constructor(log, config) {
    this.homebridgeLog = log;
    this.name = config.name;

    this.accessoryUUID = UUIDGen.generate(this.name);
    this.stateStorageFile = `${storagePath}/accessories/presence_state_${this.accessoryUUID}.json`;

    const persistedState = this.getPersistedState();
    const initialState = initState(config.zones, UUIDGen.generate);
    this.zones = mergePersisted(persistedState, initialState);

    this.masterPresenceSensorTriggeredTimer = null;
    this.masterPresenceOffDelay =
      config.masterPresenceOffDelay ? config.masterPresenceOffDelay * 1000 : 5000;

    this.logger = logger(`${storagePath}/presence.log`, config.debug);
    this.logger.debug('Service started');

    if (config.api) {
      Api(
        config.api.host,
        config.api.port,
        {
          getState: () => ({ master: this.masterPresenceSensorTriggered, zones: this.zones }),
          setState: (zoneId, triggerId, triggered) => {
            debug(`API setState() - Zone ID: ${zoneId} - Trigger ID: ${triggerId} - Triggered: ${triggered}`);
            return this.handleTriggerEvent(zoneId, triggerId, triggered ? 1 : 0, true);
          },
        },
      );
    }

    this.services = this.createServices();
    this.startStateSnapshot();
    this.resetExpiredTriggers();
  }

  getPersistedState() {
    setTimeout(() => this.persistState(), 5000);

    try {
      return statePersist.getPersistedState(this.stateStorageFile);
    } catch (e) {
      this.homebridgeLog('No previous state persisted on file');
      return {};
    }
  }

  persistState() {
    try {
      statePersist.persistState(this.stateStorageFile, this.zones);
    } catch (e) {
      this.homebridgeLog(`Cannot persist state: ${e.message}`);
    }
  }

  startStateSnapshot() {
    const generateSnapshot = () => {
      const snapshot = cloneDeep(this.zones);
      snapshot.master = {
        triggered: this.masterPresenceSensorTriggered,
      };

      this.logger.info(logSnapshot(snapshot));
    };
    generateSnapshot();
    setInterval(generateSnapshot, 10 * 60 * 1000);
  }

  getAccessoryInformationService() {
    this.logger.debug({ appVersion: pkginfo.version });

    const accessoryInformationService = new Service.AccessoryInformation();

    accessoryInformationService
      .setCharacteristic(Characteristic.Name, this.name)
      .setCharacteristic(Characteristic.Manufacturer, pkginfo.author.name || pkginfo.author)
      .setCharacteristic(Characteristic.Model, pkginfo.name)
      .setCharacteristic(Characteristic.SerialNumber, 'n/a')
      .setCharacteristic(Characteristic.FirmwareRevision, pkginfo.version)
      .setCharacteristic(Characteristic.HardwareRevision, pkginfo.version);

    return accessoryInformationService;
  }

  getZoneServices() {
    this.zoneServices = {};
    this.zoneTriggers = {};

    forEach(this.zones, (zone) => {
      const { id: zoneId, name: zoneName } = zone;

      // Main sensor
      const sensor = new Service.MotionSensor(
        zoneName,
        zoneId,
      );

      sensor
        .getCharacteristic(Characteristic.MotionDetected)
        .on('get', callback => callback(null, zone.triggered));

      sensor
        .getCharacteristic(Characteristic.StatusActive)
        .on('get', callback => callback(null, true));

      // Add triggers
      forEach(zone.triggers, (trigger) => {
        const { id: triggerId, name: triggerName } = trigger;

        const triggerSwitch = new Service.Switch(`${zoneName} - ${triggerName}`, triggerId);

        triggerSwitch
          .getCharacteristic(Characteristic.On)
          .on('get', callback => callback(null, trigger.triggered))
          .on('set', (on, callback) => {
            debug(`Homekit switch set - Zone ID: ${zoneId} - Trigger ID: ${triggerId} - Triggered: ${on}`);
            this.handleTriggerEvent(zoneId, triggerId, on ? 1 : 0);
            callback();
          });

        this.zoneTriggers[triggerId] = triggerSwitch;
      });

      // Add to the list
      this.zoneServices[zoneId] = sensor;
    });

    return [
      ...values(this.zoneServices),
      ...values(this.zoneTriggers),
      ...values(this.zoneHistoryServices),
    ];
  }

  getMasterPresenceSensor() {
    this.masterPresenceSensorTriggered = isTriggeredReducer(this.zones);
    this.masterPresenceSensor = new Service.MotionSensor(
      `${this.name} (master)`,
      'master',
    );

    this.masterPresenceSensor
      .on('get', callback => callback(null, this.masterPresenceSensorTriggered));

    this.masterPresenceSensor
      .getCharacteristic(Characteristic.MotionDetected)
      .updateValue(this.masterPresenceSensorTriggered);

    // Add history
    this.masterPresenceSensor.log = this.homebridgeLog;

    this.masterPresenceSensorHistory = new FakeGatoHistoryService(
      'motion',
      this.masterPresenceSensor,
      {
        storage: 'fs',
        path: `${storagePath}/accessories`,
        filename: `history_presence_master_${this.accessoryUUID}.json`,
      },
    );

    return [this.masterPresenceSensor, this.masterPresenceSensorHistory];
  }

  createServices() {
    return [
      this.getAccessoryInformationService(),
      ...this.getZoneServices(),
      ...this.getMasterPresenceSensor(),
    ];
  }

  updateTrigger(zoneId, triggerId, value, notifyHomekit) {
    const zone = zoneId && this.zones[zoneId];
    const trigger = zone && triggerId && this.zones[zoneId].triggers[triggerId];

    debug(`updateTrigger() - Zone ID: ${zoneId} - Trigger ID: ${triggerId} - Value: ${value}`);

    if (trigger.triggered !== value) {
      debug(`updateTrigger() - Zone ID: ${zoneId} - Trigger ID: ${triggerId} - Old status: ${trigger.triggered} - New status: ${value} - Value is different, updating`);
      trigger.triggered = value;

      if (value && trigger.resetAfter) {
        trigger.resetAt = moment().add(trigger.resetAfter).format();
        debug(`updateTrigger() - Zone ID: ${zoneId} - Trigger ID: ${triggerId} - Reset after: ${trigger.resetAfter} - Will reset at: ${trigger.resetAt}`);
      } else {
        trigger.resetAt = undefined;
      }

      const eventExtras = {
        zoneName: zone.name,
        triggerName: trigger.name,
      };

      this.logger.info(logEvent(zoneId, triggerId, value, eventExtras));
      this.persistState();

      if (notifyHomekit) {
        this.zoneTriggers[triggerId]
          .getCharacteristic(Characteristic.On)
          .updateValue(value);
      }
    }
  }

  updateZone(zoneId) {
    const value = isTriggeredReducer(this.zones[zoneId].triggers);
    const zone = zoneId && this.zones[zoneId];

    debug(`updateZone() - Zone ID: ${zoneId} - Reduced value: ${value}`);

    if (zone.triggered !== value) {
      debug(`updateZone() - Zone ID: ${zoneId} - Old status: ${zone.triggered} - New status: ${value} - Value is different, updating`);
      zone.triggered = value;

      this.zoneServices[zoneId]
        .getCharacteristic(Characteristic.MotionDetected)
        .updateValue(value);

      this.logger.info(logEvent(zoneId, null, value, { zoneName: zone.name }));
      this.persistState();
    }
  }

  updateMaster() {
    debug('updateMaster()');
    const value = isTriggeredReducer(this.zones);

    const updateSensor = (status, fromTimer) => {
      if (fromTimer) {
        debug(`updateMaster() - Timer ran out - Old status: ${this.masterPresenceSensorTriggered} - New status: ${status}`);
      } else {
        debug(`updateMaster() - Instant update - Old status: ${this.masterPresenceSensorTriggered} - New status: ${status}`);
      }

      this.masterPresenceSensorTriggered = status;
      this.masterPresenceSensor
        .getCharacteristic(Characteristic.MotionDetected)
        .updateValue(status);

      this.masterPresenceSensorHistory
        .addEntry({ time: new Date().getTime(), status });

      this.logger.info(logEvent(null, null, status, { master: true }));
    };

    // Write log only if there's a change (to avoid writing a new line every single switch change)
    if (value !== this.masterPresenceSensorTriggered) {
      this.masterPresenceSensorHistory
        .addEntry({ time: new Date().getTime(), status: value });

      this.logger.info(logEvent(null, null, value, { master: true }));
    }

    // Stop current timer (if any)
    clearTimeout(this.masterPresenceSensorTriggeredTimer);

    // Evaluate what to do
    if (value) {
      // Update immediately
      updateSensor(value, false);
    } else {
      // Set a timer to apply the change
      this.masterPresenceSensorTriggeredTimer = setTimeout(
        () => updateSensor(value, true),
        this.masterPresenceOffDelay,
      );
    }
  }

  handleTriggerEvent(zoneId, triggerId, value, notifyHomekit = false) {
    // Update trigger
    this.updateTrigger(zoneId, triggerId, value, notifyHomekit);

    // Update zone
    this.updateZone(zoneId);

    // Update master service
    this.updateMaster();
  }

  resetExpiredTriggers() {
    forEach(this.zones, ({ id: zoneId, name: zoneName, triggers }) => {
      forEach(triggers, ({ id: triggerId, name: triggerName, resetAt }) => {
        if (resetAt && moment().isAfter(resetAt)) {
          this.homebridgeLog(`Zone "${zoneName}" - Trigger "${triggerName}" - Expired. Resetting...`);
          debug(`resetExpiredTriggers() - Zone ID: ${zoneId} - Trigger ID: ${triggerId} - Expired; resetting...`);
          this.handleTriggerEvent(zoneId, triggerId, 0, true);
        }
      });
    });

    setTimeout(() => this.resetExpiredTriggers(), 1000);
  }

  getServices() {
    return this.services;
  }
}

module.exports = (homebridge) => {
  Service = homebridge.hap.Service; // eslint-disable-line
  Characteristic = homebridge.hap.Characteristic; // eslint-disable-line
  UUIDGen = homebridge.hap.uuid; // eslint-disable-line
  storagePath = homebridge.user.storagePath(); // eslint-disable-line

  FakeGatoHistoryService = fakegatoHistory(homebridge);
  homebridge.registerAccessory('homebridge-automation-presence', 'AutomationPresence', AutomationPresence);
};
