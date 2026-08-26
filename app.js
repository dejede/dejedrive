// DEJEDE GDrive Downloader — GitHub Pages frontend
// Replace this URL after deploying Code.gs as a Google Apps Script Web App.
const GAS_URL = "PASTE_YOUR_GOOGLE_APPS_SCRIPT_WEB_APP_URL_HERE";

const $ = id => document.getElementById(id);
let files=[], failed=[], targetDir=null;

function folderIdFromUrl(value){
  try{
    const u=new URL(value);
    const m=u.pathname.match(/\/folders\/([^/]+)/);
    return m ? m[1] : u.searchParams.get("id");
  }catch{return null}
}
function bytes(n){
  n=Number(n||0); if(!n)return "0 B";
  const units=["B","KB","MB","GB","TB"];let i=0;
  while(n>=1024&&i<units.length-1){n/=1024;i++}
  return `${n.toFixed(n>=10||i===0?0:2)} ${units[i]}`;
}
function esc(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));}
function progress(done,total,label){
  const p=total?Math.round(done/total*100):0;
  $("bar").style.width=p+"%";$("percent").textContent=p+"%";$("status").textContent=label;
}
async function api(action, params={}){
  if(GAS_URL.includes("PASTE_")) throw new Error("GAS_URL belum diisi di app.js");
  const q=new URLSearchParams({action,...params});
  const r=await fetch(`${GAS_URL}?${q}`);
  const text=await r.text(); let d;
  try{d=JSON.parse(text)}catch{throw new Error(text.slice(0,300))}
  if(!r.ok||d.ok===false)throw new Error(d.error||"Request gagal");
  return d;
}
async function scan(){
  const id=folderIdFromUrl($("driveUrl").value.trim());
  if(!id){alert("URL Google Drive tidak valid.");return}
  $("scanBtn").disabled=true;$("status").textContent="Scanning...";
  try{
    const d=await api("scan",{folderId:id});
    files=d.files||[]; failed=[]; targetDir=null;
    $("folderName").textContent=d.name;$("fileCount").textContent=d.fileCount;
    $("folderCount").textContent=d.folderCount;$("totalSize").textContent=bytes(d.totalSize);
    $("readyCount").textContent=`${files.length} files`;
    $("fileList").innerHTML=files.map(f=>`<div class="file"><span>📄</span><span class="path">${esc(f.path)}</span><span class="size">${bytes(f.size)}</span></div>`).join("");
    $("result").classList.remove("hidden");$("retryBtn").disabled=true;
    $("detail").textContent="Scan selesai. Pilih folder tujuan lalu mulai download.";
    $("errors").classList.add("hidden");
  }catch(e){$("status").textContent=e.message}
  finally{$("scanBtn").disabled=false}
}
async function chooseDir(){
  if(!("showDirectoryPicker" in window)){alert("Browser ini belum mendukung pemilihan folder lokal otomatis. Gunakan Chrome/Edge yang mendukung File System Access API.");return}
  targetDir=await showDirectoryPicker({mode:"readwrite"});$("detail").textContent="Folder tujuan dipilih.";
}
async function downloadOne(f){
  // The Apps Script backend returns a temporary Drive download URL.
  const d=await api("downloadUrl",{fileId:f.id,name:f.name,mimeType:f.mimeType||""});
  const r=await fetch(d.url); if(!r.ok)throw new Error(`HTTP ${r.status}`);
  if(targetDir){
    let dir=targetDir;
    for(const part of f.path.split("/").slice(1,-1))dir=await dir.getDirectoryHandle(part,{create:true});
    const h=await dir.getFileHandle(f.name,{create:true});const w=await h.createWritable();
    if(r.body)await r.body.pipeTo(w);else await w.write(await r.arrayBuffer());
  }else{
    const a=document.createElement("a");a.href=d.url;a.download=f.name;a.rel="noopener";document.body.appendChild(a);a.click();a.remove();
  }
}
async function downloadAll(list=files){
  if(!list.length)return; failed=[];$("downloadBtn").disabled=true;$("retryBtn").disabled=true;
  for(let i=0;i<list.length;i++){
    const f=list[i];$("detail").textContent=`${i+1}/${list.length} • ${f.path}`;
    try{await downloadOne(f)}catch(e){failed.push({file:f,error:e.message})}
    progress(i+1,list.length,failed.length?`Processing • ${failed.length} failed`:"Downloading...");
  }
  $("status").textContent=failed.length?`Finished with ${failed.length} failed.`:"All files completed.";
  $("retryBtn").disabled=!failed.length;
  if(failed.length){$("errors").classList.remove("hidden");$("errors").innerHTML="<b>Failed files</b>"+failed.map(x=>`<div class="error-row">${esc(x.file.path)}<br><small>${esc(x.error)}</small></div>`).join("")}
  $("downloadBtn").disabled=false;
}
$("scanBtn").onclick=scan;
$("pasteBtn").onclick=async()=>{try{$("driveUrl").value=await navigator.clipboard.readText()}catch{alert("Clipboard tidak dapat diakses.")}};
$("selectFolderBtn").onclick=chooseDir;
$("downloadBtn").onclick=()=>downloadAll();
$("retryBtn").onclick=()=>downloadAll(failed.map(x=>x.file));
$("themeBtn").onclick=()=>{document.body.classList.toggle("dark");localStorage.setItem("dejede-theme",document.body.classList.contains("dark")?"dark":"light")};
if(localStorage.getItem("dejede-theme")==="dark")document.body.classList.add("dark");
