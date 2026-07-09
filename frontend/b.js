// b.js — SQL file browser + "Ask AI" using the dedicated structured-output sql-agent

const configInput      = document.getElementById("configInput");
const fileList         = document.getElementById("file-list");
const refreshBtn        = document.getElementById("refreshBtn");
const selectedFilename  = document.getElementById("selectedFilename");
const originalSqlEl     = document.getElementById("originalSql");
const suggestedSqlEl    = document.getElementById("suggestedSql");
const askBtn            = document.getElementById("askBtn");
const statusLine        = document.getElementById("status-line");
const analysisPanel     = document.getElementById("analysis-panel");
const analysisBadge     = document.getElementById("analysisBadge");
const issuesList        = document.getElementById("issuesList");
const explanationText   = document.getElementById("explanationText");

let currentFile = null;

// Separate config from the chat agent (different service/port) — its own storage key
const STORAGE_KEY = "relmap_sql_agent_config";
const saved = sessionStorage.getItem(STORAGE_KEY);
if (saved) configInput.value = saved;
configInput.addEventListener("input", () => sessionStorage.setItem(STORAGE_KEY, configInput.value));

function parseConfig() {
  const raw = configInput.value.trim();
  if (!raw) return null;
  const idx = raw.lastIndexOf("|");
  if (idx === -1) return null;
  const url = raw.slice(0, idx).trim();
  const token = raw.slice(idx + 1).trim();
  if (!url || !token) return null;
  return { url, token };
}

function setStatus(text, cls = "") {
  statusLine.textContent = text;
  statusLine.className = cls;
}

async function refreshFiles() {
  refreshBtn.disabled = true;
  fileList.innerHTML = `<div class="empty-hint">Loading...</div>`;

  try {
    const res = await fetch("/sql/list");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    renderFileList(data.files || []);
  } catch (err) {
    fileList.innerHTML = `<div class="empty-hint">Failed to load files: ${err.message}</div>`;
  } finally {
    refreshBtn.disabled = false;
  }
}

// function renderFileList(files) {
//   fileList.innerHTML = "";
//   if (files.length === 0) {
//     fileList.innerHTML = `<div class="empty-hint">No .sql files found in the SQL folder.</div>`;
//     return;
//   }
//   files.forEach(name => {
//     const row = document.createElement("div");
//     row.className = "file-row";
//     row.textContent = name;
//     row.addEventListener("click", () => selectFile(name, row));
//     fileList.appendChild(row);
//   });
// }

function renderFileList(files) {
  fileList.innerHTML = "";
  if (files.length === 0) {
    fileList.innerHTML = `<div class="empty-hint">No .sql files found in the SQL folder.</div>`;
    return;
  }
  files.forEach(name => {
    const row = document.createElement("div");
    row.className = "file-row";
    // restore selected state if this was the selected file
    if (name === currentFile) row.classList.add("selected");
    row.textContent = name;
    row.addEventListener("click", () => selectFile(name, row));
    fileList.appendChild(row);
  });
}

async function selectFile(name, rowEl) {
  document.querySelectorAll(".file-row").forEach(r => r.classList.remove("selected"));
  rowEl.classList.add("selected");
  currentFile = name;
  selectedFilename.textContent = name;
  askBtn.disabled = false;
  suggestedSqlEl.textContent = "Suggestions will appear here after you click \"Ask AI\".";
  analysisPanel.classList.remove("show");
  setStatus("");

  try {
    const res = await fetch(`/sql/read?filename=${encodeURIComponent(name)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    originalSqlEl.textContent = data.content;
  } catch (err) {
    originalSqlEl.textContent = `Failed to load file: ${err.message}`;
  }
}

async function askAI() {
  if (!currentFile) return;

  const config = parseConfig();
  if (!config) {
    setStatus("Paste a valid url|token config line first", "err");
    return;
  }

  askBtn.disabled = true;
  askBtn.textContent = "Asking AI...";
  suggestedSqlEl.textContent = "Waiting for AI response...";
  analysisPanel.classList.remove("show");
  setStatus("Sending query to sql-agent...");

  try {
    // Read SQL content already loaded in the UI
    const res = await fetch("/sql/ask-ai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filename: currentFile,
        url: config.url,
        token: config.token,
        dialect: "redshift"
      })
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`HTTP ${res.status}: ${errText.slice(0, 200)}`);
    }

    const data = await res.json();
    suggestedSqlEl.textContent = data.fixed_query;

    // Save the fixed file via backend
    await fetch("/sql/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filename: `fixed_${currentFile}`,
        content: data.fixed_query
      })
    });
    setStatus(`Saved as fixed_${currentFile}`, "ok");

    // Render structured analysis
    if (data.has_issues) {
      analysisBadge.textContent = "Issues Found";
      analysisBadge.className = "analysis-badge issues";
    } else {
      analysisBadge.textContent = "No Issues Found";
      analysisBadge.className = "analysis-badge clean";
    }
    issuesList.innerHTML = "";
    (data.issues || []).forEach(issue => {
      const li = document.createElement("li");
      li.textContent = issue;
      issuesList.appendChild(li);
    });
    explanationText.textContent = data.explanation || "(no explanation provided)";
    analysisPanel.classList.add("show");

    // Refresh file list so the new file shows up
    // Refresh file list and select the new fixed file
    // Refresh file list and select the new fixed file
    const newFile = `fixed_${currentFile}`;
    await refreshFiles();
    const rows = fileList.querySelectorAll(".file-row");
    rows.forEach(row => {
      if (row.textContent === newFile) {
        row.classList.add("selected");
        currentFile = newFile;
        selectedFilename.textContent = newFile;
      }
    });
  

  } catch (err) {
    suggestedSqlEl.textContent = `Failed: ${err.message}`;
    setStatus("Ask AI failed — see message above", "err");
  } finally {
    askBtn.disabled = false;
    askBtn.textContent = "Ask AI";
  }
}