"use client";

/**
 * Axon · Profile image preparation
 *
 * Turns a picked file into the `data:image/jpeg;base64` URL the profile
 * stores: decoded in the browser, cover-cropped to the target box and
 * re-encoded, so an 8 MB camera shot becomes a few dozen KB before it is
 * sent. Cortex re-checks the byte ceiling (`types/profile.ts`).
 */

import { IMAGE_MIME_TYPES, dataUrlBytes } from "@/types/profile";

export type ImageBox = { width: number; height: number; maxBytes: number };

export class ImageError extends Error {
  constructor(public code: "type" | "decode" | "size") {
    super(code);
    this.name = "ImageError";
  }
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new ImageError("decode"));
    };
    img.src = url;
  });
}

/** Cover-crop `file` into `box` and return a JPEG data URL, stepping quality down until it fits. */
export async function prepareImage(file: File, box: ImageBox): Promise<string> {
  if (!(IMAGE_MIME_TYPES as readonly string[]).includes(file.type)) throw new ImageError("type");
  const img = await loadImage(file);

  const scale = Math.max(box.width / img.naturalWidth, box.height / img.naturalHeight);
  const sw = Math.min(img.naturalWidth, box.width / scale);
  const sh = Math.min(img.naturalHeight, box.height / scale);
  const sx = (img.naturalWidth - sw) / 2;
  const sy = (img.naturalHeight - sh) / 2;

  const canvas = document.createElement("canvas");
  canvas.width = box.width;
  canvas.height = box.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new ImageError("decode");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, box.width, box.height);

  for (const quality of [0.86, 0.78, 0.68, 0.58]) {
    const url = canvas.toDataURL("image/jpeg", quality);
    if (dataUrlBytes(url) <= box.maxBytes) return url;
  }
  throw new ImageError("size");
}
