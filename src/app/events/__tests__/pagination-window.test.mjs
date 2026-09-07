import { test } from "node:test";
import assert from "node:assert/strict";

import { computePageWindow } from "../pagination-window.ts";

test("a single page shows just page 1, no ellipsis", () => {
  assert.deepEqual(computePageWindow(1, 1), [1]);
});

test("a small total (fits with no gaps) shows every page, no ellipsis", () => {
  assert.deepEqual(computePageWindow(2, 4), [1, 2, 3, 4]);
});

test("current page in the middle of a large range shows one ellipsis on each side", () => {
  assert.deepEqual(computePageWindow(30, 59), [1, "ellipsis", 29, 30, 31, "ellipsis", 59]);
});

test("current page at the very start of a large range shows only a trailing ellipsis", () => {
  assert.deepEqual(computePageWindow(1, 59), [1, 2, "ellipsis", 59]);
});

test("current page at the very end of a large range shows only a leading ellipsis", () => {
  assert.deepEqual(computePageWindow(59, 59), [1, "ellipsis", 58, 59]);
});

test("never renders more than a small, bounded number of page items regardless of total size", () => {
  const window = computePageWindow(500, 10000);
  assert.ok(window.length <= 7, `expected a compact window, got ${window.length} items: ${JSON.stringify(window)}`);
});

test("the current page is always present in its own window", () => {
  for (const current of [1, 15, 30, 59]) {
    const window = computePageWindow(current, 59);
    assert.ok(window.includes(current), `expected page ${current} to appear in its own window`);
  }
});
