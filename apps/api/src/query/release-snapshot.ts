import {
  parseReleaseSnapshot,
  type ReleaseSnapshot,
} from '@customer-agent/unified-contracts';

/**
 * The only read port for the ARC release snapshot. A store never assigns a
 * release identity and never mutates the snapshot it returns.
 */
export type ReleaseStore = Readonly<{
  current: () => Promise<ReleaseSnapshot | null>;
}>;

export class ReleaseSnapshotError extends Error {
  readonly code = 'RELEASE_SNAPSHOT_INVALID';

  constructor() {
    super('current release snapshot is invalid');
    this.name = 'ReleaseSnapshotError';
  }
}

function freezeSnapshot(value: ReleaseSnapshot): ReleaseSnapshot {
  const content = Object.freeze({ ...value.content });
  const sop = Object.freeze({ ...value.sop });
  return Object.freeze({ ...value, content, sop });
}

/**
 * Reads the current release through an injected, actor-bound source. The ARC
 * parser is the runtime boundary, so a malformed or mixed release projection
 * cannot leak into query ranking.
 */
export function createReleaseStore(
  read: () => Promise<unknown | null>,
): ReleaseStore {
  return Object.freeze({
    async current(): Promise<ReleaseSnapshot | null> {
      const value = await read();
      if (value === null) return null;
      try {
        return freezeSnapshot(parseReleaseSnapshot(value));
      } catch {
        throw new ReleaseSnapshotError();
      }
    },
  });
}
