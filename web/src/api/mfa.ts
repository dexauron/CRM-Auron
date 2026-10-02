// Второй фактор: код из приложения-аутентификатора (TOTP). Права владельца, управляющего и бухгалтера
// база даёт только в сессии с подтверждённым кодом (миграция second_factor).
import { api } from './client';

export type SecondFactorState = 'ok' | 'verify' | 'enroll';

export interface TotpEnrollment {
  factorId: string;
  /** QR-код картинкой (data:image/svg+xml). */
  qrCode: string;
  secret: string;
  uri: string;
}

export const isTotpCode = (code: string) => /^\d{6}$/.test(code);

/** «JBSWY3DPEHPK3PXP» → «JBSW Y3DP EHPK 3PXP»: ключ легче перепечатать вручную. */
export const groupSecret = (secret: string) => secret.match(/.{1,4}/g)?.join(' ') ?? secret;

export async function secondFactorState(): Promise<SecondFactorState> {
  const { data, error } = await api().auth.mfa.getAuthenticatorAssuranceLevel();
  if (error) throw new Error('Не удалось проверить второй фактор');
  if (data.currentLevel === 'aal2') return 'ok';
  return data.nextLevel === 'aal2' ? 'verify' : 'enroll';
}

export async function startTotpEnrollment(): Promise<TotpEnrollment> {
  // Брошенные неподтверждённые попытки мешают новой — убираем их.
  const factors = await api().auth.mfa.listFactors();
  if (factors.error) throw new Error('Не удалось начать подключение');
  for (const factor of factors.data.all) {
    if (factor.factor_type === 'totp' && factor.status === 'unverified') {
      await api().auth.mfa.unenroll({ factorId: factor.id });
    }
  }
  const { data, error } = await api().auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Way Market', issuer: 'Way Market' });
  if (error) throw new Error('Не удалось начать подключение');
  return { factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret, uri: data.totp.uri };
}

/** true — код верный, сессия получила права; false — код неверный. Остальные ошибки бросаются. */
export async function verifyTotp(code: string, factorId?: string): Promise<boolean> {
  let id = factorId;
  if (!id) {
    const factors = await api().auth.mfa.listFactors();
    if (factors.error) throw new Error('Не удалось проверить код');
    id = factors.data.totp[0]?.id;
  }
  if (!id) throw new Error('Нет подключённого аутентификатора');
  const { error } = await api().auth.mfa.challengeAndVerify({ factorId: id, code });
  if (!error) return true;
  if (error.code === 'mfa_verification_failed' || error.code === 'mfa_challenge_expired') return false;
  throw new Error('Не удалось проверить код');
}
