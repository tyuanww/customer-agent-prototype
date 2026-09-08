/** Map experiment `.js` specifiers to sibling `.ts` files for Node type stripping. */
export async function resolve(specifier, context, nextResolve) {
  if (typeof specifier === 'string' && specifier.endsWith('.js')) {
    try {
      return await nextResolve(`${specifier.slice(0, -3)}.ts`, context);
    } catch {
      // Real .js files keep the original specifier.
    }
  }
  return nextResolve(specifier, context);
}
