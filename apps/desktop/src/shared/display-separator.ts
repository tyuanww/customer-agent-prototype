/** Spaced slash. DESIGN.md forbids a middle dot in workbench copy. */
export const DISPLAY_SEPARATOR = ' / ';

export function joinDisplayParts(parts: readonly string[]): string {
  return parts.filter((part) => part.length > 0).join(DISPLAY_SEPARATOR);
}
