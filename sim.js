#!/usr/bin/env node
/**
 * sim.js — 규칙표 봇을 화면 없이 돌려보는 시험 대전기.
 *
 *   node sim.js bots/학생A.json            기준 봇과 5판
 *   node sim.js bots/A.json bots/B.json    두 봇끼리 5판
 *   node sim.js bots/A.json --rounds 10 --json
 *   node sim.js bots/A.json --map canyon      (snow | canyon | plaza)
 *
 * 게임 규칙은 arena.html 의 ENGINE 구간을 그대로 읽어서 씁니다.
 * (규칙이 한 곳에만 있으므로 게임과 시험 결과가 절대 어긋나지 않습니다)
 */
const fs = require('fs');
const path = require('path');

const HERE = __dirname;
const src = fs.readFileSync(path.join(HERE, 'arena.html'), 'utf8');
const m = src.match(/\/\* ==ENGINE-START==[\s\S]*?\*\/([\s\S]*?)\/\* ==ENGINE-END== \*\//);
if (!m) { console.error('arena.html 에서 ENGINE 구간을 찾지 못했습니다.'); process.exit(2); }

// 엔진이 기대하는 최소한의 바깥 환경 (화면·입력 없음)
const sandbox = {
  WORLD_W: 960, WORLD_H: 600, ROUND_TIME: 90,
  input: { mx: 0, my: 0, aim: 0, sprint: false },
  toast: () => {},
  Math, JSON, console, Object, Array, Number, String, Boolean, Set, Map, isNaN, parseInt, parseFloat, Infinity, NaN, undefined,
};
const keys = Object.keys(sandbox);
const engine = new Function(...keys, m[1] + '\nreturn {makeWorld,seatBot,seatRemote,stepWorld,tryThrow,profile,PRESETS,sideOfBuild,parseCond,RULE_ACTS,RULE_VARS,RULE_OPS,LANES,SPEC,BUDGET,buildCost,MAPS,setMap,resultPayload,TEAM};')
  (...keys.map(k => sandbox[k]));

const BASELINE = { name: '기준봇', build: 'gpu', rules: [
  { when: '탄약 < 6', do: '탄약수집' },
  { when: '체력 <= 1', do: '후퇴' },
  { when: '부채꼴적 >= 1', do: '던지기' },
  { when: 'always', do: '거리유지', value: 280 },
] };

function loadBot(p) {
  const b = JSON.parse(fs.readFileSync(p, 'utf8'));
  b.name = String(b.name || path.basename(p, '.json')).normalize('NFC');   // Mac 한글 파일명(NFD) 대비
  return b;
}

/* ---------------- 규칙표 검증 ---------------- */
function validate(bot) {
  const errs = [], warns = [];
  if (!bot || typeof bot !== 'object') return { errs: ['JSON 이 객체가 아닙니다'], warns };
  if (!bot.name || typeof bot.name !== 'string') errs.push('name 이 없습니다 (문자열)');
  const b = bot.build;
  if (typeof b === 'string') {
    if (!engine.PRESETS[b]) errs.push(`build 가 "cpu" 또는 "gpu" 여야 합니다 (받은 값: ${b})`);
  } else if (b && typeof b === 'object') {
    for (const k of ['render', 'lane', 'clock', 'mem']) {
      if (!Number.isInteger(b[k])) errs.push(`build.${k} 는 정수여야 합니다`);
    }
    if (!errs.length) {
      const cost = engine.buildCost(b);
      if (cost > engine.BUDGET) errs.push(`빌드 예산 초과: ${cost} / ${engine.BUDGET}`);
    }
  } else errs.push('build 가 없습니다 ("cpu" | "gpu" | {render,lane,clock,mem})');

  if (!Array.isArray(bot.rules) || !bot.rules.length) errs.push('rules 가 비어 있습니다');
  else {
    if (bot.rules.length > 12) warns.push(`규칙이 ${bot.rules.length}개입니다 — 8개 이하를 권합니다`);
    bot.rules.forEach((r, i) => {
      const n = i + 1;
      if (!r || typeof r !== 'object') { errs.push(`${n}번 규칙이 객체가 아닙니다`); return; }
      const c = engine.parseCond(r.when);
      if (!c) errs.push(`${n}번 규칙의 when "${r.when}" 을 해석할 수 없습니다 — "<변수> <연산자> <숫자>" 또는 "always". 변수: ${Object.keys(engine.RULE_VARS).filter(k => /[가-힣]/.test(k)).join(', ')}`);
      if (!engine.RULE_ACTS.has(r.do)) errs.push(`${n}번 규칙의 do "${r.do}" 는 없는 행동입니다 — ${[...engine.RULE_ACTS].join(', ')}`);
      if (r.do === '거리유지' && !(Number(r.value) > 0)) warns.push(`${n}번 거리유지에 value 가 없어 250 으로 봅니다`);
    });
    const last = bot.rules[bot.rules.length - 1];
    if (last && engine.parseCond(last.when) && !engine.parseCond(last.when).always)
      warns.push('마지막 규칙은 when:"always" 인 기본 행동으로 두는 편이 안전합니다');
    if (!bot.rules.some(r => r.do === '던지기')) warns.push('던지기 규칙이 없습니다 — 공격을 하지 않습니다');
    if (!bot.rules.some(r => r.do === '탄약수집')) warns.push('탄약수집 규칙이 없습니다 — 탄약이 떨어지면 아무것도 못 합니다');
  }
  return { errs, warns };
}

/* ---------------- 시험 대전 ---------------- */
function runMatch(botA, botB) {
  const sideA = 'cpu';   // botA = A팀, botB = B팀 (팀은 캐릭터 종류와 무관)
  const w = engine.makeWorld(engine.PRESETS[sideA] || engine.PRESETS.gpu, 0, sideA);
  w.chars[0].isPlayer = false;
  // 내 편 5명 = botA, 상대 5명 = botB
  for (const c of w.chars) {
    const bot = c.side === sideA ? botA : botB;
    const bb = typeof bot.build === 'string' ? engine.PRESETS[bot.build] : bot.build;
    c.prof = engine.profile(bb || engine.PRESETS.gpu);
    c.ammo = c.prof.maxAmmo;
    c.rules = bot.rules.map(r => ({ ...r }));
    c.name = bot.name;
  }
  let guard = 0;
  while (!w.over && guard < 7000) { engine.stepWorld(w, 1 / 60); guard++; }
  const mine = w.chars.filter(c => c.side === sideA), theirs = w.chars.filter(c => c.side !== sideA);
  const thr = mine.reduce((s, c) => s + c.throws, 0), hit = mine.reduce((s, c) => s + c.lanesHit, 0), fired = mine.reduce((s, c) => s + c.lanesFired, 0);
  const hitB = theirs.reduce((s, c) => s + c.lanesHit, 0), firedB = theirs.reduce((s, c) => s + c.lanesFired, 0);
  return { a: w.score[sideA], b: w.score[sideA === 'cpu' ? 'gpu' : 'cpu'], throws: thr, acc: fired ? hit / fired * 100 : 0, accB: firedB ? hitB / firedB * 100 : 0 };
}

function main() {
  const args = process.argv.slice(2);
  const asJson = args.includes('--json');
  const ri = args.indexOf('--rounds');
  const rounds = ri >= 0 ? Math.max(1, Math.min(20, +args[ri + 1] || 5)) : 5;
  const mi = args.indexOf('--map'); if (mi >= 0) engine.setMap(args[mi + 1]);
  const files = args.filter((a, i) => !a.startsWith('--') && !/^\d+$/.test(a) && args[i - 1] !== '--map');
  if (!files.length) { console.error('사용법: node sim.js <봇.json> [상대봇.json] [--rounds 5] [--json]'); process.exit(2); }

  let botA, botB;
  try { botA = loadBot(files[0]); } catch (e) { console.error('JSON 을 읽지 못했습니다:', e.message); process.exit(1); }
  try { botB = files[1] ? loadBot(files[1]) : BASELINE; } catch (e) { console.error('상대 봇 오류:', e.message); process.exit(1); }

  const v = validate(botA);
  if (v.errs.length) {
    const out = { ok: false, name: botA.name, errors: v.errs, warnings: v.warns };
    console.log(asJson ? JSON.stringify(out, null, 2) : '✗ 규칙표 오류\n' + v.errs.map(e => '  - ' + e).join('\n'));
    process.exit(1);
  }

  let win = 0, draw = 0, sa = 0, sb = 0, acc = 0, thr = 0;
  for (let i = 0; i < rounds; i++) {
    const r = runMatch(botA, botB);
    sa += r.a; sb += r.b; acc += r.acc; thr += r.throws;
    if (r.a > r.b) win++; else if (r.a === r.b) draw++;
  }
  const res = {
    ok: true, name: botA.name, opponent: botB.name, rounds,
    wins: win, draws: draw, losses: rounds - win - draw,
    avgScore: +(sa / rounds).toFixed(1), avgOpponent: +(sb / rounds).toFixed(1),
    hitRate: +(acc / rounds).toFixed(1), throws: Math.round(thr / rounds),
    warnings: v.warns,
  };
  if (asJson) { console.log(JSON.stringify(res, null, 2)); return; }
  console.log(`✓ 규칙표 통과 — ${res.name} vs ${res.opponent}, ${rounds}판`);
  console.log(`  전적    ${res.wins}승 ${res.draws}무 ${res.losses}패`);
  console.log(`  평균점수 ${res.avgScore} : ${res.avgOpponent}`);
  console.log(`  명중률  ${res.hitRate}%   던진 횟수 ${res.throws}`);
  if (res.warnings.length) console.log('  참고\n' + res.warnings.map(x => '   · ' + x).join('\n'));
}
if(require.main===module) main();
module.exports={ engine, validate, runMatch, loadBot, BASELINE };
