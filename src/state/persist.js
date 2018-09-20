const fs = require('fs');

const getPersistedState = (path) => {
  const fileContent = fs.readFileSync(path);
  return JSON.parse(fileContent);
};

const persistState = (path, state) => {
  fs.writeFileSync(
    path,
    JSON.stringify(state),
  );
};

module.exports = {
  getPersistedState,
  persistState,
};
