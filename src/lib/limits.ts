export const HOSTED = !!process.env.VERCEL;
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
// Larger hosted uploads go directly to private storage, outside the Function body.
export const DIRECT_UPLOAD_BYTES = HOSTED ? 4 * 1024 * 1024 : MAX_UPLOAD_BYTES;
