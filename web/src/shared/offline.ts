// Хранилище на устройстве (КАТ-8): IndexedDB «ключ → значение». Только открытые данные (каталог), без личных.
// Если браузер не даёт хранилище (приватный режим, нет места) — тихо работаем без него.
const DB_NAME = 'way-market';
const STORE = 'kv';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('no indexedDB'));
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('indexedDB'));
  });
}

async function run<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const request = action(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(request.result as T);
      tx.onerror = () => reject(tx.error ?? new Error('indexedDB'));
      tx.onabort = () => reject(tx.error ?? new Error('indexedDB'));
    });
  } finally {
    db.close();
  }
}

export async function readOffline(key: string): Promise<unknown> {
  try {
    return await run<unknown>('readonly', (store) => store.get(key));
  } catch {
    return undefined;
  }
}

export async function writeOffline(key: string, value: unknown): Promise<void> {
  try {
    await run('readwrite', (store) => store.put(value, key));
  } catch {
    // Нет места или хранилище запрещено — в следующий раз каталог просто скачается заново.
  }
}
