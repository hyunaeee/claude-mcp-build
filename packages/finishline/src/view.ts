import type { StatusView } from "./manager.js";

/**
 * The dashboard. Rendered two ways from the same HTML:
 * - as an MCP App inside the chat (data arrives via ui/notifications/tool-result, tasks are clickable)
 * - as a static .finishline/dashboard.html file (data embedded, read-only)
 */
export function dashboardHtml(data?: StatusView): string {
  const embedded = data ? `<script>window.__FINISHLINE__=${JSON.stringify(data).replace(/</g, "\\u003c")}</script>` : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Finishline</title>
<style>
:root{
  --bg:#f7f7f5;--card:#ffffff;--ink:#1b1b1f;--muted:#6b6b76;--line:#e6e6e2;
  --accent:#2f6df6;--accent-soft:#e8efff;--good:#1f9d61;--good-soft:#e3f5ec;
  --warn:#b86e00;--warn-soft:#fff3df;--bad:#d33c3c;--bad-soft:#fde8e8;--track:#ececea;
  --radius:14px;--shadow:0 1px 2px rgba(0,0,0,.04),0 4px 16px rgba(0,0,0,.04);
}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){
  --bg:#141416;--card:#1d1d21;--ink:#ececf0;--muted:#9a9aa6;--line:#2c2c32;
  --accent:#6b9bff;--accent-soft:#1f2a44;--good:#4cc38a;--good-soft:#173527;
  --warn:#f0a73a;--warn-soft:#3a2c14;--bad:#ff6b6b;--bad-soft:#3d1c1c;--track:#2a2a30;
  --shadow:none;}}
:root[data-theme="dark"]{
  --bg:#141416;--card:#1d1d21;--ink:#ececf0;--muted:#9a9aa6;--line:#2c2c32;
  --accent:#6b9bff;--accent-soft:#1f2a44;--good:#4cc38a;--good-soft:#173527;
  --warn:#f0a73a;--warn-soft:#3a2c14;--bad:#ff6b6b;--bad-soft:#3d1c1c;--track:#2a2a30;--shadow:none;}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI","Apple SD Gothic Neo","Noto Sans KR",sans-serif}
.wrap{max-width:1040px;margin:0 auto;padding:20px 16px 28px}
h1{font-size:22px;margin:0;letter-spacing:-.01em}
.why{color:var(--muted);margin:2px 0 0}
.chips{display:flex;gap:6px;flex-wrap:wrap;margin-top:10px}
.chip{font-size:12px;padding:3px 9px;border-radius:999px;background:var(--card);border:1px solid var(--line);color:var(--muted)}
.chip.late{background:var(--warn-soft);color:var(--warn);border-color:transparent}
.card{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);box-shadow:var(--shadow);padding:16px}
.hero{display:grid;grid-template-columns:auto 1fr;gap:16px;margin-top:16px}
.ring{position:relative;width:132px;height:132px}
.ring svg{transform:rotate(-90deg)}
.ring .pct{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center}
.ring .pct b{font-size:30px;letter-spacing:-.02em;line-height:1}
.ring .pct span{font-size:12px;color:var(--muted);margin-top:4px}
.next{display:flex;flex-direction:column;justify-content:center;gap:6px}
.label{font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}
.next-text{font-size:18px;font-weight:600;line-height:1.35}
.next-why{color:var(--muted)}
.note{margin-top:4px;padding:8px 12px;border-radius:10px;background:var(--accent-soft);color:var(--ink);font-size:13px}
.note::before{content:"Manager · ";font-weight:600;color:var(--accent)}
button.primary{align-self:flex-start;margin-top:6px;border:0;background:var(--accent);color:#fff;font:inherit;font-weight:600;padding:8px 14px;border-radius:10px;cursor:pointer}
button.primary:disabled{opacity:.5;cursor:default}
.track{margin-top:16px}
.lanes{display:flex;gap:4px;align-items:stretch}
.lane{flex:1;min-width:0}
.bar{height:10px;border-radius:5px;background:var(--track);overflow:hidden}
.bar i{display:block;height:100%;background:var(--accent);border-radius:5px;transition:width .4s}
.lane.complete .bar i{background:var(--good)}
.lane .name{font-size:12px;margin-top:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--muted)}
.lane.current .name{color:var(--ink);font-weight:600}
.flag{font-size:18px;line-height:10px;padding-left:2px}
.warns{display:flex;flex-direction:column;gap:6px;margin-top:16px}
.warn{padding:9px 12px;border-radius:10px;background:var(--warn-soft);color:var(--warn);font-size:13px}
.warn.bad{background:var(--bad-soft);color:var(--bad)}
.grid{display:grid;grid-template-columns:1.5fr 1fr;gap:16px;margin-top:16px;align-items:start}
.side{display:flex;flex-direction:column;gap:16px}
.ms + .ms{margin-top:14px;padding-top:14px;border-top:1px solid var(--line)}
.ms-head{display:flex;justify-content:space-between;gap:8px;font-weight:600}
.ms-head span{color:var(--muted);font-weight:500;font-size:12px}
ul.tasks{list-style:none;margin:8px 0 0;padding:0}
ul.tasks li{display:flex;align-items:flex-start;gap:9px;padding:5px 0}
.box{flex:none;width:18px;height:18px;margin-top:1px;border-radius:6px;border:1.5px solid var(--line);display:flex;align-items:center;justify-content:center;font-size:11px;color:#fff;background:var(--card)}
.interactive .box{cursor:pointer}
.interactive .box:hover{border-color:var(--accent)}
li.done .box{background:var(--good);border-color:var(--good)}
li.doing .box{border-color:var(--accent);background:var(--accent-soft)}
li.blocked .box{border-color:var(--bad)}
li.done .t{color:var(--muted);text-decoration:line-through}
.t small{display:block;color:var(--muted);font-size:12px}
.tag{font-size:11px;padding:1px 7px;border-radius:999px;margin-left:6px;vertical-align:1px}
.tag.doing{background:var(--accent-soft);color:var(--accent)}
.tag.blocked{background:var(--bad-soft);color:var(--bad)}
.tag.scope{background:var(--warn-soft);color:var(--warn)}
.score{display:flex;align-items:baseline;gap:8px}
.score b{font-size:26px}
.check{display:flex;gap:8px;padding:5px 0;font-size:13px}
.check .i{flex:none;width:18px;text-align:center}
.check.pass .i{color:var(--good)}
.check.fail .i{color:var(--bad)}
.check small{display:block;color:var(--muted)}
.spark{display:flex;align-items:flex-end;gap:3px;height:44px;margin-top:10px}
.spark i{flex:1;background:var(--accent);border-radius:3px 3px 1px 1px;min-height:3px;opacity:.85}
.spark i.zero{background:var(--track);opacity:1}
.stats{display:flex;gap:18px;margin-top:10px}
.stats b{font-size:18px;display:block}
.stats span{font-size:12px;color:var(--muted)}
.muted{color:var(--muted)}
.list{margin:6px 0 0;padding-left:18px}
.list li{margin:3px 0}
.log{font-size:12px;color:var(--muted);margin-top:6px}
.log div{padding:3px 0}
.empty{padding:40px 16px;text-align:center;color:var(--muted)}
.shipped{text-align:center;font-size:15px;padding:10px;border-radius:10px;background:var(--good-soft);color:var(--good);font-weight:600;margin-top:16px}
@media (max-width:720px){.grid{grid-template-columns:1fr}.hero{grid-template-columns:1fr;justify-items:center;text-align:center}.next{align-items:center}button.primary{align-self:center}.lane .name{display:none}}
</style>
</head>
<body>
<div class="wrap" id="app"><div class="empty">Loading project…</div></div>
${embedded}
<script>
(function(){
  var app = document.getElementById("app");
  var inHost = window.parent !== window && !window.__FINISHLINE__;
  var reqId = 0, pending = {};

  function esc(s){return String(s==null?"":s).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];});}

  function rpc(method, params){
    return new Promise(function(resolve, reject){
      var id = ++reqId; pending[id] = {resolve:resolve, reject:reject};
      window.parent.postMessage({jsonrpc:"2.0", id:id, method:method, params:params}, "*");
    });
  }
  function notify(method, params){ window.parent.postMessage({jsonrpc:"2.0", method:method, params:params||{}}, "*"); }

  function ring(pct){
    var r=56, c=2*Math.PI*r, off=c*(1-pct/100);
    return '<div class="ring"><svg width="132" height="132"><circle cx="66" cy="66" r="'+r+'" fill="none" stroke="var(--track)" stroke-width="12"/>'+
      '<circle cx="66" cy="66" r="'+r+'" fill="none" stroke="'+(pct===100?"var(--good)":"var(--accent)")+'" stroke-width="12" stroke-linecap="round" stroke-dasharray="'+c+'" stroke-dashoffset="'+off+'"/></svg>'+
      '<div class="pct"><b>'+pct+'%</b><span>finished</span></div></div>';
  }

  function render(v){
    if(!v || !v.title){ app.innerHTML='<div class="empty">No project yet. Ask Claude to start one.</div>'; size(); return; }
    var current = v.milestones.find(function(m){return m.done < m.total;});
    var h = '';
    h += '<h1>'+esc(v.title)+'</h1><p class="why">'+esc(v.why)+'</p><div class="chips">';
    h += '<span class="chip">'+v.done+' / '+v.total+' tasks</span>';
    if(v.targetDate) h += '<span class="chip">Target '+esc(v.targetDate)+'</span>';
    if(v.projectedDate) h += '<span class="chip'+(v.targetDate && v.projectedDate>v.targetDate?' late':'')+'">Projected '+esc(v.projectedDate)+'</span>';
    if(v.streak) h += '<span class="chip">🔥 '+v.streak+'-day streak</span>';
    h += '</div>';

    if(v.phase==="shipped") h += '<div class="shipped">🏁 Every task done, every ship check passing. Ship it!</div>';

    h += '<div class="card hero">'+ring(v.percent)+'<div class="next"><div class="label">Next up</div>'+
      '<div class="next-text">'+esc(v.next.text)+'</div><div class="next-why">'+esc(v.next.why)+'</div>';
    if(inHost && v.next.taskId) h += '<button class="primary" data-done="'+esc(v.next.taskId)+'">Mark done</button>';
    h += '<div class="note">'+esc(v.managerNote)+'</div></div></div>';

    h += '<div class="card track"><div class="label" style="margin-bottom:10px">Road to the finish line</div><div class="lanes">';
    v.milestones.forEach(function(m){
      var p = m.total? Math.round(m.done/m.total*100):0;
      var cls = (m.total && m.done===m.total)?"complete":(current && current.id===m.id?"current":"");
      h += '<div class="lane '+cls+'" title="'+esc(m.title)+' · '+m.done+'/'+m.total+'"><div class="bar"><i style="width:'+p+'%"></i></div><div class="name">'+esc(m.title)+'</div></div>';
    });
    h += '<div class="flag">🏁</div></div></div>';

    if(v.warnings.length){
      h += '<div class="warns">';
      v.warnings.forEach(function(w){ h += '<div class="warn'+(w.kind==="late"||w.kind==="blocked"?" bad":"")+'">'+esc(w.text)+'</div>'; });
      h += '</div>';
    }

    h += '<div class="grid"><div class="card'+(inHost?" interactive":"")+'">';
    v.milestones.forEach(function(m){
      h += '<div class="ms"><div class="ms-head">'+esc(m.title)+'<span>'+m.done+'/'+m.total+'</span></div><ul class="tasks">';
      m.tasks.forEach(function(t){
        h += '<li class="'+t.status+'"><span class="box" data-toggle="'+esc(t.id)+'" data-status="'+t.status+'">'+(t.status==="done"?"✓":"")+'</span>'+
          '<span class="t">'+esc(t.title)+
          (t.status==="doing"?'<span class="tag doing">in progress</span>':'')+
          (t.status==="blocked"?'<span class="tag blocked">blocked</span>':'')+
          (t.scopeCreep?'<span class="tag scope">added later</span>':'')+
          (t.note?'<small>'+esc(t.note)+'</small>':'')+'</span></li>';
      });
      if(!m.tasks.length) h += '<li class="muted">No tasks</li>';
      h += '</ul></div>';
    });
    h += '</div><div class="side">';

    h += '<div class="card"><div class="label">Ship readiness</div>';
    if(v.shipCheck){
      var items = v.shipCheck.items.slice().sort(function(a,b){return a.pass-b.pass;});
      h += '<div class="score"><b>'+v.shipCheck.score+'%</b><span class="muted">checked '+esc(v.shipCheck.at.slice(0,10))+'</span></div>';
      items.forEach(function(i){ h += '<div class="check '+(i.pass?"pass":"fail")+'"><span class="i">'+(i.pass?"✓":"✕")+'</span><span>'+esc(i.label)+'<small>'+esc(i.detail)+'</small></span></div>'; });
    } else h += '<p class="muted">Not checked yet. Ask Claude to run ship_check.</p>';
    h += '</div>';

    var max = Math.max.apply(null, v.activity.map(function(a){return a.done;}).concat([1]));
    h += '<div class="card"><div class="label">Momentum · last 14 days</div><div class="spark">';
    v.activity.forEach(function(a){ h += '<i class="'+(a.done?"":"zero")+'" style="height:'+(a.done? Math.max(12, a.done/max*100):6)+'%" title="'+a.date+': '+a.done+' done"></i>'; });
    h += '</div><div class="stats"><div><b>'+v.doneThisWeek+'</b><span>done this week</span></div><div><b>'+v.streak+'</b><span>day streak</span></div><div><b>'+(v.total-v.done)+'</b><span>to go</span></div></div></div>';

    h += '<div class="card"><div class="label">Done when</div><ul class="list">';
    v.doneWhen.forEach(function(d){ h += '<li>'+esc(d)+'</li>'; });
    h += '</ul>';
    if(v.outOfScope.length){ h += '<div class="label" style="margin-top:12px">Not doing (yet)</div><ul class="list muted">'; v.outOfScope.forEach(function(d){ h += '<li>'+esc(d)+'</li>'; }); h += '</ul>'; }
    if(v.later.length){ h += '<div class="label" style="margin-top:12px">Parked ideas</div><ul class="list muted">'; v.later.forEach(function(t){ h += '<li>'+esc(t.title)+'</li>'; }); h += '</ul>'; }
    h += '</div>';

    if(v.recent.length){
      h += '<div class="card"><div class="label">Recent</div><div class="log">';
      v.recent.forEach(function(e){ h += '<div>'+esc(e.at.slice(5,10))+' · '+esc(e.text)+'</div>'; });
      h += '</div></div>';
    }
    h += '</div></div>';
    app.innerHTML = h;
    size();
  }

  function size(){ if(inHost) notify("ui/notifications/size-changed", {height: document.documentElement.scrollHeight}); }

  function fromResult(r){ return r && (r.structuredContent || (r.result && r.result.structuredContent)); }

  async function act(id, action){
    try{
      app.querySelectorAll("button,.box").forEach(function(b){b.setAttribute("disabled","");b.style.pointerEvents="none";});
      await rpc("tools/call", {name:"update_plan", arguments:{changes:[{id:id, action:action}]}});
      var s = await rpc("tools/call", {name:"status", arguments:{}});
      render(fromResult(s));
    }catch(e){ app.querySelectorAll("button,.box").forEach(function(b){b.removeAttribute("disabled");b.style.pointerEvents="";}); }
  }

  app.addEventListener("click", function(e){
    if(!inHost) return;
    var b = e.target.closest("[data-done]");
    if(b){ act(b.getAttribute("data-done"), "done"); return; }
    var box = e.target.closest("[data-toggle]");
    if(box){ act(box.getAttribute("data-toggle"), box.getAttribute("data-status")==="done" ? "reopen" : "done"); }
  });

  if(window.__FINISHLINE__){ render(window.__FINISHLINE__); return; }
  if(!inHost){ render(null); return; }

  window.addEventListener("message", function(ev){
    var m = ev.data; if(!m || m.jsonrpc!=="2.0") return;
    if(m.id!=null && pending[m.id] && !m.method){
      var p = pending[m.id]; delete pending[m.id];
      m.error ? p.reject(m.error) : p.resolve(m.result);
      return;
    }
    if(m.method==="ui/notifications/tool-result"){ var v = fromResult({structuredContent: m.params && m.params.structuredContent}); if(v) render(v); }
    if(m.method==="ui/notifications/host-context-changed" && m.params && m.params.theme){ document.documentElement.setAttribute("data-theme", m.params.theme); }
  });

  rpc("ui/initialize", {appInfo:{name:"finishline", version:"0.1.0"}, appCapabilities:{}, protocolVersion:"2026-01-26"})
    .then(function(res){
      var t = res && res.hostContext && res.hostContext.theme; if(t) document.documentElement.setAttribute("data-theme", t);
      notify("ui/notifications/initialized");
    });
  if(window.ResizeObserver) new ResizeObserver(size).observe(document.body);
})();
</script>
</body>
</html>`;
}
