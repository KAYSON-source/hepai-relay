const $ = selector => document.querySelector(selector);
const home = $("#home"), panel = $("#room"), modal = $("#modal"), body = $("#dialogBody");
const art = {
  plus:"M12 5v14M5 12h14", close:"m6 6 12 12M18 6 6 18",
  play:"m8 5 11 7-11 7z", book:"M3 5q5-2 9 1 4-3 9-1v14q-4-2-9 0-5-2-9 0zM12 6v13",
  imageplus:"M19 12v7a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h9M15 6h7m-3.5-3.5v7M4 17l5-5 4 4 3-3 3 3M7 8h.1",
  wand:"m3 20 12-12 3 3L6 23zM12 11l3 3M5 3v5M2.5 5.5h5M18 2v4M16 4h4M19 15v5M16.5 17.5h5",
  layers:"m2 8 10-5 10 5-10 5zM2 12l10 5 10-5M2 16l10 5 10-5",
  folder:"M3 7a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
  share:"M12 15V3m-4 4 4-4 4 4M6 10H4v11h16V10h-2",
  save:"M12 3v12m-4-4 4 4 4-4M4 16v4h16v-4",
  chain:"m10 14 4-4M9 15l-1 1a3.5 3.5 0 0 1-5-5l4-4a3.5 3.5 0 0 1 5 0M15 9l1-1a3.5 3.5 0 0 1 5 5l-4 4a3.5 3.5 0 0 1-5 0",
  photo:"M3 4h18v16H3zM4 17l5-5 4 4 3-3 4 4M8 8h.1", chevron:"m9 5 7 7-7 7"
};
function icons(root=document) {
  root.querySelectorAll("i[data-icon]:empty").forEach(el=>{
    const path = art[el.dataset.icon];
    if(path) el.innerHTML='<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="'+path+'"/></svg>';
  });
}
const esc = str => String(str??"").replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
const icon = name => '<i aria-hidden="true" data-icon="'+name+'"></i>';
const btn = (action,label,glyph,kind="primary") => '<button type="button" class="'+kind+'" data-do="'+action+'">'+(glyph?icon(glyph):"")+label+'</button>';
const size = n => n<1024*1024 ? Math.ceil(n/1024)+" KB" : (n/1024/1024).toFixed(1)+" MB";
const date = t => new Intl.DateTimeFormat("zh-CN",{month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"}).format(t);
const filesAccept = ".jpg,.jpeg,.png,.heic,.heif,.webp,image/jpeg,image/png,image/heic,image/heif,image/webp";
const validId = id => /^[a-f0-9]{32}$/.test(id || "");
const mem = new Map();
function read(k) { try {return localStorage.getItem("hepai."+k)??mem.get(k);} catch{return mem.get(k);} }
function save(k,v) {mem.set(k,v);try{localStorage.setItem("hepai."+k,v);}catch{/* Keep access for this tab. */}}
let participant=read("participant");
if (!validId(participant)) {
  participant=Array.from(crypto.getRandomValues(new Uint8Array(16)),b=>b.toString(16).padStart(2,"0")).join("");
  save("participant",participant);
}
function recent() {try{return JSON.parse(read("recent")||"[]").filter(r=>validId(r.id));}catch{return [];}}
function remember(room) {
  const latest=room.versions.at(-1);
  const entry={id:room.id,title:room.title,version:latest.id,count:room.versions.length,time:latest.time};
  save("recent",JSON.stringify([entry,...recent().filter(r=>r.id!==room.id)].slice(0,20)));
}
const api = id => "/api/rooms"+(id?"/"+id:"");
const fileURL = (id,v) => api(id)+"/files/"+v;
function drawRecent() {
  const entries=recent();
  $("#recentList").innerHTML=entries.length ? entries.map(r=>'<a class="recentrow" href="#r/'+r.id+'"><span class="tile mint">'+icon("photo")+'</span><div><b>'+esc(r.title)+'</b><small>'+r.count+' 个版本 · '+date(r.time)+'</small></div>'+icon("chevron")+'</a>').join("") : '<div class="empty">'+icon("folder")+'<div><b>还没有打开过接力</b><p>发起第一场，或先用示例合照试一遍。</p></div></div>';
  icons($("#recentList"));
}
let room=null, epoch=0, timer, busy=false, modalGeneration=0;
function toast(message) {
  const el=$("#notice");el.textContent=message;el.hidden=false;
  clearTimeout(timer);timer=setTimeout(()=>{el.hidden=true;},4300);
}
function dialog(title,html) {
  modalGeneration++;$("#dialogTitle").textContent=title;body.innerHTML=html;
  icons(modal);if(!modal.open)modal.showModal();
}
function closeDialog(){if(!busy && modal.open)modal.close();}
$("#closeModal").onclick=closeDialog;
modal.addEventListener("cancel",e=>{if(busy)e.preventDefault();});
modal.addEventListener("close",()=>{if(!modal.open){modalGeneration++;body.replaceChildren();}});
function err(message) { const el=body.querySelector(".error"); if(el){el.textContent=message;el.hidden=false;}else toast(message); }
const errorBox='<p class="error" role="alert" hidden></p>';
async function request(path,options={}) {
  let res;
  try {res=await fetch(path,{cache:"no-store",...options,headers:{"x-participant":participant,...options.headers}});}catch{throw new Error("网络未连接，请检查网络后重试。");}
  if(!res.headers.get("content-type")?.includes("application/json"))throw new Error("服务暂时不可用，请重新打开网站。");
  const data=await res.json();if(!res.ok)throw new Error(data.error||"操作未完成，请重试。");return data;
}
function acceptRoom(next) {room=next;remember(room);drawRoom();}
async function refresh(silent=false) {
  const id=location.hash.slice(3), token=epoch;
  if(!validId(id))return;
  try {
    const next=await request(api(id));
    if(token!==epoch || location.hash!=="#r/"+id)return;
    if(!room || JSON.stringify(next)!==JSON.stringify(room))acceptRoom(next);
  }catch(e){
    if(token!==epoch)return;
    if(!room){panel.innerHTML='<div class="room-error"><h1>暂时打不开这场接力</h1><p>'+esc(e.message)+'</p>'+btn("refresh","重新加载","", "secondary")+' <a href="#" class="plain">回到接力台</a></div>';}
    else if(!silent)toast(e.message);
  }
}
function drawRoom(){
  const latest=room.versions.at(-1), n=room.versions.length, lease=room.lease;
  const busyOther=lease&&!lease.mine;
  const file=fileURL(room.id,latest.id);
  const control=lease?.mine ? '<h2>轮到你修图了</h2><p class="muted">取走当前版本，在醒图里修好自己。导出后回到这里，上传接力版本。</p><div class="buttonrow">'+btn("take","取图去醒图","share")+btn("return","回传修好的图","imageplus","secondary")+'</div>'+btn("release","暂时让出这一棒","","plain") :
    '<h2>'+(busyOther?esc(lease.name)+' 正在修图':'下一棒，交给你')+'</h2><p class="muted">'+(busyOther?'对方传回照片后，你就能接棒。页面会自动更新。':'接过最新的合照，在自己的手机上慢慢修。')+'</p>'+(!busyOther?btn("claim","接过这一棒","wand"):btn("refresh","刷新进度","","secondary"));
  const versionRows=room.versions.map((v,i)=>'<div class="vrow"><div><b>'+(i===0?'原片':'第 '+i+' 棒')+(i===n-1?' · 当前版本':'')+'</b><span class="small">'+esc(v.name)+' · '+date(v.time)+' · '+size(v.size)+'</span></div><a download href="'+fileURL(room.id,v.id)+'?download">'+icon("save")+'下载</a></div>').reverse().join("");
  panel.innerHTML='<div class="roomhead"><div><a href="#" class="meta">接力台 /</a><h1>'+esc(room.title)+'</h1><small>'+n+' 个版本 · '+(n===1?"原片已就位":"已完成 "+(n-1)+" 棒")+'</small></div>'+btn("invite","邀请朋友","chain","secondary")+'</div><div class="roomgrid"><section class="photoarea"><div class="photoframe"><img src="'+file+'" alt="当前版本合照"><p class="fallback" hidden>浏览器无法预览此格式，可以下载原文件。</p></div><div class="photometa"><div><div class="filename">'+esc(latest.filename)+'</div><span class="small">'+size(latest.size)+' · '+esc(latest.type.split("/")[1].toUpperCase())+'</span></div><a class="secondary" download href="'+file+'?download">'+icon("save")+'保存</a></div></section><section class="control"><span class="tile mint">'+icon("wand")+'</span>'+control+'</section></div><section class="versions"><h2>接力记录</h2>'+versionRows+'</section>';
  const img=panel.querySelector(".photoframe img");img.onerror=()=>{img.hidden=true;img.nextElementSibling.hidden=false;};
  icons(panel);
}
async function route(){
  epoch++;busy=false;if(modal.open)modal.close();room=null;
  const isRoom=location.hash.startsWith("#r/");
  home.hidden=isRoom;panel.hidden=!isRoom;
  $("#navHome").classList.toggle("current",!isRoom&&location.hash!=="#recent");
  $("#navRecent").classList.toggle("current",location.hash==="#recent");
  if(isRoom){
    panel.innerHTML='<p role="status">正在打开合照…</p>';scrollTo(0,0);
    if(validId(location.hash.slice(3)))await refresh();
    else panel.innerHTML='<div class="room-error"><h1>接力链接不完整</h1><a href="#" class="plain">回到接力台</a></div>';
  }else{drawRecent();if(location.hash==="#recent")$("#recent").scrollIntoView();else scrollTo(0,0);}
}
const nickInput=()=>'<label class="field">你的称呼<input name="nick" required maxlength="24" autocomplete="nickname" value="'+esc(read("nick")||"")+'" placeholder="朋友们怎么叫你？"></label>';
function picker(label) {return '<label class="drop">'+icon("imageplus")+'<span>'+label+'</span><small>JPG、PNG、HEIC、HEIF、WebP · 最大 24 MB</small><input type="file" name="photo" accept="'+filesAccept+'" required aria-label="'+label+'"></label>';}
function watchPicker() {const input=body.querySelector('input[type="file"]');if(input)input.onchange=()=>{if(input.files[0])input.parentElement.querySelector("span").textContent=input.files[0].name+" · "+size(input.files[0].size);};}
function onSubmit(fn){
  const form=body.querySelector("form");
  form.onsubmit=async e=>{
    e.preventDefault();if(busy)return;
    const submit=form.querySelector('[type="submit"]'),original=submit.textContent;
    busy=true;submit.disabled=true;submit.textContent="正在处理…";
    const myEpoch=epoch;
    try{await fn(new FormData(form));}
    catch(e){if(epoch===myEpoch)err(e.message);}
    finally{busy=false;submit.disabled=false;submit.textContent=original;}
  };
}
function photoHeaders(file) {
  if(!file?.size)throw new Error("请先选择照片。");
  if(file.size>24*1024*1024)throw new Error("照片超过 24 MB，请另选一张。");
  return {"x-file-name":encodeURIComponent(file.name),"x-file-size":String(file.size),"Content-Type":"application/octet-stream"};
}
function create(demo=false) {
  dialog(demo?"试用示例接力":"发起接力",'<form>'+(demo?'<img class="demo-preview" src="/coast.jpg" alt="海边的我们，示例合照">':picker("选择一张原片"))+'<label class="field">合照名称<input name="title" required maxlength="48" value="'+(demo?"海边的我们":"")+'" placeholder="例如，周末去看海"></label>'+nickInput()+(demo?'':'<p class="hint">如需保留相机文件，请从「文件」中选择未修改的原片。网站会按所选文件的字节原样传递。</p>')+errorBox+'<button type="submit" class="primary full">'+(demo?"创建示例接力":"上传原片并发起")+'</button></form>');
  watchPicker();
  onSubmit(async fields=>{
    let file=fields.get("photo");
    if(demo){const r=await fetch("/coast.jpg");if(!r.ok)throw new Error("示例照片暂时无法读取。");file=new File([await r.blob()],"海边的我们.jpg",{type:"image/jpeg"});}
    const nick=fields.get("nick").trim(),title=fields.get("title").trim();
    if(!nick||!title)throw new Error("请填写合照名称和你的称呼。");
    const next=await request(api(),{method:"POST",body:file,headers:{...photoHeaders(file),"x-nickname":encodeURIComponent(nick),"x-room-title":encodeURIComponent(title)}});
    save("nick",nick);remember(next);modal.close();location.hash="r/"+next.id;
  });
}
function claim(){
  const id=room.id;
  dialog("接过这一棒",'<form><p class="muted">接棒后，其他人会看到你正在修图。回传、主动让棒或两小时后，下一位就能接棒。</p>'+nickInput()+errorBox+'<button type="submit" class="primary full">确认接棒</button></form>');
  onSubmit(async fields=>{
    const name=fields.get("nick").trim();if(!name)throw new Error("请填写你的称呼。");
    const next=await request(api(id)+"/claim",{method:"POST",headers:{"x-nickname":encodeURIComponent(name)}});
    save("nick",name);if(room?.id===id){acceptRoom(next);await take();}
  });
}
async function take() {
  const last=room.versions.at(-1), path=fileURL(room.id,last.id);
  dialog("取图去醒图",'<p class="muted">在系统分享面板里选择醒图。若没有醒图，选「存储图像」，再到醒图中导入。</p><p class="hint">'+esc(last.filename)+' · '+size(last.size)+'</p><button class="primary full" id="shareFile" disabled>正在准备原文件…</button><p><a class="secondary full" download href="'+path+'?download">'+icon("save")+'下载原文件</a></p>'+errorBox);
  const gen=modalGeneration;
  const b=$("#shareFile");
  if(!navigator.canShare||!navigator.share){b.hidden=true;body.querySelector(".muted").textContent="下载原文件。若文件在 iPhone「文件」中，可通过系统分享菜单存储图像，再到醒图中导入。";return;}
  try{
    const res=await fetch(path);if(!res.ok)throw new Error("取图失败，请重试。");
    const f=new File([await res.blob()],last.filename,{type:last.type});
    if(gen!==modalGeneration)return;
    if(!navigator.canShare({files:[f]})){b.hidden=true;body.querySelector(".muted").textContent="此格式请先下载原文件，再从相册导入醒图。";return;}
    b.disabled=false;b.textContent="打开系统分享面板";
    b.onclick=async()=>{try{await navigator.share({files:[f]});}catch(e){if(e.name!=="AbortError")err("无法打开分享面板，请下载原文件。");}};
  }catch(e){if(gen===modalGeneration){b.hidden=true;err(e.message);}}
}
function returnFile(){
  const id=room.id,base=room.versions.at(-1).id;
  dialog("回传修好的图",'<form>'+picker("选择醒图导出的照片")+'<p class="hint">请确认你修改的是当前版本。回传后，这张照片会成为下一棒的起点。</p>'+errorBox+'<button class="primary full" type="submit">上传并交给下一位</button></form>');
  watchPicker();onSubmit(async fields=>{
    const file=fields.get("photo");
    const next=await request(api(id)+"/versions",{method:"POST",headers:{...photoHeaders(file),"x-base-version":base},body:file});
    if(room?.id===id){acceptRoom(next);modal.close();toast("已传回新版，下一位可以接棒了。");}
  });
}
function invite(){
  dialog("邀请朋友",'<p class="muted">此站目前仅你可预览。可以在你已登录同一账号的设备上，打开这个链接继续接力。</p><input aria-label="接力邀请链接" class="linkinput" readonly value="'+esc(location.href)+'"><p class="buttonrow">'+btn("copy","复制接力链接","chain")+'</p>'+errorBox);
}
function guide(){
  dialog("使用指南",'<ol class="guide"><li><b>上传一张合照</b><p>从相册或「文件」选取原片。这个网站会保存你选中的完整文件。</p></li><li><b>在自己的手机上修图</b><p>打开接力链接，点「接过这一棒」。通过系统分享面板取图，或保存到相册后导入醒图。</p></li><li><b>回传，交给下一位</b><p>在醒图里选择合适的导出画质，回到网站上传新版。最后一棒结束后，大家就能保存成片。</p></li></ol><p class="hint">原片和历次回传均可下载。网站不重新编码图片；醒图导出和朋友圈发布时的画质由对应应用决定。</p>'+btn("dismiss","知道了","","primary full"));
}
document.addEventListener("click",async e=>{
  const target=e.target.closest("[data-do]");if(!target||busy)return;
  const action=target.dataset.do;
  try{
    if(action==="create")create();if(action==="demo")create(true);if(action==="guide")guide();if(action==="dismiss")closeDialog();
    if(action==="claim"&&room)claim();if(action==="take"&&room)await take();if(action==="return"&&room)returnFile();if(action==="invite"&&room)invite();
    if(action==="refresh")await refresh();
    if(action==="copy"){try{await navigator.clipboard.writeText(location.href);target.textContent="已复制";}catch{body.querySelector(".linkinput").select();err("已选中链接，请复制。");}}
    if(action==="release"&&room){const id=room.id;target.disabled=true;const next=await request(api(id)+"/release",{method:"POST"});if(room?.id===id)acceptRoom(next);toast("已让出这一棒。");}
  }catch(e){target.disabled=false;toast(e.message);if(room)await refresh(true);}
});
window.addEventListener("hashchange",route);
document.addEventListener("visibilitychange",()=>{if(!document.hidden&&!modal.open&&!busy)refresh(true);});
setInterval(()=>{if(!document.hidden&&room&&!modal.open&&!busy)refresh(true);},12000);
icons();route();
