// Большой заголовок iOS: при прокрутке сворачивается в полупрозрачную панель с маленьким заголовком.
import { useEffect, useRef, useState } from 'react';

export function LargeTitle({ title, subtitle }: { title: string; subtitle: string }) {
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
      <div className={`navbar ${compact ? 'navbar-visible' : ''}`} aria-hidden="true">
        <span className="navbar-title">{title}</span>
      </div>
      <header className="large-title">
        <h1 ref={ref}>{title}</h1>
        <p>{subtitle}</p>
      </header>
    </>
  );
}
