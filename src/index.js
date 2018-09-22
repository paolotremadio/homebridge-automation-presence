const { forEach, values } = require('lodash');
const fakegatoHistory = require('fakegato-history');
const logger = require('homeautomation-winston-logger');

const logEvent = require('./logger/message/event');
const initState = require('./state/init');
const statePersist = require('./state/persist');
const mergePersisted = require('./state/merge-persisted-state');
const isTriggeredReducer = require('./state/is-triggered-reducer');

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

    this.services = this.createServices();
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

  updateTrigger(zoneId, triggerId, value) {
    const zone = zoneId && this.zones[zoneId];
    const trigger = zone && triggerId && this.zones[zoneId].triggers[triggerId];

    if (trigger.triggered !== value) {
      trigger.triggered = value;

      const eventExtras = {
        zoneName: zone.name,
        triggerName: trigger.name,
      };

      this.logger.info(logEvent(zoneId, triggerId, value, eventExtras));
      this.persistState();
    }
  }

  updateZone(zoneId) {
    const value = isTriggeredReducer(this.zones[zoneId].triggers);
    const zone = zoneId && this.zones[zoneId];

    if (zone.triggered !== value) {
      zone.triggered = value;

      this.zoneServices[zoneId]
        .getCharacteristic(Characteristic.MotionDetected)
        .updateValue(value);

      this.logger.info(logEvent(zoneId, null, value, { zoneName: zone.name }));
      this.persistState();
    }
  }

  updateMaster() {
    const value = isTriggeredReducer(this.zones);

    const updateSensor = (status) => {
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

    if (value) {
      // Update immediately
      updateSensor(value);

      // Stop the timer (if any)
      if (this.masterPresenceSensorTriggeredTimer) {
        clearTimeout(this.masterPresenceSensorTriggeredTimer);
      }
    } else {
      // Set a timer to apply the change
      this.masterPresenceSensorTriggeredTimer = setTimeout(
        () => updateSensor(value),
        this.masterPresenceOffDelay,
      );
    }
  }

  handleTriggerEvent(zoneId, triggerId, value) {
    // Update trigger
    this.updateTrigger(zoneId, triggerId, value);

    // Update zone
    this.updateZone(zoneId);

    // Update master service
    this.updateMaster();
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
