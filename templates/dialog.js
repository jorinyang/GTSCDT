(function(){
  function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})}
  var current=null;
  function close(){
    if(current&&current.parentNode) current.parentNode.removeChild(current);
    current=null;
    document.removeEventListener('keydown',onKey);
  }
  function onKey(e){ if(e.key==='Escape') close(); }
  function fieldHtml(f){
    var val=f.value==null?'':String(f.value);
    var input;
    if(f.type==='select'){
      input='<select data-name="'+esc(f.name)+'">'+(f.options||[]).map(function(o){return '<option value="'+esc(o.value)+'"'+(String(o.value)===val?' selected':'')+'>'+esc(o.label)+'</option>'}).join('')+'</select>';
    }else if(f.type==='textarea'){
      input='<textarea data-name="'+esc(f.name)+'" placeholder="'+esc(f.placeholder||'')+'">'+esc(val)+'</textarea>';
    }else{
      input='<input data-name="'+esc(f.name)+'" type="'+esc(f.type||'text')+'" value="'+esc(val)+'" placeholder="'+esc(f.placeholder||'')+'" />';
    }
    return '<label class="gtsc-field'+(f.full?' full':'')+'"><span>'+esc(f.label)+(f.required?' *':'')+'</span>'+input+(f.hint?'<em class="hint">'+esc(f.hint)+'</em>':'')+'</label>';
  }
  function dialog(opts){
    close();
    var fields=opts.fields||[];
    var overlay=document.createElement('div');
    overlay.className='gtsc-overlay';
    overlay.innerHTML='<div class="gtsc-modal" style="max-width:'+(opts.width||640)+'px">'
      +'<div class="gtsc-head"><h3>'+esc(opts.title||'')+'</h3><button class="gtsc-x" type="button" aria-label="关闭">×</button></div>'
      +'<div class="gtsc-body">'+(fields.length?'<div class="gtsc-grid">'+fields.map(fieldHtml).join('')+'</div>':'<div class="gtsc-text">'+esc(opts.message||'')+'</div>')+'</div>'
      +'<div class="gtsc-msg" style="display:none"></div>'
      +'<div class="gtsc-foot">'
        +(opts.cancelText===false?'':'<button class="gtsc-btn" type="button" data-cancel>'+esc(opts.cancelText||'取消')+'</button>')
        +'<button class="gtsc-btn '+(opts.danger?'danger':'primary')+'" type="button" data-ok>'+esc(opts.submitText||'确定')+'</button>'
      +'</div></div>';
    document.body.appendChild(overlay);
    current=overlay;
    document.addEventListener('keydown',onKey);
    var okBtn=overlay.querySelector('[data-ok]');
    var cancelBtn=overlay.querySelector('[data-cancel]');
    var xBtn=overlay.querySelector('.gtsc-x');
    function values(){
      var out={};
      overlay.querySelectorAll('[data-name]').forEach(function(el){ out[el.getAttribute('data-name')]=el.value; });
      return out;
    }
    function guardAndSubmit(){
      var vals=values();
      for(var i=0;i<fields.length;i++){
        var f=fields[i];
        if(f.required && !String(vals[f.name]||'').trim()){
          var msg=overlay.querySelector('.gtsc-msg');
          msg.style.display='block'; msg.textContent='请填写「'+(f.label||f.name)+'」'; return;
        }
      }
      if(typeof opts.onSubmit==='function'){
        var r=opts.onSubmit(vals,close);
        if(r===false) return;
      }
      close();
    }
    okBtn.onclick=guardAndSubmit;
    if(cancelBtn) cancelBtn.onclick=close;
    xBtn.onclick=close;
    overlay.addEventListener('mousedown',function(e){ if(e.target===overlay) close(); });
    if(typeof opts.onReady==='function') opts.onReady(overlay,close);
    return {el:overlay,close:close};
  }
  function confirm(opts){
    return dialog({title:opts.title||'确认',message:opts.message||'',submitText:opts.submitText||'确定',cancelText:'取消',danger:!!opts.danger,width:opts.width||420,onSubmit:function(){ if(opts.onConfirm) opts.onConfirm(); }});
  }
  function alert(message,title,onClose){
    return dialog({title:title||'提示',message:message,submitText:'知道了',cancelText:false,width:420,onSubmit:function(){ if(onClose)onClose(); }});
  }
  window.GTSC={dialog:dialog,confirm:confirm,alert:alert,close:close};
})();
