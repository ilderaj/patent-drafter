const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** Short random id for local entities. Not for secrets. */
export function newId(prefix: string, length = 10): string {
  let out = "";
  const bytes = new Uint8Array(length);
  if (typeof globalThis.crypto !== "undefined" && "getRandomValues" in globalThis.crypto) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  for (let i = 0; i < length; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return `${prefix}_${out}`;
}
