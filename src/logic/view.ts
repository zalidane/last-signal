import type {
  SlotId,
  EndView,
  GameData,
  Journal,
  JournalView,
  MeterView,
  PlayView,
  RunState,
  Tone,
  ViewModel,
} from "../models/types.ts";
import { buildCraftView, buildItemModal, listActions } from "./actions.ts";
import { presentItem } from "./inventory.ts";
import { journalCompletion } from "./journal.ts";
import { regenBlockers } from "./needs.ts";
import { lightAt, paceMultiplier } from "./pace.ts";
import { bestWeapon, killOdds } from "./wildlife.ts";
import { bandAt } from "./time.ts";
import { formatHour, formatStamp } from "./util.ts";

export interface UiFlags {
  journalOpen: boolean;
  itemId: string | null;
  /** One-time message for the title screen, e.g. an old save that could not be resumed. */
  notice?: string | null;
  /** The open build dialog and any per-slot picks the player made. */
  craft?: { toolId: string; picks: Partial<Record<SlotId, string>> } | null;
}

const CATEGORY_ORDER = ["water", "food", "discovery", "medical", "tool", "material"];

export function campTier(state: RunState): { level: number; name: string } {
  if (state.camp.signalBuilt) return { level: 5, name: "Signal Station" };
  if (state.camp.stills.length > 0) return { level: 3, name: "Water Collection" };
  if (state.camp.firePit) return { level: 2, name: "Fire Pit" };
  if (state.camp.shelter) return { level: 1, name: "Basic Shelter" };
  return { level: 0, name: "Crash Site" };
}

function meterTone(id: string, value: number, data: GameData): Tone {
  const spec = data.needs.meters[id];
  if (!spec) return "ok";
  if (spec.highIsBad) {
    if (value >= spec.danger) return "danger";
    if (value >= spec.warn) return "warn";
    return "ok";
  }
  if (value <= spec.danger) return "danger";
  if (value <= spec.warn) return "warn";
  return "ok";
}

function thermal(state: RunState, data: GameData): { label: string; tone: Tone; safety: number } {
  const temp = state.bodyTempC;
  const t = data.needs.bodyTemp;
  if (temp >= t.heatCriticalC) return { label: "Heat stroke", tone: "danger", safety: 8 };
  if (temp >= t.heatSevereC) return { label: "Severe heat", tone: "danger", safety: 22 };
  if (temp >= t.heatMildC) return { label: "Overheating", tone: "warn", safety: 40 };
  if (temp <= t.coldSevereC) return { label: "Hypothermia", tone: "cold", safety: 12 };
  if (temp <= t.coldMildC) return { label: "Too cold", tone: "cold", safety: 36 };
  if (temp > t.comfortMaxC) return { label: "Warm", tone: "warn", safety: 70 };
  if (temp < t.comfortMinC) return { label: "Cool", tone: "cold", safety: 74 };
  return { label: "Steady", tone: "ok", safety: 100 };
}

function stillDetail(state: RunState, data: GameData): string {
  const stills = state.camp.stills;
  if (stills.length === 0) return "None yet. One still yields about 0.5–1 L at dawn. You want about three.";
  const wash = stills.filter((still) => still.wash).length;
  const min = stills.length * data.events.stillLitersMin;
  const max = stills.reduce(
    (sum, still) => sum + (still.wash ? data.events.washStillCap : data.events.stillLitersMax),
    0,
  );
  const place = wash ? `, ${wash} dug in the wash` : "";
  return `${stills.length} running${place} · about ${min.toFixed(1)}–${max.toFixed(1)} L at dawn`;
}

export function projectPlay(state: RunState, journal: Journal, data: GameData): PlayView {
  const band = bandAt(state.hour, data.biome);
  const tier = campTier(state);
  const pace = paceMultiplier(state, data, false);
  const light = lightAt(state, data);
  const blockers = regenBlockers(state, data);
  const paceNotes = [...pace.notes];
  paceNotes.push(
    blockers.length
      ? `No healing while ${blockers.join(", ")}.`
      : "Resting, sleeping, or waiting will slowly heal you.",
  );
  const animal = state.pending ? data.animalById.get(state.pending.animalId) : undefined;
  const weapon = bestWeapon(state, data, animal);
  const heat = thermal(state, data);
  const zone = state.location === "camp" ? null : data.zoneById.get(state.location);
  const meters: MeterView[] = [
    {
      id: "health",
      label: "Health",
      valueLabel: String(Math.round(state.health)),
      fill: state.health,
      tone: meterTone("health", state.health, data),
    },
    {
      id: "hydration",
      label: "Hydration",
      valueLabel: String(Math.round(state.hydration)),
      fill: state.hydration,
      tone: meterTone("hydration", state.hydration, data),
    },
    {
      id: "hunger",
      label: "Hunger",
      valueLabel: String(Math.round(state.hunger)),
      fill: state.hunger,
      tone: meterTone("hunger", state.hunger, data),
    },
    {
      id: "thermal",
      label: "Temperature",
      valueLabel: `${state.bodyTempC.toFixed(1)}°C · ${heat.label}`,
      fill: heat.safety,
      tone: heat.tone,
    },
    {
      id: "fatigue",
      label: "Fatigue",
      valueLabel: String(Math.round(state.fatigue)),
      fill: state.fatigue,
      tone: meterTone("fatigue", state.fatigue, data),
    },
    {
      id: "morale",
      label: "Morale",
      valueLabel: String(Math.round(state.morale)),
      fill: state.morale,
      tone: meterTone("morale", state.morale, data),
    },
  ];

  const inventory = Object.entries(state.inventory)
    .filter(([, qty]) => qty > 0)
    .map(([id, qty]) => {
      const item = data.itemById.get(id);
      const presented = presentItem(id, journal, data);
      const qtyLabel = item?.unit === "L" ? `${qty.toFixed(1)} L` : item?.unit === "burns" ? `${qty} burn${qty === 1 ? "" : "s"}` : `×${qty}`;
      return {
        id,
        name: presented.name,
        qtyLabel,
        category: item?.category ?? "material",
        known: presented.known,
        warning: Boolean(presented.discoveryId) && !presented.known,
      };
    })
    .sort((a, b) => CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category));

  const pins = [
    {
      id: "camp",
      name: data.camp.name,
      hours: 0,
      blurb: data.camp.blurb,
      here: state.location === "camp",
      x: 16,
      y: 76,
    },
    ...data.zones.map((entry, index) => ({
      id: entry.id,
      name: entry.name,
      hours: entry.travelHours,
      blurb: entry.blurb,
      here: state.location === entry.id,
      x: [40, 66, 88][index] ?? 50,
      y: [58, 36, 16][index] ?? 40,
    })),
  ];

  return {
    day: state.day,
    hourLabel: formatHour(state.hour),
    bandId: band.id,
    bandName: band.name,
    airTempC: band.airTempC,
    locationId: state.location,
    locationName: zone?.name ?? data.camp.name,
    locationBlurb: zone?.blurb ?? data.camp.blurb,
    pace: {
      mult: Math.round(pace.mult * 100) / 100,
      label: pace.mult <= 1.001 ? "Steady" : `×${pace.mult.toFixed(2)}`,
      notes: paceNotes,
    },
    dark: light !== "day",
    lightLabel:
      light === "day" ? "Daylight" : light === "fire" ? "Dark · fire pit lit" : light === "torch" ? "Dark · torch in pack" : "Dark · no light",
    sighting: animal
      ? {
          animalName: animal.name,
          text: state.pending?.ambush ? `${animal.ambushLog} ${"It is revealed: easier to kill now."}` : animal.sightLog,
          weaponName: weapon.name,
          killOdds: killOdds(state, animal, weapon, data),
        }
      : null,
    meters,
    conditions: state.conditions.map((condition) => {
      const name = data.conditions[condition.id]?.name ?? condition.id;
      return `${name} · ${condition.hoursLeft}h`;
    }).concat(state.sprainHours > 0 ? [`Sprained ankle · ${state.sprainHours}h`] : []),
    tierLevel: tier.level,
    tierName: tier.name,
    shelter: state.camp.shelter,
    firePit: state.camp.firePit,
    stillCount: state.camp.stills.length,
    stillDetail: stillDetail(state, data),
    signal: state.camp.signalLit ? "lit" : state.camp.signalBuilt ? "out" : "unbuilt",
    beaconNights: state.camp.signalLit || state.camp.signalBuilt ? state.rescue.signalDays : state.rescue.signalDays,
    fuel: state.inventory.fuel ?? 0,
    sandstorm: state.sandstorm,
    wreckSearchesLeft: state.camp.wreckSearchesLeft,
    inventory,
    actions: listActions(state, journal, data),
    log: state.log.map((line) => ({
      id: line.id,
      stamp: formatStamp(line.day, line.hour),
      text: line.text,
    })),
    pins,
    classified: data.copy.classified,
  };
}

function projectJournal(journal: Journal, data: GameData): JournalView {
  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
  return {
    preface: data.copy.journalPreface,
    discoveries: Object.values(journal.discoveries).sort(byName),
    hazards: Object.values(journal.hazards).sort(byName),
    schematics: Object.values(journal.schematics).sort(byName),
    lessons: [...journal.lessons].reverse(),
    completion: journalCompletion(journal, data),
    stats: journal.stats,
    knownIds: [
      ...Object.keys(journal.discoveries),
      ...Object.keys(journal.schematics),
      ...Object.keys(journal.hazards),
    ],
  };
}

function projectEnd(state: RunState): EndView | null {
  const ending = state.ending;
  if (!ending) return null;
  return {
    rescued: ending.rescued,
    heading: ending.rescued ? "Signal received" : "No contact",
    card: ending.card,
    day: ending.day,
    hourLabel: formatHour(ending.hour),
    biomeName: ending.biomeName,
    causeLabel: ending.causeLabel,
    lesson: ending.lesson,
    baseRescueDay: ending.baseRescueDay,
    effectiveRescueDay: ending.effectiveRescueDay,
    signalDays: ending.signalDays,
    discoveries: ending.discoveries,
    schematics: ending.schematics,
    score: ending.score,
    seed: ending.seed,
  };
}

export function projectView(
  state: RunState | null,
  journal: Journal,
  ui: UiFlags,
  data: GameData,
  screen: ViewModel["screen"],
): ViewModel {
  const play = state ? projectPlay(state, journal, data) : null;
  return {
    screen,
    notice: ui.notice ?? null,
    journalOpen: ui.journalOpen,
    title: data.copy.title,
    tagline: data.copy.tagline,
    standingOrders: data.copy.standingOrders,
    journal: projectJournal(journal, data),
    play,
    end: state ? projectEnd(state) : null,
    modal:
      state && ui.itemId && state.phase === "playing"
        ? buildItemModal(state, journal, ui.itemId, data)
        : null,
    craft:
      state && ui.craft && state.phase === "playing" && !state.pending
        ? buildCraftView(state, journal, ui.craft.toolId, ui.craft.picks ?? {}, data)
        : null,
  };
}
