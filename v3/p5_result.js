
/* ---------- 경기 HUD 오른쪽 팀 패널 ---------- */
let teamsBuilt=false;
function updateTeams(){
  if(!world) return;
  for(const side of ['cpu','gpu']){
    const el=$('#tp'+(side==='cpu'?'Cpu':'Gpu')), list=world.chars.filter(c=>c.side===side);
    if(el.children.length!==list.length){ el.innerHTML=list.map(c=>`<div class="pl">${portrait(c.ch,side,20)}<span class="nm"></span><span class="lv">${'<i></i>'.repeat(MAX_LIVES)}</span><div class="hpb"><i></i></div></div>`).join(''); }
    $('#tp'+(side==='cpu'?'CpuL':'GpuL')).textContent=teamLives(side);
    list.forEach((c,i)=>{ const d=el.children[i]; d.className='pl'+(c.isPlayer?' me':'')+(c.out?' out':(!c.alive?' dead':''));
      d.children[1].textContent=(c.name||'봇')+(c.isBotAI||c.rules?' ·규칙봇':'')+` (${c.kills})`;
      [...d.children[2].children].forEach((h,k)=>h.className=k<c.lives?'on':'');
      d.children[3].firstChild.style.width=(c.alive?c.hp/MAX_HP*100:0)+'%'; });
  }
}

/* ---------- 결과 ---------- */
function endRound(){
  running=false; showGameUI(false);
  const payload=resultPayload(world);
  payload.pk=world.chars.filter(c=>c.remote||c.isPlayer).map(c=>[c.remote||me.id,c.kills,c.hits]);
  if(netMode==='host') net.send(payload);
  showResult(payload);
}
function showResult(m){
  running=false; showGameUI(false);
  const [sc,sg]=m.sc, L=m.lives||[0,0];
  const win = m.winner!==undefined? m.winner : (sc===sg?null:(sc>sg?'cpu':'gpu'));
  const how = m.stopped? '방장이 중간에 종료 · 남은 목숨 기준' : win===null? '' : (m.byTime? '시간 종료 · 남은 목숨 우세':'상대 전원 탈락');
  const wl=$('#winLine'); wl.className='win '+(win||'');
  wl.innerHTML = win===null? '무승부' :
    `${portrait(m.mvp&&m.mvp.s===win?m.mvp.ch:null,win,40)} ${TEAM[win]} 승리! <span style="font-size:14px;color:var(--muted);font-family:var(--sans)">${how}</span>`;
  const me0= world&&world.spec? null : myChar();
  let mine=''; if(me0){ const pk=(m.pk||[]).find(p=>p[0]===me.id); const k=pk?pk[1]:me0.kills, h=pk?pk[2]:me0.hits; mine=`내 기록 — 처치 ${k} · 명중 ${h} (${TEAM[me0.side||mySide]})`; }
  const cp=m.comp? ` · 팀 구성 A팀 CPU형 ${m.comp[0][0]}·GPU형 ${m.comp[0][1]} / B팀 CPU형 ${m.comp[1][0]}·GPU형 ${m.comp[1][1]}` : '';
  $('#winSub').innerHTML = `남은 목숨 <b class="mono">${L[0]} : ${L[1]}</b> · 처치 <b class="mono">${sc} : ${sg}</b>` + cp+(m.mvp? ` · MVP <b style="color:var(--${m.mvp.s}-ink)">${esc(m.mvp.n)}</b> (${m.mvp.k}킬)`:'') + (mine? `<br>${mine}`:'');
  $('#statTable').innerHTML = `<tr><th>항목</th><th>CPU형</th><th>GPU형</th><th style="text-align:left">설명</th></tr>`+
    m.rows.map(r=>`<tr><td>${r[0]}</td><td class="cpu">${r[1]}</td><td class="gpu">${r[2]}</td><td class="d">${r[3]}</td></tr>`).join('');
  $('#lesson').innerHTML = `<b>정리</b> GPU형 캐릭터는 1인당 같은 시간에 눈덩이를 <b>${m.ratio}배</b> 날렸습니다(처리량). 대신 던지기 준비가 ${m.wu[1].toFixed(0)}ms로 CPU형의 ${m.wu[0].toFixed(0)}ms보다 느렸고(지연), 적이 흩어지면 재장전이 길어졌습니다(warp divergence). 화면 픽셀 수 차이가 곧 "렌더링은 픽셀마다 독립적인 같은 계산"이라는 뜻입니다. 어느 쪽이 우월한 게 아니라 <b>넓게·많이는 GPU, 즉각·정밀은 CPU</b>입니다.`;
  if(win===null) SFX.count(); else if(world&&world.spec) SFX.win(); else if(win===mySide) SFX.win(); else SFX.lose();
  const solo=netMode==='solo';
  $('#btnSwap').hidden=!solo; $('#btnAgain').hidden=!solo;
  $('#btnBack').textContent= solo?'방으로':'방으로 돌아가기';
  $('#result').hidden=false;
}
$('#btnSwap').onclick=()=>{ roundNo++; soloTeam= mySide==='cpu'?'gpu':'cpu'; startSolo(soloTeam); };
$('#btnAgain').onclick=()=>{ roundNo++; startSolo(mySide); };
$('#btnResultLeague').onclick=()=>{ stopGame(); if(netMode==='host') net.send({t:'end'}); showLeague('scrRoom'); };
$('#btnBack').onclick=()=>{ stopGame(); if(netMode==='host') net.send({t:'end'}); showScreen('scrRoom'); renderRoom(); };

/* ============================================================
   전략 봇: 규칙표 편집 · 제출 · 불러오기
   ============================================================ */
const COND_VARS=[['','항상'],['체력','체력'],['탄약','탄약'],['적거리','적과의 거리'],['부채꼴적','부채꼴 안 적'],['보이는적','보이는 적'],['적체력','가까운 적 체력'],['아군','살아있는 아군'],['아군거리','아군과의 거리'],['재장전','재장전 중(1)'],['목숨','남은 목숨'],['시간','경과 시간'],['남은시간','남은 시간'],['내처치','내 처치 수']];
const ACTS=['접근','후퇴','거리유지','탄약수집','던지기','좌우회피','중앙이동','아군따라가기','엄폐','순찰','대기'];
let myRules=[{when:'탄약 < 5', do:'탄약수집'},{when:'체력 <= 1', do:'후퇴'},{when:'부채꼴적 >= 2', do:'던지기'},{when:'always', do:'거리유지', value:300}];
let ruleSrcLabel='기본값';
function parseRuleStr(r){ const c=parseCond(r.when); if(c&&(c.and||c.or)) return {v:'',op:'<',n:0,complex:true}; return c? (c.always?{v:'',op:'<',n:0}:{v:c.v,op:c.op,n:c.n}) : {v:'',op:'<',n:0}; }
const V2K=Object.fromEntries(Object.entries(RULE_VARS).filter(([k])=>/[가-힣]/.test(k)).map(([k,v])=>[v,k]));
function renderRules(){
  const el=$('#ruleList'); el.innerHTML='';
  $('#ruleSrc').textContent = '· '+ruleSrcLabel+' · 위에서부터 먼저 맞는 규칙이 이깁니다';
  myRules.forEach((r,i)=>{
    const p=parseRuleStr(r); const row=document.createElement('div'); row.className='rule'+(p.v?'':' always');
    if(p.complex){ row.innerHTML=`<span class="n">${i+1}.</span><span style="grid-column:2/6;font-family:var(--mono);font-size:11.5px">${esc(r.when)} → ${esc(r.do)}${r.value?' '+r.value:''}</span>`; const xx=document.createElement('button'); xx.className='x'; xx.type='button'; xx.textContent='×'; xx.onclick=()=>{ myRules.splice(i,1); renderRules(); }; row.appendChild(xx); el.appendChild(row); return; }
    const vs=document.createElement('select'); COND_VARS.forEach(([v,l])=>{const o=document.createElement('option');o.value=v;o.textContent=l;vs.appendChild(o);}); vs.value=p.v?V2K[p.v]||'':'';
    const os=document.createElement('select'); RULE_OPS.forEach(o2=>{const o=document.createElement('option');o.value=o2;o.textContent=o2;os.appendChild(o);}); os.value=p.op;
    const nu=document.createElement('input'); nu.type='number'; nu.value=p.n;
    const as=document.createElement('select'); ACTS.forEach(a=>{const o=document.createElement('option');o.value=a;o.textContent=a;as.appendChild(o);}); as.value=r.do||'대기';
    const va=document.createElement('input'); va.type='number'; va.value=r.value??300; va.style.width='52px'; va.hidden=(r.do!=='거리유지');
    const x=document.createElement('button'); x.className='x'; x.type='button'; x.textContent='×'; x.title='삭제';
    const sync=()=>{ const v=vs.value; r.when = v? `${v} ${os.value} ${Number(nu.value)||0}` : 'always'; r.do=as.value; if(as.value==='거리유지') r.value=Number(va.value)||300; else delete r.value; delete r._c; renderRules(); };
    vs.onchange=sync; os.onchange=sync; nu.onchange=sync; as.onchange=sync; va.onchange=sync;
    x.onclick=()=>{ myRules.splice(i,1); renderRules(); };
    os.hidden=!p.v; nu.hidden=!p.v;
    row.append(Object.assign(document.createElement('span'),{className:'n',textContent:(i+1)+'.'}), vs, os, nu, as, va, x);
    el.appendChild(row);
  });
  if(!myRules.length) el.innerHTML='<div class="muted" style="font-size:12px">규칙이 없습니다. + 규칙으로 추가하세요.</div>';
}
$('#btnRuleAdd').onclick=()=>{ myRules.push({when:'always',do:'거리유지',value:250}); renderRules(); };
$('#btnRuleEdit').onclick=()=>{ renderRules(); $('#stratMsg').textContent='오른쪽 규칙표를 고친 뒤 [규칙표 제출]을 누르세요. 선생님이 경기 시작 전에 봇으로 만듭니다.'; };
$('#btnSubmitStrat').onclick=()=>{
  // 글 → 에이전트가 규칙표로 변환 (몇 번이든 다시 낼 수 있고, 마지막 제출이 반영된다)
  const txt=($('#stratText').value||'').trim();
  if(!txt){ $('#stratMsg').textContent='전략을 먼저 적어주세요. (드롭다운 규칙표는 오른쪽 [규칙표 제출])'; return; }
  if(!online){ $('#stratMsg').textContent='서버에 연결되어 있지 않습니다. 오른쪽에서 규칙을 직접 만들어 주세요.'; return; }
  net.send({t:'submit', name:me.name, text:txt, build:build});
  $('#stratMsg').textContent='제출 중…'; myBotSeen=JSON.stringify((net.bots||[]).find(x=>x.name===me.name)||''); pollMyBot();
};
$('#btnRuleSubmit').onclick=()=>{   // 드롭다운 규칙표 → 제출문 머리에 '# 직접규칙' 줄로 쌓임 → 선생님이 /봇생성 칠 때 봇이 됨
  const rules=myRules.map(r=>({when:r.when, do:r.do, ...(r.do==='거리유지'? {value:r.value||300} : {})}));
  if(!rules.length){ $('#stratMsg').textContent='규칙표가 비어 있습니다. + 규칙으로 추가하세요.'; return; }
  if(!online){ $('#stratMsg').textContent='서버에 연결되어 있지 않습니다. "혼자 연습"의 [이 봇으로 연습 경기]로 시험해 보세요.'; return; }
  net.send({t:'submit', name:me.name, text:'', build:build, rules});
  $('#stratMsg').textContent='규칙표 제출 중…'; myBotSeen=JSON.stringify((net.bots||[]).find(x=>x.name===me.name)||''); pollMyBot();
};
$('#btnConvert').onclick=()=>{ if(!isHost()||!room||room.mode!=='bots') return; net.send({t:'convert'}); $('#convertMsg').textContent='요청 보내는 중…'; };
$('#btnBotTry').onclick=()=>{ if(room&&!room.solo&&online) { toast('연습 경기는 "혼자 연습"에서 할 수 있습니다'); return; } mySide=soloTeam; startSolo(mySide,{bot:true}); };
function seatedBots(){   // 봇전 방에서만 규칙봇이 출전 (방 봇 + 공용 봇). 팀을 정한 봇이 먼저
  return room&&room.mode==='bots'? (net.bots||[]).slice().sort((a,b)=>(botTeam(b)?1:0)-(botTeam(a)?1:0)) : []; }
function fillOf(side, taken){ const f=(room&&room.fill&&room.fill[side])||0; return Math.max(0, Math.min(f, 5-taken)); }   // 방장이 [+] 로 넣은 봇 수
function teamCounts(){ const t=assignSides(room.members); return {cpu:t.cpu.length+fillOf('cpu',t.cpu.length), gpu:t.gpu.length+fillOf('gpu',t.gpu.length)}; }
function planBots(t){   // 봇전: {cpu:[{owner, bot}], ...} 학생마다 자기 봇, 그리고 방장이 [+] 로 넣은 수만큼 아직 안 나간 방 봇(없으면 기본 봇)
  const out={cpu:[],gpu:[]}, used=new Set(), bots=seatedBots();
  for(const side of ['cpu','gpu']) for(const m of t[side]){ const b=bots.find(x=>x.name===m.name)||null; out[side].push({owner:m, bot:b}); if(b) used.add(b.name); }
  for(const side of ['cpu','gpu']){ const k=fillOf(side, t[side].length);
    for(let i=0;i<k;i++){ const b=bots.find(x=>!used.has(x.name) && (botTeam(x)===side || !botTeam(x)))||null; if(b) used.add(b.name); out[side].push({owner:null, bot:b}); } }
  return out;
}
function trimWorld(w, keepPlain){   // 사람·규칙봇·'봇 없음' 자리 + 팀마다 keepPlain 개의 기본 봇만 남기고 나머지 자리는 없앤다
  const kept={cpu:0,gpu:0}, me=w.chars[w.meIdx];
  w.chars=w.chars.filter(c=> c.isPlayer || c.remote || c.rules || c.ownerLabel || (kept[c.side] < (keepPlain[c.side]||0) && ++kept[c.side]));
  const i=w.chars.indexOf(me); w.meIdx= i>=0? i : 0;
}
function renderBotRoster(){ renderRoom(); }   // 규칙봇 목록이 바뀌면 방 화면(팀 자리)을 다시 그림


/* ---------- 효과음 (WebAudio 합성, 외부 파일 없음) ---------- */
const SFX={ ctx:null, on:true, lastHit:0, lastFeed:0, lastThrow:0,
  ac(){ if(!this.ctx){ try{ this.ctx=new (window.AudioContext||window.webkitAudioContext)(); }catch(_){ this.on=false; } } if(this.ctx&&this.ctx.state==='suspended') this.ctx.resume(); return this.ctx; },
  tone(f0,f1,dur,type,vol){ if(!this.on) return; const a=this.ac(); if(!a) return; const o=a.createOscillator(), g=a.createGain(); o.type=type||'square';
    o.frequency.setValueAtTime(f0,a.currentTime); o.frequency.exponentialRampToValueAtTime(Math.max(20,f1),a.currentTime+dur);
    g.gain.setValueAtTime(vol||0.08,a.currentTime); g.gain.exponentialRampToValueAtTime(0.001,a.currentTime+dur); o.connect(g).connect(a.destination); o.start(); o.stop(a.currentTime+dur); },
  noise(dur,vol,hp){ if(!this.on) return; const a=this.ac(); if(!a) return; const n=a.sampleRate*dur|0, buf=a.createBuffer(1,n,a.sampleRate), d=buf.getChannelData(0); for(let i=0;i<n;i++) d[i]=(Math.random()*2-1)*(1-i/n);
    const s=a.createBufferSource(); s.buffer=buf; const f=a.createBiquadFilter(); f.type=hp?'highpass':'lowpass'; f.frequency.value=hp?1800:900; const g=a.createGain(); g.gain.value=vol||0.1; s.connect(f).connect(g).connect(a.destination); s.start(); },
  throw(){ this.noise(0.08,0.12,true); },
  hit(){ this.noise(0.12,0.18,false); this.tone(220,90,0.12,'triangle',0.08); },
  kill(side){ this.tone(660,220,0.28,'square',0.07); setTimeout(()=>this.tone(440,110,0.3,'square',0.06),90); },
  count(){ this.tone(880,880,0.08,'square',0.06); },
  go(){ this.tone(660,1320,0.25,'square',0.08); },
  win(){ [523,659,784,1046].forEach((f,i)=>setTimeout(()=>this.tone(f,f,0.18,'square',0.07),i*110)); },
  lose(){ [392,330,262].forEach((f,i)=>setTimeout(()=>this.tone(f,f*0.9,0.25,'triangle',0.07),i*160)); },
};
function sfxTick(){ // 월드 변화를 보고 소리 내기 (호스트·클라 공통)
  if(!world||!SFX.on) return;
  const me=myChar();
  if(me && me.throws>SFX.lastThrow){ SFX.throw(); } SFX.lastThrow=me?me.throws:0;
  const fx=world.hitFx.length; if(fx>SFX.lastHit){ SFX.hit(); } SFX.lastHit=fx;
  const fd=world.score.cpu+world.score.gpu; if(fd>SFX.lastFeed){ SFX.kill(); } SFX.lastFeed=fd;
}
$('#btnSound').onclick=()=>{ SFX.on=!SFX.on; $('#btnSound').textContent=SFX.on?'🔊 소리 켬':'🔇 소리 끔'; try{ localStorage.setItem('arena_sfx',SFX.on?'1':'0'); }catch(_){} view.focus(); };
try{ if(localStorage.getItem('arena_sfx')==='0'){ SFX.on=false; $('#btnSound').textContent='🔇 소리 끔'; } }catch(_){}


/* ---------- 경기 그만두기 (두 번 눌러 확인) ---------- */
let quitArm=null;
function quitLabel(){
  if(netMode==='host') return '경기 끝내기 (결과 보기)';
  if(world&&world.spec) return '관전 그만두기';
  if(netMode==='client') return '경기에서 나가기';
  return '경기 그만두기';
}
function resetQuitBtn(){ clearTimeout(quitArm); quitArm=null; $('#btnQuit').textContent=quitLabel(); }
$('#btnQuit').onclick=()=>{
  const b=$('#btnQuit');
  if(!quitArm){ b.textContent='한 번 더 누르면 '+quitLabel().replace(' (결과 보기)',''); quitArm=setTimeout(resetQuitBtn,3000); view.focus(); return; }
  resetQuitBtn();
  if(netMode!=='host' && world&&world.spec){ stopGame(); if(room&&room.members.some(m=>m.id===me.id)){ showScreen('scrRoom'); renderRoom(); } else net.send({t:'leave_room'}); return; }   // 관전 → 방(멤버) / 로비(외부 관전자)
  if(netMode==='host'){                                                             // 방장 → 지금 점수로 경기 종료, 모두 결과 화면
    if(!running) return;
    const L=s=>world.chars.filter(x=>x.side===s).reduce((a,x)=>a+x.lives,0);
    world.over=true; world.winner= L('cpu')>L('gpu')?'cpu': L('gpu')>L('cpu')?'gpu': (world.score.cpu>world.score.gpu?'cpu': world.score.gpu>world.score.cpu?'gpu':null);
    world.stopped=true; endRound(); return;
  }
  if(netMode==='client'){ net.send({t:'quit'}); stopGame(); showScreen('scrRoom'); renderRoom(); toast('경기에서 나왔습니다 — 내 자리는 봇이 이어서 합니다'); return; }
  stopGame(); showScreen('scrRoom'); renderRoom();                                   // 혼자 연습
};

/* ---------- 카운트다운 · 게임 UI ---------- */
function showGameUI(on){ $('#gameUI').hidden=!on; if(on){ resetQuitBtn(); prevHp=MAX_HP; feedSeen=-1; teamsBuilt=false; } }
function countdown(cb){
  const el=$('#countdown'), n=$('#cdN'); let k=3; el.hidden=false; n.textContent=k;
  paused=true;
  SFX.count(); SFX.lastHit=0; SFX.lastFeed=0; SFX.lastThrow=0;
  const tick=()=>{ k--; if(k>0){ n.textContent=k; SFX.count(); setTimeout(tick,700); } else { n.textContent='시작!'; SFX.go(); setTimeout(()=>{ el.hidden=true; paused=false; lastT=performance.now(); cb&&cb(); },500); } };
  setTimeout(tick,700);
}

const _updateHud0=updateHud; updateHud=function(){ _updateHud0(); updateTeams(); sfxTick(); };

/* ---------- 초기화 ---------- */
build={...PRESETS.gpu, ch:'dizni'}; $('#bRender').value=4; $('#bLane').value=4; $('#bClock').value=2; $('#bMem').value=3;
try{ const sb=JSON.parse(ss.get('arena_build')||'null'); if(sb&&Number.isInteger(sb.lane)){ build={...sb}; $('#bRender').value=build.render; $('#bLane').value=build.lane; $('#bClock').value=build.clock; $('#bMem').value=build.mem; } }catch(_){}   // 새로고침 전 빌드
labelFor(); renderRules(); fitCanvas();
showScreen('scrLogin');
loadCharImages();
