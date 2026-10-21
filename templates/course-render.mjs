// 课程包渲染器：把结构化内容 JSON 渲染成单文件 HTML（确定性，可复现）
function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g, function(c){ return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[c]; }); }

export function renderCoursePackage(meta, doc){
  const m = Object.assign({title:'课程', subtitle:'', date:'', footer:''}, meta||{});
  const d = Object.assign({title:m.title, subtitle:m.subtitle, sections:[]}, doc||{});
  const css = `
:root{--bg:#0A1F1A;--panel:#0E2A21;--line:rgba(244,239,226,.13);--text:#F4EFE2;--muted:#9DB3A6;--amber:#D98A2B;--amber-l:#E9B45C;--jade:#2F8F73}
*{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%}
body{background:var(--bg);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;overflow:hidden}
.deck{height:100vh;position:relative}
.slide{position:absolute;inset:0;padding:6vh 7vw;display:none;flex-direction:column;justify-content:center}
.slide.on{display:flex}
.eyebrow{font-size:13px;letter-spacing:.2em;color:var(--amber);margin-bottom:18px}
h1{font-size:44px;line-height:1.25;margin-bottom:16px}
h2{font-size:32px;line-height:1.3;margin-bottom:18px}
p,li{font-size:20px;line-height:1.8;color:#DDE6DE}
ul{margin-left:22px}
.quote{border-left:3px solid var(--amber);padding-left:18px;font-size:24px;color:#F6E4C6}
.timeline .row{display:flex;gap:18px;padding:8px 0;border-bottom:1px solid var(--line);font-size:18px}
.bar{position:fixed;left:0;right:0;bottom:0;display:flex;justify-content:space-between;align-items:center;padding:10px 18px;font-size:12px;color:var(--muted);border-top:1px solid var(--line);background:rgba(8,24,19,.9)}
.bar button{background:none;border:1px solid var(--line);color:var(--text);border-radius:8px;padding:4px 10px;cursor:pointer;margin-left:6px}
.meta{color:var(--muted);font-size:14px}
`;
  const sections = (d.sections||[]).map(function(sec, i){
    let inner='';
    const type=sec.type||'bullets';
    if(type==='cover'){
      inner = '<div class="eyebrow">'+esc(sec.eyebrow||m.subtitle||'')+'</div><h1>'+esc(sec.title||d.title)+'</h1>'
        + (sec.text?('<p>'+esc(sec.text)+'</p>'):'')
        + (sec.meta?('<p class="meta" style="margin-top:18px">'+esc(sec.meta)+'</p>'):'');
    }else if(type==='quote'){
      inner = '<h2>'+esc(sec.title||'')+'</h2><div class="quote">'+esc(sec.text||'')+'</div>';
    }else if(type==='timeline'){
      inner = '<h2>'+esc(sec.title||'')+'</h2><div class="timeline">'
        + (sec.items||[]).map(function(it){ return '<div class="row"><b style="min-width:110px;color:var(--amber-l)">'+esc(it.time||'')+'</b><span>'+esc(it.text||it)+'</span></div>'; }).join('')
        + '</div>';
    }else if(type==='image'){
      inner = '<h2>'+esc(sec.title||'')+'</h2>' + (sec.src?('<img src="'+esc(sec.src)+'" style="max-height:60vh;max-width:100%;border-radius:12px" />'):'') + (sec.text?('<p class="meta">'+esc(sec.text)+'</p>'):'');
    }else{
      inner = '<h2>'+esc(sec.title||'')+'</h2>' + (sec.text?('<p>'+esc(sec.text)+'</p>'):'')
        + ((sec.items||[]).length?('<ul>'+sec.items.map(function(it){return '<li>'+esc(it)+'</li>'}).join('')+'</ul>'):'');
    }
    return '<section class="slide'+(i===0?' on':'')+'" data-i="'+i+'">'+inner+'</section>';
  }).join('');

  const js = `
(function(){
  var slides=[].slice.call(document.querySelectorAll('.slide')), i=0;
  function show(n){ i=Math.max(0,Math.min(slides.length-1,n)); slides.forEach(function(s,k){s.classList.toggle('on',k===i)}); document.getElementById('pg').textContent=(i+1)+' / '+slides.length; }
  document.addEventListener('keydown',function(e){ if(e.key==='ArrowRight'||e.key===' '||e.key==='PageDown') show(i+1); if(e.key==='ArrowLeft'||e.key==='PageUp') show(i-1); });
  document.getElementById('next').onclick=function(){show(i+1)}; document.getElementById('prev').onclick=function(){show(i-1)};
  show(0);
})();
`;
  return '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<title>'+esc(d.title)+'</title><style>'+css+'</style></head><body><div class="deck">'+sections+'</div>'
    + '<div class="bar"><span>'+esc(d.title)+' · '+esc(m.date||'')+'</span><span><span id="pg">1 / '+(d.sections||[]).length+'</span>'
    + '<button id="prev">上一页</button><button id="next">下一页</button></span></div>'
    + '<script>'+js+'</script></body></html>';
}
