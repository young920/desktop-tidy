// Focused Electron smoke test for the offline conversion workflow.
const { app, BrowserWindow, dialog, shell } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const { PDFDocument } = require('pdf-lib');

const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'file-conversion-smoke-'));
app.setPath('userData', path.join(fixture, 'app-data'));
process.env.FILE_MANAGER_TEST_USER_DATA = path.join(fixture, 'app-data');
let officeFixtures = false;
const programs = [process.env.ProgramW6432, process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter(Boolean);
const officeCandidates = programs.flatMap(folder => ['soffice.com', 'soffice.exe'].map(executable => path.join(folder, 'LibreOffice', 'program', executable)));
const soffice = officeCandidates.find(candidate => fs.existsSync(candidate));
for (const [name, width] of [['转换样本.pdf', 420], ['另一份.pdf', 520]]) {
  const document = PDFDocument.create();
  document.then(async pdf => { pdf.addPage([width, 600]); pdf.addPage([width, 600]); fs.writeFileSync(path.join(fixture, name), await pdf.save()); });
}
// Wait for tiny PDF fixtures to be written before Electron launches.
const fixturesReady = (async () => {
  while (!fs.existsSync(path.join(fixture, '转换样本.pdf')) || !fs.existsSync(path.join(fixture, '另一份.pdf'))) await new Promise(resolve => setTimeout(resolve, 10));
  if (!soffice) return false;
  const textPath = path.join(fixture, '转换样本.txt'); fs.writeFileSync(textPath, 'Local office conversion fixture.\nSecond paragraph.');
  const profile = `-env:UserInstallation=${pathToFileURL(path.join(fixture, 'lo-profile')).href}`;
  execFileSync(soffice, ['--headless', '--nologo', profile, '--convert-to', 'docx:Office Open XML Text', '--outdir', fixture, textPath], { windowsHide: true, timeout: 60000 });
  if (!fs.existsSync(path.join(fixture, '转换样本.docx'))) return false;
  execFileSync(soffice, ['--headless', '--nologo', profile, '--convert-to', 'odt:writer8', '--outdir', fixture, path.join(fixture, '转换样本.docx')], { windowsHide: true, timeout: 60000 });
  officeFixtures = fs.existsSync(path.join(fixture, '转换样本.odt'));
  return officeFixtures;
})();
dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fixture] });
const opened = [];
shell.openPath = async target => { opened.push(target); return ''; };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const timeout = setTimeout(() => { console.error('conversion UI test timed out'); app.exit(1); }, 120000);

app.on('browser-window-created', (_event, win) => win.webContents.on('did-finish-load', async () => {
  try {
    await fixturesReady;
    const result = await win.webContents.executeJavaScript(`(async () => { let stage='open conversion tab'; try {
      const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
      const rows = () => [...document.querySelectorAll('.conversion-file-row')];
      const find = suffix => rows().find(row => row.dataset.path.endsWith(suffix));
      const select = async (...suffixes) => { for (const suffix of suffixes) { const row = find(suffix); if (!row) throw new Error('fixture row not found: ' + suffix); const checkbox = row.querySelector('input[type=checkbox]'); if (!checkbox.checked) checkbox.click(); } await sleep(120); };
      const convert = async format => { const selectBox = document.getElementById('conversionFormat'); for (let i = 0; i < 50 && ![...selectBox.options].some(option => option.value === format); i++) await sleep(50); if (![...selectBox.options].some(option => option.value === format)) throw new Error('target format unavailable: ' + format + ' / ' + selectBox.textContent); selectBox.value = format; selectBox.dispatchEvent(new Event('change', { bubbles: true })); await document.getElementById('conversionRun').onclick(); };
      document.getElementById('conversionTab').click();
      stage='choose folder and list files';
      await document.getElementById('conversionChooseFolder').onclick();
      const folderVisible = !document.getElementById('conversionPanel').hidden && Boolean(find('转换样本.pdf'));
      if (!folderVisible) throw new Error('selected folder contents were not rendered: ' + document.getElementById('conversionStatus').textContent);
      stage='PDF preview';
      find('转换样本.pdf').querySelector('.conversion-file-name').click();
      for (let i = 0; i < 70 && !document.querySelector('.conversion-preview-canvas'); i++) await sleep(100);
      const pdfPreview = Boolean(document.querySelector('.conversion-preview-canvas'));
      stage='PDF to image';
      await select('转换样本.pdf');
      const pdfFormats = [...document.querySelectorAll('#conversionFormat option')].map(option => option.value);
      const pdfTargets = pdfFormats.includes('png') && pdfFormats.includes('docx') && pdfFormats.includes('odt');
      await convert('png');
      const pdfImages = document.getElementById('conversionStatus').textContent.includes('已导出 2 张') && Boolean(find('转换样本-001.png')) && Boolean(find('转换样本-002.png'));
      stage='multiple images to PDF';
      await select('转换样本-001.png', '转换样本-002.png'); await convert('pdf');
      const imagesToPdf = Boolean(find('图片合并.pdf')) && document.getElementById('conversionStatus').textContent.includes('转换完成');
      stage='merge PDF';
      await select('转换样本.pdf', '另一份.pdf');
      const mergeChoices = [...document.querySelectorAll('#conversionFormat option')].filter(option => option.value).map(option => option.value);
      await convert('pdf'); const pdfMerge = Boolean(find('转换样本-合并.pdf'));
      let wordToPdf = false, odfToWord = false, pdfToWord = false;
      if (${JSON.stringify(officeFixtures)}) {
        stage='Word to PDF'; await select('转换样本.docx'); await convert('pdf');
        wordToPdf = document.getElementById('conversionStatus').textContent.includes('转换完成') && Boolean(find('转换样本 (2).pdf'));
        stage='ODF to Word'; await select('转换样本.odt'); await convert('docx');
        odfToWord = Boolean(find('转换样本 (2).docx'));
        stage='PDF to Word best-effort'; await select('另一份.pdf'); await convert('docx');
        pdfToWord = document.getElementById('conversionStatus').textContent.includes('转换完成') && Boolean(find('另一份.docx'));
      }
      return { folderVisible, pdfPreview, pdfTargets, pdfImages, imagesToPdf, mergeChoices, pdfMerge, wordToPdf, odfToWord, pdfToWord };
    } catch (error) { return { stage, error:error.message, stack:error.stack, status:document.getElementById('conversionStatus')?.textContent, list:document.getElementById('conversionList')?.textContent.slice(0,500) }; } })()`);
    const allGood = result.folderVisible && result.pdfPreview && result.pdfTargets && result.pdfImages && result.imagesToPdf && result.mergeChoices.join(',') === 'pdf' && result.pdfMerge && (!officeFixtures || (result.wordToPdf && result.odfToWord && result.pdfToWord));
    if (!allGood) throw new Error(JSON.stringify(result));
    console.log(`PASS: folder preview, PDF image export, image-to-PDF, PDF merge${officeFixtures ? ', DOCX/ODT/PDF conversions via LibreOffice' : ''}`);
    clearTimeout(timeout); win.destroy(); app.exit(0);
  } catch (error) { console.error(error.stack || error); clearTimeout(timeout); app.exit(1); }
}));
require('../src/main.cjs');
