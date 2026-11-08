import assert from "node:assert/strict";
import test from "node:test";
import { RefRegistry, parseRef } from "../src/kernel/ref-registry.js";

const node = (overrides = {}) => ({
  sessionId: "root",
  backendNodeId: 11,
  frameId: "F1",
  loaderId: "L1",
  role: "button",
  name: "Go",
  ...overrides,
});

test("same node in the same document keeps its ref across snapshots", () => {
  const registry = new RefRegistry();
  const first = registry.assign(node());
  const second = registry.assign(node());
  assert.equal(first, 1);
  assert.equal(second, first, "refs must be stable within one document");
  assert.equal(registry.size, 1);
});

test("a reload assigns fresh refs and reports the old ones stale", () => {
  const registry = new RefRegistry();
  registry.assign(node({ loaderId: "L1" }));
  assert.throws(
    () => registry.resolve("@1", new Map([["root", "L2"]])),
    (error) => error.error_code === "ARAGON_REF_STALE",
  );
  assert.equal(registry.size, 0, "stale refs are dropped, not left dangling");
});

test("unknown ref is ARAGON_REF_NOT_FOUND with a next action", () => {
  const registry = new RefRegistry();
  assert.throws(
    () => registry.resolve("@99", new Map()),
    (error) =>
      error.error_code === "ARAGON_REF_NOT_FOUND" && /snapshot/.test(error.message),
  );
});

test("two frames never share a ref number", () => {
  const registry = new RefRegistry();
  const a = registry.assign(node({ backendNodeId: 1 }));
  const b = registry.assign(node({ sessionId: "child", backendNodeId: 1 }));
  assert.notEqual(a, b);
  assert.equal(registry.size, 2);
});

test("parseRef accepts @3, 3 and rejects prose", () => {
  assert.equal(parseRef("@3"), 3);
  assert.equal(parseRef(3), 3);
  assert.equal(parseRef("  @12 "), 12);
  assert.throws(() => parseRef("the third button"), /not a @N handle/);
});
