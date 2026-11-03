/**
 * Loopback port pairs owned by the explicit runtime environments.
 *
 * The stack script and packaged desktop profile both consume this table so a
 * port cannot be reassigned in one process and rejected in the other.
 */
export const RUNTIME_PORT_PAIRS = Object.freeze({
  macSynthetic: Object.freeze({ api: 43100, identity: 43101 }),
  production: Object.freeze({ api: 43115, identity: 43116 }),
  wslTest: Object.freeze({ api: 43180, identity: 43181 }),
});

const productionPorts: ReadonlySet<number> = new Set<number>(Object.values(RUNTIME_PORT_PAIRS.production));
const reservedSyntheticPorts: ReadonlySet<number> = new Set<number>([
  ...Object.values(RUNTIME_PORT_PAIRS.production),
  ...Object.values(RUNTIME_PORT_PAIRS.wslTest),
]);

export function isProductionRuntimePort(port: number): boolean {
  return productionPorts.has(port);
}

export function isReservedSyntheticPort(port: number): boolean {
  return reservedSyntheticPorts.has(port);
}

export function isAdjacentPortPair(pair: { readonly api: number; readonly identity: number }): boolean {
  return Number.isSafeInteger(pair.api)
    && Number.isSafeInteger(pair.identity)
    && pair.identity === pair.api + 1;
}
