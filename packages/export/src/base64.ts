/**
 * Environment-neutral base64 / text helpers (browser + Node >= 16 globals).
 * No Buffer dependency so the same code runs in the browser bundle.
 */

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function utf8Bytes(s: string): Uint8Array {
  return encoder.encode(s);
}

export function utf8String(b: Uint8Array): string {
  return decoder.decode(b);
}

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
