/**
 * 前台：場地 Routes
 * GET /api/studios
 * GET /api/studios/:id
 */
const router      = require('express').Router();
const StudioModel = require('../models/StudioModel');

// 取得所有場地
router.get('/', async (req, res, next) => {
  try {
    const studios = await StudioModel.findAll();
    res.json({ success: true, data: studios });
  } catch (err) { next(err); }
});

// 取得單一場地
router.get('/:id', async (req, res, next) => {
  try {
    const studio = await StudioModel.findById(req.params.id);
    if (!studio) return res.status(404).json({ success: false, message: '找不到此場地' });
    res.json({ success: true, data: studio });
  } catch (err) { next(err); }
});

module.exports = router;
