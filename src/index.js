const { forEach, values } = require('lodash');
const fakegatoHistory = require('fakegato-history');

const logger = require('./logger');
const logEvent = require('./logger/message/event');
const initState = require('./state/init');
const triggerCharacteristic = require('./homekit/trigger-characteristic');
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
    this.zones = initState(config.zones, UUIDGen.generate);

    this.logger = logger;

    this.logger.debug('Service started');

    this.services = this.createServices();
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

      // Add triggers
      forEach(zone.triggers, (trigger) => {
        const { id: triggerId, name: triggerName } = trigger;

        const active = triggerCharacteristic(triggerName, triggerId);

        sensor
          .addCharacteristic(active)
          .on('get', callback => callback(null, trigger.triggered))
          .on('set', (on, callback) => {
            this.handleTriggerEvent(zoneId, triggerId, on ? 1 : 0);
            callback();
          });

        this.zoneTriggers[triggerId] = active;
      });

      // Add to the list
      this.zoneServices[zoneId] = sensor;
    });

    return [...values(this.zoneServices), ...values(this.zoneHistoryServices)];
  }

  getMasterPresenceSensor() {
    this.masterPresenceSensorTriggered = 0;
    this.masterPresenceSensor = new Service.MotionSensor(
      `${this.name} (master)`,
      'master',
    );

    this.masterPresenceSensor
      .on('get', callback => callback(null, this.masterPresenceSensorTriggered));

    // Add history
    this.masterPresenceSensorHistory = new FakeGatoHistoryService(
      'motion',
      this.masterPresenceSensor,
      {
        storage: 'fs',
        path: `${storagePath}/accessories`,
        filename: `history_presence_master_${UUIDGen.generate(this.name)}.json`,
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
    }
  }

  updateZone(zoneId, value) {
    const zone = zoneId && this.zones[zoneId];

    if (zone.triggered !== value) {
      zone.triggered = value;

      this.zoneServices[zoneId]
        .getCharacteristic(Characteristic.MotionDetected)
        .updateValue(value);

      this.logger.info(logEvent(zoneId, null, value, { zoneName: zone.name }));
    }
  }

  updateMaster(value) {
    if (this.masterPresenceSensorTriggered !== value) {
      this.masterPresenceSensorTriggered = value;
      this.masterPresenceSensor
        .getCharacteristic(Characteristic.MotionDetected)
        .updateValue(value);

      this.masterPresenceSensor.log = this.homebridgeLog;

      this.masterPresenceSensorHistory
        .addEntry({ time: new Date().getTime(), status: value });

      this.logger.info(logEvent(null, null, value, { master: true }));
    }
  }

  handleTriggerEvent(zoneId, triggerId, value) {
    // Update trigger
    this.updateTrigger(zoneId, triggerId, value);

    // Update zone
    const zoneTriggered = isTriggeredReducer(this.zones[zoneId].triggers);
    this.updateZone(zoneId, zoneTriggered);

    // Update master service
    const masterTriggered = isTriggeredReducer(this.zones);
    this.updateMaster(masterTriggered);
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
