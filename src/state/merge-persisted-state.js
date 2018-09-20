const { cloneDeep, forOwn } = require('lodash');

const isTriggeredReducer = require('./is-triggered-reducer');

module.exports = (persistedState, newState) => {
  const state = cloneDeep(newState);

  forOwn(state, (zoneDetails, zoneId) => {
    // If the zone was persisted before
    if (persistedState[zoneId] && persistedState[zoneId].triggers) {
      forOwn(zoneDetails.triggers, (triggerDetails, triggerId) => {
        // If the trigger was persisted before
        if (persistedState[zoneId].triggers[triggerId]) {
          state[zoneId].triggers[triggerId].triggered =
            persistedState[zoneId].triggers[triggerId].triggered;
        }
      });
    }

    state[zoneId].triggered = isTriggeredReducer(state[zoneId].triggers);
  });

  return state;
};
