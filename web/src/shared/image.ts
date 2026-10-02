// Подготовка фото к загрузке (КАТ-7): поворот по снимку, уменьшение, JPEG. Фото перерисовывается на холсте,
// поэтому служебные данные снимка (EXIF: геолокация, модель телефона, время) в файл не попадают.

const MAX_INPUT = 40 * 1024 * 1024;

async function decode(file: Blob): Promise<ImageBitmap | HTMLImageElement> {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    // Старые браузеры: через <img> (тоже учитывает поворот снимка).
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return img;
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

function encode(source: ImageBitmap | HTMLImageElement, maxSide: number, quality: number): Promise<Blob> {
  const width = 'naturalWidth' in source ? source.naturalWidth : source.width;
  const height = 'naturalHeight' in source ? source.naturalHeight : source.height;
  const scale = Math.min(1, maxSide / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext('2d');
  if (!context) return Promise.reject(new Error('canvas'));
  // Белая подложка: у PNG с прозрачностью фон не станет чёрным.
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('toBlob'))), 'image/jpeg', quality),
  );
}

/** Фото для каталога: основное до 1280 px и уменьшенная копия 240 px для списков. */
export async function preparePhoto(file: Blob): Promise<{ full: Blob; thumb: Blob }> {
  if (!file.type.startsWith('image/') || file.size > MAX_INPUT) throw new Error('not-image');
  const source = await decode(file);
  try {
    return { full: await encode(source, 1280, 0.82), thumb: await encode(source, 240, 0.8) };
  } finally {
    if ('close' in source) source.close();
  }
}
