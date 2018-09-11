module.exports =
  (zone, trigger, value, extra) => (
    {
      type: 'event',
      zone,
      trigger,
      value,
      ...extra,
    }
  );
