const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { PDFDocument } = require('pdf-lib');
const { conversionTargets, planConversion, nextAvailablePath, mergePdfFiles, imagesToPdf } = require('../src/converter.cjs');

const file = (name, type = 'file') => ({ name, type, path: `C:\\资料\\${name}` });

test('conversion targets include PDF, ODF and corresponding Office formats', () => {
  assert.deepEqual(conversionTargets([file('报告.docx')]).map(option => option.format), ['pdf', 'odt']);
  assert.deepEqual(conversionTargets([file('报告.odt')]).map(option => option.format), ['pdf', 'docx']);
  assert.deepEqual(conversionTargets([file('预算.xlsx')]).map(option => option.format), ['pdf', 'ods']);
  assert.deepEqual(conversionTargets([file('预算.ods')]).map(option => option.format), ['pdf', 'xlsx']);
  assert.deepEqual(conversionTargets([file('汇报.pptx')]).map(option => option.format), ['pdf', 'odp']);
  assert.deepEqual(conversionTargets([file('汇报.odp')]).map(option => option.format), ['pdf', 'pptx']);
});

test('PDF conversion offers page images and best-effort editable document formats', () => {
  assert.deepEqual(conversionTargets([file('扫描.pdf')]).map(option => option.format), ['png', 'jpg', 'docx', 'odt']);
  assert.equal(conversionTargets([file('扫描.pdf')]).find(option => option.format === 'docx').quality, 'best-effort');
});

test('multiple PDFs and images expose merge and image-to-PDF operations', () => {
  assert.deepEqual(conversionTargets([file('a.pdf'), file('b.pdf')]).map(option => option.format), ['pdf']);
  assert.deepEqual(conversionTargets([file('a.png'), file('b.jpg')]).map(option => option.format), ['pdf']);
});

test('conversion target list rejects mixed or non-file selections', () => {
  assert.deepEqual(conversionTargets([file('a.pdf'), file('b.docx')]), []);
  assert.deepEqual(conversionTargets([file('目录', 'directory')]), []);
  assert.deepEqual(conversionTargets([]), []);
});

test('conversion planner selects safe operation kinds and validates target formats', () => {
  assert.equal(planConversion([file('a.pdf')], 'png').operation, 'pdf-to-images');
  assert.equal(planConversion([file('a.pdf')], 'docx').operation, 'office');
  assert.equal(planConversion([file('a.docx')], 'pdf').operation, 'office');
  assert.equal(planConversion([file('a.odt')], 'docx').operation, 'office');
  assert.equal(planConversion([file('a.png'), file('b.jpg')], 'pdf').operation, 'images-to-pdf');
  assert.equal(planConversion([file('a.pdf'), file('b.pdf')], 'pdf').operation, 'merge-pdf');
  assert.throws(() => planConversion([file('a.docx')], 'png'), /不支持/);
  assert.throws(() => planConversion([file('a.pdf'), file('b.docx')], 'pdf'), /不支持/);
});

test('output naming never overwrites an existing converted file', () => {
  const existing = new Set(['C:\\资料\\报告.pdf', 'C:\\资料\\报告 (2).pdf']);
  const output = nextAvailablePath('C:\\资料', '报告.docx', 'pdf', candidate => existing.has(candidate));
  assert.equal(output, 'C:\\资料\\报告 (3).pdf');
});

test('PDF merge preserves the selected document order and refuses overwrite', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'file-manager-pdf-'));
  try {
    const inputs = [];
    for (const width of [200, 400]) {
      const document = await PDFDocument.create(); document.addPage([width, 300]);
      const inputPath = path.join(directory, `${width}.pdf`); await fs.writeFile(inputPath, await document.save());
      inputs.push({ path: inputPath, extension: 'pdf' });
    }
    const outputPath = path.join(directory, '合并.pdf');
    await mergePdfFiles(inputs, outputPath);
    const merged = await PDFDocument.load(await fs.readFile(outputPath));
    assert.deepEqual(merged.getPages().map(page => page.getWidth()), [200, 400]);
    await assert.rejects(mergePdfFiles(inputs, outputPath), { code: 'EEXIST' });
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});

test('PNG and JPG images are placed one per page in a generated PDF', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'file-manager-images-'));
  try {
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/S5sAAAAASUVORK5CYII=', 'base64');
    const jpg = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9oADAMBAAIAAwAAABAf/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPxB//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPxB//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxB//9k=', 'base64');
    const pngPath = path.join(directory, 'a.png'), jpgPath = path.join(directory, 'b.jpg');
    await fs.writeFile(pngPath, png); await fs.writeFile(jpgPath, jpg);
    const output = path.join(directory, 'images.pdf'); await imagesToPdf([{ path: pngPath, extension: 'png' }, { path: jpgPath, extension: 'jpg' }], output);
    const document = await PDFDocument.load(await fs.readFile(output));
    assert.equal(document.getPageCount(), 2);
    assert.equal(document.getPages()[0].getWidth(), 595.28);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});
