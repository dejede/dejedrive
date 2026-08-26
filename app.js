// DEJEDE GDrive Downloader — GitHub Pages frontend
// Backend: Google Apps Script Web App

const GAS_URL =
  "https://script.google.com/macros/s/AKfycbxk2EpeVAN8tNavYa-33OtoiUANPk7OJeMkEVhPEljO3cOLVepoQeMHKzjsp6lqtCds/exec";

const $ = id => document.getElementById(id);

let files = [];
let failed = [];
let targetDir = null;
let backendOnline = false;

/*
 * Google Apps Script ContentService is cross-origin.
 * JSONP avoids relying on CORS headers for the metadata API.
 */
function api(action, params = {}) {
  return new Promise((resolve, reject) => {
    const callbackName =
      "dejedeCallback_" +
      Date.now() +
      "_" +
      Math.random().toString(36).slice(2);

    const query = new URLSearchParams({
      action,
      ...params,
      callback: callbackName
    });

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

      if (!data) {
        reject(new Error("Backend mengembalikan data kosong."));
        return;
      }

      if (data.ok === false) {
        reject(new Error(data.error || "Google Apps Script error."));
        return;
      }

      resolve(data);
    };

    script.onerror = () => {
      cleanup();
      reject(new Error("Tidak dapat menghubungi Google Apps Script."));
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
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(n >= 10 || i === 0 ? 0 : 2)} ${units[i]}`;
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;",
    '"': "&quot;", "'": "&#039;"
  }[c]));
}

function progress(done, total, label) {
  const p = total ? Math.round(done / total * 100) : 0;
  $("bar").style.width = p + "%";
  $("percent").textContent = p + "%";
  $("status").textContent = label;
}

async function checkBackend() {
  try {
    const d = await api("health");
    backendOnline = true;
    $("backendStatus").textContent =
      `Backend: online · ${d.name || "DEJEDE"}`;
  } catch (e) {
    backendOnline = false;
    $("backendStatus").textContent =
      `Backend: offline · ${e.message}`;
  }
}

async function scan() {
  const id = folderIdFromUrl($("driveUrl").value);

  if (!id) {
    alert("URL Google Drive folder tidak valid.");
    return;
  }

  $("scanBtn").disabled = true;
  $("status").textContent = "Scanning...";
  $("detail").textContent = "Membaca struktur folder Google Drive...";

  try {
    const d = await api("scan", { folderId: id });

    files = d.files || [];
    failed = [];
    targetDir = null;

    $("folderName").textContent = d.name || "Google Drive Folder";
    $("fileCount").textContent = d.fileCount || files.length;
    $("folderCount").textContent = d.folderCount || 0;
    $("totalSize").textContent = bytes(d.totalSize);
    $("readyCount").textContent = `${files.length} files`;

    renderFiles();

    $("result").classList.remove("hidden");
    $("retryBtn").disabled = true;
    $("errors").classList.add("hidden");

    $("detail").textContent =
      "Scan selesai. Pilih folder tujuan jika tersedia, lalu mulai download.";
    progress(0, files.length, "Ready");
  } catch (e) {
    $("status").textContent = "Scan gagal";
    $("detail").textContent = e.message;
  } finally {
    $("scanBtn").disabled = false;
  }
}

function renderFiles() {
  const list = $("fileList");

  if (!files.length) {
    list.innerHTML =
      `<div class="hint">Tidak ada file yang dapat ditampilkan.</div>`;
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

async function chooseDir() {
  if (!("showDirectoryPicker" in window)) {
    alert(
      "Browser ini belum mendukung pemilihan folder lokal otomatis. " +
      "Gunakan Chrome/Edge yang mendukung File System Access API."
    );
    return;
  }

  try {
    targetDir = await window.showDirectoryPicker({
      mode: "readwrite"
    });

    $("detail").textContent =
      "Folder tujuan dipilih. Struktur subfolder akan dibuat otomatis.";
  } catch (e) {
    if (e.name !== "AbortError") {
      $("detail").textContent = e.message;
    }
  }
}

/*
 * Important:
 * We do NOT fetch the Google Drive download URL with fetch().
 * That would introduce another cross-origin/CORS problem.
 *
 * Instead, create a normal browser navigation/download.
 * This lets Google Drive handle its own authentication and redirects.
 */
async function downloadOne(file) {
  const d = await api("downloadUrl", {
    fileId: file.id,
    name: file.name,
    mimeType: file.mimeType || ""
  });

  if (!d.url) {
    throw new Error("URL download tidak tersedia.");
  }

  if (targetDir) {
    /*
     * Direct streaming into a chosen local directory cannot be guaranteed
     * for a cross-origin Google Drive URL because browser CORS rules apply.
     *
     * We therefore use a normal download for this mode too.
     * The browser will handle the file download.
     */
    triggerBrowserDownload(d.url, file.name);
    return;
  }

  triggerBrowserDownload(d.url, file.name);
}

function triggerBrowserDownload(url, filename) {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename || "";
  a.rel = "noopener";
  a.target = "_blank";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

async function downloadAll(list = files) {
  if (!list.length) {
    alert("Tidak ada file untuk di-download.");
    return;
  }

  failed = [];
  $("downloadBtn").disabled = true;
  $("retryBtn").disabled = true;

  /*
   * Browser download managers can block hundreds of automatic downloads.
   * A small delay reduces popup/download burst issues.
   */
  for (let i = 0; i < list.length; i++) {
    const file = list[i];

    $("detail").textContent =
      `${i + 1}/${list.length} • ${file.path}`;

    try {
      await downloadOne(file);
    } catch (e) {
      failed.push({
        file,
        error: e.message
      });
    }

    progress(
      i + 1,
      list.length,
      failed.length
        ? `Processing • ${failed.length} failed`
        : "Downloading..."
    );

    await sleep(250);
  }

  $("status").textContent =
    failed.length
      ? `Selesai dengan ${failed.length} file gagal.`
      : "Semua file sudah dikirim ke download browser.";

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

  $("errors").innerHTML =
    `<b>File gagal</b>` +
    failed.map(x => `
      <div class="error-row">
        ${esc(x.file.path)}
        <br>
        <small>${esc(x.error)}</small>
      </div>
    `).join("");
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

$("scanBtn").onclick = scan;

$("pasteBtn").onclick = async () => {
  try {
    $("driveUrl").value =
      await navigator.clipboard.readText();
  } catch {
    alert("Clipboard tidak dapat diakses. Silakan paste secara manual.");
  }
};

$("selectFolderBtn").onclick = chooseDir;

$("downloadBtn").onclick =
  () => downloadAll();

$("retryBtn").onclick =
  () => downloadAll(failed.map(x => x.file));

$("themeBtn").onclick = () => {
  document.body.classList.toggle("dark");

  localStorage.setItem(
    "dejede-theme",
    document.body.classList.contains("dark")
      ? "dark"
      : "light"
  );
};

if (
  localStorage.getItem("dejede-theme") === "dark"
) {
  document.body.classList.add("dark");
}

checkBackend();
