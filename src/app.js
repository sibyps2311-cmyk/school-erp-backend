const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const env = require('./config/env');
const csrf = require('./middleware/csrf');
const routes = require('./routes');
const { notFound, errorHandler } = require('./middleware/errorHandler');

function createApp() {
  const app = express();
  // Render's load balancer is one proxy hop from the application. Trust only
  // that hop so req.ip (and express-rate-limit) uses the forwarded client IP.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.set('query parser', 'simple'); // no nested query objects => no operator injection through query strings
  app.use(helmet());
  app.use(cors({
    origin: env.clientOrigin, credentials: true,
    allowedHeaders: ['Content-Type', 'X-Requested-With', 'Idempotency-Key'],
    exposedHeaders: ['Content-Disposition'],
  }));
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());
  app.use('/api', csrf, routes);
  app.use(notFound);
  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
