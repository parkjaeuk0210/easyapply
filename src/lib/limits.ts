/**
 * Vercel 함수는 요청 본문을 4.5MB까지만 받는다(넘으면 함수에 닿기도 전에 413).
 * 배포 환경에서는 업로드 전체를 4MB 안으로 맞추고, 로컬에서는 넉넉하게 둔다.
 */
export const HOSTED = !!process.env.VERCEL;
export const MAX_UPLOAD_BYTES = HOSTED ? 4 * 1024 * 1024 : 25 * 1024 * 1024;
