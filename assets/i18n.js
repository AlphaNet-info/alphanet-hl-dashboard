/* AlphaNet Hyperliquid 看板 — 中英文切换
 * 页面代码仍输出中文；英文模式下把页面文字、属性、图表画布文字按词典替换成英文（最长匹配优先）。
 * 切换按钮 #lang-btn，选择保存在 localStorage('hl-lang')。
 */
(function () {
  let lang = 'zh';
  try { lang = localStorage.getItem('hl-lang') || 'zh'; } catch (e) {}
  const D = {
    // ---- 导航 / 视图 ----
    '公司总览': 'Overview', '周报 / 月报': 'Weekly / Monthly', '运营分析': 'Operations', '地址分析': 'Addresses',
    '客户卡片': 'Client Cards', '币种分析': 'Coins', '策略分析': 'Strategies', '风控与持仓': 'Risk & Positions',
    '运维监控': 'DevOps', '管理层': 'Management', '运营': 'Operations', '策略': 'Strategy', '风控': 'Risk', '运维': 'DevOps',
    '综合看板': 'Dashboard', 'Hyperliquid 综合看板': 'Hyperliquid Dashboard',
    '公司整体经营：资金规模、盈亏、交易量与成本': 'Company-wide: capital, PnL, volume and costs',
    '按 ISO 周（周一至周日）与自然月汇总，UTC 口径': 'Grouped by ISO week (Mon–Sun) and calendar month, UTC',
    '地址活跃度、交易量贡献、成交结构与费率': 'Address activity, volume contribution, trade mix and fee rates',
    '每个监控地址的表现、明细与盈亏热力图': 'Performance, details and PnL heatmap for each monitored address',
    '每个部署钱包的策略 × 币种盈亏、手续费、资金费与胜率，可导出图片发给客户': 'Strategy × coin PnL, fees, funding and win rate per deployed wallet; export as an image for clients',
    '各币种成交、盈亏': 'Volume and PnL by coin', '与多空方向': 'and long/short direction',
    '总策略 → 大类': 'All strategies → family', '策略（大类 + 币种）→ 部署': 'strategy (family + coin) → deployment',
    '风险提醒、持仓敞口、杠杆、强平距离与回撤': 'Risk alerts, exposure, leverage, liquidation distance and drawdown',
    '数据新鲜度、采集管道健康、数据质量检查与 API 探测': 'Data freshness, pipeline health, data-quality checks and API probes',
    '时间范围': 'Time range', '实时刷新': 'Live refresh', '拉取中': 'Fetching', '已更新': 'Updated', '切换主题': 'Toggle theme', '菜单': 'Menu',
    '加载数据中': 'Loading data', '数据截至': 'Data as of', '北京时间': 'Beijing time', '北京': 'Beijing',
    '监控地址': 'monitored addresses', '监控': 'Monitoring', '起始': 'Since', '更新': 'Updated',
    // ---- 横幅 / 实时 ----
    '已更新：账户资金、持仓、浮动盈亏、杠杆、近 24 小时盈亏与交易量。每日图表、日度盈亏和风险提醒仍为每天': 'Updated: equity, positions, unrealized PnL, leverage, 24h PnL and volume. Daily charts, daily PnL and risk alerts are still from the daily run at',
    '的数据': 'data', '实时数据': 'Live data', '实时拉取部分失败': 'Live refresh partly failed',
    '个地址失败，已使用快照数据代替': 'addresses failed; snapshot data used instead',
    '数据已过期': 'Data is stale', '最近一次更新是': 'Last update was', '请到「运维监控」检查 GitHub Actions 运行状态': 'check the GitHub Actions run in DevOps',
    '数据检查未通过': 'Data checks failed', '条严重提醒': 'critical alerts',
    '近 24 小时 · 实时': 'Last 24h · live', '账户总资金 · 实时': 'Total equity · live',
    '刚才从 Hyperliquid clearinghouseState 拉取的账户价值合计': 'Sum of account values just fetched from Hyperliquid',
    '的 day 窗口（滚动 24 小时，不是 UTC 自然日）': 'day window (rolling 24 hours, not a UTC calendar day)',
    '从 Hyperliquid API 实时拉取资金与持仓': 'Fetch live equity and positions from the Hyperliquid API',
    '浏览器实时拉取': 'Browser live fetch', '点右上角「实时刷新': 'Click "Live refresh" (top right',
    '实时': 'live', '快照': 'snapshot', '最近快照': 'latest snapshot', '未执行': 'Not run',
    // ---- KPI / 通用指标 ----
    '账户总资金': 'Total equity', '账户资金': 'Equity', '资金': 'Equity', '部署金额': 'Deployed', '资金利用率': 'Utilization',
    '区间官方盈亏': 'Period official PnL', '官方盈亏': 'Official PnL', '本期累计盈亏': 'Cumulative PnL (period)',
    '累计官方盈亏': 'Cumulative official PnL', '每日官方盈亏': 'Daily official PnL', '周官方盈亏': 'Weekly official PnL',
    '昨日盈亏': 'PnL yesterday', '昨日交易量': 'Volume yesterday', '昨日活跃地址': 'Active addresses yesterday',
    '昨日活跃部署': 'Active deployments yesterday', '当前浮动盈亏': 'Unrealized PnL', '浮动盈亏': 'Unrealized PnL',
    '持仓浮亏': 'Unrealized loss', '浮盈': 'Unrealized', '已实现盈亏': 'Realized PnL', '已实现': 'Realized',
    '交易净盈亏': 'Net trading PnL', '交易净额': 'Net trading', '净盈亏': 'Net PnL', '总交易净盈亏': 'Total net trading PnL',
    '区间交易净盈亏': 'Period net trading PnL', '区间累计交易净盈亏': 'Period cumulative net trading PnL',
    '每日交易净盈亏': 'Daily net trading PnL', '手续费': 'Fees', '资金费': 'Funding', '资金费记录': 'Funding records',
    '持仓资金费': 'Position funding', '交易量': 'Volume', '区间交易量': 'Period volume', '每日交易量': 'Daily volume',
    '周交易量': 'Weekly volume', '盈利 / 亏损天数': 'Up / down days', '日胜率': 'Daily win rate', '平仓胜率': 'Close win rate',
    '胜率': 'Win rate', '收益率': 'Return', '盈亏': 'PnL', '盈利': 'Profit', '亏损': 'Loss', '盈亏比': 'Profit factor',
    '夏普': 'Sharpe', '最大回撤': 'Max drawdown', '当前回撤': 'Current drawdown', '回撤': 'Drawdown', '盈亏回撤': 'PnL drawdown',
    '杠杆': 'Leverage', '实际杠杆': 'Effective leverage', '组合杠杆': 'Portfolio leverage', '杠杆 / 名义': 'Leverage / notional',
    '名义价值': 'Notional', '持仓名义价值': 'Position notional', '持仓名义': 'Position notional', '名义': 'Notional',
    '净敞口': 'Net exposure', '净流入': 'Net inflow', '净流出': 'Net outflow', '每日净流入': 'Daily net inflow',
    '入金': 'Deposit', '出金': 'Withdrawal', '资金变动': 'Equity change', '资金曲线': 'Equity curve',
    '资金规模与部署金额': 'Equity and deployed amount', '资金与部署金额': 'Equity & deployed',
    '待接入内部部署接口': 'Internal deployment API not connected', '部署金额来自内部部署接口，尚未接入': 'Deployed amounts come from the internal deployment API (not connected yet)',
    '内部部署接口的部署 USDC 合计（当前生效的部署）': 'Sum of deployed USDC from the internal API (current deployments)',
    '所有监控地址的日终账户资金合计；部署金额待接入内部接口': 'End-of-day equity of all monitored addresses; deployed amount pending the internal API',
    '账户资金（日终）与内部接口的部署金额': 'End-of-day equity and deployed amount from the internal API',
    '活跃地址': 'Active addresses', '每日活跃地址数': 'Daily active addresses', '当日有成交的地址': 'Addresses with trades that day',
    '交易地址': 'Trading addresses', '交易币种数': 'Coins traded', '交易天数': 'Trading days', '活跃天数': 'Active days', '活跃率': 'Activity rate',
    '日均': 'Avg/day', '日均交易量 ÷ 当前资金': 'Avg daily volume ÷ current equity', '日均换手': 'Avg daily turnover',
    '日均成交笔数': 'Avg trades/day', '单地址日均交易量': 'Avg daily volume per address',
    '成交笔数': 'Trades', '每日成交笔数': 'Daily trades', '笔数': 'Trades', '笔 · 日均': 'trades · avg/day', '笔 · 占总量': 'trades · share',
    '成交占比': 'Share of trades', '成交额占比': 'Share of volume', '占总量': 'of total', '占持仓': 'of positions', '占资金': 'of equity',
    '占前一日资金': 'of prior-day equity', '占前日资金': 'of prior-day equity', '占投入资金': 'of invested capital', '占比': 'Share',
    '占交易量': 'of volume', '量占比': 'volume share', '费率': 'Fee rate', '综合费率': 'Blended fee rate',
    '挂单成交': 'Maker fills', '挂单': 'Maker', '吃单': 'Taker', '全部吃单': 'All taker',
    '全部吃单时改为挂单可降低手续费': 'switching taker fills to maker would cut fees',
    '开多': 'Long open', '开空': 'Short open', '开多占比': 'Long-open share', '开仓方向': 'Open direction',
    '每日开多 vs 开空成交额': 'Daily long vs short open volume', '多头': 'Long', '空头': 'Short', '多': 'Long', '空': 'Short',
    '多头为正、空头为负的名义价值': 'Notional, long positive / short negative',
    '较前日': 'vs prev day', '环比': 'vs prior', '期初': 'Start', '期末': 'End', '期末资金': 'Ending equity', '期末部署': 'Ending deployed',
    '日终资金': 'End-of-day equity', '日终': 'end of day', '区间合计': 'Period total', '区间平均': 'Period avg', '区间盈亏': 'Period PnL',
    '本期': 'Period', '区间': 'Period', '累计': 'Cumulative', '合计': 'Total', '汇总': 'Summary', '平均': 'Avg',
    '最赚钱币种': 'Best coin', '最亏钱币种': 'Worst coin', '第一大币种': 'Top coin', '最大单币敞口': 'Largest coin exposure',
    '前 3 币种占比': 'Top-3 coin share', '前 3 大地址资金占比': 'Top-3 address equity share', '资金集中度': 'Equity concentration',
    '持仓集中度': 'Position concentration', '集中度': 'Concentration', '最大日亏': 'Worst day', '最大日盈': 'Best day',
    '最近强平距离': 'Nearest liquidation', '距强平价仅': 'only', '距强平': 'To liq.', '接近强平': 'Near liquidation',
    '全部持仓无强平价（低杠杆全仓）': 'No liquidation price on any position (low-leverage cross)',
    '开仓价': 'Entry', '标记价': 'Mark', '仓位数': 'Positions', '当前持仓': 'Positions', '当前持仓币种': 'Coins held',
    '持仓明细': 'Position details', '持仓中': 'Holding', '无持仓': 'No position', '持仓': 'Positions',
    '全仓': 'cross', '逐仓': 'isolated', '方向': 'Side',
    // ---- 表头 / 通用词 ----
    '地址': 'Address', '地址总览': 'Address overview', '地址数': 'Addresses', '个地址': 'addresses', '地址状态': 'Address status',
    '地址杠杆': 'Address leverage', '地址当前回撤': 'Current drawdown by address', '预警': 'Alert', '级别': 'Level', '规则': 'Rule',
    '说明': 'Details', '日期': 'Date', '币种': 'Coin', '状态': 'Status', '备注': 'Note', '分组': 'Group', '未分组': 'Ungrouped',
    '未分类': 'Unclassified', '时间': 'Time', '月份': 'Month', '最后成交': 'Last trade', '最近交易': 'Last trade', '首次交易': 'First trade',
    '首次': 'First', '最后一天': 'Last day', '最后数据日': 'Last data day', '数据日': 'Data day', '搜索地址': 'Search address',
    '搜索地址 / 备注 / 分组': 'Search address / note / group', '点击行查看详情': 'click a row for details',
    '点击某一周查看当周详情': 'Click a week for details', '口径的盈亏与交易量；资金、浮盈、杠杆为': 'PnL and volume; equity, unrealized and leverage are',
    '区间口径；点击地址进入详情': 'period basis; click an address for details', '暂无数据': 'No data', '无数据': 'No data', '无记录': 'No records',
    '无提醒': 'No alerts', '需关注': 'Needs attention', '正常': 'OK', '严重': 'Critical', '警告': 'Warning', '提示': 'Info', '通过': 'Pass',
    '未通过': 'Fail', '异常': 'Error', '失败': 'Failed', '成功': 'OK', '健康': 'Healthy', '未知': 'Unknown', '进行中': 'in progress',
    '进行中）': 'in progress)', '其他': 'Other', '其余币种': 'Other coins', '其余所有币种': 'All other coins', '个小币种': 'small coins',
    '全部': 'All', '上周': 'Last week', '周报': 'Weekly', '月报': 'Monthly', '周度汇总': 'Weekly summary', '月度汇总': 'Monthly summary',
    '自然月（UTC）': 'Calendar month (UTC)', '当周地址表现 · 盈利': 'Addresses this week · winners', '当周地址表现 · 亏损': 'Addresses this week · losers',
    '当周币种': 'Coins this week', '当周每日': 'Daily this week', '周度 × 大类': 'Week × family', '周；交易净盈亏': 'weeks; net trading PnL',
    '最好': 'Best', '最差': 'Worst', '小时前': 'h ago', '分钟前': 'min ago', '笔': 'trades', '次': 'times', '个': '',
    '条': '', '倍': 'x', '共': 'Total', '无': 'None', '较': 'vs',
    // ---- 地址 / 运营 ----
    '地址 × 日期 盈亏热力图': 'Address × date PnL heatmap', '每格为当日官方盈亏占前日资金的比例；颜色越深幅度越大': 'Each cell is the day’s official PnL as a share of prior-day equity; darker = larger',
    '地址交易量占比': 'Volume share by address', '地址交易量贡献': 'Volume contribution by address', '区间交易量占比，按地址排序': 'Period volume share, by address',
    '地址运营明细': 'Address operations detail', '闲置地址': 'Idle addresses', '连续闲置': 'Idle streak', '停止交易': 'Stopped trading',
    '已连续': 'for', '天没有成交（最近一次': 'days with no trades (last', '已连续 12 天没有成交（最近一次 2026-10-22）': 'No trades for 12 days (last 2026-10-22)',
    '区间新开始交易': 'Started trading in period', '每日明细': 'Daily details', '每日结构': 'Daily mix', '每日盈亏构成': 'Daily PnL breakdown',
    '盈亏构成 · 大类': 'PnL breakdown · family', '已实现、手续费（负）、资金费': 'Realized, fees (negative), funding',
    '已实现盈亏、手续费（负）、资金费逐日堆叠；与官方盈亏的差额主要是持仓浮动盈亏变化': 'Realized, fees (negative) and funding stacked by day; the gap to official PnL is mostly the change in unrealized PnL',
    '从区间第一天起逐日累计': 'Cumulative from the first day of the period', '绿色盈利，红色亏损': 'Green = profit, red = loss',
    '有平仓盈亏的成交中，盈利成交占比': 'Share of closing fills with positive PnL', '平均盈利日 ÷ 平均亏损日': 'Avg up day ÷ avg down day',
    '日交易净盈亏 均值 ÷ 标准差': 'Daily net trading PnL mean ÷ std', '区间累计交易净盈亏从高点的最大回落': 'Largest fall from peak in cumulative net trading PnL',
    '亏天 · 胜率': 'down days · win rate', '天 · 亏': 'd · down', '亏天': 'down days',
    // ---- 币种 ----
    '币种明细': 'Coin details', '币种贡献': 'Coin contribution', '币种多空敞口': 'Long/short exposure by coin', '币种交易量分布': 'Volume by coin',
    '每日币种交易量': 'Daily volume by coin', '币种 × 日期 交易净盈亏热力图': 'Coin × date net trading PnL heatmap',
    '每格为当日该币种 已实现': 'Each cell: that coin’s daily realized', '手续费 + 资金费': 'fees + funding',
    '区间成交额，前 7 个币种 + 其他': 'Period volume, top 7 coins + other', '前 5 个币种 + 其他，堆叠': 'Top 5 coins + other, stacked',
    '按成交额排序': 'Sorted by volume', '交易量前': 'Top by volume',
    // ---- 策略 ----
    '大类': 'Family', '个大类': 'families', '策略明细': 'Strategy details', '策略详情': 'Strategy detail', '策略目录': 'Strategy catalog',
    '策略净盈亏排行': 'Strategy net PnL ranking', '策略交易效率': 'Strategy trading efficiency', '交易净盈亏 ÷ 交易量': 'Net trading PnL ÷ volume',
    '交易量（bps），越高越好': 'volume (bps), higher is better', '每日交易净盈亏 · 大类': 'Daily net trading PnL · family',
    '累计交易净盈亏 · 大类': 'Cumulative net trading PnL · family', '每日交易量 · 大类': 'Daily volume · family', '按大类堆叠': 'stacked by family',
    '虚线为总策略': 'dashed = all strategies', '地址 × 大类': 'Address × family', '每个地址在各大类上的交易净盈亏（可排序）': 'Net trading PnL per address by family (sortable)',
    '按大类排列；颜色越深金额越大': 'by family; darker = larger', '该策略在每个地址上的表现': 'This strategy on each address',
    '策略 × 日期 交易净盈亏': 'Strategy × date net trading PnL', '部署 × 日期 交易净盈亏': 'Deployment × date net trading PnL',
    '各部署累计净盈亏': 'Cumulative net PnL by deployment', '各部署 净盈亏': 'Net PnL by deployment', '部署间差异': 'Spread across deployments',
    '同一策略在不同地址上的结果差异；越大说明仓位、时点或滑点越不一致': 'Result spread of one strategy across addresses; larger = more divergence in sizing, timing or slippage',
    '部署明细': 'Deployments', '部署': 'Deployment', '个部署': 'deployments', '条部署': 'deployments', '部署数': 'Deployments',
    '地址 × 币种 部署组合数': 'Address × coin deployment combos', '一个部署组合': 'one deployment combo', '信号组': 'Signal group',
    '交易净盈亏 ÷ 区间平均部署金额': 'Net trading PnL ÷ avg deployed in period', '持仓名义 ÷ 部署': 'Position notional ÷ deployed', '利用率': 'Utilization',
    '大类小计 → 各策略（大类 + 币种）。交易净盈亏为成交口径，不含持仓浮盈；区间交易量不足': 'Family subtotal → strategies (family + coin). Net trading PnL is fill-based, excluding unrealized; strategies with period volume under',
    '且无持仓的币种合并为「其他小币种」；点击策略名看详情': 'and no position are merged into "other small coins"; click a strategy for details',
    '可能是同一策略的不同参数或不同批次部署，可在下方部署明细的「信号组」列对比表现': 'may be different parameters or batches of one strategy; compare in the "Signal group" column below',
    '同一策略下有': 'This strategy has', '组不同的下单节奏': 'distinct order rhythms', '分类按币种': 'Classified by coin',
    '分类按币种（families 规则），不按地址': 'Classified by coin (families rules), not by address', '接口策略名': 'API strategy name',
    '只看此类': 'This family only', '全平台部署': 'Platform-wide deployments', '全平台部署（内部接口）': 'Platform-wide deployments (internal API)',
    '监控地址部署': 'Monitored-address deployments', '未纳入监控的部署钱包': 'Deployed wallets not monitored',
    '内部接口里有正在运行的部署、但不在': 'Wallets with running deployments in the internal API but not in',
    '里的钱包；需要的话加入名单，下次运行会自动补齐历史': '; add them and the next run backfills history',
    '加入名单': 'Add to list', '下单部署': 'Ordering deployment', '策略目录部署': 'Catalog deployments', '看板策略': 'Dashboard strategies',
    '最近 21 天与其它地址同步下单的分组': 'Groups ordering in sync with other addresses in the last 21 days',
    '已接入': 'Connected', '未接入': 'Not connected', '未配置': 'Not configured', '部署接口': 'Deployment API', '内部接口': 'Internal API',
    '内部部署接口': 'Internal deployment API', '手动映射': 'Manual mapping', '映射': 'Mapping', '的当前部署金额，含不在监控名单里的钱包': 'current deployed amount, including wallets not monitored',
    // ---- 风控 ----
    '风险提醒': 'Risk alerts', '严重提醒': 'Critical alerts', '预警规则': 'Alert rules', '阈值': 'Threshold', '按 alert_rules 阈值生成': 'Generated from alert_rules thresholds',
    '持仓为实时数据，提醒仍为最近一次采集结果': 'positions are live; alerts are from the latest collection', '最近一次采集结果': 'latest collection result',
    '持仓名义 ÷ 资金；虚线为警告阈值': 'Position notional ÷ equity; dashed = warning threshold',
    '本期盈亏从高点回落 ÷ 当前资金；虚线为阈值': 'Fall from peak period PnL ÷ current equity; dashed = threshold',
    '本期盈亏从高点回撤': 'Period PnL drawdown from peak', '本期盈亏从高点回撤 ': 'Period PnL drawdown from peak ',
    '以来累计亏损': 'cumulative loss since', '累计亏损': 'Cumulative loss', '当日亏损': 'Daily loss', '大额流出': 'Large outflow', '杠杆过高': 'High leverage',
    '当前持仓浮亏': 'Unrealized loss on positions', '持仓集中': 'Position concentration', '零资金': 'Zero equity', '小额账户豁免': 'Small-account exemption',
    '倍（阈值': 'x (threshold', '（阈值': ' (threshold', '阈值在': 'Thresholds in', '的 alerts 中修改': 'alerts section',
    '曾经交易过的地址连续这么多天没有成交': 'Address that has traded goes this many days without a trade',
    '最近一个完整日的官方盈亏为亏损，且亏损额超过前一日资金的这个比例': 'Latest full day official PnL is a loss larger than this share of prior-day equity',
    '最近一个完整日净流出（出金、转出、存入金库）超过前一日资金的这个比例': 'Latest full day net outflow (withdrawals, transfers, vault deposits) exceeds this share of prior-day equity',
    '本期累计官方盈亏从最高点回落的金额超过当前资金的这个比例': 'Fall from peak cumulative official PnL exceeds this share of current equity',
    '快照时所有持仓的浮动亏损合计超过当前资金的这个比例': 'Total unrealized loss at snapshot exceeds this share of current equity',
    '任一持仓的标记价距离强平价不足这个比例': 'Any position’s mark price is within this distance of liquidation',
    '持仓名义价值合计 ÷ 当前资金 超过这个倍数': 'Total position notional ÷ current equity exceeds this multiple',
    '资金低于这个金额的地址不做以上百分比类检查，避免小额账户误报': 'Addresses with equity below this skip the percentage checks above, to avoid false alerts on small accounts',
    '资金低于这个金额的地址不做百分比类检查（避免小额账户误报）': 'Addresses with equity below this skip percentage checks (avoids false alerts on small accounts)',
    '以来累计官方亏损超过投入资金（当前资金': 'cumulative official loss since start exceeds invested capital (current equity',
    '本期盈亏）的这个比例': 'period PnL) by this share', '严重：当日盈亏亏损超过前一日资金的': 'Critical: daily loss exceeds prior-day equity by',
    '严重：当前持仓浮亏超过当前资金的': 'Critical: unrealized loss exceeds current equity by', '严重：任一持仓距离强平价不足': 'Critical: a position is within',
    '警告：本期盈亏从高点回撤超过当前资金的': 'Warning: period drawdown exceeds current equity by', '警告：本期累计亏损超过投入资金的': 'Warning: cumulative loss exceeds invested capital by',
    '警告：持仓名义价值': 'Warning: position notional', '资金 超过 X 倍': 'equity above X', '提示：当日净流出超过前一日资金的': 'Info: daily net outflow exceeds prior-day equity by',
    '提示：连续 X 天没有成交': 'Info: no trades for X days', '连续 ≥3 天无成交或无持仓': '≥3 days with no trades or positions',
    '盈亏回撤': 'PnL drawdown', '风控': 'Risk',
    // ---- 客户卡片 ----
    '选择客户': 'Choose client', '下载图片': 'Download image', '复制图片': 'Copy image', '已下载': 'Downloaded', '导出失败': 'Export failed',
    '已复制，可直接粘贴到': 'Copied — paste straight into', '微信': 'WeChat', '浏览器不支持复制图片，请用下载': 'This browser can’t copy images; use Download',
    '个部署过的钱包 · 数据生成于': 'deployed wallets · generated', '个失败': 'failed', '还没有客户卡片数据': 'No client card data yet',
    '需要在 GitHub 仓库 Settings → Secrets 添加 ALPHANET_API_KEY，每日任务会生成': 'Add ALPHANET_API_KEY under the GitHub repo’s Settings → Secrets; the daily job will generate',
    '资产': 'assets',
    // ---- 运维 ----
    '数据新鲜度': 'Data freshness', '数据管道': 'Data pipeline', '数据质量': 'Data quality', '数据质量检查': 'Data-quality checks',
    '管道健康检查（运维视角）': 'Pipeline health checks (DevOps view)', '最近 90 次运行记录': 'Last 90 runs', '最近 90 次（GitHub Actions 每日': 'Last 90 (GitHub Actions daily',
    '运行记录': 'Run log', '上次运行': 'Last run', '上次运行耗时': 'Last run duration', '下次计划': 'Next scheduled', '耗时': 'Duration',
    '调用次数': 'API calls', '调用': 'Calls', '错误重试': 'Error retries', '重试': 'Retries', '限流': 'Rate limit', '无限流重试': 'No rate-limit retries',
    '重试 0 次，其它错误重试 0 次': 'retries: 0, other error retries: 0', '次，其它错误重试': 'times, other error retries', '最慢请求': 'Slowest request',
    '次请求）': 'requests)', '探测': 'Probe', '探测中': 'Probing', '检查项': 'Check', '全部通过': 'All passed', '超过 26 小时视为过期': 'stale after 26 hours',
    '数据文件': 'Data files', '行数': 'Rows', '大小': 'Size', '生成': 'Generated', '最近更新': 'Last updated', '数据覆盖矩阵': 'Data coverage matrix',
    '地址 × 日期：深色': 'Address × date: dark', '当日有成交，浅色': '= traded that day, light', '有记录无成交，空白': '= record without trades, blank', '缺失': 'missing',
    '监控覆盖': 'Monitoring coverage', '各地址抓取统计': 'Fetch stats by address', '抓取': 'Fetch', '拉取': 'Fetch', '增量起点': 'Incremental start',
    '最后一天为昨天（UTC）': 'Last day is yesterday (UTC)', '最后一天 2026-11-03，应为': 'Last day 2026-11-03, expected', '应为': 'expected',
    '地址数与名单一致': 'Address count matches list', '汇总 21 个': 'summary 21', '名单 21 个': 'list 21', '所有地址抓取成功': 'All addresses fetched',
    '个地址均已抓取': 'addresses fetched', '每日明细连续无缺口': 'Daily series has no gaps', '所有地址日序列连续': 'all address series are continuous',
    '汇总与地址明细一致': 'Totals match address detail', '地址明细之和': 'sum of address detail', '币种明细与地址明细一致': 'Coin detail matches address detail',
    '天不一致': 'days mismatched', '不一致的日期': 'Mismatched dates', '成交额与官方口径偏差': 'Volume vs official deviation',
    '成交额口径偏差': 'Volume basis deviation', '成交口径 vs 官方口径': 'Fill basis vs official', '官方口径': 'Official basis', '区间成交口径': 'Period fill basis',
    '区间成交口径；交易净盈亏': 'period fill basis; net trading PnL', '个地址偏差较大（官方 allTime 含 2026-10-01 之前的历史时属正常）': 'addresses deviate (normal when official allTime includes history before 2026-10-01)',
    '无零资金地址': 'No zero-equity addresses', '全部地址有资金': 'All addresses have equity', 'API 无限流重试': 'API had no rate-limit retries',
    '只返回每个地址最近 1 万笔成交，高频地址更早的币种明细无法回补': 'returns only each address’s last 10,000 fills; older coin detail for busy addresses can’t be backfilled',
    '只保留最近 1 万笔': 'keeps only the last 10,000', '实时拉取错误': 'Live fetch errors', '本看板（起始日以来）': 'This dashboard (since start)',
    '成交明细汇总 vs Hyperliquid portfolio allTime vlm（官方含监控起始日之前的历史）': 'Fill totals vs Hyperliquid portfolio allTime volume (official includes history before monitoring start)',
    '全部地址偏差': 'Deviation, all addresses', '基于最近一个完整日': 'based on the latest full day', '差额（浮盈变化等）': 'Difference (unrealized change etc.)',
    '数据来源：Hyperliquid 公开': 'Source: Hyperliquid public', '日期均为 UTC；官方盈亏取 portfolio 盈亏历史，包含持仓浮动盈亏变化。生成于': 'All dates UTC; official PnL from portfolio PnL history, including unrealized changes. Generated',
    '数据来源': 'Source', '无法加载': 'Cannot load', '请先运行': 'Run first:', '生成数据': 'to generate data', '渲染出错': 'Render error',
    '起始日': 'Start date', '共': 'Total', '层级': 'Level', '独立': 'Standalone', '资金分层': 'Equity tiers', '资金占比': 'Equity share',
    '出金（资金变化': 'Withdrawal (equity change', '官方盈亏）': 'official PnL)', '的账户价值': 'account value',
    '的盈亏历史，含持仓浮动盈亏变化': 'PnL history, including unrealized changes', '盈亏归因': 'PnL attribution',
    '的 api.fields 里显式指定（支持 a.b 嵌套路径）': '',
    '成交': 'Fills',
    '成交额': 'Volume',
    '活跃': 'Active',
    '闲置': 'Idle',
    '盈': 'Up',
    '总': 'Total',
    '周': 'Week',
    '起止': 'Start–end',
    '不完整': 'Incomplete',
    '按当前': 'at current',
    '在': 'in',
    '中给': 'add',
    '加': '',
    '字段即可': 'field',
    '当前': 'Current',
    '净': 'Net',
    '的最大差': 'max spread',
    '当前生效的': 'current',
    '以金额计': 'by amount',
    '仅作相对比': 'relative only',
    '仅作相对比较': 'relative only',
    '按': 'by',
    '下载': 'Download',
    '缺少': 'missing',
    '每': 'each',
    '运行后由': 'run by',
    '目录': 'catalog',
    '文件': 'file',
    '官方': 'Official',
    '偏差': 'Deviation',
    '亏': 'Down',
  };
  const keys = Object.keys(D).filter(k => k).sort((a, b) => b.length - a.length);
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const RE = new RegExp(keys.map(esc).join('|'), 'g');
  const PUNCT = { '（': ' (', '）': ')', '：': ': ', '，': ', ', '；': '; ', '、': ', ', '。': '. ', '「': '"', '」': '"', '？': '?', '！': '!', '～': '~' };
  const CJK = /[　-〿一-鿿＀-￯]/;
  const PRE = [
    [/(\d{4}-\d{2}-\d{2}) ?以来累计(官方)?亏损/g, 'Cumulative loss since $1'],
    [/近 ?(\d+) ?天/g, 'Last $1d '],
    [/(\d+) ?天前/g, '$1d ago'],
    [/(\d+) ?天/g, '$1d'],
    [/全部监控地址成交额合计/g, 'Total volume, all monitored addresses'],
  ];
  const cache = new Map();
  function t(s) {
    if (lang !== 'en' || !s || !CJK.test(s)) return s;
    const hit = cache.get(s); if (hit !== undefined) return hit;
    let o = s.replace(/(\d{4}-\d{2}-\d{2}) ?以来累计(官方)?亏损/g, 'Cumulative loss since $1 ').replace(RE, m => ' ' + D[m] + ' ');
    for (const [re, to] of PRE) o = o.replace(re, to);
    o = o.replace(/近/g, ' Last ').replace(/天前/g, 'd ago').replace(/天/g, 'd');
    o = o.replace(/[（）：，；、。「」？！～]/g, m => PUNCT[m]);
    o = o.replace(/[ \t]{2,}/g, ' ').replace(/\( /g, '(').replace(/ \)/g, ')').replace(/ ([,.;:%])/g, '$1').trim();
    const lead = (s.match(/^\s+/) || [''])[0] || (CJK.test(s[0]) ? ' ' : '');
    const trail = (s.match(/\s+$/) || [''])[0] || (CJK.test(s[s.length - 1]) ? ' ' : '');
    o = lead + o + trail;
    if (cache.size > 20000) cache.clear();
    cache.set(s, o);
    return o;
  }
  const ATTRS = ['title', 'placeholder', 'aria-label', 'data-t'];
  function walk(root) {
    if (lang !== 'en' || !root) return;
    if (root.nodeType === 3) { const v = t(root.nodeValue); if (v !== root.nodeValue) root.nodeValue = v; return; }
    if (root.nodeType !== 1 || root.closest && root.closest('script,style')) return;
    const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    for (let n = root; n; n = tw.nextNode()) {
      if (n.nodeType === 3) { if (CJK.test(n.nodeValue)) { const v = t(n.nodeValue); if (v !== n.nodeValue) n.nodeValue = v; } }
      else if (n.nodeType === 1) {
        if (n.tagName === 'SCRIPT' || n.tagName === 'STYLE') continue;
        for (const a of ATTRS) { const v = n.getAttribute(a); if (v && CJK.test(v)) n.setAttribute(a, t(v)); }
      }
    }
  }
  // 图表画布文字（Chart.js 的坐标轴、图例、提示框）
  if (lang === 'en') {
    const P = CanvasRenderingContext2D.prototype;
    for (const f of ['fillText', 'strokeText', 'measureText']) {
      const orig = P[f];
      P[f] = function (txt, ...rest) { return orig.call(this, typeof txt === 'string' && CJK.test(txt) ? t(txt).trim() : txt, ...rest); };
    }
  }
  window.I18N = { get lang() { return lang; }, t };
  document.documentElement.lang = lang === 'en' ? 'en' : 'zh-CN';
  document.addEventListener('DOMContentLoaded', () => {
    const btn = document.getElementById('lang-btn');
    if (btn) {
      btn.textContent = lang === 'en' ? '中文' : 'EN';
      btn.title = lang === 'en' ? '切换到中文' : 'Switch to English';
      btn.onclick = () => { try { localStorage.setItem('hl-lang', lang === 'en' ? 'zh' : 'en'); } catch (e) {} location.reload(); };
    }
    if (lang !== 'en') return;
    document.title = 'AlphaNet Hyperliquid Dashboard';
    walk(document.body);
    new MutationObserver(ms => {
      for (const m of ms) {
        if (m.type === 'characterData') { const n = m.target; if (CJK.test(n.nodeValue)) { const v = t(n.nodeValue); if (v !== n.nodeValue) n.nodeValue = v; } }
        else if (m.type === 'attributes') { const v = m.target.getAttribute(m.attributeName); if (v && CJK.test(v)) { const w = t(v); if (w !== v) m.target.setAttribute(m.attributeName, w); } }
        else m.addedNodes.forEach(walk);
      }
    }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  });
})();
