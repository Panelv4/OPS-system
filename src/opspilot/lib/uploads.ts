export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
export function validateUpload(bytes: Uint8Array, filename: string): string {
  if (!bytes.length || bytes.length > MAX_UPLOAD_BYTES) throw new Error("Choose a file between 1 byte and 5 MB.");
  const extension = filename.toLowerCase().split(".").pop();
  const match = (signature: number[]) => signature.every((v, i) => bytes[i] === v);
  if (extension === "pdf" && match([0x25, 0x50, 0x44, 0x46, 0x2d])) return "application/pdf";
  if (extension === "png" && match([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (["jpg", "jpeg"].includes(extension ?? "") && match([0xff, 0xd8, 0xff])) return "image/jpeg";
  if (extension === "txt" && !bytes.includes(0)) {
    try { new TextDecoder("utf-8", { fatal: true }).decode(bytes); return "text/plain"; } catch { /* invalid text */ }
  }
  throw new Error("File contents do not match a supported PDF, PNG, JPEG, or UTF-8 text document.");
}
