/**
 * Encrypted project backup (.patentpack): envelope JSON
 * { v, alg, salt, iv, ciphertext } with PBKDF2-SHA-256 (200,000 iterations)
 * key derivation and AES-256-GCM payload encryption, via WebCrypto so it runs
 * identically in browser and Node. The file itself never contains plaintext
 * project content.
 */
import { base64ToBytes, bytesToBase64, utf8Bytes, utf8String } from "./base64.ts";

export const PATENTPACK_VERSION = 1 as const;
export const PATENTPACK_ALG = "PBKDF2-SHA256-AESGCM-200000" as const;
export const PATENTPACK_ITERATIONS = 200_000;

export interface PatentPackEnvelope {
  v: typeof PATENTPACK_VERSION;
  alg: typeof PATENTPACK_ALG;
  salt: string;
  iv: string;
  ciphertext: string;
}

function subtle(): SubtleCrypto {
  const c = globalThis.crypto;
  if (!c?.subtle) throw new Error("WebCrypto unavailable in this environment");
  return c.subtle;
}

function randomBytes(n: number): Uint8Array {
  const b = new Uint8Array(n);
  globalThis.crypto.getRandomValues(b);
  return b;
}

/** Copy to a fresh ArrayBuffer (WebCrypto BufferSource typing). */
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buf = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buf).set(bytes);
  return buf;
}

async function deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const material = await subtle().importKey("raw", toArrayBuffer(utf8Bytes(passphrase)), "PBKDF2", false, [
    "deriveKey",
  ]);
  return subtle().deriveKey(
    { name: "PBKDF2", salt: toArrayBuffer(salt), iterations: PATENTPACK_ITERATIONS, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function buildPatentPack(snapshot: unknown, passphrase: string): Promise<Uint8Array> {
  if (!passphrase) throw new Error("patentpack export requires a non-empty passphrase");
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = await deriveKey(passphrase, salt);
  const plain = utf8Bytes(JSON.stringify(snapshot));
  const ciphertext = new Uint8Array(await subtle().encrypt({ name: "AES-GCM", iv: toArrayBuffer(iv) }, key, toArrayBuffer(plain)));
  const envelope: PatentPackEnvelope = {
    v: PATENTPACK_VERSION,
    alg: PATENTPACK_ALG,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(ciphertext),
  };
  return utf8Bytes(JSON.stringify(envelope));
}

export async function openPatentPack(data: Uint8Array, passphrase: string): Promise<unknown> {
  let envelope: PatentPackEnvelope;
  try {
    envelope = JSON.parse(utf8String(data)) as PatentPackEnvelope;
  } catch {
    throw new Error("not a valid patentpack envelope");
  }
  if (envelope.v !== PATENTPACK_VERSION) throw new Error(`unsupported patentpack version: ${envelope.v}`);
  if (envelope.alg !== PATENTPACK_ALG) throw new Error(`unsupported patentpack algorithm: ${envelope.alg}`);
  const key = await deriveKey(passphrase, base64ToBytes(envelope.salt));
  const plain = await subtle().decrypt(
    { name: "AES-GCM", iv: toArrayBuffer(base64ToBytes(envelope.iv)) },
    key,
    toArrayBuffer(base64ToBytes(envelope.ciphertext)),
  );
  return JSON.parse(utf8String(new Uint8Array(plain)));
}
