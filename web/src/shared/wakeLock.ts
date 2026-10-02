// Экран не гаснет, пока идёт долгая загрузка (если телефон это поддерживает). Возвращает «отпустить».
export async function keepAwake(): Promise<() => void> {
  try {
    const lock = await navigator.wakeLock.request('screen');
    return () => void lock.release();
  } catch {
    return () => undefined;
  }
}
