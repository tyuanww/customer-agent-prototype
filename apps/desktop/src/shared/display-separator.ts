/**
 * The one separator workbench copy uses between parts of a compound label, for example a scope
 * written as shop, domain and source. Producers join with it and the renderer splits on it, so
 * the two never disagree about what the label looks like.
 *
 * It is a spaced slash rather than a middle dot: the design rule for the workbench forbids `·` as
 * a separator (DESIGN.md, Copy).
 */
export const DISPLAY_SEPARATOR = ' / ';

export function joinDisplayParts(parts: readonly string[]): string {
  return parts.filter((part) => part.length > 0).join(DISPLAY_SEPARATOR);
}
