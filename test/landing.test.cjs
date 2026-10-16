const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('landing page presents the product, preview-first workflow, and Windows download', () => {
  const page = fs.readFileSync('landing/index.html', 'utf8');
  assert.match(page, /文件管家/);
  assert.match(page, /Windows 下载/);
  assert.match(page, /确认之后才会执行/);
  assert.match(page, /文件检索/);
  assert.match(page, /文件转换/);
});

test('landing actions point to the repository and latest release page instead of Pages-relative files', () => {
  const page = fs.readFileSync('landing/index.html', 'utf8');
  assert.match(page, /https:\/\/github\.com\/young920\/desktop-tidy/);
  assert.match(page, /releases\/latest/);
  assert.doesNotMatch(page, /\.\.\/启动桌面清洁助手\.bat/);
});

test('landing typography works offline and the preview shows every desktop module', () => {
  const page = fs.readFileSync('landing/index.html', 'utf8');
  const style = fs.readFileSync('landing/style.css', 'utf8');
  assert.match(page, /桌面整理/);
  assert.match(page, /文件检索/);
  assert.match(page, /文件管理/);
  assert.match(page, /文件转换/);
  assert.doesNotMatch(style, /@import\s+url\(/i);
});
