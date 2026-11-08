import assert from "node:assert/strict";
import test from "node:test";
import { partitionFor, parsePartition, PROFILES } from "../src/shared/partitions.js";

test("two spaces on the same profile never share a partition", () => {
  const a = partitionFor("default", 1);
  const b = partitionFor("default", 2);
  assert.notEqual(a, b);
  assert.equal(a, "persist:aragon-default-space-1");
});

test("the ephemeral profile never resolves to a disk partition", () => {
  const partition = partitionFor("ephemeral", 3);
  assert.ok(partition);
  assert.ok(!partition.startsWith("persist:"), `unexpected persistent partition ${partition}`);
  assert.equal(parsePartition(partition).persistent, false);
});

test("an unknown profile resolves to null so the caller can raise a real error", () => {
  assert.equal(partitionFor("nope", 1), null);
});

test("partitions round-trip through parsePartition", () => {
  for (const profile of PROFILES) {
    for (const spaceId of [1, 7, 4096]) {
      const parsed = parsePartition(partitionFor(profile.id, spaceId));
      assert.equal(parsed.profileId, profile.id);
      assert.equal(parsed.spaceId, spaceId);
      assert.equal(parsed.persistent, profile.kind !== "memory");
    }
  }
  assert.equal(parsePartition("garbage"), null);
});
