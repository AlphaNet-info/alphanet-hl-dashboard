#!/usr/bin/env python3
"""Extra datasets for the multi-view dashboard, built from collector raw.json + collector outputs.

  python3 pipeline/extras.py --watchlist pipeline/watchlist.json --raw raw.json --data data [--started <epoch>]

Writes into data/:
  coin_daily.json     每个地址 × 币种 × UTC 日：成交额、笔数、已实现盈亏、手续费、资金费、Maker/Taker、开平仓方向（增量合并）
  exposure_daily.json 每次运行的持仓快照（地址 × 币种 多空名义、浮盈亏），按快照日累积
  health.json         数据质量 / 管道健康检查（运维视角）
  run_log.json        最近 90 次运行记录
  meta.json           看板元信息（地址名单、分组、阈值、生成时间）
"""
import argparse, json, os, time, datetime as dt

DAY = 86400000


def day_of(ms):
    return dt.datetime.fromtimestamp(ms / 1000, dt.timezone.utc).strftime("%Y-%m-%d")


def load(p, default):
    try:
        with open(p) as f:
            return json.load(f)
    except Exception:
        return default


def dump(p, data):
    with open(p, "w") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--watchlist", required=True)
    ap.add_argument("--raw", required=True)
    ap.add_argument("--data", default="data")
    ap.add_argument("--started", type=float, default=None, help="pipeline start epoch seconds")
    ap.add_argument("--status", default="ok")
    args = ap.parse_args()

    wl = load(args.watchlist, {})
    entries = wl.get("addresses") or []
    order = [e["addr"].lower() for e in entries]
    labels = {e["addr"].lower(): e.get("label") or e["addr"] for e in entries}
    since = wl.get("since") or "2000-01-01"
    raw = load(args.raw, {"addrs": {}})
    now = dt.datetime.now(dt.timezone.utc)
    cutoff = (now - dt.timedelta(days=1)).strftime("%Y-%m-%d")
    snap_at = raw.get("fetched_at") or int(time.time() * 1000)
    D = lambda n: os.path.join(args.data, n)

    # ---------- coin_daily (incremental merge) ----------
    old = load(D("coin_daily.json"), [])
    keep = []
    replace_from = {}
    for a, R in raw["addrs"].items():
        replace_from[a] = day_of(R["from"]) if R.get("from") else "0000-00-00"
    for r in old:
        a = r["addr"]
        if a not in labels:
            continue
        if a in replace_from and r["day"] >= replace_from[a]:
            continue
        keep.append(r)
    agg = {}
    K = ["volume", "fills", "realized_pnl", "fees", "funding", "maker_volume", "taker_volume",
         "open_long", "open_short", "close_long", "close_short", "wins", "losses"]
    for a, R in raw["addrs"].items():
        for f in R.get("fills", []):
            t, ntl, fee, pnl, coin = f[:5]
            crossed = f[6] if len(f) > 6 else None
            direc = f[7] if len(f) > 7 else ""
            d = day_of(t)
            if d < since or d > cutoff:
                continue
            g = agg.setdefault((d, a, coin), {k: 0.0 for k in K})
            g["volume"] += ntl; g["fills"] += 1; g["realized_pnl"] += pnl; g["fees"] += fee
            if crossed is True: g["taker_volume"] += ntl
            elif crossed is False: g["maker_volume"] += ntl
            dl = (direc or "").lower()
            if dl.startswith("open long"): g["open_long"] += ntl
            elif dl.startswith("open short"): g["open_short"] += ntl
            elif dl.startswith("close long"): g["close_long"] += ntl
            elif dl.startswith("close short"): g["close_short"] += ntl
            if pnl > 0: g["wins"] += 1
            elif pnl < 0: g["losses"] += 1
        for t, usdc, coin in R.get("funding", []):
            d = day_of(t)
            if d < since or d > cutoff:
                continue
            g = agg.setdefault((d, a, coin), {k: 0.0 for k in K})
            g["funding"] += usdc
    new = []
    for (d, a, coin), g in agg.items():
        row = {"day": d, "addr": a, "coin": coin}
        for k in K:
            row[k] = int(g[k]) if k in ("fills", "wins", "losses") else round(g[k], 2)
        new.append(row)
    coin_daily = sorted(keep + new, key=lambda r: (r["day"], order.index(r["addr"]) if r["addr"] in order else 999, r["coin"]))
    dump(D("coin_daily.json"), coin_daily)

    # ---------- exposure snapshot ----------
    exp = [r for r in load(D("exposure_daily.json"), []) if r.get("addr") in labels]
    sday = day_of(snap_at)
    exp = [r for r in exp if r["day"] != sday]
    for a, R in raw["addrs"].items():
        st = R.get("state") or {}
        eq = float((st.get("marginSummary") or {}).get("accountValue") or 0)
        rows = 0
        for p in st.get("assetPositions", []):
            q = p["position"]
            szi, val = float(q["szi"]), abs(float(q["positionValue"]))
            if val < 1:
                continue
            exp.append({"day": sday, "at": snap_at, "addr": a, "coin": q["coin"], "side": "空" if szi < 0 else "多",
                        "notional": round(val, 2), "upnl": round(float(q["unrealizedPnl"]), 2), "equity": round(eq, 2)})
            rows += 1
        if rows == 0:
            exp.append({"day": sday, "at": snap_at, "addr": a, "coin": "", "side": "", "notional": 0, "upnl": 0, "equity": round(eq, 2)})
    exp.sort(key=lambda r: (r["day"], r["addr"], r["coin"]))
    dump(D("exposure_daily.json"), exp)

    # ---------- health checks ----------
    dt_total = load(D("daily_total.json"), [])
    ad = load(D("addr_daily.json"), [])
    summ = load(D("addr_summary.json"), [])
    checks = []

    def check(name, ok, detail, level="严重"):
        checks.append({"name": name, "ok": bool(ok), "level": "通过" if ok else level, "detail": detail})

    last_day = dt_total[-1]["day"] if dt_total else "-"
    check("最后一天为昨天（UTC）", last_day == cutoff, f"最后一天 {last_day}，应为 {cutoff}")
    check("地址数与名单一致", len(summ) == len(order), f"汇总 {len(summ)} 个 / 名单 {len(order)} 个")
    missing = [labels[a] for a in order if a not in raw["addrs"]]
    check("所有地址抓取成功", not missing, "缺失：" + "、".join(missing) if missing else f"{len(raw['addrs'])} 个地址均已抓取")
    # continuity per address
    by_addr = {}
    for r in ad:
        by_addr.setdefault(r["addr"], set()).add(r["day"])
    gaps = []
    for a, days in by_addr.items():
        ds = sorted(days)
        d0 = dt.datetime.strptime(ds[0], "%Y-%m-%d")
        n = (dt.datetime.strptime(ds[-1], "%Y-%m-%d") - d0).days + 1
        if n != len(ds):
            gaps.append(f"{labels.get(a, a)} 缺 {n - len(ds)} 天")
    check("每日明细连续无缺口", not gaps, "；".join(gaps) if gaps else "所有地址日序列连续", "警告")
    # totals consistency
    tot = {}
    for r in ad:
        tot[r["day"]] = tot.get(r["day"], 0) + r["volume"]
    bad = [t["day"] for t in dt_total if abs(tot.get(t["day"], 0) - t["volume"]) > 1]
    check("汇总与地址明细一致", not bad, f"不一致的日期：{', '.join(bad[:5])}" if bad else "每日交易量 = 地址明细之和", "警告")
    cd_tot = {}
    for r in coin_daily:
        cd_tot[r["day"]] = cd_tot.get(r["day"], 0) + r["volume"]
    bad2 = [t["day"] for t in dt_total if t["day"] in cd_tot and abs(cd_tot[t["day"]] - t["volume"]) > max(5, t["volume"] * 0.001)]
    check("币种明细与地址明细一致", not bad2,
          f"{len(bad2)} 天不一致（{', '.join(bad2[:4])}…）。Hyperliquid 只返回每个地址最近 1 万笔成交，高频地址更早的币种明细无法回补" if bad2
          else "币种成交额之和 = 每日交易量", "提示")
    # fills-derived vs official volume
    vol_gap = []
    for s in summ:
        off, mine = s.get("volume_official_alltime") or 0, s.get("volume_total") or 0
        if off > 1000 and abs(off - mine) / off > 0.02:
            vol_gap.append({"label": s["label"], "official": off, "computed": mine, "gap_pct": round((mine - off) / off, 4)})
    check("成交额与官方口径偏差 < 2%", not vol_gap,
          f"{len(vol_gap)} 个地址偏差较大（官方 allTime 含 {since} 之前的历史时属正常）" if vol_gap else "全部地址偏差 < 2%", "提示")
    zero_eq = [s["label"] for s in summ if (s.get("equity_now") or 0) < 1]
    check("无零资金地址", not zero_eq, "零资金：" + "、".join(zero_eq) if zero_eq else "全部地址有资金", "提示")
    fs = raw.get("fetch_stats") or {}
    check("API 无限流重试", (fs.get("retries_429") or 0) == 0, f"429 重试 {fs.get('retries_429', 0)} 次，其它错误重试 {fs.get('retries_err', 0)} 次", "提示")

    files = {}
    for n in sorted(os.listdir(args.data)):
        if n.endswith(".json"):
            p = D(n)
            files[n] = {"bytes": os.path.getsize(p), "rows": len(load(p, [])) if n not in ("health.json", "meta.json") else None}
    started = args.started or (snap_at / 1000)
    health = {
        "generated_at": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "snapshot_at": dt.datetime.fromtimestamp(snap_at / 1000, dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "status": args.status if all(c["ok"] or c["level"] != "严重" for c in checks) else "failed",
        "last_day": last_day, "expected_day": cutoff,
        "duration_s": round(time.time() - started, 1),
        "fetch": {k: v for k, v in fs.items() if k != "addresses"},
        "fetch_addresses": [dict(x, label=labels.get(x["addr"], x["addr"])) for x in fs.get("addresses", [])],
        "checks": checks, "volume_gaps": vol_gap, "files": files,
    }
    dump(D("health.json"), health)

    log = load(D("run_log.json"), [])
    log.append({"at": health["generated_at"], "status": health["status"], "last_day": last_day,
                "duration_s": health["duration_s"], "calls": fs.get("calls"), "retries_429": fs.get("retries_429"),
                "fills": sum(x.get("fills", 0) for x in fs.get("addresses", [])),
                "failed_checks": [c["name"] for c in checks if not c["ok"]]})
    dump(D("run_log.json"), log[-90:])

    meta = {
        "title": wl.get("title") or "AlphaNet Hyperliquid",
        "since": since, "generated_at": health["generated_at"], "snapshot_at": health["snapshot_at"],
        "alerts": wl.get("alerts") or {},
        "addresses": [{"addr": e["addr"].lower(), "label": labels[e["addr"].lower()], "added": e.get("added", ""),
                        "group": e.get("group") or "未分组", "owner": e.get("owner") or ""} for e in entries],
    }
    dump(D("meta.json"), meta)
    print(f"coin_daily={len(coin_daily)} exposure={len(exp)} checks_failed={sum(not c['ok'] for c in checks)} status={health['status']}")


if __name__ == "__main__":
    main()
