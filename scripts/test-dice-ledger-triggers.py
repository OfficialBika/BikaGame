#!/usr/bin/env python3
"""Execute the actual SQLite trigger definitions extracted from economy.js."""
import json
import re
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = (ROOT / "tgcloud/lib/economy.js").read_text(encoding="utf-8")
MATCH = re.search(
    r"const triggerSql = \\[\\s*`(.*?)`,\\s*`(.*?)`\\s*\\];",
    SOURCE,
    re.DOTALL,
)
REFUND_MATCH = re.search(
    r"const refundTriggerSql = \\[\\s*`(.*?)`,\\s*`(.*?)`\\s*\\];",
    SOURCE,
    re.DOTALL,
)
assert MATCH, "Could not extract triggerSql definitions from economy.js"
assert REFUND_MATCH, "Could not extract refundTriggerSql definitions from economy.js"
TRIGGERS = MATCH.groups() + REFUND_MATCH.groups()
assert "bika_transactions_before_insert" in TRIGGERS[0]
assert "bika_transactions_after_insert" in TRIGGERS[1]
assert "bika_transactions_refunds_before_insert" in TRIGGERS[2]
assert "bika_transactions_refunds_after_insert" in TRIGGERS[3]
assert "NEW.refunds" in TRIGGERS[2] and "NEW.refunds" in TRIGGERS[3]


def database():
    con = sqlite3.connect(":memory:")
    con.row_factory = sqlite3.Row
    con.executescript("""
      CREATE TABLE users (
        tg_id INTEGER PRIMARY KEY, balance INTEGER NOT NULL DEFAULT 0,
        total_won INTEGER NOT NULL DEFAULT 0, total_lost INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER
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
      INSERT INTO users VALUES (101, 500, 0, 0, 1), (202, 500, 0, 0, 1);
      INSERT INTO treasury VALUES ('treasury', 0, 1);
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


if __name__ == "__main__":
    test_winner_accounting_and_idempotency()
    test_tie_refund_does_not_count_as_winnings()
    test_insufficient_balance_fails_without_partial_write()
    print("SQLite ledger trigger tests passed (winner, tie refund, idempotency, insufficient balance).")
