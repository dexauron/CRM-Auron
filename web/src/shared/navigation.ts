// Каталог и инструменты — в адресе, включая переход из проверки в карточку товара.
import { issueKinds, type IssueKind } from '../api/catalogTools';

export type Screen = { name: 'home' } | {
  name: 'catalog'; groupId: string | null; productId: string | null; tools: boolean; issueKind: IssueKind | null;
  /** «Закончилось на полке» (ПСТ-3). */
  restock: boolean;
} | { name: 'suppliers'; supplierId: string | null };
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const CATALOG_HASH = new RegExp(`^#catalog(?:/(${UUID}))?(?:/item/(${UUID}))?$`);
const TOOLS_HASH = new RegExp(`^#catalog/tools(?:/(${issueKinds.join('|')}))?(?:/item/(${UUID}))?$`);
const SUPPLIERS_HASH = new RegExp(`^#suppliers(?:/(${UUID}))?$`);
const RESTOCK_HASH = new RegExp(`^#catalog/restock(?:/item/(${UUID}))?$`);

export function screenFromHash(hash: string): Screen {
  const suppliers = SUPPLIERS_HASH.exec(hash);
  if (suppliers) return { name: 'suppliers', supplierId: suppliers[1] ?? null };
  const restock = RESTOCK_HASH.exec(hash);
  if (restock) return { name: 'catalog', groupId: null, productId: restock[1] ?? null, tools: false, issueKind: null, restock: true };
  const tools = TOOLS_HASH.exec(hash);
  if (tools) {
    return {
      name: 'catalog', groupId: null, productId: tools[2] ?? null, tools: true,
      issueKind: (tools[1] as IssueKind | undefined) ?? null, restock: false,
    };
  }
  const catalog = CATALOG_HASH.exec(hash);
  return catalog
    ? { name: 'catalog', groupId: catalog[1] ?? null, productId: catalog[2] ?? null, tools: false, issueKind: null, restock: false }
    : { name: 'home' };
}

export function catalogListHash(screen: Extract<Screen, { name: 'catalog' }>): string {
  if (screen.restock) return 'catalog/restock';
  if (screen.tools) return `catalog/tools${screen.issueKind ? `/${screen.issueKind}` : ''}`;
  return screen.groupId ? `catalog/${screen.groupId}` : 'catalog';
}

/** Родитель прямой ссылки, если внутри приложения ещё нет истории переходов. */
export function parentHash(screen: Screen): string {
  if (screen.name === 'suppliers') return screen.supplierId ? 'suppliers' : '';
  if (screen.name !== 'catalog') return '';
  if (screen.productId) return catalogListHash(screen);
  if (screen.tools) return screen.issueKind ? 'catalog/tools' : 'catalog';
  if (screen.restock) return 'catalog';
  return screen.groupId ? 'catalog' : '';
}
