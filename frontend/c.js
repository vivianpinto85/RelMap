// c.js — SQL Debug Notebook

// ── DOM refs ──────────────────────────────────────────────────────────────────
const chatConfig  = document.getElementById("chatConfig");
const fileList    = document.getElementById("file-list");
const queryEditor = document.getElementById("queryEditor");
const debugEditor = document.getElementById("debugEditor");
const notesArea   = document.getElementById("notesArea");

// ── State ─────────────────────────────────────────────────────────────────────
let currentFile     = null;
let lastDebugResult = null;
let followupResults = [];

// ── Config persistence ────────────────────────────────────────────────────────
const CHAT_KEY = "relmap_chat_agent_config";
if (sessionStorage.getItem(CHAT_KEY)) chatConfig.value = sessionStorage.getItem(CHAT_KEY);
chatConfig.addEventListener("input", () => sessionStorage.setItem(CHAT_KEY, chatConfig.value));

function parseChatConfig() {
  const raw = chatConfig.value.trim();
  if (!raw) return null;
  const idx = raw.lastIndexOf("|");
  if (idx === -1) return null;
  const url   = raw.slice(0, idx).trim();
  const token = raw.slice(idx + 1).trim();
  return (url && token) ? { url, token } : null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function setStatus(id, text, cls = "") {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = text;
  el.className   = `cell-status ${cls}`;
}

function showCell(id)  { document.getElementById(id)?.classList.remove("hidden"); }
function hideCell(id)  { document.getElementById(id)?.classList.add("hidden"); }

// ── File list ─────────────────────────────────────────────────────────────────
async function refreshFiles() {
  fileList.innerHTML = `<div class="empty-hint">Loading...</div>`;
  try {
    const res  = await fetch("/sql/list");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    renderFileList(data.files || []);
  } catch (err) {
    fileList.innerHTML = `<div class="empty-hint">Error: ${err.message}</div>`;
  }
}

function renderFileList(files) {
  fileList.innerHTML = "";
  if (files.length === 0) {
    fileList.innerHTML = `<div class="empty-hint">No .sql files found.</div>`;
    return;
  }
  files.forEach(name => {
    const row = document.createElement("div");
    row.className = "file-row";
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
  resetNotebook();
  try {
    const res  = await fetch(`/sql/read?filename=${encodeURIComponent(name)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    queryEditor.value = data.content;
  } catch (err) {
    queryEditor.value = `-- Failed to load: ${err.message}`;
  }
}

function resetNotebook() {
  ["cell-analysis","cell-debug","cell-results","cell-interpret",
   "cell-followup-actions","cell-inserts","cell-notes"].forEach(hideCell);
  debugEditor.value = "";
  document.getElementById("analysisOutput").textContent      = "";
  document.getElementById("resultsTable").innerHTML          = "";
  document.getElementById("interpretOutput").textContent     = "";
  document.getElementById("followupCellsContainer").innerHTML = "";  // clear dynamic cells
  document.getElementById("insertsAnalysis").innerHTML       = "";
  document.getElementById("insertsList").innerHTML           = "";
  notesArea.value = "";
  lastDebugResult = null;
  followupResults = [];
  ["status1","status3","status4","status6","status7"]
    .forEach(id => setStatus(id, ""));
}


// ── CELL 1 → 2+3: Analyze ────────────────────────────────────────────────────
async function analyzeQuery() {
  const query = queryEditor.value.trim();
  if (!query) { setStatus("status1", "Paste a query first", "err"); return; }

  const cfg = parseChatConfig();
  if (!cfg) { setStatus("status1", "Paste Chat Agent config first", "err"); return; }

  const btn = document.getElementById("btnAnalyze");
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>Analyzing...';
  setStatus("status1", "Sending to AI... (this may take 10-30 seconds)", "running");

  // Show placeholder cells with loading state
  document.getElementById("analysisOutput").innerHTML =
    '<div class="cell-loading"><span class="spinner"></span>AI is analyzing your query...</div>';
  showCell("cell-analysis");
  hideCell("cell-debug");
  hideCell("cell-results");
  hideCell("cell-interpret");
  hideCell("cell-followup-results");
  hideCell("cell-inserts");

  try {
    const res = await fetch("/debug/suggest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query,
        dialect:        "redshift",
        chat_agent_url: cfg.url,
        token:          cfg.token
      })
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`HTTP ${res.status}: ${t.slice(0, 200)}`);
    }

    const data = await res.json();

    document.getElementById("analysisOutput").textContent =
      data.explanation || "AI analyzed the query — see debug query below.";

    debugEditor.value = data.debug_sql || "";
    showCell("cell-debug");
    showCell("cell-notes");

    setStatus("status1", `✓ Tables detected: ${(data.tables || []).join(", ")}`, "ok");

  } catch (err) {
    document.getElementById("analysisOutput").textContent = `❌ Error: ${err.message}`;
    setStatus("status1", `Failed: ${err.message}`, "err");
  } finally {
    btn.disabled = false;
    btn.textContent = "▶ Analyze with AI";
  }
}

async function runDebugQuery() {
  const sql = debugEditor.value.trim();
  if (!sql) { setStatus("status3", "No query to run", "err"); return; }

  const btn = document.getElementById("btnRunDebug");
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>Running...';
  setStatus("status3", "Executing on Redshift... (this may take 10-60 seconds)", "running");
  hideCell("cell-results");

  try {
    const res = await fetch("/debug/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sql })
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`HTTP ${res.status}: ${t.slice(0, 300)}`);
    }

    const data = await res.json();
    lastDebugResult = data;

    renderResultTable("resultsTable", data.columns, data.rows);
    showCell("cell-results");
    setStatus("status3", `✓ ${data.count} rows returned`, "ok");

  } catch (err) {
    setStatus("status3", `Error: ${err.message}`, "err");
  } finally {
    btn.disabled = false;
    btn.textContent = "▶ Run on Redshift";
  }
}

async function interpretResults() {
  console.log("interpretResults called, lastDebugResult:", lastDebugResult);

  if (!lastDebugResult) {
    setStatus("status4", "Run the debug query first", "err");
    return;
  }

  const cfg = parseChatConfig();
  if (!cfg) { setStatus("status4", "Paste Chat Agent config first", "err"); return; }

  const btn = document.getElementById("btnInterpret");
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>Interpreting...';
  setStatus("status4", "Sending results to AI... (this may take 15-45 seconds)", "running");

  // Show Cell 5 immediately with a loading state
  document.getElementById("interpretOutput").innerHTML =
    '<div class="cell-loading"><span class="spinner"></span>AI is interpreting the results and generating follow-up queries...</div>';
  //document.getElementById("followupList").innerHTML = "";
  document.getElementById("followupCellsContainer").innerHTML = ""; 
  showCell("cell-interpret");

  try {
    const res = await fetch("/debug/interpret", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        original_query: queryEditor.value.trim(),
        debug_sql:      debugEditor.value.trim(),
        columns:        lastDebugResult.columns,
        rows:           lastDebugResult.rows,
        chat_agent_url: cfg.url,
        token:          cfg.token
      })
    });

    const bodyText = await res.text();
    console.log("Interpret raw response:", res.status, bodyText.slice(0, 500));

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${bodyText.slice(0, 300)}`);
    }

    const data = JSON.parse(bodyText);
    console.log("Interpret parsed data:", data);

    document.getElementById("interpretOutput").textContent =
      data.interpretation || "(no interpretation returned)";

    const followups = data.followup_queries || [];
    renderFollowupQueries(followups);

    if (followups.length === 0) {
      setStatus("status4", "⚠ AI didn't return any follow-up queries — see raw response in console", "err");
      console.warn("Raw AI response:", data.raw);
    } else {
      setStatus("status4", `✓ AI interpreted results — ${followups.length} follow-up queries suggested`, "ok");
    }

  } catch (err) {
    console.error("Interpret error:", err);
    document.getElementById("interpretOutput").textContent = `❌ Error: ${err.message}`;
    setStatus("status4", `Error: ${err.message}`, "err");
  } finally {
    btn.disabled = false;
    btn.textContent = "▶ AI Interpret";
  }
}
// ── Build dynamic follow-up cells sequentially ────────────────────────────────
function renderFollowupQueries(queries) {
  const container = document.getElementById("followupCellsContainer");
  container.innerHTML = "";
  followupResults = [];

  // Hide the actions cell + inserts cell until all follow-ups run
  hideCell("cell-followup-actions");
  hideCell("cell-inserts");

  if (queries.length === 0) {
    const hint = document.createElement("div");
    hint.className = "cell";
    hint.innerHTML = `<div class="cell-body"><div class="empty-hint">No follow-up queries suggested.</div></div>`;
    container.appendChild(hint);
    return;
  }

  queries.forEach((q, i) => {
    const cell = buildFollowupCell(i, q, queries.length);
    container.appendChild(cell);
  });

  // Only the first cell's Run button is enabled
  setFollowupCellState(0, "active");
  for (let i = 1; i < queries.length; i++) {
    setFollowupCellState(i, "locked");
  }
}

function buildFollowupCell(index, q, total) {
  const cell = document.createElement("div");
  cell.className = "cell";
  cell.id = `cell-followup-${index}`;

  const header = document.createElement("div");
  header.className = "cell-header";

  const num = document.createElement("span");
  num.className = "cell-number";
  num.textContent = `[5.${index + 1}]`;

  const title = document.createElement("span");
  title.className = "cell-title";
  title.textContent = `${q.label || `Follow-up ${index + 1}`}  (Step ${index + 1} of ${total})`;

  const runBtn = document.createElement("button");
  runBtn.className = "btn btn-run";
  runBtn.id = `btnRunFollowup-${index}`;
  runBtn.textContent = "▶ Run on Redshift";
  runBtn.addEventListener("click", () => runFollowupQuery(index, q.label || `Query ${index + 1}`, total));

  header.appendChild(num);
  header.appendChild(title);
  header.appendChild(runBtn);

  const body = document.createElement("div");
  body.className = "cell-body";

  const textarea = document.createElement("textarea");
  textarea.className = "sql-editor";
  textarea.style.minHeight = "100px";
  textarea.value = q.sql || "";
  textarea.id = `followup-sql-${index}`;

  const resultDiv = document.createElement("div");
  resultDiv.id = `followup-result-${index}`;
  resultDiv.style.marginTop = "12px";

  const status = document.createElement("div");
  status.className = "cell-status";
  status.id = `status-followup-${index}`;

  body.appendChild(textarea);
  body.appendChild(resultDiv);
  body.appendChild(status);

  cell.appendChild(header);
  cell.appendChild(body);
  return cell;
}

function setFollowupCellState(index, state) {
  const btn = document.getElementById(`btnRunFollowup-${index}`);
  const cell = document.getElementById(`cell-followup-${index}`);
  const status = document.getElementById(`status-followup-${index}`);
  if (!btn || !cell) return;

  if (state === "locked") {
    btn.disabled = true;
    cell.style.opacity = "0.5";
    if (status) status.textContent = "🔒 Complete the previous step first";
  } else if (state === "active") {
    btn.disabled = false;
    cell.style.opacity = "1";
    if (status) status.textContent = "";
  } else if (state === "done") {
    btn.disabled = true;
    btn.textContent = "✓ Completed";
    cell.style.opacity = "1";
  }
}

async function runFollowupQuery(index, label, total) {
  const textarea = document.getElementById(`followup-sql-${index}`);
  if (!textarea) return;
  const sql = textarea.value.trim();
  if (!sql) return;

  const btn = document.getElementById(`btnRunFollowup-${index}`);
  const statusEl = document.getElementById(`status-followup-${index}`);
  const resultDiv = document.getElementById(`followup-result-${index}`);

  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>Running...';
  statusEl.className = "cell-status running";
  statusEl.textContent = "Executing on Redshift...";
  resultDiv.innerHTML = "";

  try {
    const res = await fetch("/debug/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sql })
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`HTTP ${res.status}: ${t.slice(0, 300)}`);
    }

    const data = await res.json();
    const tableMatch = sql.match(/FROM\s+([\w.]+)/i);
    const table = tableMatch ? tableMatch[1] : `followup_${index}`;
    followupResults[index] = { table, columns: data.columns, rows: data.rows };

    // Render result INSIDE this cell
    renderResultTable(null, data.columns, data.rows, resultDiv);

    setFollowupCellState(index, "done");
    statusEl.className = "cell-status ok";
    statusEl.textContent = `✓ ${data.count} rows returned`;

    // Unlock the next cell
    if (index + 1 < total) {
      setFollowupCellState(index + 1, "active");
    } else {
      // All done — show cell 6 with action buttons
      showCell("cell-followup-actions");
      setStatus("status6", "✓ All follow-ups complete — ready to save or generate INSERTs", "ok");
    }
  } catch (err) {
    btn.disabled = false;
    btn.textContent = "▶ Run on Redshift";
    statusEl.className = "cell-status err";
    statusEl.textContent = `Error: ${err.message}`;
  }
}
// ── CELL 6: Save all samples ──────────────────────────────────────────────────
async function saveAllSamples() {
  const toSave = followupResults.filter(Boolean);

  if (lastDebugResult && lastDebugResult.rows.length > 0) {
    const tableMatch = debugEditor.value.match(/FROM\s+([\w.]+)/i);
    const table = tableMatch ? tableMatch[1] : "debug_result";
    toSave.unshift({ table, columns: lastDebugResult.columns, rows: lastDebugResult.rows });
  }

  if (toSave.length === 0) {
    setStatus("status6", "No results to save", "err");
    return;
  }

  setStatus("status6", "Saving to local Postgres...", "running");

  try {
    const res = await fetch("/debug/save-samples", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tables: toSave })
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`HTTP ${res.status}: ${t.slice(0, 300)}`);
    }

    const data = await res.json();
    const summary = (data.results || [])
      .map(r => `${r.table}: ${r.status === "ok" ? `${r.inserted} inserted` : r.reason}`)
      .join(" | ");
    setStatus("status6", `✓ ${summary}`, "ok");

  } catch (err) {
    setStatus("status6", `Error: ${err.message}`, "err");
  }
}

// ── CELL 7: Save notes ────────────────────────────────────────────────────────
async function saveNotes() {
  const notes = notesArea.value.trim();
  if (!notes || !currentFile) return;

  setStatus("status7", "Saving...", "running");
  try {
    await fetch("/sql/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filename: `notes_${currentFile.replace(".sql", "")}.md`,
        content:  `# Notes: ${currentFile}\n\n${notes}\n`
      })
    });
    setStatus("status7", "✓ Notes saved", "ok");
  } catch (err) {
    setStatus("status7", `Error: ${err.message}`, "err");
  }
}

// ── Render result table ───────────────────────────────────────────────────────
function renderResultTable(containerId, columns, rows, directEl) {
  const wrap = directEl || document.getElementById(containerId);
  wrap.innerHTML = "";

  if (!columns || columns.length === 0) {
    wrap.innerHTML = `<div class="empty-hint">No results</div>`;
    return;
  }

  const table = document.createElement("table");
  table.className = "result-table";

  const thead = document.createElement("thead");
  const headerRow = document.createElement("tr");
  columns.forEach(col => {
    const th = document.createElement("th");
    th.textContent = col;
    headerRow.appendChild(th);
  });
  thead.appendChild(headerRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  rows.forEach(row => {
    const tr = document.createElement("tr");
    row.forEach(val => {
      const td = document.createElement("td");
      td.textContent = val === null ? "NULL" : String(val);
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  wrap.appendChild(table);

  if (!directEl) {
    const count = document.createElement("div");
    count.className = "result-count";
    count.textContent = `${rows.length} rows`;
    wrap.appendChild(count);
  }
}



// ── Generate + run INSERT statements ─────────────────────────────────────────
// async function generateInserts() {
//   const cfg = parseChatConfig();
//   if (!cfg) { setStatus("status6", "Paste Chat Agent config first", "err"); return; }

//   const toSend = followupResults.filter(Boolean);
//   if (toSend.length === 0) {
//     setStatus("status6", "Run follow-up queries first", "err");
//     return;
//   }

//   setStatus("status6", "Asking AI to generate joinable INSERT statements...", "running");

//   try {
//     const res = await fetch("/debug/generate-inserts", {
//       method: "POST",
//       headers: { "Content-Type": "application/json" },
//       body: JSON.stringify({
//         original_query:   queryEditor.value.trim(),
//         followup_results: toSend,
//         chat_agent_url:   cfg.url,
//         token:            cfg.token
//       })
//     });
//     if (!res.ok) {
//       const t = await res.text();
//       throw new Error(`HTTP ${res.status}: ${t.slice(0, 300)}`);
//     }

//     const data = await res.json();

//     document.getElementById("insertsAnalysis").textContent = data.analysis || "";

//     // Render each INSERT block as editable
//     const insertsList = document.getElementById("insertsList");
//     insertsList.innerHTML = "";
//     (data.inserts || []).forEach((item, i) => {
//       const wrap = document.createElement("div");
//       wrap.className = "followup-item";
//       wrap.style.marginTop = "10px";

//       const label = document.createElement("div");
//       label.className = "followup-label";
//       label.textContent = `INSERT — ${item.table}`;

//       const textarea = document.createElement("textarea");
//       textarea.className = "followup-sql";
//       textarea.value = item.sql;
//       textarea.id = `insert-sql-${i}`;
//       textarea.style.minHeight = "120px";

//       wrap.appendChild(label);
//       wrap.appendChild(textarea);
//       insertsList.appendChild(wrap);
//     });

//     showCell("cell-inserts");
//     setStatus("status6", "✓ INSERT statements ready — review and execute", "ok");

//   } catch (err) {
//     setStatus("status6", `Error: ${err.message}`, "err");
//   }
// }
async function generateInserts() {
  const cfg = parseChatConfig();
  if (!cfg) { setStatus("status6", "Paste Chat Agent config first", "err"); return; }

  const toSend = followupResults.filter(Boolean);
  if (toSend.length === 0) {
    setStatus("status6", "Run follow-up queries first", "err");
    return;
  }

  const btn = document.getElementById("btnGenerateInserts");
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>Generating...';
  setStatus("status6", "Asking AI to generate joinable INSERT statements... (may take 30-60 seconds)", "running");

  // Show cell with loading
  document.getElementById("insertsAnalysis").innerHTML =
    '<div class="cell-loading"><span class="spinner"></span>AI is generating joinable INSERT statements...</div>';
  document.getElementById("insertsList").innerHTML = "";
  showCell("cell-inserts");

  try {
    const res = await fetch("/debug/generate-inserts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        original_query:   queryEditor.value.trim(),
        followup_results: toSend,
        chat_agent_url:   cfg.url,
        token:            cfg.token
      })
    });

    if (!res.ok) {
      const t = await res.text();
      throw new Error(`HTTP ${res.status}: ${t.slice(0, 300)}`);
    }

    const data = await res.json();

    document.getElementById("insertsAnalysis").textContent = data.analysis || "";

    // Render each INSERT block as editable
    const insertsList = document.getElementById("insertsList");
    insertsList.innerHTML = "";
    (data.inserts || []).forEach((item, i) => {
      const wrap = document.createElement("div");
      wrap.className = "followup-item";
      wrap.style.marginTop = "10px";

      const label = document.createElement("div");
      label.className = "followup-label";
      label.textContent = `INSERT — ${item.table}`;

      const textarea = document.createElement("textarea");
      textarea.className = "followup-sql";
      textarea.value = item.sql;
      textarea.id = `insert-sql-${i}`;
      textarea.style.minHeight = "120px";

      wrap.appendChild(label);
      wrap.appendChild(textarea);
      insertsList.appendChild(wrap);
    });

    setStatus("status6", `✓ ${(data.inserts || []).length} INSERT statements ready — review and execute`, "ok");

  } catch (err) {
    document.getElementById("insertsAnalysis").textContent = `❌ Error: ${err.message}`;
    setStatus("status6", `Error: ${err.message}`, "err");
  } finally {
    btn.disabled = false;
    btn.textContent = "🤖 Generate Joinable INSERTs";
  }
}
        
// async function runInserts() {
//   const textareas = document.querySelectorAll("[id^='insert-sql-']");
//   if (textareas.length === 0) {
//     setStatus("status6b", "No INSERT statements to run", "err");
//     return;
//   }

//   setStatus("status6b", "Executing INSERTs on local Postgres...", "running");

//   let succeeded = 0, failed = 0;
//   for (const ta of textareas) {
//     const sql = ta.value.trim();
//     if (!sql) continue;
//     try {
//       const res = await fetch("/debug/run-local", {
//         method: "POST",
//         headers: { "Content-Type": "application/json" },
//         body: JSON.stringify({ sql })
//       });
//       if (!res.ok) {
//         failed++;
//       } else {
//         succeeded++;
//         ta.style.borderColor = "#2f6b45";
//       }
//     } catch (e) {
//       failed++;
//       ta.style.borderColor = "#7c3a3a";
//     }
//   }
//   setStatus("status6b",
//     `✓ ${succeeded} succeeded, ${failed} failed`, succeeded > 0 ? "ok" : "err"
//   );
// }


async function runInserts() {
  const textareas = document.querySelectorAll("[id^='insert-sql-']");
  if (textareas.length === 0) {
    setStatus("status6b", "No INSERT statements to run", "err");
    return;
  }

  const btn = document.getElementById("btnRunInserts");
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>Executing...';
  setStatus("status6b", "Executing INSERTs on local Postgres...", "running");

  let succeeded = 0, failed = 0;
  for (const ta of textareas) {
    const sql = ta.value.trim();
    if (!sql) continue;
    try {
      const res = await fetch("/debug/run-local", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sql })
      });
      if (!res.ok) {
        failed++;
        ta.style.borderColor = "#7c3a3a";
      } else {
        succeeded++;
        ta.style.borderColor = "#2f6b45";
      }
    } catch (e) {
      failed++;
      ta.style.borderColor = "#7c3a3a";
    }
  }

  btn.disabled = false;
  btn.textContent = "▶ Execute on Local Postgres";
  setStatus("status6b",
    `✓ ${succeeded} succeeded, ${failed} failed`,
    succeeded > 0 && failed === 0 ? "ok" : (failed > 0 ? "err" : "ok")
  );
}


// ── Wire up all buttons after DOM loads ───────────────────────────────────────
// Wire up buttons directly — DOMContentLoaded already fired by the time
// a bottom-of-body script runs, so attach listeners immediately
document.getElementById("btnRefresh")   ?.addEventListener("click", refreshFiles);
document.getElementById("btnAnalyze")   ?.addEventListener("click", analyzeQuery);
document.getElementById("btnRunDebug")  ?.addEventListener("click", runDebugQuery);
document.getElementById("btnInterpret") ?.addEventListener("click", interpretResults);
document.getElementById("btnSave")      ?.addEventListener("click", saveAllSamples);
document.getElementById("btnSaveNotes") ?.addEventListener("click", saveNotes);
document.getElementById("btnGenerateInserts")?.addEventListener("click", generateInserts);
document.getElementById("btnRunInserts")?.addEventListener("click", runInserts);