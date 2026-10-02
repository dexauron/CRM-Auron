// Окно сканера (КАТ-3): камера во весь экран, рамка, «Отмена» и фонарик — как камера iPhone, без лишнего.
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { ScanFilter } from '../barcode';
import { ru } from '../i18n/ru';
import { startScanner, type ScannerError, type ScannerSession } from '../scanner';
import { Icon } from './icons';

interface Props {
  /** Распознанный и проверенный код (GTIN из «Честного знака» уже извлечён). */
  onCode: (code: string) => void;
  onClose: () => void;
}

type State = 'starting' | 'running' | ScannerError;

export function Scanner({ onCode, onClose }: Props) {
  const video = useRef<HTMLVideoElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const [state, setState] = useState<State>('starting');
  const [torch, setTorch] = useState<{ set: (on: boolean) => Promise<void>; on: boolean } | null>(null);
  const found = useEffectEvent((code: string) => onCode(code));
  const cancel = useEffectEvent(() => onClose());

  useEffect(() => {
    const node = video.current;
    if (!node) return;
    const filter = new ScanFilter();
    let session: ScannerSession | null = null;
    let active = true;
    let done = false;
    startScanner(node, (raw) => {
      const code = filter.push(raw);
      if (!code || done) return;
      done = true;
      navigator.vibrate?.(30);
      session?.stop();
      found(code);
    }).then(
      (s) => {
        if (!active) return s.stop();
        session = s;
        setState('running');
        if (s.torch) setTorch({ set: s.torch, on: false });
      },
      (error: unknown) => active && setState(typeof error === 'string' ? (error as ScannerError) : 'failed'),
    );
    return () => {
      active = false;
      session?.stop();
    };
  }, []);

  useEffect(() => {
    close.current?.focus();
    document.documentElement.classList.add('scanner-open');
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && cancel();
    window.addEventListener('keydown', onKey);
    return () => {
      document.documentElement.classList.remove('scanner-open');
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  const hint = state === 'starting' ? ru.scanner.starting : state === 'running' ? ru.scanner.hint : ru.scanner.errors[state];
  return (
    <div className="scanner" role="dialog" aria-modal="true" aria-label={ru.scanner.title}>
      <video ref={video} className="scanner-video" playsInline muted />
      {state === 'running' && <div className="scanner-frame" aria-hidden="true" />}
      <div className="scanner-bar">
        <button ref={close} type="button" className="scanner-cancel" onClick={onClose}>
          {ru.scanner.cancel}
        </button>
        {torch && (
          <button
            type="button"
            className={`scanner-torch ${torch.on ? 'scanner-torch-on' : ''}`}
            aria-label={torch.on ? ru.scanner.torchOff : ru.scanner.torchOn}
            aria-pressed={torch.on}
            onClick={() => {
              const on = !torch.on;
              void torch.set(on).then(() => setTorch({ ...torch, on }), () => setTorch(null));
            }}
          >
            <Icon name="flashlight" />
          </button>
        )}
      </div>
      <p className={`scanner-hint ${state === 'starting' || state === 'running' ? '' : 'scanner-error'}`} role="status">
        {hint}
      </p>
    </div>
  );
}
