// Большой заголовок iOS: при прокрутке сворачивается в полупрозрачную панель с маленьким заголовком.
import { useEffect, useRef, useState } from 'react';
import { Icon } from './icons';

interface Props {
  title: string;
  subtitle?: string;
  /** Кнопка «Назад» слева сверху, как в iOS. */
  back?: { label: string; onClick: () => void };
}

export function LargeTitle({ title, subtitle, back }: Props) {
  const ref = useRef<HTMLHeadingElement>(null);
  const [compact, setCompact] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node || !('IntersectionObserver' in window)) return;
    const observer = new IntersectionObserver(([entry]) => setCompact(!(entry?.isIntersecting ?? true)), {
      rootMargin: '-8px 0px 0px 0px',
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <>
      <div className={`navbar ${compact ? 'navbar-visible' : ''}`}>
        {back && compact && (
          <button type="button" className="navbar-back" onClick={back.onClick}>
            <Icon name="chevronLeft" />
            {back.label}
          </button>
        )}
        <span className="navbar-title" aria-hidden="true">
          {title}
        </span>
      </div>
      <header className="large-title">
        {back && (
          <button type="button" className="back-button" onClick={back.onClick}>
            <Icon name="chevronLeft" />
            {back.label}
          </button>
        )}
        <h1 ref={ref} className={title.length > 24 ? 'title-long' : undefined}>
          {title}
        </h1>
        {subtitle && <p>{subtitle}</p>}
      </header>
    </>
  );
}
