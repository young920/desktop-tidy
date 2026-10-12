(() => {
  const byId = id => document.getElementById(id);
  let folder = null, running = false, offset = 0, total = 0, query = {}, status = null;
  function describeIndex(index) {
    const partial = index.cancelled || index.limited;
    return `${partial ? '部分索引' : '索引就绪'}：${index.files.toLocaleString()} 个文件 · 范围 ${index.roots.join('、')} · ${index.errors || 0} 项无法访问${index.limited ? ' · 已到达 50 万文件上限' : ''} · 更新于 ${new Date(index.updatedAt).toLocaleString('zh-CN')}`;
  }
  function pageControls() {
    byId('previousResults').disabled = offset === 0;
    byId('nextResults').disabled = offset + 100 >= total;
  }
  async function showResults() {
    try {
      const result = await window.tidy.searchQuery({ ...query, offset, limit: 100 });
      total = result.total;
      byId('resultCount').textContent = `找到 ${total.toLocaleString()} 个文件${total ? ` · 显示 ${offset + 1}–${Math.min(offset + 100, total)}` : ''}${status?.cancelled || status?.limited ? '（部分索引）' : ''}`;
      const list = byId('searchResults'); list.replaceChildren();
      if (!result.items.length) { list.innerHTML = '<p class="search-empty">没有匹配的文件。可减少筛选条件，或更换搜索范围后更新索引。</p>'; }
      for (const file of result.items) {
        const row = document.createElement('article'); row.className = 'search-result';
        const badge = document.createElement('span'); badge.className = 'file-type'; badge.textContent = file.extension.toUpperCase() || 'FILE';
        const detail = document.createElement('div'); const name = document.createElement('strong'); name.textContent = file.name;
        const filePath = document.createElement('p'); filePath.className = 'file-path'; filePath.textContent = file.path;
        const dates = document.createElement('small'); dates.textContent = `创建 ${new Date(file.createdAt).toLocaleString('zh-CN')} · 修改 ${new Date(file.modifiedAt).toLocaleString('zh-CN')} · ${(file.size / 1024).toFixed(1)} KB`;
        detail.append(name, filePath, dates);
        const actions = document.createElement('div'); actions.className = 'result-buttons';
        for (const [label, method] of [['打开文件', 'searchOpen'], ['定位文件夹', 'searchReveal']]) {
          const button = document.createElement('button'); button.className = 'ghost'; button.textContent = label;
          button.onclick = async () => { try { await window.tidy[method](file.path); } catch (error) { byId('resultCount').textContent = error.message; } };
          actions.append(button);
        }
        row.append(badge, detail, actions); list.append(row);
      }
      pageControls();
    } catch (error) { byId('resultCount').textContent = error.message; }
  }
  function switchPanel(search) {
    byId('tidyPanel').hidden = search; byId('searchPanel').hidden = !search;
    byId('tidyTab').setAttribute('aria-pressed', String(!search)); byId('searchTab').setAttribute('aria-pressed', String(search));
    byId('scanBtn').hidden = search; byId('resetBtn').hidden = search || !plan;
    if (search) { const topics = byId('searchTopics'); topics.replaceChildren(); for (const rule of state?.rules || []) { const option = document.createElement('option'); option.value = rule.name; topics.append(option); } }
  }
  byId('tidyTab').onclick = () => switchPanel(false); byId('searchTab').onclick = () => switchPanel(true);
  byId('searchScope').onchange = () => { byId('indexStatus').textContent = '搜索范围已改变，点击「建立 / 更新索引」后生效；当前结果来自上一次索引。'; };
  byId('chooseSearchFolder').onclick = async () => { try { const selected = await window.tidy.searchChooseFolder(); if (selected) { folder = selected; byId('searchScope').value = 'folder'; byId('searchFolder').textContent = folder; byId('indexStatus').textContent = '已选择文件夹，点击「建立 / 更新索引」后生效。'; } } catch (error) { byId('indexStatus').textContent = error.message; } };
  byId('refreshIndex').onclick = async () => {
    if (running) return;
    if (byId('searchScope').value === 'folder' && !folder) { byId('indexStatus').textContent = '请先选择目标文件夹。'; return; }
    running = true; byId('refreshIndex').disabled = true; byId('stopIndex').hidden = false; byId('searchScope').disabled = true; byId('chooseSearchFolder').disabled = true;
    byId('indexStatus').textContent = '正在建立索引，首次全电脑扫描可能需要几分钟…';
    try { status = await window.tidy.searchScan(byId('searchScope').value === 'folder' ? folder : null); byId('indexStatus').textContent = describeIndex(status); offset = 0; await showResults(); }
    catch (error) { byId('indexStatus').textContent = `扫描失败：${error.message}`; }
    finally { running = false; byId('refreshIndex').disabled = false; byId('stopIndex').hidden = true; byId('searchScope').disabled = false; byId('chooseSearchFolder').disabled = false; }
  };
  byId('stopIndex').onclick = async () => { await window.tidy.searchCancel(); byId('indexStatus').textContent = '正在停止扫描，已扫描文件会保留在部分索引中…'; };
  window.tidy.onSearchProgress(progress => { byId('indexStatus').textContent = `正在扫描 · ${progress.files.toLocaleString()} 个文件 · ${progress.directories} 个文件夹 · ${progress.errors} 项无法访问 · ${progress.currentPath}`; });
  byId('searchForm').onsubmit = event => { event.preventDefault(); query = { topic: byId('searchTopic').value, keywords: byId('searchKeywords').value, formats: byId('searchFormats').value, dateField: byId('searchDateField').value, from: byId('searchFrom').value, to: byId('searchTo').value }; offset = 0; showResults(); };
  byId('clearSearch').onclick = () => { byId('searchForm').reset(); query = {}; offset = 0; showResults(); };
  byId('previousResults').onclick = () => { offset = Math.max(0, offset - 100); showResults(); }; byId('nextResults').onclick = () => { offset += 100; showResults(); };
  window.tidy.searchStatus().then(index => { status = index; if (index.updatedAt) { byId('indexStatus').textContent = describeIndex(index); if (index.roots.length === 1) { folder = index.roots[0]; byId('searchFolder').textContent = folder; } } }).catch(error => { byId('indexStatus').textContent = error.message; });
})();
