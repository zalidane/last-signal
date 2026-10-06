import type { GameData, Journal } from "../models/types.ts";

export function itemQty(inventory: Record<string, number>, id: string): number {
  return inventory[id] ?? 0;
}

export function addItem(
  inventory: Record<string, number>,
  id: string,
  qty: number,
): Record<string, number> {
  const next = { ...inventory };
  const sum = Math.round(((next[id] ?? 0) + qty) * 100) / 100;
  if (sum <= 0.001) delete next[id];
  else next[id] = sum;
  return next;
}

export function hasAll(
  inventory: Record<string, number>,
  requires: Record<string, number>,
): boolean {
  return Object.entries(requires).every(([id, qty]) => (inventory[id] ?? 0) >= qty);
}

export function spend(
  inventory: Record<string, number>,
  requires: Record<string, number>,
): Record<string, number> {
  let next = inventory;
  for (const [id, qty] of Object.entries(requires)) next = addItem(next, id, -qty);
  return next;
}

export function missingNames(
  inventory: Record<string, number>,
  requires: Record<string, number>,
  data: GameData,
): string[] {
  const names: string[] = [];
  for (const [id, qty] of Object.entries(requires)) {
    const have = inventory[id] ?? 0;
    if (have < qty) {
      const item = data.itemById.get(id);
      names.push(`${item?.name ?? id} ${have}/${qty}`);
    }
  }
  return names;
}

export interface PresentedItem {
  id: string;
  name: string;
  blurb: string;
  known: boolean;
  discoveryId: string | null;
}

/** Journal knowledge renames an item. Stats do not. */
export function presentItem(itemId: string, journal: Journal, data: GameData): PresentedItem {
  const item = data.itemById.get(itemId);
  const discovery = data.discoveryByItemId.get(itemId);
  if (!item) {
    return { id: itemId, name: itemId, blurb: "", known: true, discoveryId: null };
  }
  if (!discovery) {
    return { id: itemId, name: item.name, blurb: item.blurb, known: true, discoveryId: null };
  }
  const known = Boolean(journal.discoveries[discovery.id]);
  return {
    id: itemId,
    name: known ? discovery.name : discovery.unknownName,
    blurb: known ? discovery.summary : discovery.unknownBlurb,
    known,
    discoveryId: discovery.id,
  };
}

export function findLog(itemId: string, journal: Journal, data: GameData): string {
  if (itemId === "nothing") return data.copy.nothingLog;
  const presented = presentItem(itemId, journal, data);
  const item = data.itemById.get(itemId);
  if (presented.discoveryId && presented.known) {
    return data.copy.knownFindLog.replace("{name}", presented.name);
  }
  return item?.foundLog ?? `You find ${presented.name}.`;
}
