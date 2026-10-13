const mongoose = require('mongoose');
const AppError = require('./AppError');

const HEX = /^[0-9a-fA-F]{24}$/;
const isId = (v) => typeof v === 'string' && HEX.test(v);

function toId(v, label = 'id') {
  if (!isId(String(v))) throw new AppError(400, `Invalid ${label}`, 'INVALID_ID');
  return new mongoose.Types.ObjectId(String(v));
}

module.exports = { isId, toId };
