import { h, s } from './ui.js';

// Shrinks a picked/pasted image so the database stays small. Photos become JPEG;
// logos pass { type: 'image/png', background: null } to keep their transparency.
export async function preparePhoto(file, { maxSide = 1400, type = 'image/jpeg', background = '#FFFFFF' } = {}) {
  if (!file.type.startsWith('image/')) throw new Error('Esse arquivo não é uma imagem.');
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  if (background) {
    ctx.fillStyle = background; // JPEG has no transparency; without this, clear areas of a PNG turn black.
    ctx.fillRect(0, 0, width, height);
  }
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const blob = await canvas.convertToBlob({ type, quality: 0.85 });
  return {
    blob,
    bytes: new Uint8Array(await blob.arrayBuffer()),
    mime: type,
    url: URL.createObjectURL(blob),
  };
}

// The app shows a small copy of each photo (much less memory to decode); `full` is the
// photo as it was saved, for the PDF catalog.
export function photoUrl(item, { full = false } = {}) {
  if (!item.photo_version) return null;
  return `photo://terrarium/${item.id}${full ? '/full' : ''}?v=${encodeURIComponent(item.photo_version)}`;
}

// The jar-shaped frame used for every terrarium picture.
export function jar(item, { size = '' } = {}) {
  const url = item && photoUrl(item);
  return h('div', { class: `jar ${size}`.trim() },
    url
      ? h('img', {
          src: url, alt: '', loading: 'lazy', decoding: 'async', draggable: false,
          onerror: (e) => e.target.replaceWith(sprout()),
        })
      : sprout(),
  );
}

export function sprout() {
  return s('svg', { class: 'jar-empty', viewBox: '0 0 48 48', 'aria-hidden': 'true' },
    s('path', { d: 'M24 40c0-11 3-18 13-21-1 10-6 15-13 16' }),
    s('path', { d: 'M24 40c0-8-3-13-11-15 0 8 4 12 11 13' }),
    s('path', { class: 'ground', d: 'M8 40h32' }),
  );
}
