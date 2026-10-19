#!/usr/bin/env python3
"""Execute actual event-market ledger triggers against isolated SQLite fixtures."""
import json
import re
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = (ROOT / "tgcloud/lib/economy.js").read_text(encoding="utf-8")

def extract_template_array(source, name):
    marker = "const " + name + " = ["
    start = source.find(marker)
    if start < 0:
        return []
    start = source.find("[", start) + 1
    end = source.find("];", start)
    if end < 0:
        return []
    return re.findall(r"`([\s\S]*?)`", source[start:end])

BASE = extract_template_array(SOURCE, "triggerSql")
REFUNDS = extract_template_array(SOURCE, "refundTriggerSql")
MARKETS = extract_template_array(SOURCE, "eventMarketTriggerSql")
assert len(BASE) == 2, "Missing economy ledger triggers"
assert len(REFUNDS) == 2, "Missing refund triggers"
assert len(MARKETS) == 6, f"Expected sports, auction and shop trigger pairs, got {len(MARKETS)}"

SCHEMA = """
CREATE TABLE users(tg_id INTEGER PRIMARY KEY, balance INTEGER NOT NULL DEFAULT 0,
 total_won INTEGER NOT NULL DEFAULT 0,total_lost INTEGER NOT NULL DEFAULT 0,updated_at INTEGER);
CREATE TABLE treasury(key TEXT PRIMARY KEY,owner_balance INTEGER NOT NULL DEFAULT 0,updated_at INTEGER);
CREATE TABLE idempotency_keys(key TEXT PRIMARY KEY,kind TEXT,user_id INTEGER,created_at INTEGER);
CREATE TABLE game_history(id INTEGER PRIMARY KEY,user_id INTEGER,game TEXT,bet INTEGER,payout INTEGER,
 multiplier REAL,result TEXT,title TEXT,outcome TEXT,net INTEGER,settlement_id TEXT,created_at INTEGER);
CREATE TABLE payment_events(id TEXT PRIMARY KEY,user_id INTEGER,stars INTEGER,amount INTEGER,status TEXT,
 payload TEXT,telegram_payment_charge_id TEXT,invoice_payload TEXT,created_at INTEGER,updated_at INTEGER);
CREATE TABLE transactions(id INTEGER PRIMARY KEY AUTOINCREMENT,type TEXT,from_user_id TEXT,to_user_id TEXT,
 amount INTEGER NOT NULL,idempotency_key TEXT UNIQUE,account_user_id INTEGER,balance_delta INTEGER,required_balance INTEGER,
 total_won_delta INTEGER,total_lost_delta INTEGER,treasury_delta INTEGER,required_treasury INTEGER,
 from_account_user_id INTEGER,to_account_user_id INTEGER,payouts TEXT,refunds TEXT,histories TEXT,game_key TEXT,
 history_user_id INTEGER,bet_amount INTEGER,payout_amount INTEGER,multiplier REAL,game_result TEXT,meta TEXT,created_at INTEGER NOT NULL);
CREATE TABLE sports_events(id TEXT PRIMARY KEY,title TEXT,status TEXT,result TEXT,comment_chat_id INTEGER,
 thread_root_message_id INTEGER,thread_message_ids TEXT,data TEXT,created_at INTEGER,updated_at INTEGER);
CREATE TABLE sports_bets(id TEXT PRIMARY KEY,event_id TEXT,user_id INTEGER,choice TEXT,amount INTEGER,potential_win INTEGER,
 status TEXT,data TEXT,created_at INTEGER,updated_at INTEGER);
CREATE TABLE auctions(id TEXT PRIMARY KEY,auction_id TEXT UNIQUE,channel_id INTEGER,channel_message_id INTEGER,
 status TEXT,end_at INTEGER,current_bid INTEGER NOT NULL DEFAULT 0,highest_bidder_id INTEGER,data TEXT,created_at INTEGER,updated_at INTEGER);
CREATE TABLE auction_bids(id TEXT PRIMARY KEY,auction_id TEXT,bidder_id INTEGER,amount INTEGER,message_id INTEGER,data TEXT,created_at INTEGER);
CREATE TABLE shop_cards(id INTEGER PRIMARY KEY,bot_key TEXT,card_id TEXT,name TEXT,anime TEXT,rarity TEXT,media_url TEXT,
 owner_user_id INTEGER,status TEXT,price INTEGER,sold_to_user_id INTEGER,sold_at INTEGER,data TEXT,created_at INTEGER,updated_at INTEGER);
CREATE TABLE orders(id TEXT PRIMARY KEY,user_id INTEGER,kind TEXT,status TEXT,amount INTEGER,item_id TEXT,
 receipt_code TEXT,meta TEXT,created_at INTEGER,updated_at INTEGER);
"""
def database():
    con = sqlite3.connect(":memory:")
    con.row_factory = sqlite3.Row
    con.executescript(SCHEMA)
    con.executemany("INSERT INTO users(tg_id,balance,total_won,total_lost,updated_at) VALUES(?,?,0,0,1)",
                    [(101, 5000), (202, 5000), (303, 5000)])
    con.execute("INSERT INTO treasury VALUES('treasury',0,1)")
    teams = {"teams":[{"name":"Team A","alias":"aa","odd":2.0},{"name":"Team B","alias":"bb","odd":1.5}]}
    con.execute("INSERT INTO sports_events(id,title,status,data,created_at,updated_at) VALUES(?,?,?,?,1,1)",
                ("sports-1","Team A vs Team B","open",json.dumps(teams)))
    con.execute("INSERT INTO auctions(id,auction_id,channel_id,channel_message_id,status,end_at,current_bid,highest_bidder_id,data,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                ("auc-row","auc-1",-1001,77,"open",sqlite3.connect(":memory:").execute("SELECT unixepoch()+3600").fetchone()[0],0,None,
                 json.dumps({"startingBid":1000,"minIncrement":250,"totalBids":0,"createdBy":303}),1,1))
    con.execute("INSERT INTO shop_cards(id,bot_key,card_id,name,rarity,status,price,created_at,updated_at) VALUES(1,'catchbot','card-1','Yae','legendary','AVAILABLE',200,1,1)")
    for sql in BASE + REFUNDS + MARKETS:
        con.executescript(sql + ";")
    con.execute("CREATE UNIQUE INDEX idx_sports_bets_event_user_unique ON sports_bets(event_id,user_id)")
    return con

def execute_ledger(con, kind, key, user_id, amount, meta, *, balance_delta=None, required_balance=0,
                   treasury_delta=0, required_treasury=0, refunds=None):
    if balance_delta is None:
        balance_delta = -amount
    con.execute("""
      INSERT INTO transactions(type,from_user_id,to_user_id,amount,idempotency_key,account_user_id,
       balance_delta,required_balance,total_won_delta,total_lost_delta,treasury_delta,required_treasury,
       refunds,meta,created_at)
      VALUES(?,?,'TREASURY',?,?,?, ?,?,0,0,?,?,?, ?,100)
    """, (kind, str(user_id), amount, key, user_id, balance_delta, required_balance,
          treasury_delta, required_treasury, json.dumps(refunds) if refunds is not None else None, json.dumps(meta)))

def must_abort(con, fn, code):
    try:
        fn()
    except sqlite3.IntegrityError as exc:
        assert code in str(exc), f"Expected {code}; got {exc}"
        return
    raise AssertionError(f"Expected {code} to abort the complete ledger row")

def test_sports_bet_atomic_and_duplicate_guard():
    con = database()
    execute_ledger(con, "sports_bet", "sports:one", 101, 1000,
        {"eventId":"sports-1","alias":"aa","teamName":"Team A","potentialWin":2000},
        required_balance=1000, treasury_delta=1000)
    assert con.execute("SELECT balance FROM users WHERE tg_id=101").fetchone()[0] == 4000
    assert con.execute("SELECT owner_balance FROM treasury").fetchone()[0] == 1000
    row = con.execute("SELECT event_id,user_id,choice,amount,potential_win,status FROM sports_bets").fetchone()
    assert tuple(row) == ("sports-1",101,"aa",1000,2000,"active"), dict(row)
    must_abort(con, lambda: execute_ledger(con,"sports_bet","sports:two",101,300,
        {"eventId":"sports-1","alias":"bb","teamName":"Team B","potentialWin":450},
        required_balance=300,treasury_delta=300), "SPORTS_DUPLICATE_BET")
    con.execute("UPDATE sports_events SET status='stopped' WHERE id='sports-1'")
    must_abort(con, lambda: execute_ledger(con,"sports_bet","sports:closed",202,300,
        {"eventId":"sports-1","alias":"bb","teamName":"Team B","potentialWin":450},
        required_balance=300,treasury_delta=300), "SPORTS_EVENT_CLOSED")
    assert con.execute("SELECT COUNT(*) FROM sports_bets").fetchone()[0] == 1
    assert con.execute("SELECT balance FROM users WHERE tg_id=202").fetchone()[0] == 5000
    con.close()

def auction_meta(auction_id, previous_bid, previous_bidder, bidder, message_id, start=1000, increment=250):
    return {"auctionId":auction_id,"previousBid":previous_bid,"previousBidderId":previous_bidder,
            "bidderName":f"Player {bidder}","bidderUsername":None,"messageId":message_id,
            "startingBid":start,"minIncrement":increment}

def test_auction_escrow_outbid_refund_and_stale_guard():
    con = database()
    execute_ledger(con, "auction_bid", "auction:bid:1", 101, 1000,
      auction_meta("auc-1",0,None,101,1), required_balance=1000, treasury_delta=1000)
    assert con.execute("SELECT balance FROM users WHERE tg_id=101").fetchone()[0] == 4000
    assert con.execute("SELECT owner_balance FROM treasury").fetchone()[0] == 1000
    execute_ledger(con, "auction_bid", "auction:bid:2", 202, 1500,
      auction_meta("auc-1",1000,101,202,2), required_balance=1500, treasury_delta=500, required_treasury=1000,
      refunds=[{"userId":101,"amount":1000}])
    assert con.execute("SELECT balance FROM users WHERE tg_id=101").fetchone()[0] == 5000
    assert con.execute("SELECT balance FROM users WHERE tg_id=202").fetchone()[0] == 3500
    assert con.execute("SELECT owner_balance FROM treasury").fetchone()[0] == 1500
    assert con.execute("SELECT current_bid FROM auctions WHERE auction_id='auc-1'").fetchone()[0] == 1500
    assert con.execute("SELECT highest_bidder_id FROM auctions WHERE auction_id='auc-1'").fetchone()[0] == 202
    assert con.execute("SELECT COUNT(*) FROM auction_bids").fetchone()[0] == 2
    must_abort(con, lambda: execute_ledger(con,"auction_bid","auction:stale",101,2000,
      auction_meta("auc-1",1000,101,101,3),required_balance=2000,treasury_delta=1000,
      required_treasury=1000,refunds=[{"userId":101,"amount":1000}]),"AUCTION_CHANGED")
    must_abort(con, lambda: execute_ledger(con,"auction_bid","auction:low",303,1600,
      auction_meta("auc-1",1500,202,303,4),required_balance=1600,treasury_delta=100,
      required_treasury=1500,refunds=[{"userId":202,"amount":1500}]),"AUCTION_BID_TOO_LOW")
    before = (con.execute("SELECT balance FROM users WHERE tg_id=303").fetchone()[0],
              con.execute("SELECT owner_balance FROM treasury").fetchone()[0])
    assert before == (5000,1500)
    con.execute("UPDATE auctions SET end_at=unixepoch()-1 WHERE auction_id='auc-1'")
    must_abort(con, lambda: execute_ledger(con,"auction_bid","auction:expired",303,2000,
      auction_meta("auc-1",1500,202,303,5),required_balance=2000,treasury_delta=500,
      required_treasury=1500,refunds=[{"userId":202,"amount":1500}]),"AUCTION_CLOSED")
    con.close()

def test_shop_purchase_reserves_card_atomically():
    con = database()
    execute_ledger(con,"shop_purchase","shop:buy:1",101,200,
      {"shopCardId":1,"orderId":"ord-test-1","receiptCode":"receipt-test"},
      required_balance=200,treasury_delta=200)
    assert con.execute("SELECT balance FROM users WHERE tg_id=101").fetchone()[0] == 4800
    assert con.execute("SELECT owner_balance FROM treasury").fetchone()[0] == 200
    card = con.execute("SELECT status FROM shop_cards WHERE id=1").fetchone()[0]
    order = con.execute("SELECT user_id,kind,status,amount,item_id,receipt_code FROM orders").fetchone()
    assert card == "PENDING"
    assert tuple(order) == (101,"card_exchange","pending",200,"1","receipt-test"), tuple(order)
    must_abort(con, lambda: execute_ledger(con,"shop_purchase","shop:buy:2",202,200,
      {"shopCardId":1,"orderId":"ord-test-2","receiptCode":"receipt-test-2"},
      required_balance=200,treasury_delta=200),"SHOP_CARD_UNAVAILABLE")
    assert con.execute("SELECT COUNT(*) FROM orders").fetchone()[0] == 1
    assert con.execute("SELECT balance FROM users WHERE tg_id=202").fetchone()[0] == 5000
    con.close()

if __name__ == "__main__":
    test_sports_bet_atomic_and_duplicate_guard()
    test_auction_escrow_outbid_refund_and_stale_guard()
    test_shop_purchase_reserves_card_atomically()
    print("Event-market SQLite trigger tests passed (sports debit/duplicate/closed, auction escrow/outbid/refund/stale/expiry, shop reservation/order).")
