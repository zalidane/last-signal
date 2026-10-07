import type { GameData, Journal, RunState, Threat } from "../models/types.ts";
import { addLesson, runNumber } from "./journal.ts";
import { effectiveRescueDay } from "./rescue.ts";
import { computeScore } from "./score.ts";
import { craftingJournalEntries } from "./crafting.ts";
import { wildlifeJournalEntries } from "./wildlife.ts";

function discoveryName(id: string, data: GameData): string {
  return (
    data.discoveryById.get(id)?.name ??
    wildlifeJournalEntries(data).find((entry) => entry.id === id)?.name ??
    craftingJournalEntries(data).find((entry) => entry.id === id)?.name ??
    id
  );
}

function hazardName(id: string, data: GameData): string {
  return (
    data.hazardById.get(id)?.name ??
    (id === data.events.sandstorm.id ? data.events.sandstorm.name : id)
  );
}

export function conclude(
  state: RunState,
  journal: Journal,
  data: GameData,
  rescued: boolean,
): { state: RunState; journal: Journal } {
  if (state.ending) return { state, journal };
  const cause: Threat = rescued
    ? "rescued"
    : (state.pendingCause ?? state.lastThreat ?? "dehydration");
  const lessonDef = data.lessons[cause];
  const run = runNumber(journal);
  let nextJournal = journal;
  if (!rescued) {
    nextJournal = addLesson(nextJournal, {
      id: `death-${cause}-run${run}-d${state.day}-s${state.seed}`,
      cause,
      day: state.day,
      text: lessonDef.lesson,
      run,
      seed: state.seed,
    });
  }
  const score = computeScore(state, nextJournal, data, rescued);
  nextJournal = {
    ...nextJournal,
    stats: {
      runs: nextJournal.stats.runs + 1,
      deaths: nextJournal.stats.deaths + (rescued ? 0 : 1),
      rescues: nextJournal.stats.rescues + (rescued ? 1 : 0),
      bestDays: Math.max(nextJournal.stats.bestDays, state.day),
      bestScore: Math.max(nextJournal.stats.bestScore, score.total),
    },
  };
  return {
    journal: nextJournal,
    state: {
      ...state,
      phase: "ended",
      pendingCause: cause,
      ending: {
        rescued,
        day: state.day,
        hour: state.hour,
        cause,
        causeLabel: lessonDef.label,
        card: lessonDef.card,
        lesson: rescued ? "" : lessonDef.lesson,
        baseRescueDay: state.rescue.baseDay,
        effectiveRescueDay: effectiveRescueDay(
          state.rescue.baseDay,
          state.rescue.signalDays,
          data.rescue,
        ),
        signalDays: state.rescue.signalDays,
        discoveries: state.runDiscoveries.map((id) => discoveryName(id, data)),
        schematics: state.runSchematics.map(
          (id) => data.schematicById.get(id)?.name ?? craftingJournalEntries(data).find((entry) => entry.id === id)?.name ?? id,
        ),
        hazards: state.runHazards.map((id) => hazardName(id, data)),
        score,
        seed: state.seed,
        biomeId: data.biome.id,
        biomeName: data.biome.name,
      },
    },
  };
}

export function finishIfEnded(
  state: RunState,
  journal: Journal,
  data: GameData,
): { state: RunState; journal: Journal } {
  if (state.phase === "ended" && !state.ending) return conclude(state, journal, data, false);
  return { state, journal };
}
