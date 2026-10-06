import type { GameData, Journal, RunState, ScoreBreakdown } from "../models/types.ts";
import { journalCompletion } from "./journal.ts";

export function computeScore(
  state: RunState,
  journal: Journal,
  data: GameData,
  rescued: boolean,
): ScoreBreakdown {
  const survival = state.day * data.score.perDay;
  const discoveries = state.runDiscoveries.length * data.score.perDiscovery;
  const schematics = state.runSchematics.length * data.score.perSchematic;
  const rescue = rescued ? data.score.rescueBonus : 0;
  const completion = journalCompletion(journal, data);
  const journalPts = Math.round(completion * data.score.journalScale);
  return {
    survival,
    discoveries,
    schematics,
    rescue,
    journal: journalPts,
    total: survival + discoveries + schematics + rescue + journalPts,
    completion,
  };
}
