const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('landing page presents the product, safety promise, and Windows trial action', () => {
  const page = fs.readFileSync('landing/index.html', 'utf8');
  assert.match(page, /桌面清洁助手/);
  assert.match(page, /下载 Windows 试用版/);
  assert.match(page, /不会删除/);
});
