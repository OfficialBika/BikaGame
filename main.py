
"""
BIKA Game Bot — Python final (Polling only)

Features:
- MongoDB + aiogram 3
- Start bonus = 30000
- /ping /status
- /on /off maintenance
- /settotal /treasury
- /addvip /removevip /viplist
- /setvipwr /vipwr
- /shop on /shop off + basic shop/order creation
- /broadcast /broadcastend
- /dailyclaim /balance /gift /top10
- .slot (fast spin)
- .dice (Telegram real dice values)
- .shan
- /approve /reject /groupstatus
"""

import asyncio
import html
import logging
import os
import random
import resource
import secrets
import signal
import time
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

from aiogram import Bot, Dispatcher, F, Router
from aiogram.client.default import DefaultBotProperties
from aiogram.enums import ChatMemberStatus, ChatType, DiceEmoji, ParseMode
from aiogram.exceptions import TelegramBadRequest, TelegramForbiddenError, TelegramNetworkError, TelegramRetryAfter
from aiogram.filters import Command, CommandObject, CommandStart
from aiogram.types import (
    BotCommand,
    CallbackQuery,
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    KeyboardButton,
    Message,
    ReplyKeyboardMarkup,
)
from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient
from pymongo import ReturnDocument
import psutil

load_dotenv()

BOT_TOKEN = os.getenv("BOT_TOKEN", "").strip()
MONGODB_URI = os.getenv("MONGODB_URI") or os.getenv("MONGO_URI") or ""
DB_NAME = os.getenv("DB_NAME", "bika_slot")
TZ_NAME = os.getenv("TZ", "Asia/Yangon")
OWNER_ID = int(os.getenv("OWNER_ID", "0") or 0)
COIN = os.getenv("STORE_CURRENCY", "MMK")
START_BONUS = int(os.getenv("START_BONUS", "30000"))
PORT = int(os.getenv("PORT", "3000") or 3000)  # unused in polling mode

if not BOT_TOKEN:
    raise RuntimeError("Missing BOT_TOKEN")
if not MONGODB_URI:
    raise RuntimeError("Missing MONGODB_URI / MONGO_URI")
if not OWNER_ID:
    raise RuntimeError("Missing OWNER_ID")

try:
    from zoneinfo import ZoneInfo
    TZ = ZoneInfo(TZ_NAME)
except Exception:
    TZ = timezone(timedelta(hours=6, minutes=30))

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(message)s",
)
log = logging.getLogger("bika_game_bot")

router = Router()
dp = Dispatcher()
dp.include_router(router)
bot = Bot(BOT_TOKEN, default=DefaultBotProperties(parse_mode=ParseMode.HTML, link_preview_is_disabled=True))

mongo = AsyncIOMotorClient(MONGODB_URI)
db = mongo[DB_NAME]
users_col = db["users"]
groups_col = db["groups"]
config_col = db["config"]
tx_col = db["transactions"]
orders_col = db["orders"]

# -------------------- Runtime memory --------------------
active_slots: set[int] = set()
last_slot_at: Dict[int, float] = {}
last_gift_at: Dict[int, float] = {}

active_dice_challenges: Dict[str, Dict[str, Any]] = {}
active_shan_challenges: Dict[str, Dict[str, Any]] = {}
current_broadcast: Optional[Dict[str, Any]] = None

STARTED_AT = time.time()

# -------------------- Constants --------------------
MAX_ACTIVE_SLOTS = 5
GIFT_COOLDOWN_MS = 10_000
DAILY_MIN = 500
DAILY_MAX = 2000

SHOP_ITEMS = [
    {"id": "dia11", "name": "Diamonds 11 💎", "price": 500000},
    {"id": "dia22", "name": "Diamonds 22 💎", "price": 1000000},
    {"id": "dia33", "name": "Diamonds 33 💎", "price": 1500000},
    {"id": "dia44", "name": "Diamonds 44 💎", "price": 2000000},
    {"id": "dia55", "name": "Diamonds 55 💎", "price": 2500000},
    {"id": "wp1", "name": "Weekly Pass 🎟️", "price": 9000000},
]

SLOT = {
    "min_bet": 50,
    "max_bet": 5000,
    "cooldown_ms": 700,
    "cap_percent": 0.30,
    "reels": [
        [
            {"s": "🍒", "w": 3200},
            {"s": "🍋", "w": 2200},
            {"s": "🍉", "w": 1500},
            {"s": "🔔", "w": 900},
            {"s": "⭐", "w": 450},
            {"s": "BAR", "w": 200},
            {"s": "7", "w": 100},
        ],
        [
            {"s": "🍒", "w": 3200},
            {"s": "🍋", "w": 2200},
            {"s": "🍉", "w": 1500},
            {"s": "🔔", "w": 900},
            {"s": "⭐", "w": 450},
            {"s": "BAR", "w": 200},
            {"s": "7", "w": 100},
        ],
        [
            {"s": "🍒", "w": 3200},
            {"s": "🍋", "w": 2200},
            {"s": "🍉", "w": 1500},
            {"s": "🔔", "w": 900},
            {"s": "⭐", "w": 450},
            {"s": "BAR", "w": 200},
            {"s": "7", "w": 100},
        ],
    ],
    "base_payouts": {
        "7,7,7": 20.0,
        "BAR,BAR,BAR": 15.0,
        "⭐,⭐,⭐": 12.0,
        "🔔,🔔,🔔": 9.0,
        "🍉,🍉,🍉": 7.0,
        "🍋,🍋,🍋": 5.0,
        "🍒,🍒,🍒": 3.0,
        "ANY2": 1.5,
    },
}

DICE = {"min_bet": 100, "max_bet": 50000, "max_active": 50}
SHAN = {"min_bet": 100, "max_bet": 100000, "max_active": 50}

SUITS = ["♥", "♦", "♣", "♠"]
RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"]


# -------------------- Utilities --------------------
def esc(s: Any) -> str:
    return html.escape(str(s if s is not None else ""))


def fmt(n: Any) -> str:
    try:
        return f"{int(n):,}"
    except Exception:
        return "0"


def now_yangon() -> datetime:
    return datetime.now(TZ)


def format_yangon(dt: Optional[datetime] = None) -> str:
    dt = dt or now_yangon()
    return dt.astimezone(TZ).strftime("%d/%m/%Y, %H:%M:%S")


def uptime_text() -> str:
    sec = int(time.time() - STARTED_AT)
    h, rem = divmod(sec, 3600)
    m, s = divmod(rem, 60)
    if h:
        return f"{h}h {m}m {s}s"
    if m:
        return f"{m}m {s}s"
    return f"{s}s"


def mention_html_from_user(user: Any) -> str:
    name = getattr(user, "full_name", None) or f"{getattr(user, 'first_name', '')} {getattr(user, 'last_name', '')}".strip() or getattr(user, "username", None) or "User"
    return f'<a href="tg://user?id={user.id}">{esc(name)}</a>'


def user_doc_label_html(u: Optional[Dict[str, Any]]) -> str:
    if not u:
        return "Unknown"
    full_name = (u.get("fullName") or "").strip()
    if not full_name:
        fn = (u.get("firstName") or "").strip()
        ln = (u.get("lastName") or "").strip()
        full_name = f"{fn} {ln}".strip()
    if not full_name:
        full_name = "User"
    return f'<a href="tg://user?id={int(u["userId"])}">{esc(full_name)}</a>'


def user_doc_label_text(u: Optional[Dict[str, Any]]) -> str:
    if not u:
        return "Unknown"
    full_name = (u.get("fullName") or "").strip()
    if not full_name:
        fn = (u.get("firstName") or "").strip()
        ln = (u.get("lastName") or "").strip()
        full_name = f"{fn} {ln}".strip()
    if not full_name:
        full_name = "User"
    return full_name


def to_num(v: Any) -> int:
    try:
        return int(v or 0)
    except Exception:
        return 0


def is_group_message(message: Message) -> bool:
    return message.chat.type in {ChatType.GROUP, ChatType.SUPERGROUP}


def normalize_vip_win_rate(value: Any, fallback: int = 90) -> int:
    try:
        n = int(float(value))
    except Exception:
        return fallback
    return max(0, min(100, n))


def vip_win_rate_chance(v: Any) -> float:
    return normalize_vip_win_rate(v, 90) / 100.0


def normalize_rtp(value: Any, fallback: float = 0.90) -> float:
    try:
        n = float(value)
    except Exception:
        return fallback
    if n > 1:
        n = n / 100.0
    return max(0.50, min(0.98, n))


async def safe_delete(chat_id: int, message_id: int) -> None:
    try:
        await bot.delete_message(chat_id, message_id)
    except Exception:
        pass


async def safe_edit(message: Message, text: str, reply_markup: Optional[InlineKeyboardMarkup] = None) -> None:
    try:
        await message.edit_text(text, reply_markup=reply_markup)
    except TelegramBadRequest as e:
        if "message is not modified" not in str(e).lower():
            raise
    except Exception:
        raise


async def answer_html(message: Message, text: str, reply_markup: Any = None, disable_preview: bool = True) -> Message:
    return await message.answer(text, reply_markup=reply_markup, disable_web_page_preview=disable_preview)


async def reply_html(message: Message, text: str, reply_markup: Any = None, disable_preview: bool = True) -> Message:
    return await message.reply(text, reply_markup=reply_markup, disable_web_page_preview=disable_preview)


async def safe_send_text(chat_id: int, text: str, **kwargs: Any) -> bool:
    try:
        await bot.send_message(chat_id, text, **kwargs)
        return True
    except (TelegramForbiddenError, TelegramBadRequest, TelegramNetworkError):
        return False
    except Exception:
        return False


async def safe_copy_message(chat_id: int, from_chat_id: int, message_id: int, **kwargs: Any) -> bool:
    try:
        await bot.copy_message(chat_id, from_chat_id, message_id, **kwargs)
        return True
    except Exception:
        return False


# -------------------- DB helpers --------------------
async def ensure_indexes() -> None:
    await users_col.create_index("userId", unique=True)
    await users_col.create_index("username")
    await users_col.create_index("startedBot")
    await users_col.create_index("isVip")
    await groups_col.create_index("groupId", unique=True)
    await groups_col.create_index("approvalStatus")
    await config_col.create_index("key", unique=True)
    await tx_col.create_index("createdAt")
    await orders_col.create_index("orderId", unique=True)
    await orders_col.create_index("status")


async def get_user(user_id: int) -> Optional[Dict[str, Any]]:
    return await users_col.find_one({"userId": int(user_id)})


async def get_user_by_username(username: str) -> Optional[Dict[str, Any]]:
    return await users_col.find_one({"username": username.lower()})


async def ensure_user(user: Any) -> Dict[str, Any]:
    now = now_yangon()
    doc = {
        "userId": int(user.id),
        "username": (user.username or "").lower() or None,
        "firstName": user.first_name or "",
        "lastName": user.last_name or "",
        "fullName": user.full_name or user.first_name or "User",
        "updatedAt": now,
    }
    await users_col.update_one(
        {"userId": int(user.id)},
        {
            "$set": doc,
            "$setOnInsert": {
                "balance": 0,
                "isVip": False,
                "startedBot": False,
                "startBonusClaimed": False,
                "createdAt": now,
                "lastDailyClaimDate": None,
            },
        },
        upsert=True,
    )
    out = await get_user(int(user.id))
    assert out is not None
    return out


async def get_group_doc(group_id: int) -> Optional[Dict[str, Any]]:
    return await groups_col.find_one({"groupId": int(group_id)})


async def ensure_group(chat: Any, bot_is_admin: Optional[bool] = None) -> Dict[str, Any]:
    now = now_yangon()
    if bot_is_admin is None:
        bot_is_admin = False
        try:
            me = await bot.get_me()
            member = await bot.get_chat_member(chat.id, me.id)
            bot_is_admin = member.status in {ChatMemberStatus.ADMINISTRATOR, ChatMemberStatus.CREATOR}
        except Exception:
            bot_is_admin = False

    await groups_col.update_one(
        {"groupId": int(chat.id)},
        {
            "$set": {
                "groupId": int(chat.id),
                "title": chat.title or str(chat.id),
                "botIsAdmin": bot_is_admin,
                "updatedAt": now,
            },
            "$setOnInsert": {
                "approvalStatus": "pending",
                "approvedBy": None,
                "createdAt": now,
            },
        },
        upsert=True,
    )
    out = await get_group_doc(int(chat.id))
    assert out is not None
    return out


async def approve_group_by_id(group_id: int, owner_id: int) -> None:
    await groups_col.update_one(
        {"groupId": int(group_id)},
        {"$set": {"approvalStatus": "approved", "approvedBy": int(owner_id), "updatedAt": now_yangon()}},
        upsert=True,
    )


async def reject_group_by_id(group_id: int, owner_id: int) -> None:
    await groups_col.update_one(
        {"groupId": int(group_id)},
        {"$set": {"approvalStatus": "rejected", "approvedBy": int(owner_id), "updatedAt": now_yangon()}},
        upsert=True,
    )


async def ensure_treasury() -> Dict[str, Any]:
    exist = await config_col.find_one({"key": "treasury"})
    if exist:
        fixed = {
            "ownerUserId": exist.get("ownerUserId") or OWNER_ID,
            "totalSupply": to_num(exist.get("totalSupply")),
            "ownerBalance": to_num(exist.get("ownerBalance")),
            "maintenanceMode": bool(exist.get("maintenanceMode", False)),
            "vipWinRate": normalize_vip_win_rate(exist.get("vipWinRate", 90), 90),
            "shopEnabled": bool(exist.get("shopEnabled", True)),
            "broadcastRunning": bool(exist.get("broadcastRunning", False)),
            "broadcastRunId": exist.get("broadcastRunId"),
            "slotRtp": normalize_rtp(exist.get("slotRtp", 0.90), 0.90),
        }
        need_fix = any(exist.get(k) != v for k, v in fixed.items())
        if need_fix:
            await config_col.update_one({"key": "treasury"}, {"$set": {**fixed, "updatedAt": now_yangon()}})
            exist = await config_col.find_one({"key": "treasury"})
        assert exist is not None
        return exist

    doc = {
        "key": "treasury",
        "ownerUserId": OWNER_ID,
        "totalSupply": 0,
        "ownerBalance": 0,
        "maintenanceMode": False,
        "vipWinRate": 90,
        "shopEnabled": True,
        "broadcastRunning": False,
        "broadcastRunId": None,
        "slotRtp": 0.90,
        "createdAt": now_yangon(),
        "updatedAt": now_yangon(),
    }
    await config_col.insert_one(doc)
    return doc


async def get_treasury() -> Dict[str, Any]:
    return await ensure_treasury()


def is_owner(user_id: int, treasury: Optional[Dict[str, Any]]) -> bool:
    return bool(treasury and int(treasury.get("ownerUserId") or 0) == int(user_id))


async def log_tx(kind: str, data: Dict[str, Any]) -> None:
    await tx_col.insert_one({"type": kind, **data, "createdAt": now_yangon()})


async def treasury_pay_to_user(user_id: int, amount: int, meta: Optional[Dict[str, Any]] = None) -> None:
    amount = int(amount)
    if amount <= 0:
        return
    await ensure_treasury()
    result = await config_col.update_one(
        {"key": "treasury", "ownerBalance": {"$gte": amount}},
        {"$inc": {"ownerBalance": -amount}, "$set": {"updatedAt": now_yangon()}},
    )
    if result.modified_count == 0:
        raise RuntimeError("TREASURY_INSUFFICIENT")
    await users_col.update_one(
        {"userId": int(user_id)},
        {
            "$inc": {"balance": amount},
            "$set": {"updatedAt": now_yangon()},
            "$setOnInsert": {
                "userId": int(user_id),
                "username": None,
                "firstName": "",
                "lastName": "",
                "fullName": str(user_id),
                "isVip": False,
                "startedBot": False,
                "startBonusClaimed": False,
                "balance": 0,
                "createdAt": now_yangon(),
                "lastDailyClaimDate": None,
            },
        },
        upsert=True,
    )
    await log_tx("treasury_to_user", {"userId": int(user_id), "amount": amount, "meta": meta or {}})


async def user_pay_to_treasury(user_id: int, amount: int, meta: Optional[Dict[str, Any]] = None) -> None:
    amount = int(amount)
    if amount <= 0:
        return
    result = await users_col.update_one(
        {"userId": int(user_id), "balance": {"$gte": amount}},
        {"$inc": {"balance": -amount}, "$set": {"updatedAt": now_yangon()}},
    )
    if result.modified_count == 0:
        raise RuntimeError("USER_INSUFFICIENT")
    await config_col.update_one({"key": "treasury"}, {"$inc": {"ownerBalance": amount}, "$set": {"updatedAt": now_yangon()}})
    await log_tx("user_to_treasury", {"userId": int(user_id), "amount": amount, "meta": meta or {}})


async def transfer_balance(from_user_id: int, to_user_id: int, amount: int, meta: Optional[Dict[str, Any]] = None) -> None:
    amount = int(amount)
    if amount <= 0:
        return
    res = await users_col.update_one(
        {"userId": int(from_user_id), "balance": {"$gte": amount}},
        {"$inc": {"balance": -amount}, "$set": {"updatedAt": now_yangon()}},
    )
    if res.modified_count == 0:
        raise RuntimeError("USER_INSUFFICIENT")
    await users_col.update_one(
        {"userId": int(to_user_id)},
        {"$inc": {"balance": amount}, "$set": {"updatedAt": now_yangon()}},
        upsert=True,
    )
    await log_tx("user_to_user", {"fromUserId": int(from_user_id), "toUserId": int(to_user_id), "amount": amount, "meta": meta or {}})


async def next_order_id() -> str:
    doc = await config_col.find_one_and_update(
        {"key": "order_seq"},
        {"$inc": {"value": 1}, "$setOnInsert": {"value": 0, "createdAt": now_yangon()}, "$set": {"updatedAt": now_yangon()}},
        upsert=True,
        return_document=ReturnDocument.AFTER,
    )
    value = int(doc.get("value", 0))
    return f"BKS{value:06d}"


# -------------------- Guards --------------------
async def ensure_not_maintenance(message: Message) -> bool:
    treasury = await ensure_treasury()
    if not treasury.get("maintenanceMode"):
        return True
    if is_owner(message.from_user.id, treasury):
        return True
    await reply_html(message, "🛠️ <b>Bot ပြုပြင်နေပါတယ်</b>\n━━━━━━━━━━━━\nခေတ္တစောင့်ဆိုင်းပေးပါ။")
    return False


async def ensure_group_approved(message: Message) -> bool:
    if not is_group_message(message):
        return True
    g = await ensure_group(message.chat)
    if g.get("approvalStatus") == "approved":
        return True
    await reply_html(message, "⚠️ <b>Bot Owner Approve မပေးထားပါ</b>\n━━━━━━━━━━━━\nဒီ group မှာ bot ကိုအသုံးပြုရန် owner က <code>/approve</code> လုပ်ပေးရပါမယ်။")
    return False


# -------------------- Parsing helpers --------------------
def parse_amount(text: str) -> Optional[int]:
    parts = str(text or "").strip().split()
    for token in reversed(parts):
        if token.isdigit():
            return int(token)
    return None


def parse_target_and_amount(text: str) -> Tuple[str, Optional[Dict[str, Any]], Optional[int]]:
    parts = str(text or "").strip().split()
    if len(parts) < 2:
        return "reply", None, None

    amount = None
    if parts[-1].isdigit():
        amount = int(parts[-1])

    raw_target = None
    if len(parts) >= 3:
        raw_target = parts[1]
    elif len(parts) == 2 and not parts[1].isdigit():
        raw_target = parts[1]

    if not raw_target:
        return "reply", None, amount

    if raw_target.startswith("@") and len(raw_target) > 1:
        return "explicit", {"type": "username", "value": raw_target[1:].lower()}, amount
    if raw_target.isdigit():
        return "explicit", {"type": "userId", "value": int(raw_target)}, amount
    return "invalid", None, amount


def parse_vip_target(text: str) -> Tuple[str, Optional[Dict[str, Any]]]:
    parts = str(text or "").strip().split()
    if len(parts) < 2:
        return "reply", None
    raw = parts[1].strip()
    if raw.startswith("@") and len(raw) > 1:
        return "explicit", {"type": "username", "value": raw[1:].lower()}
    if raw.isdigit():
        return "explicit", {"type": "userId", "value": int(raw)}
    return "invalid", None


async def resolve_target_from_message(message: Message, mode: str, target: Optional[Dict[str, Any]]) -> Tuple[bool, Optional[int], Optional[str]]:
    if mode == "reply":
        reply_from = message.reply_to_message.from_user if message.reply_to_message else None
        if not reply_from or reply_from.is_bot:
            return False, None, None
        await ensure_user(reply_from)
        return True, int(reply_from.id), mention_html_from_user(reply_from)

    if mode == "explicit" and target:
        if target["type"] == "userId":
            user_id = int(target["value"])
            u = await get_user(user_id)
            if not u:
                await users_col.update_one(
                    {"userId": user_id},
                    {"$setOnInsert": {"balance": 0, "isVip": False, "startedBot": False, "startBonusClaimed": False, "createdAt": now_yangon()},
                     "$set": {"updatedAt": now_yangon(), "fullName": str(user_id), "username": None}},
                    upsert=True,
                )
                u = await get_user(user_id)
            return True, user_id, user_doc_label_html(u)

        if target["type"] == "username":
            u = await get_user_by_username(target["value"])
            if not u:
                return False, None, None
            return True, int(u["userId"]), user_doc_label_html(u)

    return False, None, None


# -------------------- Slot math --------------------
def weighted_pick(items: List[Dict[str, Any]]) -> str:
    total = sum(int(it["w"]) for it in items)
    r = random.random() * total
    for it in items:
        r -= int(it["w"])
        if r <= 0:
            return str(it["s"])
    return str(items[-1]["s"])


def random_symbol_from_reel(reel: List[Dict[str, Any]]) -> str:
    return random.choice([x["s"] for x in reel])


def is_any_two(a: str, b: str, c: str) -> bool:
    return (a == b and a != c) or (a == c and a != b) or (b == c and b != a)


def calc_multiplier(a: str, b: str, c: str, payouts: Dict[str, float]) -> float:
    key = f"{a},{b},{c}"
    if key in payouts:
        return float(payouts[key])
    if is_any_two(a, b, c):
        return float(payouts.get("ANY2", 0))
    return 0.0


def current_slot_payouts(slot_rtp: float) -> Dict[str, float]:
    # scale from base 90% target around current slotRtp
    base = SLOT["base_payouts"]
    default = 0.90
    factor = slot_rtp / default
    out: Dict[str, float] = {}
    for k, v in base.items():
        out[k] = round(float(v) * factor, 4)
    return out


def slot_art(a: str, b: str, c: str) -> str:
    def box(x: str) -> str:
        if x == "BAR":
            return "BAR"
        if x == "7":
            return "7️⃣"
        return x
    return f"┏━━━━━━━━━━━━━━━━━━┓\n┃  {box(a)}  |  {box(b)}  |  {box(c)}  ┃\n┗━━━━━━━━━━━━━━━━━━┛"


def spin_frame(a: str, b: str, c: str, note: str = "Spinning...", vibe: str = "spin") -> str:
    vibe_header = (
        "🏆✨ WIN GLOW! ✨🏆" if vibe == "glow" else
        "🥀 BAD LUCK… 🥀" if vibe == "lose" else
        "💎🏆 777 JACKPOT! 🏆💎" if vibe == "jackpot" else
        "🎰 BIKA Pro Slot"
    )
    return f"<b>{esc(vibe_header)}</b>\n━━━━━━━━━━━━\n<pre>{esc(slot_art(a,b,c))}</pre>\n━━━━━━━━━━━━\n{esc(note)}"


def choose_weighted(arr: List[Any]) -> Any:
    return random.choice(arr)


def spin_slot_outcome_normal(slot_rtp: float, payouts: Dict[str, float]) -> Tuple[str, str, str]:
    # random base spin, but allow RTP to suppress wins sometimes
    for _ in range(25):
        out = (
            weighted_pick(SLOT["reels"][0]),
            weighted_pick(SLOT["reels"][1]),
            weighted_pick(SLOT["reels"][2]),
        )
        mult = calc_multiplier(*out, payouts)
        if mult <= 0:
            return out
        if random.random() < slot_rtp:
            return out
    # fallback losing outcome
    while True:
        out = (
            random_symbol_from_reel(SLOT["reels"][0]),
            random_symbol_from_reel(SLOT["reels"][1]),
            random_symbol_from_reel(SLOT["reels"][2]),
        )
        if calc_multiplier(*out, payouts) <= 0:
            return out


def spin_slot_outcome_vip(vip_win_rate: int, payouts: Dict[str, float]) -> Tuple[str, str, str]:
    if random.random() < vip_win_rate_chance(vip_win_rate):
        winning_combos = [k.split(",") for k, v in payouts.items() if k != "ANY2" and float(v) > 0]
        if winning_combos:
            c = choose_weighted(winning_combos)
            return c[0], c[1], c[2]
        sym = choose_weighted([x["s"] for x in SLOT["reels"][0]])
        return sym, sym, sym
    return spin_slot_outcome_normal(0.90, payouts)


def spin_slot_outcome_for_user(user_doc: Dict[str, Any], vip_win_rate: int, slot_rtp: float, payouts: Dict[str, float]) -> Tuple[str, str, str]:
    if user_doc.get("isVip"):
        return spin_slot_outcome_vip(vip_win_rate, payouts)
    return spin_slot_outcome_normal(slot_rtp, payouts)


# -------------------- Shan math --------------------
def build_deck() -> List[Dict[str, str]]:
    return [{"rank": rank, "suit": suit} for suit in SUITS for rank in RANKS]


def shuffle_deck(deck: List[Dict[str, str]]) -> List[Dict[str, str]]:
    arr = deck[:]
    random.shuffle(arr)
    return arr


def draw_cards(deck: List[Dict[str, str]], n: int) -> List[Dict[str, str]]:
    out = deck[:n]
    del deck[:n]
    return out


def rank_value(rank: str) -> int:
    if rank == "A":
        return 1
    if rank in {"10", "J", "Q", "K"}:
        return 0
    return int(rank)


def calc_points(cards: List[Dict[str, str]]) -> int:
    return sum(rank_value(c["rank"]) for c in cards) % 10


def is_shan_koe_mee(cards: List[Dict[str, str]]) -> bool:
    return len(cards) == 3 and all(c["rank"] == cards[0]["rank"] for c in cards)


def is_zat_toe(cards: List[Dict[str, str]]) -> bool:
    return len(cards) == 3 and all(c["rank"] in {"J", "Q", "K"} for c in cards)


def is_suit_triple(cards: List[Dict[str, str]]) -> bool:
    return len(cards) == 3 and all(c["suit"] == cards[0]["suit"] for c in cards)


def high_card_weight(rank: str) -> int:
    if rank == "A":
        return 1
    if rank == "J":
        return 11
    if rank == "Q":
        return 12
    if rank == "K":
        return 13
    return int(rank)


def sorted_high_ranks(cards: List[Dict[str, str]]) -> List[int]:
    return sorted((high_card_weight(c["rank"]) for c in cards), reverse=True)


def hand_info(cards: List[Dict[str, str]]) -> Dict[str, Any]:
    if is_shan_koe_mee(cards):
        return {"category": 4, "name": "Shan Koe Mee", "points": calc_points(cards), "tieBreaker": sorted_high_ranks(cards)}
    if is_zat_toe(cards):
        return {"category": 3, "name": "Zat Toe", "points": calc_points(cards), "tieBreaker": sorted_high_ranks(cards)}
    if is_suit_triple(cards):
        return {"category": 2, "name": "Suit Triple", "points": calc_points(cards), "tieBreaker": sorted_high_ranks(cards)}
    pts = calc_points(cards)
    return {"category": 1, "name": f"Point {pts}", "points": pts, "tieBreaker": sorted_high_ranks(cards)}


def compare_tie_breaker(a: List[int], b: List[int]) -> int:
    for i in range(max(len(a), len(b))):
        av = a[i] if i < len(a) else -1
        bv = b[i] if i < len(b) else -1
        if av > bv:
            return 1
        if bv > av:
            return -1
    return 0


def compare_hands(cards_a: List[Dict[str, str]], cards_b: List[Dict[str, str]]) -> Dict[str, Any]:
    a = hand_info(cards_a)
    b = hand_info(cards_b)
    if a["category"] > b["category"]:
        return {"winner": "A", "infoA": a, "infoB": b}
    if b["category"] > a["category"]:
        return {"winner": "B", "infoA": a, "infoB": b}
    if a["points"] > b["points"]:
        return {"winner": "A", "infoA": a, "infoB": b}
    if b["points"] > a["points"]:
        return {"winner": "B", "infoA": a, "infoB": b}
    tb = compare_tie_breaker(a["tieBreaker"], b["tieBreaker"])
    if tb > 0:
        return {"winner": "A", "infoA": a, "infoB": b}
    if tb < 0:
        return {"winner": "B", "infoA": a, "infoB": b}
    return {"winner": "TIE", "infoA": a, "infoB": b}


def card_box(card: Dict[str, str]) -> List[str]:
    rank = str(card["rank"])
    suit = str(card["suit"])
    left = rank.ljust(2)
    right = rank.rjust(2)
    return [
        "┌───────┐",
        f"│ {left}    │",
        f"│   {suit}  │",
        f"│    {right}│",
        "└───────┘",
    ]


def render_cards_row(cards: List[Dict[str, str]]) -> str:
    boxes = [card_box(c) for c in cards]
    lines: List[str] = []
    for i in range(5):
        lines.append(" ".join(b[i] for b in boxes))
    return "\n".join(lines)


def draw_shan_hands_for_users(user_a: Dict[str, Any], user_b: Dict[str, Any], vip_win_rate: int = 90) -> Dict[str, Any]:
    def try_once() -> Dict[str, Any]:
        deck = shuffle_deck(build_deck())
        cards_a = draw_cards(deck, 3)
        cards_b = draw_cards(deck, 3)
        result = compare_hands(cards_a, cards_b)
        return {"cardsA": cards_a, "cardsB": cards_b, "result": result}

    vip_a = bool(user_a.get("isVip"))
    vip_b = bool(user_b.get("isVip"))
    vip_chance = vip_win_rate_chance(vip_win_rate)

    if vip_a and not vip_b and random.random() < vip_chance:
        for _ in range(120):
            out = try_once()
            if out["result"]["winner"] == "A":
                return out
    if vip_b and not vip_a and random.random() < vip_chance:
        for _ in range(120):
            out = try_once()
            if out["result"]["winner"] == "B":
                return out
    return try_once()


# -------------------- Keyboards --------------------
def main_menu_keyboard() -> ReplyKeyboardMarkup:
    return ReplyKeyboardMarkup(
        keyboard=[[KeyboardButton(text="☰ Menu")]],
        resize_keyboard=True,
        selective=True,
    )


def shop_keyboard() -> InlineKeyboardMarkup:
    rows: List[List[InlineKeyboardButton]] = []
    for item in SHOP_ITEMS:
        rows.append([InlineKeyboardButton(text=f"{item['name']} — {fmt(item['price'])} {COIN}", callback_data=f"shop:{item['id']}")])
    return InlineKeyboardMarkup(inline_keyboard=rows)


def challenge_keyboard(kind: str, cid: str) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(text="✅ Accept", callback_data=f"{kind}:accept:{cid}"),
                InlineKeyboardButton(text="❌ Cancel", callback_data=f"{kind}:cancel:{cid}"),
            ]
        ]
    )


def admin_summary_text(t: Dict[str, Any], users_count: int, groups_count: int, pending_orders: int) -> str:
    return (
        "🛡️ <b>BIKA • Pro Admin Dashboard</b>\n"
        "━━━━━━━━━━━━\n"
        f"🏦 Treasury Balance: <b>{fmt(t.get('ownerBalance'))}</b> {COIN}\n"
        f"📦 Total Supply: <b>{fmt(t.get('totalSupply'))}</b> {COIN}\n"
        f"👤 Users: <b>{fmt(users_count)}</b>\n"
        f"👥 Groups: <b>{fmt(groups_count)}</b>\n"
        f"🧾 Pending Orders: <b>{fmt(pending_orders)}</b>\n"
        f"🎯 VIP WR: <b>{normalize_vip_win_rate(t.get('vipWinRate'))}%</b>\n"
        f"🛒 Shop: <b>{'ON' if t.get('shopEnabled', True) else 'OFF'}</b>\n"
        f"🛠 Maintenance: <b>{'ON' if t.get('maintenanceMode') else 'OFF'}</b>\n"
        f"🕒 {esc(format_yangon())} (Yangon Time)"
    )


def shop_text(balance: int) -> str:
    lines = ["🛒 <b>BIKA Shop</b>", "━━━━━━━━━━━━", f"💼 Your Balance: <b>{fmt(balance)}</b> {COIN}", "Select an item below:"]
    for item in SHOP_ITEMS:
        lines.append(f"• <b>{esc(item['name'])}</b> — <b>{fmt(item['price'])}</b> {COIN}")
    return "\n".join(lines)


def dice_challenge_text(challenger: Any, target: Any, bet: int) -> str:
    return (
        "🎲 <b>Dice Duel Challenge</b>\n"
        "━━━━━━━━━━━━\n"
        f"စိန်ခေါ်သူ: {mention_html_from_user(challenger)}\n"
        f"လက်ခံသူ: {mention_html_from_user(target)}\n"
        f"Bet: <b>{fmt(bet)}</b> {COIN}\n"
        "Winner gets: <b>98%</b>\n"
        "━━━━━━━━━━━━\n"
        "Reply ထောက်ထားတဲ့သူပဲ Accept လုပ်နိုင်ပါတယ်။"
    )


def shan_challenge_text(challenger: Any, target: Any, bet: int) -> str:
    return (
        "🃏 <b>Shan Koe Mee Challenge</b>\n"
        "━━━━━━━━━━━━\n"
        f"စိန်ခေါ်သူ: {mention_html_from_user(challenger)}\n"
        f"လက်ခံသူ: {mention_html_from_user(target)}\n"
        f"Bet: <b>{fmt(bet)}</b> {COIN}\n"
        "Winner gets: <b>98%</b> (normal)\n"
        "Suit Triple: <b>pot + extra one bet</b>\n"
        "━━━━━━━━━━━━\n"
        "Reply ထောက်ထားတဲ့သူပဲ Accept လုပ်နိုင်ပါတယ်။"
    )


def wallet_rank(balance: int) -> str:
    b = int(balance)
    if b <= 0:
        return "ဖင်ပြောင်ငမွဲ"
    if b <= 500:
        return "ဆင်းရဲသား အိမ်ခြေမဲ့"
    if b <= 1000:
        return "အိမ်ပိုင်ဝန်းပိုင် ဆင်းရဲသား"
    if b <= 5000:
        return "လူလတ်တန်းစား"
    if b <= 10000:
        return "သူဌေးပေါက်စ"
    if b <= 100000:
        return "သိန်းကြွယ်သူဌေး"
    if b <= 1000000:
        return "သန်းကြွယ်သူဌေးအကြီးစား"
    if b <= 50000000:
        return "ကုဋေရှစ်ဆယ် သူဌေးကြီး"
    return "အာကာသသူဌေး"


# -------------------- Commands --------------------
@router.message(CommandStart())
async def cmd_start(message: Message) -> None:
    treasury = await ensure_treasury()
    user = await ensure_user(message.from_user)
    await users_col.update_one({"userId": message.from_user.id}, {"$set": {"startedBot": True, "updatedAt": now_yangon()}})
    if not user.get("startBonusClaimed"):
        if to_num(treasury.get("ownerBalance")) < START_BONUS:
            await reply_html(message, "⚠️ <b>Treasury မသတ်မှတ်ရသေးပါ</b>\n━━━━━━━━━━━━\nOwner က <code>/settotal 5000000</code> လုပ်ပြီးမှ Welcome Bonus ပေးနိုင်ပါတယ်။", reply_markup=main_menu_keyboard())
            return
        try:
            await treasury_pay_to_user(message.from_user.id, START_BONUS, {"type": "start_bonus"})
            await users_col.update_one({"userId": message.from_user.id}, {"$set": {"startBonusClaimed": True, "updatedAt": now_yangon()}})
            updated = await get_user(message.from_user.id)
            text = (
                "🎉 <b>Welcome Bonus</b>\n"
                "━━━━━━━━━━━━━━━\n"
                f"👤 {mention_html_from_user(message.from_user)}\n"
                f"➕ Bonus: <b>{fmt(START_BONUS)}</b> {COIN}\n"
                f"💼 Balance: <b>{fmt(updated.get('balance'))}</b> {COIN}\n"
                "━━━━━━━━━━━━━━\n"
                "Group Commands:\n"
                "• <code>/dailyclaim</code>\n"
                "• <code>.slot 100</code>\n"
                "• <code>.dice 200</code>\n"
                "• <code>.shan 500</code>\n"
                "• <code>.mybalance</code>\n"
                "• <code>.top10</code>\n"
                "• <code>/shop</code>"
            )
            await reply_html(message, text, reply_markup=main_menu_keyboard())
            return
        except Exception as e:
            if "TREASURY_INSUFFICIENT" in str(e):
                await reply_html(message, "🏦 Treasury မလုံလောက်ပါ။ Owner က /settotal ပြန်သတ်မှတ်ပေးပါ။", reply_markup=main_menu_keyboard())
                return
            raise

    await reply_html(
        message,
        "👋 <b>Welcome back</b>\n━━━━━━━━━━━━━━━\n"
        "Group Commands:\n"
        "• <code>/dailyclaim</code>\n"
        "• <code>.slot 100</code>\n"
        "• <code>.dice 200</code>\n"
        "• <code>.shan 500</code>\n"
        "• <code>.mybalance</code>\n"
        "• <code>.top10</code>\n"
        "• <code>/shop</code>",
        reply_markup=main_menu_keyboard(),
    )


@router.message(F.text == "☰ Menu")
async def menu_button(message: Message) -> None:
    await cmd_start(message)


@router.message(Command("balance"))
async def cmd_balance(message: Message) -> None:
    if not await ensure_not_maintenance(message):
        return
    user = await ensure_user(message.from_user)
    await reply_html(message, f"💼 Balance: <b>{fmt(user.get('balance'))}</b> {COIN}")


@router.message(Command("ping"))
async def cmd_ping(message: Message) -> None:
    t0 = time.perf_counter()
    await ensure_user(message.from_user)
    db0 = time.perf_counter()
    await ensure_treasury()
    db_ms = int((time.perf_counter() - db0) * 1000)
    bot_ms = int((time.perf_counter() - t0) * 1000)
    rss = psutil.Process(os.getpid()).memory_info().rss // (1024 * 1024)
    heap = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    heap_mb = int(heap / 1024) if os.name != "darwin" else int(heap / (1024 * 1024))
    text = (
        "🏓 <b>PING</b>\n"
        "━━━━━━━━━━━━\n"
        f"⚡ Bot: <b>{bot_ms} ms</b>\n"
        f"🗄 DB: <b>{db_ms} ms</b>\n"
        f"⏱ Uptime: <b>{esc(uptime_text())}</b>\n"
        f"💻 Memory: <b>{rss} MB RSS / {heap_mb} MB Heap</b>\n"
        f"🕒 Yangon: <b>{esc(format_yangon())}</b>"
    )
    await reply_html(message, text)


@router.message(Command("status"))
async def cmd_status(message: Message) -> None:
    await ensure_user(message.from_user)
    t0 = time.perf_counter()
    treasury = await ensure_treasury()
    users_count = await users_col.count_documents({})
    groups_count = await groups_col.count_documents({})
    vip_count = await users_col.count_documents({"isVip": True})
    bot_ms = int((time.perf_counter() - t0) * 1000)
    db_ms = bot_ms
    rss = psutil.Process(os.getpid()).memory_info().rss // (1024 * 1024)
    heap = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    heap_mb = int(heap / 1024) if os.name != "darwin" else int(heap / (1024 * 1024))
    text = (
        "📊 <b>BIKA Bot Status</b>\n"
        "━━━━━━━━━━━━\n"
        f"⚡ Bot: <b>{bot_ms} ms</b>\n"
        f"🗄 DB: <b>{db_ms} ms</b>\n"
        f"⏱ Uptime: <b>{esc(uptime_text())}</b>\n"
        f"💻 Memory: <b>{rss} MB RSS / {heap_mb} MB Heap</b>\n"
        f"🕒 Yangon: <b>{esc(format_yangon())}</b>\n"
        "━━━━━━━━━━━━\n"
        f"👥 Users: <b>{fmt(users_count)}</b>\n"
        f"👨‍👩‍👧‍👦 Groups: <b>{fmt(groups_count)}</b>\n"
        f"🌟 VIP: <b>{fmt(vip_count)}</b>\n"
        f"🎲 Open Dice: <b>{fmt(len(active_dice_challenges))}</b>\n"
        f"🀄 Open Shan: <b>{fmt(len(active_shan_challenges))}</b>\n"
        f"📣 Broadcast: <b>{'RUNNING' if current_broadcast and not current_broadcast.get('cancelled') else 'IDLE'}</b>\n"
        f"🛠 Maintenance: <b>{'ON' if treasury.get('maintenanceMode') else 'OFF'}</b>\n"
        f"🎯 VIP WR: <b>{normalize_vip_win_rate(treasury.get('vipWinRate'))}%</b>"
    )
    await reply_html(message, text)


@router.message(Command("viplist"))
async def cmd_viplist(message: Message) -> None:
    t = await ensure_treasury()
    if not is_owner(message.from_user.id, t):
        await reply_html(message, "⛔ Owner only command.")
        return
    docs = await users_col.find({"isVip": True}).sort("updatedAt", -1).to_list(length=100)
    if not docs:
        await reply_html(message, "📭 VIP list ထဲမှာ ဘယ်သူမှမရှိသေးပါ။")
        return
    lines = ["🌟 <b>VIP List</b>", "━━━━━━━━━━━━"]
    for i, u in enumerate(docs[:50], start=1):
        lines.append(f"{i}. {user_doc_label_html(u)} — <code>{u['userId']}</code>")
    await reply_html(message, "\n".join(lines))


@router.message(Command("setvipwr"))
async def cmd_setvipwr(message: Message) -> None:
    t = await ensure_treasury()
    if not is_owner(message.from_user.id, t):
        await reply_html(message, "⛔ Owner only command.")
        return
    parts = (message.text or "").strip().split()
    if len(parts) < 2:
        current = normalize_vip_win_rate(t.get("vipWinRate"), 90)
        await reply_html(message, f"⚙️ <b>Set VIP Win Rate</b>\n━━━━━━━━━━━━\nUsage: <code>/setvipwr 60</code>\nCurrent: <b>{current}%</b>\nApplies to: <b>Slot / Dice / Shan</b>")
        return
    try:
        rate = normalize_vip_win_rate(parts[1], 90)
    except Exception:
        await reply_html(message, "⚠️ Usage: <code>/setvipwr 0-100</code>")
        return
    await config_col.update_one({"key": "treasury"}, {"$set": {"vipWinRate": rate, "updatedAt": now_yangon()}})
    await reply_html(message, f"✅ <b>VIP Win Rate Updated</b>\n━━━━━━━━━━━━\nNew Rate: <b>{rate}%</b>\nApplied to: <b>Slot / Dice / Shan</b>")


@router.message(Command("vipwr"))
async def cmd_vipwr(message: Message) -> None:
    t = await ensure_treasury()
    if not is_owner(message.from_user.id, t):
        await reply_html(message, "⛔ Owner only command.")
        return
    current = normalize_vip_win_rate(t.get("vipWinRate"), 90)
    await reply_html(message, f"📊 <b>VIP Win Rate</b>\n━━━━━━━━━━━━\nCurrent: <b>{current}%</b>\nApplies to: <b>Slot / Dice / Shan</b>\nSet with: <code>/setvipwr 0-100</code>")


@router.message(Command("addvip"))
async def cmd_addvip(message: Message) -> None:
    t = await ensure_treasury()
    if not is_owner(message.from_user.id, t):
        await reply_html(message, "⛔ Owner only command.")
        return
    mode, target = parse_vip_target(message.text or "")
    ok, user_id, label = await resolve_target_from_message(message, mode, target)
    if not ok:
        await reply_html(message, "👤 VIP ပေးမယ့်သူကို Reply လုပ်ပါ သို့ <code>/addvip @username</code> / <code>/addvip userId</code> သုံးပါ။")
        return
    await users_col.update_one({"userId": user_id}, {"$set": {"isVip": True, "updatedAt": now_yangon()}}, upsert=True)
    await reply_html(message, f"🌟 <b>VIP Added Successfully</b>\n━━━━━━━━━━━━━━━━\nUser: {label}\nအဆင့်အတန်း: <b>VIP Member</b>")


@router.message(Command("removevip"))
async def cmd_removevip(message: Message) -> None:
    t = await ensure_treasury()
    if not is_owner(message.from_user.id, t):
        await reply_html(message, "⛔ Owner only command.")
        return
    mode, target = parse_vip_target(message.text or "")
    ok, user_id, label = await resolve_target_from_message(message, mode, target)
    if not ok:
        await reply_html(message, "👤 VIP ဖြုတ်မယ့်သူကို Reply လုပ်ပါ သို့ <code>/removevip @username</code> / <code>/removevip userId</code> သုံးပါ။")
        return
    await users_col.update_one({"userId": user_id}, {"$set": {"isVip": False, "updatedAt": now_yangon()}}, upsert=True)
    await reply_html(message, f"❌ <b>VIP Status Removed</b>\n━━━━━━━━━━━━━━━━\nUser: {label}")


@router.message(Command("on"))
async def cmd_on(message: Message) -> None:
    t = await ensure_treasury()
    if not is_owner(message.from_user.id, t):
        await reply_html(message, "⛔ Owner only.")
        return
    await config_col.update_one({"key": "treasury"}, {"$set": {"maintenanceMode": False, "updatedAt": now_yangon()}})
    await reply_html(message, "✅ <b>Bot Online</b>\n━━━━━━━━━━━━\nBot ကို <b>ON</b> ပြန်လုပ်ပြီးပါပြီ။ User များ ပုံမှန်သုံးနိုင်ပါပြီ။")


@router.message(Command("off"))
async def cmd_off(message: Message) -> None:
    t = await ensure_treasury()
    if not is_owner(message.from_user.id, t):
        await reply_html(message, "⛔ Owner only.")
        return
    await config_col.update_one({"key": "treasury"}, {"$set": {"maintenanceMode": True, "updatedAt": now_yangon()}})
    await reply_html(message, "🛠️ <b>Bot Maintenance Mode</b>\n━━━━━━━━━━━━\nBot ကို <b>OFF</b> လုပ်ပြီးပါပြီ။\nUser command အားလုံးကို ခေတ္တပိတ်ထားပါမယ်။")


@router.message(Command("settotal"))
async def cmd_settotal(message: Message) -> None:
    t = await ensure_treasury()
    if not is_owner(message.from_user.id, t):
        await reply_html(message, "⛔ Owner only.")
        return
    parts = (message.text or "").split()
    if len(parts) < 2 or not parts[1].isdigit():
        await reply_html(message, "Usage: <code>/settotal 5000000</code>")
        return
    total = int(parts[1])
    await config_col.update_one(
        {"key": "treasury"},
        {"$set": {"totalSupply": total, "ownerBalance": total, "ownerUserId": OWNER_ID, "updatedAt": now_yangon()}},
        upsert=True,
    )
    await reply_html(message, f"✅ Treasury total set.\n• Total Supply: <b>{fmt(total)}</b> {COIN}\n• Treasury: <b>{fmt(total)}</b> {COIN}")


@router.message(Command("treasury"))
async def cmd_treasury(message: Message) -> None:
    t = await ensure_treasury()
    if not is_owner(message.from_user.id, t):
        await reply_html(message, "⛔ Owner only.")
        return
    await reply_html(message, f"🏦 <b>Treasury</b>\n━━━━━━━━━━━━\nBalance: <b>{fmt(t.get('ownerBalance'))}</b> {COIN}\nTotal Supply: <b>{fmt(t.get('totalSupply'))}</b> {COIN}\nOwner ID: <code>{t.get('ownerUserId')}</code>\n🕒 {esc(format_yangon())}")


@router.message(Command("rtp"))
async def cmd_rtp(message: Message) -> None:
    t = await ensure_treasury()
    if not is_owner(message.from_user.id, t):
        await reply_html(message, "⛔ Owner only.")
        return
    slot_rtp = normalize_rtp(t.get("slotRtp"), 0.90)
    payouts = current_slot_payouts(slot_rtp)
    lines = ["🧮 <b>Slot RTP Dashboard</b>", "━━━━━━━━━━━━"]
    lines.append(f"Treasury: <b>{fmt(t.get('ownerBalance'))}</b> {COIN}")
    lines.append(f"Total Supply: <b>{fmt(t.get('totalSupply'))}</b> {COIN}")
    lines.append(f"Target RTP: <b>{slot_rtp*100:.2f}%</b>")
    lines.append(f"House Edge: <b>{(1-slot_rtp)*100:.2f}%</b>")
    lines.append(f"Cap: <b>{int(SLOT['cap_percent']*100)}%</b> of Treasury / spin")
    lines.append("━━━━━━━━━━━━")
    lines.append("<b>Payout Table (Bet = 1,000)</b>")
    for k, v in payouts.items():
        lines.append(f"• {esc(k)} = <b>{v}</b>x")
    await reply_html(message, "\n".join(lines))


@router.message(Command("setrtp"))
async def cmd_setrtp(message: Message) -> None:
    t = await ensure_treasury()
    if not is_owner(message.from_user.id, t):
        await reply_html(message, "⛔ Owner only.")
        return
    parts = (message.text or "").split()
    if len(parts) < 2:
        await reply_html(message, "Usage: <code>/setrtp 90</code> or <code>/setrtp 0.90</code>")
        return
    target = normalize_rtp(parts[1], 0.90)
    await config_col.update_one({"key": "treasury"}, {"$set": {"slotRtp": target, "updatedAt": now_yangon()}})
    await reply_html(message, f"✅ <b>RTP Updated</b>\n━━━━━━━━━━━━\nTarget RTP: <b>{target*100:.2f}%</b>")


@router.message(Command("dailyclaim"))
async def cmd_dailyclaim(message: Message) -> None:
    if not await ensure_not_maintenance(message):
        return
    if not is_group_message(message):
        await reply_html(message, "ℹ️ ဒီ command ကို group ထဲမှာပဲ သုံးနိုင်ပါတယ်။")
        return
    if not await ensure_group_approved(message):
        return
    await ensure_user(message.from_user)
    date_key = now_yangon().strftime("%Y-%m-%d")
    u = await get_user(message.from_user.id)
    if u.get("lastDailyClaimDate") == date_key:
        await reply_html(message, "⏳ ဒီနေ့ Daily Claim ယူပြီးပါပြီ။ Myanmar day ပြောင်းမှ ပြန်ယူလို့ရပါမယ်။")
        return
    amount = random.randint(DAILY_MIN, DAILY_MAX)
    try:
        await treasury_pay_to_user(message.from_user.id, amount, {"type": "daily_claim", "chatId": message.chat.id})
    except Exception as e:
        if "TREASURY_INSUFFICIENT" in str(e):
            await reply_html(message, "🏦 Treasury မလုံလောက်ပါ။")
            return
        raise
    await users_col.update_one({"userId": message.from_user.id}, {"$set": {"lastDailyClaimDate": date_key, "updatedAt": now_yangon()}})
    updated = await get_user(message.from_user.id)
    await reply_html(message, f"🎁 <b>Daily Claim</b>\n━━━━━━━━━━━━\nUser: {mention_html_from_user(message.from_user)}\nReceived: <b>{fmt(amount)}</b> {COIN}\nBalance: <b>{fmt(updated.get('balance'))}</b> {COIN}")


@router.message(Command("top10"))
@router.message(F.text.regexp(r"^\.(top10)\s*$"))
async def cmd_top10(message: Message) -> None:
    docs = await users_col.find({}).sort("balance", -1).limit(10).to_list(length=10)
    if not docs:
        await reply_html(message, "No users yet.")
        return
    lines = ["🏆 <b>Top 10 Richest</b>", "━━━━━━━━━━━━"]
    for i, u in enumerate(docs, start=1):
        lines.append(f"{i}. {user_doc_label_html(u)} — <b>{fmt(u.get('balance'))}</b> {COIN}")
    await reply_html(message, "\n".join(lines))


@router.message(F.text.regexp(r"^\.(mybalance|bal)\s*$"))
async def cmd_mybalance(message: Message) -> None:
    if not await ensure_not_maintenance(message):
        return
    if not is_group_message(message):
        await reply_html(message, "ℹ️ ဒီ command ကို group ထဲမှာပဲ သုံးနိုင်ပါတယ်။")
        return
    if not await ensure_group_approved(message):
        return
    u = await ensure_user(message.from_user)
    bal = to_num(u.get("balance"))
    await reply_html(message, f"💼 <b>My Balance</b>\n━━━━━━━━━━━━\nUser: {mention_html_from_user(message.from_user)}\nBalance: <b>{fmt(bal)}</b> {COIN}\nRank: <b>{esc(wallet_rank(bal))}</b>")


# -------------------- Gift --------------------
async def do_gift(message: Message, to_user_id: int, amount: int, to_label_html: str) -> None:
    last = last_gift_at.get(message.from_user.id, 0)
    if (time.time() * 1000 - last) < GIFT_COOLDOWN_MS:
        sec = int((GIFT_COOLDOWN_MS - (time.time() * 1000 - last)) / 1000 + 0.999)
        await reply_html(message, f"⏳ ခဏစောင့်ပါ… ({sec}s) ပီးမှ နောက်တစ်ခါ gift လုပ်နိုင်ပါမယ်။")
        return

    try:
        await transfer_balance(message.from_user.id, to_user_id, int(amount), {"chatId": message.chat.id if message.chat else None})
        last_gift_at[message.from_user.id] = time.time() * 1000
    except Exception as e:
        if "USER_INSUFFICIENT" in str(e):
            u = await get_user(message.from_user.id)
            await reply_html(message, f"❌ လက်ကျန်ငွေ မလုံလောက်ပါ။ (Balance: <b>{fmt(u.get('balance') if u else 0)}</b> {COIN})")
            return
        raise

    updated_from = await get_user(message.from_user.id)
    await reply_html(message, f"🎁 <b>Gift Success</b>\n━━━━━━━━━━━━\nFrom: {mention_html_from_user(message.from_user)}\nTo: {to_label_html}\nAmount: <b>{fmt(amount)}</b> {COIN}\nYour Balance: <b>{fmt(updated_from.get('balance') if updated_from else 0)}</b> {COIN}")


@router.message(Command("gift"))
async def cmd_gift(message: Message) -> None:
    if not await ensure_not_maintenance(message):
        return
    amount = parse_amount(message.text or "")
    if not amount or amount <= 0:
        await reply_html(message, "🎁 <b>Gift Usage</b>\n━━━━━━━━━━━━━\n• Reply + <code>/gift 500</code>\n• Mention + <code>/gift @username 500</code>\n• Reply + <code>.gift 500</code> (group)")
        return
    await ensure_user(message.from_user)
    to_user_id = None
    to_label_html = None
    reply_from = message.reply_to_message.from_user if message.reply_to_message else None
    if reply_from and not reply_from.is_bot and reply_from.id != message.from_user.id:
        await ensure_user(reply_from)
        to_user_id = reply_from.id
        to_label_html = mention_html_from_user(reply_from)
    else:
        parts = (message.text or "").split()
        if len(parts) < 3 or not parts[1].startswith("@"):
            await reply_html(message, "👤 Reply (/gift 500) သို့ /gift @username 500 သုံးပါ။")
            return
        to_u = await get_user_by_username(parts[1][1:].lower())
        if not to_u:
            await reply_html(message, "⚠️ ဒီ @username ကို မတွေ့ပါ။ (သူ bot ကို /start လုပ်ထားရမယ်) သို့ Reply နဲ့ gift ပို့ပါ။")
            return
        if int(to_u["userId"]) == message.from_user.id:
            await reply_html(message, "😅 ကိုယ့်ကိုကိုယ် gift မပို့နိုင်ပါ။")
            return
        to_user_id = int(to_u["userId"])
        to_label_html = user_doc_label_html(to_u)
    await do_gift(message, to_user_id, amount, to_label_html)


@router.message(F.text.regexp(r"^\.(gift)\s+(\d+)\s*$"))
async def dot_gift(message: Message) -> None:
    if not await ensure_not_maintenance(message):
        return
    if not is_group_message(message):
        await reply_html(message, "ℹ️ <code>.gift</code> ကို group ထဲမှာပဲ သုံးနိုင်ပါတယ်။")
        return
    if not await ensure_group_approved(message):
        return
    reply_from = message.reply_to_message.from_user if message.reply_to_message else None
    if not reply_from:
        await reply_html(message, "⚠️ <b>Reply လုပ်ပြီးသုံးပါ</b>\n━━━━━━━━━━━━━━\nExample: Reply + <code>.gift 200</code>")
        return
    if reply_from.is_bot:
        await reply_html(message, "🤖 Bot ကို gift မပို့နိုင်ပါ။")
        return
    if reply_from.id == message.from_user.id:
        await reply_html(message, "😅 ကိုယ့်ကိုကိုယ် gift မပို့နိုင်ပါ။")
        return
    amount = int((message.text or "").split()[1])
    await ensure_user(reply_from)
    await do_gift(message, reply_from.id, amount, mention_html_from_user(reply_from))


# -------------------- Owner add/remove balance --------------------
@router.message(Command("addbalance"))
async def cmd_addbalance(message: Message) -> None:
    t = await ensure_treasury()
    if not is_owner(message.from_user.id, t):
        await reply_html(message, "⛔ Owner only command.")
        return
    mode, target, amount = parse_target_and_amount(message.text or "")
    if not amount or amount <= 0:
        await reply_html(message, "➕ <b>Add Balance (Owner)</b>\n━━━━━━━━━━━━\nReply mode:\n• Reply + <code>/addbalance 5000</code>\n\nExplicit:\n• <code>/addbalance @username 5000</code>\n• <code>/addbalance 123456789 5000</code>")
        return
    ok, user_id, label = await resolve_target_from_message(message, mode, target)
    if not ok:
        await reply_html(message, "👤 Target မရွေးရသေးပါ။ Reply + /addbalance 5000 သို့ /addbalance @username 5000")
        return
    try:
        await treasury_pay_to_user(user_id, amount, {"type": "owner_addbalance", "by": message.from_user.id})
    except Exception as e:
        if "TREASURY_INSUFFICIENT" in str(e):
            tr = await get_treasury()
            await reply_html(message, f"❌ ဘဏ်ငွေလက်ကျန် မလုံလောက်ပါ။ (Treasury: <b>{fmt(tr.get('ownerBalance'))}</b> {COIN})")
            return
        raise
    u = await get_user(user_id)
    tr = await get_treasury()
    await reply_html(message, f"✅ <b>Balance Added</b>\n━━━━━━━━━━━━\nUser: {label}\nထပ်ဖြည့်လိုက်သောငွေ: <b>{fmt(amount)}</b> {COIN}\nလက်ကျန်ငွေစုစုပေါင်း: <b>{fmt(u.get('balance') if u else 0)}</b> {COIN}\nဘဏ်ငွေ လက်ကျန်: <b>{fmt(tr.get('ownerBalance'))}</b> {COIN}")


@router.message(Command("removebalance"))
async def cmd_removebalance(message: Message) -> None:
    t = await ensure_treasury()
    if not is_owner(message.from_user.id, t):
        await reply_html(message, "⛔ Owner only command.")
        return
    mode, target, amount = parse_target_and_amount(message.text or "")
    if not amount or amount <= 0:
        await reply_html(message, "➖ <b>Remove Balance (Owner)</b>\n━━━━━━━━━━━━━\nReply mode:\n• Reply + <code>/removebalance 5000</code>\n\nExplicit:\n• <code>/removebalance @username 5000</code>\n• <code>/removebalance 123456789 5000</code>")
        return
    ok, user_id, label = await resolve_target_from_message(message, mode, target)
    if not ok:
        await reply_html(message, "👤 Target မရွေးရသေးပါ။ Reply + /removebalance 5000 သို့ /removebalance @username 5000")
        return
    try:
        await user_pay_to_treasury(user_id, amount, {"type": "owner_removebalance", "by": message.from_user.id})
    except Exception as e:
        if "USER_INSUFFICIENT" in str(e):
            u = await get_user(user_id)
            await reply_html(message, f"❌ လက်ကျန်ငွေ မလုံလောက်ပါ။ (Balance: <b>{fmt(u.get('balance') if u else 0)}</b> {COIN})")
            return
        raise
    u = await get_user(user_id)
    tr = await get_treasury()
    await reply_html(message, f"✅ <b>Balance Removed</b>\n━━━━━━━━━━━━\nUser: {label}\nAmount: <b>{fmt(amount)}</b> {COIN}\nUser Balance: <b>{fmt(u.get('balance') if u else 0)}</b> {COIN}\nTreasury Now: <b>{fmt(tr.get('ownerBalance'))}</b> {COIN}")


# -------------------- Shop --------------------
@router.message(Command("shop"))
async def cmd_shop(message: Message) -> None:
    if not await ensure_not_maintenance(message):
        return
    text = (message.text or "").strip()
    parts = text.split()
    sub = parts[1].lower() if len(parts) >= 2 else ""
    t = await ensure_treasury()
    if sub in {"on", "off"}:
        if not is_owner(message.from_user.id, t):
            await reply_html(message, "⛔ Owner only command.")
            return
        enabled = sub == "on"
        await config_col.update_one({"key": "treasury"}, {"$set": {"shopEnabled": enabled, "updatedAt": now_yangon()}})
        await reply_html(message, "✅ <b>Shop is now ON</b>\n━━━━━━━━━━━━\nUser တွေ /shop ကို သုံးလို့ရပါပြီ。" if enabled else "🚫 <b>Shop is now OFF</b>\n━━━━━━━━━━━━\nUser တွေ /shop ကို ခေတ္တမသုံးနိုင်ပါ။")
        return

    if t.get("shopEnabled") is False:
        await reply_html(message, "🛒 <b>Shop Closed</b>\n━━━━━━━━━━━━\nShop ကို ခေတ္တပိတ်ထားပါတယ်။ နောက်မှ ပြန်စမ်းပေးပါ။")
        return
    u = await ensure_user(message.from_user)
    await reply_html(message, shop_text(to_num(u.get("balance"))), reply_markup=shop_keyboard())


@router.callback_query(F.data.startswith("shop:"))
async def cb_shop_item(cb: CallbackQuery) -> None:
    t = await ensure_treasury()
    if t.get("shopEnabled") is False:
        await cb.answer("Shop is closed.", show_alert=True)
        return
    item_id = cb.data.split(":", 1)[1]
    item = next((x for x in SHOP_ITEMS if x["id"] == item_id), None)
    if not item:
        await cb.answer("Item not found.", show_alert=True)
        return
    await ensure_user(cb.from_user)
    order_id = await next_order_id()
    order_doc = {
        "orderId": order_id,
        "userId": cb.from_user.id,
        "itemId": item["id"],
        "itemName": item["name"],
        "price": int(item["price"]),
        "status": "PENDING",
        "createdAt": now_yangon(),
        "updatedAt": now_yangon(),
    }
    await orders_col.insert_one(order_doc)
    if OWNER_ID:
        try:
            await bot.send_message(OWNER_ID, f"🧾 <b>New Shop Order</b>\n━━━━━━━━━━━━\nOrder ID: <code>{order_id}</code>\nUser: {mention_html_from_user(cb.from_user)}\nItem: <b>{esc(item['name'])}</b>\nPrice: <b>{fmt(item['price'])}</b> {COIN}")
        except Exception:
            pass
    await cb.answer("Order created.")
    await cb.message.reply(
        f"🧾 <b>Order Created</b>\n━━━━━━━━━━━━\nOrder ID: <code>{order_id}</code>\nItem: <b>{esc(item['name'])}</b>\nPrice: <b>{fmt(item['price'])}</b> {COIN}\nStatus: <b>PENDING</b>\n\nOwner ကို slip ပို့ပြီး confirm လုပ်ပါ။"
    )


@router.message(Command("orders"))
async def cmd_orders(message: Message) -> None:
    t = await ensure_treasury()
    if not is_owner(message.from_user.id, t):
        await reply_html(message, "⛔ Owner only.")
        return
    docs = await orders_col.find({}).sort("createdAt", -1).limit(20).to_list(length=20)
    if not docs:
        await reply_html(message, "No orders.")
        return
    lines = ["🧾 <b>Recent Orders</b>", "━━━━━━━━━━━━"]
    for o in docs:
        lines.append(f"• <code>{o['orderId']}</code> — <b>{esc(o['itemName'])}</b> — <b>{o['status']}</b>")
    await reply_html(message, "\n".join(lines))


# -------------------- Broadcast --------------------
@router.message(Command("broadcast"))
async def cmd_broadcast(message: Message) -> None:
    global current_broadcast
    t = await ensure_treasury()
    if not is_owner(message.from_user.id, t):
        await reply_html(message, "⛔ Owner only.")
        return
    text = (message.text or "")
    text = text.split(maxsplit=1)[1].strip() if len(text.split(maxsplit=1)) > 1 else ""
    source_message = None
    if not text and message.reply_to_message:
        source_message = message.reply_to_message
        text = message.reply_to_message.text or message.reply_to_message.caption or ""
    if not text and source_message is None:
        await reply_html(message, "📣 <b>Broadcast</b>\n━━━━━━━━━━━━\nUsage:\n• <code>/broadcast မင်္ဂလာပါ...</code>\n• (or) Reply to a message + <code>/broadcast</code>")
        return
    if current_broadcast and not current_broadcast.get("cancelled"):
        await reply_html(message, "⚠️ Broadcast တစ်ခု လက်ရှိ run နေပါတယ်။ ရပ်ချင်ရင် <code>/broadcastend</code> သုံးပါ။")
        return

    run_id = f"{int(time.time())}_{secrets.token_hex(3)}"
    progress = await reply_html(message, f"📣 Broadcasting…\nTarget: users + groups\nStatus: <b>Running</b>\nRun ID: <code>{run_id}</code>")
    current_broadcast = {
        "id": run_id,
        "cancelled": False,
        "ownerChatId": message.chat.id,
        "progressMessageId": progress.message_id,
        "startedAt": time.time(),
    }
    await config_col.update_one({"key": "treasury"}, {"$set": {"broadcastRunning": True, "broadcastRunId": run_id, "updatedAt": now_yangon()}})

    seen = set()
    targets: List[Tuple[int, str]] = []
    async for u in users_col.find({}, {"userId": 1}):
        uid = to_num(u.get("userId"))
        if uid and uid not in seen:
            seen.add(uid)
            targets.append((uid, "user"))
    async for g in groups_col.find({"approvalStatus": "approved"}, {"groupId": 1}):
        gid = to_num(g.get("groupId"))
        if gid and gid not in seen:
            seen.add(gid)
            targets.append((gid, "group"))

    ok = fail = skipped = user_sent = group_sent = 0
    stopped = False
    for i, (chat_id, kind) in enumerate(targets, start=1):
        if not current_broadcast or current_broadcast.get("cancelled"):
            stopped = True
            break

        success = False
        if source_message:
            success = await safe_copy_message(chat_id, source_message.chat.id, source_message.message_id)
        else:
            success = await safe_send_text(chat_id, text)
        if success:
            ok += 1
            if kind == "user":
                user_sent += 1
            else:
                group_sent += 1
        else:
            fail += 1

        if i % 25 == 0 and current_broadcast and current_broadcast.get("progressMessageId"):
            try:
                await bot.edit_message_text(
                    f"📣 <b>Broadcast Progress</b>\n━━━━━━━━━━━━\nRun ID: <code>{run_id}</code>\nProcessed: <b>{i}</b> / <b>{len(targets)}</b>\nUsers sent: <b>{user_sent}</b>\nGroups sent: <b>{group_sent}</b>\nSkipped: <b>{skipped}</b>\nFailed: <b>{fail}</b>\nStatus: <b>Running</b>",
                    chat_id=message.chat.id,
                    message_id=current_broadcast["progressMessageId"],
                )
            except Exception:
                pass
        await asyncio.sleep(0.02)

    progress_message_id = current_broadcast.get("progressMessageId") if current_broadcast else None
    current_broadcast = None
    await config_col.update_one({"key": "treasury"}, {"$set": {"broadcastRunning": False, "broadcastRunId": None, "updatedAt": now_yangon()}})
    if progress_message_id:
        await safe_delete(message.chat.id, progress_message_id)
    if stopped:
        await reply_html(message, f"🛑 Broadcast stopped.\n• Sent: <b>{ok}</b>\n• Users: <b>{user_sent}</b>\n• Groups: <b>{group_sent}</b>\n• Skipped: <b>{skipped}</b>\n• Failed: <b>{fail}</b>")
    else:
        await reply_html(message, f"✅ Broadcast done.\n• Total Sent: <b>{ok}</b>\n• Users: <b>{user_sent}</b>\n• Groups: <b>{group_sent}</b>\n• Skipped: <b>{skipped}</b>\n• Failed: <b>{fail}</b>")


@router.message(Command("broadcastend"))
async def cmd_broadcast_end(message: Message) -> None:
    global current_broadcast
    t = await ensure_treasury()
    if not is_owner(message.from_user.id, t):
        await reply_html(message, "⛔ Owner only.")
        return
    if not current_broadcast or current_broadcast.get("cancelled"):
        await config_col.update_one({"key": "treasury"}, {"$set": {"broadcastRunning": False, "broadcastRunId": None, "updatedAt": now_yangon()}})
        await reply_html(message, "ℹ️ လက်ရှိ run နေတဲ့ broadcast မရှိပါ။")
        return
    current_broadcast["cancelled"] = True
    owner_chat_id = current_broadcast.get("ownerChatId")
    progress_message_id = current_broadcast.get("progressMessageId")
    if owner_chat_id and progress_message_id:
        await safe_delete(owner_chat_id, progress_message_id)
    await config_col.update_one({"key": "treasury"}, {"$set": {"broadcastRunning": False, "broadcastRunId": None, "updatedAt": now_yangon()}})
    await reply_html(message, "🛑 လက်ရှိ broadcast ကို ရပ်တန့်ပြီး clear လုပ်ပြီးပါပြီ။")


# -------------------- Group approval --------------------
@router.message(Command("approve"))
async def cmd_approve(message: Message) -> None:
    if not is_group_message(message):
        await reply_html(message, "ℹ️ ဒီ command ကို group ထဲမှာပဲ သုံးနိုင်ပါတယ်။")
        return
    treasury = await ensure_treasury()
    if not is_owner(message.from_user.id, treasury):
        await reply_html(message, "⛔ <b>Owner only</b>")
        return
    g = await ensure_group(message.chat)
    if not g.get("botIsAdmin"):
        await reply_html(message, "⚠️ <b>Bot ကို Admin မပေးရသေးပါ</b>\n━━━━━━━━━━━━\nအရင်ဆုံး bot ကို admin ပေးပါ။")
        return
    await approve_group_by_id(message.chat.id, message.from_user.id)
    await reply_html(message, "✅ <b>Group Approved</b>\n━━━━━━━━━━━━\nဒီ group မှာ bot ကို အသုံးပြုလို့ရပါပြီ။")


@router.message(Command("reject"))
async def cmd_reject(message: Message) -> None:
    if not is_group_message(message):
        await reply_html(message, "ℹ️ ဒီ command ကို group ထဲမှာပဲ သုံးနိုင်ပါတယ်။")
        return
    treasury = await ensure_treasury()
    if not is_owner(message.from_user.id, treasury):
        await reply_html(message, "⛔ <b>Owner only</b>")
        return
    await reject_group_by_id(message.chat.id, message.from_user.id)
    await reply_html(message, "❌ <b>Group Rejected</b>\n━━━━━━━━━━━━\nဒီ group ကို approve မပေးထားပါ။")


@router.message(Command("groupstatus"))
async def cmd_groupstatus(message: Message) -> None:
    if not is_group_message(message):
        await reply_html(message, "ℹ️ ဒီ command ကို group ထဲမှာပဲ သုံးနိုင်ပါတယ်။")
        return
    g = await ensure_group(message.chat)
    await reply_html(
        message,
        f"👥 <b>Group Status</b>\n━━━━━━━━━━━━\nTitle: <b>{esc(g.get('title'))}</b>\nApproved: <b>{esc(g.get('approvalStatus'))}</b>\nBot Admin: <b>{'YES' if g.get('botIsAdmin') else 'NO'}</b>\nGroup ID: <code>{g.get('groupId')}</code>",
    )


@router.message(Command("admin"))
async def cmd_admin(message: Message) -> None:
    t = await ensure_treasury()
    if not is_owner(message.from_user.id, t):
        await reply_html(message, "⛔ Owner only.")
        return
    users_count = await users_col.count_documents({})
    groups_count = await groups_col.count_documents({})
    pending_orders = await orders_col.count_documents({"status": "PENDING"})
    await reply_html(message, admin_summary_text(t, users_count, groups_count, pending_orders))


# -------------------- Dice challenge --------------------
@router.message(F.text.regexp(r"^\.(dice)\s+(\d+)\s*$"))
async def cmd_dice(message: Message) -> None:
    if not await ensure_not_maintenance(message):
        return
    if not is_group_message(message):
        await reply_html(message, "ℹ️ <code>.dice</code> ကို group ထဲမှာပဲ သုံးနိုင်ပါတယ်။")
        return
    if not await ensure_group_approved(message):
        return
    bet = int((message.text or "").split()[1])
    if bet < DICE["min_bet"] or bet > DICE["max_bet"]:
        await reply_html(message, f"🎲 <b>Dice Duel</b>\n━━━━━━━━━━━\nUsage: Reply + <code>.dice 200</code>\nMin: <b>{fmt(DICE['min_bet'])}</b> {COIN}\nMax: <b>{fmt(DICE['max_bet'])}</b> {COIN}")
        return
    reply_from = message.reply_to_message.from_user if message.reply_to_message else None
    if not reply_from:
        await reply_html(message, "⚠️ <b>Reply လုပ်ပြီးသုံးပါ</b>\n━━━━━━━━━━━━\nExample: Reply + <code>.dice 200</code>")
        return
    if reply_from.is_bot:
        await reply_html(message, "🤖 Bot ကို challenge မလုပ်နိုင်ပါ။")
        return
    if reply_from.id == message.from_user.id:
        await reply_html(message, "😅 ကိုယ့်ကိုကိုယ် challenge မလုပ်နိုင်ပါ။")
        return
    if len(active_dice_challenges) >= DICE["max_active"]:
        await reply_html(message, "⛔ <b>Dice Busy</b>\n━━━━━━━━━━━\nအခု Dice challenge များလွန်းနေပါတယ်။ ခဏနားပြီး ပြန်ကြိုးစားပါ။")
        return

    await ensure_user(message.from_user)
    await ensure_user(reply_from)
    challenger_user = await get_user(message.from_user.id)
    if to_num(challenger_user.get("balance")) < bet:
        lack = max(0, bet - to_num(challenger_user.get("balance")))
        await reply_html(message, f"❌ <b>လက်ကျန်ငွေ မလုံလောက်ပါ</b>\n━━━━━━━━━━━\nBet: <b>{fmt(bet)}</b> {COIN}\nYour Balance: <b>{fmt(challenger_user.get('balance'))}</b> {COIN}\nNeed More: <b>{fmt(lack)}</b> {COIN}")
        return

    cid = secrets.token_hex(6)
    sent = await reply_html(message, dice_challenge_text(message.from_user, reply_from, bet), reply_markup=challenge_keyboard("dice", cid))
    active_dice_challenges[cid] = {
        "id": cid,
        "chatId": message.chat.id,
        "msgId": sent.message_id,
        "challengerId": message.from_user.id,
        "opponentId": reply_from.id,
        "bet": bet,
        "status": "PENDING",
        "createdAt": time.time(),
    }


@router.callback_query(F.data.startswith("dice:"))
async def cb_dice(cb: CallbackQuery) -> None:
    global active_dice_challenges
    _, action, cid = cb.data.split(":")
    c = active_dice_challenges.get(cid)
    if not c:
        await cb.answer("Challenge not found.", show_alert=True)
        return
    if action == "cancel":
        if cb.from_user.id != c["challengerId"] and cb.from_user.id != OWNER_ID:
            await cb.answer("Only challenger can cancel.", show_alert=True)
            return
        c["status"] = "DONE"
        active_dice_challenges.pop(cid, None)
        await safe_edit(cb.message, "❌ <b>Dice Duel Cancelled</b>\n━━━━━━━━━━━━\nChallenge cancelled.")
        await cb.answer()
        return

    if action != "accept":
        await cb.answer()
        return

    if cb.from_user.id != c["opponentId"]:
        await cb.answer("Reply target only.", show_alert=True)
        return

    await ensure_user(cb.from_user)
    challenger = await get_user(c["challengerId"])
    opponent = await get_user(c["opponentId"])
    if to_num(challenger.get("balance")) < c["bet"]:
        active_dice_challenges.pop(cid, None)
        await safe_edit(cb.message, "❌ Challenger balance insufficient.")
        await cb.answer()
        return
    if to_num(opponent.get("balance")) < c["bet"]:
        active_dice_challenges.pop(cid, None)
        await safe_edit(cb.message, "❌ Opponent balance insufficient.")
        await cb.answer()
        return

    try:
        await user_pay_to_treasury(c["challengerId"], c["bet"], {"type": "dice_bet", "challengeId": cid})
        await user_pay_to_treasury(c["opponentId"], c["bet"], {"type": "dice_bet", "challengeId": cid})
    except Exception as e:
        active_dice_challenges.pop(cid, None)
        await safe_edit(cb.message, "⚠️ Bet transfer error.")
        await cb.answer()
        return

    await safe_edit(cb.message, "🎲 <b>Dice Duel Result</b>\n━━━━━━━━━━━━\nRolling dice...")
    await asyncio.sleep(0.8)

    d1_msg = await bot.send_dice(c["chatId"], emoji=DiceEmoji.DICE, reply_to_message_id=c["msgId"])
    await asyncio.sleep(1.1)
    d2_msg = await bot.send_dice(c["chatId"], emoji=DiceEmoji.DICE, reply_to_message_id=c["msgId"])

    d1 = int(d1_msg.dice.value)
    d2 = int(d2_msg.dice.value)

    challenger_label = user_doc_label_html(challenger)
    opponent_label = user_doc_label_html(opponent)
    pot = c["bet"] * 2
    house_cut = int(round(pot * 0.02))

    if d1 > d2:
        winner_id = c["challengerId"]
        winner_label = challenger_label
        payout = pot - house_cut
        try:
            await treasury_pay_to_user(winner_id, payout, {"type": "dice_win", "challengeId": cid, "pot": pot})
        except Exception:
            payout = 0
        text = (
            "🎲 <b>Dice Duel Result</b>\n"
            "━━━━━━━━━━━━\n"
            f"စိန်ခေါ်သူ: {challenger_label} → <b>{d1}</b>\n"
            f"လက်ခံသူ: {opponent_label} → <b>{d2}</b>\n"
            "━━━━━━━━━━━━\n"
            f"🏆 Winner: {winner_label}\n"
            f"💰 Pot: <b>{fmt(pot)}</b> {COIN}\n"
            f"✅ Winner gets: <b>{fmt(payout)}</b> {COIN} (98%)\n"
            f"🏦 House cut: <b>2%</b> ({fmt(house_cut)} {COIN})"
        )
    elif d2 > d1:
        winner_id = c["opponentId"]
        winner_label = opponent_label
        payout = pot - house_cut
        try:
            await treasury_pay_to_user(winner_id, payout, {"type": "dice_win", "challengeId": cid, "pot": pot})
        except Exception:
            payout = 0
        text = (
            "🎲 <b>Dice Duel Result</b>\n"
            "━━━━━━━━━━━━\n"
            f"စိန်ခေါ်သူ: {challenger_label} → <b>{d1}</b>\n"
            f"လက်ခံသူ: {opponent_label} → <b>{d2}</b>\n"
            "━━━━━━━━━━━━\n"
            f"🏆 Winner: {winner_label}\n"
            f"💰 Pot: <b>{fmt(pot)}</b> {COIN}\n"
            f"✅ Winner gets: <b>{fmt(payout)}</b> {COIN} (98%)\n"
            f"🏦 House cut: <b>2%</b> ({fmt(house_cut)} {COIN})"
        )
    else:
        await treasury_pay_to_user(c["challengerId"], c["bet"], {"type": "dice_refund", "challengeId": cid})
        await treasury_pay_to_user(c["opponentId"], c["bet"], {"type": "dice_refund", "challengeId": cid})
        text = (
            "🎲 <b>Dice Duel Result</b>\n"
            "━━━━━━━━━━━━\n"
            f"စိန်ခေါ်သူ: {challenger_label} → <b>{d1}</b>\n"
            f"လက်ခံသူ: {opponent_label} → <b>{d2}</b>\n"
            "━━━━━━━━━━━━\n"
            "🤝 <b>TIE!</b> — Bet refund ပြန်ပေးပါပြီ"
        )

    active_dice_challenges.pop(cid, None)
    await safe_edit(cb.message, text)
    await cb.answer()


# -------------------- Shan challenge --------------------
@router.message(F.text.regexp(r"^\.(shan)\s+(\d+)\s*$"))
async def cmd_shan(message: Message) -> None:
    if not await ensure_not_maintenance(message):
        return
    if not is_group_message(message):
        await reply_html(message, "ℹ️ <code>.shan</code> ကို group ထဲမှာပဲ သုံးနိုင်ပါတယ်။")
        return
    if not await ensure_group_approved(message):
        return
    bet = int((message.text or "").split()[1])
    if bet < SHAN["min_bet"] or bet > SHAN["max_bet"]:
        await reply_html(message, f"🃏 <b>Shan Duel</b>\n━━━━━━━━━━━\nUsage: Reply + <code>.shan 500</code>\nMin: <b>{fmt(SHAN['min_bet'])}</b> {COIN}\nMax: <b>{fmt(SHAN['max_bet'])}</b> {COIN}")
        return
    reply_from = message.reply_to_message.from_user if message.reply_to_message else None
    if not reply_from:
        await reply_html(message, "⚠️ <b>Reply လုပ်ပြီးသုံးပါ</b>\n━━━━━━━━━━━━\nExample: Reply + <code>.shan 500</code>")
        return
    if reply_from.is_bot:
        await reply_html(message, "🤖 Bot ကို challenge မလုပ်နိုင်ပါ။")
        return
    if reply_from.id == message.from_user.id:
        await reply_html(message, "😅 ကိုယ့်ကိုကိုယ် challenge မလုပ်နိုင်ပါ။")
        return
    if len(active_shan_challenges) >= SHAN["max_active"]:
        await reply_html(message, "⛔ <b>Shan Busy</b>\n━━━━━━━━━━━\nအခု Shan challenge များနေပါတယ်။ ခဏနားပြီး ပြန်ကြိုးစားပါ။")
        return

    await ensure_user(message.from_user)
    await ensure_user(reply_from)
    challenger_user = await get_user(message.from_user.id)
    if to_num(challenger_user.get("balance")) < bet:
        lack = max(0, bet - to_num(challenger_user.get("balance")))
        await reply_html(message, f"❌ <b>လက်ကျန်ငွေ မလုံလောက်ပါ</b>\n━━━━━━━━━━━\nBet: <b>{fmt(bet)}</b> {COIN}\nYour Balance: <b>{fmt(challenger_user.get('balance'))}</b> {COIN}\nNeed More: <b>{fmt(lack)}</b> {COIN}")
        return
    cid = secrets.token_hex(6)
    sent = await reply_html(message, shan_challenge_text(message.from_user, reply_from, bet), reply_markup=challenge_keyboard("shan", cid))
    active_shan_challenges[cid] = {
        "id": cid,
        "chatId": message.chat.id,
        "msgId": sent.message_id,
        "challengerId": message.from_user.id,
        "opponentId": reply_from.id,
        "bet": bet,
        "status": "PENDING",
        "createdAt": time.time(),
    }


@router.callback_query(F.data.startswith("shan:"))
async def cb_shan(cb: CallbackQuery) -> None:
    _, action, cid = cb.data.split(":")
    c = active_shan_challenges.get(cid)
    if not c:
        await cb.answer("Challenge not found.", show_alert=True)
        return
    if action == "cancel":
        if cb.from_user.id != c["challengerId"] and cb.from_user.id != OWNER_ID:
            await cb.answer("Only challenger can cancel.", show_alert=True)
            return
        active_shan_challenges.pop(cid, None)
        await safe_edit(cb.message, "❌ <b>Shan Duel Cancelled</b>\n━━━━━━━━━━━━\nChallenge cancelled.")
        await cb.answer()
        return
    if cb.from_user.id != c["opponentId"]:
        await cb.answer("Reply target only.", show_alert=True)
        return

    challenger = await get_user(c["challengerId"])
    opponent = await get_user(c["opponentId"])
    if to_num(challenger.get("balance")) < c["bet"]:
        active_shan_challenges.pop(cid, None)
        await safe_edit(cb.message, "❌ Challenger balance insufficient.")
        await cb.answer()
        return
    if to_num(opponent.get("balance")) < c["bet"]:
        active_shan_challenges.pop(cid, None)
        await safe_edit(cb.message, "❌ Opponent balance insufficient.")
        await cb.answer()
        return

    try:
        await user_pay_to_treasury(c["challengerId"], c["bet"], {"type": "shan_bet", "challengeId": cid})
        await user_pay_to_treasury(c["opponentId"], c["bet"], {"type": "shan_bet", "challengeId": cid})
    except Exception:
        active_shan_challenges.pop(cid, None)
        await safe_edit(cb.message, "⚠️ Bet transfer error.")
        await cb.answer()
        return

    t = await ensure_treasury()
    out = draw_shan_hands_for_users(challenger, opponent, normalize_vip_win_rate(t.get("vipWinRate"), 90))
    cards_a = out["cardsA"]
    cards_b = out["cardsB"]
    result = out["result"]
    pot = c["bet"] * 2
    house_cut = int(round(pot * 0.02))

    extra = 0
    payout = 0
    winner_label = None
    winner_id = None

    if result["winner"] == "A":
        winner_id = c["challengerId"]
        winner_label = user_doc_label_html(challenger)
        payout = pot - house_cut
        if result["infoA"]["name"] == "Suit Triple":
            extra = c["bet"]
        treasury_now = await get_treasury()
        payout = min(payout + extra, to_num(treasury_now.get("ownerBalance")))
        await treasury_pay_to_user(winner_id, payout, {"type": "shan_win", "challengeId": cid, "pot": pot})
    elif result["winner"] == "B":
        winner_id = c["opponentId"]
        winner_label = user_doc_label_html(opponent)
        payout = pot - house_cut
        if result["infoB"]["name"] == "Suit Triple":
            extra = c["bet"]
        treasury_now = await get_treasury()
        payout = min(payout + extra, to_num(treasury_now.get("ownerBalance")))
        await treasury_pay_to_user(winner_id, payout, {"type": "shan_win", "challengeId": cid, "pot": pot})
    else:
        await treasury_pay_to_user(c["challengerId"], c["bet"], {"type": "shan_refund", "challengeId": cid})
        await treasury_pay_to_user(c["opponentId"], c["bet"], {"type": "shan_refund", "challengeId": cid})

    challenger_label = user_doc_label_html(challenger)
    opponent_label = user_doc_label_html(opponent)
    text = (
        "🃏 <b>Shan Duel Result</b>\n"
        "━━━━━━━━━━━━\n"
        f"စိန်ခေါ်သူ: {challenger_label}\n"
        f"<pre>{esc(render_cards_row(cards_a))}</pre>\n"
        f"Hand: <b>{esc(result['infoA']['name'])}</b>\n"
        f"Point: <b>{result['infoA']['points']}</b>\n\n"
        f"လက်ခံသူ: {opponent_label}\n"
        f"<pre>{esc(render_cards_row(cards_b))}</pre>\n"
        f"Hand: <b>{esc(result['infoB']['name'])}</b>\n"
        f"Point: <b>{result['infoB']['points']}</b>\n"
        "━━━━━━━━━━━━\n"
    )
    if result["winner"] == "TIE":
        text += "🤝 <b>TIE!</b> — Bet refund ပြန်ပေးပါပြီ"
    else:
        text += f"🏆 Winner: {winner_label}\n💰 Pot: <b>{fmt(pot)}</b> {COIN}\n✅ Winner gets: <b>{fmt(payout)}</b> {COIN}"
        if extra:
            text += f"\n🎁 Suit Triple Bonus: <b>{fmt(extra)}</b> {COIN}"
        text += f"\n🏦 House cut: <b>2%</b> ({fmt(house_cut)} {COIN})"
    active_shan_challenges.pop(cid, None)
    await safe_edit(cb.message, text)
    await cb.answer()


# -------------------- Slot --------------------
@router.message(F.text.regexp(r"^\.(slot)\s+(\d+)\s*$"))
async def cmd_slot(message: Message) -> None:
    if not await ensure_not_maintenance(message):
        return
    if not is_group_message(message):
        await reply_html(message, "ℹ️ <code>.slot</code> ကို group ထဲမှာပဲ သုံးနိုင်ပါတယ်။")
        return
    if not await ensure_group_approved(message):
        return
    user_id = message.from_user.id
    bet = int((message.text or "").split()[1])
    if len(active_slots) >= MAX_ACTIVE_SLOTS and user_id not in active_slots:
        await reply_html(message, f"⛔ <b>Slot Busy</b>\n━━━━━━━━━━━━━━\nအခုတလော တစ်ပြိုင်နက် ဆော့နေသူများလို့ ခဏနားပြီး ပြန်ကြိုးစားပါ။\n(Max active: <b>{MAX_ACTIVE_SLOTS}</b>)")
        return
    last = last_slot_at.get(user_id, 0)
    if time.time() * 1000 - last < SLOT["cooldown_ms"]:
        sec = int((SLOT["cooldown_ms"] - (time.time() * 1000 - last)) / 1000 + 0.999)
        await reply_html(message, f"⏳ ခဏစောင့်ပါ… ({sec}s) နောက်တစ်ခါ spin လုပ်နိုင်ပါမယ်။")
        return
    if bet < SLOT["min_bet"] or bet > SLOT["max_bet"]:
        await reply_html(message, f"🎰 <b>BIKA Pro Slot</b>\n━━━━━━━━━━━━━\nUsage: <code>.slot 1000</code>\nMin: <b>{fmt(SLOT['min_bet'])}</b> {COIN}\nMax: <b>{fmt(SLOT['max_bet'])}</b> {COIN}")
        return

    init_a = random_symbol_from_reel(SLOT["reels"][0])
    init_b = random_symbol_from_reel(SLOT["reels"][1])
    init_c = random_symbol_from_reel(SLOT["reels"][2])
    sent = await reply_html(message, spin_frame(init_a, init_b, init_c, "reels spinning…", "spin"))

    await ensure_user(message.from_user)
    treasury = await ensure_treasury()
    slot_user = await get_user(message.from_user.id)

    active_slots.add(user_id)
    try:
        try:
            await user_pay_to_treasury(user_id, bet, {"type": "slot_bet", "bet": bet, "chatId": message.chat.id})
        except Exception as e:
            if "USER_INSUFFICIENT" in str(e):
                await safe_edit(sent, f"❌ <b>Balance မလုံလောက်ပါ</b>\n━━━━━━━━━━━━━━\nSlot ဆော့ဖို့ လက်ကျန်ငွေ မလုံလောက်ပါ။\nDaily claim / gift / addbalance နဲ့ ငွေစုဆောင်းပြီးမှ ပြန်လာပါ။")
                return
            await safe_edit(sent, "⚠️ Error ဖြစ်သွားပါတယ်။")
            return

        payouts = current_slot_payouts(normalize_rtp(treasury.get("slotRtp"), 0.90))
        final_a, final_b, final_c = spin_slot_outcome_for_user(slot_user, normalize_vip_win_rate(treasury.get("vipWinRate"), 90), normalize_rtp(treasury.get("slotRtp"), 0.90), payouts)
        mult = calc_multiplier(final_a, final_b, final_c, payouts)
        payout = int(bet * mult) if mult > 0 else 0
        if payout > 0:
            tr = await get_treasury()
            owner_bal = to_num(tr.get("ownerBalance"))
            max_pay = int(owner_bal * SLOT["cap_percent"])
            payout = min(payout, max_pay, owner_bal)

        win = payout > 0
        is_jackpot = final_a == final_b == final_c == "7"

        frames = [
            (random_symbol_from_reel(SLOT["reels"][0]), random_symbol_from_reel(SLOT["reels"][1]), random_symbol_from_reel(SLOT["reels"][2]), "rolling…", "spin", 0.22),
            (final_a, random_symbol_from_reel(SLOT["reels"][1]), random_symbol_from_reel(SLOT["reels"][2]), "locking…", "spin", 0.24),
            (final_a, final_b, final_c, "result!", "jackpot" if is_jackpot else ("glow" if win else "lose"), 0.26),
        ]
        for a, b, c, note, vibe, delay in frames:
            await asyncio.sleep(delay)
            try:
                await safe_edit(sent, spin_frame(a, b, c, note, vibe))
            except Exception:
                pass

        if payout > 0:
            try:
                await treasury_pay_to_user(user_id, payout, {"type": "slot_win", "bet": bet, "payout": payout, "combo": f"{final_a},{final_b},{final_c}"})
            except Exception:
                try:
                    await treasury_pay_to_user(user_id, bet, {"type": "slot_refund", "reason": "payout_fail"})
                except Exception:
                    pass
                await safe_edit(sent, f"🎰 <b>BIKA Pro Slot</b>\n━━━━━━━━━━━━━━\n<pre>{esc(slot_art(final_a, final_b, final_c))}</pre>\n━━━━━━━━━━━━━━\n⚠️ Payout error ဖြစ်လို့ refund ပြန်ပေးလိုက်ပါတယ်။")
                last_slot_at[user_id] = time.time() * 1000
                return

        last_slot_at[user_id] = time.time() * 1000
        net = payout - bet
        headline = "❌ LOSE" if payout == 0 else ("🏆 JACKPOT 777!" if is_jackpot else "✅ WIN")
        final_msg = (
            "🎰 <b>BIKA Pro Slot</b>\n"
            "━━━━━━━━━━━\n"
            f"<pre>{esc(slot_art(final_a, final_b, final_c))}</pre>\n"
            "━━━━━━━━━━━\n"
            f"<b>{esc(headline)}</b>\n"
            f"Bet: <b>{fmt(bet)}</b> {COIN}\n"
            f"Payout: <b>{fmt(payout)}</b> {COIN}\n"
            f"Net: <b>{fmt(net)}</b> {COIN}"
        )
        await safe_edit(sent, final_msg)
    finally:
        active_slots.discard(user_id)


# -------------------- Misc --------------------
@router.message(Command("group"))
async def cmd_group_help(message: Message) -> None:
    await reply_html(message, "Group Commands:\n• /dailyclaim\n• .slot 100\n• .dice 200\n• .shan 500\n• .mybalance\n• .top10\n• /shop")


# -------------------- Startup / main --------------------
async def on_startup() -> None:
    await ensure_indexes()
    await ensure_treasury()
    me = await bot.get_me()
    log.info("Bot started in polling mode as @%s", me.username)
    # set commands
    try:
        await bot.set_my_commands([
            BotCommand(command="start", description="Start bot"),
            BotCommand(command="ping", description="Ping"),
            BotCommand(command="status", description="Bot status"),
            BotCommand(command="dailyclaim", description="Daily reward"),
            BotCommand(command="shop", description="Open shop"),
            BotCommand(command="balance", description="Private balance"),
            BotCommand(command="gift", description="Gift balance"),
        ])
    except Exception:
        pass


async def on_shutdown() -> None:
    try:
        await bot.session.close()
    except Exception:
        pass
    mongo.close()


async def main() -> None:
    await on_startup()
    try:
        await dp.start_polling(bot, allowed_updates=dp.resolve_used_update_types())
    finally:
        await on_shutdown()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except (KeyboardInterrupt, SystemExit):
        pass
