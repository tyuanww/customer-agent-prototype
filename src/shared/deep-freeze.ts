export function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    if (!Object.isFrozen(value)) {
      Object.freeze(value);
    }
    for (const inner of Object.values(value)) {
      deepFreeze(inner);
    }
  }
  return value;
}
