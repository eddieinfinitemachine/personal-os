// Client-side image compression before upload.
//
// Anthropic's API rejects base64 images > 5MB. iPhone photos can be 3-4MB
// raw, which becomes 5-6MB once base64-encoded. Claude vision also doesn't
// benefit from images > 1568px on the longest edge (their docs).
//
// Resize on the client before upload: max longest edge 1568px, JPEG q=0.85.
// Typical photo drops from 3MB → 200-400KB. Also speeds up the upload.

const MAX_LONG_EDGE = 1568;
const JPEG_QUALITY = 0.85;

export async function compressImage(file: File): Promise<File> {
  // Non-images (or already-tiny files) pass through unchanged.
  if (!file.type.startsWith("image/")) return file;

  const img = await loadImage(file);
  const width = img.naturalWidth;
  const height = img.naturalHeight;
  const longest = Math.max(width, height);
  const scale = longest > MAX_LONG_EDGE ? MAX_LONG_EDGE / longest : 1;

  // Don't bother re-encoding if it's already small AND under 4MB.
  if (scale === 1 && file.size < 4 * 1024 * 1024) return file;

  const targetW = Math.round(width * scale);
  const targetH = Math.round(height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = targetW;
  canvas.height = targetH;

  const ctx = canvas.getContext("2d");
  if (!ctx) return file;
  ctx.drawImage(img, 0, 0, targetW, targetH);

  const blob: Blob | null = await new Promise((resolve) => {
    canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY);
  });
  if (!blob) return file;

  const baseName = file.name.replace(/\.[^.]+$/, "") || "capture";
  return new File([blob], `${baseName}.jpg`, {
    type: "image/jpeg",
    lastModified: Date.now(),
  });
}

// Loads a File into an <img> element with object-URL src so we can draw it
// to a canvas. Works everywhere including older iOS Safari.
export async function loadImage(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = (e) => reject(e);
      img.src = url;
    });
  } finally {
    // Revoke after the next tick so the image has finished decoding.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}
