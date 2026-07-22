/**
 * Client-side avatar preparation: a phone photo becomes a 512×512 WebP
 * BEFORE it goes anywhere near the network.
 *
 * The original is never uploaded. A modern phone photo is several megabytes
 * of 4000px-wide JPEG; the avatar renders at 80px on the profile and 24px in
 * the feed, so uploading the original would cost the creator a slow upload
 * and every viewer a slow download, for pixels nobody sees.
 *
 * Center-crop rather than squash: faces are usually centred, and a squashed
 * face is worse than a cropped background.
 */

export const AVATAR_SIZE = 512;
export const AVATAR_QUALITY = 0.85;
export const AVATAR_CONTENT_TYPE = 'image/webp';

export type AvatarResult =
  | { ok: true; blob: Blob }
  | { ok: false; error: string };

/**
 * Decode, center-crop to a square, scale to 512×512, encode as WebP.
 *
 * createImageBitmap with imageOrientation:'from-image' applies EXIF rotation,
 * without which portrait phone photos land sideways — the camera records
 * orientation as metadata rather than rotating the pixels.
 */
export async function prepareAvatar(file: File): Promise<AvatarResult> {
  if (!file.type.startsWith('image/')) {
    return { ok: false, error: 'Pick an image file.' };
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    return { ok: false, error: 'Could not read that image. Try another one.' };
  }

  try {
    const side = Math.min(bitmap.width, bitmap.height);
    if (side === 0) return { ok: false, error: 'That image looks empty.' };
    const sx = Math.round((bitmap.width - side) / 2);
    const sy = Math.round((bitmap.height - side) / 2);

    const canvas = document.createElement('canvas');
    canvas.width = AVATAR_SIZE;
    canvas.height = AVATAR_SIZE;
    const ctx = canvas.getContext('2d');
    if (!ctx) return { ok: false, error: 'Could not process that image.' };
    ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, AVATAR_SIZE, AVATAR_SIZE);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, AVATAR_CONTENT_TYPE, AVATAR_QUALITY)
    );
    // toBlob yields null when the type is unsupported. Every browser Loro
    // targets encodes WebP, but failing clearly beats uploading nothing.
    if (!blob || blob.size === 0) {
      return { ok: false, error: 'Could not process that image.' };
    }
    return { ok: true, blob };
  } finally {
    bitmap.close();
  }
}
