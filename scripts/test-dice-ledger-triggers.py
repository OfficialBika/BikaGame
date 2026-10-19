#!/usr/bin/env python3
"""Execute the actual SQLite trigger definitions extracted from economy.js."""
import json
import re
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = (ROOT / "tgcloud/lib/economy.js").read_text(encoding="utf-8")
def extract_template_array(source, name):
    """Extract the two backtick strings in a known const array without fragile escaping."""
    marker = "const " + name + " = ["
    start = source.find(marker)
    if start < 0:
        return None
    start = source.find("[", start) + 1
    end = source.find("];", start)
    if end < 0:
        return None
    body = source[start:end]
    pieces = re.findall(r"`([\s\S]*?)`", body)
    return pieces if len(pieces) == 2 else None


MATCH = extract_template_array(SOURCE, "triggerSql")
REFUND_MATCH = extract_template_array(SOURCE, "refundTriggerSql")
DAILY_MATCH = extract_template_array(SOURCE, "dailyClaimTriggerSql")
TWO_D_MATCH = extract_template_array(SOURCE, "twoDTriggerSql")
assert MATCH, "Could not extract triggerSql definitions from economy.js"
assert REFUND_MATCH, "Could not extract refundTriggerSql definitions from economy.js"
assert DAILY_MATCH, "Could not extract dailyClaimTriggerSql definitions from economy.js"
assert TWO_D_MATCH, "Could not extract twoDTriggerSql definitions from economy.js"
TRIGGERS = tuple(MATCH) + tuple(REFUND_MATCH) + tuple(DAILY_MATCH) + tuple(TWO_D_MATCH)
assert "bika_transactions_before_insert" in TRIGGERS[0]
assert "bika_transactions_after_insert" in TRIGGERS[1]
assert "bika_transactions_refunds_before_insert" in TRIGGERS[2]
assert "bika_transactions_refunds_after_insert" in TRIGGERS[3]
assert "NEW.refunds" in TRIGGERS[2] and "NEW.refunds" in TRIGGERS[3]
assert "bika_transactions_daily_claim_before_insert" in TRIGGERS[4]
assert "bika_transactions_daily_claim_after_insert" in TRIGGERS[5]
assert "bika_transactions_two_d_before_insert" in TRIGGERS[6]
assert "bika_transactions_two_d_after_insert" in TRIGGERS[7]


def database():
    con = sqlite3.connect(":memory:")
    con.row_factory = sqlite3.Row
    con.executescript("""
      CREATE TABLE users (
        tg_id INTEGER PRIMARY KEY, balance INTEGER NOT NULL DEFAULT 0,
        total_won INTEGER NOT NULL DEFAULT 0, total_lost INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER, daily_claimed_at INTEGER
      );
      CREATE TABLE treasury (
        key TEXT PRIMARY KEY, owner_balance INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER
      );
      CREATE TABLE idempotency_keys (
        key TEXT PRIMARY KEY, kind TEXT, user_id INTEGER, created_at INTEGER
      );
      CREATE TABLE game_history (
        id INTEGER PRIMARY KEY, user_id INTEGER, game TEXT, bet INTEGER, payout INTEGER,
        multiplier REAL, result TEXT, title TEXT, outcome TEXT, net INTEGER,
        settlement_id TEXT, created_at INTEGER
      );
      CREATE TABLE payment_events (
        id TEXT PRIMARY KEY, user_id INTEGER, stars INTEGER, amount INTEGER,
        status TEXT, payload TEXT, telegram_payment_charge_id TEXT,
        invoice_payload TEXT, created_at INTEGER, updated_at INTEGER
      );
      CREATE TABLE two_d_events (
        id TEXT PRIMARY KEY, date_key TEXT UNIQUE, status TEXT NOT NULL,
        close_at INTEGER, created_at INTEGER, updated_at INTEGER
      );
      CREATE TABLE two_d_bets (
        id TEXT PRIMARY KEY, event_id TEXT NOT NULL, user_id INTEGER NOT NULL,
        number TEXT NOT NULL, amount INTEGER NOT NULL, potential_win INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'pending', data TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE TABLE two_d_positions (
        id TEXT PRIMARY KEY, event_id TEXT NOT NULL, user_id INTEGER NOT NULL,
        number TEXT NOT NULL, amount INTEGER NOT NULL DEFAULT 0, data TEXT, updated_at INTEGER NOT NULL
      );
      CREATE TABLE transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT, from_user_id TEXT,
        to_user_id TEXT, amount INTEGER NOT NULL, idempotency_key TEXT UNIQUE,
        account_user_id INTEGER, balance_delta INTEGER, required_balance INTEGER,
        total_won_delta INTEGER, total_lost_delta INTEGER, treasury_delta INTEGER,
        required_treasury INTEGER, from_account_user_id INTEGER, to_account_user_id INTEGER,
        payouts TEXT, refunds TEXT, histories TEXT, game_key TEXT, history_user_id INTEGER,
        bet_amount INTEGER, payout_amount INTEGER, multiplier REAL, game_result TEXT,
        meta TEXT, created_at INTEGER NOT NULL
      );
      INSERT INTO users VALUES (101, 500, 0, 0, 1, NULL), (202, 500, 0, 0, 1, NULL);
      INSERT INTO treasury VALUES ('treasury', 0, 1);
      INSERT INTO two_d_events VALUES ('event-open', '2026-10-19-am', 'open', 9999999999, 123, 123);
      INSERT INTO two_d_events VALUES ('event-closed', '2026-10-18-pm', 'closed', 9999999999, 123, 123);
    """)
    for trigger in TRIGGERS:
        con.executescript(trigger + ";")
    return con


def settlement_row(settlement_id, winner_id):
    bet = 100
    payout = 196
    tie = winner_id is None
    payouts = [] if tie else [{"userId": winner_id, "amount": payout}]
    refunds = [{"userId": 101, "amount": bet}, {"userId": 202, "amount": bet}] if tie else []
    histories = []
    for user_id in (101, 202):
        did_win = not tie and user_id == winner_id
        user_payout = bet if tie else payout if did_win else 0
        histories.append({
            "userId": user_id,
            "game": "dice",
            "bet": bet,
            "payout": user_payout,
            "multiplier": user_payout / bet,
            "result": {"winner": "TIE" if tie else "A" if winner_id == 101 else "B"},
            "title": "DICE Duel",
            "outcome": "refund" if tie else "win" if did_win else "lose",
        })
    return (
        "dice_settlement", str(settlement_id), bet, 101, -bet, bet, 0, bet,
        bet * 2 - sum(x["amount"] for x in payouts + refunds), 0, 202,
        json.dumps(payouts), json.dumps(refunds), json.dumps(histories),
    )


INSERT = """
INSERT INTO transactions (
  type, idempotency_key, amount, account_user_id, balance_delta, required_balance,
  total_won_delta, total_lost_delta, treasury_delta, required_treasury,
  from_account_user_id, payouts, refunds, histories, created_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 123)
"""


def apply(con, settlement_id, winner_id):
    con.execute(INSERT, settlement_row(settlement_id, winner_id))


def test_winner_accounting_and_idempotency():
    con = database()
    apply(con, "winner-a", 101)
    users = {row["tg_id"]: dict(row) for row in con.execute("SELECT * FROM users")}
    treasury = con.execute("SELECT owner_balance FROM treasury").fetchone()[0]
    assert users[101]["balance"] == 596 and users[202]["balance"] == 400, users
    assert treasury == 4, treasury
    assert users[101]["total_won"] == 196
    assert users[101]["total_lost"] == 100 and users[202]["total_lost"] == 100
    assert con.execute("SELECT COUNT(*) FROM game_history").fetchone()[0] == 2

    # The same settlement key is ignored before any balance trigger fires again.
    apply(con, "winner-a", 101)
    assert con.execute("SELECT balance FROM users WHERE tg_id=101").fetchone()[0] == 596
    assert con.execute("SELECT COUNT(*) FROM transactions").fetchone()[0] == 1


def test_tie_refund_does_not_count_as_winnings():
    con = database()
    apply(con, "tie", None)
    users = {row["tg_id"]: dict(row) for row in con.execute("SELECT * FROM users")}
    treasury = con.execute("SELECT owner_balance FROM treasury").fetchone()[0]
    assert users[101]["balance"] == users[202]["balance"] == 500, users
    assert treasury == 0
    assert users[101]["total_lost"] == users[202]["total_lost"] == 100
    assert users[101]["total_won"] == users[202]["total_won"] == 0
    histories = con.execute("SELECT outcome, net FROM game_history ORDER BY user_id").fetchall()
    assert [(row["outcome"], row["net"]) for row in histories] == [("refund", 0), ("refund", 0)]


def test_insufficient_balance_fails_without_partial_write():
    con = database()
    con.execute("UPDATE users SET balance=50 WHERE tg_id=202")
    row = list(settlement_row("insufficient", 101))
    row[6] = 0
    try:
        con.execute(INSERT, row)
    except sqlite3.IntegrityError as exc:
        assert "USER_INSUFFICIENT" in str(exc)
    else:
        raise AssertionError("Expected insufficient target balance to abort settlement")
    assert con.execute("SELECT balance FROM users WHERE tg_id=101").fetchone()[0] == 500
    assert con.execute("SELECT balance FROM users WHERE tg_id=202").fetchone()[0] == 50
    assert con.execute("SELECT COUNT(*) FROM transactions").fetchone()[0] == 0
    assert con.execute("SELECT COUNT(*) FROM game_history").fetchone()[0] == 0


def two_d_transaction(con, key, event_id, user_id, lines, source_message_id=1):
    total = sum(int(line["amount"]) for line in lines)
    meta = {
        "eventId": event_id,
        "lines": lines,
        "total": total,
        "sourceChatId": "-100777",
        "sourceMessageId": str(source_message_id),
    }
    return con.execute("""
      INSERT INTO transactions (
        type, from_user_id, to_user_id, amount, idempotency_key, account_user_id,
        balance_delta, required_balance, total_won_delta, total_lost_delta,
        treasury_delta, required_treasury, bet_amount, payout_amount, meta, created_at
      ) VALUES ('two_d_bet', ?, 'TREASURY', ?, ?, ?, ?, ?, 0, ?, ?, 0, ?, 0, ?, 123)
    """, (str(user_id), total, key, user_id, -total, total, total, total, total, json.dumps(meta)))


def test_two_d_bet_ledger_and_position_triggers():
    con = database()
    lines = [
        {"number": "45", "amount": 200, "potentialWin": 8000},
        {"number": "54", "amount": 300, "potentialWin": 12000},
    ]
    two_d_transaction(con, "2d-bet-a", "event-open", 101, lines, 101)
    user = con.execute("SELECT * FROM users WHERE tg_id=101").fetchone()
    treasury = con.execute("SELECT owner_balance FROM treasury WHERE key='treasury'").fetchone()[0]
    assert user["balance"] == 0, dict(user)
    assert user["total_lost"] == 500, dict(user)
    assert treasury == 500, treasury
    bets = con.execute("SELECT number,amount,potential_win FROM two_d_bets ORDER BY number").fetchall()
    assert [(row["number"], row["amount"], row["potential_win"]) for row in bets] == [
        ("45", 200, 8000), ("54", 300, 12000)
    ]
    positions = {row["number"]: row["amount"] for row in con.execute("SELECT * FROM two_d_positions")}
    assert positions == {"45": 200, "54": 300}, positions

    # Duplicate updates cannot debit or accumulate positions twice.
    two_d_transaction(con, "2d-bet-a", "event-open", 101, lines, 101)
    assert con.execute("SELECT balance FROM users WHERE tg_id=101").fetchone()[0] == 0
    assert con.execute("SELECT owner_balance FROM treasury WHERE key='treasury'").fetchone()[0] == 500
    assert con.execute("SELECT COUNT(*) FROM two_d_bets").fetchone()[0] == 2
    assert con.execute("SELECT amount FROM two_d_positions WHERE number='45'").fetchone()[0] == 200

    # The per-number cap is enforced inside the same transaction trigger.
    con.execute("UPDATE users SET balance=250000 WHERE tg_id=101")
    two_d_transaction(con, "2d-cap-a", "event-open", 101, [
        {"number": "00", "amount": 200000, "potentialWin": 8000000},
    ], 102)
    balance_before = con.execute("SELECT balance FROM users WHERE tg_id=101").fetchone()[0]
    treasury_before = con.execute("SELECT owner_balance FROM treasury WHERE key='treasury'").fetchone()[0]
    try:
        two_d_transaction(con, "2d-cap-b", "event-open", 101, [
            {"number": "00", "amount": 200, "potentialWin": 8000},
        ], 103)
    except sqlite3.IntegrityError as exc:
        assert "TWO_D_NUMBER_LIMIT" in str(exc)
    else:
        raise AssertionError("Expected per-number 2D cap to abort the transaction")
    assert con.execute("SELECT balance FROM users WHERE tg_id=101").fetchone()[0] == balance_before
    assert con.execute("SELECT owner_balance FROM treasury WHERE key='treasury'").fetchone()[0] == treasury_before
    assert con.execute("SELECT COUNT(*) FROM two_d_bets WHERE number='00'").fetchone()[0] == 1

    try:
        two_d_transaction(con, "2d-closed", "event-closed", 202, [
            {"number": "12", "amount": 200, "potentialWin": 8000},
        ], 104)
    except sqlite3.IntegrityError as exc:
        assert "TWO_D_CLOSED" in str(exc)
    else:
        raise AssertionError("Expected closed 2D event to reject a bet")
    assert con.execute("SELECT balance FROM users WHERE tg_id=202").fetchone()[0] == 500
    assert con.execute("SELECT COUNT(*) FROM two_d_bets WHERE number='12'").fetchone()[0] == 0


def daily_claim(con, key, user_id, reward, day_start, created_at):
    meta = json.dumps({"source": "telegram_daily", "dayKey": "test-day", "dayStartUnix": day_start})
    return con.execute("""
      INSERT INTO transactions (
        type, from_user_id, to_user_id, amount, idempotency_key, account_user_id,
        balance_delta, required_balance, total_won_delta, total_lost_delta,
        treasury_delta, required_treasury, bet_amount, payout_amount, meta, created_at
      ) VALUES ('daily_claim', 'TREASURY', ?, ?, ?, ?, ?, 0, 0, 0, ?, ?, 0, ?, ?, ?)
    """, (str(user_id), reward, key, user_id, reward, -reward, reward, reward, meta, created_at))


def test_daily_claim_is_atomic_yangon_day_guarded_and_treasury_funded():
    con = database()
    con.execute("UPDATE treasury SET owner_balance=5000 WHERE key='treasury'")
    daily_claim(con, "daily-101-day-a", 101, 1000, 1799990000, 1800000000)
    user = dict(con.execute("SELECT * FROM users WHERE tg_id=101").fetchone())
    treasury = con.execute("SELECT owner_balance FROM treasury WHERE key='treasury'").fetchone()[0]
    assert user["balance"] == 1500, user
    assert user["daily_claimed_at"] == 1800000000, user
    assert user["total_won"] == 0, user
    assert treasury == 4000, treasury

    try:
        daily_claim(con, "daily-101-day-a-replay", 101, 1500, 1799990000, 1800000100)
    except sqlite3.IntegrityError as exc:
        assert "DAILY_ALREADY_CLAIMED" in str(exc)
    else:
        raise AssertionError("Expected same Yangon day claim to be rejected")
    user = dict(con.execute("SELECT * FROM users WHERE tg_id=101").fetchone())
    assert user["balance"] == 1500 and user["daily_claimed_at"] == 1800000000, user
    assert con.execute("SELECT owner_balance FROM treasury WHERE key='treasury'").fetchone()[0] == 4000
    assert con.execute("SELECT COUNT(*) FROM transactions WHERE type='daily_claim'").fetchone()[0] == 1

    # A claim after the next Yangon midnight is permitted and still bank-funded.
    daily_claim(con, "daily-101-day-b", 101, 500, 1800086400, 1800090000)
    user = dict(con.execute("SELECT * FROM users WHERE tg_id=101").fetchone())
    assert user["balance"] == 2000 and user["daily_claimed_at"] == 1800090000, user
    assert user["total_won"] == 0, user
    assert con.execute("SELECT owner_balance FROM treasury WHERE key='treasury'").fetchone()[0] == 3500

    # Insufficient treasury must not mark the user as having claimed.
    con.execute("UPDATE treasury SET owner_balance=0 WHERE key='treasury'")
    try:
        daily_claim(con, "daily-101-day-c", 101, 600, 1800172800, 1800180000)
    except sqlite3.IntegrityError as exc:
        assert "TREASURY_INSUFFICIENT" in str(exc)
    else:
        raise AssertionError("Expected treasury insufficiency to abort daily claim")
    user = dict(con.execute("SELECT * FROM users WHERE tg_id=101").fetchone())
    assert user["balance"] == 2000 and user["daily_claimed_at"] == 1800090000, user
    assert con.execute("SELECT COUNT(*) FROM transactions WHERE type='daily_claim'").fetchone()[0] == 2


def test_wallet_transfer_is_atomic_idempotent_and_not_a_game_result():
    con = database()
    transfer = """
      INSERT INTO transactions (
        type, from_user_id, to_user_id, amount, idempotency_key,
        from_account_user_id, to_account_user_id, created_at
      ) VALUES ('gift', '101', '202', 125, ?, 101, 202, 123)
    """
    con.execute(transfer, ("wallet-transfer:test-1",))
    balances = {row["tg_id"]: dict(row) for row in con.execute("SELECT * FROM users")}
    assert balances[101]["balance"] == 375, balances
    assert balances[202]["balance"] == 625, balances
    # Wallet transfers are not wagering wins/losses on the main bot either.
    assert balances[101]["total_lost"] == 0, balances
    assert balances[202]["total_won"] == 0, balances

    # Replayed request is ignored by the ledger idempotency trigger.
    con.execute(transfer, ("wallet-transfer:test-1",))
    balances = {row["tg_id"]: dict(row) for row in con.execute("SELECT * FROM users")}
    assert balances[101]["balance"] == 375 and balances[202]["balance"] == 625, balances
    assert con.execute("SELECT COUNT(*) FROM transactions WHERE type='gift'").fetchone()[0] == 1

    # Request more than the sender's remaining 375 balance. The whole ledger
    # insert must abort; recipient is untouched.
    try:
        con.execute(transfer.replace("VALUES ('gift', '101', '202', 125, ?", "VALUES ('gift', '101', '202', 400, ?"), ("wallet-transfer:insufficient",))
    except sqlite3.IntegrityError as exc:
        assert "USER_INSUFFICIENT" in str(exc)
    else:
        raise AssertionError("Expected insufficient wallet transfer to abort")
    balances = {row["tg_id"]: dict(row) for row in con.execute("SELECT * FROM users")}
    assert balances[101]["balance"] == 375 and balances[202]["balance"] == 625, balances
    assert con.execute("SELECT COUNT(*) FROM transactions WHERE type='gift'").fetchone()[0] == 1


if __name__ == "__main__":
    test_winner_accounting_and_idempotency()
    test_tie_refund_does_not_count_as_winnings()
    test_insufficient_balance_fails_without_partial_write()
    test_wallet_transfer_is_atomic_idempotent_and_not_a_game_result()
    test_daily_claim_is_atomic_yangon_day_guarded_and_treasury_funded()
    test_two_d_bet_ledger_and_position_triggers()
    print("SQLite ledger trigger tests passed (winner, tie refund, idempotency, insufficient balance, wallet transfer, daily claim, 2D bets and limits).")
