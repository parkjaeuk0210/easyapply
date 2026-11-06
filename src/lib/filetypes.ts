export const FILE_ACCEPT = ".pdf,.hwp,.hwpx,image/png,image/jpeg,image/webp,image/gif";
export function fileMediaType(name: string, type: string) {
  const extension = name.toLowerCase().split(".").pop();
  if (extension === "hwp") return "application/x-hwp";
  if (extension === "hwpx") return "application/hwp+zip";
  if (!type || type === "application/octet-stream") return ({ pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif" } as Record<string, string>)[extension ?? ""] ?? type;
  return type;
}
export const SUPPORTED_TYPES = ["application/pdf", "application/x-hwp", "application/hwp+zip", "image/png", "image/jpeg", "image/webp", "image/gif"];
