// Busca contas, lançamentos e parcelas no Pluggy e gera inbox.json no formato da Central do Moraes.
// Credenciais vêm dos segredos do repositório (PLUGGY_CLIENT_ID, PLUGGY_CLIENT_SECRET). Nada é gravado no repositório.
import fs from 'node:fs';
import crypto from 'node:crypto';
import {buscarSaude} from './saude.mjs';
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
const contas=[],cartoes=[],tx=[],txParc=[],itensStatus=[],investimentos=[];
for(const itemId of ITEMS){
  try{ const it=await get('/items/'+itemId); itensStatus.push({itemId,status:it.status,atualizado:it.lastUpdatedAt||it.updatedAt}); }catch(e){ itensStatus.push({itemId,erro:String(e.message)}); }
  try{ const inv=(await get('/investments?itemId='+itemId+'&pageSize=200')).results||[];
    for(const x of inv) investimentos.push({itemId,nome:x.name,codigo:x.code||undefined,tipo:x.type,subtipo:x.subtype||undefined,saldo:x.balance,valorAplicado:x.amountOriginal??undefined,quantidade:x.quantity??undefined,preco:x.value??undefined,data:x.date?String(x.date).slice(0,10):undefined,status:x.status||undefined}); }catch(e){ investimentos.push({itemId,erro:String(e.message).slice(0,120)}); }
  const acc=(await get('/accounts?itemId='+itemId)).results||[];
  for(const a of acc){
    if(a.type==='CREDIT') cartoes.push({id:a.id,itemId,name:a.name,number:a.number,balance:a.balance,creditLimit:a.creditData?.creditLimit,availableCreditLimit:a.creditData?.availableCreditLimit});
    else contas.push({id:a.id,itemId,name:a.name,balance:a.balance});
    const de=a.type==='CREDIT'?dia(DIAS_PARC):dia(DIAS);
    for(let after=null,guard=0;guard<50;guard++){
      const r=await get(`/v2/transactions?accountId=${a.id}&dateFrom=${de}`+(after?`&after=${encodeURIComponent(after)}`:''));
      for(const t of r.results||[]){
        const v=Math.abs(Number(t.amount)); const amount=t.type==='CREDIT'?v:-v;
        let desc=(t.descriptionRaw&&t.descriptionRaw.toUpperCase()===String(t.description).toUpperCase()?t.descriptionRaw:t.description);
        const o={id:t.id,accountId:a.id,date:new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo'}).format(new Date(t.date)),description:desc,amount,category:t.category||undefined,merchantName:t.merchant?.name||undefined,status:t.status,createdAt:t.createdAt?String(t.createdAt).slice(0,16):undefined};
        const cm=t.creditCardMetadata; if(cm&&cm.totalInstallments>1){ o.installmentNumber=cm.installmentNumber; o.installmentTotal=cm.totalInstallments; }
        for(const k of Object.keys(o)) if(o[k]===undefined) delete o[k];
        if(o.date<de) continue; const amanha=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo'}).format(new Date(Date.now()+864e5)); if(o.date>=dia(DIAS)&&o.date<amanha) tx.push(o); // lançamentos agendados (data futura) ficam fora
        if(a.type==='CREDIT'&&o.installmentTotal) txParc.push(o);
      }
      after=r.next?new URL(r.next,API).searchParams.get('after'):null; if(!after) break;
    }
  }
}
// parcelas futuras: para cada compra, a ocorrência mais recente projeta as próximas, uma por mês
const addMes=(m,k)=>{ const [y,mm]=m.split('-').map(Number); const d=new Date(Date.UTC(y,mm-1+k,1)); return d.toISOString().slice(0,7); };
const ult=new Map();
for(const t of txParc){ if(t.amount>=0) continue; const k=t.accountId+'|'+String(t.description).toLowerCase().replace(/\s+/g,' ').trim()+'|'+t.installmentTotal; const e=ult.get(k); if(!e||t.date>e.date||(t.date===e.date&&t.installmentNumber>e.installmentNumber)) ult.set(k,t); }
const meses={}; const hojeM=new Date().toISOString().slice(0,7);
for(const t of ult.values()) for(let n=t.installmentNumber+1;n<=t.installmentTotal;n++){ const m=addMes(t.date.slice(0,7),n-t.installmentNumber); if(m<=hojeM) continue; (meses[m]||=[]).push({amount:Math.abs(t.amount),description:t.description,installment:n,total:t.installmentTotal}); }
const proximosMeses=Object.keys(meses).sort().slice(0,9).map(m=>({month:m,committed:Math.round(meses[m].reduce((s,i)=>s+i.amount,0)*100)/100,items:meses[m]}));
const doc={at:new Date().toISOString().slice(0,19)+'+00:00',fonte:'github',accounts:{contas,cartoes},tx,investimentos,outlook:{totalComprometido:Math.round(proximosMeses.reduce((s,m)=>s+m.committed,0)*100)/100,proximosMeses},itens:itensStatus};
// saúde (Fitbit Air pela Google Health API): uma falha aqui não derruba o Open Finance
try{ doc.saude=await buscarSaude(); }catch(e){ doc.saude={ok:false,erro:String(e&&e.message||e).slice(0,200)}; }
const s=JSON.stringify(doc); if(s.length>240000) throw new Error('GRANDE DEMAIS');
// criptografa: AES-256-GCM com chave aleatória, chave embrulhada com a chave pública RSA do repositório
const k=crypto.randomBytes(32), iv=crypto.randomBytes(12); const c=crypto.createCipheriv('aes-256-gcm',k,iv); const data=Buffer.concat([c.update(s,'utf8'),c.final()]);
const pub=fs.readFileSync('chave_publica.pem','utf8'); const kw=crypto.publicEncrypt({key:pub,padding:crypto.constants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha256'},k);
fs.mkdirSync('out',{recursive:true}); const NOMES={'e5450539-6faa-46a5-9b60-686932e79dbc':'Inter','b71b33b3-83e7-47ec-845d-8c95cc75a0cc':'Nubank','2ced0015-4d81-4dda-9484-352c4537fe87':'PicPay','9443754b-3d7b-4a04-a595-823af681308e':'Itaú','8a9f6881-799b-4653-bfb5-daa289d73fc9':'XP'};
const st=itensStatus.map(i=>({banco:NOMES[i.itemId]||'?',status:i.status||'ERRO',atualizado:i.atualizado||null}));
const sau={ok:!!doc.saude.ok,erro:doc.saude.erro||null,dias:doc.saude.dias?Object.keys(doc.saude.dias).length:0,treinos:(doc.saude.treinos||[]).length,falhas:(doc.saude.erros||[]).length};
fs.writeFileSync('out/inbox.enc.json',JSON.stringify({v:1,at:doc.at,n:tx.length,st,sau,k:kw.toString('base64'),iv:iv.toString('base64'),tag:c.getAuthTag().toString('base64'),data:data.toString('base64')}));
const ds=tx.map(t=>t.date).sort(); console.log('::notice::OK '+tx.length+' lançamentos '+ds[0]+' a '+ds.at(-1)+' '+JSON.stringify(itensStatus));
console.log('::notice::Investimentos: '+investimentos.filter(x=>!x.erro).length+' posições, '+investimentos.filter(x=>x.erro).length+' erros');
console.log('OK',tx.length,'lançamentos',ds[0],'a',ds.at(-1),JSON.stringify(itensStatus));
console.log('::notice::Saúde '+JSON.stringify(sau)+((doc.saude.erros||[]).length?' '+doc.saude.erros.join(' | ').slice(0,600):''));
}
main().catch(e=>falha(e&&e.message||e));
