# BIKA Game Bot — Node Final

## Files
- `main.py`
- `requirements.txt`
- `.env.example`

## Features
- webhook only
- MongoDB
- Start bonus = 30000
- Fast slot
- Dice uses real Telegram dice value
- Shan duel
- VIP system
- Maintenance on/off
- Shop on/off
- Broadcast / broadcastend
- Treasury / balance / gift / dailyclaim
- Group approval

## Run
```bash
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
nano .env
python3 main.py
```

## PM2
```bash
pm2 start main.py --interpreter python3 --name bikagamebot-py
pm2 logs bikagamebot-py --lines 50
```
