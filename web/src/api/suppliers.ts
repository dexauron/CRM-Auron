// Этап 2, ПСТ-1: справочник поставщиков. Права решает сервер (RLS): владелец и управляющий правят, бухгалтер и
// сотрудник зала читают, ТП видит только своего поставщика. На устройстве не сохраняется.
import { api } from './client';

export const supplierKinds = ['ooo', 'ip', 'other'] as const;
export type SupplierKind = (typeof supplierKinds)[number];
export const contactRoles = ['agent', 'accountant', 'office', 'other'] as const;
export type ContactRole = (typeof contactRoles)[number];

export interface SupplierContact {
  id: string;
  role: ContactRole;
  name: string | null;
  /** +7XXXXXXXXXX */
  phone: string | null;
  brands: string | null;
  note: string | null;
}

export interface Supplier {
  id: string;
  name: string;
  kind: SupplierKind | null;
  note: string | null;
  /** Удалён (в корзине) — видят только владелец и управляющий. */
  deleted: boolean;
  contacts: SupplierContact[];
}

export class SuppliersError extends Error {
  constructor(readonly reason: 'forbidden' | 'duplicate' | 'unavailable' | 'invalid' | 'real_data') {
    super(reason);
    this.name = 'SuppliersError';
  }
}

const record = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const text = (v: unknown): v is string | null => v === null || typeof v === 'string';
const invalid = (): never => {
  throw new SuppliersError('invalid');
};
function fail(error: { code?: string; hint?: string | null }): never {
  if (error.code === '42501' && error.hint === 'real_personal_data') throw new SuppliersError('real_data');
  if (error.code === '42501') throw new SuppliersError('forbidden');
  if (error.code === '23505') throw new SuppliersError('duplicate');
  throw new SuppliersError('unavailable');
}

export function parseContact(row: unknown): SupplierContact {
  if (!record(row) || typeof row.id !== 'string' || !contactRoles.includes(row.role as ContactRole)
    || !text(row.name) || !text(row.phone) || !text(row.brands) || !text(row.note)) return invalid();
  return { id: row.id, role: row.role as ContactRole, name: row.name, phone: row.phone, brands: row.brands, note: row.note };
}

export function parseSupplier(row: unknown): Supplier {
  if (!record(row) || typeof row.id !== 'string' || typeof row.name !== 'string'
    || !(row.kind === null || supplierKinds.includes(row.kind as SupplierKind)) || !text(row.note)
    || !text(row.deleted_at) || !Array.isArray(row.supplier_contacts)) return invalid();
  const contacts = (row.supplier_contacts as unknown[]).flatMap((c) => {
    if (!record(c) || !text(c.deleted_at)) return invalid();
    return c.deleted_at === null ? [parseContact(c)] : [];
  });
  return { id: row.id, name: row.name, kind: row.kind as SupplierKind | null, note: row.note, deleted: row.deleted_at !== null, contacts };
}

const COLUMNS = 'id, name, kind, note, deleted_at, supplier_contacts(id, role, name, phone, brands, note, deleted_at)';

export async function loadSuppliers(orgId: string): Promise<Supplier[]> {
  const { data, error } = await api().from('suppliers').select(COLUMNS).eq('org_id', orgId).order('name').limit(5000);
  if (error) fail(error);
  return (data ?? []).map(parseSupplier).sort((a, b) => a.name.localeCompare(b.name, 'ru'));
}

export interface SupplierDraft {
  name: string;
  kind: SupplierKind | null;
  note: string | null;
}

export async function createSupplier(orgId: string, draft: SupplierDraft): Promise<Supplier> {
  const { data, error } = await api().from('suppliers').insert({ org_id: orgId, ...draft }).select(COLUMNS).single();
  if (error) fail(error);
  return parseSupplier(data);
}

export async function updateSupplier(id: string, patch: Partial<SupplierDraft> & { deleted_at?: string | null }): Promise<Supplier> {
  const { data, error } = await api().from('suppliers').update(patch).eq('id', id).select(COLUMNS).single();
  if (error) fail(error);
  return parseSupplier(data);
}

export interface ContactDraft {
  role: ContactRole;
  name: string | null;
  phone: string | null;
  brands: string | null;
  note: string | null;
}

const CONTACT_COLUMNS = 'id, role, name, phone, brands, note';

export async function createContact(orgId: string, supplierId: string, draft: ContactDraft): Promise<SupplierContact> {
  const { data, error } = await api().from('supplier_contacts')
    .insert({ org_id: orgId, supplier_id: supplierId, ...draft }).select(CONTACT_COLUMNS).single();
  if (error) fail(error);
  return parseContact(data);
}

export async function updateContact(id: string, draft: ContactDraft): Promise<SupplierContact> {
  const { data, error } = await api().from('supplier_contacts').update(draft).eq('id', id).select(CONTACT_COLUMNS).single();
  if (error) fail(error);
  return parseContact(data);
}

export async function deleteContact(id: string): Promise<void> {
  const { data, error } = await api().from('supplier_contacts').update({ deleted_at: new Date().toISOString() }).eq('id', id).select('id');
  if (error) fail(error);
  if (!data?.length) throw new SuppliersError('forbidden');
}

/** Разрешено ли на этом сервере хранить настоящие персональные данные (сервер в РФ). */
export async function realDataAllowed(): Promise<boolean> {
  const { data, error } = await api().rpc('instance_info');
  if (error) fail(error);
  return record(data) && data.real_personal_data === true;
}

export interface ContactImportRow {
  name: string;
  phones: string[];
}

export async function importSupplierContacts(
  orgId: string, rows: ContactImportRow[], onProgress: (done: number, total: number) => void,
): Promise<{ suppliers: number; contacts: number }> {
  const totals = { suppliers: 0, contacts: 0 };
  for (let i = 0; i < rows.length; i += 1000) {
    const { data, error } = await api().rpc('import_supplier_contacts', { p_org: orgId, p_rows: rows.slice(i, i + 1000) });
    if (error) fail(error);
    if (record(data)) {
      totals.suppliers += typeof data.suppliers === 'number' ? data.suppliers : 0;
      totals.contacts += typeof data.contacts === 'number' ? data.contacts : 0;
    }
    onProgress(Math.min(i + 1000, rows.length), rows.length);
  }
  return totals;
}

const fold = (s: string) => s.toLowerCase().replace(/ё/g, 'е');

/** Поиск по названию, имени ТП, брендам и цифрам телефона. */
export function matchSupplier(s: Supplier, query: string): boolean {
  const q = fold(query.trim());
  if (!q) return true;
  const digits = q.replace(/\D/g, '');
  const haystack = fold([s.name, s.note ?? '', ...s.contacts.flatMap((c) => [c.name ?? '', c.brands ?? ''])].join(' '));
  if (haystack.includes(q)) return true;
  return digits.length >= 3 && s.contacts.some((c) => (c.phone ?? '').replace(/\D/g, '').includes(digits));
}

/** Ссылка WhatsApp для номера +7XXXXXXXXXX. */
export const whatsappUrl = (phone: string) => `https://wa.me/${phone.replace(/\D/g, '')}`;

/** Поставщик товара: закупка за штуку или кг (копейки) и дата цены; без цены — привязан вручную. */
export interface ProductSupplier {
  supplierId: string;
  name: string;
  price: number | null;
  priceDate: string | null;
}

export async function loadProductSuppliers(productId: string): Promise<ProductSupplier[]> {
  const { data, error } = await api().from('product_suppliers')
    .select('supplier_id, price, price_date, suppliers(name, deleted_at)').eq('product_id', productId);
  if (error) fail(error);
  return (data ?? []).flatMap((row: unknown): ProductSupplier[] => {
    if (!record(row) || typeof row.supplier_id !== 'string' || !record(row.suppliers) || typeof row.suppliers.name !== 'string'
      || !(row.price === null || typeof row.price === 'number') || !text(row.price_date)) return invalid();
    if (row.suppliers.deleted_at !== null) return [];
    return [{ supplierId: row.supplier_id, name: row.suppliers.name, price: row.price as number | null, priceDate: row.price_date }];
  }).sort((a, b) => (b.priceDate ?? '').localeCompare(a.priceDate ?? '') || a.name.localeCompare(b.name, 'ru'));
}

export async function linkProductSupplier(orgId: string, productId: string, supplierId: string): Promise<void> {
  const { error } = await api().from('product_suppliers').insert({ org_id: orgId, product_id: productId, supplier_id: supplierId });
  if (error && error.code !== '23505') fail(error);
}

export async function unlinkProductSupplier(productId: string, supplierId: string): Promise<void> {
  const { data, error } = await api().from('product_suppliers').delete().eq('product_id', productId).eq('supplier_id', supplierId).select('supplier_id');
  if (error) fail(error);
  if (!data?.length) throw new SuppliersError('forbidden');
}

/** Цена поставщика из 1С: копейки за штуку или кг. */
export interface SupplierPriceRow {
  product_id: string;
  supplier: string;
  price: number | null;
  price_date: string | null;
}

export async function importSupplierPrices(
  orgId: string, rows: SupplierPriceRow[], onProgress: (done: number, total: number) => void,
): Promise<number> {
  let changed = 0;
  for (let i = 0; i < rows.length; i += 1000) {
    const { data, error } = await api().rpc('import_supplier_prices', { p_org: orgId, p_rows: rows.slice(i, i + 1000) });
    if (error) fail(error);
    if (record(data) && typeof data.changed === 'number') changed += data.changed;
    onProgress(Math.min(i + 1000, rows.length), rows.length);
  }
  return changed;
}
