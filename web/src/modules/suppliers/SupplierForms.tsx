// Формы поставщика и контакта: строки «название — значение», как в «Настройках» iOS.
import { useState } from 'react';
import { contactRoles, supplierKinds, type ContactDraft, type ContactRole, type SupplierContact, type SupplierDraft, type SupplierKind } from '../../api/suppliers';
import { ru } from '../../shared/i18n/ru';
import { formatPhone, normalizePhone } from '../../shared/phone';
import { Icon } from '../../shared/ui/icons';
import { Row, Section } from '../../shared/ui/List';

const t = ru.suppliers;

function Field({ label, value, onChange, placeholder, inputMode, maxLength }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  inputMode?: 'text' | 'tel';
  maxLength: number;
}) {
  return (
    <label className="row row-inset-text row-field">
      <span className="row-title">{label}</span>
      <input value={value} placeholder={placeholder} maxLength={maxLength} autoComplete="off"
        {...(inputMode ? { inputMode, type: inputMode === 'tel' ? 'tel' : 'text' } : {})}
        onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

function Choice<T extends string>({ label, value, options, names, onChange }: {
  label: string;
  value: T;
  options: readonly T[];
  names: Record<T, string>;
  onChange: (value: T) => void;
}) {
  return (
    <label className="row row-inset-text row-select">
      <span className="row-main"><span className="row-title">{label}</span></span>
      <span className="row-trailing">
        {names[value]}
        <Icon name="chevronUpDown" className="row-chevron" />
      </span>
      <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((o) => <option key={o} value={o}>{names[o]}</option>)}
      </select>
    </label>
  );
}

const orNull = (s: string) => (s.trim() ? s.trim() : null);

/** Ошибка сохранения → текст для человека. */
export type SaveError = 'duplicate' | 'forbidden' | 'failed';

export function SupplierForm({ title, initial, onSave, onCancel }: {
  title: string;
  initial: SupplierDraft | null;
  onSave: (draft: SupplierDraft) => Promise<SaveError | null>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [kind, setKind] = useState<SupplierKind | 'none'>(initial?.kind ?? 'none');
  const [note, setNote] = useState(initial?.note ?? '');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const kindNames = { ...t.kinds, none: t.noKind };

  const save = async () => {
    if (!name.trim()) return setProblem(t.errors.name);
    setBusy(true);
    setProblem(null);
    const error = await onSave({ name: name.trim(), kind: kind === 'none' ? null : kind, note: orNull(note) });
    setBusy(false);
    if (error) setProblem(error === 'duplicate' ? t.errors.duplicate : error === 'forbidden' ? t.errors.forbidden : t.errors.failed);
  };

  return (
    <Section title={title} id="supplier-form-title">
      <Field label={t.form.name} value={name} onChange={(v) => { setProblem(null); setName(v); }} placeholder={t.form.namePlaceholder} maxLength={160} />
      <Choice label={t.kind} value={kind} options={['none', ...supplierKinds] as const} names={kindNames} onChange={setKind} />
      <Field label={t.note} value={note} onChange={setNote} placeholder={t.form.notePlaceholder} maxLength={2000} />
      {problem && <div role="alert"><Row title={problem} tone="bad" /></div>}
      <Row title={busy ? t.saving : t.save} tone="link" center disabled={busy} onClick={() => void save()} />
      <Row title={t.cancel} tone="muted" center disabled={busy} onClick={onCancel} />
    </Section>
  );
}

export function ContactForm({ initial, onSave, onCancel, onDelete }: {
  initial: SupplierContact | null;
  onSave: (draft: ContactDraft) => Promise<SaveError | null>;
  onCancel: () => void;
  onDelete?: () => Promise<SaveError | null>;
}) {
  const [role, setRole] = useState<ContactRole>(initial?.role ?? 'agent');
  const [name, setName] = useState(initial?.name ?? '');
  const [phone, setPhone] = useState(initial?.phone ? formatPhone(initial.phone) : '');
  const [brands, setBrands] = useState(initial?.brands ?? '');
  const [note, setNote] = useState(initial?.note ?? '');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const message = (error: SaveError) =>
    error === 'duplicate' ? t.errors.phoneDuplicate : error === 'forbidden' ? t.errors.forbidden : t.errors.failed;

  const save = async () => {
    const normalized = phone.trim() ? normalizePhone(phone) : null;
    if (phone.trim() && !normalized) return setProblem(t.errors.phone);
    if (!name.trim() && !normalized) return setProblem(t.errors.contactEmpty);
    setBusy(true);
    setProblem(null);
    const error = await onSave({ role, name: orNull(name), phone: normalized, brands: orNull(brands), note: orNull(note) });
    setBusy(false);
    if (error) setProblem(message(error));
  };

  const remove = async () => {
    if (!onDelete) return;
    setBusy(true);
    const error = await onDelete();
    setBusy(false);
    if (error) setProblem(message(error));
  };

  const edit = (set: (v: string) => void) => (v: string) => { setProblem(null); set(v); };
  return (
    <Section title={t.form.contact} id="contact-form-title">
      <Choice label={t.form.role} value={role} options={contactRoles} names={t.roles} onChange={setRole} />
      <Field label={t.form.person} value={name} onChange={edit(setName)} placeholder={t.form.personPlaceholder} maxLength={120} />
      <Field label={t.form.phone} value={phone} onChange={edit(setPhone)} placeholder={t.form.phonePlaceholder} inputMode="tel" maxLength={24} />
      <Field label={t.form.brandsLabel} value={brands} onChange={setBrands} placeholder={t.form.brandsPlaceholder} maxLength={500} />
      <Field label={t.note} value={note} onChange={setNote} placeholder={t.form.notePlaceholder} maxLength={1000} />
      {problem && <div role="alert"><Row title={problem} tone="bad" /></div>}
      <Row title={busy ? t.saving : t.save} tone="link" center disabled={busy} onClick={() => void save()} />
      {onDelete && <Row title={t.form.removeContact} tone="bad" center disabled={busy} onClick={() => void remove()} />}
      <Row title={t.cancel} tone="muted" center disabled={busy} onClick={onCancel} />
    </Section>
  );
}
