(() => {
  const byId = id => document.getElementById(id);
  const selected = new Set(), expanded = new Set(), children = new Map();
  let root = null, current = null, sourceParent = null, target = null, targetParent = null, items = [], targetItems = [], history = [], managerGeneration = 0, folderGeneration = 0, targetGeneration = 0, managerMode = 'dual';
  let dualLeftRoot = null, dualLeftCurrent = null, dualLeftParent = null, dualLeftItems = [], dualLeftGeneration = 0, dualRightRoot = null, dualRightCurrent = null, createPaneSide = null, renameContext = null, fullscreenActive = false;
  let dualLeftQuery = '', dualRightQuery = '', dualLeftSearchResults = null, dualRightSearchResults = null, dualLeftSearchGeneration = 0, dualRightSearchGeneration = 0, dualLeftSearchTimer = null, dualRightSearchTimer = null;
  const dualLeftSelected = new Set(), dualRightSelected = new Set(), dualLeftBack = [], dualLeftForward = [];
  const sourceBack = [], sourceForward = [], targetBack = [], targetForward = [];

  function samePath(a, b) { return Boolean(a && b && a.toLowerCase() === b.toLowerCase()); }
  function isWithin(parent, candidate) { const rest = candidate.slice(parent.length); return rest === '' || /^[\\/]/.test(rest); }
  function joinPath(parent, name) { return `${parent.replace(/[\\/]$/, '')}\\${name}`; }
  function baseName(folder) { return folder.split(/[\\/]/).filter(Boolean).pop() || folder; }
  function panePathParts(folder) {
    if (/^[a-z]:[\\/]/i.test(folder)) return { root: folder.slice(0, 3), parts: folder.slice(3).split(/[\\/]+/).filter(Boolean) };
    if (/^[\\/]{2}[^\\/]+[\\/][^\\/]+/.test(folder)) {
      const [server, share, ...parts] = folder.replace(/^[\\/]{2}/, '').split(/[\\/]+/).filter(Boolean);
      return { root: `\\\\${server}\\${share}\\`, parts };
    }
    if (folder.startsWith('/')) return { root: '/', parts: folder.slice(1).split(/[\\/]+/).filter(Boolean) };
    return { root: '', parts: folder.split(/[\\/]+/).filter(Boolean) };
  }
  function renderPaneBreadcrumb(side, folder) {
    const holder = byId(side === 'left' ? 'managerDualSourcePath' : 'managerDualTargetPath');
    holder.replaceChildren(); holder.title = folder || '尚未选择文件夹';
    if (!folder) { holder.textContent = '尚未选择文件夹'; return; }
    const { root, parts } = panePathParts(folder);
    let cursor = root;
    const addNode = (label, destination, current) => {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'crumb'; button.textContent = label;
      button.dataset.path = destination; button.title = destination;
      if (current) button.setAttribute('aria-current', 'location');
      button.onclick = () => navigateDual(side, destination); holder.append(button);
    };
    if (root) addNode(root, root, parts.length === 0);
    for (let index = 0; index < parts.length; index++) {
      const separator = document.createElement('span'); separator.className = 'crumb-separator'; separator.textContent = '›'; holder.append(separator);
      cursor = cursor ? joinPath(cursor, parts[index]) : parts[index];
      addNode(parts[index], cursor, index === parts.length - 1);
    }
  }

  function setModule(name) {
    const generation = ++managerGeneration;
    const tidy = name === 'tidy', search = name === 'search', manager = name === 'manager', conversion = name === 'conversion';
    byId('tidyPanel').hidden = !tidy; byId('searchPanel').hidden = !search; byId('managerPanel').hidden = !manager; byId('conversionPanel').hidden = !conversion;
    byId('managerModeSwitch').hidden = !manager;
    byId('tidyTab').setAttribute('aria-pressed', String(tidy)); byId('searchTab').setAttribute('aria-pressed', String(search)); byId('managerTab').setAttribute('aria-pressed', String(manager)); byId('conversionTab').setAttribute('aria-pressed', String(conversion));
    byId('scanBtn').hidden = !tidy;
    if (!tidy) byId('resetBtn').hidden = true;
    syncManagerModeUI();
    if (!manager && fullscreenActive) void setFullscreen(false);
    if (manager) openManager(generation);
  }
  function syncManagerModeUI() {
    const dual = managerMode === 'dual';
    const active = !byId('managerPanel').hidden;
    byId('managerSingleMode').setAttribute('aria-pressed', String(!dual));
    byId('managerDualMode').setAttribute('aria-pressed', String(dual));
    byId('managerChooseRoot').hidden = dual;
    byId('managerPanel').classList.toggle('dual-mode', dual);
    byId('managerBrowser').hidden = dual;
    byId('managerDualBrowser').hidden = !dual;
    byId('managerDualStatus').hidden = !dual;
    document.body.classList.toggle('manager-dual-active', active && dual);
    document.body.classList.toggle('manager-fullscreen-active', active && dual && fullscreenActive);
    byId('managerFullscreenEnter').hidden = !active || !dual || fullscreenActive;
    byId('managerFullscreenExit').hidden = !active || !dual || !fullscreenActive;
  }
  function applyFullscreenState(enabled) { fullscreenActive = Boolean(enabled); syncManagerModeUI(); }
  async function setFullscreen(enabled) {
    try { applyFullscreenState(await window.tidy.windowSetFullscreen(Boolean(enabled))); }
    catch (error) { showError(error); }
  }

  function renderBreadcrumb() {
    const holder = byId('managerBreadcrumb'); holder.replaceChildren();
    if (!root || !current) return;
    let cursor = root;
    const add = (label, destination) => { const button = document.createElement('button'); button.className = 'crumb'; button.textContent = label; button.onclick = () => navigateSource(destination); holder.append(button); };
    add(`${baseName(root)} · 管理范围`, root);
    const relative = current.slice(root.length).replace(/^[\\/]+/, '');
    for (const part of relative.split(/[\\/]+/).filter(Boolean)) { const separator = document.createElement('span'); separator.textContent = '›'; separator.className = 'crumb-separator'; holder.append(separator); cursor = joinPath(cursor, part); add(part, cursor); }
  }
  function updateActions() {
    byId('managerSelectedCount').textContent = `已选择 ${selected.size} 项`;
    byId('managerMove').disabled = selected.size === 0 || !target;
    byId('managerChooseTarget').disabled = !root;
    byId('managerCreateFolder').disabled = !target;
    byId('managerUseCurrent').disabled = !current;
    byId('managerDualCreateFolder').disabled = !dualRightCurrent;
    byId('managerDualCreateLeft').disabled = !dualLeftCurrent;
    byId('managerDualMoveRight').disabled = dualLeftSelected.size === 0 || !dualRightCurrent;
    byId('managerDualMoveLeft').disabled = dualRightSelected.size === 0 || !dualLeftCurrent;
    byId('managerDualTrashLeft').disabled = dualLeftSelected.size === 0;
    byId('managerDualTrashRight').disabled = dualRightSelected.size === 0;
    byId('managerDualClearLeft').disabled = dualLeftSelected.size === 0;
    byId('managerDualClearRight').disabled = dualRightSelected.size === 0;
    byId('managerDualCountLeft').textContent = `已选 ${dualLeftSelected.size} 项`;
    byId('managerDualCountRight').textContent = `已选 ${dualRightSelected.size} 项`;
    const undoable = history.find(batch => batch.items.some(item => item.status === 'moved'));
    byId('managerUndo').disabled = !undoable; byId('managerUndo').dataset.batchId = undoable?.id || '';
    byId('managerDualUndo').disabled = !undoable;
    byId('managerTargetLabel').textContent = target || '尚未选择目标文件夹';
    updateNavigation();
  }
  function updateNavigation() {
    byId('managerSourceBack').disabled = sourceBack.length === 0;
    byId('managerSourceForward').disabled = sourceForward.length === 0;
    byId('managerSourceUp').disabled = !sourceParent;
    byId('managerTargetBack').disabled = targetBack.length === 0;
    byId('managerTargetForward').disabled = targetForward.length === 0;
    byId('managerTargetUp').disabled = !targetParent;
    byId('managerDualSourceBack').disabled = dualLeftBack.length === 0;
    byId('managerDualSourceForward').disabled = dualLeftForward.length === 0;
    byId('managerDualSourceUp').disabled = !dualLeftParent;
    byId('managerTargetBack').disabled = targetBack.length === 0;
    byId('managerTargetForward').disabled = targetForward.length === 0;
    byId('managerTargetUp').disabled = !targetParent;
  }
  function setStatus(message) { byId('managerStatus').textContent = message; byId('managerDualStatus').textContent = message; }
  function showError(error) { setStatus(`操作未完成：${error.message}`); }

  async function loadFolder(folder) {
    const request = ++folderGeneration;
    try {
      const result = await window.tidy.managerReadFolder(folder);
      if (request !== folderGeneration) return;
      root = result.root; current = result.current; sourceParent = result.parent; items = result.items; selected.clear();
      byId('managerRootLabel').textContent = root;
      byId('managerStatus').textContent = `${baseName(current)}：${items.length} 个文件或子文件夹${result.skipped ? ` · ${result.skipped} 个链接或无权限项目已略过` : ''}。`;
      renderBreadcrumb(); renderItems(); updateActions();
    } catch (error) { showError(error); }
  }

  async function navigateSource(folder, direction = 'push') {
    if (!folder || samePath(folder, current)) return;
    if (direction === 'push') { if (current) sourceBack.push(current); sourceForward.length = 0; }
    else if (direction === 'back') sourceForward.push(current);
    else if (direction === 'forward') sourceBack.push(current);
    await loadFolder(folder); updateNavigation();
  }
  async function sourceBackOnce() { const folder = sourceBack.pop(); if (folder) await navigateSource(folder, 'back'); }
  async function sourceForwardOnce() { const folder = sourceForward.pop(); if (folder) await navigateSource(folder, 'forward'); }

  function resetDualPanes() {
    dualLeftRoot = null; dualLeftCurrent = null; dualLeftParent = null; dualLeftItems = [];
    dualRightRoot = null; dualRightCurrent = null; targetParent = null; targetItems = [];
    dualLeftBack.length = 0; dualLeftForward.length = 0; targetBack.length = 0; targetForward.length = 0;
    dualLeftSelected.clear(); dualRightSelected.clear();
    clearPaneSearch('left', false); clearPaneSearch('right', false);
    renderPaneBreadcrumb('left', null); renderPaneBreadcrumb('right', null);
    byId('managerDualSourceList').innerHTML = '<p class="search-empty">选择左侧位置后显示内容。</p>';
    byId('managerDualTargetList').innerHTML = '<p class="search-empty">选择右侧位置后显示内容。</p>';
    setStatus('请分别为左、右窗格选择文件夹。'); updateActions();
  }
  async function loadDualPane(side, folder) {
    const generation = side === 'left' ? ++dualLeftGeneration : ++targetGeneration;
    try {
      const result = await window.tidy.managerPaneReadFolder(side, folder);
      if (generation !== (side === 'left' ? dualLeftGeneration : targetGeneration)) return;
      if (side === 'left') {
        dualLeftRoot = result.root; dualLeftCurrent = result.current; dualLeftParent = result.parent; dualLeftItems = result.items;
        renderPaneBreadcrumb('left', result.current);
      } else {
        dualRightRoot = result.root; dualRightCurrent = result.current; targetParent = result.parent; targetItems = result.items;
        renderPaneBreadcrumb('right', result.current);
      }
      if (side === 'left' ? dualLeftQuery : dualRightQuery) await runPaneSearch(side);
      else renderDualItems(side);
      updateActions();
    } catch (error) { showError(error); }
  }
  async function chooseDualPane(side) {
    try {
      const start = side === 'left' ? dualLeftCurrent : dualRightCurrent;
      const chosen = await window.tidy.managerPaneChooseFolder(side, start);
      if (!chosen) return;
      clearPaneSearch(side, false);
      if (side === 'left') { dualLeftBack.length = 0; dualLeftForward.length = 0; dualLeftSelected.clear(); }
      else { targetBack.length = 0; targetForward.length = 0; dualRightSelected.clear(); }
      await loadDualPane(side, chosen);
    } catch (error) { showError(error); }
  }
  async function navigateDual(side, folder, direction = 'push') {
    const currentPath = side === 'left' ? dualLeftCurrent : dualRightCurrent;
    const back = side === 'left' ? dualLeftBack : targetBack; const forward = side === 'left' ? dualLeftForward : targetForward;
    if (!folder || samePath(folder, currentPath)) return;
    if (direction === 'push') { if (currentPath) back.push(currentPath); forward.length = 0; }
    else if (direction === 'back') forward.push(currentPath);
    else if (direction === 'forward') back.push(currentPath);
    clearPaneSearch(side, false); await loadDualPane(side, folder); updateNavigation();
  }
  async function navigateDualBack(side) { const stack = side === 'left' ? dualLeftBack : targetBack; const folder = stack.pop(); if (folder) await navigateDual(side, folder, 'back'); }
  async function navigateDualForward(side) { const stack = side === 'left' ? dualLeftForward : targetForward; const folder = stack.pop(); if (folder) await navigateDual(side, folder, 'forward'); }
  function draggedItems(event) { try { const value = JSON.parse(event.dataTransfer.getData('application/x-file-manager-items')); return value && Array.isArray(value.paths) ? value : null; } catch { return null; } }
  function renderDualItems(side) {
    const left = side === 'left', list = byId(left ? 'managerDualSourceList' : 'managerDualTargetList');
    const query = left ? dualLeftQuery : dualRightQuery;
    const content = query ? (left ? dualLeftSearchResults : dualRightSearchResults) || [] : left ? dualLeftItems : targetItems;
    const selection = left ? dualLeftSelected : dualRightSelected;
    list.replaceChildren();
    if (!(left ? dualLeftCurrent : dualRightCurrent)) { list.innerHTML = '<p class="search-empty">先选择此窗格要浏览的文件夹。</p>'; return; }
    if (!content.length) { const empty = document.createElement('p'); empty.className = 'search-empty'; empty.textContent = query ? `没有找到名称包含“${query}”的项目。` : '此文件夹为空。'; list.append(empty); updateDualSelectAll(side); return; }
    for (const item of content) {
      const row = document.createElement('article'); row.className = `manager-item manager-target-item ${item.type}`; row.draggable = true; row.dataset.path = item.path;
      const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.className = 'manager-check'; checkbox.checked = selection.has(item.path); checkbox.setAttribute('aria-label', `选择 ${item.name}`);
      checkbox.onchange = () => { checkbox.checked ? selection.add(item.path) : selection.delete(item.path); updateActions(); updateDualSelectAll(side); };
      const icon = document.createElement('span'); icon.className = 'manager-kind'; icon.textContent = item.type === 'directory' ? '▰' : (item.name.split('.').pop().toUpperCase() || 'FILE');
      const details = document.createElement('div'); details.className = 'manager-item-details';
      const name = item.type === 'directory' ? document.createElement('button') : document.createElement('strong');
      if (item.type === 'directory') { name.className = 'manager-open'; name.textContent = item.name; name.onclick = () => navigateDual(side, item.path); }
      else name.textContent = item.name;
      const metadata = document.createElement('small'); metadata.textContent = `${item.type === 'directory' ? '文件夹' : `${(item.size / 1024).toFixed(1)} KB`} · 修改于 ${new Date(item.modifiedAt).toLocaleString('zh-CN')}${query && item.relativePath ? ` · ${item.relativePath}` : ''}`;
      details.append(name, metadata); row.append(checkbox, icon, details);
      const actions = document.createElement('div'); actions.className = 'manager-row-actions';
      if (item.type === 'file') { const open = document.createElement('button'); open.className = 'ghost'; open.textContent = '打开'; open.onclick = () => window.tidy.managerPaneOpen(side, item.path).catch(showError); actions.append(open); }
      const rename = document.createElement('button'); rename.className = 'ghost'; rename.textContent = '重命名'; rename.onclick = () => openRename(side, item); actions.append(rename);
      const trash = document.createElement('button'); trash.className = 'ghost danger'; trash.textContent = '删除'; trash.onclick = () => trashPaneItems(side, [item.path]); actions.append(trash);
      row.append(actions);
      row.addEventListener('dragstart', event => { const paths = selection.has(item.path) ? [...selection] : [item.path]; event.dataTransfer.setData('application/x-file-manager-items', JSON.stringify({ side, paths })); event.dataTransfer.effectAllowed = 'move'; });
      if (item.type === 'directory') {
        row.addEventListener('dragover', event => { if (event.dataTransfer.types.includes('application/x-file-manager-items')) { event.preventDefault(); row.classList.add('drop-target'); } });
        row.addEventListener('dragleave', () => row.classList.remove('drop-target'));
        row.addEventListener('drop', event => { event.preventDefault(); event.stopPropagation(); row.classList.remove('drop-target'); const drag = draggedItems(event); if (drag) moveBetween(drag.side, left ? 'left' : 'right', drag.paths, item.path); });
      }
      list.append(row);
    }
    updateDualSelectAll(side); updateActions();
  }
  async function runPaneSearch(side) {
    const left = side === 'left'; const input = byId(left ? 'managerPaneSearchLeft' : 'managerPaneSearchRight');
    const meta = byId(left ? 'managerPaneSearchMetaLeft' : 'managerPaneSearchMetaRight');
    const clear = byId(left ? 'managerPaneSearchClearLeft' : 'managerPaneSearchClearRight');
    const query = input.value.trim();
    if (left) { dualLeftQuery = query; dualLeftSearchResults = null; }
    else { dualRightQuery = query; dualRightSearchResults = null; }
    clear.hidden = !query;
    const generation = left ? ++dualLeftSearchGeneration : ++dualRightSearchGeneration;
    if (!query) { meta.textContent = ''; renderDualItems(side); return; }
    const folder = left ? dualLeftCurrent : dualRightCurrent;
    if (!folder) { meta.textContent = '先选择文件夹'; return; }
    meta.textContent = '正在搜索…';
    try {
      const result = await window.tidy.managerPaneSearch(side, folder, query);
      if (generation !== (left ? dualLeftSearchGeneration : dualRightSearchGeneration)) return;
      if (left) dualLeftSearchResults = result.items; else dualRightSearchResults = result.items;
      meta.textContent = `找到 ${result.items.length} 项${result.truncated ? ' · 已达到搜索上限，请缩小范围' : ''}`;
      renderDualItems(side);
    } catch (error) { meta.textContent = error.message; showError(error); }
  }
  function clearPaneSearch(side, render = true) {
    const left = side === 'left'; const input = byId(left ? 'managerPaneSearchLeft' : 'managerPaneSearchRight');
    if (left) { dualLeftQuery = ''; dualLeftSearchResults = null; dualLeftSearchGeneration++; clearTimeout(dualLeftSearchTimer); }
    else { dualRightQuery = ''; dualRightSearchResults = null; dualRightSearchGeneration++; clearTimeout(dualRightSearchTimer); }
    input.value = ''; byId(left ? 'managerPaneSearchClearLeft' : 'managerPaneSearchClearRight').hidden = true;
    byId(left ? 'managerPaneSearchMetaLeft' : 'managerPaneSearchMetaRight').textContent = '';
    if (render) renderDualItems(side);
  }
  function updateDualSelectAll(side) {
    const left = side === 'left'; const list = byId(left ? 'managerDualSourceList' : 'managerDualTargetList');
    const selectAll = byId(left ? 'managerDualSelectAllLeft' : 'managerDualSelectAllRight');
    const checks = [...list.querySelectorAll('.manager-check')];
    selectAll.checked = checks.length > 0 && checks.every(check => check.checked);
    selectAll.indeterminate = checks.some(check => check.checked) && !selectAll.checked;
  }
  async function moveBetween(fromSide, toSide, paths, destination) {
    if (!paths.length || !destination || fromSide === toSide) return;
    const names = paths.map(filePath => filePath.split(/[\\/]/).pop()); const summary = names.slice(0, 3).join('、') + (names.length > 3 ? ` 等 ${names.length} 项` : '');
    if (!confirm(`将 ${summary} 移动到“${destination}”吗？目标同名项目不会覆盖。跨磁盘时先复制并校验，再删除原件。`)) return;
    setStatus(`正在从${fromSide === 'left' ? '左' : '右'}侧移动 ${paths.length} 项…`);
    try {
      const batch = await window.tidy.managerMoveBetween(paths, destination, fromSide, toSide);
      const moved = batch.items.filter(item => item.status === 'moved'); const failed = batch.items.filter(item => item.status !== 'moved');
      const selection = fromSide === 'left' ? dualLeftSelected : dualRightSelected; moved.forEach(item => selection.delete(item.source));
      await refreshHistory();
      await Promise.all([loadDualPane('left', dualLeftCurrent), loadDualPane('right', dualRightCurrent)]);
      setStatus(`已移动 ${moved.length} 项${failed.length ? `；未完成：${failed.map(item => `${item.name}（${item.error}）`).join('；')}` : ''}。`);
    } catch (error) { showError(error); }
  }
  async function trashPaneItems(side, paths) {
    const names = paths.map(itemPath => itemPath.split(/[\\/]/).pop()).slice(0, 3).join('、');
    if (!paths.length || !confirm(`将 ${names}${paths.length > 3 ? ` 等 ${paths.length} 项` : ''}移入 Windows 回收站？之后可从回收站恢复。`)) return;
    try {
      const result = await window.tidy.managerPaneTrash(side, paths);
      const selection = side === 'left' ? dualLeftSelected : dualRightSelected; result.trashed.forEach(item => selection.delete(item.source));
      await loadDualPane(side, side === 'left' ? dualLeftCurrent : dualRightCurrent);
      setStatus(`已移入回收站 ${result.trashed.length} 项${result.failed.length ? `；未能删除：${result.failed.map(item => `${item.name}（${item.error}）`).join('；')}` : ''}。`);
    } catch (error) { showError(error); }
  }
  function openRename(side, item) {
    renameContext = { side, item };
    byId('managerRenameName').value = item.name;
    byId('managerRenameHint').textContent = `当前名称：${item.name}`;
    byId('managerRenameDialog').showModal(); byId('managerRenameName').focus(); byId('managerRenameName').select();
  }
  function openCreatePaneFolder(side) {
    createPaneSide = side;
    const parent = side === 'left' ? dualLeftCurrent : dualRightCurrent;
    byId('managerFolderName').value = '';
    byId('managerFolderHint').textContent = `将在${side === 'left' ? '左' : '右'}侧当前位置下创建：${parent || ''}`;
    byId('managerFolderDialog').showModal(); byId('managerFolderName').focus();
  }
  async function refreshHistory() { history = await window.tidy.managerState().then(state => state.history || []); updateActions(); }

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
    const browse = document.createElement('button'); browse.className = 'tree-browse'; browse.textContent = '浏览'; browse.onclick = () => navigateSource(item.path);
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
      if (item.type === 'directory') { name.className = 'manager-open'; name.textContent = item.name; name.onclick = () => navigateSource(item.path); }
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
  function updateSelectAll() { const boxes = [...byId('managerList').querySelectorAll('.manager-check')]; byId('managerSelectAll').checked = boxes.length > 0 && boxes.every(box => box.checked); byId('managerSelectAll').indeterminate = boxes.some(box => box.checked) && !byId('managerSelectAll').checked; }
  function setTarget(folder) { target = folder; byId('managerTargetLabel').textContent = folder; renderTree(); updateActions(); }

  async function setManagerMode(mode) {
    if (mode !== 'dual' && fullscreenActive) await setFullscreen(false);
    managerGeneration++;
    managerMode = mode;
    const dual = mode === 'dual';
    byId('managerModeHint').textContent = dual ? '双栏：两侧都可打开、选择和管理；拖动方向决定移动方向。' : '单栏：浏览文件，在左侧树中选择移动目标。';
    byId('managerModeHelp').textContent = dual ? '两侧可独立选择位置。勾选后拖到另一侧或使用方向按钮移动；文件可打开、重命名，删除会进入回收站。' : '浏览来源并在文件夹树中选择目标；也可拖到文件夹。跨磁盘移动先复制校验，再删除原件。';
    syncManagerModeUI();
    if (dual) resetDualPanes();
    else if (root) { current = root; sourceBack.length = 0; sourceForward.length = 0; await loadTreeChildren(root); await loadFolder(current); renderTree(); }
    updateActions();
  }

  async function openManager(generation) {
    try {
      const state = await window.tidy.managerState();
      if (generation !== managerGeneration || byId('managerPanel').hidden) return;
      history = state.history || [];
      if (state.root) {
        const rootChanged = !samePath(root, state.root);
        root = state.root;
        if (rootChanged || !current || !isWithin(root, current)) { current = root; sourceBack.length = 0; sourceForward.length = 0; }
        if (!target) target = state.target || root;
        if (rootChanged) { expanded.clear(); children.clear(); expanded.add(root); }
        if (managerMode === 'single') { await loadTreeChildren(root); await loadFolder(current); renderTree(); }
        else byId('managerRootLabel').textContent = root;
      }
      else { root = null; current = null; sourceParent = null; target = null; targetParent = null; items = []; renderItems(); renderTree(); }
      updateActions();
    } catch (error) { showError(error); }
  }

  async function moveItems(paths, destination) {
    if (!paths.length || !destination) return;
    const names = paths.map(filePath => filePath.split(/[\\/]/).pop()); const summary = names.slice(0, 3).join('、') + (names.length > 3 ? ` 等 ${names.length} 项` : '');
    if (!confirm(`将 ${summary} 移动到“${destination}”吗？同名项目不会覆盖。跨磁盘时会先复制并校验，再删除原件，可能需要等待。`)) return;
    target = destination; updateActions();
    byId('managerStatus').textContent = `正在安全移动 ${paths.length} 项；跨磁盘时会先复制并校验…`; byId('managerMove').disabled = true;
    try {
      const batch = await window.tidy.managerMove(paths, destination); const moved = batch.items.filter(item => item.status === 'moved'); const failed = batch.items.filter(item => item.status !== 'moved');
      moved.forEach(item => selected.delete(item.source)); history = await window.tidy.managerState().then(state => state.history || []);
      const message = `已移动 ${moved.length} 项${failed.length ? `；另有项目未完成：${failed.map(item => `${item.name}（${item.error}）`).join('；')}` : ''}。`;
      children.clear(); expanded.clear(); expanded.add(root); await loadTreeChildren(root); await loadFolder(current); renderTree(); setStatus(message); updateActions();
    } catch (error) { showError(error); updateActions(); }
  }

  byId('tidyTab').onclick = () => setModule('tidy'); byId('searchTab').onclick = () => setModule('search'); byId('managerTab').onclick = () => setModule('manager'); byId('conversionTab').onclick = () => setModule('conversion');
  byId('managerSingleMode').onclick = () => setManagerMode('single');
  byId('managerDualMode').onclick = () => setManagerMode('dual');
  byId('managerFullscreenEnter').onclick = () => setFullscreen(true);
  byId('managerFullscreenExit').onclick = () => setFullscreen(false);
  window.tidy.onWindowFullscreenChanged(applyFullscreenState);
  window.tidy.windowFullscreenState().then(applyFullscreenState).catch(showError);
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && fullscreenActive) { event.preventDefault(); setFullscreen(false); }
    else if (event.key === 'F11' && managerMode === 'dual' && !byId('managerPanel').hidden) { event.preventDefault(); setFullscreen(!fullscreenActive); }
  });
  byId('managerSourceBack').onclick = sourceBackOnce;
  byId('managerSourceForward').onclick = sourceForwardOnce;
  byId('managerSourceUp').onclick = () => { if (sourceParent) navigateSource(sourceParent); };
  byId('managerTargetBack').onclick = () => navigateDualBack('right');
  byId('managerTargetForward').onclick = () => navigateDualForward('right');
  byId('managerTargetUp').onclick = () => { if (targetParent) navigateDual('right', targetParent); };
  byId('managerDualSourceBack').onclick = () => navigateDualBack('left');
  byId('managerDualSourceForward').onclick = () => navigateDualForward('left');
  byId('managerDualSourceUp').onclick = () => { if (dualLeftParent) navigateDual('left', dualLeftParent); };
  byId('managerPaneSearchLeft').oninput = () => { clearTimeout(dualLeftSearchTimer); dualLeftSearchTimer = setTimeout(() => runPaneSearch('left'), 250); };
  byId('managerPaneSearchRight').oninput = () => { clearTimeout(dualRightSearchTimer); dualRightSearchTimer = setTimeout(() => runPaneSearch('right'), 250); };
  byId('managerPaneSearchClearLeft').onclick = () => clearPaneSearch('left');
  byId('managerPaneSearchClearRight').onclick = () => clearPaneSearch('right');
  byId('managerChooseRoot').onclick = async () => {
    const generation = ++managerGeneration;
    try { const chosen = await window.tidy.managerChooseRoot(); if (!chosen || generation !== managerGeneration) return; root = chosen; current = root; sourceParent = null; sourceBack.length = 0; sourceForward.length = 0; target = target || root; selected.clear(); children.clear(); expanded.clear(); expanded.add(root); byId('managerTargetLabel').textContent = target; await loadTreeChildren(root); await loadFolder(root); renderTree(); }
    catch (error) { showError(error); }
  };
  byId('managerUseCurrent').onclick = () => { if (current) setTarget(current); };
  byId('managerChooseTarget').onclick = async () => {
    try {
      const chosen = await window.tidy.managerChooseTarget(target || root);
      if (chosen) { targetBack.length = 0; targetForward.length = 0; setTarget(chosen); byId('managerStatus').textContent = `已选择电脑中的目标位置：${chosen}`; }
    } catch (error) { showError(error); }
  };
  byId('managerDualChooseTarget').onclick = () => chooseDualPane('right');
  byId('managerDualChooseLeft').onclick = () => chooseDualPane('left');
  byId('managerDualCreateLeft').onclick = () => openCreatePaneFolder('left');
  byId('managerDualCreateFolder').onclick = () => openCreatePaneFolder('right');
  byId('managerDualUndo').onclick = () => byId('managerUndo').click();
  byId('managerDualMoveRight').onclick = () => moveBetween('left', 'right', [...dualLeftSelected], dualRightCurrent);
  byId('managerDualMoveLeft').onclick = () => moveBetween('right', 'left', [...dualRightSelected], dualLeftCurrent);
  byId('managerDualTrashLeft').onclick = () => trashPaneItems('left', [...dualLeftSelected]);
  byId('managerDualTrashRight').onclick = () => trashPaneItems('right', [...dualRightSelected]);
  byId('managerDualClearLeft').onclick = () => { dualLeftSelected.clear(); renderDualItems('left'); updateActions(); };
  byId('managerDualClearRight').onclick = () => { dualRightSelected.clear(); renderDualItems('right'); updateActions(); };
  byId('managerDualSelectAllLeft').onchange = () => { for (const item of dualLeftItems) byId('managerDualSelectAllLeft').checked ? dualLeftSelected.add(item.path) : dualLeftSelected.delete(item.path); renderDualItems('left'); };
  byId('managerDualSelectAllRight').onchange = () => { for (const item of targetItems) byId('managerDualSelectAllRight').checked ? dualRightSelected.add(item.path) : dualRightSelected.delete(item.path); renderDualItems('right'); };
  byId('managerSelectAll').onchange = () => { for (const item of items) byId('managerSelectAll').checked ? selected.add(item.path) : selected.delete(item.path); renderItems(); };
  byId('managerClearSelection').onclick = () => { selected.clear(); renderItems(); updateActions(); };
  byId('managerMove').onclick = () => moveItems([...selected], target);
  byId('managerCreateFolder').onclick = () => {
    createPaneSide = null;
    byId('managerFolderName').value = ''; byId('managerFolderHint').textContent = `将在当前目标文件夹下创建：${target || ''}`;
    byId('managerFolderDialog').showModal(); byId('managerFolderName').focus();
  };
  byId('managerFolderForm').onsubmit = async event => {
    event.preventDefault(); const name = byId('managerFolderName').value.trim();
    try {
      if (createPaneSide) {
        const side = createPaneSide; const parent = side === 'left' ? dualLeftCurrent : dualRightCurrent;
        await window.tidy.managerPaneCreateFolder(side, parent, name);
        byId('managerFolderDialog').close(); createPaneSide = null;
        await loadDualPane(side, parent); setStatus(`已在${side === 'left' ? '左' : '右'}侧创建文件夹“${name}”。`); return;
      }
      const folder = await window.tidy.managerCreateFolder(target, name);
      const parent = target;
      if (isWithin(root, parent)) { children.delete(parent); await loadTreeChildren(parent); expanded.add(parent); }
      target = folder;
      byId('managerFolderDialog').close(); renderTree(); updateActions();
      byId('managerStatus').textContent = `已在目标位置创建“${name}”，并设为当前移动目标。`;
    } catch (error) { byId('managerFolderHint').textContent = error.message; }
  };
  byId('closeManagerFolder').onclick = () => { createPaneSide = null; byId('managerFolderDialog').close(); };
  byId('cancelManagerFolder').onclick = () => { createPaneSide = null; byId('managerFolderDialog').close(); };
  byId('managerRenameForm').onsubmit = async event => {
    event.preventDefault(); if (!renameContext) return;
    const { side, item } = renameContext;
    try {
      const result = await window.tidy.managerPaneRename(side, item.path, byId('managerRenameName').value);
      byId('managerRenameDialog').close(); renameContext = null;
      if (result.status === 'moved') await refreshHistory();
      await loadDualPane(side, side === 'left' ? dualLeftCurrent : dualRightCurrent);
      setStatus(result.status === 'moved' ? `已重命名为“${result.destination.split(/[\\/]/).pop()}”，可撤销。` : '名称没有变化。');
    } catch (error) { byId('managerRenameHint').textContent = error.message; }
  };
  const closeRename = () => { renameContext = null; byId('managerRenameDialog').close(); };
  byId('closeManagerRename').onclick = closeRename; byId('cancelManagerRename').onclick = closeRename;
  byId('managerUndo').onclick = async () => {
    const batchId = byId('managerUndo').dataset.batchId; const batch = history.find(item => item.id === batchId); if (!batch) return;
    const count = batch.items.filter(item => item.status === 'moved').length;
    if (!confirm(`撤销最近一次可撤销的移动或重命名（${count} 项）吗？原位置已有同名项目时不会覆盖。删除的项目请从 Windows 回收站恢复。`)) return;
    try {
      const result = await window.tidy.managerUndo(batchId); history = history.map(item => item.id === result.id ? result : item);
      const undone = result.items.filter(item => item.status === 'undone').length; const failed = result.items.filter(item => item.status === 'undo_failed');
      const message = `已撤销 ${undone} 项${failed.length ? `；未能撤销：${failed.map(item => `${item.name}（${item.error}）`).join('；')}` : ''}。`;
      if (managerMode === 'dual') await Promise.all([loadDualPane('left', dualLeftCurrent), loadDualPane('right', dualRightCurrent)]);
      else { children.clear(); expanded.clear(); expanded.add(root); await loadTreeChildren(root); await loadFolder(current); renderTree(); }
      setStatus(message); updateActions();
    } catch (error) { showError(error); }
  };
  byId('managerTargetDropZone').addEventListener('dragover', event => { if (event.dataTransfer.types.includes('application/x-file-manager-items')) { event.preventDefault(); byId('managerTargetDropZone').classList.add('drop-target'); } });
  byId('managerTargetDropZone').addEventListener('dragleave', () => byId('managerTargetDropZone').classList.remove('drop-target'));
  byId('managerTargetDropZone').addEventListener('drop', event => { event.preventDefault(); byId('managerTargetDropZone').classList.remove('drop-target'); moveItems(parseDragged(event), target); });
  const enablePaneDrop = (element, toSide) => {
    element.addEventListener('dragover', event => { if (!event.target.closest('.manager-item') && event.dataTransfer.types.includes('application/x-file-manager-items')) { event.preventDefault(); element.classList.add('drop-target'); } });
    element.addEventListener('dragleave', event => { if (!element.contains(event.relatedTarget)) element.classList.remove('drop-target'); });
    element.addEventListener('drop', event => { if (event.target.closest('.manager-item')) return; event.preventDefault(); element.classList.remove('drop-target'); const drag = draggedItems(event); if (drag) moveBetween(drag.side, toSide, drag.paths, toSide === 'left' ? dualLeftCurrent : dualRightCurrent); });
  };
  enablePaneDrop(byId('managerDualSourceHost'), 'left');
  enablePaneDrop(byId('managerDualDestination'), 'right');
})();
