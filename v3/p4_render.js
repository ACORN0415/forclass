/* ---------- 렌더 ---------- */
const off=document.createElement('canvas'); const octx=off.getContext('2d');

/* ---------- 도트 스프라이트 (외부 이미지 없이 코드로 생성) ---------- */
function px(w,h){ const c=document.createElement('canvas'); c.width=w; c.height=h; const g=c.getContext('2d'); g.imageSmoothingEnabled=false; return {c,g}; }
function dot(g,x,y,col){ g.fillStyle=col; g.fillRect(x,y,1,1); }
function disc(g,cx,cy,r,col){ g.fillStyle=col; for(let y=-r;y<=r;y++) for(let x=-r;x<=r;x++) if(x*x+y*y<=r*r+r*0.35) g.fillRect(cx+x,cy+y,1,1); }
const SP_W=18, SP_H=20;                                  // 캐릭터 스프라이트 크기(픽셀)
function makeChar(main, dark, light, frame, scarf, hat){  // frame 0,1 = 걷기 / 2 = 던지기 준비 · scarf = 팀 색
  const {c,g}=px(SP_W,SP_H); const bob = frame===1?1:0;
  const SKIN='#f4d3b0', SKINS='#dbb08d', OUT='#2a2f38', SNOW=scarf||'#ffffff';
  // 발
  g.fillStyle=dark; g.fillRect(6,17-bob,2,2); g.fillRect(10,17+bob,2,2);
  // 몸통(파카)
  disc(g,9,13,4,main);
  g.fillStyle=dark; g.fillRect(5,13,1,3); g.fillRect(12,13,1,3);
  g.fillStyle=light; g.fillRect(7,10,4,1);
  // 목도리
  g.fillStyle=SNOW; g.fillRect(6,9,7,2); g.fillStyle='#e6edf5'; g.fillRect(11,11,2,3);
  // 후드
  disc(g,9,6,5,main); disc(g,9,6,4,light);
  // 얼굴
  disc(g,9,7,3,SKIN); g.fillStyle=SKINS; g.fillRect(6,8,1,2); g.fillRect(11,8,1,2);
  dot(g,7,6,OUT); dot(g,11,6,OUT);                        // 눈
  g.fillStyle='#e08a7a'; g.fillRect(8,9,2,1);             // 입
  // 후드 테두리
  g.fillStyle=main; g.fillRect(4,5,1,3); g.fillRect(13,5,1,3); g.fillRect(6,1,6,1);
  if(frame===2){ g.fillStyle=main; g.fillRect(3,9,2,2); }  // 던지려고 젖힌 팔
  // 캐릭터별 장식
  if(hat==='pom'){ g.fillStyle='#ffffff'; g.fillRect(8,0,2,2); }
  else if(hat==='ears'){ g.fillStyle=dark; g.fillRect(4,1,2,3); g.fillRect(12,1,2,3); g.fillStyle='#f7b2c4'; g.fillRect(5,2,1,1); g.fillRect(12,2,1,1); }
  else if(hat==='visor'){ g.fillStyle='#2a2f38'; g.fillRect(5,5,8,2); g.fillStyle='#7fe0ff'; g.fillRect(6,5,6,1); }
  else if(hat==='antenna'){ g.fillStyle=dark; g.fillRect(9,0,1,2); g.fillStyle='#ffcf2e'; g.fillRect(8,0,1,1); }
  else if(hat==='band'){ g.fillStyle='#ffcf2e'; g.fillRect(5,4,8,1); }
  else if(hat==='horn'){ g.fillStyle='#ffffff'; g.fillRect(6,0,1,2); g.fillRect(11,0,1,2); }
  else if(hat==='star'){ g.fillStyle='#ffcf2e'; g.fillRect(9,2,1,1); g.fillRect(8,3,3,1); g.fillRect(9,4,1,1); }
  else if(hat==='glasses'){ g.fillStyle='#2a2f38'; g.fillRect(6,6,3,1); g.fillRect(10,6,3,1); g.fillRect(9,6,1,1); }
  return c;
}
function makeMitten(main,dark){ const {c,g}=px(5,5); disc(g,2,2,2,main); g.fillStyle=dark; g.fillRect(1,3,3,1); g.fillStyle='#fff'; g.fillRect(1,1,1,1); return c; }
function makeBall(col,big){ const r=big?3:2, n=r*2+2, {c,g}=px(n,n); disc(g,r+1,r+1,r,'#ffffff'); g.fillStyle=col; g.fillRect(r,r,1,1); g.fillStyle='#cfdbe8'; g.fillRect(1,n-2,n-2,1); return c; }
function makeAmmo(){ const {c,g}=px(12,10); g.fillStyle='rgba(31,35,40,.14)'; g.fillRect(2,8,8,1);
  disc(g,4,6,2,'#ffffff'); disc(g,8,6,2,'#f2f7fc'); disc(g,6,3,2,'#ffffff');
  g.fillStyle='#c3d2e2'; g.fillRect(2,7,2,1); g.fillRect(7,7,3,1); return c; }
const SPR={};
function buildSprites(){
  for(const k of ['cpu','gpu']){
    const main=k==='cpu'?'#2f7fd6':'#d1662a', dark=k==='cpu'?'#1b558f':'#8f4419', light=k==='cpu'?'#63a8ef':'#eb9155';
    SPR[k]=[0,1,2].map(f=>makeChar(main,dark,light,f));
    SPR[k+'M']=makeMitten(main,dark);
    SPR[k+'B']=makeBall(k==='cpu'?'#2f7fd6':'#d1662a',false);
    SPR[k+'B2']=makeBall(k==='cpu'?'#2f7fd6':'#d1662a',true);
  }
  SPR.ch={};
  for(const ch of CHARS){ SPR.ch[ch.id]={}; for(const side of ['cpu','gpu']){ const scarf= side==='cpu'?'#2f7fd6':'#e8641f';
    SPR.ch[ch.id][side]=[0,1,2].map(f=>makeChar(ch.col[0],ch.col[1],ch.col[2],f,scarf,ch.hat)); } }
  SPR.ammo=makeAmmo();
  // 눈밭 타일 (32×32, 시드 고정)
  const t=px(32,32); t.g.fillStyle='#eef4fb'; t.g.fillRect(0,0,32,32);
  let sd=7; const rnd=()=>((sd=(sd*1103515245+12345)&0x7fffffff)/0x7fffffff);
  for(let i=0;i<70;i++){ const x=(rnd()*32)|0, y=(rnd()*32)|0; t.g.fillStyle= rnd()<0.5?'#ffffff':'#e2ebf5'; t.g.fillRect(x,y,1,1); }
  for(let i=0;i<7;i++){ const x=(rnd()*30)|0, y=(rnd()*30)|0; t.g.fillStyle='#dde7f2'; t.g.fillRect(x,y,2,1); }
  SPR.tile=t.c;
  // 얼음벽 조각 (8×8 타일을 장애물 크기에 맞춰 반복)
  const w=px(8,8); w.g.fillStyle='#b9cde0'; w.g.fillRect(0,0,8,8);
  w.g.fillStyle='#d6e5f2'; w.g.fillRect(0,0,8,2); w.g.fillStyle='#93aec8'; w.g.fillRect(0,6,8,2);
  w.g.fillStyle='#a8c0d6'; w.g.fillRect(3,2,1,4); w.g.fillRect(6,3,1,3);
  SPR.wall=w.c;
  // 소나무 (장식)
  const pn=px(14,18); pn.g.fillStyle='#6b4a2f'; pn.g.fillRect(6,14,2,4);
  for(const [y,r] of [[12,5],[9,4],[6,3],[3,2]]){ disc(pn.g,7,y,r,'#2f6b4f'); }
  pn.g.fillStyle='#ffffff'; pn.g.fillRect(4,11,3,1); pn.g.fillRect(6,8,3,1); pn.g.fillRect(6,5,2,1);
  SPR.pine=pn.c;
}
buildSprites();
function sprOf(c){ const s=c.ch&&SPR.ch[c.ch]; return s? s[c.side] : SPR[c.side]; }
const TREES=[[62,88],[62,512],[898,88],[898,512],[300,300],[660,300],[180,200],[780,400],[420,60],[540,540]];
const steps=[], burst=[];
let vctx=view.getContext('2d'), frame=0, shake=0;
const snow=Array.from({length:70},()=>({x:Math.random()*WORLD_W,y:Math.random()*WORLD_H,r:1+Math.random()*2,s:6+Math.random()*16,d:Math.random()*6.28}));
const COL={cpu:'#0969da', gpu:'#bc4c00'};
function fitCanvas(){
  const st=$('#stage'), pad=16;
  const aw=Math.max(120,st.clientWidth-pad*2), ah=Math.max(80,st.clientHeight-pad*2);
  const s=Math.max(0.2,Math.min(aw/WORLD_W, ah/WORLD_H));
  view.style.width=Math.floor(WORLD_W*s)+'px'; view.style.height=Math.floor(WORLD_H*s)+'px';
  const dpr=Math.min(2,window.devicePixelRatio||1);
  view.width=Math.max(2,Math.floor(WORLD_W*s*dpr)); view.height=Math.max(2,Math.floor(WORLD_H*s*dpr));
  vctx=view.getContext('2d');
}
addEventListener('resize',()=>{ fitCanvas(); if(world) draw(); });

function draw(){
  const me=viewChar(); if(!me) return;
  const P=me.prof, rs=P.renderScale, vr=P.view;
  off.width=Math.max(60,Math.round(WORLD_W*rs)); off.height=Math.max(40,Math.round(WORLD_H*rs));
  octx.setTransform(rs,0,0,rs,0,0);
  octx.imageSmoothingEnabled=false;
  const pat=octx.createPattern(SPR.tile,'repeat'); octx.fillStyle=pat; octx.fillRect(0,0,WORLD_W,WORLD_H);
  octx.fillStyle='rgba(47,127,214,.09)'; octx.fillRect(0,0,110,WORLD_H);
  octx.fillStyle='rgba(209,102,42,.09)'; octx.fillRect(WORLD_W-110,0,110,WORLD_H);
  // 발자국
  for(let i=steps.length-1;i>=0;i--){ const f=steps[i]; f.t-=1/60; if(f.t<=0){ steps.splice(i,1); continue; }
    octx.fillStyle=`rgba(150,170,192,${Math.min(.5,f.t*0.5)})`; octx.fillRect(f.x-1,f.y-1,2,2); }
  // 나무
  for(const [tx,ty] of TREES){ octx.drawImage(SPR.pine, tx-14, ty-30, 28, 36); }
  // 얼음벽
  const wpat=octx.createPattern(SPR.wall,'repeat');
  for(const o of OBST){
    octx.fillStyle='rgba(31,35,40,.13)'; octx.fillRect(o.x+2,o.y+o.h,o.w,4);
    octx.save(); octx.translate(o.x,o.y); octx.fillStyle=wpat; octx.fillRect(0,0,o.w,o.h); octx.restore();
    octx.fillStyle='#ffffff'; octx.fillRect(o.x,o.y,o.w,2);
    octx.fillStyle='rgba(31,35,40,.22)'; octx.fillRect(o.x,o.y+o.h-1,o.w,1); octx.fillRect(o.x+o.w-1,o.y,1,o.h);
  }
  // 눈발
  octx.fillStyle='rgba(255,255,255,.85)';
  for(const f of snow){ f.y+=f.s*0.016; f.x+=Math.cos(f.d+world.t)*0.25; if(f.y>WORLD_H){f.y=-4;f.x=Math.random()*WORLD_W;}
    octx.beginPath(); octx.arc(f.x,f.y,f.r,0,6.283); octx.fill(); }
  // 눈 뭉치(탄약)
  for(const a of world.ammo) octx.drawImage(SPR.ammo, a.x-9, a.y-9, 18, 15);
  for(const c of world.chars){
    if(!c.alive) continue;
    if(c!==me && Math.hypot(c.x-me.x,c.y-me.y)>vr) continue;
    const col=c.side==='cpu'?COL.cpu:COL.gpu, K=1.65, sw=SP_W*K, sh=SP_H*K;
    const dir=(c===me&&c.isPlayer)?input.aim:c.windDir;
    // 그림자
    octx.fillStyle='rgba(31,35,40,.17)'; octx.beginPath(); octx.ellipse(c.x,c.y+13,11,3.5,0,0,6.283); octx.fill();
    // 내 캐릭터 표시(발밑 링)
    if(c===me){ octx.fillStyle='rgba(255,255,255,.75)'; octx.beginPath(); octx.ellipse(c.x,c.y+13,14,5,0,0,6.283); octx.fill();
      octx.strokeStyle='#1f2328'; octx.lineWidth=1.5; octx.setLineDash([3,3]); octx.beginPath(); octx.ellipse(c.x,c.y+13,14,5,0,0,6.283); octx.stroke(); octx.setLineDash([]);
      const by=c.y-SP_H*1.65*0.68-14+Math.sin(world.t*4)*2;                       // 머리 위 화살표
      octx.fillStyle='#1f2328'; octx.beginPath(); octx.moveTo(c.x,by+7); octx.lineTo(c.x-5,by); octx.lineTo(c.x+5,by); octx.closePath(); octx.fill(); }
    // 발자국 남기기
    if(c.alive && (Math.abs(c.bx)+Math.abs(c.by)>0.2 || (c===me&&(input.mx||input.my))) && Math.random()<0.10) steps.push({x:c.x+(Math.random()-.5)*6, y:c.y+12, t:2.2});
    // 본체
    const walking = (Math.abs(c.bx)+Math.abs(c.by)>0.2)||(c===me&&(input.mx||input.my))||(c.remote&&c.rin&&(c.rin.mx||c.rin.my));
    const fr = c.windup>0 ? 2 : (walking ? (Math.floor(world.t*7)%2) : 0);
    const im=imgOf(c);
    if(im){ // 캐릭터 PNG: 조준 방향으로 4방향, 걸을 때 프레임 넘김
      const a=((dir%6.283)+6.283)%6.283; const dn= a<0.785||a>5.5?'right': a<2.356?'down': a<3.927?'left':'up';
      const frames=(walking? im.walk[dn] : im.stand[dn])||im.stand.down, k=walking? Math.floor(world.t*im.fps)%frames.length : 0, pic=frames[k];
      const H=48*im.scale, W=H*pic.width/pic.height, flip=(dn==='left'&&im.flipLeft)||(dn==='right'&&im.flipRight);
      octx.save(); octx.translate(Math.round(c.x), Math.round(c.y+14)); if(flip) octx.scale(-1,1); octx.imageSmoothingEnabled=true;
      octx.drawImage(pic, -W/2, -H, W, H); octx.restore(); octx.imageSmoothingEnabled=false;
    } else octx.drawImage(sprOf(c)[fr], Math.round(c.x-sw/2), Math.round(c.y-sh*0.68), sw, sh);
    // 조준 손(장갑)
    const md = c.windup>0? -9 : 15;
    octx.drawImage(SPR[c.side+'M'], Math.round(c.x+Math.cos(dir)*md-4), Math.round(c.y+Math.sin(dir)*md-4+2), 9, 9);
    // 준비 게이지
    if(c.windup>0){ const f=1-c.windup/Math.max(.001,c.prof.windup); octx.strokeStyle='rgba(31,35,40,.4)'; octx.lineWidth=3; octx.beginPath(); octx.arc(c.x,c.y,21,-1.57,-1.57+6.283*f); octx.stroke(); }
    // 체력(도트 칸)
    for(let h=0;h<MAX_HP;h++){ const hx=c.x-14+h*5, hy=c.y-sh*0.68-6;
      octx.fillStyle='rgba(31,35,40,.25)'; octx.fillRect(hx-1,hy-1,5,5);
      octx.fillStyle= h<c.hp? col:'#e6ebf1'; octx.fillRect(hx,hy,3,3); }
    if(c.name && c!==me && (c.remote||c.isBotAI||world.spec)){ octx.font='10px sans-serif'; octx.textAlign='center';
      const tw=octx.measureText(c.name).width; octx.fillStyle='rgba(31,35,40,.62)'; octx.fillRect(c.x-tw/2-3,c.y-sh*0.68-20,tw+6,12);
      octx.fillStyle='#fff'; octx.fillText(c.name,c.x,c.y-sh*0.68-11); octx.textAlign='left'; }
  }
  for(const b of world.balls){
    if(Math.hypot(b.x-me.x,b.y-me.y)>vr+40) continue;
    const big=(b.dmg||1)>2, sp=SPR[b.side+(big?'B2':'B')], sz=big?13:10;
    octx.strokeStyle=(b.side==='cpu'?'rgba(47,127,214,.22)':'rgba(209,102,42,.22)'); octx.lineWidth=sz*0.5;
    octx.beginPath(); octx.moveTo(b.x-b.vx*0.02,b.y-b.vy*0.02); octx.lineTo(b.x,b.y); octx.stroke();
    octx.drawImage(sp, Math.round(b.x-sz/2), Math.round(b.y-sz/2), sz, sz);
  }
  // 눈덩이 터짐 파티클
  for(const f of world.hitFx){ if(f.seeded) continue; f.seeded=1;
    for(let k=0;k<9;k++){ const a=Math.random()*6.283, v=40+Math.random()*90; burst.push({x:f.x,y:f.y,vx:Math.cos(a)*v,vy:Math.sin(a)*v,t:0.42}); } }
  for(let i=burst.length-1;i>=0;i--){ const q=burst[i]; q.t-=1/60; if(q.t<=0){ burst.splice(i,1); continue; }
    q.x+=q.vx/60; q.y+=q.vy/60; q.vy+=90/60;
    octx.fillStyle=`rgba(255,255,255,${Math.min(1,q.t*2.6)})`; octx.fillRect(Math.round(q.x),Math.round(q.y),2,2);
    octx.fillStyle=`rgba(180,200,220,${Math.min(.7,q.t*1.8)})`; octx.fillRect(Math.round(q.x),Math.round(q.y)+2,2,1); }
  if(me.alive && me.isPlayer && !world.spec){ octx.strokeStyle='rgba(31,35,40,.25)'; octx.lineWidth=1.5; octx.setLineDash([6,6]);
    for(const s of [-1,1]){ octx.beginPath(); octx.moveTo(me.x,me.y); octx.lineTo(me.x+Math.cos(input.aim+s*P.fan)*Math.min(vr,400), me.y+Math.sin(input.aim+s*P.fan)*Math.min(vr,400)); octx.stroke(); }
    octx.setLineDash([]); }
  vctx.setTransform(1,0,0,1,0,0);
  vctx.imageSmoothingEnabled=rs>=0.6;
  vctx.clearRect(0,0,view.width,view.height);
  if(shake>0){ shake*=0.82; if(shake<0.4) shake=0; vctx.setTransform(1,0,0,1,(Math.random()-.5)*shake*2,(Math.random()-.5)*shake*2); }
  vctx.drawImage(off,0,0,view.width,view.height);
  vctx.setTransform(1,0,0,1,0,0);
  const sx=view.width/WORLD_W;
  if(vr<540){
    const g=vctx.createRadialGradient(me.x*sx,me.y*sx,vr*sx*0.80, me.x*sx,me.y*sx,vr*sx*1.0);
    g.addColorStop(0,'rgba(118,140,163,0)'); g.addColorStop(0.55,'rgba(118,140,163,.35)'); g.addColorStop(1,'rgba(104,126,148,.82)');
    vctx.fillStyle=g; vctx.fillRect(0,0,view.width,view.height);
    vctx.strokeStyle='rgba(31,35,40,.18)'; vctx.lineWidth=1.5; vctx.setLineDash([7,7]);
    vctx.beginPath(); vctx.arc(me.x*sx,me.y*sx,vr*sx,0,6.283); vctx.stroke(); vctx.setLineDash([]);
  }
}

/* ---------- 루프 ---------- */
let running=false, paused=false, lastT=0, acc=0;
function loop(ts){
  if(!running) return;
  if(tick(ts)) requestAnimationFrame(loop);
}
// 방장 탭이 가려지면 브라우저가 requestAnimationFrame 을 멈춘다 → 방장이 계산하므로 모두 멈춤.
// 숨겨진 동안은 Worker 타이머(백그라운드에서도 거의 안 늦춰짐)로 계산·스냅샷만 이어 간다.
let bgWorker=null;
try{
  bgWorker=new Worker(URL.createObjectURL(new Blob(['setInterval(()=>postMessage(0),16)'],{type:'text/javascript'})));
  bgWorker.onmessage=()=>{ if(running && document.hidden && netMode==='host') tick(performance.now()); };
}catch(e){ setInterval(()=>{ if(running && document.hidden && netMode==='host') tick(performance.now()); },16); }
function tick(ts){
  const dt=Math.min(0.05,(ts-lastT)/1000||0); lastT=ts;
  if(!paused){
    if(netMode==='client'){ clientStep(dt); }
    else {
      readKeys();
      if(input.down && !world.spec) tryThrow(world, myChar(), input.aim);
      acc+=dt; let n=0;
      while(acc>=1/60 && n<4){ stepWorld(world,1/60); acc-=1/60; n++; }
      if(netMode==='host'){ const now=performance.now(); if(now-net.lastSnap>45){ net.lastSnap=now; net.send(snapshot(world)); } }
    }
    frame++;
    const me=myChar();
    if(document.hidden) return true;   // 안 보이는 동안은 그리지 않음
    if(me && frame % me.prof.drawEvery === 0) draw();
    updateHud();
    if(world.over && netMode!=='client'){ endRound(); return false; }
  }
  return true;
}
let prevHp=MAX_HP, feedSeen=0;
function teamLives(side){ return world.chars.filter(c=>c.side===side).reduce((a,c)=>a+c.lives,0); }
function spectateNext(){ // 탈락하면 살아있는 아군 시점으로
  const me=world.chars[world.meIdx]; if(!me.out) return;
  const ally=world.chars.find(c=>c.side===me.side && !c.out && c!==me);
  if(ally){ world.spectateIdx=world.chars.indexOf(ally); }
}
function updateHud(){
  const me= world&&world.spec? world.spec : myChar(); if(!me) return;
  const sc=world.score.cpu, sg=world.score.gpu, left=Math.max(0,Math.ceil(ROUND_TIME-world.t));
  const lc=teamLives('cpu'), lg=teamLives('gpu'), tot=Math.max(1,lc+lg);
  $('#hudCpu').textContent='CPU '+sc; $('#hudGpu').textContent='GPU '+sg;
  $('#hudTime').textContent=left;
  $('#hudAmmo').hidden=!!world.spec; $('#hudEff').hidden=!!world.spec;
  $('#hudAmmo').textContent='탄약 '+me.ammo+'/'+me.prof.maxAmmo;
  $('#hudEff').textContent = lastEff? `warp ${Math.round(lastEff.eff*100)}% · 재장전 ${lastEff.reload.toFixed(2)}s` : `한 번에 ${me.prof.lanes}발`;
  // 상단 점수바
  $('#sbCpu').textContent=lc; $('#sbGpu').textContent=lg;
  $('#sbKc').textContent='처치 '+sc; $('#sbKg').textContent='처치 '+sg;
  $('#sbBarC').style.width=(lc/tot*100)+'%'; $('#sbBarG').style.width=(lg/tot*100)+'%';
  const cl=$('#sbClock'); cl.textContent=left; cl.classList.toggle('low',left<=15);
  $('#sbSide').textContent= world.spec? '관전' : '내 팀 '+TEAM[me.side]+(me.rules&&me.rules.length?' · 규칙봇':'');
  $('#hudBuild').textContent= world.spec? '관전 모드 — 전체 시야, 해상도 100%' : `한 번에 ${me.prof.lanes}발 · 재장전 ${me.prof.baseReload.toFixed(2)}s · 시야 ${me.prof.view} · 해상도 ${Math.round(me.prof.renderScale*100)}%`;
  // 내 상태
  const hp=$('#msHp'); if(hp.children.length!==MAX_HP){ hp.innerHTML='<i></i>'.repeat(MAX_HP); }
  [...hp.children].forEach((el,i)=>{ el.className = i<me.hp? 'on '+me.side : ''; });
  const lv=$('#msLives'); if(lv.children.length!==MAX_LIVES) lv.innerHTML='<i></i>'.repeat(MAX_LIVES);
  [...lv.children].forEach((el,i)=>{ el.className = i<me.lives? 'on '+me.side : ''; });
  $('#msAmmo').textContent=me.ammo+' / '+me.prof.maxAmmo;
  const cdEl=$('#msCd'), full=Math.max(0.01,me.prof.baseReload*1.9);
  const ready=me.cd<=0&&me.windup<=0;
  cdEl.style.width=(ready?100:Math.max(6,100*(1-Math.min(1,me.cd/full))))+'%';
  cdEl.className=ready?'warm':'';
  $('#msEff').textContent=lastEff? Math.round(lastEff.eff*100)+'%' : '—';
  // 피격 비네트
  if(me.hp<prevHp){ const v=$('#hitv'); v.classList.add('on'); setTimeout(()=>v.classList.remove('on'),60); shake=6; }
  prevHp=me.hp;
  // 사망 오버레이
  $('#deadOv').hidden=me.alive||!!world.spec;
  if(!me.alive && !world.spec){
    if(me.out){ $('#deadT').textContent='탈락했습니다'; $('#deadN').textContent='관전'; $('#deadN').style.fontSize='24px'; $('#deadS').textContent='남은 아군을 따라갑니다'; spectateNext(); }
    else { $('#deadT').textContent='쓰러졌습니다'; $('#deadN').style.fontSize=''; $('#deadN').textContent=Math.max(0,Math.ceil(me.respawn)); $('#deadS').textContent=`초 후 부활 · 남은 목숨 ${me.lives}`; }
  }
  // 킬 피드
  const f=$('#feed');
  const fk=world.feed.map(k=>k.a+k.b).join('|'); if(fk!==feedSeen){ feedSeen=fk;
    f.innerHTML=world.feed.slice(-5).map(k=>`<div><b class="${k.side}">${k.a}</b> <span style="color:var(--muted)">▸</span> ${k.b}${k.out?' <span style="color:var(--red);font-weight:600">탈락</span>':''}</div>`).join(''); }
}
let toastT=null;
function toast(msg){ const el=$('#toast'); el.textContent=msg; el.classList.add('show'); clearTimeout(toastT); toastT=setTimeout(()=>el.classList.remove('show'),1200); }
function togglePause(){ if(!running||netMode==='client') return; paused=!paused; $('#btnPause').textContent=paused?'계속하기':'일시정지'; if(!paused) lastT=performance.now(); }
