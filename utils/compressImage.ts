export type ImagePreset = 'background' | 'sprite' | 'icon';

export const IMAGE_PRESET_MAX_EDGE: Record<ImagePreset, number> = {
  background: 1920,
  sprite: 1536,
  icon: 512,
};

export const DEFAULT_IMAGE_QUALITY = 0.85;

export interface CompressImageResult {
  blob: Blob;
  mime: string;
  width?: number;
  height?: number;
  originalBytes: number;
  compressedBytes: number;
  wasCompressed: boolean;
  skippedReason?: string;
}

/**
 * Checks whether a GIF buffer contains 2 or more image frames (animated GIF).
 */
export const isAnimatedGif = (buffer: ArrayBuffer): boolean => {
  const bytes = new Uint8Array(buffer);
  if (bytes.length < 13) return false;
  // Check GIF87a / GIF89a signature
  if (
    bytes[0] !== 0x47 ||
    bytes[1] !== 0x49 ||
    bytes[2] !== 0x46 ||
    bytes[3] !== 0x38 ||
    (bytes[4] !== 0x37 && bytes[4] !== 0x39) ||
    bytes[5] !== 0x61
  ) {
    return false;
  }

  let offset = 10;
  const packed = bytes[offset++];
  offset += 2; // background color index + pixel aspect ratio
  if (packed & 0x80) {
    const gctSize = 3 * (1 << ((packed & 0x07) + 1));
    offset += gctSize;
  }

  let frames = 0;
  while (offset < bytes.length) {
    const blockId = bytes[offset++];
    if (blockId === 0x3b) {
      // Trailer
      break;
    }
    if (blockId === 0x2c) {
      // Image Descriptor
      frames++;
      if (frames >= 2) return true;
      if (offset + 9 > bytes.length) break;
      const imgPacked = bytes[offset + 8];
      offset += 9;
      if (imgPacked & 0x80) {
        const lctSize = 3 * (1 << ((imgPacked & 0x07) + 1));
        offset += lctSize;
      }
      if (offset >= bytes.length) break;
      offset++; // LZW minimum code size
      while (offset < bytes.length) {
        const subLen = bytes[offset++];
        if (subLen === 0) break;
        offset += subLen;
      }
    } else if (blockId === 0x21) {
      // Extension block
      if (offset >= bytes.length) break;
      offset++; // extension label
      while (offset < bytes.length) {
        const subLen = bytes[offset++];
        if (subLen === 0) break;
        offset += subLen;
      }
    } else {
      break;
    }
  }

  return false;
};

interface DecodedImage {
  source: ImageBitmap | HTMLImageElement;
  width: number;
  height: number;
  cleanup: () => void;
}

const decodeImage = async (blob: Blob): Promise<DecodedImage> => {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(blob);
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        cleanup: () => bitmap.close(),
      };
    } catch {
      // Fallback to HTMLImageElement below
    }
  }

  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = (err) => reject(err);
      el.src = url;
    });
    return {
      source: img,
      width: img.naturalWidth || img.width,
      height: img.naturalHeight || img.height,
      cleanup: () => URL.revokeObjectURL(url),
    };
  } catch (err) {
    URL.revokeObjectURL(url);
    throw err;
  }
};

const encodeToWebP = async (
  source: CanvasImageSource,
  targetW: number,
  targetH: number,
  quality: number
): Promise<Blob | null> => {
  if (typeof OffscreenCanvas !== 'undefined') {
    try {
      const canvas = new OffscreenCanvas(targetW, targetH);
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(source, 0, 0, targetW, targetH);
        const out = await canvas.convertToBlob({ type: 'image/webp', quality });
        if (out && out.type === 'image/webp') return out;
      }
    } catch {
      // Fall back to HTMLCanvasElement
    }
  }

  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.drawImage(source, 0, 0, targetW, targetH);
      const out = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob((b) => resolve(b), 'image/webp', quality)
      );
      if (out && out.type === 'image/webp') return out;
    }
  }

  return null;
};

/**
 * Compresses and optionally downscales an image Blob to WebP while preserving alpha.
 * Keeps the original if SVG, animated GIF, unsupported, or if WebP output is not smaller.
 */
export const compressImage = async (
  input: Blob,
  preset: ImagePreset = 'background',
  options?: { quality?: number }
): Promise<CompressImageResult> => {
  const quality = options?.quality ?? DEFAULT_IMAGE_QUALITY;
  const mime = (input.type || '').toLowerCase();
  const originalBytes = input.size;

  if (mime === 'image/svg+xml') {
    return {
      blob: input,
      mime: input.type || 'image/svg+xml',
      originalBytes,
      compressedBytes: originalBytes,
      wasCompressed: false,
      skippedReason: 'svg',
    };
  }

  if (mime && !mime.startsWith('image/')) {
    return {
      blob: input,
      mime: input.type || 'application/octet-stream',
      originalBytes,
      compressedBytes: originalBytes,
      wasCompressed: false,
      skippedReason: 'not-image',
    };
  }

  if (mime === 'image/gif') {
    try {
      const buf = await input.arrayBuffer();
      if (isAnimatedGif(buf)) {
        return {
          blob: input,
          mime: 'image/gif',
          originalBytes,
          compressedBytes: originalBytes,
          wasCompressed: false,
          skippedReason: 'animated-gif',
        };
      }
    } catch {
      // proceed to normal decoding fallback
    }
  }

  let decoded: DecodedImage | null = null;
  try {
    decoded = await decodeImage(input);
    const { width, height } = decoded;
    if (!width || !height) {
      return {
        blob: input,
        mime: input.type || 'image/png',
        originalBytes,
        compressedBytes: originalBytes,
        wasCompressed: false,
        skippedReason: 'empty-dimensions',
      };
    }

    const maxEdge = IMAGE_PRESET_MAX_EDGE[preset];
    const longest = Math.max(width, height);
    const scale = longest > maxEdge ? maxEdge / longest : 1;
    const targetW = Math.max(1, Math.round(width * scale));
    const targetH = Math.max(1, Math.round(height * scale));

    const outBlob = await encodeToWebP(decoded.source, targetW, targetH, quality);
    if (!outBlob || outBlob.type !== 'image/webp' || outBlob.size >= originalBytes) {
      return {
        blob: input,
        mime: input.type || 'image/png',
        width,
        height,
        originalBytes,
        compressedBytes: originalBytes,
        wasCompressed: false,
        skippedReason: !outBlob ? 'encode-failed' : 'not-smaller',
      };
    }

    return {
      blob: outBlob,
      mime: 'image/webp',
      width: targetW,
      height: targetH,
      originalBytes,
      compressedBytes: outBlob.size,
      wasCompressed: true,
    };
  } catch (err) {
    console.warn('compressImage fallback to original:', err);
    return {
      blob: input,
      mime: input.type || 'image/png',
      originalBytes,
      compressedBytes: originalBytes,
      wasCompressed: false,
      skippedReason: 'decode-error',
    };
  } finally {
    decoded?.cleanup();
  }
};
