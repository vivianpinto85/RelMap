// ── Register plugins if available ───────────────────────────────────────────
if (typeof cytoscapeNodeHtmlLabel !== 'undefined') cytoscape.use(cytoscapeNodeHtmlLabel);

// ── Constants ────────────────────────────────────────────────────────────────
const NODE_W = 220;
const ROW_H  = 26;
const HEAD_H = 38;

function nodeHeight(columns) {
  return HEAD_H + Math.max(1, columns.length) * ROW_H;
}

// ── Cytoscape init ───────────────────────────────────────────────────────────
let cy = cytoscape({
  container: document.getElementById('cy'),
  style: [
    {
      selector: 'node[?isTable]',
      style: {
        'shape': 'rectangle',
        'background-opacity': 0,
        'border-opacity': 0,
        'width':  NODE_W,
        'height': 'data(nodeHeight)',
        'text-opacity': 0,
        'padding': 0,
      }
    },
    { selector: 'node:selected', style: { 'background-opacity': 0, 'border-opacity': 0 } },
    {
      selector: 'edge',
      style: {
        'opacity': 0,        // hidden — drawn manually on edgeCanvas
        'width': 8,          // keep hit area for right-click
        'curve-style': 'straight',
      }
    }
  ],
  layout: { name: 'grid' }
});

// ── HTML card overlay ─────────────────────────────────────────────────────────
const cyContainer = document.getElementById('cy');
cyContainer.style.position = 'relative';

const cardLayer = document.createElement('div');
cardLayer.id = 'card-layer';
cardLayer.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;overflow:hidden;';
cyContainer.appendChild(cardLayer);

function modelToScreen(x, y) {
  const pan  = cy.pan();
  const zoom = cy.zoom();
  return { x: x * zoom + pan.x, y: y * zoom + pan.y };
}

function renderCards() {
  cardLayer.innerHTML = '';
  cy.nodes().forEach(node => {
    const data   = node.data();
    const pos    = node.position();
    const cols   = data.columns || [];
    const H      = nodeHeight(cols);
    const screen = modelToScreen(pos.x - NODE_W / 2, pos.y - H / 2);
    const zoom   = cy.zoom();

    const card = document.createElement('div');
    card.className  = 'table-card';
    card.dataset.id = data.id;
    card.style.cssText = `
      position:absolute;
      left:${screen.x}px; top:${screen.y}px;
      width:${NODE_W * zoom}px; height:${H * zoom}px;
      pointer-events:auto;
      border:2px solid #3b5bdb; border-radius:6px;
      overflow:hidden; background:#1a2740;
      box-shadow:0 4px 16px rgba(0,0,0,0.5);
      font-family:'Segoe UI',system-ui,sans-serif;
      cursor:grab; user-select:none;
    `;

    // Header
    const header = document.createElement('div');
    header.style.cssText = `
      background:#2c4a7c;
      padding:0 ${zoom*10}px;
      display:flex; align-items:center; gap:${zoom*6}px;
      border-bottom:1px solid #3b5bdb;
      height:${HEAD_H*zoom}px; box-sizing:border-box;
      flex-shrink:0;
    `;
    header.innerHTML = `
      <span style="color:#74c0fc;font-size:${zoom*13}px">⊞</span>
      <span style="font-weight:700;color:#e9ecef;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:${zoom*12}px">${data.table}</span>
      <span style="font-size:${zoom*10}px;color:#74c0fc;background:#1a3259;padding:1px ${zoom*5}px;border-radius:3px;flex-shrink:0">${data.schema}</span>
    `;
    card.appendChild(header);

    // Column rows — each gets data-col attribute for drag targeting
    if (cols.length === 0) {
      const empty = document.createElement('div');
      empty.style.cssText = `padding:${zoom*6}px ${zoom*10}px;font-size:${zoom*11}px;color:#5c7a9e;font-style:italic`;
      empty.textContent = 'no columns';
      card.appendChild(empty);
    } else {
      cols.forEach((c, i) => {
        const row = document.createElement('div');
        row.className       = 'col-row-el';
        row.dataset.col     = c.name;
        row.dataset.tableId = data.id;
        row.style.cssText = `
          display:flex; align-items:center; gap:${zoom*6}px;
          padding:0 ${zoom*10}px; height:${ROW_H*zoom}px;
          font-size:${zoom*11}px;
          border-bottom:1px solid rgba(255,255,255,0.04);
          background:${i%2===0?'#1a2740':'#1e2e4a'};
          box-sizing:border-box; cursor:crosshair;
          transition:background 0.1s;
        `;
        row.innerHTML = `
          <span style="color:#868e96;font-size:${zoom*9}px">▸</span>
          <span style="color:#ced4da;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${c.name}</span>
          <span style="color:#5c7a9e;font-size:${zoom*10}px;font-style:italic">${c.type}</span>
        `;
        card.appendChild(row);
      });
    }

    cardLayer.appendChild(card);
  });
}

cy.on('pan zoom position', renderCards);

// ── Edge canvas — draws relation lines accurately from column rows ────────────
const edgeCanvas = document.createElement('canvas');
edgeCanvas.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;z-index:5;';
cyContainer.appendChild(edgeCanvas);

function resizeEdgeCanvas() {
  edgeCanvas.width  = cyContainer.offsetWidth;
  edgeCanvas.height = cyContainer.offsetHeight;
}
resizeEdgeCanvas();
window.addEventListener('resize', () => { resizeEdgeCanvas(); drawEdges(); });

const ectx = edgeCanvas.getContext('2d');

function getColumnRowScreenRect(nodeId, colName) {
  const card = cardLayer.querySelector(`.table-card[data-id="${CSS.escape(nodeId)}"]`);
  if (!card) return null;
  const rows = card.querySelectorAll('.col-row-el');
  for (const row of rows) {
    if (row.dataset.col === colName) {
      const cardRect = cyContainer.getBoundingClientRect();
      const rowRect  = row.getBoundingClientRect();
      return {
        left:   rowRect.left   - cardRect.left,
        right:  rowRect.right  - cardRect.left,
        top:    rowRect.top    - cardRect.top,
        bottom: rowRect.bottom - cardRect.top,
        midY:   rowRect.top    - cardRect.top + rowRect.height / 2
      };
    }
  }
  return null;
}

function drawEdges() {
  ectx.clearRect(0, 0, edgeCanvas.width, edgeCanvas.height);
  cy.edges().forEach(edge => {
    const d       = edge.data();
    const srcRect = getColumnRowScreenRect(d.source, d.source_column);
    const tgtRect = getColumnRowScreenRect(d.target, d.target_column);
    if (!srcRect || !tgtRect) return;

    // Decide which side to exit/enter based on card positions
    const srcIsLeft = srcRect.right < tgtRect.left;
    const x1 = srcIsLeft ? srcRect.right  : srcRect.left;
    const y1 = srcRect.midY;
    const x2 = srcIsLeft ? tgtRect.left   : tgtRect.right;
    const y2 = tgtRect.midY;

    // Find midX that avoids other cards lying between source and target
    let midX = (x1 + x2) / 2;
    const xMin = Math.min(x1, x2);
    const xMax = Math.max(x1, x2);
    const yMin = Math.min(y1, y2);
    const yMax = Math.max(y1, y2);

    // Check all other cards for overlap with the vertical segment at midX
    let blocked = false;
    cardLayer.querySelectorAll('.table-card').forEach(otherCard => {
      const oid = otherCard.dataset.id;
      if (oid === d.source || oid === d.target) return;
      const ol = parseFloat(otherCard.style.left);
      const ot = parseFloat(otherCard.style.top);
      const ow = parseFloat(otherCard.style.width);
      const oh = parseFloat(otherCard.style.height);
      // Does the vertical segment at midX pass through this card?
      if (midX > ol && midX < ol + ow && yMax > ot && yMin < ot + oh) {
        blocked = true;
        // Push midX outside this card with 20px padding
        const pushRight = ol + ow + 20;
        const pushLeft  = ol - 20;
        // Pick whichever side keeps us between x1 and x2, else go outside
        if (srcIsLeft) {
          midX = Math.max(midX, pushRight);
        } else {
          midX = Math.min(midX, pushLeft);
        }
      }
    });

    const isSelected = edge.selected();

    ectx.save();
    ectx.strokeStyle = isSelected ? '#fff' : '#f59f00';
    ectx.lineWidth   = isSelected ? 3 : 2;
    ectx.shadowColor = '#f59f00';
    ectx.shadowBlur  = isSelected ? 8 : 3;

    // Power BI style: exit horizontal → vertical connector → enter horizontal
    ectx.beginPath();
    ectx.moveTo(x1, y1);
    ectx.lineTo(midX, y1);
    ectx.lineTo(midX, y2);
    ectx.lineTo(x2, y2);
    ectx.stroke();

    // Arrowhead at target end
    const arrowDir = srcIsLeft ? 1 : -1;
    ectx.fillStyle = isSelected ? '#fff' : '#f59f00';
    ectx.beginPath();
    ectx.moveTo(x2, y2);
    ectx.lineTo(x2 - arrowDir * 10, y2 - 5);
    ectx.lineTo(x2 - arrowDir * 10, y2 + 5);
    ectx.closePath();
    ectx.fill();

    // Label at midpoint
    const label = d.label || '';
    if (label) {
      ectx.shadowBlur = 0;
      ectx.fillStyle  = '#adb5bd';
      ectx.font       = '9px Segoe UI, sans-serif';
      ectx.textAlign  = 'center';
      ectx.fillStyle  = '#0d1b2a';
      const tw = ectx.measureText(label).width;
      ectx.fillRect(midX - tw/2 - 3, (y1+y2)/2 - 7, tw + 6, 14);
      ectx.fillStyle = '#adb5bd';
      ectx.fillText(label, midX, (y1+y2)/2 + 4);
    }

    ectx.restore();
  });
}

// Redraw edges whenever cards move or zoom changes
cy.on('pan zoom position render', drawEdges);



// ── Drag-to-connect (column → column) ────────────────────────────────────────
const dragCanvas = document.createElement('canvas');
dragCanvas.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;z-index:20;';
cyContainer.appendChild(dragCanvas);

function resizeDragCanvas() {
  dragCanvas.width  = cyContainer.offsetWidth;
  dragCanvas.height = cyContainer.offsetHeight;
}
resizeDragCanvas();
window.addEventListener('resize', resizeDragCanvas);

const dctx    = dragCanvas.getContext('2d');
let dragState = null;  // { sourceNode, sourceCol, startX, startY }

function clearDragLine() { dctx.clearRect(0, 0, dragCanvas.width, dragCanvas.height); }

function drawDragLine(x1, y1, x2, y2) {
  clearDragLine();
  dctx.save();
  dctx.strokeStyle = '#f59f00';
  dctx.lineWidth   = 2;
  dctx.setLineDash([6, 3]);
  dctx.shadowColor = '#f59f00';
  dctx.shadowBlur  = 6;
  dctx.beginPath();
  dctx.moveTo(x1, y1);
  dctx.lineTo(x2, y2);
  dctx.stroke();
  const angle = Math.atan2(y2 - y1, x2 - x1);
  dctx.setLineDash([]);
  dctx.fillStyle = '#f59f00';
  dctx.beginPath();
  dctx.moveTo(x2, y2);
  dctx.lineTo(x2 - 10*Math.cos(angle-0.4), y2 - 10*Math.sin(angle-0.4));
  dctx.lineTo(x2 - 10*Math.cos(angle+0.4), y2 - 10*Math.sin(angle+0.4));
  dctx.closePath();
  dctx.fill();
  dctx.restore();
}

// Mousedown on column row = draw relation; header = move card via Cytoscape
cardLayer.addEventListener('mousedown', function(e) {
  const row  = e.target.closest('.col-row-el');
  const card = e.target.closest('.table-card');
  if (!card) return;

  // If clicking on a column row, start relation drag
  if (row) {
    e.stopPropagation();
    e.preventDefault();

    const rect    = cyContainer.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    // Start line from right edge of the source row
    const startX  = rowRect.right - rect.left;
    const startY  = rowRect.top + rowRect.height / 2 - rect.top;
    const nodeId  = card.dataset.id;
    const node    = cy.getElementById(nodeId);

    row.style.background = 'rgba(245,159,0,0.25)';
    dragState = { sourceNode: node, sourceCol: row.dataset.col, startX, startY, sourceRow: row };
    cardLayer.style.cursor = 'crosshair';

  } else {
    // Clicking on header — let Cytoscape handle node dragging natively
    // We forward a synthetic mousedown to the Cytoscape canvas at the node position
    const nodeId = card.dataset.id;
    const node   = cy.getElementById(nodeId);
    // Simulate mousedown on the underlying cy canvas so Cytoscape picks up the drag
    const pos    = node.renderedPosition();
    const rect   = cyContainer.getBoundingClientRect();
    const cyCanvas = cyContainer.querySelector('canvas');
    if (cyCanvas) {
      const synth = new MouseEvent('mousedown', {
        bubbles: true, cancelable: true,
        clientX: rect.left + pos.x,
        clientY: rect.top  + pos.y,
        buttons: 1
      });
      cyCanvas.dispatchEvent(synth);
    }
  }
});

document.addEventListener('mousemove', function(e) {
  if (!dragState) return;
  const rect = cyContainer.getBoundingClientRect();
  const mx   = e.clientX - rect.left;
  const my   = e.clientY - rect.top;
  drawDragLine(dragState.startX, dragState.startY, mx, my);

  // Highlight target column row under cursor
  cardLayer.querySelectorAll('.col-row-el').forEach(r => {
    const isSource = r === dragState.sourceRow;
    if (!isSource) r.style.background = r.dataset.tableId !== dragState.sourceNode.id()
      ? (r.matches(':hover') ? 'rgba(245,159,0,0.2)' : (parseInt(r.style.order||0)%2===0?'#1a2740':'#1e2e4a'))
      : (parseInt(r.style.order||0)%2===0?'#1a2740':'#1e2e4a');
  });

  // Highlight target card border
  cardLayer.querySelectorAll('.table-card').forEach(c => {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const hovered = el && el.closest('.table-card');
    if (hovered && c.dataset.id === hovered.dataset.id && c.dataset.id !== dragState.sourceNode.id()) {
      c.style.borderColor = '#f59f00';
      c.style.boxShadow   = '0 0 12px rgba(245,159,0,0.5)';
    } else if (c.dataset.id !== dragState.sourceNode.id()) {
      c.style.borderColor = '#3b5bdb';
      c.style.boxShadow   = '0 4px 16px rgba(0,0,0,0.5)';
    }
  });
});

document.addEventListener('mouseup', function(e) {
  if (!dragState) return;
  clearDragLine();
  cardLayer.style.cursor = '';

  // Find target column row under mouse
  const els       = document.elementsFromPoint(e.clientX, e.clientY);
  let targetRow   = null;
  let targetCard  = null;
  for (const el of els) {
    if (!targetRow && el.classList && el.classList.contains('col-row-el')) {
      if (el.dataset.tableId !== dragState.sourceNode.id()) targetRow = el;
    }
    if (!targetCard) {
      const c = el.closest && el.closest('.table-card');
      if (c && c.dataset.id !== dragState.sourceNode.id()) targetCard = c;
    }
  }

  const source    = dragState.sourceNode;
  const sourceCol = dragState.sourceCol || '?';
  const sourceRow = dragState.sourceRow;
  dragState       = null;

  // Reset highlights
  renderCards();

  const targetColName = targetRow ? targetRow.dataset.col : null;
  const targetNodeId  = targetRow ? targetRow.dataset.tableId : (targetCard ? targetCard.dataset.id : null);

  if (!targetNodeId) return;

  const targetNode = cy.getElementById(targetNodeId);
  const edgeId     = `${source.id()}__${sourceCol}__${targetNodeId}__${targetColName || '?'}`;

  if (!cy.getElementById(edgeId).length) {
    const label = targetColName
      ? `${sourceCol} → ${targetColName}`
      : `${sourceCol} → ?`;

    // Compute Y offsets so edge anchors at the correct column row
    // source offset: how far the source col row center is from node center (as fraction of node height)
    const srcData  = source.data();
    const tgtData  = targetNode.data();
    const srcCols  = srcData.columns || [];
    const tgtCols  = tgtData.columns || [];
    const srcH     = nodeHeight(srcCols);
    const tgtH     = nodeHeight(tgtCols);

    const srcIdx   = srcCols.findIndex(c => c.name === sourceCol);
    const tgtIdx   = tgtCols.findIndex(c => c.name === targetColName);

    // Y position of row center relative to node top
    const srcRowY  = srcIdx >= 0 ? HEAD_H + srcIdx * ROW_H + ROW_H / 2 : srcH / 2;
    const tgtRowY  = tgtIdx >= 0 ? HEAD_H + tgtIdx * ROW_H + ROW_H / 2 : tgtH / 2;

    // Offset from node center (-0.5 to 0.5 as fraction of height, then in px)
    const srcOffY  = (srcRowY - srcH / 2);
    const tgtOffY  = (tgtRowY - tgtH / 2);

    cy.add({ data: {
      id: edgeId,
      source: source.id(),
      target: targetNodeId,
      label,
      source_column: sourceCol,
      target_column: targetColName || '',
      srcOffY,
      tgtOffY
    }});



    fetch('/relation/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source_table:  source.id(),
        source_column: sourceCol,
        target_table:  targetNodeId,
        target_column: targetColName || ''
      })
    }).catch(() => {});
  }
});


// ── Right-click context menu — detected on edgeCanvas ───────────────────────
const ctxMenu = document.createElement('div');
ctxMenu.id = 'ctx-menu';
ctxMenu.innerHTML = `<div id="ctx-delete">🗑 Delete Relation</div><div id="ctx-cancel">✕ Cancel</div>`;
document.body.appendChild(ctxMenu);

let ctxTargetEdge = null;

function findEdgeAtPoint(cx, cy_coord) {
  // Check if point is near any drawn edge line
  let found = null;
  cy.edges().forEach(edge => {
    const d       = edge.data();
    const srcRect = getColumnRowScreenRect(d.source, d.source_column);
    const tgtRect = getColumnRowScreenRect(d.target, d.target_column);
    if (!srcRect || !tgtRect) return;

    const srcIsLeft = srcRect.right < tgtRect.left;
    const x1 = srcIsLeft ? srcRect.right : srcRect.left;
    const y1 = srcRect.midY;
    const x2 = srcIsLeft ? tgtRect.left  : tgtRect.right;
    const y2 = tgtRect.midY;
    let midX = (x1 + x2) / 2;

    // Same blocking logic as drawEdges
    cardLayer.querySelectorAll('.table-card').forEach(otherCard => {
      const oid = otherCard.dataset.id;
      if (oid === d.source || oid === d.target) return;
      const ol = parseFloat(otherCard.style.left);
      const ot = parseFloat(otherCard.style.top);
      const ow = parseFloat(otherCard.style.width);
      const oh = parseFloat(otherCard.style.height);
      if (midX > ol && midX < ol + ow && Math.max(y1,y2) > ot && Math.min(y1,y2) < ot + oh) {
        midX = srcIsLeft ? Math.max(midX, ol + ow + 20) : Math.min(midX, ol - 20);
      }
    });

    const THRESH = 12;
    // Check 3 segments: (x1,y1)→(midX,y1), (midX,y1)→(midX,y2), (midX,y2)→(x2,y2)
    function nearSegment(ax, ay, bx, by) {
      const dx = bx - ax, dy = by - ay;
      const len2 = dx*dx + dy*dy;
      if (len2 === 0) return false;
      const t = Math.max(0, Math.min(1, ((cx-ax)*dx + (cy_coord-ay)*dy) / len2));
      const px = ax + t*dx - cx;
      const py = ay + t*dy - cy_coord;
      return (px*px + py*py) < THRESH*THRESH;
    }

    if (nearSegment(x1, y1, midX, y1) ||
        nearSegment(midX, y1, midX, y2) ||
        nearSegment(midX, y2, x2, y2)) {
      found = edge;
    }
  });
  return found;
}

cyContainer.addEventListener('contextmenu', function(e) {
  e.preventDefault();
  const rect  = cyContainer.getBoundingClientRect();
  const mx    = e.clientX - rect.left;
  const my    = e.clientY - rect.top;
  const edge  = findEdgeAtPoint(mx, my);
  if (edge) {
    ctxTargetEdge         = edge;
    ctxMenu.style.left    = e.clientX + 'px';
    ctxMenu.style.top     = e.clientY + 'px';
    ctxMenu.style.display = 'block';
  }
});

document.getElementById('ctx-delete').addEventListener('click', function() {
  if (ctxTargetEdge) {
    const d = ctxTargetEdge.data();
    fetch('/relation/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source_table:  d.source,
        source_column: d.source_column || '',
        target_table:  d.target,
        target_column: d.target_column || ''
      })
    }).catch(() => {});
    ctxTargetEdge.remove();
    drawEdges();
    ctxTargetEdge = null;
  }
  ctxMenu.style.display = 'none';
});

document.getElementById('ctx-cancel').addEventListener('click', function() {
  ctxMenu.style.display = 'none';
  ctxTargetEdge = null;
});

document.addEventListener('click', function(e) {
  if (!e.target.closest('#ctx-menu')) ctxMenu.style.display = 'none';
});


// ── Load schema ──────────────────────────────────────────────────────────────
async function loadSchema() {
  const btn = document.getElementById('loadBtn');
  if (btn) { btn.textContent = 'Loading…'; btn.disabled = true; }

  try {
    const res  = await fetch('/scan');
    if (!res.ok) throw new Error(`Server error ${res.status}`);
    const data = await res.json();

    cy.elements().remove();
    cardLayer.innerHTML = '';

    data.nodes.forEach(node => {
      const H = nodeHeight(node.columns);
      cy.add({
        data: {
          id:         node.id,
          label:      node.label,
          schema:     node.schema,
          table:      node.table,
          columns:    node.columns,
          nodeHeight: H,
          isTable:    true
        }
      });
    });

    data.edges.forEach(edge => {
      cy.add({
        data: {
          id:            edge.id,
          source:        edge.source,
          target:        edge.target,
          source_column: edge.source_column || '',
          target_column: edge.target_column || '',
          label:         edge.label || ''
        }
      });


    });

    cy.layout({ name: 'grid', padding: 80, avoidOverlap: true }).run();
    renderCards();

  } catch (err) {
    alert('Failed to load schema: ' + err.message);
  } finally {
    if (btn) { btn.textContent = 'Load Schema'; btn.disabled = false; }
  }
}

// Auto-load on page open
document.addEventListener('DOMContentLoaded', loadSchema);