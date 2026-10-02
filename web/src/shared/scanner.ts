// Сканер штрихкодов камерой (КАТ-3). Распознаёт встроенный в браузер BarcodeDetector (Android, Chrome),
// а где его нет (iPhone, ПК) — zxing-wasm с нашего же сайта: сторонние серверы и eval не нужны.
import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url';

export type ScannerError = 'unsupported' | 'denied' | 'no-camera' | 'failed';

export interface ScannerSession {
  stop: () => void;
  /** Фонарик, если камера его поддерживает (обычно Android). */
  torch: ((on: boolean) => Promise<void>) | null;
}

type Detect = (video: HTMLVideoElement) => Promise<string | null>;

interface NativeDetector {
  detect: (source: HTMLVideoElement) => Promise<{ rawValue: string }[]>;
}
interface NativeDetectorClass {
  new (options: { formats: string[] }): NativeDetector;
  getSupportedFormats?: () => Promise<string[]>;
}

const NATIVE_FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf', 'qr_code', 'data_matrix'];
const ZXING_FORMATS = ['EAN13', 'EAN8', 'UPCA', 'UPCE', 'Code128', 'Code39', 'ITF', 'QRCode', 'DataMatrix'] as const;

export const scannerSupported = () =>
  typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getUserMedia === 'function';

async function nativeDetector(): Promise<Detect | null> {
  const Detector = (window as unknown as { BarcodeDetector?: NativeDetectorClass }).BarcodeDetector;
  if (!Detector) return null;
  try {
    const supported = (await Detector.getSupportedFormats?.()) ?? [];
    const formats = NATIVE_FORMATS.filter((f) => supported.includes(f));
    if (!formats.includes('ean_13')) return null;
    const detector = new Detector({ formats });
    return async (video) => (await detector.detect(video))[0]?.rawValue ?? null;
  } catch {
    return null;
  }
}

async function wasmDetector(): Promise<Detect> {
  const { prepareZXingModule, readBarcodes } = await import('zxing-wasm/reader');
  await prepareZXingModule({
    overrides: { locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? wasmUrl : prefix + path) },
    fireImmediately: true,
  });
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('canvas');
  return async (video) => {
    // Берём середину кадра (там рамка) и уменьшаем: быстрее и точнее на слабых телефонах.
    const sw = video.videoWidth * 0.8;
    const sh = video.videoHeight * 0.5;
    if (!sw || !sh) return null;
    const scale = Math.min(1, 960 / sw);
    canvas.width = Math.round(sw * scale);
    canvas.height = Math.round(sh * scale);
    context.drawImage(video, (video.videoWidth - sw) / 2, (video.videoHeight - sh) / 2, sw, sh, 0, 0, canvas.width, canvas.height);
    const image = context.getImageData(0, 0, canvas.width, canvas.height);
    const results = await readBarcodes(image, { formats: [...ZXING_FORMATS], tryHarder: true, maxNumberOfSymbols: 1 });
    return results.find((r) => r.isValid)?.text ?? null;
  };
}

function errorKind(error: unknown): ScannerError {
  const name = error instanceof DOMException ? error.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'denied';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'no-camera';
  return 'failed';
}

/**
 * Включает заднюю камеру в `video` и вызывает `onRead` с каждым распознанным кодом,
 * пока не вызван `stop`. Ошибки — `ScannerError` в отклонённом обещании.
 */
export async function startScanner(video: HTMLVideoElement, onRead: (raw: string) => void): Promise<ScannerSession> {
  if (!scannerSupported()) throw 'unsupported' satisfies ScannerError;
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
    });
  } catch (error) {
    throw errorKind(error);
  }
  let stopped = false;
  let timer = 0;
  const stop = () => {
    stopped = true;
    window.clearTimeout(timer);
    for (const track of stream.getTracks()) track.stop();
    video.srcObject = null;
  };
  try {
    video.srcObject = stream;
    video.muted = true;
    video.playsInline = true;
    await video.play();
    const detect = (await nativeDetector()) ?? (await wasmDetector());
    const tick = async () => {
      if (stopped) return;
      if (video.readyState >= 2) {
        try {
          const raw = await detect(video);
          if (raw && !stopped) onRead(raw);
        } catch {
          // Кадр не разобрался — пробуем следующий.
        }
      }
      if (!stopped) timer = window.setTimeout(() => void tick(), 120);
    };
    void tick();
  } catch (error) {
    stop();
    throw typeof error === 'string' ? error : 'failed';
  }
  const [track] = stream.getVideoTracks();
  const capabilities = (track?.getCapabilities?.() ?? {}) as { torch?: boolean };
  const torch =
    track && capabilities.torch
      ? (on: boolean) => track.applyConstraints({ advanced: [{ torch: on } as MediaTrackConstraintSet] })
      : null;
  return { stop, torch };
}
