#!/usr/bin/env python3
"""AlphaNet Hyperliquid monitor — collector.

Usage:
  python3 collector.py fetch     --watchlist watchlist.json [--prev addr_daily.json] --raw raw.json
  python3 collector.py transform --watchlist watchlist.json [--prev addr_daily.json] --raw raw.json --out outdir

fetch:     pulls fills / portfolio / positions for every watched address from api.hyperliquid.xyz
           (incremental when --prev has history for that address).
transform: builds five dataset files in outdir:
           daily_total.json, addr_daily.json, addr_summary.json, positions.json, alerts.json   (all UTC days, complete days only)
"""
import argparse, json, os, sys, time, datetime as dt, urllib.request

API = "https://api.hyperliquid.xyz/info"
DAY = 86400000
STATS = {"calls": 0, "retries_429": 0, "retries_err": 0, "bytes": 0, "slowest_ms": 0}


def post(body, tries=8):
    data = json.dumps(body).encode()
    for t in range(tries):
        try:
            req = urllib.request.Request(API, data=data, headers={"Content-Type": "application/json"})
            t0 = time.time(); STATS["calls"] += 1
            with urllib.request.urlopen(req, timeout=60) as r:
                b = r.read()
            STATS["bytes"] += len(b); STATS["slowest_ms"] = max(STATS["slowest_ms"], int((time.time() - t0) * 1000))
            return json.loads(b)
        except urllib.error.HTTPError as e:
            if e.code == 429:
                STATS["retries_429"] += 1
                time.sleep(5 * (t + 1)); continue
            raise
        except Exception:
            if t == tries - 1: raise
            STATS["retries_err"] += 1
            time.sleep(3 * (t + 1))
    raise RuntimeError("rate limited")


def day_of(ms):
    return dt.datetime.fromtimestamp(ms / 1000, dt.timezone.utc).strftime("%Y-%m-%d")


def load(p, default):
    if p and os.path.exists(p):
        with open(p) as f:
            return json.load(f)
    return default


def rows_of(x):
    if isinstance(x, dict):
        for k in ("rows", "data", "results"):
            if k in x: return x[k]
    return x or []


def last_full_day():
    now = dt.datetime.now(dt.timezone.utc)
    return (now - dt.timedelta(days=1)).strftime("%Y-%m-%d")


def fetch(args):
    wl = load(args.watchlist, {})
    addrs = [a["addr"].lower() for a in (wl.get("addresses") or wl)]
    prev = rows_of(load(args.prev, []))
    last_hist = {}
    for r in prev:
        a = r["addr"].lower()
        last_hist[a] = max(last_hist.get(a, ""), r["day"])
    raw = {"fetched_at": int(time.time() * 1000), "addrs": {}}
    t_start = time.time(); per = []
    for i, a in enumerate(addrs):
        start = 0
        if a in last_hist:
            d0 = dt.datetime.strptime(last_hist[a], "%Y-%m-%d").replace(tzinfo=dt.timezone.utc) - dt.timedelta(days=2)
            start = int(d0.timestamp() * 1000)
        fills, seen = [], set()
        s = start
        while True:
            f = post({"type": "userFillsByTime", "user": a, "startTime": s, "aggregateByTime": False})
            if not isinstance(f, list) or not f: break
            add = 0
            for x in f:
                k = (x["tid"], x["hash"], x["oid"])
                if k in seen: continue
                seen.add(k); add += 1
                fills.append([x["time"], float(x["px"]) * float(x["sz"]), float(x["fee"]), float(x["closedPnl"]), x["coin"],
                              x.get("side", ""), bool(x.get("crossed")), x.get("dir", "")])
            if len(f) < 2000 or add == 0: break
            s = f[-1]["time"]
            time.sleep(1.0)
        funding, s2 = [], start
        while True:
            f = post({"type": "userFunding", "user": a, "startTime": s2})
            if not isinstance(f, list) or not f: break
            for x in f:
                funding.append([x["time"], float(x["delta"]["usdc"]), x["delta"]["coin"]])
            if len(f) < 500: break
            s2 = f[-1]["time"] + 1
            time.sleep(0.5)
        pf = post({"type": "portfolio", "user": a})
        st = post({"type": "clearinghouseState", "user": a})
        raw["addrs"][a] = {"from": start, "fills": fills, "funding": funding, "portfolio": pf, "state": st}
        per.append({"addr": a, "from": day_of(start) if start else "all", "fills": len(fills), "funding": len(funding)})
        print(f"[{i+1}/{len(addrs)}] {a} fills={len(fills)} from={day_of(start) if start else 'all'}", file=sys.stderr)
        time.sleep(1.0)
    raw["fetch_stats"] = dict(STATS, seconds=round(time.time() - t_start, 1), addresses=per)
    with open(args.raw, "w") as f:
        json.dump(raw, f)


def series(pf, key):
    """merge every window's history for key into sorted [(ms, value)]"""
    pts = {}
    for name, w in pf or []:
        if name.startswith("perp"): continue
        for ms, v in w.get(key, []):
            pts[int(ms)] = float(v)
    return sorted(pts.items())


def end_of_day_values(pts, days):
    out, j, last = {}, 0, None
    for d in days:
        end = int(dt.datetime.strptime(d, "%Y-%m-%d").replace(tzinfo=dt.timezone.utc).timestamp() * 1000) + DAY
        while j < len(pts) and pts[j][0] < end:
            last = pts[j][1]; j += 1
        out[d] = last
    return out


def fmt_usd(v):
    a = abs(v)
    return f"${a/1e6:.2f}M" if a >= 1e6 else f"${a/1e3:.1f}K" if a >= 1e3 else f"${a:.0f}"


DEFAULT_ALERTS = {
    "day_loss_pct": 5,       # 严重：当日盈亏亏损超过前一日资金的 X%
    "upnl_loss_pct": 5,      # 严重：当前持仓浮亏超过当前资金的 X%
    "liq_distance_pct": 15,  # 严重：任一持仓距离强平价不足 X%
    "drawdown_pct": 10,      # 警告：本期盈亏从高点回撤超过当前资金的 X%
    "period_loss_pct": 5,    # 警告：本期累计亏损超过投入资金的 X%
    "leverage_max": 3,       # 警告：持仓名义价值 / 资金 超过 X 倍
    "outflow_pct": 20,       # 提示：当日净流出超过前一日资金的 X%
    "idle_days": 3,          # 提示：连续 X 天没有成交
    "min_equity": 1000,      # 资金低于这个金额的地址不做百分比类检查（避免小额账户误报）
}
LEVEL_RANK = {"严重": 3, "警告": 2, "提示": 1, "": 0}


def transform(args):
    wl = load(args.watchlist, {})
    entries = wl.get("addresses") or wl
    labels = {e["addr"].lower(): e.get("label") or "" for e in entries}
    order = [e["addr"].lower() for e in entries]
    rules = dict(DEFAULT_ALERTS)
    rules.update((wl.get("alerts") or {}) if isinstance(wl, dict) else {})
    since = (wl.get("since") if isinstance(wl, dict) else None) or "2000-01-01"
    prev = rows_of(load(args.prev, []))
    raw = load(args.raw, {"addrs": {}})
    cutoff = last_full_day()
    today = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d")
    if getattr(args, "include_today", False):
        cutoff = today
    snap_at = raw.get("fetched_at") or int(time.time() * 1000)

    by = {}  # (addr, day) -> row
    for r in prev:
        a = r["addr"].lower()
        if a in labels:
            by[(a, r["day"])] = dict(r)

    summary, positions, alerts = [], [], []

    def alert(a, level, rule, value, threshold, msg, day):
        alerts.append({"id": f"{a}|{rule}|{len(alerts)}", "addr": a, "label": labels[a], "level": level, "rule": rule,
                       "value": round(value, 4), "threshold": threshold, "message": msg, "day": day})

    for a in order:
        R = raw["addrs"].get(a)
        if not R: continue
        start_day = day_of(R["from"]) if R["from"] else None
        for k in [k for k in by if k[0] == a and (start_day is None or k[1] >= start_day)]:
            del by[k]
        agg = {}
        for t, ntl, fee, pnl, coin, *_ in R["fills"]:
            g = agg.setdefault(day_of(t), [0.0, 0, 0.0, 0.0, 0.0])
            g[0] += ntl; g[1] += 1; g[2] += fee; g[3] += pnl
        for t, usdc, coin in R.get("funding", []):
            g = agg.setdefault(day_of(t), [0.0, 0, 0.0, 0.0, 0.0])
            g[4] += usdc
        eq_pts = series(R["portfolio"], "accountValueHistory")
        win = dict(R["portfolio"] or [])
        w = win.get("month") or win.get("allTime") or {}
        mp = sorted((int(t), float(v)) for t, v in w.get("pnlHistory", []))
        me = sorted((int(t), float(v)) for t, v in w.get("accountValueHistory", []))
        eq_pts_day = me or eq_pts
        known = [k[1] for k in by if k[0] == a]
        first = min([d for d in agg] + known + [day_of(p[0]) for p in eq_pts if p[1] > 1] or [cutoff])
        lo = start_day if start_day and start_day > first else first
        lo = max(lo, since)
        days, d = [], dt.datetime.strptime(lo, "%Y-%m-%d")
        while d.strftime("%Y-%m-%d") <= cutoff:
            days.append(d.strftime("%Y-%m-%d")); d += dt.timedelta(days=1)
        prev_day = (dt.datetime.strptime(lo, "%Y-%m-%d") - dt.timedelta(days=1)).strftime("%Y-%m-%d")
        eq = end_of_day_values(eq_pts_day, [prev_day] + days)
        mpv = end_of_day_values(mp, [prev_day] + days)
        prow = by.get((a, prev_day), {})
        pe = prow.get("equity")
        if pe is None: pe = eq[prev_day] or 0.0
        pcum = prow.get("pnl_cum", 0.0)
        pm = mpv[prev_day] or 0.0
        for d in days:
            v, n, fee, rp, fund = agg.get(d, [0.0, 0, 0.0, 0.0, 0.0])
            e = eq[d] if eq[d] is not None else pe
            m = mpv[d] if mpv[d] is not None else pm
            pnl = m - pm
            pcum += pnl
            by[(a, d)] = {"day": d, "addr": a, "label": labels[a], "volume": round(v, 2), "fills": n,
                          "realized_pnl": round(rp, 2), "fees": round(fee, 2), "funding": round(fund, 2),
                          "trading_pnl": round(rp - fee + fund, 2),
                          "pnl_day": round(pnl, 2), "pnl_pct": round(pnl / pe, 5) if pe > 1 else 0,
                          "pnl_cum": round(pcum, 2), "equity": round(e, 2), "net_flow": round((e - pe) - pnl, 2),
                          "partial": d == today}
            pe, pm = e, m

        rows = sorted([r for k, r in by.items() if k[0] == a], key=lambda r: r["day"])
        for r in rows:  # older stored rows may lack the newer fields
            r["partial"] = r["day"] == today and cutoff == today
            r.setdefault("funding", 0.0)
            r.setdefault("trading_pnl", round(r.get("realized_pnl", 0) - r.get("fees", 0) + r["funding"], 2))
            r.setdefault("pnl_pct", 0)
        last = rows[-1] if rows else {}
        prev_eq = rows[-2]["equity"] if len(rows) > 1 else 0.0
        eq_now = eq_pts[-1][1] if eq_pts else last.get("equity", 0.0)

        # positions
        st = R["state"] or {}
        ms = st.get("marginSummary") or {}
        upnl, worst_liq = 0.0, None
        for p in st.get("assetPositions", []):
            q = p["position"]
            szi, val = float(q["szi"]), abs(float(q["positionValue"]))
            u = float(q["unrealizedPnl"]); upnl += u
            if val < 1: continue
            mark = val / abs(szi) if szi else 0
            liq = float(q["liquidationPx"]) if q.get("liquidationPx") not in (None, "") else None
            dist = abs(liq - mark) / mark if (liq and mark) else None
            if dist is not None and (worst_liq is None or dist < worst_liq[0]): worst_liq = (dist, q["coin"])
            cf = q.get("cumFunding") or {}
            positions.append({"key": f'{a}|{q["coin"]}', "addr": a, "label": labels[a], "coin": q["coin"],
                              "side": "空" if szi < 0 else "多", "size": abs(szi), "notional": round(val, 2),
                              "entry_px": float(q["entryPx"]), "mark_px": round(mark, 6), "unrealized_pnl": round(u, 2),
                              "roe": round(float(q.get("returnOnEquity") or 0), 4),
                              "liq_px": liq, "liq_distance": round(dist, 4) if dist is not None else None,
                              "leverage": f'{q["leverage"]["value"]}x {"全仓" if q["leverage"]["type"] == "cross" else "逐仓"}',
                              "funding_since_open": round(-float(cf.get("sinceOpen") or 0), 2),
                              "pct_of_equity": round(val / eq_now, 4) if eq_now > 1 else 0})
        ntl = float(ms.get("totalNtlPos") or 0)
        lev = ntl / eq_now if eq_now > 1 else 0
        realized = sum(r["realized_pnl"] for r in rows); fees = sum(r["fees"] for r in rows)
        funding = sum(r["funding"] for r in rows); pnl_period = sum(r["pnl_day"] for r in rows)
        cum, peak, dd = 0.0, 0.0, 0.0
        for r in rows:
            cum += r["pnl_day"]; peak = max(peak, cum); dd = max(dd, peak - cum)
        dd_now = peak - cum
        traded = [r["day"] for r in rows if r["fills"] > 0]
        idle = 0
        for r in reversed(rows):
            if r["fills"] > 0: break
            idle += 1
        invested = eq_now - pnl_period

        # alerts
        day = last.get("day", cutoff) + ("（进行中）" if last.get("partial") else "")
        n0 = len(alerts)
        big = max(eq_now, prev_eq) >= rules["min_equity"]
        if big and prev_eq > 1 and last.get("pnl_day", 0) < 0 and -last["pnl_day"] / prev_eq * 100 > rules["day_loss_pct"]:
            alert(a, "严重", "当日亏损", -last["pnl_day"] / prev_eq, rules["day_loss_pct"],
                  f'{day} 亏损 {fmt_usd(-last["pnl_day"])}，占前一日资金 {(-last["pnl_day"] / prev_eq * 100):.1f}%（阈值 {rules["day_loss_pct"]}%）', day)
        if big and eq_now > 1 and upnl < 0 and -upnl / eq_now * 100 > rules["upnl_loss_pct"]:
            alert(a, "严重", "持仓浮亏", -upnl / eq_now, rules["upnl_loss_pct"],
                  f'当前持仓浮亏 {fmt_usd(-upnl)}，占资金 {(-upnl / eq_now * 100):.1f}%（阈值 {rules["upnl_loss_pct"]}%）', day_of(snap_at))
        if worst_liq and worst_liq[0] * 100 < rules["liq_distance_pct"]:
            alert(a, "严重", "接近强平", worst_liq[0], rules["liq_distance_pct"],
                  f'{worst_liq[1]} 距强平价仅 {worst_liq[0] * 100:.1f}%（阈值 {rules["liq_distance_pct"]}%）', day_of(snap_at))
        if big and eq_now > 1 and dd_now / eq_now * 100 > rules["drawdown_pct"]:
            alert(a, "警告", "盈亏回撤", dd_now / eq_now, rules["drawdown_pct"],
                  f'本期盈亏从高点回撤 {fmt_usd(dd_now)}，占资金 {(dd_now / eq_now * 100):.1f}%（阈值 {rules["drawdown_pct"]}%）', day)
        if big and invested > 1 and pnl_period < 0 and -pnl_period / invested * 100 > rules["period_loss_pct"]:
            alert(a, "警告", "累计亏损", -pnl_period / invested, rules["period_loss_pct"],
                  f'{since} 以来累计亏损 {fmt_usd(-pnl_period)}，占投入资金 {(-pnl_period / invested * 100):.1f}%（阈值 {rules["period_loss_pct"]}%）', day)
        if lev > rules["leverage_max"]:
            alert(a, "警告", "杠杆过高", lev, rules["leverage_max"], f'实际杠杆 {lev:.2f} 倍（阈值 {rules["leverage_max"]} 倍）', day_of(snap_at))
        if big and prev_eq > 1 and last.get("net_flow", 0) < 0 and -last["net_flow"] / prev_eq * 100 > rules["outflow_pct"]:
            alert(a, "提示", "大额流出", -last["net_flow"] / prev_eq, rules["outflow_pct"],
                  f'{day} 净流出 {fmt_usd(-last["net_flow"])}，占前一日资金 {(-last["net_flow"] / prev_eq * 100):.1f}%', day)
        if traded and idle >= rules["idle_days"]:
            alert(a, "提示", "停止交易", idle, rules["idle_days"], f'已连续 {idle} 天没有成交（最近一次 {traded[-1]}）', day)
        mine = alerts[n0:]
        top = max((LEVEL_RANK[x["level"]] for x in mine), default=0)

        poss = sorted([p for p in positions if p["addr"] == a], key=lambda p: -p["notional"])
        vol_off = float(win.get("allTime", {}).get("vlm") or 0)
        summary.append({
            "addr": a, "label": labels[a],
            "alert_level": {3: "严重", 2: "警告", 1: "提示", 0: "正常"}[top], "alert_count": len(mine),
            "status": "活跃" if last.get("fills", 0) > 0 else ("持仓中" if ntl > 0 else "闲置"),
            "first_trade": traded[0] if traded else "", "last_trade": traded[-1] if traded else "",
            "volume_last_day": last.get("volume", 0), "volume_7d": round(sum(r["volume"] for r in rows[-7:]), 2),
            "volume_total": round(sum(r["volume"] for r in rows), 2), "volume_official_alltime": round(vol_off, 2),
            "equity_now": round(eq_now, 2), "equity_change_day": round(last.get("equity", 0) - prev_eq, 2),
            "pnl_day": last.get("pnl_day", 0), "pnl_day_pct": last.get("pnl_pct", 0),
            "pnl_7d": round(sum(r["pnl_day"] for r in rows[-7:]), 2),
            "pnl_period": round(pnl_period, 2), "pnl_period_pct": round(pnl_period / invested, 5) if invested > 1 else 0,
            "realized_day": last.get("realized_pnl", 0), "fees_day": last.get("fees", 0), "funding_day": last.get("funding", 0),
            "realized_total": round(realized, 2), "fees_total": round(fees, 2), "funding_total": round(funding, 2),
            "trading_pnl_total": round(realized - fees + funding, 2),
            "unrealized_pnl": round(upnl, 2), "unrealized_pct": round(upnl / eq_now, 5) if eq_now > 1 else 0,
            "drawdown_now": round(dd_now, 2), "drawdown_pct": round(dd_now / eq_now, 5) if eq_now > 1 else 0,
            "max_drawdown": round(dd, 2),
            "net_flow_7d": round(sum(r["net_flow"] for r in rows[-7:]), 2), "net_flow_period": round(sum(r["net_flow"] for r in rows), 2),
            "position_ntl": round(ntl, 2), "margin_used": round(float(ms.get("totalMarginUsed") or 0), 2),
            "leverage": round(lev, 2), "positions_count": len(poss),
            "positions": "; ".join(f'{p["coin"]} {p["side"]} {fmt_usd(p["notional"])}' for p in poss[:4]) or "无持仓",
            "liq_distance_min": round(worst_liq[0], 4) if worst_liq else None,
            "snapshot_at": dt.datetime.fromtimestamp(snap_at / 1000, dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
        })

    addr_daily = sorted(by.values(), key=lambda r: (r["day"], order.index(r["addr"]) if r["addr"] in order else 999))
    for r in addr_daily:
        base = r["equity"] - r["pnl_cum"]
        r["cum_roi"] = round(r["pnl_cum"] / base, 5) if base >= 1 else 0
    tot = {}
    keys = ["volume", "fills", "realized_pnl", "fees", "funding", "trading_pnl", "pnl_day", "equity", "net_flow"]
    for r in addr_daily:
        t = tot.setdefault(r["day"], {"day": r["day"], **{k: 0.0 for k in keys}, "active_addrs": 0})
        for k in keys: t[k] += r.get(k, 0) or 0
        t["active_addrs"] += 1 if r["fills"] > 0 else 0
        t["partial"] = bool(r.get("partial"))
    cum = cpnl = 0.0
    daily_total, prev_e = [], None
    for d in sorted(tot):
        t = tot[d]; cum += t["volume"]; cpnl += t["pnl_day"]
        t["fills"] = int(t["fills"]); t["partial"] = bool(t.get("partial"))
        t["pnl_pct"] = round(t["pnl_day"] / prev_e, 5) if prev_e else 0
        prev_e = t["equity"]
        daily_total.append({k: (round(v, 2) if isinstance(v, float) and k != "pnl_pct" else v) for k, v in t.items()}
                           | {"volume_cum": round(cum, 2), "pnl_cum": round(cpnl, 2),
                              "cum_roi": round(cpnl / (t["equity"] - cpnl), 5) if t["equity"] - cpnl >= 1 else 0})
    alerts.sort(key=lambda x: (-LEVEL_RANK[x["level"]], -x["value"]))
    desc = {
        "day_loss_pct": ("严重", "当日亏损", "%", "最近一个完整日的官方盈亏为亏损，且亏损额超过前一日资金的这个比例"),
        "upnl_loss_pct": ("严重", "持仓浮亏", "%", "快照时所有持仓的浮动亏损合计超过当前资金的这个比例"),
        "liq_distance_pct": ("严重", "接近强平", "%", "任一持仓的标记价距离强平价不足这个比例"),
        "drawdown_pct": ("警告", "盈亏回撤", "%", "本期累计官方盈亏从最高点回落的金额超过当前资金的这个比例"),
        "period_loss_pct": ("警告", "累计亏损", "%", f"{since} 以来累计官方亏损超过投入资金（当前资金 − 本期盈亏）的这个比例"),
        "leverage_max": ("警告", "杠杆过高", " 倍", "持仓名义价值合计 ÷ 当前资金 超过这个倍数"),
        "outflow_pct": ("提示", "大额流出", "%", "最近一个完整日净流出（出金、转出、存入金库）超过前一日资金的这个比例"),
        "idle_days": ("提示", "停止交易", " 天", "曾经交易过的地址连续这么多天没有成交"),
        "min_equity": ("—", "小额账户豁免", " USD", "资金低于这个金额的地址不做以上百分比类检查，避免小额账户误报"),
    }
    alert_rules = [{"rule": desc[k][1], "level": desc[k][0], "threshold": rules[k], "unit": desc[k][2], "description": desc[k][3], "key": k} for k in desc]

    os.makedirs(args.out, exist_ok=True)
    outs = (("daily_total", daily_total), ("addr_daily", addr_daily), ("addr_summary", summary),
            ("positions", positions), ("alerts", alerts), ("alert_rules", alert_rules))
    for name, data in outs:
        with open(os.path.join(args.out, name + ".json"), "w") as f:
            json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
    print(f"days={len(daily_total)} last={daily_total[-1]['day'] if daily_total else '-'} addr_rows={len(addr_daily)} "
          f"addrs={len(summary)} positions={len(positions)} alerts={len(alerts)} "
          f"(严重 {sum(x['level'] == '严重' for x in alerts)} / 警告 {sum(x['level'] == '警告' for x in alerts)} / 提示 {sum(x['level'] == '提示' for x in alerts)})")

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("mode", choices=["fetch", "transform"])
    ap.add_argument("--watchlist", required=True)
    ap.add_argument("--prev")
    ap.add_argument("--raw", required=True)
    ap.add_argument("--out", default="out")
    ap.add_argument("--include-today", action="store_true", help="also output today's UTC day so far, marked partial")
    a = ap.parse_args()
    fetch(a) if a.mode == "fetch" else transform(a)
