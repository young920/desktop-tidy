// Run with Electron, in an isolated data directory and fixture folder.
const { app, BrowserWindow, dialog } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'tidy-ui-search-'));
app.setPath('userData', path.join(fixture, 'app-data'));
fs.mkdirSync(path.join(fixture, '水源处'), { recursive: true });
fs.mkdirSync(path.join(fixture, '目标文件夹'), { recursive: true });
fs.mkdirSync(path.join(fixture, '待移动文件夹', '子目录'), { recursive: true });
fs.writeFileSync(path.join(fixture, '水源处', '会议纪要.docx'), 'fixture');
fs.writeFileSync(path.join(fixture, '水源处', '重复版本.pdf'), 'duplicate fixture');
fs.writeFileSync(path.join(fixture, '待移动文件夹', '子目录', '完整内容.txt'), 'folder stays intact');
const trashed = [];
dialog.showOpenDialog = async options => ({ canceled: false, filePaths: [options.title === '选择文件管理范围' ? fixture : options.title === '选择移动目标文件夹' ? path.join(fixture, '目标文件夹') : path.join(fixture, '水源处')] });
require('electron').shell.trashItem = async filePath => { trashed.push(filePath); };
let timeout = setTimeout(() => { console.error('UI test timed out'); app.exit(1); }, 20000);
app.on('browser-window-created', (_event, win) => {
  win.webContents.on('did-finish-load', async () => {
    try {
      const result = await win.webContents.executeJavaScript(`(async () => { let stage='search tab'; try {
        document.getElementById('searchTab').click();
        stage='choose search folder';
        await document.getElementById('chooseSearchFolder').onclick();
        stage='scan';
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
        stage='trash result';
        await document.getElementById('trashSelected').onclick();
        const searchRemoved = document.querySelectorAll('.search-result').length === 0;
        stage='open manager';
        document.getElementById('managerTab').click();
        if (!document.getElementById('managerChooseRoot')?.onclick) throw new Error('Manager root picker handler missing');
        for (let i = 0; i < 30 && document.getElementById('managerList').querySelector('.manager-item'); i++) await new Promise(resolve => setTimeout(resolve, 100));
        stage='choose manager root';
        await document.getElementById('managerChooseRoot').onclick();
        stage='create target folder';
        if (!document.getElementById('managerFolderForm')?.onsubmit) throw new Error('New folder form handler missing');
        document.getElementById('managerCreateFolder').click();
        document.getElementById('managerFolderName').value = '新建目标';
        await document.getElementById('managerFolderForm').onsubmit({ preventDefault() {} });
        const createdVisible = document.getElementById('managerTree').textContent.includes('新建目标');
        stage='choose move target';
        const targetNode = [...document.querySelectorAll('.tree-folder-name')].find(button => button.textContent === '目标文件夹');
        if (!targetNode) throw new Error('target folder missing from folder tree');
        targetNode.click();
        const folderRow = [...document.querySelectorAll('.manager-item')].find(row => row.dataset.path.endsWith('待移动文件夹'));
        if (!folderRow) throw new Error('folder manager did not render the selected folder');
        folderRow.querySelector('.manager-check').click(); window.confirm = () => true;
        stage='move folder';
        await document.getElementById('managerMove').onclick();
        const movedVisible = document.getElementById('managerStatus').textContent.includes('已移动 1 项');
        stage='undo folder move';
        await document.getElementById('managerUndo').onclick();
        const undoVisible = document.getElementById('managerStatus').textContent.includes('已撤销 1 项');
        return { ...search, removedFromResults: searchRemoved, createdVisible, movedVisible, undoVisible };
      } catch(error) { return {stage,error:error.message,stack:error.stack}; }
      })()`);
      if (result.error || result.count !== 1 || !result.text.includes('会议纪要.docx') || !result.visible || !result.status.includes('索引就绪') || !result.removedFromResults || trashed.length !== 1 || !result.createdVisible || !result.movedVisible || !result.undoVisible) throw new Error(JSON.stringify(result));
      console.log('PASS: search filters, recycle bin action, folder browsing, target creation, whole-folder move and undo in Electron');
      clearTimeout(timeout); BrowserWindow.getAllWindows().forEach(window => window.destroy());
      // Electron still owns dictionary handles until process exit. Keep the
      // isolated temporary profile for OS cleanup instead of deleting live files.
      app.exit(0);
    } catch (error) { console.error(error.stack || error); clearTimeout(timeout); app.exit(1); }
  });
});
require('../src/main.cjs');
