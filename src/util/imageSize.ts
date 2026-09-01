/**
 * Intrinsic pixel size of an image, read from its header.
 *
 * Two things need it: the effective-dpi check before export (SPEC 5.8(6)) and
 * the `width` / `height` attributes that let the page break in one layout pass
 * instead of reflowing when images arrive (SPEC 5.8(5)).
 */
export interface ImageSize {
  width: number;
  height: number;
}

export function imageSize(bytes: Uint8Array, path: string): ImageSize | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (isPng(bytes)) return pngSize(view);
  if (isGif(bytes)) return { width: view.getUint16(6, true), height: view.getUint16(8, true) };
  if (isBmp(bytes)) return { width: view.getInt32(18, true), height: Math.abs(view.getInt32(22, true)) };
  if (isJpeg(bytes)) return jpegSize(view);
  if (isWebp(bytes)) return webpSize(bytes, view);
  if (path.toLowerCase().endsWith(".svg")) return svgSize(bytes);
  return null;
}

function isPng(b: Uint8Array): boolean {
  return b.length > 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
}

function pngSize(view: DataView): ImageSize {
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

function isGif(b: Uint8Array): boolean {
  return b.length > 10 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46;
}

function isBmp(b: Uint8Array): boolean {
  return b.length > 26 && b[0] === 0x42 && b[1] === 0x4d;
}

function isJpeg(b: Uint8Array): boolean {
  return b.length > 4 && b[0] === 0xff && b[1] === 0xd8;
}

function jpegSize(view: DataView): ImageSize | null {
  let offset = 2;
  while (offset + 9 < view.byteLength) {
    if (view.getUint8(offset) !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = view.getUint8(offset + 1);
    // SOF0-SOF15, excluding the non-frame markers DHT / JPG / DAC.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return {
        height: view.getUint16(offset + 5),
        width: view.getUint16(offset + 7),
      };
    }
    offset += 2 + view.getUint16(offset + 2);
  }
  return null;
}

function isWebp(b: Uint8Array): boolean {
  return (
    b.length > 30 &&
    b[0] === 0x52 &&
    b[1] === 0x49 &&
    b[2] === 0x46 &&
    b[3] === 0x46 &&
    b[8] === 0x57 &&
    b[9] === 0x45 &&
    b[10] === 0x42 &&
    b[11] === 0x50
  );
}

function webpSize(bytes: Uint8Array, view: DataView): ImageSize | null {
  const format = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]);
  if (format === "VP8 ") {
    return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff };
  }
  if (format === "VP8L") {
    const bits = view.getUint32(21, true);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (format === "VP8X") {
    const width = 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16));
    const height = 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16));
    return { width, height };
  }
  return null;
}

/** SVG is vector, but the declared size is still needed for layout. */
function svgSize(bytes: Uint8Array): ImageSize | null {
  const head = new TextDecoder().decode(bytes.slice(0, 2048));
  const viewBox = head.match(/viewBox\s*=\s*["']\s*[\d.-]+[ ,]+[\d.-]+[ ,]+([\d.]+)[ ,]+([\d.]+)/i);
  if (viewBox) return { width: Math.round(Number(viewBox[1])), height: Math.round(Number(viewBox[2])) };
  const width = head.match(/\bwidth\s*=\s*["']([\d.]+)/i);
  const height = head.match(/\bheight\s*=\s*["']([\d.]+)/i);
  if (width && height) return { width: Math.round(Number(width[1])), height: Math.round(Number(height[1])) };
  return null;
}

const MM_PER_INCH = 25.4;

/** Effective resolution of an image placed at a physical width (SPEC 5.8(6)). */
export function effectiveDpi(pixelWidth: number, physicalWidthMm: number): number {
  if (physicalWidthMm <= 0) return 0;
  return Math.round(pixelWidth / (physicalWidthMm / MM_PER_INCH));
}

/** CSS px are 96 to the inch by definition. */
export function pxToMm(px: number): number {
  return (px / 96) * MM_PER_INCH;
}

export function mmToPx(mm: number): number {
  return (mm / MM_PER_INCH) * 96;
}
