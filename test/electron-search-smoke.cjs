// Run with Electron, in an isolated data directory and fixture folder.
const { app, BrowserWindow, dialog } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'tidy-ui-search-'));
app.setPath('userData', path.join(fixture, 'app-data'));
fs.mkdirSync(path.join(fixture, '水源处'), { recursive: true });
fs.writeFileSync(path.join(fixture, '水源处', '会议纪要.docx'), 'fixture');
fs.writeFileSync(path.join(fixture, '水源处', '重复版本.pdf'), 'duplicate fixture');
const trashed = [];
dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path.join(fixture, '水源处')] });
require('electron').shell.trashItem = async filePath => { trashed.push(filePath); };
let timeout = setTimeout(() => { console.error('UI test timed out'); app.exit(1); }, 20000);
app.on('browser-window-created', (_event, win) => {
  win.webContents.on('did-finish-load', async () => {
    try {
      const result = await win.webContents.executeJavaScript(`(async () => {
        document.getElementById('searchTab').click();
        await document.getElementById('chooseSearchFolder').onclick();
        await document.getElementById('refreshIndex').onclick();
        document.getElementById('searchKeywords').value = '会议';
        document.getElementById('searchFormats').value = 'docx';
        document.getElementById('searchForm').requestSubmit();
        await new Promise(resolve => setTimeout(resolve, 100));
        const search = { count: document.querySelectorAll('.search-result').length, text: document.getElementById('searchResults').textContent, status: document.getElementById('indexStatus').textContent, visible: !document.getElementById('searchPanel').hidden };
        document.getElementById('searchForm').reset();
        document.getElementById('searchFormats').value = 'pdf';
        document.getElementById('searchForm').requestSubmit();
        await new Promise(resolve => setTimeout(resolve, 100));
        window.confirm = () => true;
        document.querySelector('.row-select').click();
        await document.getElementById('trashSelected').onclick();
        return { ...search, trashed: await window.tidy.searchStatus(), removedFromResults: document.querySelectorAll('.search-result').length === 0 };
      })()`);
      if (result.count !== 1 || !result.text.includes('会议纪要.docx') || !result.visible || !result.status.includes('索引就绪') || !result.removedFromResults || trashed.length !== 1) throw new Error(JSON.stringify(result));
      console.log('PASS: folder picker, recursive indexing, combined filters, selection, recycle bin action and result refresh in Electron');
      clearTimeout(timeout); BrowserWindow.getAllWindows().forEach(window => window.destroy());
      // Electron still owns dictionary handles until process exit. Keep the
      // isolated temporary profile for OS cleanup instead of deleting live files.
      app.exit(0);
    } catch (error) { console.error(error); clearTimeout(timeout); app.exit(1); }
  });
});
require('../src/main.cjs');
