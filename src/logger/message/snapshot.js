module.exports =
  (snapshot, extra) => (
    {
      type: 'snapshot',
      snapshot,
      ...extra,
    }
  );
