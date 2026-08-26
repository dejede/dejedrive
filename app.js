const GAS_URL = "https://script.google.com/macros/s/AKfycbxk2EpeVAN8tNavYa-33OtoiUANPk7OJeMkEVhPEljO3cOLVepoQeMHKzjsp6lqtCds/exec";

const $ = id => document.getElementById(id);

let files = [];
let failed = [];
let backendOnline = false;

function api(action, params = {}) {
  return new Promise((resolve, reject) => {
    const callbackName = "dejedeCallback_" + Date.now() + "_" + Math.random().toString(36).slice(2);
    const query = new URLSearchParams({ action, ...params, callback: callbackName });
    const script = document.createElement("script");
    let finished = false;

    const cleanup = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      delete window[callbackName];
      script.remove();
    };

    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Backend timeout. Periksa deployment Google Apps Script."));
    }, 30000);

    window[callbackName] = data => {
      cleanup();
      if (!data) return reject(new Error("Data kosong dari server."));
      if (data.ok === false) return reject(new Error(data.error || "Terjadi kesalahan pada Apps Script."));
      resolve(data);
    };

    script.onerror = () => {
        cleanup();
        reject(new Error("Gagal menghubungi Google Apps Script."));
    };

    script.src = GAS_URL + "?" + query.toString();
    document.body.appendChild(script);
  });
}

function folderIdFromUrl(value) {
  try {
    const u = new URL(value.trim());
    const match = u.pathname.match(/\/folders\/([^/]+)/);
    return match ? match[1] : u.searchParams.get("id");
  } catch {
    return null;
  }
}

function bytes(n) {
  n = Number(n || 0);
  if (!n) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n >= 10 || i === 0 ? 0 : 2)} ${units[i]}`;
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  }[c]));
}

function progress(done, total, label) {
  const p = total ? Math.round(done / total * 100) : 0;
  $("bar").style.width = p + "%";
  $("percent").textContent = p + "%";
  $("status").textContent = label;
}

async function checkBackend() {
  const badge = $("backendStatus");
  badge.className = "backend-badge checking";
  badge.textContent = "Checking server...";
  try {
    const d = await api("health");
    backendOnline = true;
    badge.className = "backend-badge online";
    badge.textContent = `Server Online (${d.version || "1.0.2"})`;
  } catch (e) {
    backendOnline = false;
    badge.className = "backend-badge offline";
    badge.textContent = "Server Offline";
  }
}

async function scan() {
  const id = folderIdFromUrl($("driveUrl").value);
  if (!id) {
    alert("URL Folder Google Drive tidak valid!");
    return;
  }

  $("scanBtn").disabled = true;
  $("status").textContent = "Scanning...";
  $("detail").textContent = "Menganalisis folder dan subfolder Google Drive...";

  try {
    const d = await api("scan", { folderId: id });
    files = d.files || [];
    failed = [];

    $("folderName").textContent = d.name || "Google Drive Folder";
    $("fileCount").textContent = d.fileCount || files.length;
    $("folderCount").textContent = d.folderCount || 0;
    $("totalSize").textContent = bytes(d.totalSize);
    $("readyCount").textContent = `${files.length} items found`;

    renderFiles();
    $("result").classList.remove("hidden");
    $("retryBtn").disabled = true;
    $("errors").classList.add("hidden");
    $("detail").textContent = "Scan berhasil! Silakan unduh file melalui tombol di bawah.";
    progress(0, files.length, "Ready");
  } catch (e) {
    $("status").textContent = "Scan Gagal";
    $("detail").textContent = e.message;
  } finally {
    $("scanBtn").disabled = false;
  }
}

function renderFiles() {
  const list = $("fileList");
  if (!files.length) {
    list.innerHTML = `<div class="hint">Tidak ada file yang ditemukan.</div>`;
    return;
  }
  list.innerHTML = files.map(f => `
    <div class="file">
      <span>📄</span>
      <span class="path">${esc(f.path)}</span>
      <span class="size">${bytes(f.size)}</span>
    </div>
  `).join("");
}

async function downloadOne(file) {
  const d = await api("downloadUrl", { fileId: file.id, name: file.name, mimeType: file.mimeType || "" });
  if (!d.url) throw new Error("URL download tidak tersedia.");
  
  const a = document.createElement("a");
  a.href = d.url;
  a.download = file.name || "";
  a.rel = "noopener";
  a.target = "_blank";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

async function downloadAll(list = files) {
  if (!list.length) {
    alert("Tidak ada file untuk diunduh.");
    return;
  }

  failed = [];
  $("downloadBtn").disabled = true;
  $("retryBtn").disabled = true;

  for (let i = 0; i < list.length; i++) {
    const file = list[i];
    $("detail").textContent = `Mengunduh (${i + 1}/${list.length}): ${file.path}`;

    try {
      await downloadOne(file);
    } catch (e) {
      failed.push({ file, error: e.message });
    }

    progress(i + 1, list.length, failed.length ? `Proses • ${failed.length} gagal` : "Mengunduh file...");
    await sleep(400); // Jeda sedikit lebih panjang agar browser tidak memblokir unduhan masal
  }

  $("status").textContent = failed.length ? `Selesai dengan ${failed.length} file gagal.` : "Semua file berhasil dipicu ke browser.";
  $("retryBtn").disabled = !failed.length;
  renderErrors();
  $("downloadBtn").disabled = false;
}

function renderErrors() {
  if (!failed.length) {
    $("errors").classList.add("hidden");
    return;
  }
  $("errors").classList.remove("hidden");
  $("errors").innerHTML = `<b>File Gagal Diunduh:</b>` + failed.map(x => `
    <div class="error-row">
      ${esc(x.file.path)}<br><small>${esc(x.error)}</small>
    </div>
  `).join("");
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Event Listeners
$("scanBtn").onclick = scan;

$("pasteBtn").onclick = async () => {
  try {
    $("driveUrl").value = await navigator.clipboard.readText();
  } catch {
    alert("Gagal membaca clipboard. Tempel manual (Ctrl+V).");
  }
};

$("downloadBtn").onclick = () => downloadAll();
$("retryBtn").onclick = () => downloadAll(failed.map(x => x.file));

$("themeBtn").onclick = () => {
  document.body.classList.toggle("dark");
  localStorage.setItem("dejede-theme", document.body.classList.contains("dark") ? "dark" : "light");
};

if (localStorage.getItem("dejede-theme") === "dark") {
  document.body.classList.add("dark");
}

checkBackend();
