const watch = new Set(require('../data/meta.json').addresses.map(row => row.addr.toLowerCase()));
module.exports = async function activity(req, res) {
  if (req.method !== 'GET') return res.status(405).end();
  try {
    const key = process.env.ALPHANET_API_KEY;
    if (!key) return res.status(503).json({unavailable:true});
    const rows = new Map();
    let since = '';
    for (let page = 0; page < 50; page++) {
      const url = new URL('https://trades.alphanet.global/api/internal/v1/deployments');
      url.searchParams.set('limit','1000');
      if (since) url.searchParams.set('since',since);
      const response = await fetch(url,{headers:{'Internal-API-Key':key},signal:AbortSignal.timeout(10000)});
      if (!response.ok) throw Error();
      const {data} = await response.json();
      if (!Array.isArray(data?.items) || typeof data.hasMore !== 'boolean') throw Error();
      for (const item of data.items) {
        const wallet = String(item.wallet).toLowerCase();
        if (watch.has(wallet)) rows.set(item.id,{wallet,strategy:item.strategy,asset:item.asset,amount:item.amountUsdc,start:item.startAt,stop:item.stopAt,reason:item.stopReason,status:item.status});
      }
      if (!data.hasMore) {
        res.setHeader('Cache-Control','public, s-maxage=45');
        return res.json({at:Date.now(),rows:[...rows.values()]});
      }
      if (!data.nextSince || data.nextSince === since) throw Error();
      since = data.nextSince;
    }
    throw Error();
  } catch { return res.status(502).json({unavailable:true}); }
};
