/** SHA-256 hex of bytes, with the platform's WebCrypto. */
export async function sha256Bytes(bytes: BufferSource): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** SHA-256 hex of a string's UTF-8 bytes. */
export function sha256Hex(text: string): Promise<string> {
  return sha256Bytes(new TextEncoder().encode(text));
}

/** The range reference: SHA-256 of per-ayah hashes joined with "\n" (the contract's rangeSha256). */
export function digestOf(hashes: readonly string[]): Promise<string> {
  return sha256Hex(hashes.join('\n'));
}
