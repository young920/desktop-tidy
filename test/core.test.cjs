const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { buildPlan, safeDestination, executePlan, undoBatch } = require('../src/core.cjs');

function tempDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-tidy-')); }
function write(dir, name, text = 'x') { fs.writeFileSync(path.join(dir, name), text); }

test('project keyword sends a file to its project and provides an explanation', () => {
  const root = tempDir();
  write(root, '客户A_报价单.xlsx');
  const plan = buildPlan(root, path.join(root, '桌面整理'), [{ name: '客户A-官网改版', keywords: ['客户A'] }]);
  assert.equal(plan.items[0].bucket, '进行中/客户A-官网改版');
  assert.match(plan.items[0].reason, /客户A/);
});

test('equally ranked project keywords require an explicit choice', () => {
  const root = tempDir();
  write(root, '客户A_合作协议.pdf');
  const plan = buildPlan(root, path.join(root, '桌面整理'), [
    { name: '客户A-官网', keywords: ['客户A'] },
    { name: '客户A-续约', keywords: ['客户A'] }
  ]);
  assert.match(plan.items[0].bucket, /^待选择/);
  assert.match(plan.items[0].reason, /选择/);
});

test('a more specific keyword wins when a filename matches multiple rules', () => {
  const root = tempDir();
  write(root, '生态环境厅水源处会议纪要.docx');
  const plan = buildPlan(root, path.join(root, '桌面整理'), [
    { name: '通用水源', keywords: ['水源'] },
    { name: '生态环境厅项目', keywords: ['生态环境厅水源'] }
  ]);
  assert.equal(plan.items[0].bucket, '进行中/生态环境厅项目');
});

test('higher rule priority resolves equally specific keyword matches', () => {
  const root = tempDir();
  write(root, '模板生态环境厅水源处会议纪要.docx');
  const plan = buildPlan(root, path.join(root, '桌面整理'), [
    { name: '模板库', keywords: ['模板'], priority: 1 },
    { name: '水源处', keywords: ['水源'], priority: 10 }
  ]);
  assert.equal(plan.items[0].bucket, '进行中/水源处');
});

test('equal ranked rules require an explicit preview choice', () => {
  const root = tempDir();
  write(root, '模板生态环境厅水源处会议纪要.docx');
  const plan = buildPlan(root, path.join(root, '桌面整理'), [
    { name: '模板库', keywords: ['模板'] },
    { name: '水源处', keywords: ['水源'] }
  ]);
  assert.equal(plan.items[0].requiresChoice, true);
  assert.equal(plan.items[0].candidates.length, 2);
});

test('archive root, shortcuts, symlinks, and folders are skipped by default', () => {
  const root = tempDir();
  fs.mkdirSync(path.join(root, '桌面整理'));
  fs.mkdirSync(path.join(root, '项目文件夹'));
  write(root, '入口.lnk');
  const plan = buildPlan(root, path.join(root, '桌面整理'), []);
  assert.equal(plan.items.length, 0);
  assert.equal(plan.skipped.length, 3);
});

test('same-name destination receives a non-destructive numbered name', () => {
  const root = tempDir();
  const target = path.join(root, '桌面整理', '待确认', '2026-09');
  fs.mkdirSync(target, { recursive: true });
  write(target, '报告.pdf');
  assert.equal(path.basename(safeDestination(target, '报告.pdf')), '报告 (2).pdf');
});

test('execution moves verified files and undo restores them', () => {
  const root = tempDir();
  write(root, '客户A_需求.docx', 'original');
  const archive = path.join(root, '桌面整理');
  const plan = buildPlan(root, archive, [{ name: '客户A', keywords: ['客户A'] }]);
  const batch = executePlan(plan);
  assert.equal(batch.items[0].status, 'moved');
  assert.ok(fs.existsSync(batch.items[0].destinationPath));
  const undone = undoBatch(batch);
  assert.equal(undone.items[0].status, 'undone');
  assert.equal(fs.readFileSync(path.join(root, '客户A_需求.docx'), 'utf8'), 'original');
});

test('changed source is skipped instead of moved', () => {
  const root = tempDir();
  write(root, '随手记录.txt', 'a');
  const plan = buildPlan(root, path.join(root, '桌面整理'), []);
  write(root, '随手记录.txt', 'changed');
  const batch = executePlan(plan);
  assert.equal(batch.items[0].status, 'skipped_changed');
});

test('unselected items are retained and never moved', () => {
  const root = tempDir();
  write(root, '稍后处理.txt');
  const plan = buildPlan(root, path.join(root, '桌面整理'), []);
  plan.items[0].selected = false;
  const batch = executePlan(plan);
  assert.equal(batch.items[0].status, 'skipped');
  assert.ok(fs.existsSync(path.join(root, '稍后处理.txt')));
});

test('undo refuses to overwrite a new file at the original path', () => {
  const root = tempDir();
  write(root, '客户A_文件.txt');
  const plan = buildPlan(root, path.join(root, '桌面整理'), [{ name: '客户A', keywords: ['客户A'] }]);
  const batch = executePlan(plan);
  write(root, '客户A_文件.txt', 'new');
  const undone = undoBatch(batch);
  assert.equal(undone.items[0].status, 'undo_failed');
  assert.match(undone.items[0].error, /原位置/);
});

test('a missing source is safely skipped', () => {
  const root = tempDir();
  write(root, '临时文件.txt');
  const plan = buildPlan(root, path.join(root, '桌面整理'), []);
  fs.unlinkSync(path.join(root, '临时文件.txt'));
  assert.equal(executePlan(plan).items[0].error, '源文件已不存在，请重新扫描');
});
