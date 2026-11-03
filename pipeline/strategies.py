#!/usr/bin/env python3
"""策略分类：把每个「地址 × 币种」部署组合归到 大类 → 策略。

分类按币种（families 规则），不按地址：
  Archimedes PI = Archimedes ZEC / Archimedes XMR
  Archimedes    = Archimedes BNB / SOL / ETH / DOGE
  Hackworth     = 其余所有币种（Hackworth <币种>）
另外仍计算「信号组」（同一币种里同步下单的地址），只作为部署明细里的参考列。


AlphaNet 规则：一个账户的一个币种只部署一个策略，所以「地址 × 币种」= 一个部署组合。
策略来源优先级（高 → 低）：
  1. 内部接口（Internal-API-Key，环境变量 ALPHANET_API_KEY）只提供部署金额 / 起止 / 状态，见 alphanet_api.py；字段映射见 strategies.json 的 api_fields
  2. 手动映射       pipeline/strategies.json 的 deployments
  3. 自动推断       同一策略会在多个钱包上同时下单 —— 按「成交分钟 + 方向」的重合度（Jaccard）聚类，
                    同一币种里重合度高的组合归为同一个推断策略（如 XMR-A、XMR-B）

  python3 pipeline/strategies.py --watchlist pipeline/watchlist.json --raw raw.json --data data \
        [--config pipeline/strategies.json] [--cache pipeline/cache/signals.json]

输出 data/strategies.json
"""
import argparse, json, os, sys, time, datetime as dt, urllib.request, itertools
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import alphanet_api

DAY = 86400000
WINDOW_DAYS = 21          # 推断用的成交窗口
MIN_SIGNALS = 20          # 组合在窗口内至少多少个「成交分钟」才参与聚类
LINK = 0.18               # 平均重合度阈值


def load(p, default):
    try:
        with open(p) as f:
            return json.load(f)
    except Exception:
        return default


def dump(p, data):
    os.makedirs(os.path.dirname(p) or ".", exist_ok=True)
    with open(p, "w") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))


def day_of(ms):
    return dt.datetime.fromtimestamp(ms / 1000, dt.timezone.utc).strftime("%Y-%m-%d")


def norm_coin(c):
    c = str(c or "").upper()
    for p in ("PERP_", "SPOT_"):
        if c.startswith(p): c = c[len(p):]
    for s in ("_USDC", "_USDT", "-USD", "/USDC", "-PERP"):
        if c.endswith(s): c = c[: -len(s)]
    return c


def jaccard(a, b):
    if not a or not b: return 0.0
    i = len(a & b)
    return i / (len(a) + len(b) - i)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--watchlist", required=True)
    ap.add_argument("--raw", required=True)
    ap.add_argument("--data", default="data")
    ap.add_argument("--config", default="pipeline/strategies.json")
    ap.add_argument("--cache", default="pipeline/cache/signals.json")
    args = ap.parse_args()

    wl = load(args.watchlist, {})
    addrs = [e["addr"].lower() for e in wl.get("addresses") or []]
    cfg = load(args.config, {})
    raw = load(args.raw, {"addrs": {}})
    now_ms = int(time.time() * 1000)
    lo_ms = now_ms - WINDOW_DAYS * DAY

    # ---- signal cache: "addr|coin" -> sorted list of (minute*2 + isBuy) ----
    cache = load(args.cache, {})
    replace_from = {a: (R.get("from") or 0) for a, R in raw["addrs"].items()}
    fresh = {}
    for a, R in raw["addrs"].items():
        for f in R.get("fills", []):
            if len(f) < 6: continue
            k = f"{a}|{f[4]}"
            fresh.setdefault(k, set()).add((f[0] // 60000) * 2 + (1 if f[5] == "B" else 0))
    new_cache = {}
    lo_min = lo_ms // 60000
    for k in set(cache) | set(fresh):
        a = k.split("|")[0]
        if a not in addrs: continue
        cut = (replace_from.get(a, 10**18) // 60000) if a in replace_from else None
        keep = {x for x in cache.get(k, []) if x // 2 >= lo_min and (cut is None or x // 2 < cut)}
        keep |= {x for x in fresh.get(k, set()) if x // 2 >= lo_min}
        if keep: new_cache[k] = sorted(keep)
    dump(args.cache, new_cache)
    sets = {k: set(v) for k, v in new_cache.items()}

    # ---- all combos ever traded (from coin_daily) ----
    cd = load(os.path.join(args.data, "coin_daily.json"), [])
    combos = {}
    for r in cd:
        if r["addr"] not in addrs or not r.get("fills"): continue
        c = combos.setdefault(f'{r["addr"]}|{r["coin"]}', {"addr": r["addr"], "coin": r["coin"], "first": r["day"], "last": r["day"]})
        c["first"] = min(c["first"], r["day"]); c["last"] = max(c["last"], r["day"])
    for p in load(os.path.join(args.data, "positions.json"), []):
        combos.setdefault(f'{p["addr"]}|{p["coin"]}', {"addr": p["addr"], "coin": p["coin"], "first": None, "last": None})

    # ---- inference: average-linkage clustering per coin ----
    prev = {c["key"]: c for c in (load(os.path.join(args.data, "strategies.json"), {}).get("combos") or [])}
    inferred, groups = {}, []
    by_coin = {}
    for k in combos:
        if len(sets.get(k, ())) >= MIN_SIGNALS:
            by_coin.setdefault(combos[k]["coin"], []).append(k)
    for coin, ks in by_coin.items():
        sim = {}
        for x, y in itertools.combinations(ks, 2):
            sim[(x, y)] = sim[(y, x)] = jaccard(sets[x], sets[y])
        clusters = [[k] for k in ks]
        while True:
            best, bi, bj = 0, -1, -1
            for i, j in itertools.combinations(range(len(clusters)), 2):
                s = sum(sim[(x, y)] for x in clusters[i] for y in clusters[j]) / (len(clusters[i]) * len(clusters[j]))
                if s > best: best, bi, bj = s, i, j
            if best < LINK: break
            clusters[bi] += clusters[bj]; del clusters[bj]
        multi = sorted([c for c in clusters if len(c) > 1], key=lambda c: (-len(c), min(c)))
        for n, cl in enumerate(multi):
            sid = f"{coin}-{chr(65 + n) if n < 26 else n}"
            pairs = [sim[(x, y)] for x, y in itertools.combinations(cl, 2)]
            groups.append({"id": sid, "coin": coin, "members": len(cl), "similarity": round(sum(pairs) / len(pairs), 3)})
            for k in cl: inferred[k] = sid
        for cl in clusters:
            if len(cl) == 1:
                k = cl[0]
                inferred[k] = f"{coin}-独立-{combos[k]['addr'][2:6]}"

    # ---- manual + api overrides ----
    manual = {f'{d["addr"].lower()}|{norm_coin(d["coin"])}': d for d in (cfg.get("deployments") or []) if d.get("addr") and d.get("coin")}
    api_rows, catalog, api_msg = alphanet_api.fetch(cfg)
    api = {}
    for d in api_rows:
        k = f'{d["addr"]}|{d["coin"]}'
        cur = api.get(k)
        live = lambda x: not x.get("stop")
        # 同一组合多条部署：优先仍在运行的，其次最近开始的
        if cur is None or (live(d), d.get("start") or "") > (live(cur), cur.get("start") or ""): api[k] = d
        if d["addr"] in addrs:
            combos.setdefault(k, {"addr": d["addr"], "coin": d["coin"], "first": None, "last": None})
    fams = cfg.get("families") or [{"name": "Hackworth", "coins": "*", "prefix": "Hackworth"}]

    def by_rule(coin):
        for f in fams:
            if f.get("coins") == "*" or coin in (f.get("coins") or []):
                return f["name"], f"{f.get('prefix') or f['name']} {coin}"
        return "未分类", coin

    fam_of_strategy = {}
    out = []
    for k, c in combos.items():
        if c["addr"] not in addrs: continue
        fam, sid = by_rule(c["coin"])
        src, extra = "规则", {}
        if k in manual:
            m = manual[k]; src = "映射"; sid = m.get("strategy") or sid; fam = m.get("family") or fam
            extra = {x: m.get(x) for x in ("usdc", "start", "stop", "status") if m.get(x) is not None}
        if k in api:   # 接口只提供金额 / 起止 / 状态；大类和策略仍按币种规则（Archimedes PI / Archimedes / Hackworth）
            m = api[k]; src = "接口"
            extra = {x: m.get(x) for x in ("usdc", "start", "stop", "status", "api_strategy", "id") if m.get(x) is not None}
        fam_of_strategy.setdefault(sid, fam)
        out.append({"key": k, "addr": c["addr"], "coin": c["coin"], "family": fam, "strategy": sid, "name": sid,
                    "source": src, "signal_group": inferred.get(k, ""), "first": c["first"], "last": c["last"],
                    "signals_21d": len(sets.get(k, ())), **extra})
    out.sort(key=lambda r: (r["family"], r["strategy"], r["addr"]))

    # ---- 部署金额明细（接口优先，否则手动映射）：每条部署一行，含起止时间，前端据此算任意一天的部署金额 ----
    dep_rows = []
    src_rows = api_rows if api_rows else [dict(d, addr=d["addr"].lower(), coin=norm_coin(d["coin"])) for d in (cfg.get("deployments") or []) if d.get("addr") and d.get("coin")]
    for d in src_rows:
        if d.get("usdc") in (None, ""): continue
        fam, sid = by_rule(d["coin"])
        dep_rows.append({"id": d.get("id"), "addr": d["addr"], "coin": d["coin"], "family": fam, "strategy": sid,
                         "api_strategy": d.get("api_strategy") or d.get("strategy"), "watched": d["addr"] in addrs,
                         "usdc": float(d["usdc"]), "start": (d.get("start") or None) and str(d["start"])[:10],
                         "stop": (d.get("stop") or None) and str(d["stop"])[:10], "status": d.get("status"),
                         "source": "接口" if api_rows else "映射"})
    dump(os.path.join(args.data, "deployments.json"), dep_rows)

    # ---- 策略目录（/internal/v1/strategies）：策略级部署金额，映射到 大类 + 币种 ----
    cat_rows = []
    for c in catalog:
        coin = c.get("coin")
        if not coin and c.get("api_strategy"):
            coin = alphanet_api.norm_coin(str(c["api_strategy"]).split()[-1])
        fam, sid = by_rule(coin) if coin else ("未分类", str(c.get("api_strategy")))
        cat_rows.append({"family": fam, "strategy": sid, "coin": coin, "api_strategy": c.get("api_strategy"), "api_family": c.get("api_family"),
                         "usdc": c.get("usdc"), "count": c.get("count"), "status": c.get("status"), "raw_keys": c.get("raw_keys")})
    dump(os.path.join(args.data, "strategy_catalog.json"), cat_rows)
    res = {
        "generated_at": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "method": {"window_days": WINDOW_DAYS, "min_signals": MIN_SIGNALS, "link": LINK,
                   "note": "同一策略会在多个钱包同时下单；按成交分钟 + 方向的重合度（Jaccard）做平均链接聚类"},
        "api": api_msg, "manual": len(manual), "families": fams, "deployments": len(dep_rows), "catalog": len(cat_rows),
        "groups": groups, "combos": out,
    }
    dump(os.path.join(args.data, "strategies.json"), res)
    srcs = {}
    for r in out: srcs[r["source"]] = srcs.get(r["source"], 0) + 1
    print(f"strategies: combos={len(out)} groups={len(groups)} sources={srcs} api={api_msg}")


if __name__ == "__main__":
    main()
