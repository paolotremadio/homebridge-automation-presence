const { forEach } = require('lodash');

module.exports = (elements) => {
  let isTriggered = 0;

  forEach(elements, (el) => {
    if (el.triggered) {
      isTriggered = 1;
    }
  });

  return isTriggered;
};
