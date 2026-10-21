import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { renderCoursePackage } from './course-render.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const _IS_KIT = fs.existsSync(path.join(__dirname,'course','course.html'));
const ROOT = _IS_KIT ? __dirname : path.resolve(__dirname, '..');
const DATA_DIR = path.join(__dirname, 'data');
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const PORT = Number(process.env.PORT || 8899);
const DS_KEY = process.env.DEEPSEEK_API_KEY || '';
const DS_BASE = process.env.DEEPSEEK_BASE || 'https://api.deepseek.com';
const DS_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-flash';
const GROUPS = ['A','B','C','D','E','F','G'];
const ROOMS_DIR = path.join(DATA_DIR,'rooms');
const DEFAULT_ROOM = 'ROOM0';
const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const PACKAGES_DIR = path.join(DATA_DIR,'packages');
const TEACHERS_FILE = path.join(DATA_DIR,'teachers.json');
const SESSION_SECRET = process.env.SESSION_SECRET || 'gtscdt-dev-secret';
const AUTH_REQUIRED = process.env.REQUIRE_AUTH === '1';
const LOCAL_PASSWORD = process.env.LOCAL_TEACHER_PASSWORD || '';
const DING_ID = process.env.DINGTALK_CLIENT_ID || '';
const DING_SECRET = process.env.DINGTALK_CLIENT_SECRET || '';
function sign(v){ return crypto.createHmac('sha256',SESSION_SECRET).update(v).digest('hex').slice(0,32); }
function setTeacherCookie(res, teacher){ const v=Buffer.from(JSON.stringify({id:teacher.id,name:teacher.name,role:teacher.role,exp:Date.now()+7*864e5})).toString('base64url'); res.setHeader('Set-Cookie','gtsc_teacher='+v+'.'+sign(v)+'; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800'); }
function getTeacher(req){ const raw=String(req.headers.cookie||''); const m=raw.match(/(?:^|;\s*)gtsc_teacher=([^;]+)/); if(!m)return null; const [v,sig]=m[1].split('.'); if(!v||!sig||sign(v)!==sig)return null; try{ const t=JSON.parse(Buffer.from(v,'base64url').toString()); if(!t.exp||t.exp<Date.now())return null; return t; }catch(e){ return null; } }
function loadTeachers(){ try{ return JSON.parse(fs.readFileSync(TEACHERS_FILE,'utf8')); }catch(e){ return []; } }
function saveTeachers(list){ fs.mkdirSync(path.dirname(TEACHERS_FILE),{recursive:true}); fs.writeFileSync(TEACHERS_FILE, JSON.stringify(list,null,1)); }
let currentRoom = DEFAULT_ROOM;
function roomStateFile(code){ return code===DEFAULT_ROOM ? STATE_FILE : path.join(ROOMS_DIR, code, 'state.json'); }
function roomMetaFile(code){ return code===DEFAULT_ROOM ? path.join(DATA_DIR, 'room.json') : path.join(ROOMS_DIR, code, 'room.json'); }
function validRoom(c){ return /^[A-Z0-9]{4}$/.test(String(c||'')); }
function loadRoom(code){
  const f=roomStateFile(code);
  if(!fs.existsSync(f)) return blank();
  try{ return Object.assign(blank(), JSON.parse(fs.readFileSync(f,'utf8'))); }catch(e){ return blank(); }
}
function saveRoom(code, st){ const f=roomStateFile(code); fs.mkdirSync(path.dirname(f),{recursive:true}); fs.writeFileSync(f, JSON.stringify(st,null,1)); }
function listRooms(){
  const out=[];
  const one=function(code){
    let meta={}; try{ meta=JSON.parse(fs.readFileSync(roomMetaFile(code),'utf8')); }catch(e){}
    const st=loadRoom(code);
    out.push({code,title:meta.title||('课堂 '+code),createdAt:meta.createdAt||'',students:Object.keys(st.students||{}).length,active:!!(st.poll&&st.poll.active)||!!(st.quiz&&st.quiz.paper&&st.quiz.paper.active)});
  };
  one(DEFAULT_ROOM);
  if(fs.existsSync(ROOMS_DIR)) fs.readdirSync(ROOMS_DIR).forEach(function(d){ if(validRoom(d)&&d!==DEFAULT_ROOM) one(d); });
  return out;
}
function createRoom(title){
  let code='';
  for(let i=0;i<50;i++){ code=Array.from({length:4},()=>ROOM_ALPHABET[Math.floor(Math.random()*ROOM_ALPHABET.length)]).join(''); if(!fs.existsSync(roomStateFile(code))) break; }
  fs.mkdirSync(path.join(ROOMS_DIR,code),{recursive:true});
  fs.writeFileSync(roomMetaFile(code), JSON.stringify({title:title||('课堂 '+code),createdAt:new Date().toISOString()},null,1));
  saveRoom(code, blank());
  return code;
}
function setRoom(code){ currentRoom = validRoom(code) ? code : DEFAULT_ROOM; state = loadRoom(currentRoom); }
function cookieRoom(req){ const m=String(req.headers.cookie||'').match(/(?:^|;\s*)gtsc_room=([A-Z0-9]{4})/); return m?m[1]:''; }

function ensureDir(){ if(!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR,{recursive:true}); }
function blank(){
  const groups={}; GROUPS.forEach(g=>groups[g]={name:g+'组',perf:0});
  return {students:{},groups,poll:{active:false,question:'',options:[],votes:{},startedAt:''},submissions:{},config:{hwOpen:false,workshopOpen:false,groupMax:3,model:{baseUrl:'https://api.deepseek.com',model:'deepseek-flash',apiKey:''}},buzz:{enabled:false,running:false,winner:'',round:0,at:''},quiz:{bank:{choice:[],judge:[],blank:[],short:[]},config:{mode:'random',counts:{choice:5,judge:3,blank:2,short:1},scores:{choice:2,judge:2,blank:3,short:10}},paper:null,answers:{}},updatedAt:new Date().toISOString()};
}
function load(){ ensureDir(); if(!fs.existsSync(STATE_FILE)) return blank();
  try{ const s=JSON.parse(fs.readFileSync(STATE_FILE,'utf8')); return Object.assign(blank(),s); }catch(e){ return blank(); } }
let state = loadRoom(DEFAULT_ROOM);
try{
  state.config=state.config||{};
  if(!state.config.model) state.config.model={baseUrl:'https://api.deepseek.com',model:'deepseek-flash',apiKey:''};
  if(!state.config.model.apiKey && process.env.DEEPSEEK_API_KEY){ state.config.model.baseUrl=process.env.DEEPSEEK_BASE||'https://api.deepseek.com'; state.config.model.model=process.env.DEEPSEEK_MODEL||'deepseek-flash'; state.config.model.apiKey=process.env.DEEPSEEK_API_KEY; }
}catch(e){}
let saveTimer=null;
function save(){ clearTimeout(saveTimer); const room=currentRoom; try{ saveRoom(room, state); }catch(e){ console.error('save fail',e.message); } }
function keyOf(name,tail){ return String(name||'').trim()+'|'+String(tail||'').trim(); }
function groupCounts(){ const c={}; Object.keys(state.groups).forEach(g=>c[g]=0); Object.values(state.students).forEach(s=>{ if(s.group&&c[s.group]!==undefined) c[s.group]++ }); return c; }
function ensureStudent(name,tail){ const k=keyOf(name,tail); if(!state.students[k]){ state.students[k]={name:String(name).trim(),tail:String(tail).trim(),group:'',score:0,votes:0,buzzes:0,joinedAt:new Date().toISOString()}; save(); } return state.students[k]; }
function qTok(s){return String(s||'').replace(/[\s，。；、,.!?！？:：;；"'“”‘’（）()]/g,'').toLowerCase().split('');}
function qSim(a,b){var A=qTok(a),B=qTok(b);if(!A.length||!B.length)return 0;var m={};A.forEach(function(c){m[c]=(m[c]||0)+1});var hit=0;B.forEach(function(c){if(m[c]){hit++;m[c]--}});return hit/Math.max(A.length,B.length);}
function qGrade(q,ans){ if(q.type==='choice')return String(ans||'').toUpperCase()===String(q.answer||'').toUpperCase()?1:0; if(q.type==='judge'||q.type==='blank')return String(ans||'').trim()===String(q.answer||'').trim()?1:0; return Math.round(qSim(ans,q.ref)*100)/100; }
function modelCfg(){
  const c=(state.config&&state.config.model)||{};
  return {base:(c.baseUrl||process.env.DEEPSEEK_BASE||'https://api.deepseek.com').replace(/\/$/,''),model:c.model||process.env.DEEPSEEK_MODEL||'deepseek-flash',key:c.apiKey||process.env.DEEPSEEK_API_KEY||''};
}
async function modelChat(messages,maxTokens){
  const cfg=modelCfg(); if(!cfg.key) return {ok:false,error:'未配置 API Key'};
  const t0=Date.now();
  try{
    const r=await fetch(cfg.base+'/chat/completions',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+cfg.key},body:JSON.stringify({model:cfg.model,messages:messages,temperature:0,max_tokens:maxTokens||600})});
    const txt=await r.text();
    if(!r.ok) return {ok:false,error:'HTTP '+r.status+' '+txt.slice(0,160)};
    const j=JSON.parse(txt);
    const content=(((j.choices||[])[0]||{}).message||{}).content||'';
    return {ok:true,content,ms:Date.now()-t0,model:cfg.model};
  }catch(e){ return {ok:false,error:String(e.message||e)}; }
}
async function qModelGrade(q,ans){
  const prompt='你是课堂评分助教。请判断学员答案与参考答案的匹配程度，只输出 0-100 的整数，不要解释。\n题目：'+q.q+'\n参考答案：'+q.ref+'\n学员答案：'+(ans||'（未作答）');
  const r=await modelChat([{role:'user',content:prompt}],600);
  if(!r.ok){ console.error('[qmodel] fail:',r.error); return null; }
  const n=parseInt(String(r.content).replace(/[^0-9]/g,''),10);
  if(isNaN(n)) return null;
  return Math.max(0,Math.min(100,n));
}
function studentView(k){
  const s=state.students[k];
  const poll=state.poll;
  const voted=!!(poll.votes&&poll.votes[k]!==undefined);
  let groupPerf=0,groupScore=0;
  if(s&&s.group){
    groupPerf=state.groups[s.group]?state.groups[s.group].perf:0;
    const gsub=Object.keys(state.submissions).reduce((a,k2)=>{const st=state.students[k2.split('||')[0]];return a+((st&&st.group===s.group)?(((state.submissions[k2].score)||{}).total||0):0)},0);
    groupScore=groupPerf+gsub;
  }
  return {
    ok:true,
    me: s?{name:s.name,tail:s.tail,group:s.group,score:groupScore,groupPerf:groupPerf,groupScore:groupScore}:null,
    poll: poll.active?{active:true,question:poll.question,options:poll.options,voted,myVote:voted?poll.votes[k]:null,startedAt:poll.startedAt}:{active:false},
    hwOpen: !!(state.config&&state.config.hwOpen),
    workshopOpen: !!(state.config&&state.config.workshopOpen),
    buzz:{enabled:!!(state.buzz&&state.buzz.enabled),running:!!(state.buzz&&state.buzz.running),winner:(state.buzz&&state.buzz.winner)||'',round:(state.buzz&&state.buzz.round)||0},
    quiz:(function(){var q=state.quiz||{};var p=q.paper;if(!p||!p.active)return {active:false};var a=(q.answers||{})[k];return {active:true,submitted:!!a,myScore:a?a.score:null,total:p.questions.reduce(function(x,y){return x+(y.score||0)},0),questions:p.questions.map(function(x){return {id:x.id,type:x.type,q:x.q,options:x.options||[],score:x.score}})};})(),
    groupCounts: groupCounts(),
    groups: Object.keys(state.groups).map(g=>({id:g,name:state.groups[g].name})),
    submissions: s? Object.keys(state.submissions).filter(k2=>k2.indexOf(k+'||')===0).map(k2=>{const p=k2.split('||');return {task:p[1],at:state.submissions[k2].at,total:(state.submissions[k2].score||{}).total||0,files:(state.submissions[k2].files||[]).length}}):[]
  };
}
function adminView(){
  const counts=groupCounts();
  const qz=state.quiz||{bank:{},config:{},paper:null,answers:{}};
  const qbank={choice:(qz.bank.choice||[]).length,judge:(qz.bank.judge||[]).length,blank:(qz.bank.blank||[]).length,short:(qz.bank.short||[]).length};
  const qans=Object.keys(qz.answers||{}).map(function(k){return qz.answers[k]});
  const quizInfo={bank:qbank,config:qz.config||{},paper:qz.paper?{active:!!qz.paper.active,at:qz.paper.at,count:qz.paper.questions.length,points:qz.paper.questions.reduce(function(a,b){return a+(b.score||0)},0)}:null,answered:qans.length,avg:qans.length?Math.round(qans.reduce(function(a,b){return a+(b.score||0)},0)/qans.length*10)/10:0};
  const results={};
  if(state.poll.options&&state.poll.options.length){ state.poll.options.forEach((o,i)=>{results[i]=0}); Object.values(state.poll.votes||{}).forEach(v=>{ if(results[v]!==undefined) results[v]++ }); }
  const subs=Object.keys(state.submissions).map(k=>{ const p=k.split('||'); const st=state.students[p[0]]||{}; const sub=state.submissions[k]; return {key:k,studentKey:p[0],name:st.name||p[0],tail:st.tail||'',task:p[1],text:sub.text||'',fileName:sub.fileName||'',q1:sub.q1||'',q2:sub.q2||'',q3:sub.q3||'',files:sub.files||[],at:sub.at,manual:sub.manual||[],score:sub.score||null}; });
  const _mc=modelCfg();
  return {ok:true,quiz:quizInfo,model:{baseUrl:_mc.base,model:_mc.model,hasKey:!!_mc.key},config:state.config||{},buzz:state.buzz||{enabled:false,running:false,winner:''},students:Object.keys(state.students).map(k=>Object.assign({key:k},state.students[k])),groups:Object.keys(state.groups).map(g=>({id:g,name:state.groups[g].name,perf:state.groups[g].perf||0,count:counts[g]})),counts,poll:{active:state.poll.active,question:state.poll.question,options:state.poll.options,votes:state.poll.votes,results,startedAt:state.poll.startedAt},submissions:subs,updatedAt:state.updatedAt};
}
function mcpToolDefs(){
  return [
    {name:'room.create',description:'创建课堂房间',inputSchema:{type:'object',properties:{title:{type:'string'}}}},
    {name:'room.list',description:'列出房间',inputSchema:{type:'object',properties:{}}},
    {name:'room.state',description:'读取房间状态',inputSchema:{type:'object',properties:{room:{type:'string'}},required:['room']}},
    {name:'poll.start',description:'发起投票',inputSchema:{type:'object',properties:{room:{type:'string'},question:{type:'string'},options:{type:'array',items:{type:'string'}}},required:['room','question','options']}},
    {name:'poll.stop',description:'结束投票',inputSchema:{type:'object',properties:{room:{type:'string'}},required:['room']}},
    {name:'buzz.start',description:'开始一轮抢答',inputSchema:{type:'object',properties:{room:{type:'string'}},required:['room']}},
    {name:'quiz.publish',description:'按题库发布答题',inputSchema:{type:'object',properties:{room:{type:'string'},counts:{type:'object'},scores:{type:'object'}}}},
    {name:'score.adjust',description:'调整小组表现分',inputSchema:{type:'object',properties:{room:{type:'string'},group:{type:'string'},delta:{type:'number'}},required:['room','group','delta']}},
    {name:'report.export',description:'导出课堂报告',inputSchema:{type:'object',properties:{room:{type:'string'}},required:['room']}},
    {name:'screen.url',description:'取大屏地址',inputSchema:{type:'object',properties:{room:{type:'string'}},required:['room']}}
  ];
}
async function mcpHandle(msg){
  const id=(msg&&msg.id!==undefined)?msg.id:null;
  const method=msg&&msg.method;
  const reply=function(result){ return {jsonrpc:'2.0',id,result}; };
  if(method==='initialize') return reply({protocolVersion:'2025-06-18',capabilities:{tools:{}},serverInfo:{name:'gtscdt',version:'0.3.0'}});
  if(method==='notifications/initialized') return {jsonrpc:'2.0',id:null,result:{ok:true}};
  if(method==='tools/list') return reply({tools:mcpToolDefs()});
  if(method==='tools/call'){
    const name=msg.params&&msg.params.name; const a=(msg.params&&msg.params.arguments)||{};
    const room=validRoom(a.room)?a.room:DEFAULT_ROOM;
    setRoom(room);
    try{
      if(name==='room.create'){ const code=createRoom(a.title); return reply({content:[{type:'text',text:JSON.stringify({code,urls:{ops:'/ops?room='+code,screen:'/screen?room='+code}})}]}); }
      if(name==='room.list') return reply({content:[{type:'text',text:JSON.stringify(listRooms())}]});
      if(name==='room.state') return reply({content:[{type:'text',text:JSON.stringify(screenView())}]});
      if(name==='poll.start'){ state.poll={active:true,question:String(a.question||''),options:(a.options||[]).map(String),votes:{},startedAt:new Date().toLocaleString('zh-CN')}; save(); return reply({content:[{type:'text',text:JSON.stringify({ok:true})}]}); }
      if(name==='poll.stop'){ state.poll.active=false; save(); return reply({content:[{type:'text',text:JSON.stringify({ok:true})}]}); }
      if(name==='buzz.start'){ state.buzz.enabled=true; state.buzz.running=true; state.buzz.winner=''; state.buzz.round=(state.buzz.round||0)+1; save(); return reply({content:[{type:'text',text:JSON.stringify({ok:true,round:state.buzz.round})}]}); }
      if(name==='quiz.publish'){
        state.quiz=state.quiz||{bank:{choice:[],judge:[],blank:[],short:[]},config:{},answers:{}};
        const cfg={mode:'random',counts:a.counts||{choice:5,judge:3,blank:2,short:1},scores:a.scores||{choice:2,judge:2,blank:3,short:10}};
        const pick=function(t,n){ let arr=(state.quiz.bank[t]||[]).slice(); if(!arr.length)return []; return arr.slice(0,Math.max(0,Math.min(Number(n)||0,arr.length))).map(function(q){const c=Object.assign({},q);c.type=t;c.score=Number(cfg.scores[t]||0)||0;return c}); };
        const qs=[].concat(pick('choice',cfg.counts.choice),pick('judge',cfg.counts.judge),pick('blank',cfg.counts.blank),pick('short',cfg.counts.short));
        if(!qs.length) return reply({isError:true,content:[{type:'text',text:'题库为空'}]});
        state.quiz.paper={active:true,at:new Date().toLocaleString('zh-CN'),questions:qs}; state.quiz.answers={}; state.quiz.config=cfg; save();
        return reply({content:[{type:'text',text:JSON.stringify({ok:true,count:qs.length})}]});
      }
      if(name==='score.adjust'){ if(state.groups[a.group]){ state.groups[a.group].perf=(state.groups[a.group].perf||0)+Number(a.delta||0); save(); } return reply({content:[{type:'text',text:JSON.stringify({ok:true,perf:state.groups[a.group]&&state.groups[a.group].perf})}]}); }
      if(name==='report.export'){ return reply({content:[{type:'text',text:JSON.stringify({room:currentRoom,students:Object.keys(state.students).length,groups:screenView().groups,quiz:screenView().quiz,poll:screenView().poll})}]}); }
      if(name==='screen.url'){ return reply({content:[{type:'text',text:JSON.stringify({url:'/screen?room='+room})}]}); }
      return reply({isError:true,content:[{type:'text',text:'unknown tool '+name}]});
    }catch(e){ return reply({isError:true,content:[{type:'text',text:String(e.message||e)}]}); }
  }
  return {jsonrpc:'2.0',id,error:{code:-32601,message:'method not found'}};
}
function savePackage(title, html){
  fs.mkdirSync(PACKAGES_DIR,{recursive:true});
  const id='pkg-'+Date.now().toString(36);
  const dir=path.join(PACKAGES_DIR,id);
  fs.mkdirSync(dir,{recursive:true});
  fs.writeFileSync(path.join(dir,'index.html'), html, 'utf8');
  fs.writeFileSync(path.join(dir,'meta.json'), JSON.stringify({id,title,createdAt:new Date().toISOString()},null,1));
  return id;
}
function listPackages(){
  if(!fs.existsSync(PACKAGES_DIR)) return [];
  return fs.readdirSync(PACKAGES_DIR).filter(d=>/^pkg-[a-z0-9]+$/.test(d)).map(function(d){
    let m={}; try{ m=JSON.parse(fs.readFileSync(path.join(PACKAGES_DIR,d,'meta.json'),'utf8')); }catch(e){}
    return {id:d,title:m.title||d,createdAt:m.createdAt||'',url:'/pkg/'+d+'/index.html'};
  }).sort(function(a,b){return String(b.createdAt).localeCompare(String(a.createdAt))});
}
function screenView(){
  const poll=state.poll||{};
  const results={};
  if(poll.options) poll.options.forEach((o,i)=>{results[i]=0});
  Object.values(poll.votes||{}).forEach(v=>{ if(results[v]!==undefined) results[v]++ });
  const quiz=state.quiz||{};
  const paper=quiz.paper;
  return {ok:true,room:currentRoom,at:Date.now(),
    poll:{active:!!poll.active,question:poll.question||'',options:poll.options||[],results,count:Object.keys(poll.votes||{}).length},
    buzz:{enabled:!!(state.buzz&&state.buzz.enabled),running:!!(state.buzz&&state.buzz.running),winner:(state.buzz&&state.buzz.winner)||'',round:(state.buzz&&state.buzz.round)||0},
    quiz:paper?{active:!!paper.active,count:paper.questions.length,points:paper.questions.reduce((a,b)=>a+(b.score||0),0),answered:Object.keys(quiz.answers||{}).length,avg:(function(){const v=Object.values(quiz.answers||{});return v.length?Math.round(v.reduce((a,b)=>a+(b.score||0),0)/v.length*10)/10:0})()}:null,
    groups:Object.keys(state.groups||{}).map(g=>({id:g,name:state.groups[g].name,perf:state.groups[g].perf||0,count:(function(){return Object.values(state.students||{}).filter(s=>s.group===g).length})()})),
    students:Object.keys(state.students||{}).length
  };
}
function send(res,code,obj,type='application/json; charset=utf-8'){ const body=Buffer.isBuffer(obj)||typeof obj==='string'?obj:JSON.stringify(obj); res.writeHead(code,{'Content-Type':type,'Cache-Control':'no-store','Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Content-Type','Access-Control-Allow-Methods':'GET,POST,OPTIONS'}); res.end(body); }
function readRaw(req, limit){
  return new Promise((resolve,reject)=>{ const chunks=[]; let n=0; const max=limit||8*1024*1024;
    req.on('data',c=>{ n+=c.length; if(n>max){ reject(new Error('too large')); req.destroy(); return; } chunks.push(c); });
    req.on('end',()=>resolve(Buffer.concat(chunks))); req.on('error',reject); });
}
function readBody(req){ return new Promise((resolve,reject)=>{ let d=''; req.on('data',c=>{d+=c; if(d.length>2e6){reject(new Error('too large'));req.destroy()}}); req.on('end',()=>{ try{resolve(d?JSON.parse(d):{})}catch(e){resolve({})} }); req.on('error',reject); }); }
const MIME={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.json':'application/json; charset=utf-8','.csv':'text/csv; charset=utf-8'};
const MAP=_IS_KIT
  ? {'/':'promo.html','/promo':'promo.html','/live':'live.html','/live.html':'live.html','/course':'course/course.html','/course.html':'course/course.html','/grader':'course/grader.html','/grader.html':'course/grader.html','/admin':'course/admin.html','/admin.html':'course/admin.html','/ops':'course/admin.html','/join':'live.html','/screen':'screen.html','/remote':'remote.html','/login':'login.html','/shell':'course-shell.html','/rooms':'rooms.html','/teachers':'teachers.html','/packages':'packages.html'}
  : {'/':'宣传页/课程大纲-宣传版.html','/promo':'宣传页/课程大纲-宣传版.html','/live':'宣传页/live.html','/live.html':'宣传页/live.html','/course':'课件/course.html','/course.html':'课件/course.html','/grader':'课件/grader.html','/grader.html':'课件/grader.html','/admin':'课件/admin.html','/admin.html':'课件/admin.html','/ops':'课件/admin.html','/join':'宣传页/live.html','/screen':'screen.html','/remote':'remote.html','/login':'login.html','/shell':'course-shell.html','/rooms':'rooms.html','/teachers':'teachers.html','/packages':'packages.html'};
function serveStatic(res,pathname){
  let rel=MAP[pathname] || decodeURIComponent(pathname).replace(/^\/+/,'');
  const abs=path.resolve(ROOT,rel);
  if(!abs.startsWith(ROOT)) return send(res,403,{ok:false,error:'forbidden'});
  fs.readFile(abs,(err,buf)=>{ if(err) return send(res,404,'not found','text/plain; charset=utf-8'); send(res,200,buf,MIME[path.extname(abs).toLowerCase()]||'application/octet-stream'); });
}
const server=http.createServer(async (req,res)=>{
  const u=new URL(req.url,'http://x');
  const p=u.pathname;
  if(req.method==='OPTIONS') return send(res,204,'');
  const roomQ=u.searchParams.get('room');
  setRoom(roomQ || cookieRoom(req) || DEFAULT_ROOM);
  if(roomQ && validRoom(roomQ)) res.setHeader('Set-Cookie','gtsc_room='+roomQ+'; Path=/; SameSite=Lax');
  if(p==='/embed.js'){
    const js="(function(){var s=document.currentScript;var room=(s.getAttribute('data-room')||'').toUpperCase();var w=s.getAttribute('data-widget')||'poll';var h=Number(s.getAttribute('data-height')||360);var f=document.createElement('iframe');f.src='/embed?room='+room+'&widget='+w;f.style.cssText='width:100%;height:'+h+'px;border:0;border-radius:12px;background:#081813';s.parentNode.insertBefore(f,s.nextSibling);})();";
    return send(res,200,js,'text/javascript; charset=utf-8');
  }
  if(p==='/embed') return send(res,200,fs.readFileSync(path.join(__dirname,'embed.html')),'text/html; charset=utf-8');
  if(p==='/mcp'){
    if(process.env.MCP_TOKEN){
      const auth=String(req.headers.authorization||'');
      if(auth!=='Bearer '+process.env.MCP_TOKEN) return send(res,401,{jsonrpc:'2.0',error:{code:-32001,message:'unauthorized'},id:null});
    }
    const body=await readBody(req);
    const reply=await mcpHandle(body);
    return send(res,200,reply);
  }
  if(p==='/api/auth/config') return send(res,200,{ok:true,dingtalk:!!(DING_ID&&DING_SECRET),local:!!LOCAL_PASSWORD,required:AUTH_REQUIRED});
  if(p==='/auth/local' && req.method==='POST'){
    const b=await readBody(req);
    if(!LOCAL_PASSWORD) return send(res,400,{ok:false,error:'未配置本地口令'});
    if(String(b.password||'')!==LOCAL_PASSWORD) return send(res,401,{ok:false,error:'口令不对'});
    const t={id:'local',name:'本地讲师',role:'admin'};
    setTeacherCookie(res,t); return send(res,200,{ok:true,teacher:t});
  }
  if(p==='/auth/dingtalk'){
    if(!(DING_ID&&DING_SECRET)) return send(res,501,{ok:false,error:'未配置钉钉应用'});
    const origin=(process.env.PUBLIC_URL||u.origin).replace(/\/$/,'');
    const redirect=origin+'/auth/dingtalk/callback';
    const target='https://login.dingtalk.com/oauth2/auth?redirect_uri='+encodeURIComponent(redirect)+'&response_type=code&client_id='+encodeURIComponent(DING_ID)+'&scope=openid&state=gtsc';
    res.writeHead(302,{Location:target}); return res.end();
  }
  if(p==='/auth/dingtalk/callback'){
    if(!(DING_ID&&DING_SECRET)) return send(res,501,{ok:false,error:'未配置钉钉应用'});
    const code=u.searchParams.get('authCode')||u.searchParams.get('code')||'';
    try{
      const tr=await fetch('https://api.dingtalk.com/v1.0/oauth2/userAccessToken',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({clientId:DING_ID,clientSecret:DING_SECRET,code,grantType:'authorization_code'})});
      const tj=await tr.json();
      if(!tj.accessToken) return send(res,401,'钉钉授权失败','text/html; charset=utf-8');
      const ur=await fetch('https://api.dingtalk.com/v1.0/contact/users/me',{headers:{'x-acs-dingtalk-access-token':tj.accessToken}});
      const me=await ur.json();
      const teachers=loadTeachers();
      const t=teachers.filter(x=>x.dingUnionId===me.unionId||x.dingOpenId===me.openId)[0];
      if(!t) return send(res,403,'该钉钉账号未加入讲师名单，请联系管理员','text/html; charset=utf-8');
      setTeacherCookie(res,t);
      res.writeHead(302,{Location:'/ops'}); return res.end();
    }catch(e){ return send(res,500,'钉钉登录失败：'+String(e.message||e),'text/html; charset=utf-8'); }
  }
  if(p==='/api/me') return send(res,200,{ok:true,teacher:getTeacher(req)});
  if(p==='/api/teachers' && req.method==='GET') return send(res,200,{ok:true,teachers:loadTeachers()});
  if(p==='/api/teachers' && req.method==='POST'){
    const b=await readBody(req);
    const name=String(b.name||'').trim(); if(!name) return send(res,400,{ok:false,error:'缺少姓名'});
    const list=loadTeachers();
    const t={id:'t-'+Date.now().toString(36),name,role:['admin','teacher','assistant','viewer'].indexOf(b.role)>=0?b.role:'teacher',dept:String(b.dept||''),dingUnionId:String(b.dingUnionId||''),dingOpenId:String(b.dingOpenId||''),createdAt:new Date().toISOString()};
    list.push(t); saveTeachers(list); return send(res,200,{ok:true,teacher:t});
  }
  if(p==='/api/teachers/delete' && req.method==='POST'){
    const b=await readBody(req); const list=loadTeachers().filter(x=>x.id!==b.id); saveTeachers(list);
    return send(res,200,{ok:true});
  }
  if(p==='/api/packages' && req.method==='GET') return send(res,200,{ok:true,packages:listPackages()});
  if(p==='/api/packages' && req.method==='POST'){
    const title=String(u.searchParams.get('title')||'课程包');
    const buf=await readRaw(req,20*1024*1024);
    if(!buf.length) return send(res,400,{ok:false,error:'空文件'});
    const id=savePackage(title, buf.toString('utf8'));
    return send(res,200,{ok:true,id,url:'/pkg/'+id+'/index.html'});
  }
  if(p==='/api/packages/delete' && req.method==='POST'){
    const b=await readBody(req); const id=String(b.id||'');
    if(!/^pkg-[a-z0-9]+$/.test(id)) return send(res,400,{ok:false,error:'bad id'});
    const dir=path.join(PACKAGES_DIR,id);
    if(fs.existsSync(dir)) fs.rmSync(dir,{recursive:true,force:true});
    return send(res,200,{ok:true});
  }
  if(p==='/api/packages/ai' && req.method==='POST'){
    const b=await readBody(req);
    const content=String(b.content||'').slice(0,6000);
    if(!content.trim()) return send(res,400,{ok:false,error:'缺少内容'});
    const prompt='你是课程设计助手。把下面素材整理成讲课大纲，只输出大纲，不要解释。\n格式：第一行以“# 课程标题”开头；之后每一页以“## 页标题”开头；每页要点用“- ”开头，每行一条。\n素材：\n'+content;
    const r=await modelChat([{role:'user',content:prompt}],2000);
    if(!r.ok) return send(res,502,{ok:false,error:r.error});
    const lines=String(r.content||'').split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
    let title='AI 课程包'; const sections=[]; let cur=null;
    lines.forEach(function(line){
      if(/^#\s+/.test(line)&&!/^##\s+/.test(line)){ title=line.replace(/^#\s+/,''); return; }
      if(/^##\s+/.test(line)){ if(cur)sections.push(cur); cur={type:'bullets',title:line.replace(/^##\s+/,''),items:[]}; return; }
      if(/^[-*]\s+/.test(line)){ (cur||(cur={type:'bullets',title:'要点',items:[]})).items.push(line.replace(/^[-*]\s+/,'')); return; }
      if(cur) cur.items.push(line);
    });
    if(cur) sections.push(cur);
    if(!sections.length){ const pages=String(content).split(/\n{2,}/).slice(0,12); pages.forEach(function(t,i){ sections.push({type:i===0?'cover':'bullets',title:i===0?'课程提要':('要点 '+(i+1)),text:i===0?t.slice(0,120):'',items:i===0?[]:t.split(/[。；;]/).filter(Boolean).slice(0,6)}) }); }
    sections.unshift({type:'cover',title:title,text:'',meta:''});
    const doc={title:title,subtitle:'',date:'',sections:sections};
    const html=renderCoursePackage({title:title}, doc);
    const id=savePackage(title, html);
    return send(res,200,{ok:true,id,url:'/pkg/'+id+'/index.html',title:title});
  }
  if(p.startsWith('/pkg/')){
    const rest=decodeURIComponent(p.slice('/pkg/'.length)).split('/');
    const id=rest.shift()||''; const rel=rest.join('/')||'index.html';
    if(!/^pkg-[a-z0-9]+$/.test(id)) return send(res,404,'not found','text/plain');
    const file=path.resolve(PACKAGES_DIR,id,rel);
    if(!file.startsWith(path.resolve(PACKAGES_DIR,id))||!fs.existsSync(file)) return send(res,404,'not found','text/plain');
    const ext=path.extname(file).slice(1).toLowerCase();
    const ct=ext==='html'?'text/html; charset=utf-8':ext==='css'?'text/css; charset=utf-8':ext==='js'?'text/javascript; charset=utf-8':ext==='svg'?'image/svg+xml':'application/octet-stream';
    return send(res,200,fs.readFileSync(file),ct);
  }
  if(AUTH_REQUIRED){
    const teacher=getTeacher(req);
    const htmlGuarded=(p==='/ops'||p==='/admin'||p==='/grader'||p==='/shell');
    const apiGuarded=(p.indexOf('/api/admin')===0)||(p.indexOf('/api/teachers')===0)||(p==='/api/packages'&&req.method==='POST')||(p==='/api/packages/ai')||(p==='/api/packages/delete');
    if(htmlGuarded&&!teacher){ res.writeHead(302,{Location:'/login'}); return res.end(); }
    if(apiGuarded&&!teacher) return send(res,401,{ok:false,error:'login required'});
  }
  if(p==='/api/rooms' && req.method==='GET') return send(res,200,{ok:true,rooms:listRooms(),current:currentRoom});
  if(p==='/api/rooms/create' && req.method==='POST'){
    const b=await readBody(req);
    const code=createRoom(b.title);
    return send(res,200,{ok:true,code,urls:{ops:'/ops?room='+code,join:'/join?room='+code,screen:'/screen?room='+code,remote:'/remote?room='+code}});
  }
  if(p==='/api/screen') return send(res,200,screenView());
  if(p==='/api/stream'){
    res.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-cache','Connection':'keep-alive','Access-Control-Allow-Origin':'*'});
    res.write('retry: 3000\n\n');
    const tick=function(){ try{ res.write('data: '+JSON.stringify(screenView())+'\n\n'); }catch(e){} };
    tick(); const t=setInterval(tick,2000);
    req.on('close',function(){ clearInterval(t); try{res.end()}catch(e){} });
    return;
  }
  if(p.startsWith('/materials/')){
    const name=decodeURIComponent(p.slice('/materials/'.length));
    const fp=path.join(__dirname,'materials',name);
    if(!fs.existsSync(fp)) return send(res,404,'not found','text/plain');
    const buf=fs.readFileSync(fp);
    const ext=(name.split('.').pop()||'').toLowerCase();
    const ct=ext==='csv'?'text/csv; charset=utf-8':(ext==='md'?'text/markdown; charset=utf-8':'application/octet-stream');
    res.writeHead(200,{'Content-Type':ct,'Content-Disposition':"attachment; filename*=UTF-8''"+encodeURIComponent(name),'Cache-Control':'no-store','Access-Control-Allow-Origin':'*'});
    return res.end(buf);
  }
  if(p.startsWith('/api/')){
    try{
      if(p==='/api/ping') return send(res,200,{ok:true,ts:Date.now()});
      if(p==='/api/state'){ const name=u.searchParams.get('name')||''; const tail=u.searchParams.get('tail')||''; if(!name||!tail) return send(res,400,{ok:false,error:'need name+tail'}); ensureStudent(name,tail); return send(res,200,studentView(keyOf(name,tail))); }
      if(p==='/api/admin/state') return send(res,200,adminView());
      if(req.method==='POST'){
        const b=(p==='/api/upload')?{}:await readBody(req);
        if(p==='/api/join'){ const s=ensureStudent(b.name,b.tail); return send(res,200,{ok:true,me:s}); }
        if(p==='/api/draw'){
          const k=keyOf(b.name,b.tail); const s=ensureStudent(b.name,b.tail);
          if(s.group) return send(res,200,{ok:true,group:s.group,already:true});
          const counts=groupCounts(); const max=Number(state.config&&state.config.groupMax)||3;
          const ids=Object.keys(state.groups).filter(g=>counts[g]<max);
          if(!ids.length) return send(res,409,{ok:false,error:'所有分组已满'});
          const min=Math.min.apply(null,ids.map(g=>counts[g])); const cand=ids.filter(g=>counts[g]===min);
          const g=cand[Math.floor(Math.random()*cand.length)]; s.group=g; state.updatedAt=new Date().toISOString(); save();
          return send(res,200,{ok:true,group:g});
        }
        if(p==='/api/vote'){
          const k=keyOf(b.name,b.tail); ensureStudent(b.name,b.tail);
          if(!state.poll.active) return send(res,400,{ok:false,error:'no active poll'});
          if(state.poll.votes[k]!==undefined) return send(res,400,{ok:false,error:'already voted'});
          const idx=Number(b.choice); if(!(idx>=0&&idx<state.poll.options.length)) return send(res,400,{ok:false,error:'bad choice'});
          state.poll.votes[k]=idx; const _st=state.students[k]; if(_st)_st.votes=(_st.votes||0)+1; state.updatedAt=new Date().toISOString(); save(); return send(res,200,{ok:true});
        }
        if(p==='/api/quiz/submit'){
          const k=keyOf(b.name,b.tail); ensureStudent(b.name,b.tail);
          const pz=state.quiz&&state.quiz.paper;
          if(!pz||!pz.active) return send(res,400,{ok:false,error:'答题未开始'});
          if(state.quiz.answers[k]) return send(res,400,{ok:false,error:'已经提交过'});
          const ans=b.answers||{}; let score=0,total=0; const detail=[];
          for(const q of pz.questions){
            total+=q.score||0;
            let ratio=qGrade(q,ans[q.id]); let via='rule';
            if(q.type==='short'){ const m=await qModelGrade(q,ans[q.id]); if(m!==null){ ratio=m/100; via='model'; } }
            const s=Math.round(ratio*(q.score||0)*10)/10; score+=s;
            detail.push({id:q.id,type:q.type,score:s,ratio:ratio,via:via});
          }
          state.quiz.answers[k]={at:new Date().toLocaleString('zh-CN'),score:Math.round(score*10)/10,total:total,answers:ans,detail:detail};
          save();
          return send(res,200,{ok:true,score:Math.round(score*10)/10,total:total});
        }
        if(p==='/api/homework'){
          const k=keyOf(b.name,b.tail); ensureStudent(b.name,b.tail);
          state.submissions[k+'||'+b.task]={text:b.text||'',fileName:b.fileName||'',q1:b.q1||'',q2:b.q2||'',q3:b.q3||'',at:new Date().toLocaleString('zh-CN'),manual:[],score:null};
          state.updatedAt=new Date().toISOString(); save(); return send(res,200,{ok:true});
        }
        if(p==='/api/upload'&&req.method==='POST'){
          const q=u.searchParams;const name=q.get('name')||'',tail=q.get('tail')||'',task=q.get('task')||'T1',fn=q.get('filename')||'file.bin';
          const k=keyOf(name,tail);ensureStudent(name,tail);
          const chunks=[];let size=0;
          for await (const ch of req){size+=ch.length;if(size>25*1024*1024){return send(res,413,{ok:false,error:'file too large (25MB)'})}chunks.push(ch)}
          const buf=Buffer.concat(chunks);
          const safe=String(fn).replace(/[^\w.\-\u4e00-\u9fa5]/g,'_').slice(0,80);
          const safeK=k.replace(/[^a-zA-Z0-9_.\-\u4e00-\u9fa5]/g,'_');const dir=path.join(DATA_DIR,'uploads',safeK);fs.mkdirSync(dir,{recursive:true});
          const fname=task+'-'+Date.now()+'-'+safe;fs.writeFileSync(path.join(dir,fname),buf);
          const key=k+'||'+task;
          const sub=state.submissions[key]||{text:'',q1:'',q2:'',q3:'',at:new Date().toLocaleString('zh-CN'),manual:[],score:null,files:[]};
          sub.files=sub.files||[];sub.files.push({name:fn,size:buf.length,path:fname,at:new Date().toLocaleString('zh-CN')});
          if(/\.(md|txt)$/i.test(fn)&&!sub.text)sub.text=buf.toString('utf8').slice(0,6000);
          if(!sub.at)sub.at=new Date().toLocaleString('zh-CN');
          state.submissions[key]=sub;state.updatedAt=new Date().toISOString();save();
          return send(res,200,{ok:true,files:sub.files});
        }
        if(p==='/api/file'){const k=u.searchParams.get('key')||'',task=u.searchParams.get('task')||'',idx=Number(u.searchParams.get('i')||0);
          const sub=state.submissions[k+'||'+task];if(!sub||!sub.files||!sub.files[idx])return send(res,404,'not found','text/plain');
          const safeK2=k.replace(/[^a-zA-Z0-9_.\-\u4e00-\u9fa5]/g,'_');const fp=path.join(DATA_DIR,'uploads',safeK2,sub.files[idx].path);
          return fs.readFile(fp,(e,b)=>e?send(res,404,'not found','text/plain'):send(res,200,b,'application/octet-stream'));
        }
        if(p==='/api/admin/quizbank'){
          state.quiz=state.quiz||{bank:{choice:[],judge:[],blank:[],short:[]}};
          state.quiz.bank=state.quiz.bank||{choice:[],judge:[],blank:[],short:[]};
          const mode=b.action==='append'?'append':'replace';
          const incoming=b.bank||{};
          if(mode==='replace') state.quiz.bank={choice:[],judge:[],blank:[],short:[]};
          ['choice','judge','blank','short'].forEach(function(t){
            (incoming[t]||[]).forEach(function(q,i){ const item=Object.assign({},q); item.type=t; item.id=t+'-'+Date.now()+'-'+i; state.quiz.bank[t].push(item); });
          });
          state.updatedAt=new Date().toISOString();save();
          return send(res,200,{ok:true,counts:{choice:state.quiz.bank.choice.length,judge:state.quiz.bank.judge.length,blank:state.quiz.bank.blank.length,short:state.quiz.bank.short.length}});
        }
        if(p==='/api/admin/quiz'){
          state.quiz=state.quiz||{bank:{choice:[],judge:[],blank:[],short:[]},answers:{}};
          if(b.action==='publish'){
            const cfg={mode:b.mode==='seq'?'seq':'random',counts:b.counts||{},scores:b.scores||{}};
            state.quiz.config=cfg;
            const pick=function(t,n){
              let arr=(state.quiz.bank[t]||[]).slice();
              if(cfg.mode==='random') arr.sort(function(){return Math.random()-0.5});
              return arr.slice(0,Math.max(0,Math.min(Number(n)||0,arr.length))).map(function(q){ const c=Object.assign({},q); c.type=t; c.score=Number(cfg.scores[t]||0)||0; return c; });
            };
            const qs=[].concat(pick('choice',cfg.counts.choice),pick('judge',cfg.counts.judge),pick('blank',cfg.counts.blank),pick('short',cfg.counts.short));
            if(!qs.length) return send(res,400,{ok:false,error:'题库为空或各类数量为 0'});
            state.quiz.paper={active:true,at:new Date().toLocaleString('zh-CN'),questions:qs};
            state.quiz.answers={}; save();
            return send(res,200,{ok:true,count:qs.length,points:qs.reduce(function(a,q){return a+(q.score||0)},0)});
          }
          if(b.action==='close'){ if(state.quiz.paper) state.quiz.paper.active=false; save(); return send(res,200,{ok:true}); }
          if(b.action==='clear'){ state.quiz.paper=null; state.quiz.answers={}; save(); return send(res,200,{ok:true}); }
          if(b.action==='resetbank'){ state.quiz.bank={choice:[],judge:[],blank:[],short:[]}; state.quiz.paper=null; state.quiz.answers={}; save(); return send(res,200,{ok:true}); }
          return send(res,400,{ok:false,error:'bad action'});
        }
        if(p==='/api/admin/groupcfg'){ state.config=state.config||{}; state.config.groupMax=Math.max(1,Math.min(10,Number(b.max)||3)); save(); return send(res,200,{ok:true,groupMax:state.config.groupMax}); }
        if(p==='/api/admin/groupadd'){
          const used=Object.keys(state.groups);
          const letter='ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').filter(c=>used.indexOf(c)<0)[0];
          if(!letter) return send(res,400,{ok:false,error:'分组已达上限'});
          state.groups[letter]={name:letter+'组',perf:0}; state.updatedAt=new Date().toISOString(); save();
          return send(res,200,{ok:true,id:letter});
        }
        if(p==='/api/admin/grouprename'){
          if(!state.groups[b.id]) return send(res,404,{ok:false,error:'no group'});
          state.groups[b.id].name=String(b.name||'').trim()||state.groups[b.id].name; save();
          return send(res,200,{ok:true});
        }
        if(p==='/api/admin/groupdel'){
          const ids=Object.keys(state.groups);
          if(ids.length<=1) return send(res,400,{ok:false,error:'至少保留一个分组'});
          if(!state.groups[b.id]) return send(res,404,{ok:false,error:'no group'});
          delete state.groups[b.id];
          Object.keys(state.students).forEach(k=>{ if(state.students[k].group===b.id) state.students[k].group='' });
          save(); return send(res,200,{ok:true});
        }
        if(p==='/api/admin/student'){
          const act=b.action;
          if(act==='clear'){
            state.students={};state.submissions={};state.poll.votes={};state.buzz={enabled:false,running:false,winner:'',round:0,at:'',counts:{}};
            state.updatedAt=new Date().toISOString();save();return send(res,200,{ok:true});
          }
          const oldKey=b.key, st=state.students[oldKey];
          if(!st) return send(res,404,{ok:false,error:'student not found'});
          if(act==='delete'){
            Object.keys(state.submissions).forEach(k=>{ if(k.indexOf(oldKey+'||')===0) delete state.submissions[k] });
            if(state.poll.votes) delete state.poll.votes[oldKey];
            delete state.students[oldKey]; save(); return send(res,200,{ok:true});
          }
          if(act==='update'){
            const nn=(b.name||st.name).trim(), nt=(b.tail||st.tail).trim(), ng=(b.group!==undefined?b.group:st.group);
            const nk=keyOf(nn,nt);
            delete state.students[oldKey];
            state.students[nk]=Object.assign({},st,{name:nn,tail:nt,group:ng});
            if(nk!==oldKey){
              Object.keys(state.submissions).forEach(k=>{ if(k.indexOf(oldKey+'||')===0){ state.submissions[nk+k.slice(oldKey.length)]=state.submissions[k]; delete state.submissions[k]; } });
              if(state.poll.votes&&state.poll.votes[oldKey]!==undefined){ state.poll.votes[nk]=state.poll.votes[oldKey]; delete state.poll.votes[oldKey]; }
            }
            save(); return send(res,200,{ok:true,key:nk});
          }
          return send(res,400,{ok:false,error:'bad action'});
        }
        if(p==='/api/admin/buzz'){
          state.buzz=state.buzz||{enabled:false,running:false,winner:'',at:''};
          const a=b.action;
          if(a==='enable'){state.buzz.enabled=true;state.buzz.running=false;state.buzz.winner=''}
          else if(a==='disable'){state.buzz.enabled=false;state.buzz.running=false}
          else if(a==='start'){state.buzz.enabled=true;state.buzz.running=true;state.buzz.winner='';state.buzz.round=(state.buzz.round||0)+1;state.buzz.at=new Date().toLocaleString('zh-CN')}
          else if(a==='reset'){state.buzz.running=false;state.buzz.winner=''}
          state.updatedAt=new Date().toISOString();save();
          return send(res,200,{ok:true,buzz:state.buzz});
        }
        if(p==='/api/buzz'){
          const s=ensureStudent(b.name,b.tail);
          state.buzz=state.buzz||{};
          if(!state.buzz.enabled) return send(res,400,{ok:false,error:'not enabled'});
          if(state.buzz.winner) return send(res,200,{ok:true,winner:state.buzz.winner});
          if(!state.buzz.running) return send(res,400,{ok:false,error:'not running'});
          state.buzz.winner=s.name;state.buzz.running=false;s.buzzes=(s.buzzes||0)+1;state.updatedAt=new Date().toISOString();save();
          return send(res,200,{ok:true,winner:state.buzz.winner});
        }
        if(p==='/api/admin/workshop'){ state.config=state.config||{}; state.config.workshopOpen=!!b.open; state.updatedAt=new Date().toISOString(); save(); return send(res,200,{ok:true,workshopOpen:state.config.workshopOpen}); }
        if(p==='/api/admin/hw'){ state.config=state.config||{hwOpen:false}; state.config.hwOpen=!!b.open; state.updatedAt=new Date().toISOString(); save(); return send(res,200,{ok:true,hwOpen:state.config.hwOpen}); }
        if(p==='/api/admin/delsub'){
          var sub=state.submissions[b.key];
          if(sub&&(sub.files||[]).length){ var safeK=String(b.key.split('||')[0]).replace(/[^a-zA-Z0-9_.\-\u4e00-\u9fa5]/g,'_');
            (sub.files||[]).forEach(function(f){ try{ fs.unlinkSync(path.join(DATA_DIR,'uploads',safeK,f.path)) }catch(e){} }); }
          delete state.submissions[b.key]; state.updatedAt=new Date().toISOString(); save(); return send(res,200,{ok:true});
        }
        if(p==='/api/admin/poll'){
          if(b.action==='stop'){ state.poll.active=false; save(); return send(res,200,{ok:true}); }
          state.poll={active:true,question:b.question||'',options:(b.options||[]).filter(x=>String(x).trim()),votes:{},startedAt:new Date().toLocaleString('zh-CN')};
          state.updatedAt=new Date().toISOString(); save(); return send(res,200,{ok:true});
        }
        if(p==='/api/admin/group'){ const k=keyOf(b.name,b.tail); const s=state.students[k]; if(!s) return send(res,404,{ok:false,error:'student not found'}); s.group=b.group||''; state.updatedAt=new Date().toISOString(); save(); return send(res,200,{ok:true}); }
        if(p==='/api/admin/perf'){ if(!state.groups[b.group]) return send(res,400,{ok:false,error:'bad group'}); state.groups[b.group].perf=(state.groups[b.group].perf||0)+Number(b.delta||0); state.updatedAt=new Date().toISOString(); save(); return send(res,200,{ok:true,perf:state.groups[b.group].perf}); }
        if(p==='/api/admin/model'){
          const act=b.action||'save';
          if(act==='test'){
            const cfg={baseUrl:(b.baseUrl||'').trim(),model:(b.model||'').trim(),apiKey:(b.apiKey||'').trim()||(state.config.model&&state.config.model.apiKey)||''};
            if(!cfg.apiKey) return send(res,400,{ok:false,error:'请先填写 API Key'});
            const old=state.config.model; state.config.model=cfg;
            const r=await modelChat([{role:'user',content:'只回复两个字母：OK'}],20);
            state.config.model=old;
            if(!r.ok) return send(res,502,{ok:false,error:r.error});
            return send(res,200,{ok:true,reply:String(r.content).slice(0,40),ms:r.ms,model:r.model});
          }
          state.config.model=state.config.model||{};
          if(b.baseUrl!==undefined) state.config.model.baseUrl=String(b.baseUrl||'').trim();
          if(b.model!==undefined) state.config.model.model=String(b.model||'').trim();
          if(b.apiKey) state.config.model.apiKey=String(b.apiKey).trim();
          save(); return send(res,200,{ok:true});
        }
        if(p==='/api/admin/scoreai'){
          const sub=state.submissions[b.key]; if(!sub) return send(res,404,{ok:false,error:'submission not found'});
          const rubric=b.rubric||[];
          if(!rubric.length) return send(res,400,{ok:false,error:'缺少评分标准'});
          const answer=['【正文】',String(sub.text||'（空）').slice(0,2500),'【三问】',(sub.q1||''),' / ',(sub.q2||''),' / ',(sub.q3||'')].join('\n');
          const prompt='你是企业 AI 培训的作业评分助教。按下面的评分标准逐项打分。\n评分标准（编号|标准|满分）：\n'+rubric.map(function(c,i){return (i+1)+'|'+c.t+'|'+c.pts}).join('\n')+'\n\n学员作业：\n'+answer+'\n\n严格按每行“编号|分数|一句依据”的格式输出，不要标题、不要解释、不要多余文字，分数不超过该项满分。';
          const r=await modelChat([{role:'user',content:prompt}],1600);
          if(!r.ok) return send(res,502,{ok:false,error:r.error});
          const items=[]; let total=0;
          String(r.content).split(/\n+/).forEach(function(line){
            const m=line.match(/^\s*(\d+)\s*[|｜]\s*([0-9.]+)\s*[|｜]?\s*(.*)$/);
            if(!m) return;
            const idx=Number(m[1])-1; const rb=rubric[idx]; if(!rb) return;
            const mx=Number(rb.pts)||0; const sc=Math.max(0,Math.min(mx,Number(m[2])||0));
            items.push({t:rb.t,score:sc,max:mx,why:(m[3]||'').slice(0,80)}); total+=sc;
          });
          if(!items.length) return send(res,502,{ok:false,error:'模型返回无法解析：'+String(r.content).slice(0,200)});
          const obj={items:items};
          const cap=rubric.reduce(function(a,c){return a+(Number(c.pts)||0)},0);
          total=Math.round(Math.min(total,cap)*10)/10;
          sub.score={ai:true,total:total,override:total,items:obj.items,model:r.model,at:new Date().toLocaleString('zh-CN')};
          save(); return send(res,200,{ok:true,score:sub.score});
        }
        if(p==='/api/admin/score'){ const sub=state.submissions[b.key]; if(!sub) return send(res,404,{ok:false,error:'submission not found'}); if(b.manual) sub.manual=b.manual; if(b.score) sub.score=b.score; save(); return send(res,200,{ok:true}); }
        /* score 可含 override 字段：人工直接定总分 */
        if(p==='/api/admin/reset'){ if(b.scope==='poll'){ state.poll={active:false,question:'',options:[],votes:{},startedAt:''}; } else if(b.scope==='groups'){ Object.values(state.students).forEach(s=>s.group=''); } else { const _m=state.config&&state.config.model; state=blank(); if(_m)state.config.model=_m; } save(); return send(res,200,{ok:true}); }
      }
      return send(res,404,{ok:false,error:'no api'});
    }catch(e){ return send(res,500,{ok:false,error:String(e.message||e)}); }
  }
  serveStatic(res,p);
});
function lanIPs(){ const out=[]; const nets=os.networkInterfaces(); for(const n of Object.keys(nets)){ for(const a of nets[n]||[]){ if(a.family==='IPv4'&&!a.internal) out.push(a.address); } } return out; }
server.listen(PORT,'0.0.0.0',()=>{ console.log('camp server on http://0.0.0.0:'+PORT); console.log('LAN: '+lanIPs().map(ip=>'http://'+ip+':'+PORT).join('  ')); console.log('ROOT='+ROOT); });
