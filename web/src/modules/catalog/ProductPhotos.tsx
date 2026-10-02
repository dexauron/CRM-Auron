// Фото в карточке товара (КАТ-7): галерея для всех; добавить и удалить — владельцу и управляющему.
import { useRef, useState } from 'react';
import { deleteProductPhoto, photoUrl, uploadProductPhoto } from '../../api/photos';
import { ru } from '../../shared/i18n/ru';
import { preparePhoto } from '../../shared/image';
import { Row, RowAction, Section } from '../../shared/ui/List';

/** Галерея: одно фото — квадрат, несколько — листаются пальцем, как в App Store. */
export function PhotoGallery({ photos, name }: { photos: readonly string[]; name: string }) {
  if (photos.length === 0) return null;
  return (
    <div className="gallery" aria-label={ru.catalog.card.photos.title}>
      {photos.map((path, i) => (
        <img
          key={path}
          className="gallery-photo"
          src={photoUrl(path)}
          alt={photos.length > 1 ? `${name} — ${ru.catalog.card.photo(i + 1, photos.length)}` : name}
          loading={i === 0 ? 'eager' : 'lazy'}
          decoding="async"
        />
      ))}
    </div>
  );
}

type Status = { kind: 'idle' } | { kind: 'busy' } | { kind: 'error'; text: string };

interface EditorProps {
  orgId: string;
  productId: string;
  photos: readonly string[];
  onChange: (photos: string[]) => void;
}

/** Правка фото: «Добавить фото» (камера или галерея телефона) и «Удалить» с подтверждением. */
export function PhotoEditor({ orgId, productId, photos, onChange }: EditorProps) {
  const input = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [confirm, setConfirm] = useState<string | null>(null);
  const t = ru.catalog.card.photos;

  const add = async (file: File) => {
    setStatus({ kind: 'busy' });
    try {
      const { full, thumb } = await preparePhoto(file);
      const path = await uploadProductPhoto(orgId, productId, full, thumb, photos.length);
      onChange([...photos, path]);
      setStatus({ kind: 'idle' });
    } catch (error) {
      setStatus({ kind: 'error', text: error instanceof Error && error.message === 'not-image' ? t.notImage : t.error });
    }
  };

  const remove = async (path: string) => {
    setConfirm(null);
    setStatus({ kind: 'busy' });
    try {
      await deleteProductPhoto(path);
      onChange(photos.filter((p) => p !== path));
      setStatus({ kind: 'idle' });
    } catch {
      setStatus({ kind: 'error', text: t.error });
    }
  };

  return (
    <Section title={t.title} id="photos-title" footer={t.footer}>
      {photos.map((path, i) => (
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
              <RowAction tone="bad" disabled={status.kind === 'busy'} onClick={() => setConfirm(path)}>
                {t.remove}
              </RowAction>
            )
          }
        />
      ))}
      {status.kind === 'busy' ? (
        <div role="status">
          <Row leading={<span className="spinner" />} title={t.adding} tone="muted" />
        </div>
      ) : (
        <Row title={t.add} tone="link" onClick={() => input.current?.click()} />
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
