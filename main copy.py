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
    // Read the SQL content already loaded in the UI
    const query = originalSqlEl.textContent;

    // Call the Jupyter agent directly from the browser
    // Browser already has JupyterHub session cookie — no auth issues
    const res = await fetch(`${config.url}/analyze?query=${encodeURIComponent(query)}&dialect=redshift`, {
      method: "GET",
      credentials: "include",  // sends JupyterHub session cookie automatically
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`HTTP ${res.status}: ${errText.slice(0, 200)}`);
    }

    const data = await res.json();
    suggestedSqlEl.textContent = data.fixed_query;
    setStatus("AI analysis complete", "ok");

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

  } catch (err) {
    suggestedSqlEl.textContent = `Failed: ${err.message}`;
    setStatus("Ask AI failed — see message above", "err");
  } finally {
    askBtn.disabled = false;
    askBtn.textContent = "Ask AI";
  }
}