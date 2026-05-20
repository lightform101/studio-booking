/**
 * 場地 Model
 */
const { pool } = require('../config/database');

const StudioModel = {

  // 載入場地照片（內部使用）
  async _loadImages(studioId) {
    const [images] = await pool.query(
      'SELECT id, url, alt_text, sort_order, is_main FROM studio_images WHERE studio_id=? ORDER BY sort_order ASC, id ASC',
      [studioId]
    );
    return images;
  },

  // 取得所有啟用中的場地（含設備 + 照片）
  async findAll() {
    const [studios] = await pool.query(
      'SELECT * FROM studios WHERE is_active = TRUE ORDER BY sort_order ASC'
    );
    for (const studio of studios) {
      const [features] = await pool.query(
        'SELECT feature FROM studio_features WHERE studio_id = ?',
        [studio.id]
      );
      studio.features = features.map(f => f.feature);
      studio.images   = await this._loadImages(studio.id);
    }
    return studios;
  },

  // 取得單一場地（含照片）
  async findById(id) {
    const [[studio]] = await pool.query(
      'SELECT * FROM studios WHERE id = ? AND is_active = TRUE',
      [id]
    );
    if (!studio) return null;
    const [features] = await pool.query(
      'SELECT feature FROM studio_features WHERE studio_id = ?',
      [id]
    );
    studio.features = features.map(f => f.feature);
    studio.images   = await this._loadImages(id);
    return studio;
  },

  // 取得場地（含非啟用 + 照片，後台用）
  async findByIdAdmin(id) {
    const [[studio]] = await pool.query(
      'SELECT * FROM studios WHERE id = ?', [id]
    );
    if (!studio) return null;
    const [features] = await pool.query(
      'SELECT feature FROM studio_features WHERE studio_id = ?', [id]
    );
    studio.features = features.map(f => f.feature);
    studio.images   = await this._loadImages(id);
    return studio;
  },

  // 新增場地
  async create(data) {
    const { name, name_en, description, hourly_rate, photo_rate, video_rate,
            min_hours, max_hours, capacity, size_sqm, features } = data;

    // 取得目前最大 sort_order
    const [[maxRow]] = await pool.query('SELECT IFNULL(MAX(sort_order),0)+1 AS next FROM studios');
    const sortOrder  = maxRow.next || 1;

    const [result] = await pool.query(
      `INSERT INTO studios (name, name_en, description, hourly_rate, photo_rate, video_rate,
       min_hours, max_hours, capacity, size_sqm, sort_order, is_active)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,TRUE)`,
      [name, name_en || '', description || '', hourly_rate || 800,
       photo_rate || null, video_rate || null,
       min_hours || 2, max_hours || 8, capacity || 10, size_sqm || 0, sortOrder]
    );
    const newId = result.insertId;

    if (features && Array.isArray(features) && features.length > 0) {
      const values = features.map(f => [newId, f]);
      await pool.query('INSERT INTO studio_features (studio_id, feature) VALUES ?', [values]);
    }
    return this.findByIdAdmin(newId);
  },

  // 刪除場地
  async delete(id) {
    // 確認沒有進行中或已確認的預約
    const [[row]] = await pool.query(
      `SELECT COUNT(*) AS cnt FROM bookings
       WHERE studio_id=? AND status IN ('pending_payment','confirmed')`, [id]
    );
    if (row.cnt > 0) throw new Error(`此場地尚有 ${row.cnt} 筆有效預約，無法刪除`);

    await pool.query('DELETE FROM studios WHERE id=?', [id]);
    return true;
  },

  // 更新場地
  async update(id, data) {
    const { name, name_en, description, hourly_rate, photo_rate, video_rate,
            min_hours, max_hours, capacity, size_sqm, is_active, features,
            ttlock_lock_id } = data;
    // 主要欄位更新
    await pool.query(
      `UPDATE studios SET name=?, name_en=?, description=?, hourly_rate=?,
       photo_rate=?, video_rate=?,
       min_hours=?, max_hours=?, capacity=?, size_sqm=?, is_active=?
       WHERE id=?`,
      [name, name_en, description, hourly_rate,
       photo_rate || null, video_rate || null,
       min_hours, max_hours, capacity, size_sqm, is_active, id]
    );
    // TTLock Lock ID（欄位可能尚未建立，獨立處理避免影響主儲存）
    if (ttlock_lock_id !== undefined) {
      try {
        await pool.query(
          `UPDATE studios SET ttlock_lock_id=? WHERE id=?`,
          [ttlock_lock_id || null, id]
        );
      } catch(e) {
        console.warn('[Studio] ttlock_lock_id 欄位尚未建立，請執行 Migration:', e.message);
      }
    }
    if (features && Array.isArray(features)) {
      await pool.query('DELETE FROM studio_features WHERE studio_id=?', [id]);
      if (features.length > 0) {
        const values = features.map(f => [id, f]);
        await pool.query(
          'INSERT INTO studio_features (studio_id, feature) VALUES ?',
          [values]
        );
      }
    }
    return this.findByIdAdmin(id);
  }
};

module.exports = StudioModel;
