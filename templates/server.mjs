import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;
const DATA_DIR = path.join(__dirname, 'data');
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const PORT = Number(process.env.PORT || 8899);
const GROUPS = ['A','B','C','D','E','F','G'];

function ensureDir(){ if(!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR,{recursive:true}); }
function blank(){
  const groups={}; GROUPS.forEach(g=>groups[g]={name:g+'组',perf:0});
  return {students:{},groups,poll:{active:false,question:'',options:[],votes:{},startedAt:''},submissions:{},config:{hwOpen:false,workshopOpen:false,groupMax:3},buzz:{enabled:false,running:false,winner:'',round:0,at:''},updatedAt:new Date().toISOString()};
}
function load(){ ensureDir(); if(!fs.existsSync(STATE_FILE)) return blank();
  try{ const s=JSON.parse(fs.readFileSync(STATE_FILE,'utf8')); return Object.assign(blank(),s); }catch(e){ return blank(); } }
let state = load();
let saveTimer=null;
function save(){ clearTimeout(saveTimer); saveTimer=setTimeout(()=>{ try{ fs.writeFileSync(STATE_FILE, JSON.stringify(state,null,1)); }catch(e){ console.error('save fail',e.message); } },50); }
function keyOf(name,tail){ return String(name||'').trim()+'|'+String(tail||'').trim(); }
function groupCounts(){ const c={}; Object.keys(state.groups).forEach(g=>c[g]=0); Object.values(state.students).forEach(s=>{ if(s.group&&c[s.group]!==undefined) c[s.group]++ }); return c; }
function ensureStudent(name,tail){ const k=keyOf(name,tail); if(!state.students[k]){ state.students[k]={name:String(name).trim(),tail:String(tail).trim(),group:'',score:0,votes:0,buzzes:0,joinedAt:new Date().toISOString()}; save(); } return state.students[k]; }
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
    groupCounts: groupCounts(),
    groups: Object.keys(state.groups).map(g=>({id:g,name:state.groups[g].name})),
    submissions: s? Object.keys(state.submissions).filter(k2=>k2.indexOf(k+'||')===0).map(k2=>{const p=k2.split('||');return {task:p[1],at:state.submissions[k2].at,total:(state.submissions[k2].score||{}).total||0,files:(state.submissions[k2].files||[]).length}}):[]
  };
}
function adminView(){
  const counts=groupCounts();
  const results={};
  if(state.poll.options&&state.poll.options.length){ state.poll.options.forEach((o,i)=>{results[i]=0}); Object.values(state.poll.votes||{}).forEach(v=>{ if(results[v]!==undefined) results[v]++ }); }
  const subs=Object.keys(state.submissions).map(k=>{ const p=k.split('||'); const st=state.students[p[0]]||{}; const sub=state.submissions[k]; return {key:k,studentKey:p[0],name:st.name||p[0],tail:st.tail||'',task:p[1],text:sub.text||'',fileName:sub.fileName||'',q1:sub.q1||'',q2:sub.q2||'',q3:sub.q3||'',files:sub.files||[],at:sub.at,manual:sub.manual||[],score:sub.score||null}; });
  return {ok:true,config:state.config||{},buzz:state.buzz||{enabled:false,running:false,winner:''},students:Object.keys(state.students).map(k=>Object.assign({key:k},state.students[k])),groups:Object.keys(state.groups).map(g=>({id:g,name:state.groups[g].name,perf:state.groups[g].perf||0,count:counts[g]})),counts,poll:{active:state.poll.active,question:state.poll.question,options:state.poll.options,votes:state.poll.votes,results,startedAt:state.poll.startedAt},submissions:subs,updatedAt:state.updatedAt};
}
function send(res,code,obj,type='application/json; charset=utf-8'){ const body=Buffer.isBuffer(obj)||typeof obj==='string'?obj:JSON.stringify(obj); res.writeHead(code,{'Content-Type':type,'Cache-Control':'no-store','Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Content-Type','Access-Control-Allow-Methods':'GET,POST,OPTIONS'}); res.end(body); }
function readBody(req){ return new Promise((resolve,reject)=>{ let d=''; req.on('data',c=>{d+=c; if(d.length>2e6){reject(new Error('too large'));req.destroy()}}); req.on('end',()=>{ try{resolve(d?JSON.parse(d):{})}catch(e){resolve({})} }); req.on('error',reject); }); }
const MIME={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.json':'application/json; charset=utf-8','.csv':'text/csv; charset=utf-8'};
const MAP={'/':'promo.html','/promo':'promo.html','/live':'live.html','/live.html':'live.html','/course':'course/course.html','/course.html':'course/course.html','/grader':'course/grader.html','/grader.html':'course/grader.html','/admin':'course/admin.html','/admin.html':'course/admin.html'};
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
        if(p==='/api/admin/score'){ const sub=state.submissions[b.key]; if(!sub) return send(res,404,{ok:false,error:'submission not found'}); if(b.manual) sub.manual=b.manual; if(b.score) sub.score=b.score; save(); return send(res,200,{ok:true}); }
        /* score 可含 override 字段：人工直接定总分 */
        if(p==='/api/admin/reset'){ if(b.scope==='poll'){ state.poll={active:false,question:'',options:[],votes:{},startedAt:''}; } else if(b.scope==='groups'){ Object.values(state.students).forEach(s=>s.group=''); } else { state=blank(); } save(); return send(res,200,{ok:true}); }
      }
      return send(res,404,{ok:false,error:'no api'});
    }catch(e){ return send(res,500,{ok:false,error:String(e.message||e)}); }
  }
  serveStatic(res,p);
});
function lanIPs(){ const out=[]; const nets=os.networkInterfaces(); for(const n of Object.keys(nets)){ for(const a of nets[n]||[]){ if(a.family==='IPv4'&&!a.internal) out.push(a.address); } } return out; }
server.listen(PORT,'0.0.0.0',()=>{ console.log('camp server on http://0.0.0.0:'+PORT); console.log('LAN: '+lanIPs().map(ip=>'http://'+ip+':'+PORT).join('  ')); console.log('ROOT='+ROOT); });
