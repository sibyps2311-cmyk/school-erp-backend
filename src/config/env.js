require('dotenv').config();

const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT) || 5000,
  mongoUri: process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/school_erp?replicaSet=rs0',
  jwtSecret: process.env.JWT_SECRET,
  sessionHours: Number(process.env.SESSION_HOURS) || 8,
  cookieSecure: process.env.COOKIE_SECURE === 'true',
  clientOrigin: process.env.CLIENT_ORIGIN || 'http://localhost:5173',
  timezone: process.env.SCHOOL_TIMEZONE || 'Asia/Kolkata',
};

if (!env.jwtSecret || env.jwtSecret === 'change-me') {
  if (env.nodeEnv === 'test') env.jwtSecret = 'test-only-secret';
  else if (env.nodeEnv === 'production') throw new Error('JWT_SECRET must be set');
  else env.jwtSecret = 'dev-only-insecure-secret';
}

module.exports = env;
