const ZERO_USAGE = Object.freeze({
  uncachedInputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  outputTokens: 0
});

function normalizeUsage(value) {
  const source = value && typeof value === 'object' ? value : {};
  const result = {};
  for (const key of Object.keys(ZERO_USAGE)) {
    const number = Number(source[key]);
    result[key] = Number.isFinite(number) && number >= 0 ? Math.floor(number) : 0;
  }
  return result;
}

function addUsage(left, right) {
  const a = normalizeUsage(left);
  const b = normalizeUsage(right);
  return Object.fromEntries(Object.keys(ZERO_USAGE).map((key) => [key, a[key] + b[key]]));
}

function usageFromProjections(projections) {
  return normalizeUsage(projections?.values?.tokenUsage);
}

function summarizeTokenUsage(sessions) {
  const rows = sessions.map((session) => {
    const usage = normalizeUsage(session.usage);
    const inputTokens = usage.uncachedInputTokens + usage.cacheReadTokens + usage.cacheWriteTokens;
    return {
      sessionId: String(session.sessionId || ''),
      title: String(session.title || '').trim() || '未命名会话',
      updatedAt: Number(session.updatedAt) || 0,
      ...usage,
      inputTokens,
      totalTokens: inputTokens + usage.outputTokens
    };
  }).filter((row) => row.totalTokens > 0).sort((a, b) => b.updatedAt - a.updatedAt);

  const totals = rows.reduce((sum, row) => addUsage(sum, row), { ...ZERO_USAGE });
  totals.inputTokens = totals.uncachedInputTokens + totals.cacheReadTokens + totals.cacheWriteTokens;
  totals.totalTokens = totals.inputTokens + totals.outputTokens;
  return { totals, sessions: rows, sessionCount: rows.length };
}

module.exports = { ZERO_USAGE, addUsage, normalizeUsage, summarizeTokenUsage, usageFromProjections };
