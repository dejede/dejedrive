"use strict";
const GAS_URL = "https://script.google.com/macros/s/AKfycbw1aSwmZ2SVCqvrwezYsSNxZp0BTeu30oI7WzUjEYMiwR4L23kjttpl6wxJLwct18_T/exec";
const PAGE = 100, DELAY = 700;
const $ = id => document.getElementById(id);
let files = [], selected = new Set(), failed = [], shown = PAGE, busy = false, stop = false;

/* ---------- util ---------- */
const sleep = ms => new Promise(r => setTimeout(r, ms));
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
function bytes(n) {
  n = Number(n || 0); if (!n) return "0 B";
  const u = ["B", "KB", "MB", "GB", "TB"]; let i = 0;
  while (n >= 1024 && i < 4) { n /= 1024; i++; }
  return `${n.toFixed(n >= 10 || !i ? 0 : 1)} ${u[i]}`;
}
let tt;
function toast(m) { const t = $("toast"); t.textContent = m; t.classList.add("show"); clearTimeout(tt); tt = setTimeout(() => t.classList.remove("show"), 3000); }
function msg(m, err) { $("msg").textContent = m || ""; $("msg").classList.toggle("err", !!err); }
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
};

/* ---------- API (JSONP ke Google Apps Script) ---------- */
function jsonp(action, params = {}, timeout = 30000) {
  return new Promise((resolve, reject) => {
    const cb = "dj_" + Date.now() + "_" + Math.random().toString(36).slice(2);
    const s = document.createElement("script");
    let t;
    const done = () => { clearTimeout(t); delete window[cb]; s.remove(); };
    t = setTimeout(() => { done(); reject(new Error("Server tidak merespons. Coba lagi sebentar.")); }, timeout);
    window[cb] = d => {
      done();
      if (!d) return reject(new Error("Server mengirim data kosong."));
      if (d.ok === false) return reject(new Error(d.error || "Terjadi kesalahan di server."));
      resolve(d);
    };
    s.onerror = () => { done(); reject(new Error("Gagal menghubungi server. Periksa koneksi internet.")); };
    s.src = GAS_URL + "?" + new URLSearchParams({ action, ...params, callback: cb });
    document.body.appendChild(s);
  });
}

async function api(action, params = {}, timeout = 30000) {
  // fetch tanpa cookie: terhindar dari pengalihan "pilih akun" Google (penyebab CORB)
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), timeout);
  try {
    const r = await fetch(GAS_URL + "?" + new URLSearchParams({ action, ...params }), { credentials: "omit", signal: ctl.signal });
    const d = await r.json();
    if (!d) throw new Error("Server mengirim data kosong.");
    if (d.ok === false) throw new Error(d.error || "Terjadi kesalahan di server.");
    return d;
  } catch (e) {
    if (e.name === "AbortError") throw new Error("Server tidak merespons. Coba lagi sebentar.");
    if (e instanceof TypeError || e instanceof SyntaxError) return jsonp(action, params, timeout); // cadangan
    throw e;
  } finally { clearTimeout(t); }
}

async function checkBackend() {
  const b = $("backendStatus");
  b.className = "badge checking"; b.textContent = "Memeriksa…";
  $("backendHint").classList.add("hidden");
  try { const d = await api("health", {}, 15000); b.className = "badge online"; b.textContent = `Online${d.version ? " v" + d.version : ""}`; }
  catch { b.className = "badge offline"; b.textContent = "Offline"; $("backendHint").classList.toggle("hidden", !navigator.onLine); }
}

/* ---------- input ---------- */
function folderId(v) {
  v = (v || "").trim();
  if (/^[\w-]{20,}$/.test(v)) return v;
  try {
    const u = new URL(v);
    if (!/(^|\.)google\.com$/.test(u.hostname)) return null;
    return (u.pathname.match(/\/folders\/([\w-]+)/) || [])[1] || u.searchParams.get("id");
  } catch { return null; }
}

function renderRecent() {
  const r = store.get("dejede-recent", []), el = $("recent");
  el.classList.toggle("hidden", !r.length);
  el.innerHTML = r.map((x, i) => `<button class="chip" type="button" data-i="${i}" title="${esc(x.name)}">${esc(x.name)}</button>`).join("");
}

/* ---------- scan ---------- */
async function scan() {
  if (busy) return;
  const raw = $("driveUrl").value, id = folderId(raw);
  if (!id) return msg("Tautan tidak valid. Gunakan tautan folder, mis. drive.google.com/drive/folders/…", true);
  if (!navigator.onLine) return msg("Anda sedang offline.", true);
  $("scanBtn").disabled = true; $("scanBtn").classList.add("loading"); $("scanLabel").textContent = "Memindai…";
  msg("Memindai folder dan subfolder. Folder besar bisa memakan waktu.");
  try {
    const d = await api("scan", { folderId: id }, 120000);
    files = (d.files || []).map(f => ({ ...f, path: f.path || f.name || "", name: f.name || String(f.path || "").split("/").pop() }));
    selected = new Set(files.map(f => f.id)); failed = []; shown = PAGE;
    $("folderName").textContent = d.name || "Folder Google Drive";
    $("fileCount").textContent = d.fileCount || files.length;
    $("folderCount").textContent = d.folderCount || 0;
    $("totalSize").textContent = bytes(d.totalSize);
    $("search").value = "";
    progress(0, 1, "Siap diunduh");
    $("detail").textContent = "Pilih file lalu tekan Unduh. Jika peramban meminta izin unduhan berganda, pilih Izinkan.";
    $("errors").classList.add("hidden"); $("retryBtn").classList.add("hidden");
    renderFiles(); $("result").classList.remove("hidden");
    msg(`Selesai: ${files.length} file ditemukan.`);
    const rec = store.get("dejede-recent", []).filter(x => x.id !== id);
    rec.unshift({ id, name: d.name || "Folder", url: raw.trim() }); store.set("dejede-recent", rec.slice(0, 5)); renderRecent();
    $("result").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (e) { msg(e.message, true); }
  finally { $("scanBtn").disabled = false; $("scanBtn").classList.remove("loading"); $("scanLabel").textContent = "Pindai"; }
}

/* ---------- daftar file ---------- */
function icon(f) {
  const m = f.mimeType || "", e = (f.name.split(".").pop() || "").toLowerCase();
  if (m.startsWith("image/") || /^(jpe?g|png|gif|webp|heic|raw|cr2|nef|arw|dng)$/.test(e)) return "🖼️";
  if (m.startsWith("video/") || /^(mp4|mov|mkv|avi)$/.test(e)) return "🎬";
  if (m.startsWith("audio/") || /^(mp3|wav|m4a)$/.test(e)) return "🎵";
  if (e === "pdf") return "📕";
  if (/^(zip|rar|7z)$/.test(e)) return "🗜️";
  if (/sheet|^(xlsx?|csv)$/.test(m + "|" + e)) return "📊";
  return "📄";
}
function view() {
  const q = $("search").value.trim().toLowerCase(), s = $("sort").value;
  const l = files.filter(f => !q || f.path.toLowerCase().includes(q));
  l.sort(s === "size" ? (a, b) => (b.size || 0) - (a.size || 0) : s === "name" ? (a, b) => a.name.localeCompare(b.name, "id", { numeric: true }) : (a, b) => a.path.localeCompare(b.path, "id", { numeric: true }));
  return l;
}
function renderFiles() {
  const l = view(), part = l.slice(0, shown);
  $("fileList").innerHTML = part.length ? part.map(f => {
    const dir = f.path.includes("/") ? f.path.slice(0, f.path.lastIndexOf("/")) : "";
    return `<div class="file"><label><input type="checkbox" data-id="${esc(f.id)}" ${selected.has(f.id) ? "checked" : ""}>
      <span class="fi">${icon(f)}</span><span class="ft"><span class="fn">${esc(f.name)}</span>${dir ? `<span class="fp">${esc(dir)}</span>` : ""}</span></label>
      <span class="size">${bytes(f.size)}</span><button class="dl" type="button" data-dl="${esc(f.id)}" aria-label="Unduh ${esc(f.name)}">⬇</button></div>`;
  }).join("") : `<div class="empty">${files.length ? "Tidak ada file yang cocok." : "Folder ini tidak berisi file."}</div>`;
  $("moreBtn").classList.toggle("hidden", l.length <= shown);
  $("moreBtn").textContent = `Tampilkan lebih banyak (${l.length - shown} lagi)`;
  updateSel();
}
function updateSel() {
  const n = selected.size, size = files.filter(f => selected.has(f.id)).reduce((a, f) => a + Number(f.size || 0), 0);
  $("selInfo").textContent = `${n} dari ${files.length} dipilih · ${bytes(size)}`;
  $("selAll").checked = n > 0 && n === files.length; $("selAll").indeterminate = n > 0 && n < files.length;
  $("downloadBtn").textContent = n ? `Unduh ${n} file` : "Unduh"; $("downloadBtn").disabled = busy || !n;
}

/* ---------- unduh ---------- */
function progress(done, total, label) {
  const p = total ? Math.round(done / total * 100) : 0;
  $("bar").style.width = p + "%"; $("percent").textContent = p + "%"; $("status").textContent = label;
}
function trigger(url) { // iframe tersembunyi: tidak diblokir popup blocker seperti target=_blank setelah await
  const f = document.createElement("iframe");
  f.style.display = "none"; f.src = url; document.body.appendChild(f);
  setTimeout(() => f.remove(), 60000);
}
async function downloadOne(file) {
  const d = await api("downloadUrl", { fileId: file.id, name: file.name, mimeType: file.mimeType || "" });
  let u; try { u = new URL(d.url); } catch { throw new Error("URL unduhan tidak tersedia."); }
  if (u.protocol !== "https:" || !/(^|\.)(google\.com|googleusercontent\.com)$/.test(u.hostname)) throw new Error("URL unduhan tidak dikenali.");
  trigger(u.href);
}
async function downloadAll(list) {
  if (busy || !list.length) return;
  busy = true; stop = false; failed = [];
  $("stopBtn").classList.remove("hidden"); $("retryBtn").classList.add("hidden"); $("downloadBtn").disabled = true;
  let i = 0;
  for (; i < list.length && !stop; i++) {
    $("detail").textContent = `Mengunduh (${i + 1}/${list.length}): ${list[i].path}`;
    try { await downloadOne(list[i]); } catch (e) { failed.push({ file: list[i], error: e.message }); }
    progress(i + 1, list.length, failed.length ? `Berjalan · ${failed.length} gagal` : "Mengunduh…");
    await sleep(DELAY);
  }
  busy = false;
  $("stopBtn").classList.add("hidden");
  $("status").textContent = stop ? `Dihentikan di ${i} dari ${list.length}` : failed.length ? `Selesai, ${failed.length} gagal` : "Semua unduhan sudah dikirim ke peramban";
  $("detail").textContent = "Periksa folder Unduhan perangkat Anda.";
  $("retryBtn").classList.toggle("hidden", !failed.length);
  $("errors").classList.toggle("hidden", !failed.length);
  $("errors").innerHTML = failed.length ? `<b>File gagal diunduh</b>` + failed.map(x => `<div>${esc(x.file.path)}<br><small>${esc(x.error)}</small></div>`).join("") : "";
  updateSel();
}
window.addEventListener("beforeunload", e => { if (busy) { e.preventDefault(); e.returnValue = ""; } });

/* ---------- event ---------- */
$("scanBtn").onclick = scan;
$("driveUrl").addEventListener("keydown", e => { if (e.key === "Enter") scan(); });
$("driveUrl").addEventListener("input", () => msg(""));
$("pasteBtn").onclick = async () => {
  try { $("driveUrl").value = (await navigator.clipboard.readText()).trim(); msg(""); if (folderId($("driveUrl").value)) toast("Tautan ditempel"); }
  catch { $("driveUrl").focus(); toast("Izin clipboard ditolak. Tempel manual pada kolom."); }
};
$("recent").onclick = e => { const b = e.target.closest("[data-i]"); if (!b) return; const x = store.get("dejede-recent", [])[b.dataset.i]; if (x) { $("driveUrl").value = x.url || x.id; scan(); } };
$("search").oninput = () => { shown = PAGE; renderFiles(); };
$("sort").onchange = () => { shown = PAGE; renderFiles(); };
$("moreBtn").onclick = () => { shown += PAGE; renderFiles(); };
$("selAll").onchange = e => { (e.target.checked ? view() : files).forEach(f => e.target.checked ? selected.add(f.id) : selected.delete(f.id)); renderFiles(); };
$("fileList").addEventListener("change", e => { const id = e.target.dataset.id; if (id) { e.target.checked ? selected.add(id) : selected.delete(id); updateSel(); } });
$("fileList").addEventListener("click", async e => {
  const b = e.target.closest("[data-dl]"); if (!b || busy) return;
  const f = files.find(x => x.id === b.dataset.dl); b.disabled = true;
  try { await downloadOne(f); toast("Unduhan dimulai: " + f.name); } catch (err) { toast(err.message); }
  b.disabled = false;
});
$("downloadBtn").onclick = () => downloadAll(files.filter(f => selected.has(f.id)));
$("retryBtn").onclick = () => downloadAll(failed.map(x => x.file));
$("stopBtn").onclick = () => { stop = true; $("stopBtn").disabled = true; };
$("backendStatus").onclick = checkBackend;
$("themeBtn").onclick = () => {
  const d = document.documentElement.classList.toggle("dark");
  try{localStorage.setItem("dejede-theme", d ? "dark" : "light")}catch{};
  document.querySelector('meta[name="theme-color"]').content = d ? "#1a281f" : "#3b6e51";
};
const net = () => $("offline").classList.toggle("hidden", navigator.onLine);
addEventListener("online", () => { net(); checkBackend(); }); addEventListener("offline", net);
net(); renderRecent(); checkBackend();
if ("serviceWorker" in navigator && /^https?:$/.test(location.protocol)) addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
