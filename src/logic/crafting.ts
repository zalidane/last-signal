import type {
  GameData,
  GearBuild,
  Journal,
  MaterialDef,
  RunState,
  SlotId,
  ToolDef,
  WeaponDef,
} from "../models/types.ts";
import { hasAll } from "./inventory.ts";
import { clamp, round2 } from "./util.ts";

/**
 * Component crafting. Every tool is a handle + a tool end + a binding.
 * The tool decides which handle lengths and which end kind fit; the material decides the modifiers.
 */

export const SLOTS: SlotId[] = ["handle", "end", "binding"];

export function fits(tool: ToolDef, material: MaterialDef, slot: SlotId): boolean {
  if (material.slot !== slot) return false;
  if (slot === "handle") return Boolean(material.length && tool.handle.lengths.includes(material.length));
  if (slot === "end") return material.kind === tool.end;
  return true;
}

/** Every material the tool accepts in a slot, in data order. */
export function slotMaterials(tool: ToolDef, slot: SlotId, data: GameData): MaterialDef[] {
  return data.crafting.materials.filter((material) => fits(tool, material, slot));
}

export function hasMaterial(state: RunState, material: MaterialDef): boolean {
  return hasAll(state.inventory, material.consumes);
}

export function buildMaterials(build: GearBuild, data: GameData): MaterialDef[] {
  return SLOTS.map((slot) => data.materialById.get(build[slot])).filter((m): m is MaterialDef => Boolean(m));
}

/** Everything a build consumes, summed (cloth strips plus resin cloth needs two cloth). */
export function buildCost(build: GearBuild, data: GameData): Record<string, number> {
  const cost: Record<string, number> = {};
  for (const material of buildMaterials(build, data)) {
    for (const [id, qty] of Object.entries(material.consumes)) cost[id] = (cost[id] ?? 0) + qty;
  }
  return cost;
}

export function craftHours(tool: ToolDef, build: GearBuild, data: GameData): number {
  return tool.hours + buildMaterials(build, data).reduce((sum, m) => sum + (m.extraHours ?? 0), 0);
}

export function handlePenalty(tool: ToolDef, build: GearBuild, data: GameData): number {
  const handle = data.materialById.get(build.handle);
  return handle ? (tool.handle.kindPenalty?.[handle.kind] ?? 0) : 0;
}

/** Sum of kill modifiers, including tool-specific handle penalties (plastic on a spear). */
export function killBonus(tool: ToolDef, build: GearBuild, data: GameData): number {
  const sum = buildMaterials(build, data).reduce((total, m) => total + m.mods.kill, 0);
  return round2(sum + handlePenalty(tool, build, data));
}

export function breakChance(build: GearBuild, data: GameData): number {
  const sum = buildMaterials(build, data).reduce((total, m) => total + m.mods.breakOnFail, 0);
  return round2(clamp(sum, 0, data.crafting.maxBreak));
}

export function torchBurns(build: GearBuild, data: GameData): number {
  const mats = buildMaterials(build, data);
  const end = mats.find((m) => m.slot === "end");
  const extra = mats.reduce((total, m) => total + (m.mods.torchBurns ?? 0), 0);
  return Math.max(1, (end?.mods.burns ?? 1) + extra);
}

export function toolForWeapon(weaponId: string, data: GameData): ToolDef | undefined {
  return data.crafting.tools.find((tool) => tool.weapon === weaponId);
}

/** A crafted weapon with its build applied. Uncrafted weapons come back unchanged. */
export function applyBuild(weapon: WeaponDef, build: GearBuild | undefined, data: GameData): WeaponDef {
  if (!weapon.crafted) return { ...weapon, breakChance: 0 };
  const tool = toolForWeapon(weapon.id, data);
  if (!build || !tool) return { ...weapon, breakChance: 0 };
  const bonus = killBonus(tool, build, data);
  const kill: Record<string, number> = {};
  for (const [animal, odds] of Object.entries(weapon.kill)) kill[animal] = round2(odds + bonus);
  const parts = buildMaterials(build, data).map((m) => m.short.replace(/ \(.*\)$/, ""));
  return {
    ...weapon,
    name: `${weapon.name} (${parts.join(", ")})`,
    kill,
    breakChance: breakChance(build, data),
    build,
  };
}

/** Which part gave out: the one most likely to. */
export function brokenPart(build: GearBuild, data: GameData): MaterialDef | undefined {
  return [...buildMaterials(build, data)].sort((a, b) => b.mods.breakOnFail - a.mods.breakOnFail)[0];
}

function score(tool: ToolDef, material: MaterialDef, data: GameData): number {
  const pick = data.crafting.autoPick;
  const hours = (material.extraHours ?? 0) * pick.hourWeight;
  if (tool.end === "flammable") return (material.mods.burns ?? 0) + (material.mods.torchBurns ?? 0) - hours;
  const penalty = material.slot === "handle" ? (tool.handle.kindPenalty?.[material.kind] ?? 0) : 0;
  return material.mods.kill + penalty - material.mods.breakOnFail * pick.breakWeight - hours;
}

export interface Resolved {
  build: GearBuild | null;
  /** Per slot: the material that will be used, if any. */
  chosen: Partial<Record<SlotId, string>>;
  /** Slots with nothing usable in the pack. */
  missing: SlotId[];
}

/**
 * Fill each slot. Explicit picks are honored when the pack can cover them;
 * the rest go to the best-scoring affordable combination.
 */
export function resolveBuild(
  state: RunState,
  tool: ToolDef,
  data: GameData,
  picks: Partial<Record<SlotId, string>> = {},
): Resolved {
  const options: Record<SlotId, MaterialDef[]> = { handle: [], end: [], binding: [] };
  const missing: SlotId[] = [];
  for (const slot of SLOTS) {
    const have = slotMaterials(tool, slot, data).filter((m) => hasMaterial(state, m));
    const picked = picks[slot] ? have.find((m) => m.id === picks[slot]) : undefined;
    options[slot] = picked ? [picked] : have;
    if (have.length === 0) missing.push(slot);
  }
  let best: { build: GearBuild; score: number } | null = null;
  for (const handle of options.handle) {
    for (const end of options.end) {
      for (const binding of options.binding) {
        const build = { handle: handle.id, end: end.id, binding: binding.id };
        if (!hasAll(state.inventory, buildCost(build, data))) continue;
        const total = score(tool, handle, data) + score(tool, end, data) + score(tool, binding, data);
        if (!best || total > best.score + 1e-9) best = { build, score: total };
      }
    }
  }
  const chosen: Partial<Record<SlotId, string>> = {};
  if (best) Object.assign(chosen, best.build);
  else {
    for (const slot of SLOTS) {
      const first = options[slot][0];
      if (first) chosen[slot] = first.id;
    }
  }
  return { build: best?.build ?? null, chosen, missing };
}

function listOr(names: string[]): string {
  if (names.length <= 1) return names.join("");
  if (names.length === 2) return `${names[0]} or ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, or ${names[names.length - 1]}`;
}

function article(phrase: string): string {
  return /^(a|an) /.test(phrase) ? phrase : `${/^[aeiou]/i.test(phrase) ? "an" : "a"} ${phrase}`;
}

/** Exactly which slot is missing, and what would fill it. */
export function missingSlotText(state: RunState, tool: ToolDef, slot: SlotId, data: GameData): string {
  const names = [...new Set(slotMaterials(tool, slot, data).map((m) => m.short.replace(/ \(.*\)$/, "")))];
  if (slot === "handle") {
    const wrongLength = data.crafting.materials.some(
      (m) => m.slot === "handle" && !fits(tool, m, "handle") && hasMaterial(state, m),
    );
    const note = wrongLength && tool.lengthNote ? ` ${tool.lengthNote}` : "";
    return `Needs ${article(tool.handle.label)}: ${listOr(names)}.${note}`;
  }
  if (slot === "end") {
    const flammable = tool.end === "flammable";
    const named = flammable
      ? slotMaterials(tool, slot, data).map((m) => m.short)
      : names;
    return `Needs ${data.crafting.slotWords[tool.end]}: ${listOr(named)}.`;
  }
  return `Needs a binding: ${listOr(names)}.`;
}

export function carryBlock(state: RunState, tool: ToolDef, data: GameData): string | null {
  const have = state.inventory[tool.item] ?? 0;
  if (have < tool.maxCarry) return null;
  const name = data.itemById.get(tool.item)?.name.toLowerCase() ?? tool.name.toLowerCase();
  return tool.end === "flammable"
    ? `You already carry ${have} torch burns. Use some first.`
    : `You already carry a ${name}.`;
}

/** Why this tool cannot be crafted right now, or null if it can. Slot problems come first. */
export function craftBlock(state: RunState, tool: ToolDef, data: GameData, resolved?: Resolved): string | null {
  const carry = carryBlock(state, tool, data);
  if (carry) return carry;
  const res = resolved ?? resolveBuild(state, tool, data);
  if (res.missing.length) return res.missing.map((slot) => missingSlotText(state, tool, slot, data)).join(" ");
  if (!res.build) return "The parts you picked need more than you carry. Pick a different binding.";
  if (!tool.where.includes(state.location)) {
    return `Build this at ${tool.where.length === 1 && tool.where[0] === "camp" ? "camp" : tool.where.join(" or ")}.`;
  }
  return null;
}

export function patternId(tool: ToolDef): string {
  return `pattern-${tool.id}`;
}

export function materialNoteId(material: MaterialDef): string {
  return `material-${material.id}`;
}

export function knowsPattern(journal: Journal, tool: ToolDef): boolean {
  return Boolean(journal.schematics[patternId(tool)]);
}

/** Short modifier text for a material in a given tool. */
export function describeMaterial(tool: ToolDef, material: MaterialDef, state: RunState): string {
  const bits: string[] = [];
  const pct = (n: number) => `${n > 0 ? "+" : "−"}${Math.round(Math.abs(n) * 100)}%`;
  if (tool.end === "flammable") {
    if (material.mods.burns) bits.push(`${material.mods.burns} burns`);
    if (material.mods.torchBurns) bits.push(`${material.mods.torchBurns > 0 ? "+" : "−"}${Math.abs(material.mods.torchBurns)} burn`);
  } else {
    const penalty = material.slot === "handle" ? (tool.handle.kindPenalty?.[material.kind] ?? 0) : 0;
    const kill = round2(material.mods.kill + penalty);
    if (kill !== 0) bits.push(`${pct(kill)} kill`);
    if (penalty !== 0) bits.push("flexes");
    if (material.mods.breakOnFail >= 0.1) bits.push(material.mods.breakOnFail >= 0.25 ? "brittle" : "can slip");
    else if (material.mods.breakOnFail <= 0.02) bits.push("sturdy");
  }
  if (bits.length === 0) bits.push("no modifier");
  if (material.extraHours) bits.push(`+${material.extraHours}h to prepare`);
  const items = Object.keys(material.consumes);
  if (items.length > 1) bits.push(`uses ${items.join(" + ")}`);
  const qty = items.length === 1 ? (state.inventory[items[0] as string] ?? 0) : null;
  if (qty !== null && qty > 0) bits.push(`×${qty}`);
  return bits.join(" · ");
}

export function slotRule(tool: ToolDef, slot: SlotId): string {
  if (slot === "handle") {
    const kinds = "wood, metal, or plastic";
    const len = tool.handle.lengths.length === 2 ? "Any length" : tool.handle.lengths[0] === "long" ? "Long only" : "Short only";
    const note = Object.values(tool.handle.kindNote ?? {}).join(" ");
    return `${len} · ${kinds}${note ? `. ${note}` : ""}`;
  }
  if (slot === "end") return `${tool.end[0]?.toUpperCase()}${tool.end.slice(1)}`;
  return "Holds it together. Better bindings come apart less.";
}

/** Every journal id crafting can write: tool patterns (schematics) and material notes (discoveries). */
export function craftingJournalEntries(data: GameData): { id: string; name: string; kind: "schematic" | "discovery" }[] {
  return [
    ...data.crafting.tools.map((tool) => ({ id: patternId(tool), name: tool.pattern.name, kind: "schematic" as const })),
    ...data.crafting.materials.map((material) => ({ id: materialNoteId(material), name: material.note.name, kind: "discovery" as const })),
  ];
}
