// Selected-wallet reads are independent: a failed ledger or deployment query must not erase positions.
const walletReads = new Map();
function walletStatus(a, host) {
  const started = Date.now(), since = started - 7 * 86400000;
  const get = async (url, opts) => {
    const r = await fetch(url, { ...opts, signal: AbortSignal.timeout(12000) });
    if (!r.ok) throw Error(r.status);
    return r.json();
  };
  const hl = (type, extra = {}) => get(API, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({type,user:a,...extra})});
  let hit = walletReads.get(a);
  if (!hit || started-hit.at > 60000) {
    hit = {at:started, data:Promise.allSettled([hl('clearinghouseState'),hl('userNonFundingLedgerUpdates',{startTime:since}),hl('userFills'),get('/api/activity',{cache:'no-store'})])};
    walletReads.set(a,hit);
  }
  hit.data.then(results => {
    if (!host.isConnected) return;
    const [st,ledger,fills,deps] = results.map(r=>r.value);
    const when = t => bj(new Date(t).toISOString());
    const positions = st?.assetPositions?.map(x=>x.position).filter(p=>Number(p.szi)!==0);
    const sends = Array.isArray(ledger) ? ledger.filter(x=>{
      const d=x.delta;
      return d?.type==='withdraw' || (d?.type==='send' && d.user?.toLowerCase()===a && d.destination?.toLowerCase()!==a);
    }).sort((x,y)=>y.time-x.time) : null;
    const latest = Array.isArray(fills) ? fills.reduce((v,r)=>!v || r.time>v.time?r:v,null) : null;
    const rows = Array.isArray(deps?.rows) ? deps.rows.filter(r=>r.wallet?.toLowerCase()===a && ['active','closing'].includes(r.status)) : null;
    const cardline=(label,v)=>'<p><b>'+label+'：</b>'+esc(v)+'</p>';
    const flow=sends?.map(r=>{const d=r.delta;return when(r.time)+' · '+(d.type==='withdraw'?'提现 ':'转出 ')+(d.amount??d.usdc)+' '+(d.token||'USDC')});
    const dir={'Open Short':'开空','Open Long':'开多','Close Short':'平空','Close Long':'平多'};
    const status = positions ? (sends?.length?'近 7 天有转出，':'')+(positions.length?'仍有 '+positions.length+' 个持仓':'当前无持仓') : '当前持仓待核实';
    host.innerHTML=card('钱包现状 · '+status, '查询于 '+when(hit.at)+' · Hyperliquid 主合约账户',[
      cardline('合约权益',st?.marginSummary?usdFull(+st.marginSummary.accountValue):'未能核实'),
      cardline('当前持仓',positions ? positions.map(p=>p.coin+' '+(p.szi<0?'空':'多')+' '+Math.abs(p.szi)+' · 名义 '+usdFull(+p.positionValue)+' · 浮盈亏 '+usdFull(+p.unrealizedPnl,true)).join('；')||'无持仓':'未能核实'),
      cardline('近 7 天发送 / 提现',flow ? flow.slice(0,4).join('；')+(flow.length>4?'（仅列最近 4 笔）':'')||'未见记录':'未能核实'),
      cardline('最近成交',latest ? when(latest.time)+' · '+latest.coin+' '+(dir[latest.dir]||latest.dir)+' '+latest.sz+' @ '+latest.px:Array.isArray(fills)?'未见记录':'未能核实'),
      cardline('策略部署',rows ? rows.map(r=>r.strategy+' / '+r.asset+(r.status==='closing'?'（结束中）':'')).join('；')||'未见运行中部署':'暂不可确认')
    ].join('')+'<button class="btn" type="button">重新核实此地址</button>');
    host.querySelector('button').onclick=()=>{walletReads.delete(a);host.textContent='正在核实钱包现状…';walletStatus(a,host);};
  });
}
