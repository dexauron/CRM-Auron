// Справочник «Контрагенты» из 1С: название поставщика и телефон (как в старом каталоге, imports.js).
// Номера приводятся к +7XXXXXXXXXX; что не похоже на номер — в список на проверку (ТЗ: «битые номера — на проверку»).
import { normalizePhone } from '../../shared/phone';
import { cellStr, norm, type Rows } from '../catalog/import1c/parse';

export interface ContactRec {
  name: string;
  phones: string[];
  /** Записи из ячейки телефона, которые не удалось разобрать. */
  bad: string[];
}

export function parseContactsReport(rows: Rows): ContactRec[] {
  let nameCol = -1;
  let phoneCol = -1;
  let dataStart = -1;
  for (let r = 0; r < Math.min(rows.length, 30) && dataStart < 0; r++) {
    const cells = (rows[r] ?? []).map((v) => cellStr(v).toLowerCase());
    const nc = cells.findIndex((l) => l === 'контрагент');
    const pc = cells.findIndex((l) => l.includes('телефон'));
    if (nc >= 0 && pc >= 0) {
      nameCol = nc;
      phoneCol = pc;
      dataStart = r + 1;
    }
  }
  if (dataStart < 0) throw new Error('Не нашёл колонки «Контрагент» и «Номер телефона»');
  const byName = new Map<string, ContactRec>();
  for (const row of rows.slice(dataStart)) {
    const name = cellStr(row[nameCol]).replace(/\s+/g, ' ').trim();
    if (!name) continue;
    const key = norm(name);
    const rec = byName.get(key) ?? { name, phones: [], bad: [] };
    byName.set(key, rec);
    // В одной ячейке бывает несколько номеров: «8 928 000-00-00, 8 963 …».
    for (const part of cellStr(row[phoneCol]).split(/[,;/\n]+/).map((s) => s.trim()).filter(Boolean)) {
      const phone = normalizePhone(part);
      if (phone) {
        if (!rec.phones.includes(phone)) rec.phones.push(phone);
      } else if (!rec.bad.includes(part)) {
        rec.bad.push(part);
      }
    }
  }
  return [...byName.values()];
}
