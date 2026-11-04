"""客户卡片数据：每个部署过的钱包一张卡片（策略 × 币种的盈亏、手续费、资金费、胜率）。

数据来源
  · AlphaNet 内部接口（环境变量 ALPHANET_API_KEY）：/internal/v1/deployments、/internal/v1/deployment-curve
  · Hyperliquid 公开接口：portfolio（账户总资产）、clearinghouseState（浮动盈亏）、userFillsByTime、userFunding

输出 data/client_cards.json；没有密钥时保留现有文件不动。
用法：python3 pipeline/client_cards.py --data data [--snapshot 内部接口快照.json]
"""
import argparse, datetime as dt, json, math, os, sys, time, urllib.parse, urllib.request
from collections import defaultdict

HL = 'https://api.hyperliquid.xyz/info'
BJ = dt.timezone(dt.timedelta(hours=8))
HERE = os.path.dirname(os.path.abspath(__file__))


def http_json(url, body=None, headers=None, tries=6):
    data = json.dumps(body).encode() if body is not None else None
    h = {'Content-Type': 'application/json', 'User-Agent': 'alphanet-hl-dashboard'}
    h.update(headers or {})
    for i in range(tries):
        try:
            return json.load(urllib.request.urlopen(urllib.request.Request(url, data=data, headers=h), timeout=30))
        except Exception:
            if i == tries - 1:
                raise
            time.sleep(1.5 * (i + 1))


def hl(body):
    return http_json(HL, body)


def internal(cfg, key):
    base = cfg['base_url'].rstrip('/')
    hdr = {cfg.get('auth_header', 'Internal-API-Key'): key}
    deps, since = [], '2026-01-01 00:00:00'
    for _ in range(50):
        q = urllib.parse.urlencode({'since': since, 'limit': 1000})
        r = http_json(f'{base}/internal/v1/deployments?{q}', headers=hdr)['data']
        deps += r.get('items') or []
        if not r.get('hasMore'):
            break
        since = r['nextSince']
    seen, uniq = set(), []
    for d in deps:
        if d['id'] not in seen:
            seen.add(d['id']); uniq.append(d)
    curves = {}
    for d in uniq:
        try:
            r = http_json(f"{base}/internal/v1/deployment-curve?deploymentId={urllib.parse.quote(d['id'])}", headers=hdr)
            curves[d['id']] = [[p['timeStamp'], p['roi']] for p in (r.get('data') or {}).get('daily') or []]
        except Exception:
            curves[d['id']] = []
        time.sleep(0.05)
    return uniq, curves


def paged(kind, wallet, start_ms, page_size, max_pages):
    out, t = [], start_ms
    for _ in range(max_pages):
        body = {'type': kind, 'user': wallet, 'startTime': t}
        if kind == 'userFillsByTime':
            body['aggregateByTime'] = True
        page = hl(body)
        if not page:
            break
        out += page
        if len(page) < page_size:
            break
        t = max(x['time'] for x in page) + 1
        time.sleep(0.25)
    return out


def card(wallet, deps, curves, now):
    st = hl({'type': 'clearinghouseState', 'user': wallet})
    pf = dict(hl({'type': 'portfolio', 'user': wallet}))
    av = (pf.get('day') or {}).get('accountValueHistory') or []
    assets = float(av[-1][1]) if av else float(st['marginSummary']['accountValue'])
    upnl = {p['position']['coin']: float(p['position']['unrealizedPnl']) for p in st.get('assetPositions', [])}
    start_ms = min(d['startAt'] for d in deps) * 1000
    fills = paged('userFillsByTime', wallet, start_ms, 2000, 10)
    funding = paged('userFunding', wallet, start_ms, 500, 60)
    oldest = min(f['time'] for f in fills) if len(fills) >= 10000 else 0  # HL 只保留最近 1 万笔

    rows = []
    for d in deps:
        amt = float(d['amountUsdc'])
        c = sorted(curves.get(d['id']) or [])
        roi = c[-1][1] if c else 0.0
        active = d['status'] in ('active', 'closing')
        end = now.timestamp() if active or not d.get('stopAt') else d['stopAt']
        lo, hi = d['startAt'] * 1000, end * 1000
        unreal = upnl.get(d['asset'], 0.0) if active else None
        daily = (amt * (c[-1][1] - c[-2][1]) if len(c) >= 2 else amt * c[-1][1] if c else None) if active else None
        orders, closed, fee = defaultdict(float), 0.0, 0.0
        for f in fills:
            if f['coin'] == d['asset'] and lo <= f['time'] <= hi:
                closed += float(f['closedPnl']); fee += float(f['fee'])
                if 'Close' in f.get('dir', ''):
                    orders[f['oid']] += float(f['closedPnl'])
        fund = sum(float(x['delta']['usdc']) for x in funding if x['delta'].get('coin') == d['asset'] and lo <= x['time'] <= hi)
        covered = lo >= oldest
        if covered:
            net, realized, fees = closed - fee + fund + (unreal or 0), closed, fee
        else:  # 成交超出 HL 可查范围：用内部接口的已扣费盈亏 + 资金费
            net, realized, fees = amt * roi + fund + (unreal or 0), None, None
        rows.append({
            'status': 'active' if active else 'withdrawn', 'strategy': d['strategy'], 'coin': d['asset'],
            'net': round(net, 2), 'realized': None if realized is None else round(realized, 2),
            'fees': None if fees is None else round(fees, 2), 'funding': round(fund, 2),
            'unrealized': None if unreal is None else round(unreal, 2), 'daily': None if daily is None else round(daily, 2),
            'usdc': amt, 'days': max(1, math.ceil((end - d['startAt']) / 86400)),
            'deploy': dt.datetime.fromtimestamp(d['startAt'], BJ).strftime('%Y-%m-%d'),
            'withdraw': None if active or not d.get('stopAt') else dt.datetime.fromtimestamp(d['stopAt'], BJ).strftime('%Y-%m-%d'),
            'win_rate': round(sum(v > 0 for v in orders.values()) / len(orders), 4) if orders else None,
            '_s': d['startAt'], '_e': end,
        })
    rows.sort(key=lambda r: (r['status'] != 'active', -r['_s']))
    # 收益率分母：同一时间部署中的最高本金（AlphaNet 以分配本金为分母）
    ev = sorted([(r['_s'], r['usdc']) for r in rows] + [(r['_e'], -r['usdc']) for r in rows], key=lambda x: (x[0], x[1]))
    cur = peak = 0
    for _, v in ev:
        cur += v; peak = max(peak, cur)
    for r in rows:
        r.pop('_s'); r.pop('_e')
    total = sum(r['net'] for r in rows)
    return {
        'addr': wallet, 'total_pnl': round(total, 2), 'return_pct': round(total / peak, 6) if peak else None,
        'unrealized': round(sum(r['unrealized'] or 0 for r in rows), 2), 'assets': round(assets, 2),
        'active': sum(r['status'] == 'active' for r in rows), 'withdrawn': sum(r['status'] != 'active' for r in rows),
        'partial': any(r['realized'] is None for r in rows), 'rows': rows,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--data', default='data')
    ap.add_argument('--snapshot', help='内部接口快照 JSON（{deployments, curves}），不填则用 ALPHANET_API_KEY 实时拉取')
    a = ap.parse_args()
    if a.snapshot:
        snap = json.load(open(a.snapshot))
        deps, curves = snap['deployments'], snap['curves']
        src = 'snapshot'
    else:
        key = os.environ.get('ALPHANET_API_KEY')
        if not key:
            print('client_cards: 未配置 ALPHANET_API_KEY，保留现有 client_cards.json'); return
        cfg = json.load(open(os.path.join(HERE, 'strategies.json')))['api']
        deps, curves = internal(cfg, key)
        src = 'api'
    by = defaultdict(list)
    for d in deps:
        by[d['wallet']].append(d)
    now = dt.datetime.now(BJ)
    cards, errs = [], []
    for w, ds in by.items():
        try:
            cards.append(card(w, ds, curves, now))
        except Exception as e:
            errs.append(f'{w}: {e}')
        time.sleep(0.4)
    cards.sort(key=lambda c: -c['assets'])
    out = {'generated_at': dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'), 'source': src, 'errors': errs, 'cards': cards}
    json.dump(out, open(os.path.join(a.data, 'client_cards.json'), 'w'), ensure_ascii=False, separators=(',', ':'))
    print(f'client_cards: {len(cards)} 张，失败 {len(errs)}')


if __name__ == '__main__':
    main()
