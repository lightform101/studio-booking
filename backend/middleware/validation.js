/**
 * 輸入驗證 Middleware（express-validator）
 */
const { validationResult } = require('express-validator');

// 統一回傳驗證錯誤
function validate(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(422).json({
      success: false,
      message: '輸入資料有誤',
      errors: errors.array().map(e => ({ field: e.path, message: e.msg }))
    });
  }
  next();
}

// 預約建立驗證規則
const { body } = require('express-validator');

const bookingRules = [
  body('studio_id').isInt({ min: 1 }).withMessage('請選擇場地'),
  body('booking_date').isDate().withMessage('請輸入有效日期')
    .custom((val, { req }) => {
      // 將日期字串解析為本地時間（避免 new Date('YYYY-MM-DD') 當成 UTC 導致時差 -8 小時）
      const [year, month, day] = val.split('-').map(Number);
      const start_time = req.body.start_time || '00:00';
      const [hour, minute] = start_time.split(':').map(Number);
      const bookingDt = new Date(year, month - 1, day, hour, minute, 0); // 本地時間

      const advanceHours = parseInt(process.env.MIN_ADVANCE_HOURS || 24);
      const minAllowed = new Date(Date.now() + advanceHours * 60 * 60 * 1000);

      if (bookingDt < minAllowed) {
        throw new Error(`請至少提前 ${advanceHours} 小時預約`);
      }
      return true;
    }),
  body('start_time').matches(/^\d{2}:\d{2}$/).withMessage('請輸入有效開始時間'),
  body('duration_hours').isFloat({ min: 2, max: 8 }).withMessage('使用時數需介於 2–8 小時'),
  body('contact_name').notEmpty().withMessage('請輸入姓名').isLength({ max: 100 }),
  body('contact_phone').matches(/^09\d{8}$/).withMessage('請輸入有效手機號碼'),
  body('contact_email').isEmail().withMessage('請輸入有效 Email'),
  body('invoice_tax_id').optional().isLength({ min: 8, max: 8 }).isNumeric()
    .withMessage('統一編號須為 8 碼數字'),
  body('invoice_carrier').optional()
    .matches(/^\/[A-Z0-9+\-.]{7}$/).withMessage('手機條碼格式不正確（/XXXXXXX）')
];

module.exports = { validate, bookingRules };
