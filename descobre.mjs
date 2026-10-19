// Tenta listar as conexões (items) da conta Pluggy. Imprime só id, banco e status.
const API='https://api.pluggy.ai';
const r0=await fetch(API+'/auth',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({clientId:process.env.PLUGGY_CLIENT_ID,clientSecret:process.env.PLUGGY_CLIENT_SECRET})});
const {apiKey}=await r0.json();
for(const p of ['/items','/items?pageSize=50','/consents']){
  const r=await fetch(API+p,{headers:{'X-API-KEY':apiKey}}); const t=await r.text(); let o; try{o=JSON.parse(t)}catch{o=null}
  const res=o&&(o.results||(Array.isArray(o)?o:null));
  if(res) console.log('::notice::'+p+' -> '+JSON.stringify(res.map(i=>({id:i.id||i.itemId,banco:i.connector?.name||i.connectorName,status:i.status,atualizado:i.lastUpdatedAt}))).slice(0,900));
  else console.log('::notice::'+p+' -> '+r.status+' '+t.slice(0,150).replace(/\s+/g,' '));
}
