// Ссылка-приглашение открывает приложение в Telegram с параметром startapp=inv_<токен>.
// Токен — 32 случайных байта в hex; в базе хранится только его хэш.
const INVITE_PARAM = /^inv_([0-9a-f]{64})$/;

export function parseInviteParam(startParam: string | null | undefined): string | null {
  return startParam ? (INVITE_PARAM.exec(startParam)?.[1] ?? null) : null;
}
