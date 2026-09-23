const test = require('node:test');
const assert = require('node:assert/strict');
const { removePlannedItem, groupPlanItems, addPreviewTarget, isValidTargetName, resetPreview } = require('../src/renderer/plan-interactions.js');

test('removing a planned file changes only the matching item', () => {
  const plan = { items: [{ id: 'first', selected: true }, { id: 'second', selected: true }] };
  assert.equal(removePlannedItem(plan, 'second'), true);
  assert.equal(plan.items[0].selected, true);
  assert.equal(plan.items[1].selected, false);
});

test('an unknown removal id is ignored rather than throwing', () => {
  const plan = { items: [{ id: 'first', selected: true }] };
  assert.equal(removePlannedItem(plan, 'not-present'), false);
  assert.equal(plan.items[0].selected, true);
});

test('an empty target remains in the preview after its last file is removed', () => {
  const plan = { items: [{ id: 'only', targetDir: '待确认/2026-07', bucket: '待确认/2026-07', selected: true }] };
  removePlannedItem(plan, 'only');
  const groups = groupPlanItems(plan);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].targetDir, '待确认/2026-07');
  assert.deepEqual(groups[0].items, []);
});

test('a new target is retained even when it has no files yet', () => {
  const plan = { items: [], targets: [] };
  assert.equal(addPreviewTarget(plan, { targetDir: '进行中/新项目', bucket: '进行中/新项目' }), true);
  assert.equal(groupPlanItems(plan)[0].bucket, '进行中/新项目');
});

test('new target names allow Chinese and English but reject path characters', () => {
  assert.equal(isValidTargetName('生态环境厅 Project A'), true);
  assert.equal(isValidTargetName('项目/2026'), false);
});

test('resetting the preview clears only its in-memory plan', () => {
  assert.equal(resetPreview({ items: [{ id: 'file' }] }), null);
});
