const { Characteristic } = require('hap-nodejs');

module.exports = (label, uuid) => {
  const trigger = function () {
    const char = new Characteristic(label, uuid);

    char.setProps({
      format: Characteristic.Formats.BOOL,
      perms: [Characteristic.Perms.READ, Characteristic.Perms.WRITE, Characteristic.Perms.NOTIFY],
    });
    char.value = char.getDefaultValue();

    return char;
  };
  trigger.UUID = uuid;

  return trigger;
};
