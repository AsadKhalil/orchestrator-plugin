import { parseUsd } from './costs.js';

type Sort = 'provider' | 'input' | 'output';
type Model = { providerID: string; id: string; name: string };
type Price = { id: string; inputPerMillionUsd: string | null; outputPerMillionUsd: string | null; dynamicRouter: boolean };
/** Sort display records only; rates are base estimates and never determine role selection. */
export function sortModelInventory<T extends Model>(models: readonly T[], prices: readonly Price[], sort: Sort): T[] {
  if (!['provider', 'input', 'output'].includes(sort)) throw new Error('Invalid model sort');
  const byID = new Map(prices.map(price => [price.id, price]));
  const priceFor = (model: Model): bigint | null => {
    if (model.providerID !== 'openrouter') return null;
    const price = byID.get(model.id); if (!price || price.dynamicRouter) return null;
    const value = sort === 'input' ? price.inputPerMillionUsd : price.outputPerMillionUsd;
    if (value === null) return null;
    try { return parseUsd(value); } catch { return null; }
  };
  return [...models].sort((a,b) => {
    if (sort !== 'provider') {
      const x = priceFor(a), y = priceFor(b);
      if (x === null && y !== null) return 1;
      if (x !== null && y === null) return -1;
      if (x !== null && y !== null && x !== y) return x < y ? -1 : 1;
    }
    return a.providerID.localeCompare(b.providerID) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
  });
}
