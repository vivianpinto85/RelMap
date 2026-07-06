// import.js — schema/table treeview + sync to local Postgres

const selected = new Set(); // holds "schema.table" strings

const treeContainer = document.getElementById("tree-container");
const selectionBar = document.getElementById("selection-bar");
const logPanel = document.getElementById("log-panel");
const syncBtn = document.getElementById("syncBtn");
const refreshBtn = document.getElementById("refreshBtn");

function log(message, cls = "log-info") {
  const line = document.createElement("div");
  line.className = "log-line " + cls;
  line.textContent = message;
  logPanel.appendChild(line);
  logPanel.scrollTop = logPanel.scrollHeight;
}

function updateSelectionBar() {
  selectionBar.textContent = `${selected.size} table${selected.size === 1 ? "" : "s"} selected`;
  syncBtn.disabled = selected.size === 0;
}

async function refreshTree() {
  refreshBtn.disabled = true;
  refreshBtn.textContent = "Loading...";
  treeContainer.innerHTML = `<div class="empty-hint">Loading schemas from Redshift...</div>`;
  selected.clear();
  updateSelectionBar();

  try {
    const res = await fetch("/redshift/tables");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    renderTree(data.schemas || {});
    log(`Loaded ${Object.keys(data.schemas || {}).length} schema(s).`, "log-ok");
  } catch (err) {
    treeContainer.innerHTML = `<div class="empty-hint">Failed to load schema tree.</div>`;
    log(`Refresh failed: ${err.message}`, "log-err");
  } finally {
    refreshBtn.disabled = false;
    refreshBtn.textContent = "Refresh";
  }
}

function renderTree(schemas) {
  treeContainer.innerHTML = "";
  const schemaNames = Object.keys(schemas).sort();

  if (schemaNames.length === 0) {
    treeContainer.innerHTML = `<div class="empty-hint">No tables found.</div>`;
    return;
  }

  for (const schema of schemaNames) {
    const tables = schemas[schema];

    const group = document.createElement("div");
    group.className = "schema-group collapsed";

    const header = document.createElement("div");
    header.className = "schema-header";
    header.innerHTML = `
      <span class="caret">▾</span>
      <span class="schema-name">${schema}</span>
      <span class="schema-count">${tables.length}</span>
      <span class="schema-select-all" data-schema="${schema}">select all</span>
    `;
    header.addEventListener("click", (e) => {
      if (e.target.classList.contains("schema-select-all")) return;
      group.classList.toggle("collapsed");
    });

    header.querySelector(".schema-select-all").addEventListener("click", (e) => {
      e.stopPropagation();
      const rows = group.querySelectorAll(".table-row input[type=checkbox]");
      const allChecked = [...rows].every(r => r.checked);
      rows.forEach(r => {
        r.checked = !allChecked;
        r.dispatchEvent(new Event("change"));
      });
    });

    const list = document.createElement("div");
    list.className = "table-list";

    for (const table of tables) {
      const fullName = `${schema}.${table}`;

      const row = document.createElement("label");
      row.className = "table-row";

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) {
          selected.add(fullName);
          row.classList.add("checked");
        } else {
          selected.delete(fullName);
          row.classList.remove("checked");
        }
        updateSelectionBar();
      });

      const nameSpan = document.createElement("span");
      nameSpan.className = "table-name";
      nameSpan.textContent = table;

      row.appendChild(checkbox);
      row.appendChild(nameSpan);
      list.appendChild(row);
    }

    group.appendChild(header);
    group.appendChild(list);
    treeContainer.appendChild(group);
  }
}

async function syncSelected() {
  if (selected.size === 0) return;

  const tables = [...selected];
  syncBtn.disabled = true;
  syncBtn.textContent = "Syncing...";
  log(`Starting sync for ${tables.length} table(s)...`, "log-info");

  try {
    const res = await fetch("/fetch-ddl", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tables }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    for (const [table, ddl] of Object.entries(data.ddls || {})) {
      if (typeof ddl === "string" && ddl.startsWith("-- Table") && ddl.includes("already exists")) {
        log(`${table}: skipped (already exists)`, "log-skip");
      } else if (typeof ddl === "string" && ddl.startsWith("-- No columns")) {
        log(`${table}: no columns found in Redshift`, "log-err");
      } else {
        log(`${table}: created`, "log-ok");
      }
    }
    log("Sync complete.", "log-info");
  } catch (err) {
    log(`Sync failed: ${err.message}`, "log-err");
  } finally {
    syncBtn.disabled = selected.size === 0;
    syncBtn.textContent = "Sync";
  }
}