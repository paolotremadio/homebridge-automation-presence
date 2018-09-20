const winston = require('winston');

module.exports = (logFile, debugMode) =>
  winston.createLogger({
    level: 'info',
    format: winston.format.combine(
      winston.format.timestamp({
        format: 'YYYY-MM-DD HH:mm:ss.SSSS',
      }),
      winston.format.json(),
    ),
    transports: [
      new winston.transports.File({ filename: logFile, level: 'info' }),
      debugMode ? new winston.transports.Console({ level: 'debug' }) : false,
    ].filter(x => x),
  });
