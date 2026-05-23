module.exports = function requireSuperAdmin(req, res, next) {
  if (req.admin.role !== 'superadmin')
    return res.status(403).json({ success: false, message: '此操作需要超級管理員權限' });
  next();
};
