// Upload limits, decided here once. This module is shared with the browser.

// A 24 MiB PDF becomes 32 MiB of base64.
export const MAX_UPLOAD_BYTES = 24 * 1024 * 1024;
// Anthropic rejects requests over 32 MB; base64 adds a third, plus prompt and schema.
export const ANTHROPIC_UPLOAD_BYTES = 22 * 1024 * 1024;
// Larger hosted uploads go directly to private storage, outside the Function body.
export const HOSTED_DIRECT_UPLOAD_BYTES = 4 * 1024 * 1024;

export function maxUploadBytes(provider: string) {
  return provider === "api" ? ANTHROPIC_UPLOAD_BYTES : MAX_UPLOAD_BYTES;
}

export function directUploadBytes(hosted: boolean, provider: string) {
  return hosted ? HOSTED_DIRECT_UPLOAD_BYTES : maxUploadBytes(provider);
}
