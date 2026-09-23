const test = require('node:test');
const assert = require('node:assert/strict');
const { splitKeywords } = require('../src/renderer/keyword-parser.js');

test('keywords accept any Chinese or English text without length restrictions', () => {
  assert.deepEqual(splitKeywords('客户A,ABC,中文项目,very-long-English-project-keyword'), ['客户A', 'ABC', '中文项目', 'very-long-English-project-keyword']);
});

test('Chinese and English punctuation and new lines all split keywords', () => {
  assert.deepEqual(splitKeywords('客户A，客户 B;项目C；Project D\n项目E|项目F'), ['客户A', '客户 B', '项目C', 'Project D', '项目E', '项目F']);
});
