/* ==========================================================================
   무한 아레나 — 로비 [참가하기] → 방 없이 바로 들어가는 상시 개인전
   계산은 서버(arena_infinite.py)가 한다. 이 브라우저는 입력을 보내고 스냅샷을 그린다.
   내 캐릭터 이동만 미리 움직여 보고(예측) 서버 위치로 살살 맞춘다.
   ========================================================================== */
const INF_WPN={
  knife:  {n:'칼',     len:14, w:3, col:'#c9d3de', grip:'#6b4a2f'},
  pistol: {n:'권총',   len:13, w:5, col:'#3d4a5c', grip:'#2a2f38'},
  rifle:  {n:'소총',   len:28, w:4, col:'#6b4a2f', grip:'#2a2f38'},
  mg:     {n:'기관총', len:25, w:7, col:'#2d3a2a', grip:'#1b2418'},
  shotgun:{n:'산탄총', len:23, w:6, col:'#7a3b1d', grip:'#3a2a1f'},
  bazooka:{n:'바주카', len:32, w:9, col:'#4f6b35', grip:'#2f3f20'},
};
const inf={ on:false, id:0, W:3200, H:2000, walls:[], trees:[], speed:200, pr:14, crateS:34, respawn:5, hpMax:100, wpn:{},
  me:null, px:0, py:0, ps:new Map(), bullets:[], snapAt:0, crates:[], items:[], rk:[], mr:0, n:0,
  mouse:{x:0,y:0,down:false}, aim:0, lastSend:0, feed:[], parts:[], rings:[], slashes:[], prevHp:100, deadUntil:0,
  zoom:1, dpr:1, lastT:0, miniBg:null, rkKey:'', lastShotSfx:0, wheelT:0 };
const infView=$('#infView');
let ictx=infView.getContext('2d');

/* ---------- 입장 · 퇴장 ---------- */
function infJoin(){
  if(!online){ toast('서버에 접속해야 참가할 수 있습니다'); return; }
  let ch=ss.get('arena_inf_ch');
  if(!CH[ch]) ch= CH[build.ch]? build.ch : CHARS[Math.floor(Math.random()*CHARS.length)].id;
  ss.set('arena_inf_ch',ch); ss.set('arena_inf','1');
  netMode='inf';
  net.send({t:'inf_join', ch});
  showScreen('scrInf'); infFit(); infView.focus();
}
function infLeave(){
  ss.del('arena_inf'); inf.on=false; netMode='solo';
  net.send({t:'inf_leave'});
  showScreen('scrLobby');
}
$('#btnInf').onclick=infJoin;
$('#btnInfLeave').onclick=infLeave;

function infOnMsg(m){
  if(m.t==='inf_init'){
    if(ss.get('arena_inf')!=='1') return;
    Object.assign(inf,{ id:m.id, W:m.W, H:m.H, walls:m.walls, trees:m.trees||[], speed:m.speed, pr:m.pr, crateS:m.crate, respawn:m.respawn, hpMax:m.hp, wpn:m.wpn||{},
      me:null, ps:new Map(), bullets:[], crates:[], items:[], feed:[], parts:[], rings:[], slashes:[], rk:[], rkKey:'' });
    infBuildMini();
    if(!inf.on){ inf.on=true; inf.lastT=performance.now(); requestAnimationFrame(infLoop); }
    return;
  }
  if(m.t==='inf_s' && inf.on) infSnap(m);
}

/* ---------- 스냅샷 ---------- */
function infSnap(m){
  const now=performance.now();
  const [x,y,hp,gun,ammo,cur,dead,rt,kills,deaths,prot,by,cd,ch]=m.me;
  const was=inf.me;
  inf.me={x,y,hp,gun,ammo,cur,dead:!!dead,rt,kills,deaths,prot:!!prot,by,cd,ch};
  if(!was || (was.dead && !dead)){ inf.px=x; inf.py=y; }          // 처음 · 부활 → 서버 위치로 바로
  else if(!dead){ const ex=x-inf.px, ey=y-inf.py, d=Math.hypot(ex,ey);
    if(d>150){ inf.px=x; inf.py=y; } else if(d>18){ inf.px+=ex*0.25; inf.py+=ey*0.25; } }
  if(dead && (!was||!was.dead)){ inf.deadUntil=now+rt*1000; inf.px=x; inf.py=y; }
  if(was && hp<was.hp && !dead){ const h=$('#infHitv'); h.classList.add('on'); setTimeout(()=>h.classList.remove('on'),130); SFX.hit(); }
  // 다른 사람: 목표 위치만 바꾸고 그릴 때 부드럽게 따라간다
  const seen=new Set();
  for(const q of m.p){ const [id,qx,qy,aim,qhp,w,fl,name,qch]=q; seen.add(id);
    const o=inf.ps.get(id);
    if(o){ Object.assign(o,{tx:qx,ty:qy,aim,hp:qhp,w,fl,name,ch:qch}); if(Math.hypot(o.x-qx,o.y-qy)>200){ o.x=qx; o.y=qy; } }
    else inf.ps.set(id,{id,x:qx,y:qy,tx:qx,ty:qy,aim,hp:qhp,w,fl,name,ch:qch}); }
  for(const id of [...inf.ps.keys()]) if(!seen.has(id)) inf.ps.delete(id);
  inf.bullets=m.b.map(b=>({x:b[1],y:b[2],vx:b[3],vy:b[4],w:b[5]})); inf.snapAt=now;
  inf.crates=m.c; inf.items=m.i; inf.n=m.n; inf.mr=m.mr;
  const key=JSON.stringify(m.rk)+'|'+kills+'|'+m.mr;
  if(key!==inf.rkKey){ inf.rkKey=key; inf.rk=m.rk; infRenderRank(); }
  for(const e of m.fx) infEvent(e, now);
}
function infEvent(e, now){
  const k=e[0];
  if(k==='kill'){ const [,a,b,w,aid,bid]=e;
    inf.feed.push({a,b,w,mine:aid===inf.id, me:bid===inf.id, t:now}); if(inf.feed.length>5) inf.feed.shift(); infRenderFeed();
    if(aid===inf.id && bid!==inf.id){ SFX.kill(); toast(b+' 처치!'); }
    return; }
  const x=e[1], y=e[2];
  const burst=(n,cols,v,life)=>{ for(let i=0;i<n;i++){ const a=Math.random()*6.283, s=v*(0.4+Math.random()*0.8);
    inf.parts.push({x,y,vx:Math.cos(a)*s,vy:Math.sin(a)*s,t:life,life,col:cols[i%cols.length],sz:2+Math.random()*2}); } };
  if(k==='hit') burst(8,['#e5484d','#ffffff','#ff9a9a'],120,0.35);
  else if(k==='spark') burst(4,['#ffcf2e','#ffffff'],90,0.2);
  else if(k==='break'){ burst(14,['#b07a3c','#7a4f22','#d9a066'],150,0.6); SFX.noise(0.15,0.16,false); }
  else if(k==='boom'){ burst(26,['#ff9f43','#ffcf2e','#e5484d','#6b7a90'],260,0.7); inf.rings.push({x,y,t:0.45}); SFX.noise(0.45,0.3,false); SFX.tone(160,40,0.4,'triangle',0.12); }
  else if(k==='slash'){ inf.slashes.push({x,y,a:e[3],t:0.18}); if(Math.hypot(x-inf.px,y-inf.py)<300) SFX.noise(0.05,0.07,true); }
  else if(k==='shot'){ if(now-inf.lastShotSfx>55 && Math.hypot(x-inf.px,y-inf.py)<700){ inf.lastShotSfx=now;
      if(e[3]==='bazooka') SFX.tone(220,70,0.25,'sawtooth',0.07); else if(e[3]==='shotgun') SFX.noise(0.14,0.2,false); else SFX.noise(0.05,e[3]==='rifle'?0.16:0.1,true); } }
}

/* ---------- HUD ---------- */
function infRenderRank(){
  const rows=inf.rk.map((r,i)=>`<div class="r ${r[0]===inf.id?'me':''}"><span>${i+1}</span><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r[1])}</span><span class="k">${r[2]}킬</span></div>`).join('')
    || '<div class="muted">아직 아무도 없습니다</div>';
  const m=inf.me;
  $('#infRank').innerHTML=`<h5>랭킹 TOP 5</h5>${rows}<div class="r me mine"><span>${inf.mr||'-'}</span><span>${esc(me.name)} (나)</span><span class="k">${m?m.kills:0}킬</span></div>`;
}
function infRenderFeed(){
  $('#infFeed').innerHTML=inf.feed.map(f=>`<div><b class="${f.mine?'me':''}">${esc(f.a)}</b><span class="w">${(INF_WPN[f.w]||{}).n||''} ▸</span><b class="${f.me?'me':''}">${esc(f.b)}</b></div>`).join('');
}
function infHud(now){
  const m=inf.me; if(!m) return;
  $('#infTag').textContent=`무한 아레나 · ${inf.n}명`;
  $('#infHpN').textContent=Math.max(0,m.hp);
  const hb=$('#infHp'); hb.style.width=Math.max(0,m.hp/inf.hpMax*100)+'%'; hb.classList.toggle('low',m.hp<=30);
  $('#infS1').classList.toggle('on',m.cur==='knife');
  $('#infS2').classList.toggle('on',m.cur!=='knife');
  $('#infGun').textContent= m.gun? INF_WPN[m.gun].n : '총 없음';
  $('#infAmmo').textContent= m.gun? `${m.ammo}/${(inf.wpn[m.gun]||{}).max||''}` : '';
  // 줍기 안내
  let hint='';
  if(!m.dead){ let best=null,bd=40; for(const it of inf.items){ if(it[1]!=='gun') continue; const d=Math.hypot(it[3]-inf.px,it[4]-inf.py); if(d<bd){ bd=d; best=it; } }
    if(best && m.gun) hint=`<kbd>E</kbd> ${INF_WPN[best[2]].n} 줍기 (지금 ${INF_WPN[m.gun].n}은 바닥에 놓음)`;
    else if(m.gun && m.ammo<=0) hint='탄약이 없습니다 — 상자를 부수거나 탄약을 주우세요';
    else if(!m.gun) hint='칼만 있습니다 — 상자를 부숴 총을 얻으세요'; }
  const h=$('#infHint'); h.hidden=!hint; if(hint && h.innerHTML!==hint) h.innerHTML=hint;
  const dv=$('#infDead'); dv.hidden=!m.dead;
  if(m.dead){ $('#infDeadN').textContent=Math.max(0,Math.ceil((inf.deadUntil-now)/1000)); $('#infDeadT').textContent= m.by&&m.by!==me.name? `${m.by} 에게 쓰러졌습니다` : '쓰러졌습니다'; }
  if(inf.feed.length && now-inf.feed[0].t>6000){ inf.feed.shift(); infRenderFeed(); }
}

/* ---------- 입력 ---------- */
infView.addEventListener('mousemove',e=>{ const r=infView.getBoundingClientRect(); inf.mouse.x=e.clientX-r.left; inf.mouse.y=e.clientY-r.top; });
infView.addEventListener('mousedown',e=>{ e.preventDefault(); infView.focus(); inf.mouse.down=true; SFX.ac(); });
addEventListener('mouseup',()=>{ inf.mouse.down=false; });
infView.addEventListener('contextmenu',e=>e.preventDefault());
infView.addEventListener('wheel',e=>{ e.preventDefault(); const now=performance.now(); if(now-inf.wheelT<200) return; inf.wheelT=now; net.send({t:'inf_sw'}); },{passive:false});
addEventListener('keydown',e=>{
  if(!inf.on || curScreen!=='scrInf' || /INPUT|TEXTAREA/.test(e.target.tagName)) return;
  if(e.code==='KeyE'){ e.preventDefault(); net.send({t:'inf_pick'}); }
  else if(e.code==='KeyQ'){ e.preventDefault(); net.send({t:'inf_sw'}); }
  else if(e.code==='Digit1'){ net.send({t:'inf_sw',w:'knife'}); }
  else if(e.code==='Digit2'){ net.send({t:'inf_sw',w:'gun'}); }
  else if(e.code==='Space'){ inf.mouse.space=true; }
});
addEventListener('keyup',e=>{ if(e.code==='Space') inf.mouse.space=false; });
addEventListener('blur',()=>{ inf.mouse.down=false; inf.mouse.space=false; });

/* ---------- 충돌 (서버와 같은 식 — 내 이동 예측용) ---------- */
function infRectHit(x,y,r,ox,oy,ow,oh){ const cx=Math.max(ox,Math.min(x,ox+ow)), cy=Math.max(oy,Math.min(y,oy+oh)); const dx=x-cx, dy=y-cy; return dx*dx+dy*dy<r*r; }
function infBlocked(x,y,r){
  if(x<r||y<r||x>inf.W-r||y>inf.H-r) return true;
  for(const o of inf.walls) if(infRectHit(x,y,r,o[0],o[1],o[2],o[3])) return true;
  for(const c of inf.crates) if(infRectHit(x,y,r,c[1],c[2],inf.crateS,inf.crateS)) return true;
  return false;
}

/* ---------- 루프 ---------- */
function infFit(){
  const st=$('#infStage'), w=Math.max(200,st.clientWidth), h=Math.max(150,st.clientHeight);
  inf.dpr=Math.min(2,window.devicePixelRatio||1);
  infView.width=Math.floor(w*inf.dpr); infView.height=Math.floor(h*inf.dpr);
  inf.zoom=Math.max(0.45,Math.min(w/1300,h/820));
  ictx=infView.getContext('2d');
}
addEventListener('resize',()=>{ if(curScreen==='scrInf') infFit(); });
function infLoop(ts){
  if(!inf.on) return;
  const dt=Math.min(0.05,(ts-inf.lastT)/1000||0); inf.lastT=ts;
  if(curScreen==='scrInf' && inf.me){
    readKeys();
    const m=inf.me, cw=infView.width/inf.dpr, chh=infView.height/inf.dpr;
    inf.aim=Math.atan2(inf.mouse.y-chh/2, inf.mouse.x-cw/2);
    let mx=input.mx, my=input.my;
    if(!m.dead && (mx||my)){ const l=Math.hypot(mx,my), s=inf.speed*dt/l, nx=inf.px+mx*s, ny=inf.py+my*s;
      if(!infBlocked(nx,inf.py,inf.pr)) inf.px=nx; if(!infBlocked(inf.px,ny,inf.pr)) inf.py=ny; }
    if(ts-inf.lastSend>33){ inf.lastSend=ts; net.send({t:'inf_in',mx,my,aim:+inf.aim.toFixed(3),f:(inf.mouse.down||inf.mouse.space)&&!m.dead?1:0}); }
    const k=1-Math.exp(-dt*14);
    for(const o of inf.ps.values()){ o.x+=(o.tx-o.x)*k; o.y+=(o.ty-o.y)*k; }
    infDraw(ts, dt);
    infHud(ts);
  }
  requestAnimationFrame(infLoop);
}

/* ---------- 그리기 ---------- */
function infBuildMini(){
  const c=document.createElement('canvas'); c.width=200; c.height=125; const g=c.getContext('2d'), s=200/inf.W;
  g.fillStyle='#E8E5DC'; g.fillRect(0,0,200,125); g.fillStyle='#6B6A63';
  for(const o of inf.walls) g.fillRect(o[0]*s,o[1]*s,Math.max(1.5,o[2]*s),Math.max(1.5,o[3]*s));
  inf.miniBg=c;
}
function infDrawMini(){
  const g=$('#infMini').getContext('2d'), s=200/inf.W;
  if(inf.miniBg) g.drawImage(inf.miniBg,0,0);
  const cw=infView.width/inf.dpr/inf.zoom, chh=infView.height/inf.dpr/inf.zoom;
  g.strokeStyle='rgba(20,20,19,.75)'; g.lineWidth=1.5; g.strokeRect((inf.px-cw/2)*s,(inf.py-chh/2)*s,cw*s,chh*s);
  g.fillStyle='#3E6AA8'; for(const o of inf.ps.values()) g.fillRect(o.x*s-1.5,o.y*s-1.5,3,3);
  g.fillStyle='#D97757'; g.beginPath(); g.arc(inf.px*s,inf.py*s,3.2,0,6.283); g.fill(); g.strokeStyle='#fff'; g.stroke();
}
function infDrawChar(g,c,dir,walking,t){
  const im= c.ch&&IMG[c.ch]? IMG[c.ch][c.side] : null;
  if(im){
    const a=((dir%6.283)+6.283)%6.283, dn= a<0.785||a>5.5?'right': a<2.356?'down': a<3.927?'left':'up';
    const frames=(walking? im.walk[dn] : im.stand[dn])||im.stand.down, pic=frames[walking? Math.floor(t*im.fps)%frames.length : 0];
    const H=48*im.scale, Wd=H*pic.width/pic.height, flip=(dn==='left'&&im.flipLeft)||(dn==='right'&&im.flipRight);
    g.save(); g.translate(Math.round(c.x),Math.round(c.y+14)); if(flip) g.scale(-1,1); g.imageSmoothingEnabled=true; g.drawImage(pic,-Wd/2,-H,Wd,H); g.restore(); g.imageSmoothingEnabled=false;
  } else {
    const sp= c.ch&&SPR.ch[c.ch]? SPR.ch[c.ch][c.side] : SPR[c.side], K=1.65, sw=SP_W*K, sh=SP_H*K;
    g.drawImage(sp[walking? Math.floor(t*7)%2 : 0], Math.round(c.x-sw/2), Math.round(c.y-sh*0.68), sw, sh);
  }
}
function infDrawWeapon(g,x,y,a,w,swing){
  const W=INF_WPN[w]||INF_WPN.knife;
  g.save(); g.translate(x,y+2); g.rotate(a+(w==='knife'&&swing? Math.sin(performance.now()/40)*0.9 : 0));
  if(Math.cos(a)<0) g.scale(1,-1);
  g.fillStyle=W.grip; g.fillRect(8,-2,5,5);
  g.fillStyle=W.col; g.fillRect(11,-W.w/2,W.len,W.w);
  if(w==='knife'){ g.fillStyle='#ffffff'; g.fillRect(12,-W.w/2,W.len-2,1); }
  else if(w==='mg'){ g.fillStyle=W.grip; g.fillRect(17,W.w/2,5,5); }
  else if(w==='rifle'){ g.fillStyle='#2a2f38'; g.fillRect(20,-W.w/2-2,5,2); }
  else if(w==='bazooka'){ g.fillStyle='#2f3f20'; g.fillRect(11+W.len-4,-W.w/2-1,5,W.w+2); }
  g.restore();
}
function infDrawItem(g,it,t){
  const [,k,w,x,y]=it, bob=Math.sin(t*3+x)*2;
  g.fillStyle='rgba(31,35,40,.16)'; g.beginPath(); g.ellipse(x,y+9,11,3.5,0,0,6.283); g.fill();
  if(k==='gun'){
    g.fillStyle='rgba(255,207,46,.33)'; g.beginPath(); g.arc(x,y+bob,17,0,6.283); g.fill();
    infDrawWeapon(g,x-20,y+bob-2,0,w,false);
    g.font='bold 9px sans-serif'; g.textAlign='center'; g.fillStyle='#5a3b00'; g.fillText(INF_WPN[w].n,x,y+bob+20); g.textAlign='left';
  } else if(k==='ammo'){
    g.fillStyle='#4f6b35'; g.fillRect(x-9,y-6+bob,18,12); g.fillStyle='#6f8f4f'; g.fillRect(x-9,y-6+bob,18,3);
    g.fillStyle='#ffcf2e'; for(let i=0;i<3;i++) g.fillRect(x-6+i*5,y-1+bob,3,5);
  } else {
    g.fillStyle='#ffffff'; g.fillRect(x-9,y-8+bob,18,16); g.strokeStyle='#c9d3de'; g.lineWidth=1; g.strokeRect(x-9,y-8+bob,18,16);
    g.fillStyle='#e5484d'; g.fillRect(x-2,y-5+bob,4,10); g.fillRect(x-5,y-2+bob,10,4);
  }
}
function infDraw(ts, dt){
  const g=ictx, t=ts/1000, m=inf.me, Z=inf.zoom*inf.dpr;
  const cw=infView.width/Z, chh=infView.height/Z, cx=inf.px, cy=inf.py;
  const x0=cx-cw/2, y0=cy-chh/2, x1=cx+cw/2, y1=cy+chh/2, vis=(x,y,mg)=>x>x0-mg&&x<x1+mg&&y>y0-mg&&y<y1+mg;
  g.setTransform(1,0,0,1,0,0); g.fillStyle='#23231F'; g.fillRect(0,0,infView.width,infView.height);
  g.setTransform(Z,0,0,Z,-x0*Z,-y0*Z); g.imageSmoothingEnabled=false;
  // 바닥 · 테두리
  g.fillStyle=g.createPattern(SPR.tile,'repeat'); g.fillRect(Math.max(0,x0),Math.max(0,y0),Math.min(inf.W,x1)-Math.max(0,x0),Math.min(inf.H,y1)-Math.max(0,y0));
  g.strokeStyle='#3D3D3A'; g.lineWidth=6; g.strokeRect(-3,-3,inf.W+6,inf.H+6);
  // 나무 · 벽
  for(const [tx,ty] of inf.trees) if(vis(tx,ty,40)) g.drawImage(SPR.pine,tx-14,ty-30,28,36);
  const wpat=g.createPattern(SPR.wall,'repeat');
  for(const o of inf.walls){ const [ox,oy,ow,oh]=o; if(ox>x1||oy>y1||ox+ow<x0||oy+oh<y0) continue;
    g.fillStyle='rgba(31,35,40,.13)'; g.fillRect(ox+2,oy+oh,ow,4);
    g.save(); g.translate(ox,oy); g.fillStyle=wpat; g.fillRect(0,0,ow,oh); g.restore();
    g.fillStyle='#ffffff'; g.fillRect(ox,oy,ow,2); g.fillStyle='rgba(31,35,40,.22)'; g.fillRect(ox,oy+oh-1,ow,1); g.fillRect(ox+ow-1,oy,1,oh); }
  // 상자
  const S=inf.crateS;
  for(const c of inf.crates){ const [,bx,by,hp]=c; if(!vis(bx,by,S)) continue;
    g.fillStyle='rgba(31,35,40,.18)'; g.fillRect(bx+3,by+S,S,4);
    g.fillStyle='#b07a3c'; g.fillRect(bx,by,S,S); g.fillStyle='#d9a066'; g.fillRect(bx,by,S,3);
    g.strokeStyle='#7a4f22'; g.lineWidth=2; g.strokeRect(bx+1,by+1,S-2,S-2);
    g.beginPath(); g.moveTo(bx+3,by+3); g.lineTo(bx+S-3,by+S-3); g.moveTo(bx+S-3,by+3); g.lineTo(bx+3,by+S-3); g.stroke();
    if(hp<60){ g.strokeStyle='rgba(40,25,10,.7)'; g.lineWidth=1.2; g.beginPath(); g.moveTo(bx+8,by+4); g.lineTo(bx+14,by+13); g.lineTo(bx+10,by+20);
      if(hp<35){ g.moveTo(bx+S-6,by+S-4); g.lineTo(bx+S-14,by+S-12); g.lineTo(bx+S-10,by+S-20); } g.stroke(); } }
  // 아이템
  for(const it of inf.items) if(vis(it[3],it[4],30)) infDrawItem(g,it,t);
  // 캐릭터 (아래쪽부터 그려야 겹침이 자연스럽다)
  const list=[...inf.ps.values()].map(o=>({...o,side:'gpu',walking:!!(o.fl&4),prot:!!(o.fl&1),swing:!!(o.fl&2)}));
  if(m && !m.dead) list.push({id:inf.id,x:inf.px,y:inf.py,aim:inf.aim,hp:m.hp,w:m.cur,ch:m.ch,name:me.name,side:'cpu',walking:!!(input.mx||input.my),prot:m.prot,swing:m.cur==='knife'&&m.cd>0.25,mine:true});
  list.sort((a,b)=>a.y-b.y);
  for(const c of list){ if(!vis(c.x,c.y,60)) continue;
    g.fillStyle='rgba(31,35,40,.17)'; g.beginPath(); g.ellipse(c.x,c.y+13,11,3.5,0,0,6.283); g.fill();
    if(c.mine){ g.fillStyle='rgba(255,255,255,.75)'; g.beginPath(); g.ellipse(c.x,c.y+13,14,5,0,0,6.283); g.fill(); }
    if(c.prot) g.globalAlpha=0.5+0.3*Math.sin(t*12);
    const back=Math.sin(c.aim)<-0.3;
    if(back) infDrawWeapon(g,c.x,c.y,c.aim,c.w,c.swing);
    infDrawChar(g,c,c.aim,c.walking,t);
    if(!back) infDrawWeapon(g,c.x,c.y,c.aim,c.w,c.swing);
    g.globalAlpha=1;
    const top=c.y-36;
    g.fillStyle='rgba(31,35,40,.35)'; g.fillRect(c.x-16,top-1,32,5);
    g.fillStyle= c.hp>30? (c.mine?'#1f6fe0':'#e5484d') : '#ff9f43'; g.fillRect(c.x-15,top,30*Math.max(0,c.hp)/inf.hpMax,3);
    g.font='bold 10px sans-serif'; g.textAlign='center'; const tw=g.measureText(c.name).width;
    g.fillStyle= c.mine? 'rgba(15,74,168,.8)' : 'rgba(31,35,40,.62)'; g.fillRect(c.x-tw/2-3,top-14,tw+6,12);
    g.fillStyle='#fff'; g.fillText(c.name,c.x,top-5); g.textAlign='left'; }
  // 총알 (받은 위치에서 속도만큼 앞으로)
  const el=(performance.now()-inf.snapAt)/1000;
  for(const b of inf.bullets){ const bx=b.x+b.vx*el, by=b.y+b.vy*el; if(!vis(bx,by,20)) continue;
    const sp=Math.hypot(b.vx,b.vy)||1, ux=b.vx/sp, uy=b.vy/sp;
    if(b.w==='bazooka'){ g.fillStyle='rgba(255,159,67,.7)'; g.beginPath(); g.arc(bx-ux*10,by-uy*10,5+Math.random()*2,0,6.283); g.fill();
      g.strokeStyle='#3b4a2a'; g.lineWidth=6; g.beginPath(); g.moveTo(bx-ux*8,by-uy*8); g.lineTo(bx+ux*5,by+uy*5); g.stroke(); }
    else { const L= b.w==='rifle'?22 : b.w==='shotgun'?7 : 12;
      g.strokeStyle='rgba(240,140,20,.75)'; g.lineWidth= b.w==='mg'?3.5:3; g.beginPath(); g.moveTo(bx-ux*L*1.4,by-uy*L*1.4); g.lineTo(bx,by); g.stroke();
      g.fillStyle='#3a2a10'; g.beginPath(); g.arc(bx,by,2.6,0,6.283); g.fill(); } }
  // 효과
  for(let i=inf.slashes.length-1;i>=0;i--){ const s=inf.slashes[i]; s.t-=dt; if(s.t<=0){ inf.slashes.splice(i,1); continue; }
    g.strokeStyle=`rgba(255,255,255,${s.t/0.18})`; g.lineWidth=4; g.beginPath(); g.arc(s.x,s.y,40,s.a-0.6,s.a+0.6); g.stroke(); }
  for(let i=inf.rings.length-1;i>=0;i--){ const r=inf.rings[i]; r.t-=dt; if(r.t<=0){ inf.rings.splice(i,1); continue; }
    const f=1-r.t/0.45; g.fillStyle=`rgba(255,159,67,${0.45*(1-f)})`; g.beginPath(); g.arc(r.x,r.y,20+f*85,0,6.283); g.fill();
    g.strokeStyle=`rgba(229,72,77,${0.8*(1-f)})`; g.lineWidth=3; g.stroke(); }
  for(let i=inf.parts.length-1;i>=0;i--){ const p=inf.parts[i]; p.t-=dt; if(p.t<=0){ inf.parts.splice(i,1); continue; }
    p.x+=p.vx*dt; p.y+=p.vy*dt; p.vx*=0.92; p.vy*=0.92; g.globalAlpha=Math.min(1,p.t/p.life*1.6); g.fillStyle=p.col; g.fillRect(p.x,p.y,p.sz,p.sz); }
  g.globalAlpha=1;
  // 조준선 (화면 좌표)
  g.setTransform(inf.dpr,0,0,inf.dpr,0,0);
  if(m && !m.dead){ const sx=inf.mouse.x, sy=inf.mouse.y; g.strokeStyle='rgba(31,35,40,.7)'; g.lineWidth=1.5;
    g.beginPath(); g.arc(sx,sy,8,0,6.283); g.moveTo(sx-13,sy); g.lineTo(sx-4,sy); g.moveTo(sx+4,sy); g.lineTo(sx+13,sy); g.moveTo(sx,sy-13); g.lineTo(sx,sy-4); g.moveTo(sx,sy+4); g.lineTo(sx,sy+13); g.stroke(); }
  infDrawMini();
}
