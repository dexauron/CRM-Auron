// Сгруппированный список как в настройках iOS: секция с заголовком и подписью, строки с тонкими разделителями.
import type { ReactNode } from 'react';
import { Icon, type IconName } from './icons';

export function Section({
  title,
  footer,
  children,
  id,
}: {
  title?: string;
  footer?: ReactNode;
  children: ReactNode;
  id?: string;
}) {
  return (
    <section className="section" aria-labelledby={title && id ? id : undefined}>
      {title && (
        <h2 className="section-header" id={id}>
          {title}
        </h2>
      )}
      <div className="group">{children}</div>
      {footer && <div className="section-footer">{footer}</div>}
    </section>
  );
}

type Tone = 'default' | 'link' | 'bad' | 'good' | 'muted';

interface RowProps {
  title: ReactNode;
  subtitle?: ReactNode;
  leading?: ReactNode;
  trailing?: ReactNode;
  /** Стрелка справа — строка ведёт дальше. */
  chevron?: boolean;
  tone?: Tone;
  center?: boolean;
  onClick?: () => void;
  disabled?: boolean;
  /** Отступ разделителя: у строк со значком или аватаром он начинается после него. */
  inset?: 'text' | 'icon' | 'avatar';
  /** «Название — значение» (как в «Настройках» → «Об этом устройстве»): длинное значение сокращается многоточием. */
  fact?: boolean;
}

export function Row({ title, subtitle, leading, trailing, chevron, tone = 'default', center, onClick, disabled, inset, fact }: RowProps) {
  const className = [
    'row',
    `row-inset-${inset ?? (leading ? 'icon' : 'text')}`,
    center ? 'row-center' : '',
    fact ? 'row-fact' : '',
    tone !== 'default' ? `tone-${tone}` : '',
  ]
    .filter(Boolean)
    .join(' ');
  const body = (
    <>
      {leading}
      <span className="row-main">
        <span className="row-title">{title}</span>
        {subtitle && <span className="row-subtitle">{subtitle}</span>}
      </span>
      {trailing && <span className="row-trailing">{trailing}</span>}
      {chevron && <Icon name="chevronRight" className="row-chevron" />}
    </>
  );
  if (!onClick) return <div className={className}>{body}</div>;
  return (
    <button type="button" className={`${className} row-button`} onClick={onClick} disabled={disabled}>
      {body}
    </button>
  );
}

const tileColors = {
  blue: '#0a84ff',
  orange: '#ff9500',
  green: '#30b158',
  pink: '#ff2d55',
  indigo: '#5e5ce6',
  grey: '#8e8e93',
} as const;

/** Цветная плитка со значком, как у пунктов настроек iOS. */
export function IconTile({ icon, color }: { icon: IconName; color: keyof typeof tileColors }) {
  return (
    <span className="icon-tile" style={{ background: tileColors[color] }}>
      <Icon name={icon} />
    </span>
  );
}

/** Кнопка в правой части строки: «Отозвать», «Отключить». */
export function RowAction({
  children,
  onClick,
  tone = 'link',
  disabled,
}: {
  children: ReactNode;
  onClick: () => void;
  tone?: 'link' | 'bad';
  disabled?: boolean;
}) {
  return (
    <button type="button" className={`row-action tone-${tone}`} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}
