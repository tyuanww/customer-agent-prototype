/** Header values must be Latin-1. Query text in Authorization is how the WIP check threw ByteString 20160 (什). */
export function requireHeaderByteString(name: string, value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code > 255) {
      throw new Error(`${name} is not a ByteString (U+${code.toString(16)} at ${String(index)})`);
    }
  }
}
