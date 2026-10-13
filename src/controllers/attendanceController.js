const asyncHandler = require('../utils/asyncHandler');
const svc = require('../services/attendanceService');

exports.get = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await svc.sheet(req.auth, req.query) });
});
exports.save = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await svc.bulkMark(req.auth, req.body) });
});
