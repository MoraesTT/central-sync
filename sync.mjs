// Busca contas, lançamentos e parcelas no Pluggy e gera inbox.json no formato da Central do Moraes.
// Credenciais vêm dos segredos do repositório (PLUGGY_CLIENT_ID, PLUGGY_CLIENT_SECRET). Nada é gravado no repositório.
import fs from 'node:fs';
const API='https://api.pluggy.ai';
const ITEMS=(process.env.PLUGGY_ITEM_IDS||'').split(',').map(s=>s.trim()).filter(Boolean);
const DIAS=+(process.env.DIAS||45), DIAS_PARC=150;
if(!process.env.PLUGGY_CLIENT_ID||!process.env.PLUGGY_CLIENT_SECRET||!ITEMS.length){ console.error('Faltam segredos'); process.exit(1); }
const j=async(r)=>{ if(!r.ok) throw new Error(r.status+' '+(await r.text()).slice(0,200)); return r.json(); };
const {apiKey}=await j(await fetch(API+'/auth',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({clientId:process.env.PLUGGY_CLIENT_ID,clientSecret:process.env.PLUGGY_CLIENT_SECRET})}));
const get=async(p)=>j(await fetch(API+p,{headers:{'X-API-KEY':apiKey}}));
const dia=(n)=>new Date(Date.now()-n*864e5).toISOString().slice(0,10);
const contas=[],cartoes=[],tx=[],txParc=[],itensStatus=[];
for(const itemId of ITEMS){
  try{ const it=await get('/items/'+itemId); itensStatus.push({itemId,status:it.status,atualizado:it.lastUpdatedAt||it.updatedAt}); }catch(e){ itensStatus.push({itemId,erro:String(e.message)}); }
  const acc=(await get('/accounts?itemId='+itemId)).results||[];
  for(const a of acc){
    if(a.type==='CREDIT') cartoes.push({id:a.id,itemId,name:a.name,number:a.number,balance:a.balance,creditLimit:a.creditData?.creditLimit,availableCreditLimit:a.creditData?.availableCreditLimit});
    else contas.push({id:a.id,itemId,name:a.name,balance:a.balance});
    const de=a.type==='CREDIT'?dia(DIAS_PARC):dia(DIAS);
    for(let page=1,tot=1;page<=tot;page++){
      const r=await get(`/transactions?accountId=${a.id}&from=${de}&pageSize=500&page=${page}`); tot=r.totalPages||1;
      for(const t of r.results||[]){
        const v=Math.abs(Number(t.amount)); const amount=t.type==='CREDIT'?v:-v;
        const o={id:t.id,accountId:a.id,date:String(t.date).slice(0,10),description:t.description,amount,category:t.category||undefined,merchantName:t.merchant?.name||t.merchant?.businessName||undefined,status:t.status,createdAt:t.createdAt?String(t.createdAt).slice(0,16):undefined};
        const cm=t.creditCardMetadata; if(cm&&cm.totalInstallments>1){ o.installmentNumber=cm.installmentNumber; o.installmentTotal=cm.totalInstallments; }
        for(const k of Object.keys(o)) if(o[k]===undefined) delete o[k];
        if(o.date>=dia(DIAS)) tx.push(o);
        if(a.type==='CREDIT'&&o.installmentTotal) txParc.push(o);
      }
    }
  }
}
// parcelas futuras: para cada compra, a ocorrência mais recente projeta as próximas, uma por mês
const addMes=(m,k)=>{ const [y,mm]=m.split('-').map(Number); const d=new Date(Date.UTC(y,mm-1+k,1)); return d.toISOString().slice(0,7); };
const ult=new Map();
for(const t of txParc){ if(t.amount>=0) continue; const k=t.accountId+'|'+String(t.description).toLowerCase().replace(/\s+/g,' ').trim()+'|'+Math.abs(t.amount)+'|'+t.installmentTotal; const e=ult.get(k); if(!e||t.installmentNumber>e.installmentNumber) ult.set(k,t); }
const meses={}; const hojeM=new Date().toISOString().slice(0,7);
for(const t of ult.values()) for(let n=t.installmentNumber+1;n<=t.installmentTotal;n++){ const m=addMes(t.date.slice(0,7),n-t.installmentNumber); if(m<=hojeM) continue; (meses[m]||=[]).push({amount:Math.abs(t.amount),description:t.description,installment:n,total:t.installmentTotal}); }
const proximosMeses=Object.keys(meses).sort().slice(0,9).map(m=>({month:m,committed:Math.round(meses[m].reduce((s,i)=>s+i.amount,0)*100)/100,items:meses[m]}));
const doc={at:new Date().toISOString().slice(0,19)+'+00:00',fonte:'github',accounts:{contas,cartoes},tx,outlook:{totalComprometido:Math.round(proximosMeses.reduce((s,m)=>s+m.committed,0)*100)/100,proximosMeses},itens:itensStatus};
const s=JSON.stringify(doc); if(s.length>240000) throw new Error('GRANDE DEMAIS');
fs.mkdirSync('out',{recursive:true}); fs.writeFileSync('out/inbox.json',s);
const ds=tx.map(t=>t.date).sort(); console.log('OK',tx.length,'lançamentos',ds[0],'a',ds.at(-1),JSON.stringify(itensStatus));
