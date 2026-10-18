
/* ==========================================================================
   화면 흐름:  로그인 → 로비 → 방 → 경기 → (결과) → 방
   netMode(엔진 변수): 'solo' 혼자 연습 | 'host' 이 브라우저가 경기 계산 | 'client' 호스트 스냅샷을 받아 그림
   ========================================================================== */
const SCREENS=['scrLogin','scrLobby','scrRoom','scrGame','scrLeague'];
let curScreen='scrLogin';
function showScreen(id){ curScreen=id; for(const s of SCREENS) $('#'+s).hidden=(s!==id); if(id==='scrGame'){ fitCanvas(); view.focus(); } }

const me={id:0,name:''};
let room=null;                 // 서버가 보내는 방 상태 {id,title,host,state,members:[{id,name,b,ready}]}
let lobby={rooms:[],users:[]};
let online=false;
let pendingStart=false;        // 방장이 시작을 눌러 서버 확인을 기다리는 중
let botsOnlyStart=false;
let startAfterBots=null;        // 시작 직전 최신 규칙봇 목록을 기다리는 중이면 그 시작 함수


/* ---------- 캐릭터 = 이름 붙은 하드웨어 빌드 ---------- */
const CHARS=[
  {id:'dao',   name:'다오',   type:'밸런스형', build:{render:3,lane:0,clock:5,mem:5}, col:['#2f7fd6','#1b558f','#63a8ef'], hat:'pom',     desc:'기본 CPU. 한 발이 정확하고 반응이 빠르다. 탄약도 넉넉하다.'},
  {id:'bazzi', name:'배찌',   type:'스피드형', build:{render:4,lane:0,clock:5,mem:2}, col:['#e5484d','#9c1e22','#ff8a8e'], hat:'visor',   desc:'클럭을 최대로 올리고 화면도 선명하게. 대신 탄약통이 아주 작다.'},
  {id:'marid', name:'마리드', type:'탄약형',   build:{render:3,lane:1,clock:4,mem:5}, col:['#2fbf71','#1f8a50','#7fe0a8'], hat:'ears',    desc:'큰 캐시. 탄약 36발을 넓게 줍고, 한 번에 2발씩(피해 3) 던진다.'},
  {id:'su',    name:'수',     type:'밸런스형', build:{render:4,lane:1,clock:4,mem:4}, col:['#4f5bd5','#2e3a9e','#9aa3f0'], hat:'band',    desc:'선명한 화면에 2발씩. 어느 하나 튀지 않는 CPU 올라운더.'},
  {id:'kephi', name:'케피',   type:'4발형',    build:{render:4,lane:2,clock:4,mem:3}, col:['#8250df','#5a32b0','#b394f5'], hat:'glasses', desc:'코어 폭 4. CPU 진영이지만 작은 부채꼴로 뿌린다.'},
  {id:'mos',   name:'모스',   type:'8발형',    build:{render:4,lane:3,clock:3,mem:3}, col:['#f0671f','#9a3d08','#ffa06a'], hat:'horn',    desc:'8발 부채꼴. GPU 진영 중에서는 반응이 가장 빠르다.'},
  {id:'dizni', name:'디지니', type:'밸런스형', build:{render:4,lane:4,clock:2,mem:3}, col:['#d1662a','#8f4419','#eb9155'], hat:'pom',     desc:'기본 GPU. 16발 부채꼴에 선명한 화면. 던지기 전 준비 시간이 있고 한 번에 탄약 6을 쓴다.'},
  {id:'uni',   name:'우니',   type:'렌더형',   build:{render:5,lane:4,clock:1,mem:2}, col:['#e0b61f','#9a7a05','#ffe58a'], hat:'star',    desc:'해상도 100%, 시야 최대. 느리고 탄약 8발뿐 — 처리량에 올인.'},
  {id:'ethi',  name:'에띠',   type:'탄약형',   build:{render:3,lane:4,clock:1,mem:4}, col:['#1fb6c9','#117c8a','#7fe0ec'], hat:'antenna', desc:'16발을 오래 뿌리도록 메모리를 키웠다. 화면은 흐릿하다.'},
];
/* ---------- 캐릭터 그림 (characters/<id>/ 폴더가 있으면 그 PNG, 없으면 위 도트) ----------
   폴더 구조는 crazy 저장소의 web/public/characters/ 와 같습니다: sprite.json + down_0.png …
   원본 그림은 빨간 팀 기준이라 CPU 팀은 빨강→파랑으로 바꿔 그립니다. */
const IMG={};
function recolorBlue(img){ // 채도 높은 빨강(색상 340°~14°)만 파랑으로 돌림 — crazy 저장소와 같은 방식
  const c=document.createElement('canvas'); c.width=img.width; c.height=img.height; const g=c.getContext('2d'); g.drawImage(img,0,0);
  const d=g.getImageData(0,0,c.width,c.height), a=d.data;
  for(let i=0;i<a.length;i+=4){ if(a[i+3]===0) continue; const r=a[i]/255,gg=a[i+1]/255,b=a[i+2]/255, max=Math.max(r,gg,b), min=Math.min(r,gg,b), delta=max-min, sat=max?delta/max:0;
    if(sat<0.45||max!==r) continue; let h=(60*((gg-b)/delta)+360)%360; if(!(h>=340||h<=14)) continue; h=(h+215)%360;
    const cc=max*sat, x=cc*(1-Math.abs((h/60)%2-1)), m=max-cc; let rr,g2,bb;
    if(h<60)[rr,g2,bb]=[cc,x,0]; else if(h<120)[rr,g2,bb]=[x,cc,0]; else if(h<180)[rr,g2,bb]=[0,cc,x]; else if(h<240)[rr,g2,bb]=[0,x,cc]; else if(h<300)[rr,g2,bb]=[x,0,cc]; else [rr,g2,bb]=[cc,0,x];
    a[i]=(rr+m)*255; a[i+1]=(g2+m)*255; a[i+2]=(bb+m)*255; }
  g.putImageData(d,0,0); return c; }
function loadImg(src){ return new Promise(res=>{ const im=new Image(); im.onload=()=>res(im); im.onerror=()=>res(null); im.src=src; }); }
async function loadCharImages(){
  if(location.protocol==='file:') return;
  await Promise.all(CHARS.map(async ch=>{
    const base=`characters/${ch.id}/`; let m=null;
    try{ const r=await fetch(base+'sprite.json',{cache:'no-cache'}); if(r.ok) m=await r.json(); }catch(_){}
    if(!m){ const d=await loadImg(base+'down.png'); if(!d) return; m={down:['down.png'],up:['up.png'],left:['left.png'],right:['right.png'],portrait:'portrait.png'}; }
    const L=async f=>{ if(!f) return null; const list=(Array.isArray(f)?f:[f]); const ims=await Promise.all(list.map(x=>loadImg(base+x))); const ok=ims.filter(Boolean); return ok.length?ok:null; };
    const down=await L(m.down); if(!down) return;
    const set={ fps:m.fps||8, scale:m.scale||1,
      stand:{ down, up:await L(m.up)||down, left:await L(m.left), right:await L(m.right) },
      walk:{ down:await L(m.walk_down)||down, up:await L(m.walk_up)||null, left:await L(m.walk_left), right:await L(m.walk_right) },
      portrait:(await L(m.portrait))?.[0]||down[0] };
    set.stand.left=set.stand.left||set.stand.right||down; set.stand.right=set.stand.right||set.stand.left;
    set.walk.up=set.walk.up||set.stand.up; set.walk.left=set.walk.left||set.stand.left; set.walk.right=set.walk.right||set.stand.right;
    set.flipLeft=!m.left&&!m.walk_left&&!!(m.right||m.walk_right); set.flipRight=!m.right&&!m.walk_right&&!!(m.left||m.walk_left);
    // 팀 색: gpu = 원본(빨강 계열), cpu = 파랑으로 변환
    const conv=o=>Object.fromEntries(Object.entries(o).map(([k,v])=>[k,v.map(recolorBlue)]));
    IMG[ch.id]={ gpu:set, cpu:{...set, stand:conv(set.stand), walk:conv(set.walk), portrait:recolorBlue(set.portrait)} };
  }));
  for(const k in PORT) delete PORT[k];
  if(room) renderRoom();
}
function imgOf(c){ const s=c.ch&&IMG[c.ch]; return s? s[c.side] : null; }

const CH=Object.fromEntries(CHARS.map(c=>[c.id,c]));
function randCh(kind){ const l=CHARS.filter(c=>sideOfBuild(c.build)===kind); return l[Math.floor(Math.random()*l.length)].id; }
const PORT={};
function portrait(ch, side, size, extra){
  const c=CH[ch]; const key=(c?ch:'_')+side;
  if(!PORT[key]){ const im=c&&IMG[ch]? IMG[ch][side].portrait : null; const sp= im || (c? SPR.ch[ch][side][0] : SPR[side][0]); PORT[key]= im? (im.toDataURL? im.toDataURL() : im.src) : sp.toDataURL(); }
  const col= c? c.col[2] : (side==='cpu'?'#63a8ef':'#eb9155');
  return `<span class="portrait ${extra||''}" style="width:${size}px;height:${size}px;background:radial-gradient(circle at 50% 40%,#fff,${col}aa)"><img src="${PORT[key]}" alt="" style="${c&&IMG[ch]?'width:88%;height:88%;object-position:50% 20%;object-fit:cover':''}"></span>`;
}
function statRows(b){
  const P=profile(b), top={res:1,lanes:16,react:1/0.11,ammo:36};
  const rows=[['해상도·시야',P.renderScale/top.res,`${Math.round(P.renderScale*100)}% · ${P.view}`],
    ['동시 발사',P.lanes/top.lanes,`${P.lanes}발 · ${P.baseReload.toFixed(2)}s`],
    ['반응 속도',(1/P.windup)/top.react,`${P.windup.toFixed(2)}s`],
    ['탄약',P.maxAmmo/top.ammo,`${P.maxAmmo}발`]];
  return rows.map(r=>`<div class="stat-bar"><span>${r[0]}</span><div class="bar"><i style="width:${Math.max(6,Math.round(r[1]*100))}%"></i></div><small>${r[2]}</small></div>`).join('');
}
function renderCharSelect(locked){
  const g=$('#charGrid'); const cur=build.ch||'custom';
  let html=CHARS.map(c=>{ const s=sideOfBuild(c.build); return `<button class="char-card ${cur===c.id?'selected':''}" data-ch="${c.id}" ${locked?'disabled':''} title="${c.desc}">${portrait(c.id,s,56)}<b>${c.name}</b><small>${c.type}</small><span class="side ${s}">${s.toUpperCase()}</span></button>`; }).join('');
  html+=`<button class="char-card ${cur==='custom'?'selected':''}" data-ch="custom" ${locked?'disabled':''}><span class="portrait dice" style="width:56px;height:56px">⚙</span><b>커스텀</b><small>예산 90 안에서 직접</small><span class="side ${sideOfBuild(build)}">${sideOfBuild(build).toUpperCase()}</span></button>`;
  g.innerHTML=html;
  g.querySelectorAll('.char-card').forEach(el=>el.onclick=()=>{ const id=el.dataset.ch; if(id==='custom'){ build={...build,ch:'custom'}; $('#advBuild').open=true; labelFor(); pushBuild(); } else setBuild({...CH[id].build,ch:id}); });
  const c=CH[cur], side=sideOfBuild(build), d=$('#charDetail'); d.className='char-detail '+side;
  d.innerHTML=`<div class="head">${portrait(cur,side,44)}<div><b>${c?c.name:'커스텀'}</b> <span style="color:var(--${side}-ink)">${side.toUpperCase()}형 하드웨어${c?' · '+c.type:''}</span></div></div>
    <p>${c?c.desc:'아래 "세부 빌드 조정"의 슬라이더로 예산 90을 나눠 쓰세요. 코어 폭이 8발 이상이면 GPU형입니다. 팀은 위에서 따로 고릅니다.'}</p>${statRows(build)}`
    +(locked?'<p class="muted" style="margin:6px 0 0">준비 상태에서는 캐릭터를 바꿀 수 없습니다.</p>':'');
}

/* ---------- 맵 선택 ---------- */
function mapPreview(id){ const c=document.createElement('canvas'); c.width=160; c.height=100; const g=c.getContext('2d');
  g.fillStyle='#eef4fb'; g.fillRect(0,0,160,100); g.fillStyle='rgba(47,127,214,.12)'; g.fillRect(0,0,18,100); g.fillStyle='rgba(240,103,31,.12)'; g.fillRect(142,0,18,100);
  g.fillStyle='#9fb6cc'; for(const o of MAPS[id].obst) g.fillRect(o.x/6,o.y/6,Math.max(2,o.w/6),Math.max(2,o.h/6)); return c; }
function renderMaps(){
  const el=$('#mapList'); const canPick=!!(room&&(room.solo||(isHost()&&room.state==='waiting')));
  el.innerHTML='';
  for(const id in MAPS){ const b=document.createElement('button'); b.className='map-card'+(id===curMap?' selected':''); b.disabled=!canPick;
    b.appendChild(mapPreview(id)); b.insertAdjacentHTML('beforeend',`<b>${MAPS[id].name}</b><small>${MAPS[id].tip}</small>`);
    b.onclick=()=>{ setMap(id); if(online&&room&&!room.solo) net.send({t:'map',id}); renderMaps(); }; el.appendChild(b); }
  $('#mapHint').textContent= canPick? '벽 배치가 어느 진영에 유리한지 생각해 보세요' : '방장만 바꿀 수 있습니다';
}

/* ---------- 네트워크 ---------- */
const net={
  ws:null, connected:false, bots:[], botsOn:false, lastSend:0, lastSnap:0,
  connect(name, onFail){
    const proto=location.protocol==='https:'?'wss':'ws';
    let ws; try{ ws=new WebSocket(`${proto}://${location.host}/ws`); }catch(e){ onFail&&onFail(); return; }
    this.ws=ws; let opened=false;
    ws.onopen=()=>{ opened=true; this.connected=true; online=true; this.send({t:'hello',name}); };
    ws.onclose=()=>{ this.connected=false; if(!opened){ onFail&&onFail(); return; } online=false;
      if(curScreen==='scrLogin'||netMode==='solo'){ return; }
      // 자동 재접속: 같은 닉네임으로 60초 동안 2초마다 시도. 서버가 자리를 지켜준다.
      stopGame(); toast('연결이 끊어졌습니다 — 다시 접속 중…'); $('#hudNet').textContent='재접속 중…';
      const name=me.name, t0=Date.now(); const retry=()=>{ if(this.connected) return;
        if(Date.now()-t0>60000){ room=null; showScreen('scrLogin'); $('#loginErr').textContent='연결이 끊어졌습니다. 다시 접속하세요.'; $('#loginErr').hidden=false; return; }
        this.connect(name, ()=>setTimeout(retry,2000)); };
      setTimeout(retry,1500); };
    ws.onerror=()=>{};
    ws.onmessage=(e)=>{ let m; try{ m=JSON.parse(e.data); }catch(_){ return; } onNetMsg(m); };
  },
  send(o){ if(this.ws&&this.ws.readyState===1) this.ws.send(JSON.stringify(o)); },
};
function isHost(){ return !!(room&&room.host===me.id); }

function onNetMsg(m){
  switch(m.t){
    case 'welcome': me.id=m.id; me.name=m.name; $('#whoami').textContent=me.name; $('#whoami2').textContent=me.name; if(!room||room.solo) showScreen('scrLobby'); else toast('다시 연결되었습니다');
      ss.set('arena_auto','1');
      setTimeout(()=>{ const rid=+ss.get('arena_room'); if(rid && !room) net.send(ss.get('arena_watch')==='1'? {t:'join_room',rid,spectate:true} : {t:'join_room',rid,b:build}); },700);   // 60초가 지났거나 방장·관전자였으면 다시 입장
      return;
    case 'lobby': lobby=m; renderLobby(); return;
    case 'room': onRoomState(m); return;
    case 'left_room': room=null; ss.del('arena_room'); ss.del('arena_watch'); if(curScreen!=='scrLogin'){ stopGame(); showScreen('scrLobby'); } return;
    case 'chat': addChat(m); return;
    case 'err': toast(m.msg||'오류');
      if(m.msg==='없는 방입니다'){ ss.del('arena_room'); ss.del('arena_watch'); resetBotPanel(); if(!room) showScreen('scrLobby'); }   // 새로고침 사이에 방이 사라짐
      return;
    case 'bots': net.bots=m.list||[];
      if(startAfterBots){ startAfterBots(); return; }   // [게임 시작] 직후 받은 최신 목록으로 경기 시작
      renderBotRoster(); showMyBot(); return;
    case 'submitok': $('#stratMsg').textContent= m.botErr? '규칙표를 제출하지 못했습니다: '+m.botErr
      : m.direct? `규칙표 제출 완료 (${m.name}, 규칙 ${m.rules}개) — 선생님이 경기 시작 전에 봇으로 만듭니다. 그 전까지는 다시 내면 마지막 제출이 반영됩니다.`
      : '제출 완료 ('+m.name+') — 모두 제출하면 선생님이 경기 시작 전에 한꺼번에 규칙표로 바꿉니다. 그 전까지는 다시 내면 마지막 제출이 반영됩니다.'; return;
  }
  if(netMode==='host'){
    if(m.t==='left'){ if(world){ const c=world.chars.find(x=>x.remote===m.id); if(c){ c.remote=0; c.away=0; c.rin=null; c.name=c.name+'(봇)'; if(running) broadcastInit(); } } return; }
    if(m.t==='away'){ if(world){ const c=world.chars.find(x=>x.remote===m.id); if(c){ c.away=c.remote; c.remote=0; c.rin=null; } } return; }
    if(m.t==='rejoin'){ if(world&&running){ const c=world.chars.find(x=>x.away===m.id); if(c){ c.remote=c.away; c.away=0; c.rin={mx:0,my:0,aim:0}; } broadcastInit(); } return; }
    if(!world) return;
    const c=world.chars.find(x=>x.remote===m.id); if(!c) return;
    if(m.t==='in'){ c.rin={mx:m.mx,my:m.my,aim:m.aim,sp:m.sp}; }
    else if(m.t==='th'){ c.rin=c.rin||{mx:0,my:0,aim:0}; c.rin.aim=m.aim; tryThrow(world,c,m.aim); }
    return;
  }
  if(netMode==='client'){
    if(m.t==='init'){ applyInit(m); return; }
    if(m.t==='s'){ if(running) applySnapshot(m); return; }
    if(m.t==='res'){ if(curScreen==='scrGame') showResult(m); return; }
  }
}
function onRoomState(m){
  const was=room; room=m;
  if(!m.solo){ ss.set('arena_room',m.id); const inSeat=(m.members||[]).some(x=>x.id===me.id); ss.set('arena_watch', inSeat? '0':'1'); }
  // 규칙봇 켜짐 여부는 방 상태로 공유된다 → 학생 화면에도 규칙봇 자리가 보인다
  if(!!m.botsOn!==net.botsOn){ net.botsOn=!!m.botsOn; if(net.botsOn && !(net.bots||[]).length) net.send({t:'getbots'}); }   // 봇전 방이면 켜짐
  if(m.map && m.map!==curMap) setMap(m.map);
  const playing=m.state==='playing';
  if(playing && isHost() && pendingStart){ pendingStart=false; const bo=botsOnlyStart; botsOnlyStart=false;
    if(!net.botsOn){ startHostMatch(bo); return; }
    // 규칙봇을 켰으면 시작하는 순간 bots/ 전체를 새로 읽어 그 상태로 앉힌다 (응답이 늦으면 1.5초 뒤 가진 목록으로)
    let done=false; const go=()=>{ if(done) return; done=true; startAfterBots=null; startHostMatch(bo); };
    startAfterBots=go; net.send({t:'getbots'}); setTimeout(go,1500); return; }
  if(playing && !isHost() && netMode!=='client'){ netMode='client'; $('#startHint').textContent='경기가 시작됐습니다 — 호스트의 화면을 받는 중…'; }
  if(playing && !isHost() && !running && curScreen!=='scrGame'){ $('#startHint').textContent='경기 진행 중 — 호스트 화면을 기다리는 중…'; }
  if(!playing && curScreen==='scrGame' && netMode==='client' && running){ // 호스트가 나가 경기가 중단됨 (결과 화면은 그대로 둠)
    stopGame(); showScreen('scrRoom'); toast('경기가 중단되었습니다');
  }
  if(!playing && netMode!=='solo') netMode= isHost()?'host':'client';
  if(curScreen==='scrLobby' || curScreen==='scrLogin' || (was&&was.id!==m.id)) { showScreen('scrRoom'); $('#chatRoom').innerHTML=''; if(!was||was.id!==m.id) resetBotPanel(); }
  renderRoom();
}


/* ---------- 봇 리그 (league.json 은 node league.js 가 만듭니다) ---------- */
let leagueFrom='scrLobby';
async function showLeague(from){
  leagueFrom=from||curScreen; showScreen('scrLeague');
  let data=null;
  try{ const r=await fetch('league.json?'+Date.now(),{cache:'no-store'}); if(r.ok) data=await r.json(); }catch(_){}
  const tb=$('#leagueTable'), empty=$('#leagueEmpty');
  if(!data||!data.standings){ tb.innerHTML=''; empty.hidden=false; $('#leagueMatches').innerHTML=''; $('#leagueAudit').innerHTML=''; $('#leagueWhen').textContent=''; $('#leagueMeta').textContent=''; return; }
  empty.hidden=true;
  $('#leagueWhen').textContent='갱신 '+new Date(data.when).toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'});
  $('#leagueMeta').textContent=`봇 ${data.standings.length}개 · 조합당 ${data.rounds}판 · 승 3점 무 1점`;
  tb.innerHTML='<tr><th>#</th><th>봇</th><th>진영</th><th>승</th><th>무</th><th>패</th><th>득실</th><th>명중</th><th>승점</th></tr>'+
    data.standings.map((t,i)=>`<tr class="${i===0?'top':''}"><td class="rank">${i+1}</td><td class="nm" title="${esc(t.note||'')}">${portrait(CH[t.ch]?t.ch:null,t.side,26)}${esc(t.name)} <small class="muted" style="font-weight:500">규칙 ${t.rules}</small></td><td><span class="pill ${t.side}">${t.side.toUpperCase()}</span></td><td>${t.w}</td><td>${t.d}</td><td>${t.l}</td><td>${t.gf}:${t.ga}</td><td>${t.hit}%</td><td class="pts">${t.pts}</td></tr>`).join('');
  $('#leagueMatches').innerHTML=data.matches.map(m=>`<div><span>${esc(m.a)} <span class="muted">vs</span> ${esc(m.b)}</span><span class="sc">${m.rs.map(x=>x.join(':')).join(' · ')}</span></div>`).join('');
  // 상성표 (가로 = 공격자)
  const names=data.standings.map(t=>t.name), diff={};
  for(const m of data.matches){ let d=0; for(const [a,b] of m.rs) d+= a>b?1: a<b?-1:0; diff[m.a+'|'+m.b]=d; diff[m.b+'|'+m.a]=-d; }
  const R=data.rounds, col=v=>{ const k=Math.min(1,Math.abs(v)/R); return v>0? `rgba(31,111,224,${0.25+0.7*k})` : v<0? `rgba(240,103,31,${0.25+0.7*k})` : '#c9d3df'; };
  $('#leagueHeat').innerHTML='<tr><th></th>'+names.map(n=>`<th class="col" title="${esc(n)}">${esc(n)}</th>`).join('')+'</tr>'+
    names.map(a=>`<tr><th title="${esc(a)}">${esc(a)}</th>`+names.map(b=> a===b? '<td class="self">·</td>' : `<td style="background:${col(diff[a+'|'+b]||0)}" title="${esc(a)} vs ${esc(b)}">${diff[a+'|'+b]>0?'+':''}${diff[a+'|'+b]||0}</td>`).join('')+'</tr>').join('');
  const f=data.findings||[]; $('#leagueAuditPanel').hidden=!f.length;
  $('#leagueAudit').innerHTML=f.map(x=>`<div class="audit"><b>[${x.kind}] ${esc(x.file)}</b>${esc(x.why)}</div>`).join('');
}
$('#btnLobbyLeague').onclick=()=>showLeague('scrLobby');
$('#btnLeagueLogin').onclick=()=>showLeague('scrLogin');
$('#btnLeagueRefresh').onclick=()=>showLeague(leagueFrom);
$('#btnLeagueBack').onclick=()=>showScreen(leagueFrom);


/* ---------- 내 봇 (에이전트가 만든 규칙표 + 해석 메모) ---------- */
let myBotSeen='', myBotPoll=null;
function resetBotPanel(){   // 다른 방에 들어가면 전 방의 제출 메시지·내 봇 상자를 비운다 (봇 파일 자체는 이름별로 남아 있음)
  if(myBotPoll){ clearInterval(myBotPoll); myBotPoll=null; } myBotManual=false;
  $('#stratMsg').textContent=''; $('#myBotBox').hidden=true; $('#myBotBox').innerHTML=''; $('#stratText').value='';
}
/* 새로고침해도 같은 방으로: 탭마다(sessionStorage) 접속 여부·방·빌드를 기억 */
const ss={ get:k=>{ try{ return sessionStorage.getItem(k); }catch(_){ return null; } }, set:(k,v)=>{ try{ sessionStorage.setItem(k,String(v)); }catch(_){} }, del:k=>{ try{ sessionStorage.removeItem(k); }catch(_){} } };
function showMyBot(){
  const b=(net.bots||[]).find(x=>x.name===me.name); const box=$('#myBotBox');
  if(!b){ if(myBotPoll||myBotManual) box.innerHTML='<b>내 봇</b> 아직 만들어지지 않았습니다. 선생님이 시작 전에 모두의 전략을 규칙표로 바꾸면 여기에 나타납니다.'; box.hidden=!(myBotPoll||myBotManual); return; }
  const json=JSON.stringify(b); const fresh= json!==myBotSeen; myBotSeen=json;
  const side=typeof b.build==='string'? b.build : sideOfBuild(b.build||PRESETS.gpu);
  box.hidden=false;
  box.innerHTML=`<b>내 봇 — ${esc(b.name)}</b> <span class="pill ${side}">${side.toUpperCase()}</span> 규칙 ${(b.rules||[]).length}개`+
    (b.note? `<div style="margin-top:4px"><b>에이전트 메모</b> ${esc(b.note)}</div>`:'')+
    `<div style="margin-top:4px;font-family:var(--mono);font-size:11.5px">${(b.rules||[]).map((r,i)=>`${i+1}. ${esc(r.when)} → ${esc(r.do)}${r.value?' '+r.value:''}`).join('<br>')}</div>`+
    `<div class="row" style="margin-top:6px"><button class="btn sm" id="btnUseMyBot">이 규칙표를 편집기로 가져오기</button></div>`;
  $('#btnUseMyBot').onclick=()=>{ myRules=(b.rules||[]).map(r=>({...r})); ruleSrcLabel='에이전트'; renderRules(); toast('규칙표를 가져왔습니다'); };
  if(fresh && myBotPoll && !myBotManual){ toast('에이전트가 내 봇을 만들었습니다'); clearInterval(myBotPoll); myBotPoll=null; }
  myBotManual=false;
}
function pollMyBot(){ // 제출 후 10초마다 내 봇이 생겼는지 확인 (최대 10분)
  if(!online) return; clearInterval(myBotPoll); let n=0;
  myBotPoll=setInterval(()=>{ if(!online||n++>60){ clearInterval(myBotPoll); myBotPoll=null; return; } net.send({t:'getbots'}); },10000);
  net.send({t:'getbots'});
}
$('#btnMyBot').onclick=()=>{ if(!online){ toast('서버 연결이 필요합니다'); return; } myBotManual=true; net.send({t:'getbots'}); };
let myBotManual=false;

/* ---------- 로그인 ---------- */
$('#loginForm').onsubmit=(e)=>{
  e.preventDefault();
  const name=($('#pname').value||'').trim(); if(!name) return;
  try{ localStorage.setItem('arena_nick',name); }catch(_){}
  ss.set('arena_nick',name);   // 탭별 닉네임 (새로고침 복귀용 — 한 브라우저에 탭 여러 개여도 섞이지 않게)
  $('#loginErr').hidden=true;
  if(location.protocol==='file:'||!location.host){ enterSolo(name); return; }
  $('#btnLogin').disabled=true; $('#btnLogin').textContent='접속 중…';
  net.connect(name, ()=>{ $('#btnLogin').disabled=false; $('#btnLogin').textContent='접속하기'; $('#loginErr').textContent='서버에 연결할 수 없습니다. 선생님 PC의 서버가 켜져 있는지 확인하거나, 혼자 연습을 누르세요.'; $('#loginErr').hidden=false; });
  setTimeout(()=>{ if(!net.connected){ $('#btnLogin').disabled=false; $('#btnLogin').textContent='접속하기'; } },4000);
};
$('#btnSoloLogin').onclick=()=>enterSolo(($('#pname').value||'').trim()||'나');
$('#btnLobbySolo').onclick=()=>enterSolo(me.name);
try{ $('#pname').value=ss.get('arena_nick')||localStorage.getItem('arena_nick')||''; }catch(_){}
// 이 탭에서 이미 접속했던 적이 있으면(=새로고침) 자동으로 다시 접속 → 서버가 60초 안이면 원래 자리로 돌려준다
if(ss.get('arena_auto')==='1' && $('#pname').value && location.protocol!=='file:' && location.host) setTimeout(()=>$('#loginForm').requestSubmit(),0);

function enterSolo(name){
  me.name=name||me.name||'나'; $('#whoami2').textContent=me.name;
  if(room&&online){ net.send({t:'leave_room'}); }
  room={id:0,title:'혼자 연습',host:me.id,state:'waiting',members:[{id:me.id,name:me.name,b:build,ready:false}],solo:true};
  netMode='solo'; showScreen('scrRoom'); renderRoom();
}

/* ---------- 로비 ---------- */
function renderLobby(){
  const only=$('#waitingOnly').checked;
  const rooms=lobby.rooms.filter(r=>!only||(r.state==='waiting'&&r.players<r.max));
  const g=$('#roomGrid'); g.innerHTML='';
  if(!rooms.length){ g.innerHTML='<div class="empty">열린 방이 없습니다. 방을 만들어 보세요!</div>'; }
  for(const r of rooms){
    const full=r.players>=r.max, dis=r.state==='playing'||full;
    const b=document.createElement('button'); b.className='room-card'+(dis?' disabled':'');
    b.innerHTML=`<div class="room-no">${String(r.id).padStart(3,'0')}</div><div class="room-info"><div class="room-title">${r.locked?'🔒 ':''}${esc(r.title)}</div><div class="room-sub">${r.mode==='bots'?'🤖 봇전':'🎮 학생 대전'} · 방장 ${esc(r.host)}${r.spect?' · 관전 '+r.spect:''}</div></div><div class="room-state ${r.state}">${r.state==='playing'?'게임중':full?'꽉참':'대기중'}<small>${r.players}/${r.max}</small></div>`;
    { const w=document.createElement('span'); w.className='btn sm'; w.textContent='관전'; w.style.marginLeft='6px'; w.onclick=(e)=>{ e.stopPropagation(); net.send({t:'join_room',rid:r.id,spectate:true}); }; b.appendChild(w); }
    b.onclick=()=>{ if(dis) return; if(r.locked) modal('🔒 '+r.title,[['pw','비밀번호','password']],'입장',v=>net.send({t:'join_room',rid:r.id,pw:v.pw,b:build})); else net.send({t:'join_room',rid:r.id,b:build}); };
    g.appendChild(b);
  }
  $('#userN').textContent='('+lobby.users.length+')';
  $('#userList').innerHTML=lobby.users.map(u=>`<li class="${u.id===me.id?'me':''}"><span>${esc(u.name)}</span><small>${u.room?u.room+'번 방':'로비'}</small></li>`).join('');
}
$('#waitingOnly').onchange=renderLobby;
$('#btnCreate').onclick=()=>modal('방 만들기',[['mode','방 기능',[['people','학생 대전 — 학생이 직접 조종 (빈자리는 기본 봇)'],['bots','봇전 — 학생들이 낸 전략 봇끼리 대결 (사람은 관전)']]],
  ['title','방 제목','text',me.name+'님의 방'],['pw','비밀번호 (비우면 공개방)','password']],'만들기',v=>net.send({t:'create_room',title:v.title,pw:v.pw,mode:v.mode,b:build}));

/* ---------- 모달 ---------- */
function modal(title, fields, okLabel, cb){
  $('#modalTitle').textContent=title;
  const f=$('#modalForm'); f.innerHTML=fields.map(([k,l,t,ph])=> Array.isArray(t)
      ? `<label>${l}<select name="${k}">${t.map(([v,x])=>`<option value="${v}">${x}</option>`).join('')}</select></label>`
      : `<label>${l}<input type="${t||'text'}" name="${k}" maxlength="20" placeholder="${ph||''}" autocomplete="off"></label>`).join('')
    +`<div class="form-actions"><button type="button" class="btn" id="modalCancel">취소</button><button class="btn primary">${okLabel}</button></div>`;
  $('#modal').hidden=false; const first=f.querySelector('input'); if(first) first.focus();
  $('#modalCancel').onclick=()=>$('#modal').hidden=true;
  f.onsubmit=(e)=>{ e.preventDefault(); const v={}; for(const i of f.querySelectorAll('input,select')) v[i.name]=i.value; $('#modal').hidden=true; cb(v); };
}
$('#modal').onclick=(e)=>{ if(e.target===$('#modal')) $('#modal').hidden=true; };

/* ---------- 채팅 ---------- */
function esc(s){ return String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
function addChat(m){
  const inRoom=!!room&&!room.solo;
  const targets = inRoom? ['#chatRoom','#chatGame'] : ['#chatLobby'];
  for(const t of targets){ const el=$(t); const d=document.createElement('div'); d.className='chat-line'+(m.sys?' sys':'');
    d.innerHTML= m.sys? esc(m.text) : `<b>${esc(m.from)}</b> ${esc(m.text)}`; el.appendChild(d); while(el.children.length>80) el.firstChild.remove(); el.scrollTop=el.scrollHeight; }
}
for(const id of ['chatFormLobby','chatFormRoom','chatFormGame']){
  $('#'+id).onsubmit=(e)=>{ e.preventDefault(); const i=e.target.querySelector('input'); const t=i.value.trim(); i.value=''; if(t&&online) net.send({t:'chat',text:t}); if(id==='chatFormGame') view.focus(); };
}

/* ---------- 방 ---------- */
function assignSides(members){ // 각자 고른 팀(m.team). 팀 정보가 없으면 인원 적은 팀으로
  const t={cpu:[],gpu:[]};
  for(const m of members){ if(m.watch) continue; let s= m.team==='gpu'?'gpu': m.team==='cpu'?'cpu' : (t.cpu.length<=t.gpu.length?'cpu':'gpu'); if(t[s].length>=5) s= s==='cpu'?'gpu':'cpu'; if(t[s].length>=5) continue; t[s].push({...m,side:s}); }
  return t;
}
let soloTeam='cpu';
function renderRoom(){
  if(!room) return;
  const solo=!!room.solo, host=solo||isHost(), playing=room.state==='playing';
  const botMode=!solo&&room.mode==='bots';
  $('#roomTitle').textContent=solo?'혼자 연습 — 봇 상대':`${String(room.id).padStart(3,'0')} · ${room.title} · ${botMode?'봇전':'학생 대전'}`;
  $('#botPanel').hidden= !solo && !botMode;   // 전략 봇 칸은 봇전 방(과 혼자 연습)에서만
  $('#roomChatPanel').hidden=solo; $('#gameChatPanel').hidden=solo;
  $('#soloTools').hidden=!solo;
  // 봇전 방: 방장 [봇 만들기] 버튼 + 모두에게 변환 상태
  $('#btnConvert').hidden= !botMode || !host || playing;
  { const cv=room.convert, el=$('#convertMsg'); el.hidden= !botMode;
    el.textContent= !cv? '전략을 다 냈으면 방장이 [봇 만들기]를 누르세요 (선생님 PC에서 /봇대기 가 켜져 있어야 합니다)'
      : cv.state==='요청됨'? `봇 만들기 요청됨 (${cv.time||''}) — 선생님 PC가 곧 변환합니다…`
      : cv.state==='변환 중'? `변환 중… ${cv.done!=null? cv.done+'/'+(cv.total||'?')+'명' : ''}`
      : cv.state==='완료'? `봇 만들기 완료 (${cv.time||''}) — 봇 ${cv.bots!=null?cv.bots:'?'}개${cv.note? ' · '+cv.note : ''}`
      : `${cv.state||''} ${cv.note||''}`; }
  $('#btnSubmitStrat').disabled=!online;
  // 팀 슬롯
  let members = solo? [{id:me.id,name:me.name,b:build,ready:false,team:soloTeam}] : room.members;
  const t=assignSides(members);
  const plan= botMode? planBots(t) : null;   // 봇전: 학생마다 자기 봇 + 남는 자리에 방·공용 봇
  for(const side of ['cpu','gpu']){
    const el=$('#team'+(side==='cpu'?'Cpu':'Gpu')); el.innerHTML='';
    const list=t[side]; let n=0;
    for(const m of list){ n++; const d=document.createElement('div'); d.className='slot'+(m.id===me.id?' me':'');
      const badge= m.gone?'<span class="badge">연결 끊김</span>': (!solo&&m.id===room.host)?'<span class="badge host">방장</span>': m.ready?'<span class="badge ready">READY</span>':'';
      const chn=(m.b&&CH[m.b.ch])? CH[m.b.ch].name : '커스텀', kind=sideOfBuild(m.b||PRESETS.gpu);
      const mb= botMode? (plan[side].find(e=>e.owner&&e.owner.id===m.id)||{}).bot : null;
      const sub= botMode? (mb? `내 봇 출전 · 규칙 ${(mb.rules||[]).length}개` : '봇 없음 — 기본 봇이 대신 출전') : `${chn} · ${kind.toUpperCase()}형`;
      const pch= botMode&&mb? (mb.build&&mb.build.ch) : (m.b&&m.b.ch);
      d.innerHTML=`${portrait(pch,side,30)}<div class="nm">${esc(m.name)}${m.id===me.id?' <small style="display:inline">(나)</small>':''}<small>${sub}</small></div>${badge}`; el.appendChild(d); }
    if(solo){ const mine=soloTeam; const cnt= side===mine? 4 : 5;
      for(let i=0;i<cnt;i++){ n++; const d=document.createElement('div'); d.className='slot';
        const bs= side===mine? (i<allyGpu?'gpu':'cpu') : (i%2?'gpu':'cpu');
        d.innerHTML=`${portrait(null,bs,30)}<div class="nm">${side===mine?'아군':'상대'} ${i+1}<small>${bs==='cpu'?'CPU형':'GPU형'} 봇</small></div><span class="badge bot">봇</span>`; el.appendChild(d); }
    } else {
      // 방장이 [+] 로 넣은 봇들 (봇전: 아직 안 나간 방 봇 → 없으면 기본 봇 / 학생 대전: 기본 봇)
      const fills= botMode? plan[side].filter(e=>!e.owner) : Array.from({length:fillOf(side, list.length)},()=>({bot:null}));
      for(const e of fills){ if(n>=5) break; n++; const b=e.bot, d=document.createElement('div'); d.className='slot';
        d.innerHTML= b? `${portrait(b.build&&b.build.ch,side,30)}<div class="nm">${esc(b.name)}<small>규칙 ${(b.rules||[]).length}개</small></div><span class="badge bot">규칙봇</span>`
                      : `${portrait(null,side,30)}<div class="nm">기본 봇<small>게임이 조종하는 봇</small></div><span class="badge bot">봇</span>`;
        if(host&&!playing){ const x=document.createElement('button'); x.className='btn sm'; x.textContent='−'; x.title='이 봇 빼기'; x.style.marginLeft='6px';
          x.onclick=()=>net.send({t:'fill',side,d:-1}); d.appendChild(x); }
        el.appendChild(d); }
      for(;n<5;n++){ const d=document.createElement('div'); d.className='slot empty';
        if(host&&!playing){ const a=document.createElement('button'); a.className='btn sm'; a.textContent='+ 봇 추가'; a.onclick=()=>net.send({t:'fill',side,d:1}); d.appendChild(a); }
        else d.textContent='빈 자리'; el.appendChild(d); }
    }
  }
  // 시작 버튼
  const btn=$('#btnStart'), mine=room.members.find(m=>m.id===me.id);
  { const seg=$('#watchSeg'); const cur= solo? soloTeam : !mine? '' : mine.watch? 'watch' : (t.cpu.some(x=>x.id===me.id)?'cpu':'gpu');
    seg.hidden=!solo&&!mine;
    seg.querySelectorAll('button').forEach(b=>{ b.classList.toggle('on',b.dataset.w===cur); b.disabled=playing; b.hidden= solo&&b.dataset.w==='watch';
      if(b.dataset.w!=='watch'&&!solo){ const n=t[b.dataset.w].length; b.textContent=`${TEAM[b.dataset.w]} ${n}/5`; } });
    const names=[...room.members.filter(m=>m.watch).map(m=>m.name+(m.id===room.host?' (방장)':'')), ...(room.spect||[])];
    const el=$('#watchers'); el.hidden=solo||!names.length; el.innerHTML='<b>관전</b> '+names.map(esc).join(', '); }
  const amSpect=!solo && (!mine || (mine.watch && !host));
  if(amSpect){ btn.textContent='관전 중'; btn.className='btn start'; btn.disabled=true; $('#startHint').textContent='경기가 시작되면 전체 시야로 보입니다. 관전자 '+(room.spect||[]).length+'명'; }
  else
  if(solo){ btn.textContent='경기 시작'; btn.className='btn start'; btn.disabled=false; $('#startHint').textContent='아군 4명과 상대 5명은 봇입니다. 팀 구성은 오른쪽 아래 슬라이더로 바꿉니다. 결과 화면에서 팀을 바꿔 다시 할 수 있습니다.'; }
  else if(host){ const others=room.members.filter(m=>m.id!==me.id), rd=others.filter(m=>m.ready).length;
    btn.textContent= playing?'경기 진행 중':'게임 시작'; btn.className='btn start'; btn.disabled=playing||pendingStart;
    $('#startHint').textContent= others.length? `${rd}/${others.length}명 준비 완료 · 준비가 안 돼도 시작할 수 있습니다` : '학생들이 들어오면 시작하세요. 혼자 시작하면 봇과 합니다.'; }
  else { const r=!!(mine&&mine.ready); btn.textContent= playing?'경기 중…': r?'준비 취소':'준비'; btn.className='btn start'+(r?' on':''); btn.disabled=playing;
    $('#startHint').textContent= playing?'호스트 화면을 받는 중입니다…':'준비를 누르면 방장이 시작할 수 있습니다. 빌드를 바꾸면 준비가 풀립니다.'; }
  // 빌드 잠금 (준비 상태면 못 바꿈)
  const locked= !solo && !host && !!(mine&&mine.ready);
  for(const id of ['bRender','bLane','bClock','bMem']) $('#'+id).disabled=locked;
  $('#buildHint').textContent= locked?'준비를 취소하면 바꿀 수 있습니다':'캐릭터 = 하드웨어 빌드. 팀은 위에서 따로 고르고, 한 팀에 CPU형·GPU형을 섞어도 됩니다';
  labelFor(); renderCharSelect(locked); renderMaps();
}
$('#watchSeg').onclick=(e)=>{ const b=e.target.closest('button'); if(!b||b.disabled) return; const w=b.dataset.w;
  if(room&&room.solo){ soloTeam=w; renderRoom(); return; }
  if(w==='watch') net.send({t:'watch',on:true}); else net.send({t:'team',team:w}); };
$('#btnLeave').onclick=()=>{ if(room&&room.solo){ room=null; showScreen(online?'scrLobby':'scrLogin'); return; } net.send({t:'leave_room'}); };
$('#btnStart').onclick=()=>{
  if(!room) return;
  if(room.solo){ startSolo(soloTeam); return; }
  if(isHost()){ const c=teamCounts(); if(!c.cpu||!c.gpu){ toast('양 팀에 최소 1명(사람 또는 [+] 봇)이 있어야 시작할 수 있습니다'); return; }
    pendingStart=true; renderRoom(); net.send({t:'start'}); }
  else { const mine=room.members.find(m=>m.id===me.id); net.send({t:'ready',on:!(mine&&mine.ready)}); }
};

/* ---------- 빌드 선택 ---------- */
function labelFor(){
  $('#bRenderV').textContent=`${Math.round(SPEC.render.scale[build.render]*100)}% 해상도 · 시야 ${SPEC.render.view[build.render]}`;
  { const P=profile(build); $('#bLaneV').textContent=`${P.lanes}발 동시 · 재장전 ${P.baseReload.toFixed(2)}s · 피해 ${P.dmg} · 탄약 ${P.ammoCost}소모`; }
  $('#bClockV').textContent=`준비 ${SPEC.clock.windup[build.clock].toFixed(2)}s · 이동 ${Math.round(SPEC.clock.move[build.clock]*100)}%`;
  $('#bMemV').textContent=`최대 ${SPEC.mem.maxAmmo[build.mem]}발 · 반경 ${SPEC.mem.pick[build.mem]}`;
  const c=buildCost(build), over=c>BUDGET;
  $('#budgetV').textContent=`${c} / ${BUDGET}`+(over?' — 초과':''); $('#budgetV').style.color=over?'var(--danger)':'';
  const bar=$('#budgetBar'); bar.classList.toggle('over',over); bar.querySelector('i').style.width=Math.min(100,c/BUDGET*100)+'%';
  if(room&&room.solo) $('#btnStart').disabled=over;
  $('#bAllyV').textContent=`${4-allyGpu} / ${allyGpu}`;
  const eq=(a,b)=>a.render===b.render&&a.lane===b.lane&&a.clock===b.clock&&a.mem===b.mem;
  preset = eq(build,PRESETS.cpu)?'cpu': eq(build,PRESETS.gpu)?'gpu':'';
  const side=sideOfBuild(build);
  $('#advBuild').querySelector('summary').textContent= `세부 빌드 조정 — ${CH[build.ch]?CH[build.ch].name:'커스텀'} (${side.toUpperCase()}형 · 예산 ${c}/${BUDGET})`;
}
let pickT=null;
function pushBuild(){ // 서버에 내 빌드 알림 (연타 방지)
  if(!online||!room||room.solo) { renderRoom(); return; }
  renderRoom();
  clearTimeout(pickT); pickT=setTimeout(()=>net.send({t:'pick',b:build}),120);
  ss.set('arena_build', JSON.stringify(build));
}
function setBuild(b){ build={...b}; $('#bRender').value=build.render; $('#bLane').value=build.lane; $('#bClock').value=build.clock; $('#bMem').value=build.mem; labelFor(); pushBuild(); }
['bRender','bLane','bClock','bMem'].forEach(id=>$('#'+id).oninput=()=>{
  build={render:+$('#bRender').value, lane:+$('#bLane').value, clock:+$('#bClock').value, mem:+$('#bMem').value, ch:'custom'}; labelFor(); pushBuild();
});
$('#bAlly').oninput=()=>{ allyGpu=+$('#bAlly').value; labelFor(); renderRoom(); };

/* ---------- 경기 시작 / 종료 ---------- */
function beginGame(label){
  lastEff=null; frame=0; acc=0; paused=false;
  $('#result').hidden=true; $('#roundLabel').textContent=label;
  $('#btnPause').hidden=(netMode==='client');
  $('#hudNet').textContent= netMode==='solo'?'혼자 연습': netMode==='host'?'호스트 (이 화면이 계산)':'접속 (호스트 화면 수신)';
  showScreen('scrGame'); fitCanvas(); draw(); updateHud(); showGameUI(true); view.focus();
  running=true; lastT=performance.now(); requestAnimationFrame(loop);
}
function stopGame(){ running=false; paused=false; showGameUI(false); $('#result').hidden=true; $('#countdown').hidden=true; }
function startSolo(side,opts){
  netMode='solo'; mySide=side; myName=me.name;
  world=makeWorld(build, allyGpu, side);
  if(opts&&opts.bot){ const c=world.chars[0]; c.isPlayer=false; c.rules=myRules.map(r=>({...r})); c.name=myName+' 봇'; }
  else world.chars[0].name=myName;
  assignChars(world);
  beginGame(`${MAPS[curMap].name} · 라운드 ${roundNo} · 내 팀 ${TEAM[side]}`); countdown();
}
function startBotRoomMatch(){   // 봇전 방: 학생마다 자기 봇이 고른 팀으로 출전, 남는 자리는 방·공용 봇, 사람은 모두 관전
  netMode='host'; myName=me.name;
  world=makeWorld(build, -1, 'cpu'); const p0=world.chars[0]; p0.isPlayer=false; p0.name='';
  const plan=planBots(assignSides(room.members)); let seated=0;
  for(const side of ['cpu','gpu']) for(const e of plan[side]) if(e.bot){
    const c=seatBot(world, {...e.bot, name: e.owner? e.owner.name : e.bot.name}, side); if(c){ seated++; c.ch=(e.bot.build&&e.bot.build.ch)||null; } }
  for(const side of ['cpu','gpu']) for(const e of plan[side]) if(e.owner&&!e.bot){
    const c=world.chars.find(x=>x.side===side && !x.rules && !x.ownerLabel); if(c){ c.ownerLabel=1; c.name=e.owner.name+' (봇 없음)'; } }
  const plainFill=s=>plan[s].filter(e=>!e.owner&&!e.bot).length;
  trimWorld(world, {cpu:plainFill('cpu'), gpu:plainFill('gpu')});
  assignChars(world); world.spec=specView(); $('#mystat').hidden=true;
  beginGame(`${room.title} · 봇전 · 규칙봇 ${seated}개 출전 · 전체 관전`);
  broadcastInit(); countdown();
}
function startHostMatch(botsOnly){
  if(room&&room.mode==='bots'){ startBotRoomMatch(); return; }
  netMode='host'; myName=me.name;
  const meM=room.members.find(m=>m.id===me.id), watching=!!(meM&&meM.watch)&&!botsOnly;
  const sides=assignSides(room.members); mySide= sides.gpu.some(x=>x.id===me.id)? 'gpu':'cpu';
  world=makeWorld(build, -1, mySide); world.chars[0].name=myName;
  if(watching){ const c=world.chars[0]; c.isPlayer=false; c.name=''; }   // 내 자리를 비워 학생이 앉을 수 있게
  let people=watching?0:1;
  if(!botsOnly) for(const m of room.members){ if(m.id===me.id||m.watch) continue; const tm= sides.gpu.some(x=>x.id===m.id)?'gpu':'cpu'; const c=seatRemote(world,m.id,m.name,m.b||PRESETS.gpu,tm); if(c){ people++; c.ch=(m.b&&m.b.ch)||null; } }
  if(watching && !world.chars[0].remote) world.chars[0].name=TEAM[world.chars[0].side]+' 봇';
  { const t=assignSides(room.members); trimWorld(world, {cpu:fillOf('cpu', t.cpu.length), gpu:fillOf('gpu', t.gpu.length)}); }
  let seated=0; for(const b of seatedBots()){ const c=seatBot(world,b); if(c){ seated++; c.ch=(b.build&&b.build.ch)||null; } }
  if(botsOnly){ const c=world.chars[0]; c.isPlayer=false; c.rules=myRules.map(r=>({...r})); c.name=myName+' 봇'; }
  assignChars(world);
  if(watching) world.spec=specView();
  $('#mystat').hidden=!!world.spec;
  beginGame(`${room.title} · 사람 ${people}명 · 규칙봇 ${seated}개 · `+(watching?'선생님 관전':`내 팀 ${TEAM[mySide]}`));
  broadcastInit(); countdown();
}
function specView(){ return { x:WORLD_W/2, y:WORLD_H/2, alive:false, isPlayer:false, side:'cpu', hp:0, lives:0, ammo:0, cd:0, windup:0, kills:0, hits:0, out:false, prof:{...profile(PRESETS.gpu), renderScale:1, view:9999, drawEvery:1, fan:0} }; }
function assignChars(w){ for(const c of w.chars){ if(c.isPlayer) c.ch=CH[build.ch]?build.ch:null; else if(!c.ch||!CH[c.ch]) c.ch=randCh(c.prof.kind); } }
function broadcastInit(){
  if(netMode!=='host'||!world) return;
  net.send({t:'init', map:curMap, slots: world.chars.map(c=>({s:c.side, n:c.name||'봇', r:c.remote||0, l:c.prof.lanes, b:(c.isBotAI||c.rules)?1:0, ch:c.ch||'', bb:(c.remote||c.away)?c.prof.build:null})) });
}
function snapshot(w){
  return { t:'s', tt:+w.t.toFixed(2), sc:[w.score.cpu,w.score.gpu], ov:w.over?1:0,
    wn:w.winner||'', c:w.chars.map(c=>[Math.round(c.x),Math.round(c.y),c.hp,c.alive?1:0,+(c.isPlayer?input.aim:(c.windup>0?c.windDir:c.aim)).toFixed(2),+c.windup.toFixed(2),c.ammo,c.kills,c.hits,c.lives,c.out?1:0]),
    b:w.balls.map(b=>[Math.round(b.x),Math.round(b.y),Math.round(b.vx),Math.round(b.vy),(b.side==='cpu'?0:1)+((b.dmg||1)>2?2:0)]),
    a:w.ammo.map(a=>[Math.round(a.x),Math.round(a.y)]),
    f:w.hitFx.map(f=>[Math.round(f.x),Math.round(f.y),f.side==='cpu'?0:1,+f.t.toFixed(2)]),
    fd:w.feed.map(k=>[k.a,k.b,k.side==='cpu'?0:1,k.out?1:0]) };
}
function applyInit(m){
  netMode='client'; SFX.go(); if(m.map) setMap(m.map);
  const mySlot=m.slots.find(s=>s.r===me.id);
  if(mySlot&&mySlot.bb){ build={...mySlot.bb}; labelFor(); }   // 재접속 시 원래 빌드로
  const mine=profile(build);
  const chars=m.slots.map((s,i)=>{
    const pr = s.r===me.id? mine : profile(s.l>=8?PRESETS.gpu:PRESETS.cpu);
    const c=newChar(i, s.s, pr, spawnPos(s.s,i%5)); c.name=s.n; c.remote=s.r; if(s.b) c.isBotAI=true; c.ch=CH[s.ch]?s.ch:null; return c;
  });
  let idx=chars.findIndex(c=>c.remote===me.id);
  const spectating = idx<0;
  if(spectating){ idx=0; }
  else { chars[idx].isPlayer=true; chars[idx].prof=mine; }
  mySide=chars[idx].side;
  teamProf={cpu:profile(PRESETS.cpu), gpu:profile(PRESETS.gpu)};
  world={ t:0, map:curMap, meIdx:idx, chars, balls:[], ammo:[], score:{cpu:0,gpu:0}, over:false, winner:null, ammoTimer:0, hitFx:[], feed:[] };
  if(spectating){ world.spec=specView(); }
  $('#mystat').hidden=spectating; $('#deadOv').hidden=true;
  beginGame(spectating? `${room?room.title:'대전'} · 관전 (전체 시야)` : `${room?room.title:'대전'} · 내 팀 ${TEAM[mySide]}`);
}
function applySnapshot(m){
  if(!world) return;
  world.t=m.tt; world.score.cpu=m.sc[0]; world.score.gpu=m.sc[1]; world.winner=m.wn||null;
  m.c.forEach((a,i)=>{ const c=world.chars[i]; if(!c) return;
    const wasAlive=c.alive;
    c.tx=a[0]; c.ty=a[1]; c.hp=a[2]; c.alive=!!a[3]; if(!c.isPlayer) c.windDir=a[4]; c.windup=a[5]; c.ammo=a[6]; c.kills=a[7]; c.hits=a[8]; c.lives=a[9]; c.out=!!a[10];
    if(c.x===undefined||c.tx===null) { c.x=a[0]; c.y=a[1]; }
    if(!c.isPlayer && Math.hypot(c.tx-c.x,c.ty-c.y)>140){ c.x=c.tx; c.y=c.ty; }
    if(c.isPlayer && !c.alive && wasAlive){ c.respawn=3; }
    if(c.isPlayer && !c.alive && c.respawn>0) c.respawn-=1/22;
  });
  world.balls=m.b.map(b=>({x:b[0],y:b[1],vx:b[2],vy:b[3],side:(b[4]&1)?'gpu':'cpu',dmg:(b[4]&2)?3:2,life:1}));
  world.ammo=m.a.map(a=>({x:a[0],y:a[1]}));
  world.hitFx=m.f.map(f=>({x:f[0],y:f[1],side:f[2]?'gpu':'cpu',t:f[3]}));
  if(m.fd) world.feed=m.fd.map(k=>({a:k[0],b:k[1],side:k[2]?'gpu':'cpu',out:!!k[3],t:3}));
  if(m.ov && running){ running=false; showGameUI(false); }
}
function clientStep(dt){
  if(world.spec){ for(const c of world.chars){ if(c.tx==null) continue; const k=Math.min(1,dt*14); c.x+=(c.tx-c.x)*k; c.y+=(c.ty-c.y)*k; } for(const b of world.balls){ b.x+=b.vx*dt; b.y+=b.vy*dt; } for(const f of world.hitFx) f.t-=dt; world.t+=dt; return; }
  const me0=myChar(); readKeys();
  if(me0&&me0.alive){
    const sprint=input.sprint&&me0.ammo>0?1.45:1;
    const len=Math.hypot(input.mx,input.my)||1, spd=140*me0.prof.moveMul*sprint*(me0.windup>0?0.55:1);
    const nx=me0.x+input.mx/len*spd*dt, ny=me0.y+input.my/len*spd*dt;
    if(input.mx||input.my){ if(!blocked(nx,me0.y,13)) me0.x=nx; if(!blocked(me0.x,ny,13)) me0.y=ny; }
    if(me0.tx!=null){ const k=Math.min(1,dt*2.5); me0.x+=(me0.tx-me0.x)*k; me0.y+=(me0.ty-me0.y)*k; }
  } else if(me0&&me0.tx!=null){ me0.x=me0.tx; me0.y=me0.ty; }
  for(const c of world.chars){ if(c===me0||c.tx==null) continue; const k=Math.min(1,dt*14); c.x+=(c.tx-c.x)*k; c.y+=(c.ty-c.y)*k; }
  for(const b of world.balls){ b.x+=b.vx*dt; b.y+=b.vy*dt; }
  for(const f of world.hitFx) f.t-=dt;
  world.t+=dt;
  const now=performance.now();
  if(now-net.lastSend>50){ net.lastSend=now; net.send({t:'in',mx:input.mx,my:input.my,aim:+input.aim.toFixed(3),sp:input.sprint?1:0}); }
}
