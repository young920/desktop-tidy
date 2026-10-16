(() => {
  const byId = id => document.getElementById(id);
  const selected = new Set();
  let root = null, current = null, parent = null, items = [], previewItem = null, latestOutput = null, previewGeneration = 0, pdfjsPromise = null, optionsGeneration = 0;
  const supportedPreview = new Set(['pdf', 'png', 'jpg', 'jpeg']);
  const ext = name => (name.split('.').pop() || '').toLowerCase();
  const bytesLabel = size => size == null ? '—' : size < 1024 * 1024 ? `${(size / 1024).toFixed(1)} KB` : `${(size / 1024 / 1024).toFixed(1)} MB`;
  const samePath = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
  function setStatus(message, isError = false) { const status = byId('conversionStatus'); status.textContent = message; status.classList.toggle('error', isError); }
  function baseName(folder) { return folder.split(/[\\/]/).filter(Boolean).pop() || folder; }
  function joinPath(folder, name) { return `${folder.replace(/[\\/]$/, '')}\\${name}`; }
  function clearPreview() {
    const box = byId('conversionPreview'); box.replaceChildren();
    const empty = document.createElement('div'); empty.className = 'conversion-preview-empty';
    const icon = document.createElement('span'); icon.textContent = '◫';
    const title = document.createElement('strong'); title.textContent = '选择一个图片或 PDF 文件';
    const note = document.createElement('p'); note.textContent = '图片可直接预览；PDF 显示首页预览。Office 文档显示文件信息。';
    empty.append(icon, title, note); box.append(empty);
    byId('conversionPreviewName').textContent = '尚未选择文件'; byId('conversionPreviewMeta').textContent = '选择文件后可查看预览与转换选项。';
    byId('conversionOpenSource').disabled = true;
  }
  function renderBreadcrumb() {
    const holder = byId('conversionBreadcrumb'); holder.replaceChildren();
    if (!root || !current) return;
    const add = (label, destination, isCurrent) => {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'crumb'; button.textContent = label; button.title = destination;
      if (isCurrent) button.setAttribute('aria-current', 'location');
      button.onclick = () => void loadFolder(destination); holder.append(button);
    };
    add(`${baseName(root)} · 已选范围`, root, samePath(root, current));
    const relative = current.slice(root.length).replace(/^[\\/]+/, ''); let cursor = root;
    for (const part of relative.split(/[\\/]+/).filter(Boolean)) {
      const separator = document.createElement('span'); separator.className = 'crumb-separator'; separator.textContent = '›'; holder.append(separator);
      cursor = joinPath(cursor, part); add(part, cursor, samePath(cursor, current));
    }
  }
  function renderList() {
    const list = byId('conversionList'); list.replaceChildren();
    if (!current) { list.innerHTML = '<p class="search-empty">选择文件夹后，这里会显示其中的文件。</p>'; return; }
    if (!items.length) { list.innerHTML = '<p class="search-empty">此文件夹为空。可以进入子文件夹，或选择其他位置。</p>'; return; }
    for (const item of items) {
      const row = document.createElement('article'); row.className = `conversion-file-row ${item.type}`; row.dataset.path = item.path;
      if (item.type === 'file') {
        const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = selected.has(item.path); checkbox.setAttribute('aria-label', `选择 ${item.name}`);
        checkbox.onchange = () => { checkbox.checked ? selected.add(item.path) : selected.delete(item.path); void updateTargets(); renderListTools(); };
        row.append(checkbox);
      } else { const spacer = document.createElement('span'); spacer.className = 'conversion-row-spacer'; row.append(spacer); }
      const icon = document.createElement('span'); icon.className = 'conversion-file-icon'; icon.textContent = item.type === 'directory' ? '▰' : (ext(item.name).toUpperCase() || 'FILE');
      const details = document.createElement('div'); details.className = 'conversion-file-details';
      const name = document.createElement('button'); name.type = 'button'; name.className = 'conversion-file-name'; name.textContent = item.name;
      if (item.type === 'directory') { name.onclick = () => void loadFolder(item.path); }
      else { name.onclick = () => void showPreview(item); if (previewItem?.path === item.path) row.classList.add('previewing'); }
      const meta = document.createElement('small'); meta.textContent = item.type === 'directory' ? '文件夹 · 点击名称进入' : `${ext(item.name).toUpperCase() || '文件'} · ${bytesLabel(item.size)}`;
      details.append(name, meta); row.append(icon, details); list.append(row);
    }
  }
  function renderListTools() {
    byId('conversionCount').textContent = `已选 ${selected.size} 项`;
    byId('conversionClear').disabled = selected.size === 0;
    const files = items.filter(item => item.type === 'file');
    byId('conversionSelectAll').checked = files.length > 0 && files.every(item => selected.has(item.path));
    byId('conversionUp').disabled = !parent; byId('conversionRefresh').disabled = !current;
  }
  async function updateTargets() {
    const generation = ++optionsGeneration, select = byId('conversionFormat');
    select.replaceChildren(); selected.size ? (select.disabled = true) : null;
    const placeholder = document.createElement('option'); placeholder.value = ''; placeholder.textContent = selected.size ? '正在检查可转换格式…' : '先选择文件'; select.append(placeholder);
    byId('conversionRun').disabled = true;
    if (!selected.size) { select.disabled = true; return; }
    try {
      const options = await window.tidy.conversionOptions([...selected]);
      if (generation !== optionsGeneration) return;
      select.replaceChildren(); const empty = document.createElement('option'); empty.value = ''; empty.textContent = options.length ? '选择目标格式…' : '所选文件暂无兼容转换'; select.append(empty);
      for (const entry of options) { const option = document.createElement('option'); option.value = entry.format; option.textContent = entry.label; select.append(option); }
      select.disabled = options.length === 0;
      if (options.length === 1) select.value = options[0].format;
      byId('conversionRun').disabled = !select.value;
    } catch (error) { setStatus(error.message, true); select.disabled = true; }
  }
  async function loadFolder(folder) {
    if (!root) return;
    previewGeneration++;
    const sameFolder = current && samePath(folder, current);
    setStatus(`正在读取 ${folder} …`);
    try {
      const result = await window.tidy.conversionReadFolder(folder);
      root = result.root; current = result.current; parent = result.parent; items = result.items; selected.clear(); previewItem = null;
      if (!sameFolder) { latestOutput = null; byId('conversionOpenResult').hidden = true; }
      renderBreadcrumb(); renderList(); renderListTools(); clearPreview(); await updateTargets();
      setStatus(`${baseName(current)} · ${items.filter(item => item.type === 'directory').length} 个文件夹，${items.filter(item => item.type === 'file').length} 个文件${result.skipped ? ` · ${result.skipped} 项因链接或权限已跳过` : ''}。输出会保存在此文件夹。`);
    } catch (error) { setStatus(`无法读取文件夹：${error.message}`, true); }
  }
  async function chooseFolder() {
    try { const result = await window.tidy.conversionChooseFolder(); if (!result) return; root = result.root; await loadFolder(result.current); }
    catch (error) { setStatus(`无法选择文件夹：${error.message}`, true); }
  }
  async function loadPdfJs() {
    if (!pdfjsPromise) pdfjsPromise = import('../../node_modules/pdfjs-dist/build/pdf.mjs').then(pdfjs => {
      pdfjs.GlobalWorkerOptions.workerSrc = new URL('../../node_modules/pdfjs-dist/build/pdf.worker.mjs', document.baseURI).href;
      return pdfjs;
    });
    return pdfjsPromise;
  }
  function fromBase64(value) { const binary = atob(value); const bytes = new Uint8Array(binary.length); for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index); return bytes; }
  async function renderPdfPreview(data, container, generation) {
    const pdfjs = await loadPdfJs(), documentTask = pdfjs.getDocument({ data: fromBase64(data) }), pdf = await documentTask.promise;
    if (generation !== previewGeneration) { await pdf.destroy(); return; }
    const page = await pdf.getPage(1), viewport = page.getViewport({ scale: 1 });
    const canvas = document.createElement('canvas'), scale = Math.min(1.35, 740 / viewport.width), renderView = page.getViewport({ scale });
    canvas.width = Math.ceil(renderView.width); canvas.height = Math.ceil(renderView.height); canvas.className = 'conversion-preview-canvas';
    await page.render({ canvas, canvasContext: canvas.getContext('2d'), viewport: renderView }).promise;
    if (generation === previewGeneration) { container.replaceChildren(canvas); byId('conversionPreviewMeta').textContent = `PDF · ${pdf.numPages} 页 · 首页预览`; }
    await pdf.destroy();
  }
  async function showPreview(item) {
    previewItem = item; latestOutput = null; byId('conversionOpenResult').hidden = true; renderList();
    byId('conversionPreviewName').textContent = item.name; byId('conversionPreviewMeta').textContent = `${ext(item.name).toUpperCase()} · ${bytesLabel(item.size)}`;
    byId('conversionOpenSource').disabled = false;
    const container = byId('conversionPreview'); container.innerHTML = '<div class="conversion-preview-empty"><strong>正在生成预览…</strong></div>';
    const generation = ++previewGeneration;
    try {
      const file = await window.tidy.conversionReadFile(item.path);
      if (generation !== previewGeneration) return;
      if (!file.data) { container.innerHTML = '<div class="conversion-preview-empty"><strong>暂不提供此格式的页面预览</strong><p>仍可在选择目标格式后进行转换。</p></div>'; return; }
      if (file.mime === 'application/pdf') { await renderPdfPreview(file.data, container, generation); return; }
      const image = document.createElement('img'); image.alt = item.name; image.className = 'conversion-preview-image'; image.src = `data:${file.mime};base64,${file.data}`; container.replaceChildren(image); byId('conversionPreviewMeta').textContent = `${file.mime.replace('image/', '').toUpperCase()} · ${bytesLabel(file.size)}`;
    } catch (error) { container.innerHTML = '<div class="conversion-preview-empty"><strong>无法预览此文件</strong><p>文件仍可转换；请检查文件是否损坏或过大。</p></div>'; byId('conversionPreviewMeta').textContent = error.message; }
  }
  async function renderPdfPagesToImages(item, format) {
    setStatus('正在读取 PDF…'); byId('conversionRun').disabled = true;
    const source = await window.tidy.conversionReadFile(item.path), pdfjs = await loadPdfJs();
    const pdf = await pdfjs.getDocument({ data: fromBase64(source.data) }).promise;
    if (pdf.numPages > 500) { await pdf.destroy(); throw new Error('PDF 超过 500 页，请拆分后再导出图片。'); }
    const outputs = [];
    try {
      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
        setStatus(`正在转换 PDF 页面：${pageNumber}/${pdf.numPages}…`);
        const page = await pdf.getPage(pageNumber), raw = page.getViewport({ scale: 1 }), scale = Math.min(2, 5000 / Math.max(raw.width, raw.height));
        const viewport = page.getViewport({ scale }), canvas = document.createElement('canvas');
        canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
        if (canvas.width * canvas.height > 25000000) throw new Error(`第 ${pageNumber} 页分辨率过大，已停止以保护内存。`);
        await page.render({ canvas, canvasContext: canvas.getContext('2d'), viewport }).promise;
        const uri = canvas.toDataURL(format === 'jpg' ? 'image/jpeg' : 'image/png', 0.9);
        outputs.push(await window.tidy.conversionSavePage(item.path, pageNumber, format, uri.slice(uri.indexOf(',') + 1)));
        canvas.width = 0; canvas.height = 0;
      }
    } finally { await pdf.destroy(); }
    latestOutput = outputs[0] || null; byId('conversionOpenResult').hidden = !latestOutput; await loadFolder(current);
    setStatus(`已导出 ${outputs.length} 张 ${format.toUpperCase()} 图片，保存在当前文件夹。${latestOutput ? ` 首张：${latestOutput}` : ''}`);
  }
  async function runConversion() {
    const paths = [...selected], format = byId('conversionFormat').value;
    if (!paths.length || !format) return;
    const btn = byId('conversionRun'); btn.disabled = true; btn.textContent = '转换中…';
    try {
      const targetOptions = await window.tidy.conversionOptions(paths), target = targetOptions.find(option => option.format === format);
      if (!target) throw new Error('所选文件或转换格式已改变，请重新选择。');
      if (target.operation === 'pdf-to-images') {
        if (paths.length !== 1) throw new Error('一次请选择一个 PDF 导出页面图片。');
        const item = items.find(entry => entry.path === paths[0]); await renderPdfPagesToImages(item, format); return;
      }
      setStatus('正在转换，原文件不会被覆盖…');
      const result = await window.tidy.conversionRun(paths, format); latestOutput = result.outputs[0] || null;
      if (latestOutput) byId('conversionOpenResult').hidden = false;
      await loadFolder(current);
      setStatus(`${result.outputs.length ? `转换完成：${result.outputs.length} 个结果已保存在当前文件夹。${latestOutput ? ` 首个结果：${latestOutput}` : ''}` : '没有生成转换结果。'}${result.failed.length ? ` 失败：${result.failed.map(item => `${item.name}（${item.reason}）`).join('；')}` : ''}`, result.failed.length > 0 && !result.outputs.length);
    } catch (error) { setStatus(`转换失败：${error.message}`, true); }
    finally { btn.textContent = '开始转换'; await updateTargets(); }
  }
  byId('conversionChooseFolder').onclick = chooseFolder;
  byId('conversionRefresh').onclick = () => current && loadFolder(current);
  byId('conversionUp').onclick = () => parent && loadFolder(parent);
  byId('conversionClear').onclick = () => { selected.clear(); renderList(); renderListTools(); void updateTargets(); };
  byId('conversionSelectAll').onchange = () => { items.filter(item => item.type === 'file').forEach(item => byId('conversionSelectAll').checked ? selected.add(item.path) : selected.delete(item.path)); renderList(); renderListTools(); void updateTargets(); };
  byId('conversionFormat').onchange = () => { byId('conversionRun').disabled = !byId('conversionFormat').value; };
  byId('conversionRun').onclick = runConversion;
  byId('conversionOpenSource').onclick = () => previewItem && window.tidy.conversionOpen(previewItem.path).catch(error => setStatus(error.message, true));
  byId('conversionOpenResult').onclick = () => latestOutput && window.tidy.conversionOpen(latestOutput).catch(error => setStatus(error.message, true));
  byId('conversionSelectAll').checked = false;
})();
