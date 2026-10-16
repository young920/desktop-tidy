(() => {
  const byId = id => document.getElementById(id);
  let folder = null, running = false, offset = 0, total = 0, query = {}, status = null;
  const selectedPaths = new Set();
  function describeIndex(index) {
    const partial = index.cancelled || index.limited;
    const folderCount = Number(index.folders) || 0;
    const legacyHint = index.folderIndexReady === false ? ' · 旧索引未包含文件夹名，请更新索引' : '';
    const freshness = index.incremental ? '增量更新' : '全量扫描';
    return `${partial ? '部分索引' : '索引就绪'} · ${freshness}：${index.files.toLocaleString()} 个文件 · ${folderCount.toLocaleString()} 个文件夹 · 范围 ${index.roots.join('、')} · ${index.errors || 0} 项无法访问${index.limited ? ' · 已到达扫描上限' : ''}${legacyHint} · 更新于 ${new Date(index.updatedAt).toLocaleString('zh-CN')}`;
  }
  function pageControls() {
    byId('previousResults').disabled = offset === 0;
    byId('nextResults').disabled = offset + 100 >= total;
    const pageCheckbox = byId('selectPage');
    pageCheckbox.checked = pageCheckbox.dataset.count !== '0' && [...document.querySelectorAll('.row-select')].length > 0 && [...document.querySelectorAll('.row-select')].every(checkbox => checkbox.checked);
    byId('trashSelected').disabled = selectedPaths.size === 0;
    byId('trashSelected').textContent = `移入回收站（${selectedPaths.size}）`;
  }
  async function showResults() {
    try {
      const result = await window.tidy.searchQuery({ ...query, offset, limit: 100 });
      total = result.total;
      const folderCount = result.items.filter(item => item.type === 'directory').length;
      const fileCount = result.items.length - folderCount;
      byId('resultCount').textContent = `找到 ${total.toLocaleString()} 个结果 · 本页 ${fileCount} 个文件、${folderCount} 个文件夹${total ? ` · 显示 ${offset + 1}–${Math.min(offset + 100, total)}` : ''}${status?.cancelled || status?.limited ? '（部分索引）' : ''}`;
      const list = byId('searchResults'); list.replaceChildren();
      if (!result.items.length) { list.innerHTML = '<p class="search-empty">没有匹配的文件或文件夹。可减少筛选条件，或更换搜索范围后更新索引。</p>'; }
      for (const file of result.items) {
        const isFolder = file.type === 'directory';
        const row = document.createElement('article'); row.className = `search-result${isFolder ? ' search-folder-result' : ''}`;
        if (isFolder) { const spacer = document.createElement('span'); spacer.className = 'search-folder-spacer'; row.append(spacer); }
        else {
          const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.className = 'row-select'; checkbox.checked = selectedPaths.has(file.path); checkbox.setAttribute('aria-label', `选择文件 ${file.name}`);
          checkbox.onchange = () => { checkbox.checked ? selectedPaths.add(file.path) : selectedPaths.delete(file.path); pageControls(); }; row.append(checkbox);
        }
        const badge = document.createElement('span'); badge.className = 'file-type'; badge.textContent = isFolder ? '文件夹' : (file.extension.toUpperCase() || 'FILE');
        const detail = document.createElement('div'); const name = document.createElement('strong'); name.textContent = file.name;
        const filePath = document.createElement('p'); filePath.className = 'file-path'; filePath.textContent = file.path;
        const dates = document.createElement('small'); dates.textContent = isFolder ? `文件夹 · 创建 ${new Date(file.createdAt).toLocaleString('zh-CN')} · 修改 ${new Date(file.modifiedAt).toLocaleString('zh-CN')}` : `创建 ${new Date(file.createdAt).toLocaleString('zh-CN')} · 修改 ${new Date(file.modifiedAt).toLocaleString('zh-CN')} · ${(file.size / 1024).toFixed(1)} KB`;
        detail.append(name, filePath, dates);
        const actions = document.createElement('div'); actions.className = 'result-buttons';
        const buttons = isFolder ? [['打开文件夹', 'searchOpen'], ['定位位置', 'searchReveal']] : [['打开文件', 'searchOpen'], ['定位文件夹', 'searchReveal']];
        for (const [label, method] of buttons) {
          const button = document.createElement('button'); button.className = 'ghost'; button.textContent = label;
          button.onclick = async () => { try { await window.tidy[method](file.path); } catch (error) { byId('resultCount').textContent = error.message; } };
          actions.append(button);
        }
        row.append(badge, detail, actions); list.append(row);
      }
      byId('selectPage').dataset.count = String(result.items.length);
      pageControls();
    } catch (error) { byId('resultCount').textContent = error.message; }
  }
  function switchPanel(search) {
    byId('tidyPanel').hidden = search; byId('searchPanel').hidden = !search;
    byId('tidyTab').setAttribute('aria-pressed', String(!search)); byId('searchTab').setAttribute('aria-pressed', String(search));
    byId('managerPanel').hidden = true; byId('managerTab').setAttribute('aria-pressed', 'false');
    byId('scanBtn').hidden = search; byId('resetBtn').hidden = search || !plan;
    if (search) { const topics = byId('searchTopics'); topics.replaceChildren(); for (const rule of state?.rules || []) { const option = document.createElement('option'); option.value = rule.name; topics.append(option); } }
  }
  byId('tidyTab').onclick = () => switchPanel(false); byId('searchTab').onclick = () => switchPanel(true);
  byId('searchScope').onchange = () => { byId('indexStatus').textContent = '搜索范围已改变；执行增量更新时会因范围不同而全量建立此范围的索引，现有结果仍来自上一次索引。'; };
  byId('chooseSearchFolder').onclick = async () => { try { const selected = await window.tidy.searchChooseFolder(); if (selected) { folder = selected; byId('searchScope').value = 'folder'; byId('searchFolder').textContent = folder; byId('indexStatus').textContent = '已选择文件夹；增量更新会因范围不同而首次全量扫描该文件夹。'; } } catch (error) { byId('indexStatus').textContent = error.message; } };
  async function runIndexUpdate(mode) {
    if (running) return;
    if (byId('searchScope').value === 'folder' && !folder) { byId('indexStatus').textContent = '请先选择目标文件夹。'; return; }
    if (mode === 'full' && status?.updatedAt && !confirm('全量重建会重新扫描整个所选范围，文件较多时可能需要较长时间。继续吗？')) return;
    running = true; byId('refreshIndex').disabled = true; byId('fullRebuildIndex').disabled = true; byId('stopIndex').hidden = false; byId('searchScope').disabled = true; byId('chooseSearchFolder').disabled = true;
    byId('indexStatus').textContent = mode === 'full' ? '正在全量重建索引…' : (status?.updatedAt ? '正在增量更新索引；会检查目录变化并跳过未变化文件的元数据…' : '首次使用需要全量建立索引，可能需要几分钟…');
    try {
      status = await window.tidy.searchScan(byId('searchScope').value === 'folder' ? folder : null, mode);
      const modeNote = status.incremental ? `增量更新完成：检查 ${status.directories} 个目录，跳过 ${status.incrementalStats?.skippedDirectories || 0} 个未变化目录及 ${status.incrementalStats?.skippedFileStats || 0} 个未变化文件的元数据检查。` : status.fullScanFallback ? '当前索引缺少增量快照或搜索范围已改变，已自动全量重建。' : '全量重建完成。';
      byId('indexStatus').textContent = `${modeNote} ${describeIndex(status)}`; offset = 0; await showResults();
    }
    catch (error) { byId('indexStatus').textContent = `扫描失败：${error.message}`; }
    finally { running = false; byId('refreshIndex').disabled = false; byId('fullRebuildIndex').disabled = false; byId('stopIndex').hidden = true; byId('searchScope').disabled = false; byId('chooseSearchFolder').disabled = false; }
  }
  byId('refreshIndex').onclick = () => runIndexUpdate('incremental');
  byId('fullRebuildIndex').onclick = () => runIndexUpdate('full');
  byId('stopIndex').onclick = async () => { await window.tidy.searchCancel(); byId('indexStatus').textContent = '正在停止扫描，已扫描文件会保留在部分索引中…'; };
  window.tidy.onSearchProgress(progress => { byId('indexStatus').textContent = `${progress.incremental ? '正在增量更新' : '正在全量扫描'} · ${progress.files.toLocaleString()} 个文件 · ${Number(progress.folders || 0).toLocaleString()} 个文件夹 · ${progress.errors} 项无法访问 · ${progress.currentPath}`; });
  byId('searchForm').onsubmit = event => { event.preventDefault(); query = { topic: byId('searchTopic').value, keywords: byId('searchKeywords').value, formats: byId('searchFormats').value, dateField: byId('searchDateField').value, from: byId('searchFrom').value, to: byId('searchTo').value }; offset = 0; showResults(); };
  byId('clearSearch').onclick = () => { byId('searchForm').reset(); query = {}; offset = 0; showResults(); };
  byId('selectPage').onchange = () => { for (const checkbox of document.querySelectorAll('.row-select')) { checkbox.checked = byId('selectPage').checked; const row = checkbox.closest('.search-result'); const filePath = row?.querySelector('.file-path')?.textContent; if (filePath) checkbox.checked ? selectedPaths.add(filePath) : selectedPaths.delete(filePath); } pageControls(); };
  byId('trashSelected').onclick = async () => {
    const paths = [...selectedPaths]; if (!paths.length) return;
    const noun = paths.length === 1 ? '1 个文件' : `${paths.length} 个文件`;
    if (!confirm(`确定把选中的 ${noun} 移入 Windows 回收站吗？你可以之后从回收站恢复。`)) return;
    byId('trashSelected').disabled = true;
    try {
      const result = await window.tidy.searchTrash(paths);
      result.moved.forEach(filePath => selectedPaths.delete(filePath));
      status = await window.tidy.searchStatus();
      byId('indexStatus').textContent = describeIndex(status);
      byId('resultCount').textContent = result.failed.length ? `已移入回收站 ${result.moved.length} 个；未处理：${result.failed.map(item => `${item.path.split(/[\\/]/).pop()}（${item.reason}）`).join('；')}` : `已将 ${result.moved.length} 个文件移入回收站，可从 Windows 回收站恢复。`;
      await showResults();
    } catch (error) { byId('resultCount').textContent = `移入回收站失败：${error.message}`; byId('trashSelected').disabled = false; }
  };
  byId('previousResults').onclick = () => { selectedPaths.clear(); offset = Math.max(0, offset - 100); showResults(); }; byId('nextResults').onclick = () => { selectedPaths.clear(); offset += 100; showResults(); };
  window.tidy.searchStatus().then(index => { status = index; if (index.updatedAt) { byId('indexStatus').textContent = describeIndex(index); if (index.roots.length === 1) { folder = index.roots[0]; byId('searchFolder').textContent = folder; } } }).catch(error => { byId('indexStatus').textContent = error.message; });
})();
