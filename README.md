# AlphaNet Hyperliquid 综合看板

纯静态站点（HTML + JS + JSON），可以直接部署到 Vercel。数据每天由 GitHub Actions 从 Hyperliquid 公开 API 抓取，然后提交到 `data/`。提交后 Vercel 自动重新部署。

## 视角与页面

| 页面 | 面向 | 内容 |
|---|---|---|
| 公司总览 | 管理层 / 公司整体 | 总资金、区间与昨日官方盈亏、收益率、交易量、手续费、浮动盈亏、胜率天数；资金规模与累计盈亏曲线；每日盈亏构成（已实现 / 手续费 / 资金费）；盈亏归因（成交口径 vs 官方口径）；净流入；盈亏 Top 5 |
| 周报 / 月报 | 管理层 | ISO 周和自然月汇总、环比、当周每日明细、币种排行、地址盈亏排行 |
| 运营分析 | 运营 | 活跃地址、成交笔数、地址交易量贡献与集中度、币种分布、Maker/Taker 结构、开仓方向、资金分层、地址状态、分组、地址运营明细（活跃天数、连续闲置、换手、费率） |
| 地址分析 | 运营 / 风控 | 地址总览表（可搜索、排序），点击进入单地址详情（资金曲线、每日盈亏、币种贡献、持仓、每日明细、Explorer 链接），以及地址 × 日期盈亏热力图 |
| 币种分析 | 运营 / 研究 | 每日币种交易量堆叠、币种明细（净盈亏、平仓胜率、Maker 占比、多空方向、当前持仓），以及币种 × 日期盈亏热力图 |
| 策略分析 | 策略 / 研究 | 策略汇总：交易量、已实现、手续费、资金费、交易净盈亏、bps、收益率、胜率、盈亏天、最大日亏、持仓；累计净盈亏曲线与排行；策略触发监控（策略 × 日期）；策略详情（成员地址对比、成员离散度、成员 × 日期热力图）；休眠组合 |
| 风控与持仓 | 风控 | 严重 / 警告 / 提示数量，持仓名义、净敞口、组合杠杆、强平距离、集中度；风险提醒列表；币种多空敞口；地址杠杆与回撤（带阈值线）；持仓明细；预警规则 |
| 运维监控 | 运维 | 管道健康状态、数据新鲜度、上次耗时、API 调用和限流次数、9 项数据质量检查、运行记录、数据覆盖矩阵、各地址抓取统计、数据文件、口径偏差、浏览器端 API 探测 |

右上角有两个全局控件：

- 时间范围：7 / 14 / 30 天 / 全部。
- 「实时刷新」：浏览器直接调用 Hyperliquid API 拉取 `clearinghouseState`，把资金、持仓、浮盈和杠杆换成实时值。在链接后加 `?live` 打开页面时会自动实时刷新。

## 部署到 Vercel

1. 新建一个 **私有** GitHub 仓库，把本目录全部推上去：
   ```bash
   git init && git add . && git commit -m "init"
   git remote add origin git@github.com:<你>/alphanet-hl-dashboard.git
   git push -u origin main
   ```
2. 在 Vercel 中选择 **Add New → Project**，导入这个仓库：
   - Framework Preset 选 **Other**；
   - Build Command 和 Output Directory 都留空。
   
   然后点 Deploy。
3. 建议在 Vercel 项目的 **Settings → Deployment Protection** 里开启 Vercel Authentication 或 Password Protection。看板包含资金和持仓数据，默认是公开链接。
4. 在 GitHub 仓库的 **Settings → Actions → General → Workflow permissions** 中选择 **Read and write permissions**。工作流需要把数据提交回仓库。
5. 到 **Actions → 每日更新数据 → Run workflow** 手动跑一次，确认成功。之后它会在每天 00:07 UTC（北京时间 08:07）自动运行。

不用 GitHub 的话，也可以在本地运行 `bash pipeline/run.sh`，再执行 `vercel --prod`。

## 本地预览

```bash
python3 -m http.server 8000   # 打开 http://localhost:8000
```

## 修改监控名单和阈值

编辑 `pipeline/watchlist.json`：

```json
{
  "since": "2026-10-01",
  "alerts": { "day_loss_pct": 5, "drawdown_pct": 10, "leverage_max": 3, "...": "..." },
  "addresses": [
    { "addr": "0x…", "label": "#1 0x37cD…A971", "added": "2026-10-30", "group": "策略A", "owner": "张三" }
  ]
}
```

- `group` / `owner` 是可选字段。填写后，运营页的「分组」表和地址筛选会按它们汇总。
- 新加入的地址会在下次运行时自动拉取全部历史。
- 需要全量重建时，在 Actions 中手动运行并把 `full` 设为 `1`，或者本地执行 `FULL=1 bash pipeline/run.sh`。

## 策略识别

AlphaNet 规定一个账户的一个币种只部署一个策略，所以「地址 × 币种」就是一个部署组合。`pipeline/strategies.py` 按以下优先级给每个组合确定所属策略：

1. **内部部署接口**：在 GitHub 仓库的 Settings → Secrets → Actions 中配置 `ALPHANET_DEPLOYMENTS_URL` 和 `ALPHANET_API_TOKEN`。
   - 接口返回的字段名如果和默认的不同（`address / asset / strategy / name / usdc / start / stop / status`），在 `pipeline/strategies.json` 的 `api_fields` 里改成实际的字段名。
   - 返回中的币种可以写成 `PERP_ZEC_USDC` 这类格式，会自动转换成 `ZEC`。
   - 部署 USDC 用来计算收益率。
2. **手动映射**：在 `pipeline/strategies.json` 的 `deployments` 里填写，例如 `{"addr": "0x…", "coin": "XMR", "strategy": "Hackworth OptimaLong", "usdc": 50000}`。
3. **自动推断**（默认）：同一策略的信号会在多个钱包几乎同时成交。程序取最近 21 天的成交，按「成交分钟 + 方向」的重合度（Jaccard）做平均链接聚类，聚成 `XMR-A`、`XMR-B` 这样的策略组。
   - 在 `names` 里写 `{"XMR-A": "真实策略名"}` 即可改成真实名称。
   - 与其它钱包都不重合的组合会标为「独立组合」。
   - 推断依赖的成交缓存保存在 `pipeline/cache/signals.json`，每天随数据一起提交。

## 数据管道

```
pipeline/run.sh
 ├─ collector.py fetch      增量抓取 userFillsByTime / userFunding / portfolio / clearinghouseState（429 自动退避）
 ├─ collector.py transform  → daily_total / addr_daily / addr_summary / positions / alerts / alert_rules
 ├─ extras.py               → coin_daily（币种维度，增量合并）/ exposure_daily（持仓快照）/ health / run_log / meta
 └─ strategies.py           → strategies（地址 × 币种 → 策略：接口 > 映射 > 自动推断）
```

`collector.py` 与 Claude 看板里的采集脚本口径一致，在此基础上增加了：

- 成交方向和 Maker/Taker 字段；
- API 调用统计。

## 口径说明

- 所有日期都按 **UTC** 划分；只统计完整日。
- **官方盈亏**取自 Hyperliquid portfolio 的盈亏历史，包含持仓浮动盈亏的变化。
- **交易净盈亏**的计算方式是：已实现 − 手续费 + 资金费。两者的差额主要来自浮盈变化。
- **净流入**的计算方式是：资金变化 − 官方盈亏，包括入金、出金、转账和金库操作。
- Hyperliquid 每个地址只返回最近 1 万笔成交。高频地址更早的成交拿不到，所以它们的币种明细无法回补。日级汇总（`addr_daily`）沿用了历史数据，不受这个限制。运维页的「币种明细与地址明细一致」检查会标出受影响的日期。
