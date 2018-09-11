/* eslint-disable no-param-reassign */
const { keyBy } = require('lodash');

const decorate = (array, uuidGenerator) =>
  array.map((el) => {
    el.id = uuidGenerator(el.name);
    el.triggered = 0;
    return el;
  });

const idAsKey = array =>
  keyBy(array, el => el.id);

module.exports = (zones, uuidGenerator) => {
  const zonesWithId = decorate(zones, uuidGenerator);

  return idAsKey(zonesWithId.map((zone) => {
    zone.triggers = idAsKey(decorate(zone.triggers, uuidGenerator));
    return zone;
  }));
};
