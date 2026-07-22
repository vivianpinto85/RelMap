// js/notebook.js — all cell logic (analyzeQuery, runDebugQuery, etc.)

import { parseChatConfig, setCurrentFile, setLastDebugResult,
         setFollowupResult, resetFollowupResults,
         lastDebugResult, followupResults, currentFile } from './state.js';
import { fetchFileList, fetchFileContent, postAnalyze, postRunQuery,
         postInterpret, postSaveSamples, postGenerateInserts,
         postRunLocal, postSaveNotes } from './api.js';
import { setStatus, showCell, hideCell, renderResultTable,
         buildFollowupCell, setFollowupCellState } from './ui.js';

// ── File list ─────────────────────────────────────────────────────────────────
export async function refreshFiles() {
  const fileList = document.getElementById("file-list");
  fileList.innerHTML = `<div class="empty-hint">Loading...</div>`;
  try {
    const data = await fetchFileList();
    renderFileList(data.files || []);
  } catch (err) {
    fileList.innerHTML = `<div class="empty-hint">Error: ${err.message}</div>`;
  }
}

function renderFileList(files) {
  const fileList = document.getElementById("file-list");
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
  setCurrentFile(name);
  resetNotebook();
  try {
    const data = await fetchFileContent(name);
    document.getElementById("queryEditor").value = data.content;
  } catch (err) {
    document.getElementById("queryEditor").value = `-- Failed to load: ${err.message}`;
  }
}

function resetNotebook() {
  ["cell-analysis","cell-debug","cell-results","cell-interpret",
   "cell-followup-actions","cell-inserts","cell-notes"].forEach(hideCell);
  document.getElementById("debugEditor").value = "";
  document.getElementById("analysisOutput").textContent      = "";
  document.getElementById("resultsTable").innerHTML          = "";
  document.getElementById("interpretOutput").textContent     = "";
  document.getElementById("followupCellsContainer").innerHTML = "";
  document.getElementById("insertsAnalysis").innerHTML       = "";
  document.getElementById("insertsList").innerHTML           = "";
  document.getElementById("notesArea").value = "";
  setLastDebugResult(null);
  resetFollowupResults();
  ["status1","status3","status4","status6","status7"].forEach(id => setStatus(id, ""));
}

// ── Cell 1: Analyze ───────────────────────────────────────────────────────────
export async function analyzeQuery() {
  const query = document.getElementById("queryEditor").value.trim();
  if (!query) { setStatus("status1", "Paste a query first", "err"); return; }

  const cfg = parseChatConfig();
  if (!cfg) { setStatus("status1", "Paste Chat Agent config first", "err"); return; }

  const btn = document.getElementById("btnAnalyze");
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>Analyzing...';
  setStatus("status1", "Sending to AI... (this may take 10-30 seconds)", "running");

  document.getElementById("analysisOutput").innerHTML =
    '<div class="cell-loading"><span class="spinner"></span>AI is analyzing your query...</div>';
  showCell("cell-analysis");
  hideCell("cell-debug");
  hideCell("cell-results");
  hideCell("cell-interpret");
  hideCell("cell-inserts");

  try {
    const data = await postAnalyze({ query, url: cfg.url, token: cfg.token });
    document.getElementById("analysisOutput").textContent =
      data.explanation || "AI analyzed the query — see debug query below.";
    document.getElementById("debugEditor").value = data.debug_sql || "";
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

// ── Cell 3: Run debug query ───────────────────────────────────────────────────
export async function runDebugQuery() {
  const sql = document.getElementById("debugEditor").value.trim();
  if (!sql) { setStatus("status3", "No query to run", "err"); return; }

  const btn = document.getElementById("btnRunDebug");
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>Running...';
  setStatus("status3", "Executing on Redshift... (this may take 10-60 seconds)", "running");
  hideCell("cell-results");

  try {
    const data = await postRunQuery(sql);
    setLastDebugResult(data);
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

// ── Cell 4: Interpret results ─────────────────────────────────────────────────
export async function interpretResults() {
  if (!lastDebugResult) { setStatus("status4", "Run the debug query first", "err"); return; }

  const cfg = parseChatConfig();
  if (!cfg) { setStatus("status4", "Paste Chat Agent config first", "err"); return; }

  const btn = document.getElementById("btnInterpret");
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>Interpreting...';
  setStatus("status4", "Sending results to AI... (this may take 15-45 seconds)", "running");

  document.getElementById("interpretOutput").innerHTML =
    '<div class="cell-loading"><span class="spinner"></span>AI is interpreting the results and generating follow-up queries...</div>';
  document.getElementById("followupCellsContainer").innerHTML = "";
  showCell("cell-interpret");

  try {
    const data = await postInterpret({
      original_query: document.getElementById("queryEditor").value.trim(),
      debug_sql:      document.getElementById("debugEditor").value.trim(),
      columns:        lastDebugResult.columns,
      rows:           lastDebugResult.rows,
      url:            cfg.url,
      token:          cfg.token
    });

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

// ── Cell 5.x: Follow-up cells ─────────────────────────────────────────────────
function renderFollowupQueries(queries) {
  const container = document.getElementById("followupCellsContainer");
  container.innerHTML = "";
  resetFollowupResults();
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
    const cell = buildFollowupCell(i, q, queries.length, runFollowupQuery);
    container.appendChild(cell);
  });

  setFollowupCellState(0, "active");
  for (let i = 1; i < queries.length; i++) setFollowupCellState(i, "locked");
}

async function runFollowupQuery(index, label, total) {
  const textarea  = document.getElementById(`followup-sql-${index}`);
  if (!textarea) return;
  const sql = textarea.value.trim();
  if (!sql) return;

  const btn      = document.getElementById(`btnRunFollowup-${index}`);
  const statusEl = document.getElementById(`status-followup-${index}`);
  const resultDiv = document.getElementById(`followup-result-${index}`);

  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>Running...';
  statusEl.className = "cell-status running";
  statusEl.textContent = "Executing on Redshift...";
  resultDiv.innerHTML = "";

  try {
    const data = await postRunQuery(sql);
    const tableMatch = sql.match(/FROM\s+([\w.]+)/i);
    const table = tableMatch ? tableMatch[1] : `followup_${index}`;
    setFollowupResult(index, { table, columns: data.columns, rows: data.rows });

    renderResultTable(null, data.columns, data.rows, resultDiv);
    setFollowupCellState(index, "done");
    statusEl.className = "cell-status ok";
    statusEl.textContent = `✓ ${data.count} rows returned`;

    if (index + 1 < total) {
      setFollowupCellState(index + 1, "active");
    } else {
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

// ── Cell 6: Save samples ──────────────────────────────────────────────────────
export async function saveAllSamples() {
  const toSave = followupResults.filter(Boolean);

  if (lastDebugResult && lastDebugResult.rows.length > 0) {
    const tableMatch = document.getElementById("debugEditor").value.match(/FROM\s+([\w.]+)/i);
    const table = tableMatch ? tableMatch[1] : "debug_result";
    toSave.unshift({ table, columns: lastDebugResult.columns, rows: lastDebugResult.rows });
  }

  if (toSave.length === 0) { setStatus("status6", "No results to save", "err"); return; }

  setStatus("status6", "Saving to local Postgres...", "running");
  try {
    const data = await postSaveSamples(toSave);
    const summary = (data.results || [])
      .map(r => `${r.table}: ${r.status === "ok" ? `${r.inserted} inserted` : r.reason}`)
      .join(" | ");
    setStatus("status6", `✓ ${summary}`, "ok");
  } catch (err) {
    setStatus("status6", `Error: ${err.message}`, "err");
  }
}

// ── Cell 6b: Generate + run INSERTs ──────────────────────────────────────────
export async function generateInserts() {
  const cfg = parseChatConfig();
  if (!cfg) { setStatus("status6", "Paste Chat Agent config first", "err"); return; }

  const toSend = followupResults.filter(Boolean);
  if (toSend.length === 0) { setStatus("status6", "Run follow-up queries first", "err"); return; }

  const btn = document.getElementById("btnGenerateInserts");
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>Generating...';
  setStatus("status6", "Asking AI to generate joinable INSERT statements... (may take 30-60 seconds)", "running");

  document.getElementById("insertsAnalysis").innerHTML =
    '<div class="cell-loading"><span class="spinner"></span>AI is generating joinable INSERT statements...</div>';
  document.getElementById("insertsList").innerHTML = "";
  showCell("cell-inserts");

  try {
    const data = await postGenerateInserts({
      original_query:   document.getElementById("queryEditor").value.trim(),
      followup_results: toSend,
      url:              cfg.url,
      token:            cfg.token
    });

    document.getElementById("insertsAnalysis").textContent = data.analysis || "";

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

export async function runInserts() {
  const textareas = document.querySelectorAll("[id^='insert-sql-']");
  if (textareas.length === 0) { setStatus("status6b", "No INSERT statements to run", "err"); return; }

  const btn = document.getElementById("btnRunInserts");
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>Executing...';
  setStatus("status6b", "Executing INSERTs on local Postgres...", "running");

  let succeeded = 0, failed = 0;
  for (const ta of textareas) {
    const sql = ta.value.trim();
    if (!sql) continue;
    const ok = await postRunLocal(sql);
    if (ok) { succeeded++; ta.style.borderColor = "#2f6b45"; }
    else    { failed++;    ta.style.borderColor = "#7c3a3a"; }
  }

  btn.disabled = false;
  btn.textContent = "▶ Execute on Local Postgres";
  setStatus("status6b",
    `✓ ${succeeded} succeeded, ${failed} failed`,
    succeeded > 0 && failed === 0 ? "ok" : (failed > 0 ? "err" : "ok")
  );
}

// ── Cell 7: Save notes ────────────────────────────────────────────────────────
export async function saveNotes() {
  const notes = document.getElementById("notesArea").value.trim();
  if (!notes || !currentFile) return;

  setStatus("status7", "Saving...", "running");
  try {
    await postSaveNotes({
      filename: `notes_${currentFile.replace(".sql", "")}.md`,
      content:  `# Notes: ${currentFile}\n\n${notes}\n`
    });
    setStatus("status7", "✓ Notes saved", "ok");
  } catch (err) {
    setStatus("status7", `Error: ${err.message}`, "err");
  }
}