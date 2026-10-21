// Busca os dados do Fitbit Air na Google Health API (v4) para o módulo Saúde da Central do Moraes.
// Credenciais vêm dos segredos do repositório: GOOGLE_HEALTH_CLIENT_ID, GOOGLE_HEALTH_CLIENT_SECRET e GOOGLE_HEALTH_REFRESH_TOKEN.
// Nada é gravado em claro: o resultado entra no mesmo arquivo criptografado do Open Finance.
const API='https://health.googleapis.com/v4/users/me/dataTypes/';
const TZ='America/Sao_Paulo';
const diaSP=(d)=>new Intl.DateTimeFormat('en-CA',{timeZone:TZ}).format(d);
const horaSP=(d)=>new Intl.DateTimeFormat('en-GB',{timeZone:TZ,hour:'2-digit',minute:'2-digit',hour12:false}).format(d);
const num=(v)=>{ const n=Number(v); return v!=null&&v!==''&&isFinite(n)?n:null; };
const segs=(s)=>{ const m=/^(-?\d+(?:\.\d+)?)s$/.exec(String(s||'')); return m?+m[1]:null; };
const ymd=(o)=>o&&o.year?`${o.year}-${String(o.month).padStart(2,'0')}-${String(o.day).padStart(2,'0')}`:null;

export async function buscarSaude({dias=40}={}){
  const {GOOGLE_HEALTH_CLIENT_ID:id,GOOGLE_HEALTH_CLIENT_SECRET:sec,GOOGLE_HEALTH_REFRESH_TOKEN:rt}=process.env;
  if(!id||!sec||!rt) return {ok:false,erro:'sem_segredos'};
  const tk=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({client_id:id,client_secret:sec,refresh_token:rt,grant_type:'refresh_token'})});
  if(!tk.ok){ const t=await tk.text(); return {ok:false,erro:/invalid_grant/.test(t)?'token_expirado':'token_'+tk.status}; }
  const {access_token}=await tk.json();
  const H={Authorization:'Bearer '+access_token,Accept:'application/json'};
  const erros=[];
  const ini=diaSP(new Date(Date.now()-dias*864e5)), fim=diaSP(new Date(Date.now()+864e5));
  async function listar(tipo,filtro){
    const out=[]; let page=null;
    for(let g=0;g<40;g++){
      const q=new URLSearchParams({filter:filtro,pageSize:'100'}); if(page) q.set('pageToken',page);
      const r=await fetch(API+tipo+'/dataPoints?'+q,{headers:H});
      if(!r.ok){ erros.push(tipo+' '+r.status+' '+(await r.text()).replace(/\s+/g,' ').slice(0,160)); return out; }
      const j=await r.json(); out.push(...(j.dataPoints||[])); page=j.nextPageToken; if(!page) break;
    }
    return out;
  }
  const D={}; const dia=(d)=>(D[d]||={});
  // sono: sessão principal = a mais longa que termina no dia (data do acordar)
  const sonos=await listar('sleep',`sleep.interval.civil_end_time >= "${ini}T00:00:00" AND sleep.interval.civil_end_time < "${fim}T00:00:00"`);
  for(const p of sonos){ const s=p.sleep||{}; const iv=s.interval||{}; if(!iv.startTime||!iv.endTime) continue;
    const a=new Date(iv.startTime), b=new Date(iv.endTime); const d=diaSP(b); const sm=s.summary||{};
    const dormiu=num(sm.minutesAsleep), periodo=num(sm.minutesInSleepPeriod)||Math.round((b-a)/6e4);
    const st={}; for(const x of (sm.stagesSummary||[])) st[String(x.type||'').toUpperCase()]=num(x.minutes);
    const o={sono:dormiu,cama:periodo,deitou:horaSP(a),acordou:horaSP(b),profundo:st.DEEP??null,rem:st.REM??null,leve:st.LIGHT??null,acordado:num(sm.minutesAwake),eficiencia:dormiu&&periodo?Math.round(dormiu/periodo*1000)/10:null};
    const cur=D[d]; if(!cur||!(cur.cama>=o.cama)) Object.assign(dia(d),o); }
  // HRV noturna (RMSSD) e FC de repouso: valores diários do próprio Fitbit
  for(const p of await listar('daily-heart-rate-variability',`daily_heart_rate_variability.date >= "${ini}"`)){ const x=p.dailyHeartRateVariability||{}; const d=ymd(x.date); if(!d) continue;
    dia(d).hrv=num(x.averageHeartRateVariabilityMilliseconds); if(num(x.deepSleepRootMeanSquareOfSuccessiveDifferencesMilliseconds)!=null) dia(d).hrvProfundo=num(x.deepSleepRootMeanSquareOfSuccessiveDifferencesMilliseconds); }
  for(const p of await listar('daily-resting-heart-rate',`daily_resting_heart_rate.date >= "${ini}"`)){ const x=p.dailyRestingHeartRate||{}; const d=ymd(x.date); if(d) dia(d).fcRep=num(x.beatsPerMinute); }
  // passos por dia
  try{
    const [y0,m0,d0]=ini.split('-').map(Number), [y1,m1,d1]=fim.split('-').map(Number);
    const r=await fetch(API+'steps/dataPoints:dailyRollUp',{method:'POST',headers:{...H,'content-type':'application/json'},body:JSON.stringify({range:{start:{date:{year:y0,month:m0,day:d0},time:{}},end:{date:{year:y1,month:m1,day:d1},time:{}}},windowSizeDays:1})});
    if(r.ok){ const j=await r.json(); for(const x of (j.rollupDataPoints||[])){ const c=x.civilStartTime; const d=typeof c==='string'?c.slice(0,10):ymd(c&&c.date); const v=num(x.steps&&x.steps.countSum); if(d&&v!=null) dia(d).passos=v; } }
    else erros.push('steps '+r.status+' '+(await r.text()).replace(/\s+/g,' ').slice(0,160));
  }catch(e){ erros.push('steps '+e.message); }
  // VO2 máx., peso e gordura: guarda o campo numérico que vier, com o nome dele
  const amostra=async(tipo,snake,chave,campo,ehDiario)=>{ const f=ehDiario?`${snake}.date >= "${ini}"`:`${snake}.sample_time.civil_time >= "${ini}T00:00:00"`;
    for(const p of await listar(tipo,f)){ const x=p[chave]||{}; const d=ehDiario?ymd(x.date):(x.sampleTime&&x.sampleTime.physicalTime?diaSP(new Date(x.sampleTime.physicalTime)):null); if(!d) continue;
      for(const [k,v] of Object.entries(x)){ if(k==='date'||k==='sampleTime'||typeof v==='object') continue; let n=num(v); if(n==null) continue; if(/grams/i.test(k)) n=Math.round(n/10)/100; dia(d)[campo]=n; break; } } };
  // respiração, SpO2 e temperatura da pele durante o sono: guarda todos os campos numéricos (achatados um nível), com prefixo
  const campos={};
  const diarioTodos=async(tipo,snake,chave,pre)=>{ const nomes=new Set(); let n=0;
    for(const p of await listar(tipo,`${snake}.date >= "${ini}"`)){ const x=p[chave]||{}; const d=ymd(x.date); if(!d) continue; n++;
      const put=(k,v)=>{ const z=num(v); if(z!=null){ dia(d)[pre+'_'+k]=z; nomes.add(k); } };
      for(const [k,v] of Object.entries(x)){ if(k==='date') continue; if(v&&typeof v==='object'&&!Array.isArray(v)){ for(const [k2,v2] of Object.entries(v)) put(k+'.'+k2,v2); } else put(k,v); } }
    campos[pre]={n,campos:[...nomes]}; };
  await diarioTodos('daily-respiratory-rate','daily_respiratory_rate','dailyRespiratoryRate','resp');
  await diarioTodos('daily-oxygen-saturation','daily_oxygen_saturation','dailyOxygenSaturation','spo2');
  await diarioTodos('daily-sleep-temperature-derivations','daily_sleep_temperature_derivations','dailySleepTemperatureDerivations','temp');
  await amostra('daily-vo2-max','daily_vo2_max','dailyVo2Max','vo2',true);
  await amostra('weight','weight','weight','peso',false);
  await amostra('body-fat','body_fat','bodyFat','gordura',false);
  // treinos (inclui o que outros apps mandam para o Google Health)
  const treinos=[];
  for(const p of await listar('exercise',`exercise.interval.civil_start_time >= "${ini}" AND exercise.interval.civil_start_time < "${fim}"`)){
    const e=p.exercise||{}; const iv=e.interval||{}; if(!iv.startTime) continue; const a=new Date(iv.startTime), b=iv.endTime?new Date(iv.endTime):null;
    const ms=e.metricsSummary||{}; const min=Math.round((segs(e.activeDuration)??(b?(b-a)/1e3:0))/60);
    if(min<1) continue; // toques acidentais
    treinos.push({d:diaSP(a),hora:horaSP(a),tipo:String(e.exerciseType||'').toUpperCase(),nome:e.displayName||'',min,fc:num(ms.averageHeartRateBeatsPerMinute),kcal:num(ms.caloriesKcal),azm:num(ms.activeZoneMinutes),fonte:[p.dataSource&&p.dataSource.platform,p.dataSource&&p.dataSource.recordingMethod].filter(Boolean).join(' ').toLowerCase()});
  }
  treinos.sort((x,y)=>(x.d+x.hora).localeCompare(y.d+y.hora));
  const nDias=Object.keys(D).length;
  return {ok:nDias>0||treinos.length>0,at:new Date().toISOString(),de:ini,dias:D,treinos,erros,campos};
}
