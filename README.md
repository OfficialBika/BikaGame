# BIKA Pro Bot — Modular Production Build

## Setup
```bash
npm install
cp .env.example .env
nano .env
npm run check
npm start
```

## Main commands
User: `/start`, `/balance`, `.mybalance`, `/dailyclaim`, `.top10`, `.gift 500`, `/shop`  
Games: `.slot 100`, reply + `.dice 200`, reply + `.shan 500`, `.blackjack 500`  
Owner: `/admin`, `/settotal`, `/treasury`, `/addbalance`, `/removebalance`, `/addvip`, `/removevip`, `/viplist`, `/broadcast`, `/broadcastend`, `/on`, `/off`, `/status`, `/approve`, `/reject`, `/groupstatus`.

## Production
Use PM2:
```bash
npm i -g pm2
pm2 start ecosystem.config.js
pm2 save
```
