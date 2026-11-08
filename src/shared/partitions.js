/**
 * Session partition naming.
 *
 * Kept as a pure function so the isolation contract is unit-testable without
 * Electron: two spaces must never resolve to the same partition, and the
 * ephemeral profile must never write to disk.
 */
export const PROFILES = [
  { id: "default", name: "Default profile", kind: "persistent" },
  { id: "ephemeral", name: "Ephemeral profile (no disk writes)", kind: "memory" },
];

export function partitionFor(profileId, spaceId, profiles = PROFILES) {
  const profile = profiles.find((entry) => entry.id === profileId);
  if (!profile) return null;
  const prefix = profile.kind === "memory" ? "aragon-mem" : "persist:aragon";
  return `${prefix}-${profile.id}-space-${spaceId}`;
}

export function parsePartition(partition) {
  const match = /^(persist:aragon|aragon-mem)-(.+)-space-(\d+)$/.exec(String(partition));
  if (!match) return null;
  return {
    persistent: match[1] === "persist:aragon",
    profileId: match[2],
    spaceId: Number(match[3]),
  };
}
