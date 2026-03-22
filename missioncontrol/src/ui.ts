export function generateBoardHTML(basePath: string = ''): string {
  // Strip trailing slash from basePath
  const bp = basePath.replace(/\/+$/, '');
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Mission Control</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    * { box-sizing: border-box; }

    body {
      overflow: hidden;
      height: 100vh;
      display: flex;
      flex-direction: column;
    }

    #board {
      display: flex;
      flex-direction: row;
      overflow-x: auto;
      overflow-y: hidden;
      flex: 1;
      gap: 12px;
      padding: 12px;
      scroll-snap-type: x mandatory;
      -webkit-overflow-scrolling: touch;
    }

    #board::-webkit-scrollbar {
      height: 8px;
    }
    #board::-webkit-scrollbar-track {
      background: #111827;
      border-radius: 4px;
    }
    #board::-webkit-scrollbar-thumb {
      background: #374151;
      border-radius: 4px;
    }
    #board::-webkit-scrollbar-thumb:hover {
      background: #4B5563;
    }

    .column {
      flex: 0 0 280px;
      width: 280px;
      min-width: 280px;
      background: #374151;
      border-radius: 10px;
      display: flex;
      flex-direction: column;
      max-height: 100%;
      scroll-snap-align: start;
      transition: background 0.15s ease;
    }

    .column.drag-over {
      background: #4B5563;
      outline: 2px dashed #6B7280;
    }

    .column-header {
      padding: 12px 12px 8px;
      flex-shrink: 0;
      border-bottom: 1px solid #4B5563;
    }

    .column-cards {
      flex: 1;
      overflow-y: auto;
      padding: 8px;
    }

    .column-cards::-webkit-scrollbar {
      width: 4px;
    }
    .column-cards::-webkit-scrollbar-track {
      background: transparent;
    }
    .column-cards::-webkit-scrollbar-thumb {
      background: #4B5563;
      border-radius: 2px;
    }

    .card {
      background: #1F2937;
      border-radius: 8px;
      padding: 12px;
      margin-bottom: 8px;
      cursor: pointer;
      box-shadow: 0 1px 3px rgba(0,0,0,0.4);
      border: 1px solid #374151;
      transition: all 0.15s ease;
      user-select: none;
    }

    .card:hover {
      border-color: #4B5563;
      box-shadow: 0 2px 8px rgba(0,0,0,0.5);
      transform: translateY(-1px);
    }

    .card.dragging {
      opacity: 0.4;
      transform: rotate(2deg);
    }

    .card.drag-over-card {
      border-color: #3B82F6;
    }

    .status-dot {
      display: inline-block;
      width: 8px;
      height: 8px;
      border-radius: 50%;
      margin-right: 5px;
      flex-shrink: 0;
    }

    .modal-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.75);
      align-items: center;
      justify-content: center;
      z-index: 50;
      backdrop-filter: blur(2px);
    }

    .modal-overlay:not(.hidden) {
      display: flex;
    }

    .modal-panel {
      background: #1F2937;
      border-radius: 12px;
      padding: 24px;
      width: 90%;
      max-width: 560px;
      max-height: 85vh;
      overflow-y: auto;
      border: 1px solid #374151;
      box-shadow: 0 20px 60px rgba(0,0,0,0.6);
    }

    .modal-panel::-webkit-scrollbar {
      width: 4px;
    }
    .modal-panel::-webkit-scrollbar-thumb {
      background: #4B5563;
      border-radius: 2px;
    }

    .log-viewer {
      background: #111827;
      border-radius: 6px;
      padding: 12px;
      font-family: 'Menlo', 'Monaco', 'Courier New', monospace;
      font-size: 12px;
      line-height: 1.6;
      max-height: 300px;
      overflow-y: auto;
      white-space: pre-wrap;
      word-break: break-all;
      color: #D1FAE5;
      border: 1px solid #374151;
    }

    .log-viewer::-webkit-scrollbar {
      width: 4px;
    }
    .log-viewer::-webkit-scrollbar-thumb {
      background: #374151;
      border-radius: 2px;
    }

    .tag-badge {
      display: inline-flex;
      align-items: center;
      background: #374151;
      color: #9CA3AF;
      border-radius: 4px;
      padding: 2px 7px;
      font-size: 11px;
      font-weight: 500;
      margin-right: 4px;
      margin-bottom: 4px;
    }

    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 8px 16px;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.15s ease;
      border: none;
      outline: none;
    }

    .btn-primary {
      background: #3B82F6;
      color: white;
    }
    .btn-primary:hover {
      background: #2563EB;
    }

    .btn-secondary {
      background: #374151;
      color: #D1D5DB;
    }
    .btn-secondary:hover {
      background: #4B5563;
    }

    .btn-danger {
      background: #7F1D1D;
      color: #FCA5A5;
    }
    .btn-danger:hover {
      background: #991B1B;
    }

    .btn-ghost {
      background: transparent;
      color: #9CA3AF;
      padding: 4px 8px;
    }
    .btn-ghost:hover {
      background: #374151;
      color: #D1D5DB;
    }

    .input-field {
      background: #111827;
      border: 1px solid #374151;
      border-radius: 6px;
      padding: 8px 12px;
      color: #F9FAFB;
      font-size: 14px;
      width: 100%;
      outline: none;
      transition: border-color 0.15s;
    }
    .input-field:focus {
      border-color: #3B82F6;
    }
    .input-field::placeholder {
      color: #6B7280;
    }

    textarea.input-field {
      resize: vertical;
      min-height: 80px;
      font-family: inherit;
    }

    select.input-field {
      cursor: pointer;
      appearance: none;
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3E%3Cpath stroke='%236B7280' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3E%3C/svg%3E");
      background-repeat: no-repeat;
      background-position: right 10px center;
      background-size: 16px;
      padding-right: 32px;
    }

    .label {
      display: block;
      font-size: 12px;
      font-weight: 500;
      color: #9CA3AF;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 6px;
    }

    .field-group {
      margin-bottom: 16px;
    }

    #login-page {
      position: fixed;
      inset: 0;
      background: #111827;
      align-items: center;
      justify-content: center;
      z-index: 100;
    }

    #login-page:not(.hidden) {
      display: flex;
    }

    .login-card {
      background: #1F2937;
      border-radius: 16px;
      padding: 40px;
      width: 90%;
      max-width: 380px;
      border: 1px solid #374151;
      box-shadow: 0 20px 60px rgba(0,0,0,0.5);
    }

    .inline-editable {
      background: transparent;
      border: 1px solid transparent;
      border-radius: 4px;
      padding: 2px 4px;
      color: inherit;
      font: inherit;
      width: 100%;
      outline: none;
      transition: border-color 0.15s;
    }
    .inline-editable:hover {
      border-color: #374151;
    }
    .inline-editable:focus {
      border-color: #3B82F6;
      background: #111827;
    }

    .column-count {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      background: #4B5563;
      color: #9CA3AF;
      border-radius: 10px;
      min-width: 20px;
      height: 20px;
      padding: 0 6px;
      font-size: 11px;
      font-weight: 600;
    }

    @keyframes pulse-dot {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.4; }
    }

    .status-dot.running {
      animation: pulse-dot 1.5s ease-in-out infinite;
    }

    .empty-column-hint {
      color: #4B5563;
      font-size: 12px;
      text-align: center;
      padding: 20px 8px;
      border: 1px dashed #374151;
      border-radius: 6px;
      margin: 4px;
    }
  </style>
</head>
<body class="bg-gray-900 text-gray-100">

  <!-- Header -->
  <header class="flex items-center justify-between px-4 py-3 bg-gray-900 border-b border-gray-700 flex-shrink-0" style="min-height:56px;">
    <div class="flex items-center gap-3">
      <div class="w-7 h-7 rounded-md bg-blue-600 flex items-center justify-center flex-shrink-0">
        <svg class="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7" />
        </svg>
      </div>
      <div>
        <h1 class="text-sm font-bold text-white leading-tight">Mission Control</h1>
        <p class="text-xs text-gray-500 leading-tight">Kanban Board</p>
      </div>
    </div>
    <div class="flex items-center gap-2">
      <span id="poll-indicator" class="w-2 h-2 rounded-full bg-gray-600" title="Polling status"></span>
      <button class="btn btn-primary text-sm" style="padding:6px 14px;" onclick="openAddModal()">
        <svg class="w-4 h-4 mr-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
          <path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4" />
        </svg>
        Add Card
      </button>
    </div>
  </header>

  <!-- Board -->
  <main id="board"></main>

  <!-- Card Detail Modal -->
  <div id="card-modal" class="modal-overlay hidden">
    <div class="modal-panel" onclick="event.stopPropagation()">
      <div class="flex items-start justify-between mb-4">
        <div class="flex-1 mr-3">
          <input id="modal-title" class="inline-editable text-lg font-semibold text-white" style="font-size:18px;font-weight:600;" />
        </div>
        <div class="flex items-center gap-1">
          <button class="btn btn-ghost" onclick="deleteCurrentCard()" title="Delete card">
            <svg class="w-4 h-4 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
          <button class="btn btn-ghost" onclick="closeCardModal()">
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      <div class="field-group">
        <label class="label">Status</label>
        <div id="modal-status-display" class="flex items-center gap-2 text-sm"></div>
      </div>

      <div class="field-group">
        <label class="label">Column</label>
        <select id="modal-column-select" class="input-field" onchange="moveCardFromModal(this.value)"></select>
      </div>

      <div class="field-group">
        <label class="label">Description</label>
        <textarea id="modal-description" class="input-field" placeholder="Add a description..." style="resize:vertical;min-height:80px;font-family:inherit;font-size:14px;"></textarea>
      </div>

      <div class="field-group">
        <label class="label">Tags</label>
        <input id="modal-tags" class="input-field" placeholder="comma-separated tags" />
      </div>

      <div id="modal-skill-section" class="field-group hidden">
        <label class="label">Skill</label>
        <div id="modal-skill-display" class="text-sm text-blue-400 font-mono bg-gray-900 rounded px-3 py-2 inline-block border border-gray-700"></div>
      </div>

      <div class="flex gap-2 mb-4">
        <button class="btn btn-primary flex-1" onclick="saveCardEdits()">Save Changes</button>
        <button class="btn btn-secondary" onclick="fetchAndShowLog()">View Log</button>
      </div>

      <div id="log-section" class="hidden">
        <label class="label mb-2">Execution Log</label>
        <pre id="log-content" class="log-viewer">Loading...</pre>
      </div>
    </div>
  </div>

  <!-- Add Card Modal -->
  <div id="add-modal" class="modal-overlay hidden">
    <div class="modal-panel" style="max-width:440px;" onclick="event.stopPropagation()">
      <div class="flex items-center justify-between mb-5">
        <h2 class="text-base font-semibold text-white">Add New Card</h2>
        <button class="btn btn-ghost" onclick="closeAddModal()">
          <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
      <div class="field-group">
        <label class="label">Title *</label>
        <input id="add-title" class="input-field" placeholder="What needs to get done?" />
      </div>
      <div class="field-group">
        <label class="label">Description</label>
        <textarea id="add-description" class="input-field" placeholder="Optional description..." style="font-family:inherit;font-size:14px;"></textarea>
      </div>
      <div class="field-group">
        <label class="label">Tags</label>
        <input id="add-tags" class="input-field" placeholder="feature, urgent, v2 (comma-separated)" />
      </div>
      <div class="flex gap-2">
        <button class="btn btn-primary flex-1" onclick="submitAddCard()">Create Card</button>
        <button class="btn btn-secondary" onclick="closeAddModal()">Cancel</button>
      </div>
    </div>
  </div>

  <!-- Login Page -->
  <div id="login-page" class="hidden">
    <div class="login-card">
      <div class="flex items-center gap-3 mb-8">
        <div class="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center">
          <svg class="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7" />
          </svg>
        </div>
        <div>
          <h1 class="text-lg font-bold text-white">Mission Control</h1>
          <p class="text-xs text-gray-500">Sign in to continue</p>
        </div>
      </div>
      <div class="field-group">
        <label class="label">Password</label>
        <input id="login-password" class="input-field" type="password" placeholder="Enter password..." onkeydown="if(event.key==='Enter') submitLogin()" />
      </div>
      <div id="login-error" class="hidden text-red-400 text-sm mb-3"></div>
      <button class="btn btn-primary w-full" style="width:100%;justify-content:center;" onclick="submitLogin()">Sign In</button>
    </div>
  </div>

  <script>
    const BASE_PATH = '${bp}';
    const COLUMNS = [
      { id: "backlog", name: "Backlog", skill: null },
      { id: "office-hours", name: "Office Hours", skill: "/office-hours" },
      { id: "ceo-review", name: "CEO Review", skill: "/plan-ceo-review" },
      { id: "eng-review", name: "Eng Review", skill: "/plan-eng-review" },
      { id: "design-review", name: "Design Review", skill: "/plan-design-review" },
      { id: "design", name: "Design", skill: "/design-consultation" },
      { id: "implementation", name: "Implementation", skill: null },
      { id: "code-review", name: "Code Review", skill: "/review" },
      { id: "debug", name: "Debug", skill: "/debug" },
      { id: "qa", name: "QA", skill: "/qa" },
      { id: "ship", name: "Ship", skill: "/ship" },
      { id: "docs", name: "Docs", skill: "/document-release" },
      { id: "retro", name: "Retro", skill: "/retro" },
      { id: "done", name: "Done", skill: null },
    ];

    const STATUS_COLORS = {
      idle: '#6B7280',
      pending: '#F59E0B',
      running: '#3B82F6',
      complete: '#10B981',
      failed: '#EF4444',
    };

    const STATUS_LABELS = {
      idle: 'Idle',
      pending: 'Pending',
      running: 'Running',
      complete: 'Complete',
      failed: 'Failed',
    };

    let boardState = null;
    let lastStateJSON = null;
    let currentCardId = null;
    let dragCardId = null;
    let pollInterval = null;
    let isMobile = /Mobi|Android/i.test(navigator.userAgent) || window.innerWidth < 640;

    // ─── Rendering ───────────────────────────────────────────────────────────

    function renderBoard(state) {
      const board = document.getElementById('board');

      // Build a map of columnId → cards
      const cardsByColumn = {};
      COLUMNS.forEach(c => { cardsByColumn[c.id] = []; });
      (state.cards || []).forEach(card => {
        const col = card.column || 'backlog';
        if (!cardsByColumn[col]) cardsByColumn['backlog'].push(card);
        else cardsByColumn[col].push(card);
      });

      // Check if we can do a targeted update vs full re-render
      const existingColumns = board.querySelectorAll('.column');
      if (existingColumns.length === COLUMNS.length) {
        // Targeted update: just re-render card lists
        COLUMNS.forEach(col => {
          const colEl = board.querySelector('[data-column-id="' + col.id + '"]');
          if (!colEl) return;
          const cardsContainer = colEl.querySelector('.column-cards');
          const count = cardsByColumn[col.id].length;
          const countEl = colEl.querySelector('.column-count');
          if (countEl) countEl.textContent = count;
          cardsContainer.innerHTML = renderCards(cardsByColumn[col.id], col);
          attachCardEvents(cardsContainer);
        });
      } else {
        // Full re-render
        board.innerHTML = COLUMNS.map(col => renderColumn(col, cardsByColumn[col.id])).join('');
        board.querySelectorAll('.column').forEach(attachColumnDragEvents);
        board.querySelectorAll('.column-cards').forEach(attachCardEvents);
      }
    }

    function renderColumn(col, cards) {
      const count = cards.length;
      return \`
        <div class="column" data-column-id="\${col.id}">
          <div class="column-header">
            <div class="flex items-center justify-between mb-0.5">
              <span class="text-xs font-semibold uppercase tracking-wider text-gray-300">\${escHtml(col.name)}</span>
              <span class="column-count">\${count}</span>
            </div>
            \${col.skill ? \`<div class="text-xs text-gray-500 font-mono mt-0.5">\${escHtml(col.skill)}</div>\` : '<div class="text-xs text-gray-600 mt-0.5">—</div>'}
          </div>
          <div class="column-cards">
            \${renderCards(cards, col)}
          </div>
        </div>
      \`;
    }

    function renderCards(cards, col) {
      if (cards.length === 0) {
        return \`<div class="empty-column-hint">Drop cards here</div>\`;
      }
      return cards.map(card => renderCard(card)).join('');
    }

    function renderCard(card) {
      const status = card.status || 'idle';
      const color = STATUS_COLORS[status] || STATUS_COLORS.idle;
      const label = STATUS_LABELS[status] || status;
      const tags = (card.tags || []);
      const tagsHtml = tags.length > 0
        ? \`<div class="flex flex-wrap mt-2">\${tags.map(t => \`<span class="tag-badge">\${escHtml(t)}</span>\`).join('')}</div>\`
        : '';
      const runningClass = status === 'running' ? ' running' : '';

      return \`
        <div class="card"
          data-card-id="\${escHtml(card.id)}"
          \${!isMobile ? 'draggable="true"' : ''}
          onclick="openCardModal('\${escHtml(card.id)}')"
        >
          <div class="flex items-start gap-2">
            <span class="status-dot\${runningClass}" style="background:\${color};margin-top:5px;flex-shrink:0;"></span>
            <span class="text-sm font-medium text-gray-100 leading-snug flex-1">\${escHtml(card.title || 'Untitled')}</span>
          </div>
          \${tagsHtml}
          \${card.skill ? \`<div class="text-xs text-blue-400 font-mono mt-2 truncate">\${escHtml(card.skill)}</div>\` : ''}
        </div>
      \`;
    }

    // ─── Drag and Drop ───────────────────────────────────────────────────────

    function attachColumnDragEvents(colEl) {
      colEl.addEventListener('dragover', e => {
        e.preventDefault();
        colEl.classList.add('drag-over');
      });
      colEl.addEventListener('dragleave', e => {
        if (!colEl.contains(e.relatedTarget)) {
          colEl.classList.remove('drag-over');
        }
      });
      colEl.addEventListener('drop', e => {
        e.preventDefault();
        colEl.classList.remove('drag-over');
        const cardId = e.dataTransfer.getData('text/plain');
        const colId = colEl.dataset.columnId;
        if (cardId && colId) {
          moveCard(cardId, colId);
        }
      });
    }

    function attachCardEvents(container) {
      if (isMobile) return;
      container.querySelectorAll('.card[draggable]').forEach(cardEl => {
        cardEl.addEventListener('dragstart', e => {
          dragCardId = cardEl.dataset.cardId;
          e.dataTransfer.setData('text/plain', dragCardId);
          e.dataTransfer.effectAllowed = 'move';
          setTimeout(() => cardEl.classList.add('dragging'), 0);
        });
        cardEl.addEventListener('dragend', () => {
          cardEl.classList.remove('dragging');
          dragCardId = null;
          document.querySelectorAll('.column').forEach(c => c.classList.remove('drag-over'));
        });
      });
    }

    // ─── Card Modal ───────────────────────────────────────────────────────────

    function findCard(id) {
      if (!boardState) return null;
      return (boardState.cards || []).find(c => c.id === id) || null;
    }

    function findColumnForCard(id) {
      const card = findCard(id);
      return card ? (card.column || 'backlog') : 'backlog';
    }

    function openCardModal(cardId) {
      const card = findCard(cardId);
      if (!card) return;
      currentCardId = cardId;

      document.getElementById('modal-title').value = card.title || '';
      document.getElementById('modal-description').value = card.description || '';
      document.getElementById('modal-tags').value = (card.tags || []).join(', ');

      // Status display
      const status = card.status || 'idle';
      const color = STATUS_COLORS[status] || STATUS_COLORS.idle;
      const label = STATUS_LABELS[status] || status;
      const runningClass = status === 'running' ? ' running' : '';
      document.getElementById('modal-status-display').innerHTML =
        \`<span class="status-dot\${runningClass}" style="background:\${color};"></span><span class="text-gray-300">\${escHtml(label)}</span>\`;

      // Column select
      const colSelect = document.getElementById('modal-column-select');
      colSelect.innerHTML = COLUMNS.map(c =>
        \`<option value="\${c.id}" \${c.id === (card.column || 'backlog') ? 'selected' : ''}>\${escHtml(c.name)}</option>\`
      ).join('');

      // Skill
      const skillSection = document.getElementById('modal-skill-section');
      const skillDisplay = document.getElementById('modal-skill-display');
      if (card.skill) {
        skillDisplay.textContent = card.skill;
        skillSection.classList.remove('hidden');
      } else {
        skillSection.classList.add('hidden');
      }

      // Reset log
      document.getElementById('log-section').classList.add('hidden');
      document.getElementById('log-content').textContent = '';

      document.getElementById('card-modal').classList.remove('hidden');
    }

    function closeCardModal() {
      document.getElementById('card-modal').classList.add('hidden');
      currentCardId = null;
    }

    async function saveCardEdits() {
      if (!currentCardId) return;
      const title = document.getElementById('modal-title').value.trim();
      const description = document.getElementById('modal-description').value.trim();
      const tagsRaw = document.getElementById('modal-tags').value;
      const tags = tagsRaw.split(',').map(t => t.trim()).filter(Boolean);

      try {
        await apiFetch(\`/api/cards/\${currentCardId}\`, {
          method: 'PATCH',
          body: JSON.stringify({ title, description, tags }),
        });
        await refreshState();
        closeCardModal();
      } catch (err) {
        alert('Failed to save: ' + err.message);
      }
    }

    async function moveCardFromModal(columnId) {
      if (!currentCardId) return;
      await moveCard(currentCardId, columnId);
    }

    async function deleteCurrentCard() {
      if (!currentCardId) return;
      if (!confirm('Delete this card? This cannot be undone.')) return;
      try {
        await apiFetch(\`/api/cards/\${currentCardId}\`, { method: 'DELETE' });
        closeCardModal();
        await refreshState();
      } catch (err) {
        alert('Failed to delete: ' + err.message);
      }
    }

    async function fetchAndShowLog() {
      if (!currentCardId) return;
      const logSection = document.getElementById('log-section');
      const logContent = document.getElementById('log-content');
      logSection.classList.remove('hidden');
      logContent.textContent = 'Loading...';
      try {
        const res = await fetch(BASE_PATH + \`/api/cards/\${currentCardId}/log\`, { credentials: 'include' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const text = await res.text();
        logContent.textContent = text || '(no log output)';
        logContent.scrollTop = logContent.scrollHeight;
      } catch (err) {
        logContent.textContent = 'Failed to load log: ' + err.message;
      }
    }

    // ─── Add Card Modal ───────────────────────────────────────────────────────

    function openAddModal() {
      document.getElementById('add-title').value = '';
      document.getElementById('add-description').value = '';
      document.getElementById('add-tags').value = '';
      document.getElementById('add-modal').classList.remove('hidden');
      setTimeout(() => document.getElementById('add-title').focus(), 50);
    }

    function closeAddModal() {
      document.getElementById('add-modal').classList.add('hidden');
    }

    async function submitAddCard() {
      const title = document.getElementById('add-title').value.trim();
      if (!title) {
        document.getElementById('add-title').focus();
        return;
      }
      const description = document.getElementById('add-description').value.trim();
      const tagsRaw = document.getElementById('add-tags').value;
      const tags = tagsRaw.split(',').map(t => t.trim()).filter(Boolean);

      try {
        await apiFetch('/api/cards', {
          method: 'POST',
          body: JSON.stringify({ title, description, tags }),
        });
        closeAddModal();
        await refreshState();
      } catch (err) {
        alert('Failed to create card: ' + err.message);
      }
    }

    // ─── Login ────────────────────────────────────────────────────────────────

    function showLogin() {
      document.getElementById('login-page').classList.remove('hidden');
      document.getElementById('board').style.display = 'none';
      document.querySelector('header').style.display = 'none';
      setTimeout(() => document.getElementById('login-password').focus(), 50);
    }

    function hideLogin() {
      document.getElementById('login-page').classList.add('hidden');
      document.getElementById('board').style.display = '';
      document.querySelector('header').style.display = '';
    }

    async function submitLogin() {
      const password = document.getElementById('login-password').value;
      const errEl = document.getElementById('login-error');
      errEl.classList.add('hidden');
      try {
        const res = await fetch(BASE_PATH + '/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ password }),
        });
        if (!res.ok) {
          const text = await res.text().catch(() => 'Invalid password');
          errEl.textContent = text || 'Invalid password';
          errEl.classList.remove('hidden');
          return;
        }
        hideLogin();
        startPolling();
      } catch (err) {
        errEl.textContent = 'Network error: ' + err.message;
        errEl.classList.remove('hidden');
      }
    }

    // ─── API ─────────────────────────────────────────────────────────────────

    async function apiFetch(url, options = {}) {
      const res = await fetch(BASE_PATH + url, {
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          ...(options.headers || {}),
        },
        ...options,
      });
      if (res.status === 401) {
        showLogin();
        throw new Error('Unauthorized');
      }
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(text || 'HTTP ' + res.status);
      }
      const ct = res.headers.get('content-type') || '';
      if (ct.includes('application/json')) return res.json();
      return res.text();
    }

    async function refreshState() {
      try {
        const state = await apiFetch('/api/state');
        const stateJSON = JSON.stringify(state);
        if (stateJSON !== lastStateJSON) {
          lastStateJSON = stateJSON;
          boardState = state;
          renderBoard(state);
        }
        setPollIndicator(true);
      } catch (err) {
        if (err.message !== 'Unauthorized') {
          console.error('Poll error:', err);
          setPollIndicator(false);
        }
      }
    }

    async function moveCard(cardId, columnId) {
      try {
        await apiFetch(\`/api/cards/\${cardId}/move\`, {
          method: 'POST',
          body: JSON.stringify({ column: columnId }),
        });
        await refreshState();
      } catch (err) {
        if (err.message !== 'Unauthorized') {
          alert('Failed to move card: ' + err.message);
        }
      }
    }

    // ─── Polling ──────────────────────────────────────────────────────────────

    function setPollIndicator(ok) {
      const el = document.getElementById('poll-indicator');
      el.style.background = ok ? '#10B981' : '#EF4444';
      el.title = ok ? 'Connected' : 'Connection error';
    }

    function startPolling() {
      refreshState();
      if (pollInterval) clearInterval(pollInterval);
      pollInterval = setInterval(refreshState, 2000);
    }

    // ─── Keyboard & Click-outside ─────────────────────────────────────────────

    document.getElementById('card-modal').addEventListener('click', function(e) {
      if (e.target === this) closeCardModal();
    });

    document.getElementById('add-modal').addEventListener('click', function(e) {
      if (e.target === this) closeAddModal();
    });

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        closeCardModal();
        closeAddModal();
      }
      if (e.key === 'Enter' && !e.shiftKey && document.getElementById('add-modal').contains(document.activeElement)) {
        if (document.activeElement.tagName !== 'TEXTAREA') {
          submitAddCard();
        }
      }
    });

    // ─── Helpers ─────────────────────────────────────────────────────────────

    function escHtml(str) {
      if (!str) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    // ─── Init ─────────────────────────────────────────────────────────────────

    // Render skeleton columns immediately
    (function initSkeleton() {
      const board = document.getElementById('board');
      board.innerHTML = COLUMNS.map(col => renderColumn(col, [])).join('');
      board.querySelectorAll('.column').forEach(attachColumnDragEvents);
    })();

    startPolling();
  </script>
</body>
</html>`;
}
