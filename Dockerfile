FROM node:18-alpine

WORKDIR /app

# 複製整個專案
COPY . .

# 安裝後端依賴
RUN cd backend && npm install --production

EXPOSE 3000

CMD ["node", "backend/server.js"]
