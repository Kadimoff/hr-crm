import assert from "node:assert/strict";
import { test } from "node:test";
import { isChunkLoadError } from "../src/lib/chunk-reload";

test("ChunkLoadError tanınır (webpack və dinamik import), digər xətalar yox", () => {
  const webpack = Object.assign(new Error("Loading chunk 8497 failed.\n(error: http://x/_next/static/chunks/8497-95e5dee5fa0b0597.js)"), { name: "ChunkLoadError" });
  assert.equal(isChunkLoadError(webpack), true);
  assert.equal(isChunkLoadError(new Error("Loading CSS chunk 123 failed")), true);
  assert.equal(isChunkLoadError(new TypeError("Failed to fetch dynamically imported module: http://x/a.js")), true);
  assert.equal(isChunkLoadError(new Error("Cannot read properties of undefined")), false);
  assert.equal(isChunkLoadError(null), false);
  assert.equal(isChunkLoadError("Loading chunk 1 failed"), false);
});
