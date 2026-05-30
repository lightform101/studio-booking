/**
 * 預約 Model
 */
const { pool } = require('../config/database');
const dayjs    = require('dayjs');

const BookingModel = {

  // 讀取付款鎖定分鐘數（優先 DB settings > env > 預設 120）
  async _getLockMinutes(conn) {
    let lockMinutes = parseInt(process.env.BOOKING_LOCK_MINUTES || 120);
    try {
      const [[row]] = await (conn || pool).query(
        "SELECT key_value FROM settings WHERE key_name='booking_lock_minutes'"
      );
      if (row?.key_value) lockMinutes = parseInt(row.key_value);
    } catch(e) {}
    return lockMinutes;
  },

  // 前台建立預約：transaction + SELECT FOR UPDATE 防並發雙重預約
  async createWithLock(data) {
    const conn = await pool.getConnection();
    await conn.beginTransaction();
    try {
      // 悲觀鎖：鎖定同場地同日所有佔用中的時段列
      const [occupied] = await conn.query(
        `SELECT start_time, end_time FROM bookings
         WHERE studio_id = ? AND booking_date = ?
         AND status IN ('pending_payment','confirmed')
         FOR UPDATE`,
        [data.studio_id, data.booking_date]
      );

      // 衝突判斷
      const startH = parseInt(String(data.start_time).split(':')[0]);
      const endH   = parseInt(String(data.end_time).split(':')[0]);
      const conflict = occupied.some(o => {
        const oS = parseInt(o.start_time);
        const oE = parseInt(o.end_time);
        return !(endH <= oS || startH >= oE);
      });
      if (conflict) {
        const err = new Error('所選時段已被預約，請選擇其他時段');
        err.code = 'CONFLICT';
        throw err;
      }

      // 計算付款截止時間
      const lockMinutes = await this._getLockMinutes(conn);
      const payment_expire = dayjs().add(lockMinutes, 'minute').format('YYYY-MM-DD HH:mm:ss');

      // INSERT：用暫時唯一訂單號佔位，INSERT 後再以 id 生成正式號
      // 格式：T-xxxxxxxxxxxxxxx（不超過 18 碼，避免超出 booking_no 欄位限制）
      const tmpNo = `T-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
      const [result] = await conn.query(
        `INSERT INTO bookings
         (booking_no, studio_id, contact_name, contact_phone, contact_email,
          purpose, note, booking_date, start_time, end_time, duration_hours,
          unit_price, total_amount, discount_amount, promo_id, payment_expire,
          need_invoice, invoice_type, invoice_carrier,
          invoice_tax_id, invoice_company, invoice_donate)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          tmpNo,
          data.studio_id, data.contact_name, data.contact_phone, data.contact_email,
          data.purpose || null, data.note || null,
          data.booking_date, data.start_time, data.end_time, data.duration_hours,
          data.unit_price, data.total_amount,
          data.discount_amount || 0, data.promo_id || null,
          payment_expire,
          data.need_invoice ? 1 : 0,
          data.invoice_type || null, data.invoice_carrier || null,
          data.invoice_tax_id || null, data.invoice_company || null,
          data.invoice_donate || null
        ]
      );

      // 用 AUTO_INCREMENT id 生成無碰撞訂單號 SS-YYYYMMDD-NNNNN
      const today      = dayjs().format('YYYYMMDD');
      const booking_no = `SS-${today}-${String(result.insertId).padStart(5, '0')}`;
      await conn.query('UPDATE bookings SET booking_no=? WHERE id=?', [booking_no, result.insertId]);

      await conn.commit();

      // 回傳完整記錄（含 studio_name）
      const [[booking]] = await conn.query(
        `SELECT b.*, s.name AS studio_name, s.name_en AS studio_name_en
         FROM bookings b JOIN studios s ON b.studio_id = s.id WHERE b.id = ?`,
        [result.insertId]
      );
      return booking;
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  },

  // 後台建立預約（不做衝突鎖，供管理員手動新增用）
  async create(data) {
    const lockMinutes = await this._getLockMinutes();
    const payment_expire = dayjs().add(lockMinutes, 'minute').format('YYYY-MM-DD HH:mm:ss');

    const tmpNo = `TMP-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const [result] = await pool.query(
      `INSERT INTO bookings
       (booking_no, studio_id, contact_name, contact_phone, contact_email,
        purpose, note, booking_date, start_time, end_time, duration_hours,
        unit_price, total_amount, payment_expire,
        need_invoice, invoice_type, invoice_carrier,
        invoice_tax_id, invoice_company, invoice_donate)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        tmpNo,
        data.studio_id, data.contact_name, data.contact_phone, data.contact_email,
        data.purpose || null, data.note || null,
        data.booking_date, data.start_time, data.end_time, data.duration_hours,
        data.unit_price, data.total_amount, payment_expire,
        data.need_invoice ? 1 : 0,
        data.invoice_type || null, data.invoice_carrier || null,
        data.invoice_tax_id || null, data.invoice_company || null,
        data.invoice_donate || null
      ]
    );
    const today      = dayjs().format('YYYYMMDD');
    const booking_no = `SS-${today}-${String(result.insertId).padStart(5, '0')}`;
    await pool.query('UPDATE bookings SET booking_no=? WHERE id=?', [booking_no, result.insertId]);
    return this.findById(result.insertId);
  },

  // 依訂單號查詢
  async findByNo(booking_no) {
    const [[booking]] = await pool.query(
      `SELECT b.*, s.name AS studio_name, s.name_en AS studio_name_en
       FROM bookings b
       JOIN studios s ON b.studio_id = s.id
       WHERE b.booking_no = ?`,
      [booking_no]
    );
    return booking || null;
  },

  // 依 ID 查詢
  async findById(id) {
    const [[booking]] = await pool.query(
      `SELECT b.*, s.name AS studio_name, s.name_en AS studio_name_en
       FROM bookings b
       JOIN studios s ON b.studio_id = s.id
       WHERE b.id = ?`,
      [id]
    );
    return booking || null;
  },

  // 後台列表查詢（含篩選 / 分頁）
  async findAll({ studio_id, status, date_from, date_to, search, page = 1, limit = 20 } = {}) {
    let where = ['1=1'];
    const params = [];

    if (studio_id) { where.push('b.studio_id = ?'); params.push(studio_id); }
    if (status)    { where.push('b.status = ?');    params.push(status); }
    if (date_from) { where.push('b.booking_date >= ?'); params.push(date_from); }
    if (date_to)   { where.push('b.booking_date <= ?'); params.push(date_to); }
    if (search) {
      where.push('(b.booking_no LIKE ? OR b.contact_name LIKE ? OR b.contact_phone LIKE ? OR b.contact_email LIKE ?)');
      const s = `%${search}%`;
      params.push(s, s, s, s);
    }

    const whereStr = where.join(' AND ');
    const offset   = (page - 1) * limit;

    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) AS total FROM bookings b WHERE ${whereStr}`, params
    );
    const [rows] = await pool.query(
      `SELECT b.*, s.name AS studio_name FROM bookings b
       JOIN studios s ON b.studio_id = s.id
       WHERE ${whereStr}
       ORDER BY b.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    return { total, page, limit, data: rows };
  },

  // 查詢指定場地 / 日期的已佔用時段
  async findOccupiedSlots(studio_id, date) {
    const [rows] = await pool.query(
      `SELECT start_time, end_time FROM bookings
       WHERE studio_id = ? AND booking_date = ?
       AND status IN ('pending_payment','confirmed')`,
      [studio_id, date]
    );
    return rows;
  },

  // 更新付款狀態
  async confirmPayment(booking_no, { payment_method, payment_trade_no, payment_ref }) {
    await pool.query(
      `UPDATE bookings SET
       status = 'confirmed',
       payment_method = ?, payment_at = NOW(),
       payment_trade_no = ?, payment_ref = ?
       WHERE booking_no = ?`,
      [payment_method, payment_trade_no, payment_ref, booking_no]
    );
    return this.findByNo(booking_no);
  },

  // 更新發票資訊
  async updateInvoice(booking_no, { invoice_no, invoice_random }) {
    await pool.query(
      `UPDATE bookings SET invoice_no=?, invoice_random=?, invoice_at=NOW()
       WHERE booking_no=?`,
      [invoice_no, invoice_random, booking_no]
    );
  },

  // 取消預約
  async cancel(booking_no, { cancel_reason, cancelled_by, refund_amount, refund_trade_no }) {
    await pool.query(
      `UPDATE bookings SET
       status = 'cancelled',
       cancel_reason = ?, cancel_at = NOW(), cancelled_by = ?,
       refund_amount = ?, refund_trade_no = ?, refund_at = ?
       WHERE booking_no = ?`,
      [
        cancel_reason, cancelled_by,
        refund_amount, refund_trade_no,
        refund_amount > 0 ? new Date() : null,
        booking_no
      ]
    );
    return this.findByNo(booking_no);
  },

  // 取消超時未付款預約（系統排程用）
  async cancelExpired() {
    const [result] = await pool.query(
      `UPDATE bookings SET
       status='cancelled', cancel_reason='超時未付款自動取消',
       cancel_at=NOW(), cancelled_by='system'
       WHERE status='pending_payment' AND payment_expire < NOW()`
    );
    return result.affectedRows;
  },

  // 將昨日已完成的預約標記為 completed
  async markCompleted() {
    const yesterday = dayjs().subtract(1, 'day').format('YYYY-MM-DD');
    const [result] = await pool.query(
      `UPDATE bookings SET status='completed', updated_at=NOW()
       WHERE status='confirmed' AND booking_date <= ?`,
      [yesterday]
    );
    return result.affectedRows;
  },

  // 更新後台備注
  async updateAdminNote(id, admin_note) {
    await pool.query('UPDATE bookings SET admin_note=? WHERE id=?', [admin_note, id]);
  },

  // 後台編輯預約（全欄位更新）
  async update(id, data) {
    const fields = [];
    const params = [];
    const allow = [
      'studio_id','contact_name','contact_phone','contact_email',
      'booking_date','start_time','end_time','duration_hours',
      'unit_price','total_amount','payment_method',
      'purpose','note','admin_note','status'
    ];
    allow.forEach(k => {
      if (data[k] !== undefined) { fields.push(`${k}=?`); params.push(data[k]); }
    });
    if (!fields.length) return this.findById(id);
    fields.push('updated_at=NOW()');
    params.push(id);
    await pool.query(`UPDATE bookings SET ${fields.join(',')} WHERE id=?`, params);
    return this.findById(id);
  },

  // ─── 收入統計 ─────────────────────────────────
  async getMonthlyRevenue(months = 6) {
    const [rows] = await pool.query(
      `SELECT
         DATE_FORMAT(booking_date, '%Y-%m') AS month,
         studio_id,
         COUNT(*) AS count,
         SUM(total_amount) AS revenue
       FROM bookings
       WHERE status IN ('confirmed','completed')
         AND booking_date >= DATE_SUB(CURDATE(), INTERVAL ? MONTH)
       GROUP BY month, studio_id
       ORDER BY month ASC`,
      [months]
    );
    return rows;
  },

  async getDashboardStats() {
    const [[monthly]] = await pool.query(
      `SELECT COUNT(*) AS bookings, IFNULL(SUM(total_amount),0) AS revenue
       FROM bookings
       WHERE status IN ('confirmed','completed')
         AND MONTH(booking_date)=MONTH(CURDATE())
         AND YEAR(booking_date)=YEAR(CURDATE())`
    );
    const [[pending]] = await pool.query(
      `SELECT COUNT(*) AS cnt FROM bookings WHERE status='pending_payment'`
    );
    return { monthly_bookings: monthly.bookings, monthly_revenue: monthly.revenue,
             pending_payment: pending.cnt };
  }
};

module.exports = BookingModel;
