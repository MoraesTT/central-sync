// Busca contas, lançamentos e parcelas no Pluggy e gera inbox.json no formato da Central do Moraes.
// Credenciais vêm dos segredos do repositório (PLUGGY_CLIENT_ID, PLUGGY_CLIENT_SECRET). Nada é gravado no repositório.
import fs from 'node:fs';
import crypto from 'node:crypto';
const API='https://api.pluggy.ai';
const ITEMS=(process.env.PLUGGY_ITEM_IDS||'').split(',').map(s=>s.trim()).filter(Boolean);
const DIAS=+(process.env.DIAS||45), DIAS_PARC=150;
const falha=(m)=>{ console.log('::error::'+String(m).replace(/[\r\n]+/g,' ').slice(0,400)); process.exit(1); };
process.on('unhandledRejection',e=>falha(e&&e.message||e));
if(!process.env.PLUGGY_CLIENT_ID||!process.env.PLUGGY_CLIENT_SECRET||!ITEMS.length) falha('Faltam segredos: '+['PLUGGY_CLIENT_ID','PLUGGY_CLIENT_SECRET'].filter(k=>!process.env[k]).join(', '));
async function main(){
const j=async(r)=>{ if(!r.ok) throw new Error(r.url.replace(/\?.*/,'')+' -> '+r.status+' '+(await r.text()).slice(0,200)); return r.json(); };
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
    for(let after=null,guard=0;guard<50;guard++){
      const r=await get(`/v2/transactions?accountId=${a.id}&dateFrom=${de}`+(after?`&after=${encodeURIComponent(after)}`:''));
      for(const t of r.results||[]){
        const v=Math.abs(Number(t.amount)); const amount=t.type==='CREDIT'?v:-v;
        const o={id:t.id,accountId:a.id,date:String(t.date).slice(0,10),description:t.description,amount,category:t.category||undefined,merchantName:t.merchant?.name||t.merchant?.businessName||undefined,status:t.status,createdAt:t.createdAt?String(t.createdAt).slice(0,16):undefined};
        const cm=t.creditCardMetadata; if(cm&&cm.totalInstallments>1){ o.installmentNumber=cm.installmentNumber; o.installmentTotal=cm.totalInstallments; }
        for(const k of Object.keys(o)) if(o[k]===undefined) delete o[k];
        if(o.date<de) continue; if(o.date>=dia(DIAS)) tx.push(o);
        if(a.type==='CREDIT'&&o.installmentTotal) txParc.push(o);
      }
      after=r.next?new URL(r.next,API).searchParams.get('after'):null; if(!after) break;
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
// criptografa: AES-256-GCM com chave aleatória, chave embrulhada com a chave pública RSA do repositório
const k=crypto.randomBytes(32), iv=crypto.randomBytes(12); const c=crypto.createCipheriv('aes-256-gcm',k,iv); const data=Buffer.concat([c.update(s,'utf8'),c.final()]);
const pub=fs.readFileSync('chave_publica.pem','utf8'); const kw=crypto.publicEncrypt({key:pub,padding:crypto.constants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha256'},k);
fs.mkdirSync('out',{recursive:true}); fs.writeFileSync('out/inbox.enc.json',JSON.stringify({v:1,at:doc.at,n:tx.length,k:kw.toString('base64'),iv:iv.toString('base64'),tag:c.getAuthTag().toString('base64'),data:data.toString('base64')}));
const ds=tx.map(t=>t.date).sort(); console.log('::notice::OK '+tx.length+' lançamentos '+ds[0]+' a '+ds.at(-1)+' '+JSON.stringify(itensStatus));
console.log('OK',tx.length,'lançamentos',ds[0],'a',ds.at(-1),JSON.stringify(itensStatus));
}
main().catch(e=>falha(e&&e.message||e));
