<script>
/* ==========================================================================
   GPU 아레나 — 하드웨어 선택이 게임플레이가 되는 5대5 눈싸움
   · 로직(stepWorld)과 렌더(draw)가 분리되어 있고,
   · 네트워크는 "호스트 브라우저 권위 + 파이썬 릴레이" 구조입니다.
     규칙 계산은 호스트 한 곳에서만 하므로 규칙을 바꿀 때 이 파일만 고치면 됩니다.
   ========================================================================== */
const $=s=>document.querySelector(s);
const WORLD_W=960, WORLD_H=600, ROUND_TIME=90;

/* ==ENGINE-START==  (이 구간은 DOM을 쓰지 않습니다. sim.js 가 그대로 떼어 씁니다) */
/* ---------- 하드웨어 스펙 ---------- */
const LANES=[1,2,4,8,16];
const SPEC={
  render:{ scale:[0,0.14,0.22,0.36,0.62,1.0], view:[0,190,240,310,400,520], drawEvery:[0,3,3,2,1,1], cost:[0,4,9,16,26,37] },
  lane:{ cost:[3,8,16,28,44] },
  clock:{ windup:[0,.45,.38,.29,.19,.11], move:[0,.86,.93,1.0,1.08,1.18], cost:[0,3,8,15,24,35] },
  mem:{ maxAmmo:[0,12,14,18,26,36], pick:[0,22,26,32,40,50], cost:[0,2,6,11,18,26] },
};
const BUDGET=90;
const MAX_HP=6, MAX_LIVES=3;
const TEAM={cpu:'A팀', gpu:'B팀'};   // 화면에 보이는 팀 이름 (내부 값은 cpu/gpu)
const PRESETS={ cpu:{render:3,lane:0,clock:5,mem:5}, gpu:{render:4,lane:4,clock:2,mem:3} };
function buildCost(b){ return SPEC.render.cost[b.render]+SPEC.lane.cost[b.lane]+SPEC.clock.cost[b.clock]+SPEC.mem.cost[b.mem]; }
function profile(b){
  const lanes=LANES[b.lane];
  return { build:{...b}, lanes,
    renderScale:SPEC.render.scale[b.render], view:SPEC.render.view[b.render], drawEvery:SPEC.render.drawEvery[b.render],
    windup:SPEC.clock.windup[b.clock], moveMul:SPEC.clock.move[b.clock],
    maxAmmo:SPEC.mem.maxAmmo[b.mem], pickR:SPEC.mem.pick[b.mem],
    ammoCost: lanes<=2?1: lanes<=4?2: lanes<=8?4:6,
    targetsWanted: lanes<=1?1: lanes<=4?2: lanes<=8?3:4,
    fan: lanes===1?0.03: lanes===2?0.025: 0.15+0.045*Math.log2(lanes),
    baseReload:[0.18,0.24,0.38,1.15,1.85][b.lane], dmg: lanes<=2?3:2, assist: lanes===1?0.085: lanes===2?0.025:0,
    kind: lanes>=8?'gpu':'cpu' };
}
function sideOfBuild(b){ return LANES[b.lane]>=8?'gpu':'cpu'; }

/* ---------- 맵 ---------- */
const MAPS={
  snow:  { name:'눈밭',     tip:'기본. 벽과 통로가 반반',             obst:[
    {x:130,y:0,w:26,h:170},{x:130,y:430,w:26,h:170},{x:804,y:0,w:26,h:170},{x:804,y:430,w:26,h:170},
    {x:250,y:120,w:150,h:26},{x:560,y:454,w:150,h:26},{x:250,y:454,w:150,h:26},{x:560,y:120,w:150,h:26},
    {x:452,y:230,w:56,h:140},{x:0,y:288,w:120,h:24},{x:840,y:288,w:120,h:24} ] },
  canyon:{ name:'얼음 협곡', tip:'좁은 통로 셋. 부채꼴이 벽에 막힌다 → CPU 유리', obst:[
    {x:150,y:0,w:24,h:120},{x:150,y:480,w:24,h:120},{x:786,y:0,w:24,h:120},{x:786,y:480,w:24,h:120},
    {x:200,y:170,w:230,h:24},{x:530,y:170,w:230,h:24},{x:200,y:406,w:230,h:24},{x:530,y:406,w:230,h:24},
    {x:300,y:60,w:24,h:60},{x:636,y:60,w:24,h:60},{x:300,y:480,w:24,h:60},{x:636,y:480,w:24,h:60},
    {x:380,y:260,w:200,h:24},{x:380,y:316,w:200,h:24},{x:460,y:284,w:40,h:32} ] },
  plaza: { name:'광장',     tip:'탁 트인 설원. 숨을 곳이 없다 → GPU 유리', obst:[
    {x:220,y:90,w:40,h:40},{x:700,y:90,w:40,h:40},{x:220,y:470,w:40,h:40},{x:700,y:470,w:40,h:40},
    {x:456,y:276,w:48,h:48} ] },
};
let curMap='snow';
let OBST=MAPS.snow.obst;
function setMap(id){ if(!MAPS[id]) id='snow'; curMap=id; OBST=MAPS[id].obst; return id; }
function rectHit(x,y,r,o){ const cx=Math.max(o.x,Math.min(x,o.x+o.w)), cy=Math.max(o.y,Math.min(y,o.y+o.h)); const dx=x-cx,dy=y-cy; return dx*dx+dy*dy<r*r; }
function blocked(x,y,r){ if(x<r||y<r||x>WORLD_W-r||y>WORLD_H-r) return true; for(const o of OBST) if(rectHit(x,y,r,o)) return true; return false; }
function lineBlocked(x1,y1,x2,y2){ for(let i=1;i<10;i++){ const t=i/10; if(blocked(x1+(x2-x1)*t,y1+(y2-y1)*t,4)) return true; } return false; }

/* ---------- 상태 ---------- */
let world=null, teamProf={}, myName='', roundNo=1, mySide='gpu';
let netMode='solo';           // solo | host | client
let build={...PRESETS.gpu}, allyGpu=2, preset='gpu';
let lastEff=null;

function myChar(){ return world? world.chars[world.meIdx] : null; }
function viewChar(){ if(!world) return null; if(world.spec) return world.spec; const me=world.chars[world.meIdx]; return (me&&me.out&&world.spectateIdx!=null)? world.chars[world.spectateIdx] : me; }
function spawnPos(side,i){ return { x: side==='cpu'? 60+(i%2)*34 : WORLD_W-60-(i%2)*34, y: 96+i*84 }; }
function newChar(id, side, prof, s, isPlayer){
  return {id, side, prof, isPlayer:!!isPlayer, remote:0, name:'', x:s.x, y:s.y, tx:null, ty:null,
    hp:MAX_HP, lives:MAX_LIVES, out:false, ammo:prof.maxAmmo, aim:0, cd:0, windup:0, windDir:0, alive:true, respawn:0,
    throws:0, hits:0, kills:0, deaths:0, lanesFired:0, lanesHit:0, reloadSum:0, effSum:0, effN:0,
    home:s, wander:Math.random()*6.28, bx:0, by:0, rin:null };
}
/* 항상 5대5. 사람이 안 채운 자리는 봇. */
/* side = 팀 (cpu 자리 = A팀, gpu 자리 = B팀). 팀과 캐릭터 종류(CPU형/GPU형)는 따로 정한다.
   allyGpuCount: 내 팀 봇 4명 중 GPU형 수. 음수면 섞어서(GPU·CPU 번갈아). 상대 팀 봇은 항상 CPU 3 · GPU 2로 섞는다. */
function makeWorld(myBuild, allyGpuCount, side){
  const mine=profile(myBuild), enemySide= side==='cpu'?'gpu':'cpu';
  teamProf={ cpu:profile(PRESETS.cpu), gpu:profile(PRESETS.gpu) };   // 종류별 기준값 (결과표용)
  const chars=[]; let id=0;
  const me0=newChar(id++, side, mine, spawnPos(side,2), true); me0.name='나'; chars.push(me0);
  for(let i=0;i<4;i++){ const gpuAlly= allyGpuCount<0? i%2===0 : i<allyGpuCount; const pr=profile(gpuAlly?PRESETS.gpu:PRESETS.cpu);
    const c=newChar(id++, side, pr, spawnPos(side, i<2?i:i+1)); c.name=TEAM[side]+' 봇'+(i+1); chars.push(c); }
  for(let i=0;i<5;i++){ const pr=profile(i%2? PRESETS.gpu : PRESETS.cpu); const c=newChar(id++, enemySide, pr, spawnPos(enemySide,i)); c.name=TEAM[enemySide]+' 봇'+(i+1); chars.push(c); }
  return { t:0, map:curMap, meIdx:0, chars, balls:[], ammo:[], score:{cpu:0,gpu:0}, over:false, winner:null, ammoTimer:0, hitFx:[], feed:[] };
}
/* 규칙표 봇을 빈 자리에 앉히기 */
// 규칙봇 JSON 의 "team": "A"|"B" (A팀|B팀 도 됨) → 그 팀에 앉힌다. 없으면 빈자리 많은 팀
function botTeam(bot){ const t=String((bot&&bot.team)||'').trim().toUpperCase(); return /^(A|A팀|CPU)$/.test(t)? 'cpu' : /^(B|B팀|GPU)$/.test(t)? 'gpu' : null; }
function seatBot(w, bot, team){
  team = team || botTeam(bot);
  const b = typeof bot.build==='string'? PRESETS[bot.build]||PRESETS.gpu : (bot.build||PRESETS.gpu);
  const pr=profile(b);
  const free=s=>w.chars.filter(c=>c.side===s && !c.isPlayer && !c.remote && !c.rules).length;
  const side= team || (free('cpu')>=free('gpu')? 'cpu':'gpu');          // 팀을 안 정했으면 빈자리 많은 팀으로
  let slot=w.chars.find(c=>c.side===side && !c.isPlayer && !c.remote && !c.rules);
  if(!slot) slot=w.chars.find(c=>!c.isPlayer && !c.remote && !c.rules);
  if(!slot) return null;
  slot.prof=pr; slot.ammo=pr.maxAmmo; slot.name=bot.name||'봇'; slot.rules=bot.rules||[]; slot.isBotAI=true;
  return slot;
}
function seatRemote(w, cid, name, b, team){
  const pr=profile(b), side= team || sideOfBuild(b);
  let slot=w.chars.find(c=>c.side===side && !c.isPlayer && !c.remote);
  if(!slot) slot=w.chars.find(c=>!c.isPlayer && !c.remote);
  if(!slot) return null;
  slot.remote=cid; slot.name=name; slot.prof=pr; slot.side=slot.side; slot.ammo=pr.maxAmmo;
  slot.rin={mx:0,my:0,aim:0};
  return slot;
}
function spawnAmmoCluster(w){
  for(let k=0;k<40;k++){
    const x=90+Math.random()*(WORLD_W-180), y=70+Math.random()*(WORLD_H-140);
    if(blocked(x,y,26)) continue;
    for(let j=0;j<4;j++){ const a=j*1.57+Math.random(); w.ammo.push({x:x+Math.cos(a)*16,y:y+Math.sin(a)*16}); }
    return;
  }
}

/* 봇 길찾기: 가려는 방향이 막혀 있으면 좌우로 꺾어 돌아간다. 같은 쪽으로 계속 돌아야 벽을 타고 넘는다. */
function steer(c,ax,ay,dt){
  const a=Math.atan2(ay,ax), L=28;
  if(c.steerT>0) c.steerT-=dt; else c.steerSide=Math.random()<0.5?1:-1;
  const sd=c.steerSide||1;
  for(const o of [0, sd*0.5, sd*1.0, sd*1.5, -sd*0.5, -sd*1.0, -sd*1.5, sd*2.2, Math.PI]){
    const b=a+o; if(!blocked(c.x+Math.cos(b)*L, c.y+Math.sin(b)*L, 14)){ if(o!==0) c.steerT=0.8; return [Math.cos(b),Math.sin(b)]; }
  }
  return [ax,ay];
}
/* 맵 중앙 근처에서 벽이 아닌 지점 (중앙이동 목표) */
function centerPoint(){
  for(let r=0;r<260;r+=12) for(let k=0;k<16;k++){ const x=WORLD_W/2+Math.cos(k/16*6.283)*r, y=WORLD_H/2+Math.sin(k/16*6.283)*r; if(!blocked(x,y,18)) return {x,y}; }
  return {x:WORLD_W/2,y:WORLD_H/2};
}

/* ---------- 로직 ---------- */
function stepWorld(w, dt){
  if(w.over) return;
  w.t+=dt; if(w.t>=ROUND_TIME){ w.over=true; if(!w.winner){ const L=s=>w.chars.filter(x=>x.side===s).reduce((a,x)=>a+x.lives,0);
    w.winner = L('cpu')>L('gpu')?'cpu': L('gpu')>L('cpu')?'gpu': (w.score.cpu>w.score.gpu?'cpu': w.score.gpu>w.score.cpu?'gpu':null); } }
  w.ammoTimer-=dt; if(w.ammoTimer<=0){ w.ammoTimer=2.2; if(w.ammo.length<40) spawnAmmoCluster(w); }
  for(const c of w.chars){
    if(!c.alive){ if(c.out) continue; c.respawn-=dt; if(c.respawn<=0){ c.alive=true; c.hp=MAX_HP; c.x=c.home.x; c.y=c.home.y; c.ammo=Math.max(4,Math.floor(c.prof.maxAmmo*0.6)); c.cd=0; c.windup=0; } continue; }
    if(c.cd>0) c.cd-=dt;
    let ax=0, ay=0, sprint=1;
    if(c.isPlayer){ ax=input.mx; ay=input.my; c.aim=input.aim; if(input.sprint&&c.ammo>0) sprint=1.45; }
    else if(c.remote){ const r=c.rin||{}; ax=r.mx||0; ay=r.my||0; c.aim=r.aim||0; if(r.sp&&c.ammo>0) sprint=1.45; }
    else { botThink(w,c,dt); ax=c.bx; ay=c.by; }
    if(sprint>1 && Math.random()<dt*3) c.ammo=Math.max(0,c.ammo-1);
    if(!c.isPlayer && !c.remote && (ax||ay)){ const s=steer(c,ax,ay,dt); ax=s[0]; ay=s[1]; }
    const len=Math.hypot(ax,ay)||1, spd=140*c.prof.moveMul*sprint*(c.windup>0?0.55:1);
    const nx=c.x+ax/len*spd*dt, ny=c.y+ay/len*spd*dt;
    if(!blocked(nx,c.y,13)) c.x=nx;
    if(!blocked(c.x,ny,13)) c.y=ny;
    for(let i=w.ammo.length-1;i>=0;i--){ const a=w.ammo[i]; if(Math.hypot(a.x-c.x,a.y-c.y)<c.prof.pickR && c.ammo<c.prof.maxAmmo){ c.ammo++; w.ammo.splice(i,1); } }
    if(c.windup>0){ c.windup-=dt; if(c.windup<=0) release(w,c); }
  }
  for(let i=w.balls.length-1;i>=0;i--){
    const b=w.balls[i]; b.x+=b.vx*dt; b.y+=b.vy*dt; b.life-=dt;
    if(b.life<=0||blocked(b.x,b.y,4)){ w.balls.splice(i,1); continue; }
    for(const c of w.chars){
      if(!c.alive||c.side===b.side) continue;
      if(Math.hypot(c.x-b.x,c.y-b.y)<15){
        const src=w.chars[b.src]; if(src){ src.hits++; src.lanesHit++; }
        c.hp-=b.dmg||1; w.hitFx.push({x:b.x,y:b.y,t:0.25,side:b.side});
        if(c.hp<=0){ c.alive=false; c.respawn=3; c.deaths++; c.lives--; if(c.lives<=0){ c.lives=0; c.out=true; }
          if(src) src.kills++; w.score[b.side]++;
          w.feed.push({a: src? (src.name||'봇') : '?', b: c.name||'봇', side:b.side, t:3, out:c.out}); if(w.feed.length>6) w.feed.shift();
          for(const sd of ['cpu','gpu']) if(!w.chars.some(x=>x.side===sd && !x.out)){ w.over=true; w.winner = sd==='cpu'?'gpu':'cpu'; }
        }
        w.balls.splice(i,1); break;
      }
    }
  }
  for(let i=w.hitFx.length-1;i>=0;i--){ w.hitFx[i].t-=dt; if(w.hitFx[i].t<=0) w.hitFx.splice(i,1); }
  for(let i=w.feed.length-1;i>=0;i--){ w.feed[i].t-=dt; if(w.feed[i].t<=0) w.feed.splice(i,1); }
}
function tryThrow(w,c,dir){
  if(!c||!c.alive||c.cd>0||c.windup>0) return false;
  if(c.ammo<c.prof.ammoCost){ if(c===myChar() && c.isPlayer) toast('탄약 부족 — 눈 뭉치를 주우세요'); return false; }
  c.windDir=dir; c.windup=Math.max(0.001,c.prof.windup); return true;
}
function release(w,c){
  const P=c.prof; c.ammo-=P.ammoCost;
  let dir=c.windDir;
  if(P.assist){ let bd=1e9, ba=null;
    for(const e of w.chars){ if(!e.alive||e.side===c.side) continue; const d=Math.hypot(e.x-c.x,e.y-c.y); if(d>420) continue;
      let da=Math.atan2(e.y-c.y,e.x-c.x)-dir; while(da>Math.PI)da-=6.283; while(da<-Math.PI)da+=6.283;
      if(Math.abs(da)<P.assist*4 && d<bd && !lineBlocked(c.x,c.y,e.x,e.y)){ bd=d; ba=da; } }
    if(ba!==null) dir+=Math.max(-P.assist,Math.min(P.assist,ba)); }
  let covered=0;
  for(const e of w.chars){ if(!e.alive||e.side===c.side) continue;
    const d=Math.hypot(e.x-c.x,e.y-c.y); if(d>420) continue;
    let da=Math.atan2(e.y-c.y,e.x-c.x)-dir; while(da>Math.PI)da-=6.283; while(da<-Math.PI)da+=6.283;
    if(Math.abs(da)<=P.fan+0.06 && !lineBlocked(c.x,c.y,e.x,e.y)) covered++;
  }
  const eff=Math.min(1,covered/P.targetsWanted);
  const reload=P.baseReload*(1+(P.lanes>2?0.85:0.15)*(1-eff));
  c.cd=reload; c.throws++; c.lanesFired+=P.lanes; c.reloadSum+=reload; c.effSum+=eff; c.effN++;
  if(c===myChar()) lastEff={eff,reload,covered,lanes:P.lanes};
  for(let k=0;k<P.lanes;k++){
    const t=P.lanes===1?0:(k/(P.lanes-1)-0.5)*2;
    const a=dir+t*P.fan+(Math.random()-0.5)*0.012, sp=430+Math.random()*30;
    w.balls.push({x:c.x+Math.cos(dir)*16, y:c.y+Math.sin(dir)*16, vx:Math.cos(a)*sp, vy:Math.sin(a)*sp, life:1.05, side:c.side, src:c.id, dmg:P.dmg});
  }
}
/* ---------- 규칙표(Rule Table) ---------- */
/* 학생이 한국어로 쓴 전략 → (에이전트가) 아래 형태의 규칙표로 변환 → 엔진이 매 틱 실행 */
const RULE_VARS={
  '체력':'hp','hp':'hp', '탄약':'ammo','ammo':'ammo',
  '적거리':'dist','dist':'dist', '부채꼴적':'cone','cone':'cone',
  '보이는적':'enemies','enemies':'enemies', '아군':'allies','allies':'allies',
  '재장전':'reload','reload':'reload', '시간':'time','time':'time',
  '아군거리':'allyDist','allyDist':'allyDist', '적체력':'enemyHp','enemyHp':'enemyHp',
  '목숨':'lives','lives':'lives', '남은시간':'left','left':'left', '내처치':'kills','kills':'kills',
};
const RULE_ACTS=new Set(['접근','후퇴','거리유지','탄약수집','던지기','좌우회피','대기','중앙이동','아군따라가기','엄폐','순찰']);
const RULE_OPS=['<=','>=','==','!=','<','>'];
function parseTerm(s){
  const m=String(s).trim().match(/^([^\s<>=!]+)\s*(<=|>=|==|!=|<|>)\s*(-?\d+(?:\.\d+)?)$/);
  if(!m) return null; const v=RULE_VARS[m[1]]; if(!v) return null; return {v, op:m[2], n:Number(m[3])};
}
/* "탄약 < 5", "always", "체력 <= 2 그리고 적거리 < 200", "A 또는 B" (and/or 혼용 불가) */
function parseCond(str){
  if(!str || /^(always|항상|기본)$/i.test(String(str).trim())) return {always:true};
  const s=String(str).trim();
  const isOr=/\s(or|또는)\s|\|\|/i.test(s), isAnd=/\s(and|그리고)\s|&&|,/i.test(s);
  if(isOr&&isAnd) return null;
  const parts=s.split(isOr? /\s+(?:or|또는)\s+|\s*\|\|\s*/i : /\s+(?:and|그리고)\s+|\s*&&\s*|\s*,\s*/i).filter(Boolean);
  if(parts.length===1) return parseTerm(parts[0]);
  const terms=parts.map(parseTerm); if(terms.some(t=>!t)) return null;
  return isOr? {or:terms} : {and:terms};
}
function testTerm(t,S){ const a=S[t.v], n=t.n; return t.op==='<'? a<n : t.op==='>'? a>n : t.op==='<='? a<=n : t.op==='>='? a>=n : t.op==='=='? a===n : a!==n; }
function testCond(c,S){ if(c.always) return true; if(c.and) return c.and.every(t=>testTerm(t,S)); if(c.or) return c.or.some(t=>testTerm(t,S)); return testTerm(c,S); }
function ruleSense(w,c){
  /* 부채꼴 안 적 = "가장 가까운 적을 조준했을 때" 부채꼴에 함께 들어오는 적 수 */
  let best=null,bd=1e9,seen=0,cone=0,allies=0,ally=null,ad=1e9;
  const live=[];
  for(const e of w.chars){
    if(!e.alive) continue;
    if(e.side===c.side){ if(e!==c){ allies++; const d=Math.hypot(e.x-c.x,e.y-c.y); if(d<ad){ad=d;ally=e;} } continue; }
    const d=Math.hypot(e.x-c.x,e.y-c.y);
    if(d<bd){ bd=d; best=e; }
    if(d<420 && !lineBlocked(c.x,c.y,e.x,e.y)){ seen++; live.push(e); }
  }
  if(best){
    const dir=Math.atan2(best.y-c.y,best.x-c.x), fan=c.prof.fan+0.06;
    for(const e of live){ let da=Math.atan2(e.y-c.y,e.x-c.x)-dir; while(da>Math.PI)da-=6.283; while(da<-Math.PI)da+=6.283;
      if(Math.abs(da)<=fan) cone++; }
  }
  return {best, ally, S:{hp:c.hp, ammo:c.ammo, dist: best? Math.round(bd):999, cone, enemies:seen, allies, reload: c.cd>0?1:0, time:Math.round(w.t),
    allyDist: ally? Math.round(ad):999, enemyHp: best? best.hp:0, lives:c.lives, left:Math.max(0,Math.round(ROUND_TIME-w.t)), kills:c.kills}};
}
function ruleThink(w,c,dt){
  const {best,ally,S}=ruleSense(w,c);
  c.sense=S;
  let moved=false;
  const aimAt=(t)=>{ const lead=c.prof.kind==='gpu'?0.10:0.16;
    return Math.atan2(t.y+(t.by||0)*lead*90-c.y, t.x+(t.bx||0)*lead*90-c.x)+(Math.random()-0.5)*0.05; };
  const nearestAmmo=()=>{ let a=null,ad=1e9; for(const q of w.ammo){ const d=Math.hypot(q.x-c.x,q.y-c.y); if(d<ad){ad=d;a=q;} } return a; };
  c.wander+=dt*1.6;
  for(const r of (c.rules||[])){
    const cond=r._c || (r._c=parseCond(r.when));
    if(!cond) continue;
    if(!testCond(cond,S)) continue;
    const act=r.do;
    if(act==='던지기'){
      if(best && bdOK(w,c,best)) { c.windDir=aimAt(best); tryThrow(w,c,c.windDir); }
      continue;                       // 던지기는 이동을 막지 않는다
    }
    if(moved) continue;
    if(act==='접근' && best){ const d=Math.hypot(best.x-c.x,best.y-c.y)||1; c.bx=(best.x-c.x)/d; c.by=(best.y-c.y)/d; moved=true; }
    else if(act==='후퇴' && best){ const d=Math.hypot(best.x-c.x,best.y-c.y)||1; c.bx=-(best.x-c.x)/d; c.by=-(best.y-c.y)/d; moved=true; }
    else if(act==='거리유지' && best){ const want=Number(r.value)||250, d=Math.hypot(best.x-c.x,best.y-c.y)||1, push=(d-want)/Math.max(60,want);
      c.bx=(best.x-c.x)/d*push+Math.cos(c.wander)*0.5; c.by=(best.y-c.y)/d*push+Math.sin(c.wander)*0.5; moved=true; }
    else if(act==='탄약수집'){ const a=nearestAmmo(); if(a){ c.bx=a.x-c.x; c.by=a.y-c.y; moved=true; } }
    else if(act==='좌우회피' && best){ const d=Math.hypot(best.x-c.x,best.y-c.y)||1; c.bx=-(best.y-c.y)/d*Math.sign(Math.sin(c.wander)); c.by=(best.x-c.x)/d*Math.sign(Math.sin(c.wander)); moved=true; }
    else if(act==='중앙이동'){ const cp=centerPoint(); c.bx=cp.x-c.x; c.by=cp.y-c.y; if(Math.hypot(c.bx,c.by)<12){ c.bx=0; c.by=0; } moved=true; }
    else if(act==='대기'){ c.bx=0; c.by=0; moved=true; }
    else if(act==='아군따라가기'){ if(ally){ const d=Math.hypot(ally.x-c.x,ally.y-c.y)||1, push=(d-70)/70; c.bx=(ally.x-c.x)/d*push; c.by=(ally.y-c.y)/d*push; } else { const cp=centerPoint(); c.bx=cp.x-c.x; c.by=cp.y-c.y; } moved=true; }
    else if(act==='엄폐' && best){ // 적과 나 사이에 벽이 오도록, 가장 가까운 벽 뒤로
      let bo=null,bdist=1e9; for(const o of OBST){ const ox=o.x+o.w/2, oy=o.y+o.h/2, d=Math.hypot(ox-c.x,oy-c.y); if(d<bdist){bdist=d;bo=o;} }
      if(bo){ const ox=bo.x+bo.w/2, oy=bo.y+bo.h/2, ex=ox-best.x, ey=oy-best.y, el=Math.hypot(ex,ey)||1, tx=ox+ex/el*(Math.max(bo.w,bo.h)/2+24), ty=oy+ey/el*(Math.max(bo.w,bo.h)/2+24);
        c.bx=tx-c.x; c.by=ty-c.y; if(Math.hypot(c.bx,c.by)<10){ c.bx=0; c.by=0; } moved=true; } }
    else if(act==='순찰'){ c.bx=Math.cos(c.wander*0.7); c.by=Math.sin(c.wander*0.7); moved=true; }
  }
  if(!moved){ if(best){ const d=Math.hypot(best.x-c.x,best.y-c.y)||1, want=c.prof.kind==='gpu'?300:150, push=(d-want)/Math.max(60,want);
      c.bx=(best.x-c.x)/d*push+Math.cos(c.wander)*0.5; c.by=(best.y-c.y)/d*push+Math.sin(c.wander)*0.5; }
    else { c.bx=Math.cos(c.wander); c.by=Math.sin(c.wander); } }
}
function bdOK(w,c,t){ return Math.hypot(t.x-c.x,t.y-c.y)<430 && !lineBlocked(c.x,c.y,t.x,t.y); }

function botThink(w,c,dt){
  if(c.rules && c.rules.length) return ruleThink(w,c,dt);
  let best=null,bd=1e9;
  for(const e of w.chars){ if(!e.alive||e.side===c.side) continue; const d=Math.hypot(e.x-c.x,e.y-c.y); if(d<bd){bd=d;best=e;} }
  if(c.ammo<c.prof.ammoCost*2 && w.ammo.length){
    let a=null,ad=1e9; for(const q of w.ammo){ const d=Math.hypot(q.x-c.x,q.y-c.y); if(d<ad){ad=d;a=q;} }
    if(a){ c.bx=a.x-c.x; c.by=a.y-c.y; return; }
  }
  if(!best){ c.wander+=dt; c.bx=Math.cos(c.wander); c.by=Math.sin(c.wander); return; }
  const want=c.prof.kind==='gpu'?300:150, d=bd||1, push=(d-want)/Math.max(60,want);
  c.wander+=dt*1.6;
  c.bx=(best.x-c.x)/d*push+Math.cos(c.wander)*0.55;
  c.by=(best.y-c.y)/d*push+Math.sin(c.wander)*0.55;
  if(d<430 && !lineBlocked(c.x,c.y,best.x,best.y)){
    const lead=c.prof.kind==='gpu'?0.10:0.16;
    const dir=Math.atan2(best.y+(best.by||0)*lead*90-c.y, best.x+(best.bx||0)*lead*90-c.x)+(Math.random()-0.5)*(c.prof.kind==='gpu'?0.05:0.09);
    tryThrow(w,c,dir);
  }
}

/* ---------- 결과표 (브라우저 방장 · host.js 공용) ----------
   팀 승패는 A팀/B팀으로, 하드웨어 비교는 팀과 상관없이 CPU형/GPU형 1인당 평균으로 낸다. */
function kindStats(w,kind){
  const cs=w.chars.filter(c=>c.prof.kind===kind), n=cs.length||1, T=Math.max(1,Math.min(w.t,ROUND_TIME));
  const s={kills:0,throws:0,hits:0,lanesFired:0,lanesHit:0,reloadSum:0,effSum:0,effN:0,windup:0,px:0,view:0};
  for(const c of cs){ for(const k of ['kills','throws','hits','lanesFired','lanesHit','reloadSum','effSum','effN']) s[k]+=c[k]||0;
    s.windup+=c.prof.windup; s.px+=WORLD_W*WORLD_H*c.prof.renderScale*c.prof.renderScale/1000; s.view+=c.prof.view; }
  return { n:cs.length, kills:s.kills/n, throws:s.throws/n, lanes:s.lanesFired/n, perSec:s.lanesFired/n/T,
    acc:s.lanesFired? s.lanesHit/s.lanesFired*100:0, reload:s.throws? s.reloadSum/s.throws:0,
    eff:s.effN? s.effSum/s.effN*100:0, windup:s.windup/n*1000, px:Math.round(s.px/n), view:Math.round(s.view/n) };
}
function resultPayload(w){
  const L=s=>w.chars.filter(c=>c.side===s).reduce((a,c)=>a+c.lives,0);
  const A=kindStats(w,'cpu'), B=kindStats(w,'gpu'), f1=v=>(+v).toFixed(1);
  const rows=[
    ['인원 (양 팀 합계)', A.n+'명', B.n+'명', '두 팀에 섞여 있던 CPU형 · GPU형 캐릭터 수'],
    ['1인당 처치', f1(A.kills), f1(B.kills), ''],
    ['1인당 던진 횟수', f1(A.throws), f1(B.throws), '동작 횟수'],
    ['1인당 날린 눈덩이', f1(A.lanes), f1(B.lanes), '한 번에 몇 발인지가 여기서 갈립니다'],
    ['1인당 초당 눈덩이', A.perSec.toFixed(2), B.perSec.toFixed(2), '= 처리량(throughput)'],
    ['눈덩이 명중률', A.acc.toFixed(1)+'%', B.acc.toFixed(1)+'%', '뿌리면 낭비가 큽니다'],
    ['던지기 준비시간', A.windup.toFixed(0)+'ms', B.windup.toFixed(0)+'ms', '= 지연(latency)'],
    ['평균 재장전', A.reload.toFixed(2)+'s', B.reload.toFixed(2)+'s', 'warp 효율이 낮으면 길어집니다'],
    ['평균 warp 효율', A.eff.toFixed(0)+'%', B.eff.toFixed(0)+'%', '부채꼴에 적이 몇 명 들어왔나'],
    ['화면 픽셀 수', A.px+'K', B.px+'K', '렌더링에 쓴 코어 수의 결과'],
    ['시야 반경', A.view, B.view, ''],
  ];
  const comp=s=>{ const cs=w.chars.filter(c=>c.side===s); return [cs.filter(c=>c.prof.kind==='cpu').length, cs.filter(c=>c.prof.kind==='gpu').length]; };
  const mvp=[...w.chars].sort((a,b)=>b.kills-a.kills||b.hits-a.hits).find(c=>c.kills>0);
  return { t:'res', sc:[w.score.cpu,w.score.gpu], rows, ratio: A.perSec&&B.n&&A.n? (B.perSec/A.perSec).toFixed(1):'—', wu:[A.windup,B.windup],
    comp:[comp('cpu'),comp('gpu')], winner:w.winner||null, lives:[L('cpu'),L('gpu')], byTime:w.t>=ROUND_TIME, stopped:!!w.stopped,
    mvp: mvp? {n:mvp.name,s:mvp.side,k:mvp.kills,ch:mvp.ch||''}:null };
}

/* ==ENGINE-END== */

/* ---------- 입력 ---------- */
const input={mx:0,my:0,aim:0,sprint:false,down:false};
const keys={};
/* 한글 입력 상태에서도 동작하도록 e.key(문자) 대신 e.code(물리 키 위치)를 씁니다. */
const CODE2DIR={ KeyW:'up', ArrowUp:'up', KeyS:'down', ArrowDown:'down',
                 KeyA:'left', ArrowLeft:'left', KeyD:'right', ArrowRight:'right' };
addEventListener('keydown',e=>{
  if(e.repeat && !CODE2DIR[e.code]) return;
  if(e.code==='KeyP'){ e.preventDefault(); togglePause(); return; }
  const d=CODE2DIR[e.code];
  if(d){ keys[d]=true; e.preventDefault(); return; }
  if(e.code==='Space'||e.code==='Enter'){ e.preventDefault(); doThrow(); return; }
  if(e.code==='ShiftLeft'||e.code==='ShiftRight'){ keys.sprint=true; }
});
addEventListener('keyup',e=>{
  const d=CODE2DIR[e.code]; if(d){ keys[d]=false; return; }
  if(e.code==='ShiftLeft'||e.code==='ShiftRight') keys.sprint=false;
});
addEventListener('blur',()=>{ keys.up=keys.down=keys.left=keys.right=false; keys.sprint=false; input.down=false; });
function readKeys(){
  input.mx=(keys.right?1:0)-(keys.left?1:0);
  input.my=(keys.down?1:0)-(keys.up?1:0);
  input.sprint=!!keys.sprint;
}
const view=$('#view');
view.addEventListener('mousemove',e=>{
  const r=view.getBoundingClientRect(), me=myChar(); if(!me) return;
  const wx=(e.clientX-r.left)/r.width*WORLD_W, wy=(e.clientY-r.top)/r.height*WORLD_H;
  input.aim=Math.atan2(wy-me.y, wx-me.x);
});
view.addEventListener('mousedown',e=>{ e.preventDefault(); input.down=true; doThrow(); });
addEventListener('mouseup',()=>input.down=false);
function doThrow(){
  if(!running||paused||(world&&world.spec)) return;
  if(netMode==='client'){ net.send({t:'th',aim:+input.aim.toFixed(3)}); const me=myChar(); if(me&&me.alive&&me.cd<=0&&me.windup<=0){ me.windup=Math.max(me.windup,0.001); SFX.throw(); } return; }
  tryThrow(world, myChar(), input.aim);
}

