/**
 * SHA-256 hex digest. Uses WebCrypto when available (browser / modern node);
 * otherwise falls back to a non-cryptographic digest clearly marked as such.
 */
export async function sha256Hex(input: string): Promise<string> {
  if (typeof globalThis.crypto !== "undefined" && "subtle" in globalThis.crypto) {
    const buf = new TextEncoder().encode(input);
    const digest = await globalThis.crypto.subtle.digest("SHA-256", buf);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }
  return fnv1aHex(input);
}

/** Non-cryptographic fallback (FNV-1a 64-ish via two 32-bit lanes). */
export function fnv1aHex(input: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    h1 ^= c;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= c >>> 1;
    h2 = Math.imul(h2, 0x01000193);
  }
  return `${h1 >>> 0}${h2 >>> 0}`.padStart(16, "0");
}
