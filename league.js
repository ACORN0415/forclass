#!/usr/bin/env node
/**
 * league.js — bots/ 안의 규칙봇 전원 풀리그 → league.json
 *
 *   node league.js                 각 조합 3판
 *   node league.js --rounds 5
 *   node league.js --audit         리그는 안 돌리고 제출문·봇 파일 점검(해킹전 탐지)만
 *   node league.js --room 001_1반  그 방 봇(+공용 bots/)만 리그
 *
 * 봇은 공용 bots/ 와 방마다 rooms/<방>/bots 에 있다 (방 제출문은 rooms/<방>/submissions).
 *
 * 결과는 arena.html 의 [봇 리그] 화면이 읽습니다 (league.json).
 */
const fs = require('fs'), path = require('path');
const { engine, validate, runMatch, loadBot } = require('./sim.js');
const HERE = __dirname, BOT_DIR = path.join(HERE, 'bots'), SUB_DIR = path.join(HERE, 'submissions');
const args = process.argv.slice(2);
// Mac 은 한글 파일명을 자모 분리형(NFD)으로 돌려줄 수 있다 → 이름 비교는 항상 NFC 로 맞춘다 (파일은 디스크 이름 그대로 연다)
const nfc = s => String(s).normalize('NFC');
const stemOf = (f, ext) => nfc(path.basename(f, ext));
const ROOMS_DIR = path.join(HERE, 'rooms'), ARCHIVE = '_지난방';
const rmi = args.indexOf('--room'); const ONLY_ROOM = rmi >= 0 ? nfc(args[rmi + 1] || '') : null;
// 봇 묶음: 공용(bots/ · submissions/) + 진행 중인 방마다 (rooms/<방>/bots · submissions). 지난방은 제외
function pools() {
  const out = [{ label: '', bot: BOT_DIR, sub: SUB_DIR }];
  const dirs = fs.existsSync(ROOMS_DIR) ? fs.readdirSync(ROOMS_DIR).filter(d => d !== ARCHIVE && fs.existsSync(path.join(ROOMS_DIR, d, 'bots'))) : [];
  for (const d of dirs.sort()) if (!ONLY_ROOM || nfc(d) === ONLY_ROOM) out.push({ label: nfc(d), bot: path.join(ROOMS_DIR, d, 'bots'), sub: path.join(ROOMS_DIR, d, 'submissions') });
  return out;
}
const ri = args.indexOf('--rounds'); const ROUNDS = ri >= 0 ? Math.max(1, Math.min(9, +args[ri + 1] || 3)) : 3;

/* ---------- 해킹전 탐지: 제출문·봇 파일 점검 ---------- */
const SUS = [/무시(해|하)/, /지워|삭제|제거/, /다른\s*(학생|사람|봇|팀)/, /CLAUDE\.md|sim\.js|league|arena|서버|파일/i, /규칙을?\s*(바꿔|수정|고쳐)/,
  /ignore|previous|instruction|system|override|admin|root/i, /선생님|관리자|권한|허락/, /모든\s*봇/, /던지기.*(빼|없애|금지)/,
  /에이전트(에게|한테|야)|claude|클로드|AI에게/i, /^\s*#\s*학생\s*:/m, /예산.*(무시|초과)/, /json|\{\s*"/i];
function audit() {
  const out = [];
  for (const pool of pools()) auditPool(pool, out);
  return out;
}
function auditPool({ label, bot: BOT_DIR, sub: SUB_DIR }, out) {
  const at = f => (label ? label + '/' : '') + f;
  const subs = fs.existsSync(SUB_DIR) ? fs.readdirSync(SUB_DIR).filter(f => f.endsWith('.txt')) : [];
  const names = subs.map(f => stemOf(f, '.txt'));
  const subByStem = new Map(subs.map(f => [stemOf(f, '.txt'), f]));
  for (const f of subs) {
    const raw = nfc(fs.readFileSync(path.join(SUB_DIR, f), 'utf8'));
    const body = raw.replace(/^# .*$/gm, '');                       // 서버가 붙인 머리글 제외
    const stem = stemOf(f, '.txt');
    const hits = SUS.filter(r => r.test(body));
    if (hits.length >= 2) out.push({ kind: '제출문', file: at(f), why: `의심 표현 ${hits.length}개 — 전략이 아니라 에이전트에게 말을 거는 문장이 있는지 확인` });
    const others = names.filter(n => n !== stem && n.length >= 2 && body.includes(n));
    if (others.length) out.push({ kind: '제출문', file: at(f), why: `다른 학생 이름 언급: ${others.join(', ')} — 남의 봇을 노린 문장일 수 있음` });
    if (/[\u200b-\u200f\u2060\ufeff]/.test(body)) out.push({ kind: '제출문', file: at(f), why: '보이지 않는 문자(zero-width) 포함 — 숨긴 글' });
    if (/<!--|-->|\/\*|\*\//.test(body)) out.push({ kind: '제출문', file: at(f), why: '주석 기호 안에 숨긴 글' });
    if (/[A-Za-z0-9+\/]{40,}={0,2}/.test(body)) out.push({ kind: '제출문', file: at(f), why: '긴 영숫자 덩어리 — 인코딩한 지시일 수 있음' });
    const hdr = (raw.match(/^# 학생:/gm) || []).length;
    if (hdr > 1) out.push({ kind: '제출문', file: at(f), why: '"# 학생:" 머리글이 여러 개 — 다른 이름으로 위장' });
    if (body.length > 1200) out.push({ kind: '제출문', file: at(f), why: `제출문이 ${body.length}자 — 전략치고 너무 김` });
  }
  const bots = fs.existsSync(BOT_DIR) ? fs.readdirSync(BOT_DIR).filter(f => f.endsWith('.json')) : [];
  for (const f of bots) {
    let b; try { b = JSON.parse(fs.readFileSync(path.join(BOT_DIR, f), 'utf8')); } catch (e) { out.push({ kind: '봇', file: at(f), why: 'JSON 깨짐' }); continue; }
    const stem = stemOf(f, '.json');
    if (b.name && nfc(b.name) !== stem) out.push({ kind: '봇', file: at(f), why: `파일명(${stem})과 name(${b.name})이 다름 — 남의 봇을 덮어썼을 수 있음` });
    const v = validate(b);
    if (v.errs.length) out.push({ kind: '봇', file: at(f), why: '규칙표 오류: ' + v.errs[0] });
    if (!(b.rules || []).some(r => r.do === '던지기')) out.push({ kind: '봇', file: at(f), why: '던지기 규칙 없음 — 무력화된 봇' });
    if (!(b.rules || []).some(r => r.do === '탄약수집')) out.push({ kind: '봇', file: at(f), why: '탄약수집 없음' });
    if ((b.rules || []).length && (b.rules || []).every(r => r.do === '대기')) out.push({ kind: '봇', file: at(f), why: '대기만 하는 봇' });
    for (const k of Object.keys(b)) if (!['name', 'build', 'rules', 'note', 'team', 'room'].includes(k)) { out.push({ kind: '봇', file: at(f), why: `알 수 없는 항목 "${k}"` }); break; }
    const sub = subByStem.has(stem) ? path.join(SUB_DIR, subByStem.get(stem)) : null;
    if (['기준봇', '공격형'].includes(stem)) continue;      // 샘플 봇
    if (!sub) out.push({ kind: '봇', file: at(f), why: '제출문이 없는 봇 — 누가 만들었나?' });
    else if (fs.statSync(path.join(BOT_DIR, f)).mtimeMs < fs.statSync(sub).mtimeMs - 1000) out.push({ kind: '봇', file: at(f), why: '제출문보다 오래된 봇 — 재제출 반영 안 됨' });
  }
}

function main() {
  const findings = audit();
  if (args.includes('--audit')) {
    console.log(findings.length ? '⚠ 점검 결과\n' + findings.map(f => `  [${f.kind}] ${f.file}: ${f.why}`).join('\n') : '✓ 이상 없음');
    return;
  }
  const bots = [];
  for (const pool of pools()) {
    const files = fs.existsSync(pool.bot) ? fs.readdirSync(pool.bot).filter(f => f.endsWith('.json')).sort() : [];
    for (const f of files) {
      const at = (pool.label ? pool.label + '/' : '') + f;
      try { const b = loadBot(path.join(pool.bot, f)); const v = validate(b); if (v.errs.length) { console.log('  건너뜀 (오류):', at, '-', v.errs[0]); continue; }
        if (pool.label) b.name = `${b.name} (${pool.label.replace(/^\d+_/, '')})`;
        bots.push(b); }
      catch (e) { console.log('  건너뜀 (JSON):', at); }
    }
  }
  if (bots.length < 2) { console.log('봇이 2개 이상 필요합니다 (bots/ · rooms/<방>/bots)'); process.exit(1); }
  const side = b => typeof b.build === 'string' ? b.build : engine.sideOfBuild(b.build);
  const tab = Object.fromEntries(bots.map(b => [b.name, { name: b.name, side: side(b), ch: (b.build && b.build.ch) || '', rules: (b.rules || []).length, note: b.note || '', w: 0, d: 0, l: 0, pts: 0, gf: 0, ga: 0, hit: 0, n: 0 }]));
  const matches = [];
  console.log(`봇 ${bots.length}개 · 조합 ${bots.length * (bots.length - 1) / 2}개 · 각 ${ROUNDS}판`);
  for (let i = 0; i < bots.length; i++) for (let j = i + 1; j < bots.length; j++) {
    const A = bots[i], B = bots[j], rs = [];
    for (let k = 0; k < ROUNDS; k++) {
      const r = runMatch(A, B); rs.push([r.a, r.b]);
      const ta = tab[A.name], tb = tab[B.name];
      ta.gf += r.a; ta.ga += r.b; tb.gf += r.b; tb.ga += r.a; ta.hit += r.acc; ta.n++; tb.hit += r.accB; tb.n++;
      if (r.a > r.b) { ta.w++; tb.l++; ta.pts += 3; } else if (r.a < r.b) { tb.w++; ta.l++; tb.pts += 3; } else { ta.d++; tb.d++; ta.pts++; tb.pts++; }
    }
    matches.push({ a: A.name, b: B.name, rs });
    process.stdout.write(`  ${A.name} vs ${B.name}: ${rs.map(x => x.join(':')).join('  ')}\n`);
  }
  const standings = Object.values(tab).map(t => ({ ...t, hit: t.n ? +(t.hit / t.n).toFixed(1) : 0 }))
    .sort((x, y) => y.pts - x.pts || (y.gf - y.ga) - (x.gf - x.ga) || y.gf - x.gf);
  const out = { when: new Date().toISOString(), rounds: ROUNDS, standings, matches, findings };
  fs.writeFileSync(path.join(HERE, 'league.json'), JSON.stringify(out, null, 1));
  console.log('\n순위');
  standings.forEach((t, i) => console.log(`  ${String(i + 1).padStart(2)}. ${t.name.padEnd(10)} ${t.side.toUpperCase()}  ${t.w}승 ${t.d}무 ${t.l}패  승점 ${t.pts}  득실 ${t.gf}:${t.ga}  명중 ${t.hit}%`));
  if (findings.length) console.log('\n⚠ 점검\n' + findings.map(f => `  [${f.kind}] ${f.file}: ${f.why}`).join('\n'));
  console.log('\n→ league.json 저장. 게임 화면의 [봇 리그]에서 새로고침하세요.');
}
main();
