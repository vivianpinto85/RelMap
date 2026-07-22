// js/ui.js — DOM helpers: show/hide cells, status, result table, file list

export function setStatus(id, text, cls = "") {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = text;
  el.className   = `cell-status ${cls}`;
}

export function showCell(id) { document.getElementById(id)?.classList.remove("hidden"); }
export function hideCell(id) { document.getElementById(id)?.classList.add("hidden"); }

export function renderResultTable(containerId, columns, rows, directEl) {
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

export function setFollowupCellState(index, state) {
  const btn    = document.getElementById(`btnRunFollowup-${index}`);
  const cell   = document.getElementById(`cell-followup-${index}`);
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

export function buildFollowupCell(index, q, total, onRun) {
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
  runBtn.addEventListener("click", () => onRun(index, q.label || `Query ${index + 1}`, total));

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