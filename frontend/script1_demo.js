// Initialize Cytoscape graph
let cy = cytoscape({
  container: document.getElementById('cy'),
  style: [
    { selector: 'node', style: { 'label': 'data(label)', 'background-color': '#3498db', 'color': '#fff' } },
    { selector: 'edge', style: { 'label': 'data(label)', 'line-color': '#2ecc71', 'width': 2 } }
  ],
  layout: { name: 'grid' }
});

// Load schema from backend
async function loadSchema() {
  const res = await fetch('/schema/scan');
  const data = await res.json();

  // Example: add nodes for tables
  cy.add([
    { data: { id: 'users', label: 'users' } },
    { data: { id: 'orders', label: 'orders' } },
    { data: { id: 'payments', label: 'payments' } },
    { data: { id: 'users-orders', source: 'users', target: 'orders', label: 'user_id' } },
    { data: { id: 'orders-payments', source: 'orders', target: 'payments', label: 'order_id' } }
  ]);

  cy.layout({ name: 'circle' }).run();
}

// Validate relation (placeholder)
async function validateRelation() {
  const res = await fetch('/validate/check', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ table: 'users', column: 'user_id', value: '12345' })
  });
  const data = await res.json();
  alert("Validation result: " + JSON.stringify(data));
}
