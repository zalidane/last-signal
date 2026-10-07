import type { GameData, Journal, JournalEntry, LessonEntry, RunState } from "../models/types.ts";
import { craftingJournalEntries } from "./crafting.ts";
import { wildlifeJournalEntries } from "./wildlife.ts";

export const JOURNAL_KEY = "last-signal.journal.v1";

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export class MemoryStore implements KeyValueStore {
  private readonly map = new Map<string, string>();

  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }

  removeItem(key: string): void {
    this.map.delete(key);
  }
}

export function emptyJournal(): Journal {
  return {
    version: 1,
    discoveries: {},
    hazards: {},
    schematics: {},
    lessons: [],
    stats: { runs: 0, deaths: 0, rescues: 0, bestDays: 0, bestScore: 0 },
  };
}

export function loadJournal(store: KeyValueStore): Journal {
  const raw = store.getItem(JOURNAL_KEY);
  if (!raw) return emptyJournal();
  try {
    const parsed = JSON.parse(raw) as Partial<Journal>;
    const blank = emptyJournal();
    return {
      version: 1,
      discoveries: parsed.discoveries ?? {},
      hazards: parsed.hazards ?? {},
      schematics: parsed.schematics ?? {},
      lessons: Array.isArray(parsed.lessons) ? parsed.lessons : [],
      stats: { ...blank.stats, ...parsed.stats },
    };
  } catch {
    return emptyJournal();
  }
}

export function saveJournal(store: KeyValueStore, journal: Journal): void {
  store.setItem(JOURNAL_KEY, JSON.stringify(journal));
}

export function runNumber(journal: Journal): number {
  return journal.stats.runs + 1;
}

function put(
  bucket: Record<string, JournalEntry>,
  entry: JournalEntry,
): Record<string, JournalEntry> {
  if (bucket[entry.id]) return bucket;
  return { ...bucket, [entry.id]: entry };
}

export function learnDiscovery(
  journal: Journal,
  entry: JournalEntry,
): { journal: Journal; learned: boolean } {
  if (journal.discoveries[entry.id]) return { journal, learned: false };
  return { learned: true, journal: { ...journal, discoveries: put(journal.discoveries, entry) } };
}

export function learnHazard(
  journal: Journal,
  entry: JournalEntry,
): { journal: Journal; learned: boolean } {
  if (journal.hazards[entry.id]) return { journal, learned: false };
  return { learned: true, journal: { ...journal, hazards: put(journal.hazards, entry) } };
}

export function learnSchematic(
  journal: Journal,
  entry: JournalEntry,
): { journal: Journal; learned: boolean } {
  if (journal.schematics[entry.id]) return { journal, learned: false };
  return {
    learned: true,
    journal: { ...journal, schematics: put(journal.schematics, entry) },
  };
}

export function addLesson(journal: Journal, lesson: LessonEntry): Journal {
  return { ...journal, lessons: [...journal.lessons, lesson] };
}

export function isDiscovered(journal: Journal, discoveryId: string): boolean {
  return Boolean(journal.discoveries[discoveryId]);
}

export function knowsSchematic(journal: Journal, id: string): boolean {
  return Boolean(journal.schematics[id]);
}

export function journalCompletion(journal: Journal, data: GameData): number {
  const ids = [
    ...data.discoveries.map((d) => d.id),
    ...data.schematics.map((s) => s.id),
    ...data.hazards.map((h) => h.id),
    data.events.sandstorm.id,
    ...wildlifeJournalEntries(data).map((entry) => entry.id),
    ...craftingJournalEntries(data).map((entry) => entry.id),
    data.woundcare.journal.id,
    data.woundcare.infectionJournal.id,
  ];
  if (ids.length === 0) return 0;
  const known = ids.filter(
    (id) => journal.discoveries[id] || journal.schematics[id] || journal.hazards[id],
  ).length;
  return known / ids.length;
}

export function noteRunDiscovery(state: RunState, id: string): RunState {
  if (state.runDiscoveries.includes(id)) return state;
  return { ...state, runDiscoveries: [...state.runDiscoveries, id] };
}

export function noteRunSchematic(state: RunState, id: string): RunState {
  if (state.runSchematics.includes(id)) return state;
  return { ...state, runSchematics: [...state.runSchematics, id] };
}

export function noteRunHazard(state: RunState, id: string): RunState {
  if (state.runHazards.includes(id)) return state;
  return { ...state, runHazards: [...state.runHazards, id] };
}
