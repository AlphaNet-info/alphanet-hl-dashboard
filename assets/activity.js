'use strict';
const el = id => document.getElementById(id);
const date = ms => new Date(ms).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false});
const days30 = 30*86400000;
let names = {}, deposits = [], withdrawals = new Map(), walletTimes = new Map(), busy = false;
async function json(url,options={}) {
  const response = await fetch(url,{cache:'no-store',signal:AbortSignal.timeout(12000),...options});
  if (!response.ok) throw Error();
  return response.json();
}
function draw() {
  const rows = deposits.concat([...withdrawals.values()].flat()).filter(row => row.time >= Date.now()-days30 && (el('kind').selectedIndex===0 || row.kind===el('kind').value)).sort((left,right)=>right.time-left.time);
  el('result').textContent=`已读取的记录：${rows.length} 条`;
  el('events').replaceChildren(...rows.map(row=>{
    const tr=document.createElement('tr');
    for(const value of [date(row.time),row.kind,names[row.wallet]||'',row.strategy||'—',row.amount==null?'—':Number(row.amount).toLocaleString('en-US',{maximumFractionDigits:6}),row.reason||'—']) tr.insertCell().textContent=value;
    const link=document.createElement('a'); link.href='/#address/'+row.wallet; link.textContent=row.wallet.slice(0,6)+'…'+row.wallet.slice(-4);link.title=row.wallet; tr.cells[2].append(' ',link);
    return tr;
  }));
}
async function refresh(){
  if (busy) return; busy=true; el('reload').disabled=true;
  try {
    const [meta,directory]=await Promise.all([json('/data/meta.json'),json('/data/names.json')]); names=directory.names;
    let depStatus='部署读取失败；保留已有记录';
    async function deployments(){
      let feed,source='部署接口';
      try {feed=await json('/api/activity');} catch {source='部署接口不可用，历史快照';feed=await json('/data/activity-baseline.json');}
      const result=[];
      for(const row of feed.rows){
        const base={wallet:row.wallet,strategy:[row.strategy,row.asset].join(' / '),amount:row.amount};
        if(row.start) result.push({...base,time:row.start*1000,kind:'新部署'});
        if(row.stop) result.push({...base,time:row.stop*1000,kind:row.reason==='manual'?'手动取消':'部署已结束',reason:row.reason||'未记录原因'});
      }
      deposits=result; depStatus=`${source}：${date(feed.at)}；撤出中 ${feed.rows.filter(row=>row.status==='closing').length} 笔`;draw();
    }
    const queue=meta.addresses.map(entry=>entry.addr.toLowerCase()),total=queue.length, end=Date.now();let success=0;
    async function worker(){while(queue.length){const wallet=queue.shift();try{
      let start=end-days30;const found=new Map();
      for(let page=0;page<50;page++){
        const items=await json('https://api.hyperliquid.xyz/info',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:'userNonFundingLedgerUpdates',user:wallet,startTime:start,endTime:end})});
        if(!Array.isArray(items)) throw Error();
        for(const item of items) if(item.delta?.type==='withdraw') found.set([item.hash,item.time,item.delta.usdc].join('|'),{time:item.time,kind:'钱包提现',wallet,amount:item.delta.usdc,reason:item.hash});
        if(items.length<500){withdrawals.set(wallet,[...found.values()]);walletTimes.set(wallet,end);success++;break;}
        const next=Math.max(...items.map(item=>item.time));if(next<=start)throw Error();start=next;
      }
    }catch{/* retain the last successful wallet read */}}}
    el('sources').textContent='正在刷新部署及钱包账本…';
    await Promise.all([deployments().catch(()=>{}),...Array.from({length:3},worker)]);
    el('sources').textContent=`${depStatus}。提现：${success}/${total} 个钱包读取成功（${date(end)}）；${success===total?'账本已更新':'覆盖不完整，未读到不代表没有提现'}。页面打开时每分钟检查。`;draw();
  }catch{el('sources').textContent='数据读取失败，请重试。';}finally{busy=false;el('reload').disabled=false;}
}
el('kind').onchange=draw;el('reload').onclick=refresh;refresh();setInterval(()=>{if(!document.hidden)refresh();},60000);
