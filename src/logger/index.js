const winston = require('winston');

module.exports = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp({
      format: 'YYYY-MM-DD HH:mm:ss.SSSS',
    }),
    winston.format.json(),
  ),
  transports: [
    new winston.transports.File({ filename: 'info.log', level: 'info' }),
    new winston.transports.Console({ level: 'debug' }),
  ],
});
