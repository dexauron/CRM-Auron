// Второй фактор для владельца, управляющего и бухгалтера: подключение аутентификатора и ввод кода.
import { useState, type ChangeEvent } from 'react';
import { groupSecret, isTotpCode, startTotpEnrollment, verifyTotp, type TotpEnrollment } from '../../api/mfa';
import { ru } from '../../shared/i18n/ru';
import { Icon } from '../../shared/ui/icons';
import { Row, RowAction, Section } from '../../shared/ui/List';

type Status = 'idle' | 'busy' | 'wrong' | 'failed';

function CodeField({ disabled, onCode }: { disabled: boolean; onCode: (code: string) => void }) {
  const [code, setCode] = useState('');
  const onChange = (event: ChangeEvent<HTMLInputElement>) => {
    const digits = event.target.value.replace(/\D/g, '').slice(0, 6);
    setCode(digits);
    // Шестая цифра — сразу проверяем, без лишнего нажатия.
    if (isTotpCode(digits)) onCode(digits);
  };
  return (
    <div className="row row-inset-text">
      <input
        className="code-field"
        value={code}
        onChange={onChange}
        disabled={disabled}
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]*"
        maxLength={6}
        placeholder="000000"
        aria-label={ru.secondFactor.codeLabel}
      />
    </div>
  );
}

export function SecondFactor({ mode, onDone }: { mode: 'verify' | 'enroll'; onDone: () => void }) {
  const [enrollment, setEnrollment] = useState<TotpEnrollment | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [copied, setCopied] = useState(false);
  const [attempt, setAttempt] = useState(0);

  const start = async () => {
    setStatus('busy');
    try {
      setEnrollment(await startTotpEnrollment());
      setStatus('idle');
    } catch {
      setStatus('failed');
    }
  };

  const check = async (code: string) => {
    setStatus('busy');
    try {
      if (await verifyTotp(code, enrollment?.factorId)) return onDone();
      setStatus('wrong');
    } catch {
      setStatus('failed');
    }
    // Новое поле ввода — пустое: проще набрать код заново.
    setAttempt((n) => n + 1);
  };

  const copySecret = async () => {
    if (!enrollment) return;
    try {
      await navigator.clipboard.writeText(enrollment.secret);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const message =
    status === 'wrong' ? ru.secondFactor.wrong : status === 'failed' ? ru.secondFactor.failed : null;
  const messageRow = message && (
    <div role="alert">
      <Row title={message} tone="bad" inset="text" />
    </div>
  );

  if (mode === 'verify') {
    return (
      <Section title={ru.secondFactor.verifyTitle} id="second-factor" footer={ru.secondFactor.verifyFooter}>
        <CodeField key={attempt} disabled={status === 'busy'} onCode={(code) => void check(code)} />
        {messageRow}
      </Section>
    );
  }

  if (!enrollment) {
    return (
      <Section title={ru.secondFactor.enrollTitle} id="second-factor" footer={ru.secondFactor.enrollWhy}>
        <Row
          leading={<Icon name="shield" className="row-icon" />}
          title={ru.secondFactor.enrollStart}
          tone="link"
          disabled={status === 'busy'}
          onClick={() => void start()}
        />
        {messageRow}
      </Section>
    );
  }

  return (
    <Section title={ru.secondFactor.enrollTitle} id="second-factor" footer={ru.secondFactor.enrollSteps}>
      <div className="qr">
        <img src={enrollment.qrCode} alt={ru.secondFactor.qrAlt} width="180" height="180" />
      </div>
      <Row
        title={<span className="secret">{groupSecret(enrollment.secret)}</span>}
        subtitle={ru.secondFactor.secretHint}
        trailing={<RowAction onClick={() => void copySecret()}>{copied ? ru.team.invite.copied : ru.team.invite.copy}</RowAction>}
      />
      <a className="row row-inset-text row-button tone-link" href={enrollment.uri}>
        <span className="row-main">
          <span className="row-title">{ru.secondFactor.openApp}</span>
        </span>
      </a>
      <CodeField key={attempt} disabled={status === 'busy'} onCode={(code) => void check(code)} />
      {messageRow}
    </Section>
  );
}
