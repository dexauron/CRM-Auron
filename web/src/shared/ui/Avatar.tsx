import { initials } from './avatar';

/** Серый круг с инициалами, как у контактов iOS. */
export function Avatar({ name, size = 'small' }: { name: string | null; size?: 'small' | 'large' }) {
  return (
    <span className={`avatar avatar-${size}`} aria-hidden="true">
      {initials(name)}
    </span>
  );
}
