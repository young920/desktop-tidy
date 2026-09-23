(function exposePlanInteractions(global) {
  function removePlannedItem(plan, id) {
    const item = plan?.items?.find(candidate => candidate.id === id);
    if (!item) return false;
    item.selected = false;
    return true;
  }

  function groupPlanItems(plan) {
    const groups = new Map();
    for (const target of plan?.targets || []) groups.set(target.targetDir, { ...target, items: [] });
    for (const item of plan?.items || []) {
      if (!groups.has(item.targetDir)) groups.set(item.targetDir, { targetDir: item.targetDir, bucket: item.bucket, items: [] });
      if (item.selected) groups.get(item.targetDir).items.push(item);
    }
    return [...groups.values()];
  }

  function addPreviewTarget(plan, target) {
    if (!plan || !target?.targetDir || !target.bucket) return false;
    plan.targets ||= [];
    if (plan.targets.some(existing => existing.targetDir === target.targetDir)) return false;
    plan.targets.push(target);
    return true;
  }

  function isValidTargetName(name) {
    return typeof name === 'string' && Boolean(name.trim()) && !/[\\/:*?"<>|]/.test(name);
  }

  function resetPreview() { return null; }

  const api = { removePlannedItem, groupPlanItems, addPreviewTarget, isValidTargetName, resetPreview };
  if (typeof module !== 'undefined') module.exports = api;
  if (global) global.PlanInteractions = api;
})(typeof window === 'undefined' ? null : window);
