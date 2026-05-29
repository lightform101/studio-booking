/**
 * 預約時段合法性驗證
 * 檢查：min/max_hours、營業時間、封鎖日期（整天 & 時段）
 *
 * @param {Object} opts
 * @param {number}      opts.studio_id
 * @param {string}      opts.booking_date     YYYY-MM-DD
 * @param {string}      opts.start_time       HH:MM[:SS]
 * @param {string}      opts.end_time         HH:MM[:SS]
 * @param {number}      opts.duration_hours
 * @returns {Promise<{valid: boolean, message?: string}>}
 */
const { pool } = require('../config/database');
const dayjs    = require('dayjs');

async function validateSlot({ studio_id, booking_date, start_time, end_time, duration_hours }) {
  const startH = parseInt(String(start_time).split(':')[0]);
  const endH   = parseInt(String(end_time).split(':')[0]);

  // 1. 場地 min_hours / max_hours
  const [[studio]] = await pool.query(
    'SELECT min_hours, max_hours FROM studios WHERE id=?',
    [studio_id]
  );
  if (!studio) return { valid: false, message: '找不到此場地' };
  if (studio.min_hours && duration_hours < studio.min_hours)
    return { valid: false, message: `此場地最少需預約 ${studio.min_hours} 小時` };
  if (studio.max_hours && duration_hours > studio.max_hours)
    return { valid: false, message: `此場地最多可預約 ${studio.max_hours} 小時` };

  // 2. 營業時間
  const dayOfWeek = dayjs(booking_date).day();
  const [[bh]] = await pool.query(
    `SELECT open_time, close_time, is_open FROM business_hours
     WHERE weekday=? AND (studio_id=? OR studio_id IS NULL)
     ORDER BY studio_id DESC LIMIT 1`,
    [dayOfWeek, studio_id]
  );
  if (!bh || !bh.is_open)
    return { valid: false, message: '此日期不在營業時間內，無法預約' };

  const openH  = parseInt(bh.open_time);
  const closeH = parseInt(bh.close_time);
  if (startH < openH || endH > closeH) {
    const fmt = t => String(t).slice(0, 5);
    return { valid: false, message: `預約時段須在營業時間 ${fmt(bh.open_time)}–${fmt(bh.close_time)} 之內` };
  }

  // 3. 封鎖日期（整天 or 時段）
  const [blocked] = await pool.query(
    `SELECT start_time, end_time FROM blocked_dates
     WHERE (studio_id=? OR studio_id IS NULL) AND block_date=?`,
    [studio_id, booking_date]
  );
  if (blocked.some(b => !b.start_time))
    return { valid: false, message: '此日期已被封鎖，無法預約' };

  const blockedOverlap = blocked.some(b => {
    const bS = parseInt(b.start_time);
    const bE = parseInt(b.end_time);
    return !(endH <= bS || startH >= bE);
  });
  if (blockedOverlap)
    return { valid: false, message: '所選時段與封鎖時段重疊，無法預約' };

  return { valid: true };
}

module.exports = { validateSlot };
