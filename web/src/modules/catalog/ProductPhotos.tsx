// Фото в карточке товара (КАТ-7): галерея для всех; добавить, найти в Open Food Facts и удалить —
// владельцу и управляющему.
import { useRef, useState } from 'react';
import type { ProductPhoto } from '../../api/catalog';
import { downloadOffImage, findOffPhoto } from '../../api/openFoodFacts';
import { deleteProductPhoto, photoUrl, uploadProductPhoto } from '../../api/photos';
import { barcodeVariants } from '../../shared/barcode';
import { ru } from '../../shared/i18n/ru';
import { preparePhoto } from '../../shared/image';
import { Row, RowAction, Section } from '../../shared/ui/List';

const OFF_SITE = 'https://world.openfoodfacts.org';

/** Галерея: одно фото — квадрат, несколько — листаются пальцем, как в App Store. */
export function PhotoGallery({ photos, name }: { photos: readonly ProductPhoto[]; name: string }) {
  if (photos.length === 0) return null;
  return (
    <>
      <div className="gallery" aria-label={ru.catalog.card.photos.title}>
        {photos.map((photo, i) => (
          <img
            key={photo.path}
            className="gallery-photo"
            src={photoUrl(photo.path)}
            alt={photos.length > 1 ? `${name} — ${ru.catalog.card.photo(i + 1, photos.length)}` : name}
            loading={i === 0 ? 'eager' : 'lazy'}
            decoding="async"
          />
        ))}
      </div>
      {photos.some((p) => p.source === 'openfoodfacts') && (
        <p className="gallery-credit">
          <a href={OFF_SITE} target="_blank" rel="noopener noreferrer">
            {ru.catalog.card.photos.credit}
          </a>
        </p>
      )}
    </>
  );
}

type Status = { kind: 'idle' } | { kind: 'busy'; text: string } | { kind: 'error'; text: string };

interface EditorProps {
  orgId: string;
  productId: string;
  barcodes: readonly string[];
  photos: readonly ProductPhoto[];
  onChange: (photos: ProductPhoto[]) => void;
}

/** Правка фото: своё фото (камера или галерея), фото из Open Food Facts по штрихкоду, удаление с подтверждением. */
export function PhotoEditor({ orgId, productId, barcodes, photos, onChange }: EditorProps) {
  const input = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [confirm, setConfirm] = useState<string | null>(null);
  const t = ru.catalog.card.photos;

  const upload = async (file: Blob, source: ProductPhoto['source']) => {
    const { full, thumb } = await preparePhoto(file);
    const photo = await uploadProductPhoto(orgId, productId, full, thumb, photos.length, source);
    onChange([...photos, photo]);
    setStatus({ kind: 'idle' });
  };

  const add = async (file: File) => {
    setStatus({ kind: 'busy', text: t.adding });
    try {
      await upload(file, null);
    } catch (error) {
      setStatus({ kind: 'error', text: error instanceof Error && error.message === 'not-image' ? t.notImage : t.error });
    }
  };

  const fromOff = async () => {
    setStatus({ kind: 'busy', text: t.searchingOff });
    try {
      for (const code of barcodes.flatMap(barcodeVariants)) {
        const url = await findOffPhoto(code);
        if (url) return await upload(await downloadOffImage(url), 'openfoodfacts');
      }
      setStatus({ kind: 'error', text: t.notFoundOff });
    } catch {
      setStatus({ kind: 'error', text: t.error });
    }
  };

  const remove = async (path: string) => {
    setConfirm(null);
    setStatus({ kind: 'busy', text: t.adding });
    try {
      await deleteProductPhoto(path);
      onChange(photos.filter((p) => p.path !== path));
      setStatus({ kind: 'idle' });
    } catch {
      setStatus({ kind: 'error', text: t.error });
    }
  };

  const busy = status.kind === 'busy';
  return (
    <Section title={t.title} id="photos-title" footer={t.footer}>
      {photos.map(({ path }, i) => (
        <Row
          key={path}
          leading={<img className="thumb" src={photoUrl(path, true)} alt="" loading="lazy" />}
          inset="thumb"
          title={ru.catalog.card.photo(i + 1, photos.length)}
          trailing={
            confirm === path ? (
              <RowAction tone="bad" onClick={() => void remove(path)}>
                {t.confirmRemove}
              </RowAction>
            ) : (
              <RowAction tone="bad" disabled={busy} onClick={() => setConfirm(path)}>
                {t.remove}
              </RowAction>
            )
          }
        />
      ))}
      {busy ? (
        <div role="status">
          <Row leading={<span className="spinner" />} title={status.text} tone="muted" />
        </div>
      ) : (
        <>
          <Row title={t.add} tone="link" onClick={() => input.current?.click()} />
          {barcodes.length > 0 && <Row title={t.findOff} tone="link" onClick={() => void fromOff()} />}
        </>
      )}
      {status.kind === 'error' && (
        <div role="alert">
          <Row title={status.text} tone="bad" />
        </div>
      )}
      <input
        ref={input}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) void add(file);
        }}
      />
    </Section>
  );
}
