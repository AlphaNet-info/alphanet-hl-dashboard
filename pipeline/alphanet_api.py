"""AlphaNet 内部接口（Hyperliquid Internal）适配器。

  GET {base}/internal/v1/deployments   跨钱包部署流水（含 active / closing / terminal），按 since / data.nextSince 翻页
  GET {base}/internal/v1/strategies    策略目录（含部署金额）
  鉴权：Header  Internal-API-Key: <key>

字段名不固定时按候选列表自动识别；也可在 pipeline/strategies.json 的 api.fields 里显式指定（支持 a.b 嵌套路径）。
金额为 USDC 十进制字符串；startAt / stopAt 为 Unix 秒（stopAt 在终止前为 null）。
"""
import json, os, time, datetime as dt, urllib.request, urllib.parse

CANDIDATES = {
    "id": ["deploymentId", "id", "deployment_id", "uuid"],
    "addr": ["walletAddress", "wallet", "address", "userAddress", "user", "account", "wallet_address"],
    "coin": ["asset", "symbol", "coin", "token", "market", "pair", "instrument"],
    "strategy": ["strategyName", "strategy.name", "strategy_name", "strategy", "name", "strategyId", "strategy_id"],
    "family": ["strategyFamily", "family", "category", "strategy.family", "strategyCategory", "group", "series"],
    "usdc": ["usdcAmount", "usdc", "allocatedUsdc", "deployedUsdc", "deployAmount", "amount", "allocation", "capital",
             "principal", "investAmount", "totalUsdc", "totalDeployed", "deployed", "aum", "tvl", "allocatedCapital"],
    "start": ["startAt", "startTime", "start", "createdAt", "created_at", "start_at"],
    "stop": ["stopAt", "stopTime", "stop", "endAt", "stop_at", "end_at"],
    "status": ["status", "state", "deploymentStatus"],
    "count": ["activeDeployments", "deployments", "deploymentCount", "activeCount", "count", "wallets"],
}


def _get(rec, path):
    cur = rec
    for p in path.split("."):
        if isinstance(cur, dict) and p in cur:
            cur = cur[p]
        else:
            lower = {k.lower(): k for k in cur} if isinstance(cur, dict) else {}
            if p.lower() in lower:
                cur = cur[lower[p.lower()]]
            else:
                return None
    return cur


def pick(rec, key, fields):
    if fields.get(key):
        v = _get(rec, fields[key])
        return v if not isinstance(v, (dict, list)) else None
    for c in CANDIDATES[key]:
        v = _get(rec, c)
        if v not in (None, "") and not isinstance(v, (dict, list)):
            return v
    return None


def num(v):
    try:
        return float(str(v).replace(",", ""))
    except Exception:
        return None


def to_day(v):
    if v in (None, "", 0, "0"):
        return None
    if isinstance(v, (int, float)) or (isinstance(v, str) and v.isdigit()):
        x = float(v)
        if x > 1e12: x /= 1000
        return dt.datetime.fromtimestamp(x, dt.timezone.utc).strftime("%Y-%m-%d")
    return str(v)[:10]


def norm_coin(c):
    c = str(c or "").upper()
    for p in ("PERP_", "SPOT_"):
        if c.startswith(p): c = c[len(p):]
    for s in ("_USDC", "_USDT", "-USD", "/USDC", "-PERP", "USDC"):
        if c.endswith(s) and len(c) > len(s): c = c[: -len(s)]
    return c.strip("_-/")


def rows_of(body):
    """返回 (rows, nextSince)"""
    nxt = None
    cur = body
    for _ in range(4):
        if isinstance(cur, dict):
            nxt = nxt or cur.get("nextSince") or cur.get("next_since") or cur.get("next")
            for k in ("data", "list", "rows", "items", "results", "records", "deployments", "strategies"):
                if k in cur and isinstance(cur[k], (list, dict)):
                    cur = cur[k]; break
            else:
                break
        else:
            break
    if isinstance(cur, dict):
        nxt = nxt or cur.get("nextSince")
        for v in cur.values():
            if isinstance(v, list): cur = v; break
    return (cur if isinstance(cur, list) else []), nxt


class Client:
    def __init__(self, cfg):
        api = cfg.get("api") or {}
        self.base = (os.environ.get("ALPHANET_API_BASE") or api.get("base_url") or "https://trades.alphanet.global/api").rstrip("/")
        self.key = os.environ.get("ALPHANET_API_KEY") or os.environ.get("ALPHANET_API_TOKEN")
        self.header = api.get("auth_header") or "Internal-API-Key"
        self.prefix = api.get("auth_prefix") or ""
        self.dep_path = api.get("deployments_path") or "/internal/v1/deployments"
        self.str_path = api.get("strategies_path") or "/internal/v1/strategies"
        self.limit = int(api.get("limit") or 1000)
        self.since_start = os.environ.get("ALPHANET_API_SINCE") or api.get("since_start")   # 北京时间 YYYY-MM-DD HH:mm:ss
        self.fields = api.get("fields") or {}
        self.sfields = api.get("strategy_fields") or {}
        self.calls = 0

    def get(self, path, params=None):
        url = self.base + path + (("?" + urllib.parse.urlencode(params)) if params else "")
        req = urllib.request.Request(url, headers={"Accept": "application/json", self.header: self.prefix + self.key,
                                                   "User-Agent": "alphanet-hl-dashboard"})
        for t in range(4):
            try:
                self.calls += 1
                with urllib.request.urlopen(req, timeout=60) as r:
                    return json.loads(r.read())
            except urllib.error.HTTPError as e:
                if e.code in (429, 502, 503) and t < 3:
                    time.sleep(3 * (t + 1)); continue
                raise
        return None

    def deployments(self):
        out, seen, since, pages = [], set(), self.since_start, 0
        while pages < 500:
            params = {"limit": self.limit}
            if since: params["since"] = since
            body = self.get(self.dep_path, params); pages += 1
            rows, nxt = rows_of(body)
            new = 0
            for r in rows:
                rid = pick(r, "id", self.fields) or json.dumps(r, sort_keys=True)[:200]
                if rid in seen: continue
                seen.add(rid); new += 1; out.append(r)
            if not nxt or nxt == since or new == 0: break
            since = nxt
        return out

    def strategies(self):
        body = self.get(self.str_path)
        rows, _ = rows_of(body)
        return rows


def fetch(cfg):
    """返回 (deployments, catalog, message)。deployments: [{id, addr, coin, api_strategy, api_family, usdc, start, stop, status}]"""
    c = Client(cfg)
    if not c.key:
        return [], [], "未配置（缺少 ALPHANET_API_KEY）"
    deps, cat, msgs = [], [], []
    try:
        for r in c.deployments():
            addr, coin = pick(r, "addr", c.fields), pick(r, "coin", c.fields)
            if not addr or not coin: continue
            deps.append({"id": pick(r, "id", c.fields), "addr": str(addr).lower(), "coin": norm_coin(coin),
                         "api_strategy": pick(r, "strategy", c.fields), "api_family": pick(r, "family", c.fields),
                         "usdc": num(pick(r, "usdc", c.fields)), "start": to_day(pick(r, "start", c.fields)),
                         "stop": to_day(pick(r, "stop", c.fields)), "status": pick(r, "status", c.fields)})
        msgs.append(f"deployments {len(deps)} 条")
    except Exception as e:
        msgs.append(f"deployments 失败：{e}")
    try:
        for r in c.strategies():
            cat.append({"api_strategy": pick(r, "strategy", c.sfields), "api_family": pick(r, "family", c.sfields),
                        "coin": norm_coin(pick(r, "coin", c.sfields)) if pick(r, "coin", c.sfields) else None,
                        "usdc": num(pick(r, "usdc", c.sfields)), "count": num(pick(r, "count", c.sfields)),
                        "status": pick(r, "status", c.sfields), "raw_keys": sorted(r.keys()) if isinstance(r, dict) else []})
        msgs.append(f"strategies {len(cat)} 条")
    except Exception as e:
        msgs.append(f"strategies 失败：{e}")
    return deps, cat, "接口：" + "；".join(msgs) + f"（{c.calls} 次请求）"
