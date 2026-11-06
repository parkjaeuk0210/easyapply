export const HOSTED = !!process.env.VERCEL;
// A 24 MiB PDF becomes 32 MiB of base64, the provider's document payload limit.
export const MAX_UPLOAD_BYTES = 24 * 1024 * 1024;
// Larger hosted uploads go directly to private storage, outside the Function body.
export const DIRECT_UPLOAD_BYTES = HOSTED ? 4 * 1024 * 1024 : MAX_UPLOAD_BYTES;
