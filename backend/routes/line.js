/**
 * 公開：LINE Webhook
 * POST /api/line/webhook  接收 LINE 事件（加好友 / 傳訊息）
 *   - 驗證簽章
 *   - 記錄 userId 與顯示名稱到 line_contacts（供後台設為通知對象）
 *   - 對訊息事件回覆確認
 */
const router    = require('express').Router();
const LineSvc   = require('../services/lineService');
const { pool }  = require('../config/database');

router.post('/webhook', async (req, res) => {
  // LINE 需要即時回 200；其餘處理非同步進行
  res.status(200).end();

  try {
    const cfg = await LineSvc._getConfig();
    const signature = req.get('x-line-signature');
    const rawBody = req.rawBody || Buffer.from(JSON.stringify(req.body || {}), 'utf8');

    // 驗證簽章（未設定 secret 時略過驗證，仍可運作但較不安全）
    if (cfg.secret && !LineSvc.verifySignature(rawBody, signature, cfg.secret)) {
      console.warn('[LINE] webhook 簽章驗證失敗');
      return;
    }

    const events = (req.body && req.body.events) || [];
    for (const ev of events) {
      const userId = ev.source && ev.source.userId;
      if (!userId) continue;

      // 取得顯示名稱並記錄聯絡人
      let displayName = null;
      try {
        const profile = await LineSvc.getProfile(userId, cfg.token);
        displayName = profile.displayName || null;
      } catch (e) { /* 取名稱失敗不影響 */ }

      await pool.query(
        `INSERT INTO line_contacts (user_id, display_name)
         VALUES (?, ?)
         ON DUPLICATE KEY UPDATE display_name = VALUES(display_name)`,
        [userId, displayName]
      );

      // 首次加好友或傳訊息 → 回覆引導
      if (ev.type === 'follow') {
        await LineSvc.reply(ev.replyToken,
          '感謝加入 LightForm Studio！\n若您是管理員，請到後台「LINE 通知」把自己設為通知對象，即可收到新預約提醒。', cfg.token
        ).catch(() => {});
      } else if (ev.type === 'message') {
        await LineSvc.reply(ev.replyToken,
          '✅ 已記錄您的 LINE。\n若您是管理員，請到後台「LINE 通知」將此帳號設為通知對象。', cfg.token
        ).catch(() => {});
      }
    }
  } catch (err) {
    console.error('[LINE] webhook 處理錯誤:', err.message);
  }
});

module.exports = router;
