(() => {
  const byId = id => document.getElementById(id);
  const selected = new Set(), expanded = new Set(), children = new Map();
  let root = null, current = null, target = null, items = [], history = [], managerGeneration = 0, folderGeneration = 0;

  function samePath(a, b) { return Boolean(a && b && a.toLowerCase() === b.toLowerCase()); }
  function isWithin(parent, candidate) { const rest = candidate.slice(parent.length); return rest === '' || /^[\\/]/.test(rest); }
  function joinPath(parent, name) { return `${parent.replace(/[\\/]$/, '')}\\${name}`; }
  function baseName(folder) { return folder.split(/[\\/]/).filter(Boolean).pop() || folder; }

  function setModule(name) {
    const generation = ++managerGeneration;
    const tidy = name === 'tidy', search = name === 'search', manager = name === 'manager';
    byId('tidyPanel').hidden = !tidy; byId('searchPanel').hidden = !search; byId('managerPanel').hidden = !manager;
    byId('tidyTab').setAttribute('aria-pressed', String(tidy)); byId('searchTab').setAttribute('aria-pressed', String(search)); byId('managerTab').setAttribute('aria-pressed', String(manager));
    byId('scanBtn').hidden = !tidy;
    if (!tidy) byId('resetBtn').hidden = true;
    if (manager) openManager(generation);
  }

  function renderBreadcrumb() {
    const holder = byId('managerBreadcrumb'); holder.replaceChildren();
    if (!root || !current) return;
    let cursor = root;
    const add = (label, destination) => { const button = document.createElement('button'); button.className = 'crumb'; button.textContent = label; button.onclick = () => loadFolder(destination); holder.append(button); };
    add(`${baseName(root)} · 管理范围`, root);
    const relative = current.slice(root.length).replace(/^[\\/]+/, '');
    for (const part of relative.split(/[\\/]+/).filter(Boolean)) { const separator = document.createElement('span'); separator.textContent = '›'; separator.className = 'crumb-separator'; holder.append(separator); cursor = joinPath(cursor, part); add(part, cursor); }
  }
  function updateActions() {
    byId('managerSelectedCount').textContent = `已选择 ${selected.size} 项`;
    byId('managerMove').disabled = selected.size === 0 || !target;
    byId('managerCreateFolder').disabled = !target;
    byId('managerUseCurrent').disabled = !current;
    const undoable = history.find(batch => batch.items.some(item => item.status === 'moved'));
    byId('managerUndo').disabled = !undoable; byId('managerUndo').dataset.batchId = undoable?.id || '';
    byId('managerTargetLabel').textContent = target || '尚未选择目标文件夹';
  }
  function showError(error) { byId('managerStatus').textContent = `操作未完成：${error.message}`; }

  async function loadFolder(folder) {
    const request = ++folderGeneration;
    try {
      const result = await window.tidy.managerReadFolder(folder);
      if (request !== folderGeneration) return;
      root = result.root; current = result.current; items = result.items; selected.clear();
      byId('managerRootLabel').textContent = root;
      byId('managerStatus').textContent = `${baseName(current)}：${items.length} 个文件或子文件夹${result.skipped ? ` · ${result.skipped} 个链接或无权限项目已略过` : ''}。`;
      renderBreadcrumb(); renderItems(); updateActions();
    } catch (error) { showError(error); }
  }

  async function loadTreeChildren(folder) {
    if (children.has(folder)) return children.get(folder);
    const listing = await window.tidy.managerReadFolder(folder);
    const folders = listing.items.filter(item => item.type === 'directory');
    children.set(folder, folders);
    return folders;
  }
  function renderTree() {
    const tree = byId('managerTree'); tree.replaceChildren();
    if (!root) { tree.innerHTML = '<p class="search-empty">选择管理范围后显示文件夹层级。</p>'; return; }
    renderTreeNode({ path: root, name: `${baseName(root)} · 根目录`, type: 'directory' }, 0, tree);
    updateActions();
  }
  function renderTreeNode(item, depth, container) {
    const node = document.createElement('div'); node.className = `folder-tree-node${samePath(target, item.path) ? ' selected-target' : ''}`;
    const row = document.createElement('div'); row.className = 'folder-tree-row'; row.style.setProperty('--depth', depth);
    const toggle = document.createElement('button'); toggle.className = 'tree-toggle'; toggle.textContent = expanded.has(item.path) ? '⌄' : '›'; toggle.setAttribute('aria-label', expanded.has(item.path) ? `收起 ${item.name}` : `展开 ${item.name}`);
    toggle.onclick = async () => {
      if (expanded.has(item.path)) expanded.delete(item.path);
      else { expanded.add(item.path); try { await loadTreeChildren(item.path); } catch (error) { showError(error); } }
      renderTree();
    };
    const choose = document.createElement('button'); choose.className = 'tree-folder-name'; choose.textContent = item.name; choose.title = `设“${item.path}”为移动目标`; choose.onclick = () => setTarget(item.path);
    const browse = document.createElement('button'); browse.className = 'tree-browse'; browse.textContent = '浏览'; browse.onclick = () => loadFolder(item.path);
    row.append(toggle, choose, browse);
    row.addEventListener('dragover', event => { if (event.dataTransfer.types.includes('application/x-file-manager-items')) { event.preventDefault(); node.classList.add('drop-target'); } });
    row.addEventListener('dragleave', () => node.classList.remove('drop-target'));
    row.addEventListener('drop', event => { event.preventDefault(); node.classList.remove('drop-target'); moveItems(parseDragged(event), item.path); });
    node.append(row); container.append(node);
    if (expanded.has(item.path)) {
      const list = children.get(item.path) || [];
      for (const child of list) renderTreeNode(child, depth + 1, container);
    }
  }

  function renderItems() {
    const list = byId('managerList'); list.replaceChildren();
    if (!root) { list.innerHTML = '<p class="search-empty">先选择一个具体的工作文件夹，文件和子文件夹会在这里按层级显示。</p>'; return; }
    if (!items.length) { list.innerHTML = '<p class="search-empty">这个文件夹目前是空的。</p>'; updateSelectAll(); return; }
    for (const item of items) {
      const row = document.createElement('article'); row.className = `manager-item ${item.type}`; row.draggable = true; row.dataset.path = item.path;
      const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.className = 'manager-check'; checkbox.checked = selected.has(item.path); checkbox.setAttribute('aria-label', `选择 ${item.name}`);
      checkbox.onchange = () => { checkbox.checked ? selected.add(item.path) : selected.delete(item.path); updateActions(); updateSelectAll(); };
      const icon = document.createElement('span'); icon.className = 'manager-kind'; icon.textContent = item.type === 'directory' ? '▰' : (item.name.split('.').pop().toUpperCase() || 'FILE');
      const details = document.createElement('div'); details.className = 'manager-item-details';
      const name = item.type === 'directory' ? document.createElement('button') : document.createElement('strong');
      if (item.type === 'directory') { name.className = 'manager-open'; name.textContent = item.name; name.onclick = () => loadFolder(item.path); }
      else name.textContent = item.name;
      const metadata = document.createElement('small'); metadata.textContent = `${item.type === 'directory' ? '文件夹' : `${(item.size / 1024).toFixed(1)} KB`} · 修改于 ${new Date(item.modifiedAt).toLocaleString('zh-CN')}`;
      details.append(name, metadata); row.append(checkbox, icon, details);
      if (item.type === 'directory') { const destination = document.createElement('button'); destination.className = 'ghost'; destination.textContent = '设为目标'; destination.onclick = event => { event.stopPropagation(); setTarget(item.path); }; row.append(destination); }
      row.addEventListener('dragstart', event => { const paths = selected.has(item.path) ? [...selected] : [item.path]; event.dataTransfer.setData('application/x-file-manager-items', JSON.stringify(paths)); event.dataTransfer.effectAllowed = 'move'; });
      row.addEventListener('dragover', event => { if (item.type === 'directory' && event.dataTransfer.types.includes('application/x-file-manager-items')) { event.preventDefault(); row.classList.add('drop-target'); } });
      row.addEventListener('dragleave', () => row.classList.remove('drop-target'));
      row.addEventListener('drop', event => { if (item.type !== 'directory') return; event.preventDefault(); row.classList.remove('drop-target'); moveItems(parseDragged(event), item.path); });
      list.append(row);
    }
    updateSelectAll(); updateActions();
  }
  function parseDragged(event) { try { const data = JSON.parse(event.dataTransfer.getData('application/x-file-manager-items')); return Array.isArray(data) ? data : []; } catch { return []; } }
  function updateSelectAll() { const boxes = [...document.querySelectorAll('.manager-check')]; byId('managerSelectAll').checked = boxes.length > 0 && boxes.every(box => box.checked); byId('managerSelectAll').indeterminate = boxes.some(box => box.checked) && !byId('managerSelectAll').checked; }
  function setTarget(folder) { target = folder; byId('managerTargetLabel').textContent = folder; renderTree(); updateActions(); }

  async function openManager(generation) {
    try {
      const state = await window.tidy.managerState();
      if (generation !== managerGeneration || byId('managerPanel').hidden) return;
      history = state.history || [];
      if (state.root) { root = state.root; current = root; target = root; expanded.clear(); children.clear(); expanded.add(root); await loadTreeChildren(root); await loadFolder(current); renderTree(); }
      else { root = null; current = null; target = null; items = []; renderItems(); renderTree(); }
      updateActions();
    } catch (error) { showError(error); }
  }

  async function moveItems(paths, destination) {
    if (!paths.length || !destination) return;
    const names = paths.map(filePath => filePath.split(/[\\/]/).pop()); const summary = names.slice(0, 3).join('、') + (names.length > 3 ? ` 等 ${names.length} 项` : '');
    if (!confirm(`将 ${summary} 移动到“${destination}”吗？同名项目不会覆盖。`)) return;
    byId('managerStatus').textContent = `正在移动 ${paths.length} 项…`; byId('managerMove').disabled = true;
    try {
      const batch = await window.tidy.managerMove(paths, destination); const moved = batch.items.filter(item => item.status === 'moved'); const failed = batch.items.filter(item => item.status === 'failed');
      moved.forEach(item => selected.delete(item.source)); history = await window.tidy.managerState().then(state => state.history || []);
      const message = `已移动 ${moved.length} 项${failed.length ? `；未移动：${failed.map(item => `${item.name}（${item.error}）`).join('；')}` : ''}。`;
      children.clear(); expanded.clear(); expanded.add(root); await loadTreeChildren(root); await loadFolder(current); renderTree(); byId('managerStatus').textContent = message; updateActions();
    } catch (error) { showError(error); updateActions(); }
  }

  byId('tidyTab').onclick = () => setModule('tidy'); byId('searchTab').onclick = () => setModule('search'); byId('managerTab').onclick = () => setModule('manager');
  byId('managerChooseRoot').onclick = async () => {
    const generation = ++managerGeneration;
    try { const chosen = await window.tidy.managerChooseRoot(); if (!chosen || generation !== managerGeneration) return; root = chosen; current = root; target = root; selected.clear(); children.clear(); expanded.clear(); expanded.add(root); byId('managerTargetLabel').textContent = target; await loadTreeChildren(root); await loadFolder(root); renderTree(); }
    catch (error) { showError(error); }
  };
  byId('managerUseCurrent').onclick = () => { if (current) setTarget(current); };
  byId('managerSelectAll').onchange = () => { for (const item of items) byId('managerSelectAll').checked ? selected.add(item.path) : selected.delete(item.path); renderItems(); };
  byId('managerClearSelection').onclick = () => { selected.clear(); renderItems(); updateActions(); };
  byId('managerMove').onclick = () => moveItems([...selected], target);
  byId('managerCreateFolder').onclick = () => {
    byId('managerFolderName').value = ''; byId('managerFolderHint').textContent = `将在当前目标文件夹下创建：${target || ''}`;
    byId('managerFolderDialog').showModal(); byId('managerFolderName').focus();
  };
  byId('managerFolderForm').onsubmit = async event => {
    event.preventDefault(); const name = byId('managerFolderName').value.trim();
    try {
      const folder = await window.tidy.managerCreateFolder(target, name);
      const parent = target; children.delete(parent); await loadTreeChildren(parent); expanded.add(parent); target = folder;
      byId('managerFolderDialog').close(); await loadFolder(current); renderTree();
      byId('managerStatus').textContent = `已在目标位置创建“${name}”，并设为当前移动目标。`;
    } catch (error) { byId('managerFolderHint').textContent = error.message; }
  };
  byId('closeManagerFolder').onclick = () => byId('managerFolderDialog').close(); byId('cancelManagerFolder').onclick = () => byId('managerFolderDialog').close();
  byId('managerUndo').onclick = async () => {
    const batchId = byId('managerUndo').dataset.batchId; const batch = history.find(item => item.id === batchId); if (!batch) return;
    const count = batch.items.filter(item => item.status === 'moved').length;
    if (!confirm(`撤销最近一次移动的 ${count} 项吗？原位置已有同名项目时会保留两边文件并跳过该项。`)) return;
    try {
      const result = await window.tidy.managerUndo(batchId); history = history.map(item => item.id === result.id ? result : item);
      const undone = result.items.filter(item => item.status === 'undone').length; const failed = result.items.filter(item => item.status === 'undo_failed');
      const message = `已撤销 ${undone} 项${failed.length ? `；未能撤销：${failed.map(item => `${item.name}（${item.error}）`).join('；')}` : ''}。`;
      children.clear(); expanded.clear(); expanded.add(root); await loadTreeChildren(root); await loadFolder(current); renderTree(); byId('managerStatus').textContent = message; updateActions();
    } catch (error) { showError(error); }
  };
  byId('managerTargetDropZone').addEventListener('dragover', event => { if (event.dataTransfer.types.includes('application/x-file-manager-items')) { event.preventDefault(); byId('managerTargetDropZone').classList.add('drop-target'); } });
  byId('managerTargetDropZone').addEventListener('dragleave', () => byId('managerTargetDropZone').classList.remove('drop-target'));
  byId('managerTargetDropZone').addEventListener('drop', event => { event.preventDefault(); byId('managerTargetDropZone').classList.remove('drop-target'); moveItems(parseDragged(event), target); });
})();
