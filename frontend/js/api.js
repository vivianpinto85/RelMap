// js/api.js — all fetch() calls to the backend

export async function fetchFileList() {
  const res = await fetch("/sql/list");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function fetchFileContent(name) {
  const res = await fetch(`/sql/read?filename=${encodeURIComponent(name)}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function postAnalyze({ query, url, token }) {
  const res = await fetch("/debug/suggest", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, dialect: "redshift", chat_agent_url: url, token })
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`HTTP ${res.status}: ${t.slice(0, 200)}`);
  }
  return res.json();
}

export async function postRunQuery(sql) {
  const res = await fetch("/debug/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sql })
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`HTTP ${res.status}: ${t.slice(0, 300)}`);
  }
  return res.json();
}

export async function postInterpret({ original_query, debug_sql, columns, rows, url, token }) {
  const res = await fetch("/debug/interpret", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ original_query, debug_sql, columns, rows, chat_agent_url: url, token })
  });
  const bodyText = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${bodyText.slice(0, 300)}`);
  return JSON.parse(bodyText);
}

export async function postSaveSamples(tables) {
  const res = await fetch("/debug/save-samples", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tables })
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`HTTP ${res.status}: ${t.slice(0, 300)}`);
  }
  return res.json();
}

export async function postGenerateInserts({ original_query, followup_results, url, token }) {
  const res = await fetch("/debug/generate-inserts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ original_query, followup_results, chat_agent_url: url, token })
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`HTTP ${res.status}: ${t.slice(0, 300)}`);
  }
  return res.json();
}

export async function postRunLocal(sql) {
  const res = await fetch("/debug/run-local", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sql })
  });
  return res.ok;
}

export async function postSaveNotes({ filename, content }) {
  await fetch("/sql/save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename, content })
  });
}