/**
 * Vite emits `crossorigin` on module tags. Isolated `file://` sessions treat
 * that as CORS, so the login window never mounts React. Strip the attribute.
 */
export function stripCrossOriginAttributes(html: string): string {
  return html.replaceAll(/\s+crossorigin(?:="[^"]*")?/g, '');
}
