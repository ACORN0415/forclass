#!/usr/bin/env node
// 캐릭터 밸런스 측정: 같은 규칙으로 캐릭터 5명 팀끼리 풀리그.  node balance.js [--rounds 4]
const fs=require('fs'), path=require('path');
const { engine, runMatch, BASELINE } = require('./sim.js');
const src=fs.readFileSync(path.join(__dirname,'arena.html'),'utf8');
const m=src.match(/const CHARS=\[([\s\S]*?)\n\];/); const CHARS=new Function('return ['+m[1]+']')();
const ri=process.argv.indexOf('--rounds'); const R= ri>0? +process.argv[ri+1]||4 : 4;
const stat=Object.fromEntries(CHARS.map(c=>[c.id,{w:0,n:0,gf:0,ga:0,name:c.name,side:engine.sideOfBuild(c.build)}]));
const grid={};
for(let i=0;i<CHARS.length;i++) for(let j=i+1;j<CHARS.length;j++){
  const A={name:CHARS[i].id,build:CHARS[i].build,rules:[]}, B={name:CHARS[j].id,build:CHARS[j].build,rules:[]};
  let wa=0;
  for(let k=0;k<R;k++){ const r=runMatch(A,B); stat[A.name].gf+=r.a; stat[A.name].ga+=r.b; stat[B.name].gf+=r.b; stat[B.name].ga+=r.a; stat[A.name].n++; stat[B.name].n++;
    if(r.a>r.b){stat[A.name].w++; wa++;} else if(r.b>r.a) stat[B.name].w++; else { stat[A.name].w+=.5; stat[B.name].w+=.5; wa+=.5; } }
  grid[A.name+'|'+B.name]=wa/R;
}
const rows=Object.entries(stat).sort((a,b)=>b[1].w/b[1].n-a[1].w/a[1].n);
for(const [id,s] of rows) console.log(`${s.name.padEnd(6)} ${s.side.toUpperCase()}  승률 ${(100*s.w/s.n).toFixed(0).padStart(3)}%  득실 ${s.gf}:${s.ga}`);
