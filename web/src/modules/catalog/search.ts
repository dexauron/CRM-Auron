// Поиск по каталогу (КАТ-2): опечатки, часть слова, коды и штрихкоды, транслит («сникерс» → Snickers).
// Перенос алгоритма старого каталога WayMarket (dexauron/auron, catalog/js/modules/catalog.js) вместе с его
// эталонными случаями (search.test.ts): баллы, указатель «первые 3 буквы слова → товары», разбор опечаток
// по парам букв, отсечение слабых совпадений. Скорость меняем — выдачу нет.

export interface CatalogItem {
  id: string;
  name: string;
  groupId: string | null;
  cashCode: string | null;
  article: string | null;
  barcodes: readonly string[];
  isWeighted: boolean;
}

export interface CatalogGroup {
  id: string;
  name: string;
}

/** Ниже этого балла товар не показываем; ниже 60 % от лучшего — тоже (хвост слабых совпадений). */
const SEARCH_THRESHOLD = 25;
const RELATIVE_CUTOFF = 0.6;
/** Запрос внутри слова учитываем только с этой длины: иначе «сок» лезет в «Высокобелковый», «рис» — в «Ирис». */
const MIDWORD_MIN = 5;
const KEY = 3;
/** Сколько товаров отдаём точной (дорогой) оценке опечаток. */
const POOL_LIMIT = 1500;

export const norm = (s: unknown) => String(s ?? '').toLowerCase().replace(/ё/g, 'е').trim();
/** Без знаков и пробелов: «арт. 8816» == «арт8816», «0,5» == «05». */
export const stripPunct = (s: unknown) => norm(s).replace(/[^0-9a-zа-я]+/g, '');

const TR: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ж: 'zh', з: 'z', и: 'i', й: 'i', к: 'k', л: 'l', м: 'm',
  н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sh',
  ъ: '', ы: 'y', ь: '', э: 'e', ю: 'u', я: 'a',
};

/** Русские буквы → латиница; строка без русских букв возвращается как есть. */
export function translit(s: string): string {
  let out: string | null = null;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charAt(i);
    const rep = TR[ch];
    if (rep === undefined) {
      if (out !== null) out += ch;
      continue;
    }
    if (out === null) out = s.slice(0, i);
    out += rep;
  }
  return out ?? s;
}

/** «Пословный» вид: знаки → пробелы, пробелы по краям. ' дог ' находится в «хот-дог», а «рис» — не в «ирис». */
const wordy = (s: string) => ' ' + s.replace(/[^a-zа-я0-9]+/g, ' ').trim() + ' ';

/** Пары букв слова (с пробелами по краям), отсортированные — для быстрого сравнения слиянием. */
function bigrams(s: string): string[] {
  const out: string[] = [];
  const str = ` ${s} `;
  for (let i = 0; i < str.length - 1; i++) out.push(str.slice(i, i + 2));
  return out.sort();
}

/** Коэффициент Дайса по мультимножествам пар букв: два отсортированных списка, проход слиянием. */
function dice(a: readonly string[], b: readonly string[]): number {
  if (!a.length || !b.length) return 0;
  let i = 0;
  let j = 0;
  let hits = 0;
  while (i < a.length && j < b.length) {
    const x = a[i] as string;
    const y = b[j] as string;
    if (x === y) {
      hits++;
      i++;
      j++;
    } else if (x < y) i++;
    else j++;
  }
  return (2 * hits) / (a.length + b.length);
}

const queryBigrams = new Map<string, string[]>();
function cachedBigrams(word: string): string[] {
  let b = queryBigrams.get(word);
  if (!b) {
    if (queryBigrams.size > 500) queryBigrams.clear();
    b = bigrams(word);
    queryBigrams.set(word, b);
  }
  return b;
}

interface Prepared {
  item: CatalogItem;
  name: string;
  nameT: string;
  nameW: string;
  nameWT: string;
  nameLoose: string;
  hasLat: boolean;
  codes: string[];
  codesLoose: string[];
  grp: string;
  grpT: string;
  grpW: string;
  grpWT: string;
  fuzzy?: { plain: FuzzyForm[]; both: FuzzyForm[] };
}

interface Token {
  q: string;
  qVars: string[];
}

const isWeightWord = (q: string) => q === 'вес' || (q.length >= 3 && ('весовой'.startsWith(q) || 'весовые'.startsWith(q)));

const variants = (s: string) => {
  const t = translit(s);
  return t === s ? [s] : [s, t];
};

// Транслит «съедает» буквы («водяной» → vodanoi), поэтому через него сравниваем, только когда языки разные.
function matchPre(
  text: string,
  textT: string,
  qVars: string[],
  w: readonly [number, number, number],
  textW: string,
  textWT: string,
  useT: boolean,
): number {
  if (!text) return 0;
  let s = 0;
  const forms: [string, string][] = text === textT || !useT ? [[text, textW]] : [[text, textW], [textT, textWT]];
  for (const [tv, tw] of forms) {
    for (const qv of qVars) {
      // Целое слово важнее куска: по «вода» сначала «Вода 0,5л», потом «Водолей».
      if (tw.includes(' ' + qv + ' ')) s = Math.max(s, w[1] + (tv.startsWith(qv) ? 20 : 10));
      else if (tv.startsWith(qv)) s = Math.max(s, w[0]);
      else if (tw.includes(' ' + qv)) s = Math.max(s, w[1]);
      else if (w[2] && qv.length >= MIDWORD_MIN && tv.includes(qv)) s = Math.max(s, w[2]);
    }
  }
  return s;
}

// Пары букв названия для разбора опечаток: считаются один раз на товар, а не на каждый поиск.
interface FuzzyForm {
  whole: string[];
  words: string[][];
}

function fuzzyForms(name: string, nameT: string): FuzzyForm[] {
  return (name === nameT ? [name] : [name, nameT]).map((nv) => {
    const clean = nv.replace(/[^a-zа-я0-9 ]/g, '');
    return { whole: bigrams(clean.replace(/\s+/g, '')), words: clean.split(/\s+/).filter(Boolean).map(bigrams) };
  });
}

// Нечёткое совпадение по парам букв — прощает опечатки («хатдок» → «хот-дог»).
function fuzzyScore(forms: FuzzyForm[], qVars: string[]): number {
  let best = 0;
  for (const form of forms) {
    for (const qv of qVars) {
      const qWords = qv.replace(/[^a-zа-я0-9 ]/g, '').split(/\s+/).filter((w) => w.length >= 3);
      if (!qWords.length) continue;
      let total = 0;
      for (const qw of qWords) {
        const qb = cachedBigrams(qw);
        let b = dice(qb, form.whole);
        for (const w of form.words) b = Math.max(b, dice(qb, w));
        total += b;
      }
      best = Math.max(best, total / qWords.length);
    }
  }
  return best;
}

export class CatalogSearch {
  private readonly prepared: Prepared[];
  private readonly groups: { id: string; n: string; t: string; w: string; wt: string }[];
  private index: Map<string, number[]> | null = null;

  constructor(items: readonly CatalogItem[], groups: readonly CatalogGroup[]) {
    const groupView = new Map<string, { n: string; t: string; w: string; wt: string }>();
    this.groups = groups.map((g) => {
      const n = norm(g.name);
      const t = translit(n);
      const view = { n, t, w: wordy(n), wt: t === n ? wordy(n) : wordy(t) };
      groupView.set(g.id, view);
      return { id: g.id, ...view };
    });
    this.prepared = items.map((item) => {
      const name = norm(item.name);
      const nameT = translit(name);
      const codes = [item.cashCode, item.article, ...item.barcodes].map(norm).filter(Boolean);
      const g = (item.groupId && groupView.get(item.groupId)) || { n: '', t: '', w: '', wt: '' };
      return {
        item,
        name,
        nameT,
        nameW: wordy(name),
        nameWT: wordy(nameT),
        nameLoose: stripPunct(name),
        hasLat: /[a-z]/.test(name),
        codes,
        codesLoose: codes.map(stripPunct).filter(Boolean),
        grp: g.n,
        grpT: g.t,
        grpW: g.w,
        grpWT: g.wt,
      };
    });
  }

  get size(): number {
    return this.prepared.length;
  }

  /** Указатель «первые три буквы слова → товары»: строится один раз, при первом поиске словом. */
  private wordIndex(): Map<string, number[]> {
    if (this.index) return this.index;
    const map = new Map<string, number[]>();
    const add = (word: string, i: number) => {
      if (!word) return;
      const k = word.slice(0, KEY);
      let arr = map.get(k);
      if (!arr) map.set(k, (arr = []));
      if (arr[arr.length - 1] !== i) arr.push(i);
    };
    this.prepared.forEach((p, i) => {
      for (const w of p.name.split(/[^a-zа-я0-9]+/)) {
        if (!w) continue;
        add(w, i);
        const head = w.slice(0, KEY + 1);
        const t = translit(head);
        if (t !== head) add(t, i);
      }
      // Коды из одних цифр ищутся отдельным быстрым путём; коды с буквами — словом.
      for (const c of [p.item.cashCode, p.item.article]) if (c && /[a-zа-яё]/i.test(c)) add(norm(c), i);
    });
    this.index = map;
    return map;
  }

  private scoreToken(p: Prepared, q: string, qVars: string[], allowFuzzy: boolean): number {
    let s = 0;
    for (const c of p.codes) {
      if (c === q) return 120;
      if (c.startsWith(q)) s = Math.max(s, 95);
      else if (c.includes(q)) s = Math.max(s, 70);
    }
    if (s < 95) {
      const qL = stripPunct(q);
      if (qL) {
        for (const c of p.codesLoose) {
          if (c === qL) return 118;
          if (c.startsWith(qL)) s = Math.max(s, 92);
          else if (c.includes(qL)) s = Math.max(s, 68);
        }
        if (qL.length >= MIDWORD_MIN && p.nameLoose.includes(qL)) s = Math.max(s, 78);
      }
    }
    const useT = p.hasLat || /[a-z]/.test(q);
    s = Math.max(s, matchPre(p.name, p.nameT, qVars, [92, 90, 55], p.nameW, p.nameWT, useT));
    if (p.grp) s = Math.max(s, matchPre(p.grp, p.grpT, qVars, [45, 42, 0], p.grpW, p.grpWT, useT));
    if (p.item.isWeighted && isWeightWord(q)) s = Math.max(s, 45);
    // Опечатки — только для запросов от 4 букв: на коротких похожесть по парам букв врёт («рис» ~ «Ирис»).
    if (allowFuzzy && s < 60 && q.length >= 4) {
      p.fuzzy ??= { plain: fuzzyForms(p.name, p.name), both: fuzzyForms(p.name, p.nameT) };
      const fuzzy = fuzzyScore(useT ? p.fuzzy.both : p.fuzzy.plain, useT ? qVars : [q]);
      if (fuzzy >= 0.4) s = Math.max(s, Math.round(65 * fuzzy));
    }
    return s;
  }

  // Вся фраза подряд или каждое слово в любом порядке («печенье яшкино») — берём лучшее.
  private scoreProduct(p: Prepared, q: string, qVars: string[], tokens: Token[], allowFuzzy: boolean): number {
    const whole = this.scoreToken(p, q, qVars, allowFuzzy);
    if (tokens.length <= 1) return whole;
    let total = 0;
    for (const tok of tokens) {
      const s = this.scoreToken(p, tok.q, tok.qVars, allowFuzzy);
      if (s <= 0) return whole;
      total += s;
    }
    return Math.max(whole, Math.round(total / tokens.length));
  }

  private candidates(tokens: Token[], qVars: string[]): Set<number> {
    const map = this.wordIndex();
    const out = new Set<number>();
    for (const t of tokens) {
      for (const v of t.qVars) {
        if (!v) continue;
        if (v.length >= KEY) {
          for (const i of map.get(v.slice(0, KEY)) ?? []) out.add(i);
        } else {
          for (const [k, arr] of map) if (k.startsWith(v)) for (const i of arr) out.add(i);
        }
      }
    }
    // «весовой» / «вес» — весовые товары: слова в названии нет, но балл за него есть (scoreToken).
    if (tokens.some((t) => isWeightWord(t.q))) this.prepared.forEach((p, i) => p.item.isWeighted && out.add(i));
    // Товары групп, чьё название подходит под запрос: по «молочные» — товары этой группы.
    const hit = new Set<string>();
    for (const g of this.groups) if (matchPre(g.n, g.t, qVars, [45, 42, 0], g.w, g.wt, true)) hit.add(g.id);
    if (hit.size) this.prepared.forEach((p, i) => p.item.groupId && hit.has(p.item.groupId) && out.add(i));
    return out;
  }

  // Дешёвая отбраковка перед разбором опечаток: в названии без знаков есть хотя бы две пары букв запроса.
  // Если подходит слишком много товаров (частые пары вроде «ко»), точной (дорогой) оценке отдаём только самых
  // похожих: товар, где совпали две пары из многих, всё равно не пройдёт порог.
  private fuzzyPool(q: string, qVars: string[], seen: Set<number>): number[] {
    const grams = (s: string) => [...new Set(Array.from({ length: Math.max(0, s.length - 1) }, (_, i) => s.slice(i, i + 2)))];
    const g1 = grams(q);
    const g2 = qVars[1] ? grams(qVars[1]) : [];
    const count = (name: string, gs: string[]) => {
      let m = 0;
      for (const g of gs) if (name.includes(g)) m++;
      return m;
    };
    const scored: { i: number; m: number }[] = [];
    this.prepared.forEach((p, i) => {
      if (seen.has(i)) return;
      const m = Math.max(count(p.nameLoose, g1), g2.length ? count(p.nameLoose, g2) : 0);
      if (m >= 2) scored.push({ i, m });
    });
    if (scored.length <= POOL_LIMIT) return scored.map((x) => x.i);
    // Берём самых похожих; равных по числу совпавших пар не разделяем — иначе можно отсечь всех сразу.
    scored.sort((a, b) => b.m - a.m);
    const need = (scored[POOL_LIMIT - 1] as { m: number }).m;
    return scored.filter((x) => x.m >= need).map((x) => x.i);
  }

  private finish(hits: { i: number; s: number }[]): CatalogItem[] {
    if (!hits.length) return [];
    const best = hits.reduce((m, x) => Math.max(m, x.s), 0);
    const floor = Math.max(SEARCH_THRESHOLD, best * RELATIVE_CUTOFF);
    return hits
      .filter((x) => x.s >= floor)
      .sort((a, b) => b.s - a.s || collator.compare(this.at(a.i).item.name, this.at(b.i).item.name))
      .map((x) => this.at(x.i).item);
  }

  private at(i: number): Prepared {
    const p = this.prepared[i];
    if (!p) throw new Error('index out of range');
    return p;
  }

  // Запрос из цифр — код или штрихкод: ищем напрямую по кодам, без транслита и опечаток.
  private searchByCode(q: string): CatalogItem[] {
    const hits: { i: number; s: number }[] = [];
    this.prepared.forEach((p, i) => {
      let s = 0;
      for (const c of p.codes) {
        if (c === q) {
          s = 120;
          break;
        }
        if (c.startsWith(q)) s = Math.max(s, 95);
        else if (c.includes(q)) s = Math.max(s, 70);
      }
      if (s < 118) {
        for (const c of p.codesLoose) {
          if (c === q) {
            s = Math.max(s, 118);
            break;
          }
          if (c.startsWith(q)) s = Math.max(s, 92);
          else if (c.includes(q)) s = Math.max(s, 68);
        }
      }
      if (s < 112) s = Math.max(s, matchPre(p.name, p.name, [q], [92, 90, 55], p.nameW, p.nameW, false));
      if (s >= SEARCH_THRESHOLD) hits.push({ i, s });
    });
    return this.finish(hits);
  }

  search(query: string): CatalogItem[] {
    const q = norm(query);
    if (!q) return [];
    if (/^\d{2,}$/.test(q)) return this.searchByCode(q);
    const qVars = variants(q);
    const tokens = q.split(/\s+/).filter(Boolean).map((w) => ({ q: w, qVars: variants(w) }));
    const hits = [...this.candidates(tokens, qVars)]
      .map((i) => ({ i, s: this.scoreProduct(this.at(i), q, qVars, tokens, false) }))
      .filter((x) => x.s >= SEARCH_THRESHOLD);
    // Опечатки: товар с опечаткой в кандидаты не попадает («хатдок» и «хот-дог» начинаются по-разному).
    if (hits.length < 20 && q.length >= 4) {
      const seen = new Set(hits.map((x) => x.i));
      for (const i of this.fuzzyPool(q, qVars, seen)) {
        const s = this.scoreProduct(this.at(i), q, qVars, tokens, true);
        if (s >= SEARCH_THRESHOLD) hits.push({ i, s });
      }
    }
    return this.finish(hits);
  }
}

const collator = new Intl.Collator('ru');
