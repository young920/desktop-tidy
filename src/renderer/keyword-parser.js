(function exposeKeywordParser(global) {
  function splitKeywords(value) {
    return String(value || '')
      .split(/[,，;；|\n\r]+/)
      .map(keyword => keyword.trim())
      .filter(Boolean);
  }

  const api = { splitKeywords };
  if (typeof module !== 'undefined') module.exports = api;
  if (global) global.KeywordParser = api;
})(typeof window === 'undefined' ? null : window);
