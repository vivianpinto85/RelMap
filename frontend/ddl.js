async function fetchDDLs() {
  const tables = document.getElementById("tableList").value
    .split("\n")
    .map(t => t.trim())
    .filter(t => t.length > 0);

  if (tables.length === 0) {
    alert("Please enter at least one table name.");
    return;
  }

  const res = await fetch("/schema/fetch-ddl", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tables })
  });

  const data = await res.json();
  document.getElementById("result").innerText = JSON.stringify(data, null, 2);
}
