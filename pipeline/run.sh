#!/usr/bin/env bash
# 每日数据更新：抓取 Hyperliquid → 生成 data/*.json
# 用法：bash pipeline/run.sh            （增量，基于 data/addr_daily.json）
#      FULL=1 bash pipeline/run.sh     （全量重建所有历史）
set -euo pipefail
cd "$(dirname "$0")/.."
STARTED=$(date +%s)
WL=pipeline/watchlist.json
RAW=$(mktemp -t hlraw.XXXXXX.json)
PREV=data/addr_daily.json
mkdir -p data
if [[ "${FULL:-0}" == "1" || ! -s "$PREV" ]]; then PREV_ARG=(); else PREV_ARG=(--prev "$PREV"); fi

python3 pipeline/collector.py fetch     --watchlist "$WL" "${PREV_ARG[@]}" --raw "$RAW"
python3 pipeline/collector.py transform --watchlist "$WL" "${PREV_ARG[@]}" --raw "$RAW" --out data
python3 pipeline/extras.py --watchlist "$WL" --raw "$RAW" --data data --started "$STARTED"
python3 pipeline/strategies.py --watchlist "$WL" --raw "$RAW" --data data || echo "策略识别失败（不影响其它数据）"
python3 pipeline/client_cards.py --data data || echo "客户卡片生成失败（不影响其它数据）"
rm -f "$RAW"
