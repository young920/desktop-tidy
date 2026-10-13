const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { scanFiles, queryFiles, trashIndexedFiles } = require('../src/search.cjs');

test('recursive scan finds documents in nested folders, deduplicates roots and reports missing roots', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tidy-search-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, '水源项目'));
  await fs.writeFile(path.join(root, '水源项目', '会议.docx'), 'sample');
  const result = await scanFiles([root, root, path.join(root, 'missing')]);
  assert.equal(result.files.length, 1);
  assert.equal(result.files[0].extension, 'docx');
  assert.equal(result.errors, 1);
});

const files = [
  { path: 'C:\\项目\\水源\\会议纪要.DOCX', name: '会议纪要.DOCX', extension: 'docx', createdAt: '2026-07-01T09:00:00Z', modifiedAt: '2026-09-03T09:00:00Z' },
  { path: 'C:\\模板\\会议纪要.pdf', name: '会议纪要.pdf', extension: 'pdf', createdAt: '2026-08-01T09:00:00Z', modifiedAt: '2026-09-10T09:00:00Z' }
];
test('topic aliases, keyword, format and modified date combine with AND semantics', () => {
  const result = queryFiles(files, { topic: '水利', keywords: '会议,纪要', formats: 'DOCX，pdf', dateField: 'modifiedAt', from: '2026-09-01', to: '2026-09-04' }, [{ name: '水利', keywords: ['水源'] }]);
  assert.equal(result.total, 1);
  assert.equal(result.items[0].extension, 'docx');
});
test('creation date filtering and pagination work independently', () => {
  assert.equal(queryFiles(files, { dateField: 'createdAt', from: '2026-08-01' }).total, 1);
  assert.equal(queryFiles(files, { offset: 1, limit: 1 }).items.length, 1);
});
test('cancellation is reported and does not claim complete coverage', async () => {
  const result = await scanFiles([os.tmpdir()], { isCancelled: () => true });
  assert.equal(result.cancelled, true);
  assert.equal(result.files.length, 0);
});

test('trash operation only moves indexed unchanged files and removes them from the index', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tidy-trash-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const filePath = path.join(root, 'duplicate.pdf');
  await fs.writeFile(filePath, 'same');
  const scanned = await scanFiles([root]);
  const moved = [];
  const result = await trashIndexedFiles(scanned, [filePath, filePath], async target => { moved.push(target); });
  assert.equal(moved.length, 1);
  assert.equal(result.moved.length, 1);
  assert.equal(scanned.files.length, 0);
});

test('trash operation refuses a file that changed after indexing', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tidy-trash-changed-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const filePath = path.join(root, 'document.pdf');
  await fs.writeFile(filePath, 'before');
  const scanned = await scanFiles([root]);
  await new Promise(resolve => setTimeout(resolve, 20));
  await fs.writeFile(filePath, 'changed content');
  let didTrash = false;
  const result = await trashIndexedFiles(scanned, [filePath], async () => { didTrash = true; });
  assert.equal(didTrash, false);
  assert.equal(result.failed[0].reason, '文件在建立索引后发生变化，请更新索引后再操作。');
  assert.equal(await fs.readFile(filePath, 'utf8'), 'changed content');
});

test('trash operation rejects paths outside index and oversized selections', async () => {
  let calls = 0;
  await assert.rejects(() => trashIndexedFiles({ files: [] }, ['C:\\\\not-indexed.pdf'], async () => { calls++; }), /未包含在当前索引/);
  await assert.rejects(() => trashIndexedFiles({ files: [] }, Array(101).fill('x'), async () => { calls++; }), /一次最多/);
  assert.equal(calls, 0);
});
