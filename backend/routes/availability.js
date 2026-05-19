/**
 * 前台：可用時段查詢
 * GET /api/availability?studio_id=1&date=2026-04-05
 */
const router       = require('express').Router();
const BookingModel = require('../models/BookingModel');
const StudioModel  = require('../models/StudioModel');
const { pool }     = require('../config/database');
const dayjs        = require('dayjs');

router.get('/', async (req, res, next) => {
  try {
    const { studio_id, date } = req.query;
    if (!studio_id || !date)
      return res.status(400).json({ success: false, message: '請提供 studio_id 與 date' });

    const studio = await StudioModel.findById(studio_id);
    if (!studio) return res.status(404).json({ success: false, message: '找不到此場地' });

    // 取得該日封鎖時段
    const [blocked] = await pool.query(
      `SELECT start_time, end_time FROM blocked_dates
       WHERE (studio_id = ? OR studio_id IS NULL) AND block_date = ?`,
      [studio_id, date]
    );

    // 若整天封鎖（start_time IS NULL）
    const allDayBlocked = blocked.some(b => !b.start_time);

    // 取得該日已預約時段
    const occupied = await BookingModel.findOccupiedSlots(studio_id, date);

    // 產生可用時段清單（08:00 – 20:00，每小時一格）
    const dayOfWeek = dayjs(date).day();
    const [[bh]] = await pool.query(
      `SELECT open_time, close_time, is_open FROM business_hours
       WHERE weekday=? AND (studio_id=? OR studio_id IS NULL)
       ORDER BY studio_id DESC LIMIT 1`,
      [dayOfWeek, studio_id]
    );

    if (!bh || !bh.is_open || allDayBlocked) {
      return res.json({ success: true, data: {
        date, studio_id: parseInt(studio_id),
        available_slots: [], booked_slots: [], message: '此日期不開放預約'
      }});
    }

    const openH  = parseInt(bh.open_time);
    const closeH = parseInt(bh.close_time);

    function isOccupied(h) {
      return occupied.some(o => {
        const s = parseInt(o.start_time);
        const e = parseInt(o.end_time);
        return h >= s && h < e;
      }) || blocked.some(b => {
        if (!b.start_time) return true;
        const s = parseInt(b.start_time);
        const e = parseInt(b.end_time);
        return h >= s && h < e;
      });
    }

    const available_slots = [], booked_slots = [];
    for (let h = openH; h < closeH; h++) {
      const slot = `${String(h).padStart(2,'0')}:00`;
      if (isOccupied(h)) booked_slots.push(slot);
      else available_slots.push(slot);
    }

    res.json({ success: true, data: {
      date, studio_id: parseInt(studio_id),
      available_slots, booked_slots
    }});
  } catch (err) { next(err); }
});

module.exports = router;
