#!/usr/bin/env node
/**
 * host.js — 브라우저 없이 방장 노릇을 하는 경기 서버 (학생 PC 성능과 무관하게 60Hz 계산)
 *
 *   node host.js                       http://localhost:8000 에 "경기서버" 로 접속해 방을 만든다
 *   node host.js ws://192.168.0.5:8000 --title "1반 눈싸움" --map canyon --bots --auto
 *
 *   --auto     모든 사람이 준비를 누르면 자동 시작 (아니면 터미널에서 s 입력)
 *   --bots     시작할 때 bots/*.json 규칙봇으로 빈 자리를 채움
 *   --rounds N 경기가 끝나면 N판까지 자동으로 다음 판 (기본 1)
 *
 * 터미널 명령:  s 시작 · b 봇 불러오기 · m <snow|canyon|plaza> 맵 · r 결과 후 방으로 · q 종료
 * 선생님은 브라우저 로비에서 이 방을 [관전] 하면 전체 시야로 프로젝터에 띄울 수 있습니다.
 */
const fs = require('fs'), path = require('path'), readline = require('readline');
const { engine } = require('./sim.js');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const URL0 = (args.find(a => /^wss?:\/\//.test(a)) || 'ws://127.0.0.1:8000').replace(/\/$/, '') + '/ws';
const TITLE = opt('--title', '경기 서버 방'), AUTO = args.includes('--auto'), USEBOTS = args.includes('--bots');
const ROUNDS = +opt('--rounds', 1) || 1;
let mapId = opt('--map', 'snow');
const { WORLD_W, WORLD_H, ROUND_TIME } = { WORLD_W: 960, WORLD_H: 600, ROUND_TIME: 90 };
if (typeof WebSocket === 'undefined') { console.error('Node 22 이상이 필요합니다 (내장 WebSocket).'); process.exit(1); }

let ws, me = 0, room = null, world = null, timer = null, roundNo = 0, bots = [], lastSnap = 0;
const send = o => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); };
const log = (...a) => console.log(new Date().toTimeString().slice(0, 8), ...a);

function snapshot(w) {
  return { t: 's', tt: +w.t.toFixed(2), sc: [w.score.cpu, w.score.gpu], ov: w.over ? 1 : 0, wn: w.winner || '',
    c: w.chars.map(c => [Math.round(c.x), Math.round(c.y), c.hp, c.alive ? 1 : 0, +(c.windup > 0 ? c.windDir : c.aim).toFixed(2), +c.windup.toFixed(2), c.ammo, c.kills, c.hits, c.lives, c.out ? 1 : 0]),
    b: w.balls.map(b => [Math.round(b.x), Math.round(b.y), Math.round(b.vx), Math.round(b.vy), (b.side === 'cpu' ? 0 : 1) + ((b.dmg || 1) > 2 ? 2 : 0)]),
    a: w.ammo.map(a => [Math.round(a.x), Math.round(a.y)]),
    f: w.hitFx.map(f => [Math.round(f.x), Math.round(f.y), f.side === 'cpu' ? 0 : 1, +f.t.toFixed(2)]) };
}
function broadcastInit() {
  send({ t: 'init', map: mapId, slots: world.chars.map(c => ({ s: c.side, n: c.name || '봇', r: c.remote || 0, l: c.prof.lanes, b: (c.isBotAI || c.rules) ? 1 : 0, ch: c.ch || '', bb: c.remote ? c.prof.build : null })) });
}
function loadBots() {   // 공용 bots/ + 이 방 폴더 rooms/<방>/bots (같은 이름이면 방 봇이 이김)
  bots = [];
  const dirs = [path.join(__dirname, 'bots')];
  if (room && room.dir) dirs.push(path.join(__dirname, 'rooms', room.dir, 'bots'));
  const at = new Map();
  for (const dir of dirs.filter(d => fs.existsSync(d))) {
    for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort()) {
      try { const b = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); if (b.rules && b.rules.length) { b.name = String(b.name || path.basename(f, '.json')).normalize('NFC');
        if (at.has(b.name)) bots[at.get(b.name)] = b; else { at.set(b.name, bots.length); bots.push(b); } } } catch (e) { }
    }
  }
  log(`규칙봇 ${bots.length}개 불러옴${room && room.dir ? ' (공용 + ' + room.dir + ')' : ''}`);
}
function teamLives(side) { return world.chars.filter(c => c.side === side).reduce((a, c) => a + c.lives, 0); }
function startMatch() {
  if (!room || world) return;
  if (USEBOTS) loadBots();   // 시작하는 순간 공용·방 폴더 봇을 새로 읽는다
  engine.setMap(mapId);
  const members = room.members.filter(m => m.id !== me && !m.watch);
  const sideA = 'cpu';
  world = engine.makeWorld(engine.PRESETS.cpu, -1, sideA);
  for (const c of world.chars) { c.isPlayer = false; }
  world.chars[0].name = '봇';
  let people = 0;
  for (const m of members) { const c = engine.seatRemote(world, m.id, m.name, m.b || engine.PRESETS.gpu, m.team === 'gpu' ? 'gpu' : 'cpu'); if (c) { people++; c.ch = (m.b && m.b.ch) || null; } }
  let seated = 0;
  const order = bots.slice().sort((a, b) => (b.team ? 1 : 0) - (a.team ? 1 : 0));   // 팀을 정한 봇이 먼저 (seatBot 이 team 을 읽음)
  for (const b of order) { const c = engine.seatBot(world, b); if (c) { seated++; c.ch = (b.build && b.build.ch) || null; } }
  roundNo++;
  log(`▶ ${roundNo}판 시작 — 맵 ${mapId} · 사람 ${people}명 · 규칙봇 ${seated}개`);
  send({ t: 'start' });
  broadcastInit();
  let last = Date.now(), acc = 0, countdown = 3.5;
  timer = setInterval(() => {
    const now = Date.now(), dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (countdown > 0) { countdown -= dt; if (now - lastSnap > 45) { lastSnap = now; send(snapshot(world)); } return; }
    acc += dt; let n = 0;
    while (acc >= 1 / 60 && n < 4) { engine.stepWorld(world, 1 / 60); acc -= 1 / 60; n++; }
    if (now - lastSnap > 45) { lastSnap = now; send(snapshot(world)); }
    if (world.over) endMatch();
  }, 16);
}
function endMatch() {
  clearInterval(timer); timer = null;
  const payload = engine.resultPayload(world);
  payload.pk = world.chars.filter(c => c.remote).map(c => [c.remote, c.kills, c.hits]);
  send(payload);
  log(`■ 종료 — ${world.winner ? engine.TEAM[world.winner] + ' 승' : '무승부'} · 목숨 ${payload.lives[0]}:${payload.lives[1]} · 처치 ${world.score.cpu}:${world.score.gpu}`);
  world = null;
  setTimeout(() => { send({ t: 'end' }); if (roundNo < ROUNDS) setTimeout(startMatch, 4000); }, 8000);
}

function connect() {
  ws = new WebSocket(URL0);
  ws.onopen = () => { log('서버 연결', URL0); send({ t: 'hello', name: '경기서버' }); };
  ws.onclose = () => { log('연결 끊김 — 3초 후 재접속'); clearInterval(timer); timer = null; world = null; setTimeout(connect, 3000); };
  ws.onerror = () => { };
  ws.onmessage = e => {
    let m; try { m = JSON.parse(e.data); } catch (_) { return; }
    switch (m.t) {
      case 'welcome': me = m.id; send({ t: 'create_room', title: TITLE, b: engine.PRESETS.cpu }); return;
      case 'room': room = m; if (m.map !== mapId) send({ t: 'map', id: mapId });
        if (m.host !== me) { log('방장이 아닙니다 (다른 사람이 방장) — 종료'); process.exit(0); }
        { const others = m.members.filter(x => x.id !== me), rd = others.filter(x => x.ready).length;
          if (!world) log(`방 ${m.id} "${m.title}" — 참가 ${others.length}명 (준비 ${rd}) ${others.map(x => x.name).join(', ')}`);
          if (AUTO && !world && others.length && rd === others.length && m.state === 'waiting') setTimeout(startMatch, 1500); }
        return;
      case 'chat': if (!m.sys) log('💬', m.from + ':', m.text); if (!m.sys && /^!시작$/.test(m.text)) startMatch(); return;
      case 'left': if (world) { const c = world.chars.find(x => x.remote === m.id); if (c) { c.remote = 0; c.rin = null; c.name += '(봇)'; } } return;
      case 'away': if (world) { const c = world.chars.find(x => x.remote === m.id); if (c) { c.away = c.remote; c.remote = 0; c.rin = null; } } return;
      case 'rejoin': if (world) { const c = world.chars.find(x => x.away === m.id); if (c) { c.remote = c.away; c.away = 0; c.rin = { mx: 0, my: 0, aim: 0 }; } broadcastInit(); } return;
      case 'in': if (world) { const c = world.chars.find(x => x.remote === m.id); if (c) c.rin = { mx: m.mx, my: m.my, aim: m.aim, sp: m.sp }; } return;
      case 'th': if (world) { const c = world.chars.find(x => x.remote === m.id); if (c) { c.rin = c.rin || { mx: 0, my: 0, aim: 0 }; c.rin.aim = m.aim; engine.tryThrow(world, c, m.aim); } } return;
      case 'err': log('오류:', m.msg); return;
    }
  };
}
if (USEBOTS) loadBots();
connect();
const rl = readline.createInterface({ input: process.stdin });
console.log('명령: s 시작 · b 봇 불러오기 · m <맵> · r 방으로 · q 종료   (채팅에 "!시작" 을 쳐도 시작)');
rl.on('line', line => {
  const [cmd, arg] = line.trim().split(/\s+/);
  if (cmd === 's') startMatch();
  else if (cmd === 'b') loadBots();
  else if (cmd === 'm' && engine.MAPS[arg]) { mapId = arg; send({ t: 'map', id: mapId }); log('맵:', mapId); }
  else if (cmd === 'r') send({ t: 'end' });
  else if (cmd === 'q') process.exit(0);
});
