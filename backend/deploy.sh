#!/bin/bash
# =============================================
# Studio Space 部署腳本（Ubuntu 22.04）
# 執行方式: chmod +x deploy.sh && sudo ./deploy.sh
# =============================================
set -e

echo "🚀 Studio Space 部署開始..."

# ─── 1. 安裝 Node.js 20 ───────────────────────
echo "📦 安裝 Node.js 20..."
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# ─── 2. 安裝 MySQL 8 ─────────────────────────
echo "🗄️  安裝 MySQL 8..."
sudo apt-get install -y mysql-server
sudo systemctl start mysql
sudo systemctl enable mysql

# ─── 3. 安裝 Nginx ───────────────────────────
echo "🌐 安裝 Nginx..."
sudo apt-get install -y nginx

# ─── 4. 安裝 PM2 ─────────────────────────────
echo "⚙️  安裝 PM2..."
sudo npm install -g pm2

# ─── 5. 安裝專案依賴 ─────────────────────────
echo "📦 安裝 npm 依賴..."
cd /var/www/studio-booking/backend
npm install --production

# ─── 6. 設定環境變數 ─────────────────────────
if [ ! -f .env ]; then
  cp .env.example .env
  echo "⚠️  請編輯 .env 填入實際設定值：nano .env"
fi

# ─── 7. 執行資料庫 Migration ─────────────────
echo "🗄️  執行資料庫 Migration..."
node migrations/run.js

# ─── 8. Nginx 設定 ───────────────────────────
echo "🌐 設定 Nginx..."
cat > /etc/nginx/sites-available/studio-booking << 'NGINX'
server {
    listen 80;
    server_name yourdomain.com www.yourdomain.com;

    # 靜態前台檔案
    root /var/www/studio-booking;
    index index.html;

    # API 反向代理
    location /api/ {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    # 所有其他請求回傳 index.html（SPA）
    location / {
        try_files $uri $uri/ /index.html;
    }

    # gzip 壓縮
    gzip on;
    gzip_types text/plain text/css application/json application/javascript;
}
NGINX

sudo ln -sf /etc/nginx/sites-available/studio-booking /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

# ─── 9. 申請 SSL 憑證 ────────────────────────
echo "🔐 申請 SSL 憑證..."
sudo apt-get install -y certbot python3-certbot-nginx
echo "請手動執行：sudo certbot --nginx -d yourdomain.com"

# ─── 10. 啟動服務 ─────────────────────────────
echo "🚀 啟動後端服務..."
pm2 start server.js --name studio-booking --env production
pm2 startup
pm2 save

echo ""
echo "✅ 部署完成！"
echo "📝 請完成以下步驟："
echo "   1. 編輯 .env 填入所有金鑰：nano /var/www/studio-booking/backend/.env"
echo "   2. 申請 SSL：sudo certbot --nginx -d yourdomain.com"
echo "   3. 重啟服務：pm2 restart studio-booking"
