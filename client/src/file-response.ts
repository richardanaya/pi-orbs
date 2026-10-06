// How an uploaded file is served. Raster photos and video can render in <img> and
// <video>. SVG and any other image type stay attachments: a direct open of the
// file URL must not run script on this origin. Both the simulator and the sprite
// server use this so the rule cannot drift.

export const FILE_CONTENT_SECURITY_POLICY =
  "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox";

const RASTER_IMAGES = new Set([
  "image/apng",
  "image/avif",
  "image/bmp",
  "image/gif",
  "image/heic",
  "image/heif",
  "image/jpeg",
  "image/jpg",
  "image/pjpeg",
  "image/png",
  "image/tiff",
  "image/vnd.microsoft.icon",
  "image/webp",
  "image/x-icon",
  "image/x-ms-bmp",
]);

export function fileMediaType(mime: string): string {
  return mime.split(";", 1)[0]?.trim().toLowerCase() ?? "";
}

export function inlineFile(mime: string): boolean {
  const type = fileMediaType(mime);
  if (!type || type.includes("svg") || type.includes("+xml") || type.endsWith("/xml")) return false;
  if (type.startsWith("video/")) return true;
  return RASTER_IMAGES.has(type);
}

export function fileDisposition(mime: string, name: string): string {
  const filename = name.replace(/["\r\n]/g, "");
  return `${inlineFile(mime) ? "inline" : "attachment"}; filename="${filename}"`;
}

export function fileNameFromDisposition(disposition: string): string {
  const match = /filename="([^"]*)"/.exec(disposition);
  return match?.[1] || "file";
}

export function fileResponseHeaders(mime: string, name: string): Record<string, string> {
  return {
    "content-disposition": fileDisposition(mime, name),
    "x-content-type-options": "nosniff",
    "content-security-policy": FILE_CONTENT_SECURITY_POLICY,
  };
}
