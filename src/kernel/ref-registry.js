import { AragonError, ERROR_CODES } from "../shared/protocol.js";

/**
 * Ref registry: turns snapshot-local node identities into stable `@N` handles.
 *
 * Stability rule (this is the part agents actually depend on): a node keeps its
 * ref number as long as it stays in the same document. The document is
 * identified by (CDP session, frame, loaderId). A reload assigns a new loaderId,
 * so every ref captured before it is reported as stale instead of silently
 * pointing at whatever now occupies that backend id.
 */
export class RefRegistry {
  constructor() {
    this.entries = new Map(); // ref -> entry
    this.byKey = new Map(); // sessionId:backendNodeId:loaderId -> ref
    this.loaders = new Map(); // sessionId -> loaderId last seen
    this.nextRef = 1;
    this.spaceId = null;
  }

  setSpace(spaceId) {
    this.spaceId = spaceId;
    return this;
  }

  get size() {
    return this.entries.size;
  }

  /**
   * Record the node list from one snapshot, reusing refs for nodes that are
   * still in the same document. Returns the same list with final refs filled in.
   */
  absorb(nodes) {
    return nodes.map((node) => ({ ...node, ref: this.assign(node) }));
  }

  /**
   * Assign (or reuse) the ref for a single snapshot node. Called while the
   * snapshot text is being rendered, so the printed `@N` and the registry entry
   * are the same number by construction - no text rewriting pass.
   */
  assign(node) {
    const key = this.keyFor(node);
    const existingRef = this.byKey.get(key);
    if (existingRef !== undefined) {
      const existing = this.entries.get(existingRef);
      if (existing) {
        Object.assign(existing, {
          role: node.role,
          name: node.name,
          frameId: node.frameId,
          loaderId: node.loaderId,
          capturedAt: Date.now(),
        });
      }
      this.loaders.set(node.sessionId, node.loaderId ?? null);
      return existingRef;
    }
    const ref = this.nextRef++;
    this.byKey.set(key, ref);
    this.entries.set(ref, { ...node, ref, capturedAt: Date.now() });
    this.loaders.set(node.sessionId, node.loaderId ?? null);
    return ref;
  }

  keyFor(node) {
    return `${node.sessionId}:${node.backendNodeId}:${node.loaderId ?? "none"}`;
  }

  /** Resolve a `@N` (or "N") handle. Throws ARAGON_REF_* with a next action. */
  resolve(ref, loaderBySession) {
    const id = parseRef(ref);
    const entry = this.entries.get(id);
    if (!entry) {
      throw new AragonError(
        ERROR_CODES.REF_NOT_FOUND,
        `ref @${id} is unknown in this space; take a fresh snapshot and use a ref it prints`,
      );
    }
    const current = loaderBySession?.get?.(entry.sessionId);
    if (current !== undefined && current !== null) {
      if (entry.loaderId !== null && current !== entry.loaderId) {
        this.dropBySession(entry.sessionId);
        throw new AragonError(
          ERROR_CODES.REF_STALE,
          `ref @${id} belongs to a previous document (page reloaded); take a fresh snapshot`,
        );
      }
    }
    return entry;
  }

  dropBySession(sessionId) {
    for (const [ref, entry] of [...this.entries]) {
      if (entry.sessionId === sessionId) {
        this.entries.delete(ref);
        this.byKey.delete(this.keyFor(entry));
      }
    }
  }

  /** Invalidate everything captured for a session (navigation, tab close). */
  invalidateSession(sessionId, loaderId = null) {
    this.dropBySession(sessionId);
    if (loaderId !== null) this.loaders.set(sessionId, loaderId);
    else this.loaders.delete(sessionId);
  }

  reset() {
    this.entries.clear();
    this.byKey.clear();
    this.loaders.clear();
    this.nextRef = 1;
  }

  stats() {
    return { refs: this.entries.size, spaces: this.spaceId ? 1 : 0 };
  }
}

export function parseRef(ref) {
  if (typeof ref === "number" && Number.isInteger(ref) && ref > 0) return ref;
  if (typeof ref !== "string") {
    throw new AragonError(
      ERROR_CODES.INVALID_ARGUMENT,
      "ref must be a number or a string like @12",
    );
  }
  const trimmed = ref.trim();
  // Refs start at 1 (RefRegistry.nextRef), so "@0" is a malformed handle, not an
  // unknown one: failing here keeps it out of the transient-retry path.
  const match = /^@?([1-9]\d*)$/.exec(trimmed);
  if (!match) {
    throw new AragonError(
      ERROR_CODES.INVALID_ARGUMENT,
      `ref "${trimmed}" is not a @N handle`,
    );
  }
  return Number(match[1]);
}
