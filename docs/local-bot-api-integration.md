# Local Telegram Bot API integration (staged)

This branch adds an opt-in transport/edit foundation. It does not switch the production deployment by default.

## Current safe defaults

- `TELEGRAM_API_ROOT=https://api.telegram.org` (unchanged official API).
- `TELEGRAM_EDIT_QUEUE_ENABLED=false` (legacy edit flow remains in use unless explicitly enabled).
- Existing MongoDB, wallet settlement, game math, web routes, webhook/polling selection, and Render configuration are not changed.

## Local Bot API configuration

Set `TELEGRAM_API_ROOT=http://127.0.0.1:8081` only when this bot process runs on the same VPS/network namespace as the Local Bot API server. The previously used VPS endpoint was bound to loopback, so a Render-hosted process cannot reach it through its own `127.0.0.1`.

For a Render-hosted bot, keep the default API root unless a private, authenticated network path to the VPS has been established. Do not expose the Local Bot API port publicly without an access-control layer.

## Edit pipeline

Set `TELEGRAM_EDIT_QUEUE_ENABLED=true` to serialize edits to the same chat/message and limit concurrent edits across different messages. `TELEGRAM_EDIT_MAX_CONCURRENT` defaults to 5; `TELEGRAM_EDIT_RETRIES` defaults to 3. Queued edits honor Telegram's `retry_after` delay. The queue is process-local and intentionally does not write message state to MongoDB.

New helpers in `src/utils/telegram.js`:

- `editMarkupByIds(bot, chatId, messageId, replyMarkup)`
- `editMediaByIds(bot, chatId, messageId, media, extra)`
- `trackMessage(chatId, messageId, metadata)`
- `getTrackedMessage(chatId, messageId)`
- `listTrackedMessages()`

Tracking is currently in-memory, intended for diagnostics and coordination within one process; it is not durable across restarts. Existing game modules need explicit adoption of the new keyboard/media helpers where appropriate. No game modules are automatically rewritten by this foundational change.

## Rollout checklist

1. Deploy this branch only to a staging instance.
2. Verify `getMe`, polling/webhook startup, send/edit text, keyboard edit, media edit, and 429 handling against a test bot.
3. Test crash/slot/blackjack/mines callbacks and confirm wallet/transaction records are unchanged.
4. Only then set the local API root on the VPS-hosted bot and enable the edit queue.
5. Do not merge to `main` or change Render production settings until these checks pass.
