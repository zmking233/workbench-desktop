const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeUsage, summarizeTokenUsage, usageFromProjections } = require('../src/lib/token-stats.cjs');

test('normalizes invalid usage without inventing values', () => {
  assert.deepEqual(normalizeUsage({ uncachedInputTokens: 12.8, outputTokens: -2 }), {
    uncachedInputTokens: 12,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 0
  });
});

test('reads the official tokenUsage projection shape', () => {
  assert.deepEqual(usageFromProjections({ values: { tokenUsage: { uncachedInputTokens: 10, cacheReadTokens: 20, cacheWriteTokens: 3, outputTokens: 7 } } }), {
    uncachedInputTokens: 10,
    cacheReadTokens: 20,
    cacheWriteTokens: 3,
    outputTokens: 7
  });
});

test('summarizes sessions and excludes empty rows', () => {
  const result = summarizeTokenUsage([
    { sessionId: 'a', title: 'A', updatedAt: 1, usage: { uncachedInputTokens: 10, cacheReadTokens: 5, cacheWriteTokens: 1, outputTokens: 4 } },
    { sessionId: 'b', title: 'B', updatedAt: 2, usage: {} }
  ]);
  assert.equal(result.sessionCount, 1);
  assert.equal(result.totals.inputTokens, 16);
  assert.equal(result.totals.outputTokens, 4);
  assert.equal(result.totals.totalTokens, 20);
});

test('returns a complete zero snapshot for a new installation', () => {
  const result = summarizeTokenUsage([]);
  assert.equal(result.sessionCount, 0);
  assert.deepEqual(result.totals, {
    uncachedInputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 0,
    inputTokens: 0,
    totalTokens: 0
  });
});
