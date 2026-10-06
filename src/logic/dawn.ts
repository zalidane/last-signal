import type { GameData, Journal, RunState } from "../models/types.ts";
import { hurt } from "./effects.ts";
import { conclude } from "./ending.ts";
import { applyHazard } from "./hazards.ts";
import { addItem } from "./inventory.ts";
import { learnHazard, noteRunHazard, runNumber } from "./journal.ts";
import { pushLog } from "./log.ts";
import { computeBudget } from "./needs.ts";
import type { Rng } from "./rng.ts";
import { effectiveRescueDay } from "./rescue.ts";
import { clamp, round2 } from "./util.ts";

export function rollStillYield(next: () => number, wash: boolean, data: GameData): number {
  const span = data.events.stillLitersMax - data.events.stillLitersMin;
  const liters = data.events.stillLitersMin + next() * span;
  const yielded = wash ? Math.min(data.events.washStillCap, liters + data.events.washStillBonus) : liters;
  return round2(yielded);
}

export function resolveDawn(
  state: RunState,
  journal: Journal,
  data: GameData,
  rng: Rng,
): { state: RunState; journal: Journal } {
  let current: RunState = { ...state, pearsToday: 0 };
  if (current.phase === "ended") return { state: current, journal };

  if (!current.camp.firePit) {
    const visit = data.events.nightVisitor;
    const chance = current.camp.shelter ? visit.shelterChance : visit.chance;
    if (rng.next() < chance) {
      const hazard = data.hazardById.get(visit.hazardId);
      if (hazard) {
        const applied = applyHazard(
          current,
          journal,
          hazard,
          data,
          current.camp.shelter ? visit.shelterLog : visit.log,
        );
        current = applied.state;
        journal = applied.journal;
        if (current.phase === "ended") return conclude(current, journal, data, false);
      }
    }
  }

  if (current.camp.stills.length > 0) {
    let total = 0;
    let washCount = 0;
    for (const still of current.camp.stills) {
      const liters = rollStillYield(() => rng.next(), still.wash, data);
      total += liters;
      if (still.wash) washCount += 1;
    }
    total = round2(total);
    current = { ...current, inventory: addItem(current.inventory, "water", total) };
    const where = washCount ? ` ${washCount} of them in the wash, where the ground gives more.` : "";
    current = pushLog(
      current,
      `The still${current.camp.stills.length === 1 ? "" : "s"} left ${total.toFixed(1)} L by morning.${where}`,
    );
  }

  if (current.camp.signalLit) {
    const cost = data.rescue.fuelPerDawn;
    if ((current.inventory.fuel ?? 0) >= cost) {
      current = {
        ...current,
        inventory: addItem(current.inventory, "fuel", -cost),
        rescue: { ...current.rescue, signalDays: current.rescue.signalDays + 1 },
      };
      current = pushLog(current, "The signal fire made it through the night. Smoke is a kind of hope with a fuel bill.");
    } else {
      current = {
        ...current,
        camp: { ...current.camp, signalLit: false },
      };
      current = pushLog(current, "The signal fire starved before dawn. The sky is ordinary again.");
    }
  }

  const effective = effectiveRescueDay(
    current.rescue.baseDay,
    current.rescue.signalDays,
    data.rescue,
  );
  if (current.day >= effective) {
    current = pushLog(current, "An engine, then a shadow that is not a bird. Someone was looking for this square.");
    return conclude(current, journal, data, true);
  }

  let storm = false;
  const stormDef = data.events.sandstorm;
  if (current.day >= stormDef.minDay && rng.next() < stormDef.chance) {
    storm = true;
    const learned = learnHazard(journal, {
      id: stormDef.id,
      name: stormDef.name,
      text: stormDef.journal,
      learnedOnRun: runNumber(journal),
    });
    journal = learned.journal;
    if (learned.learned) current = noteRunHazard(current, stormDef.id);
    if (current.camp.shelter) {
      current = {
        ...current,
        fatigue: clamp(current.fatigue + stormDef.shelterFatigue, 0, 100),
      };
      current = pushLog(current, stormDef.logShelter);
    } else {
      current = {
        ...current,
        hydration: clamp(current.hydration - stormDef.hydrationNoShelter, 0, 100),
        fatigue: clamp(current.fatigue + stormDef.fatigue, 0, 100),
      };
      current = hurt(current, stormDef.healthNoShelter, "injury");
      current = pushLog(current, stormDef.logOpen);
      if (current.phase === "ended") return conclude(current, journal, data, false);
    }
  }

  current = { ...current, sandstorm: storm };
  const budget = computeBudget(current, data);
  let hours = budget.hours;
  const notes = [...budget.notes];
  if (storm) {
    hours = Math.max(data.needs.actionBudget.minimum, hours - stormDef.laborPenalty);
    notes.push("A sandstorm is up. Part of the day is gone.");
  }
  current = { ...current, laborHours: hours, laborMax: hours, laborNotes: notes };
  const dawnLine = data.copy.dawnLines[(current.day - 1) % data.copy.dawnLines.length] ?? "";
  current = pushLog(current, `Day ${current.day}. ${dawnLine}`);
  const reason = notes.find((note) => note !== "You are intact. The day is full length.");
  current = pushLog(
    current,
    reason
      ? `Work today: ${hours} hours. ${reason}`
      : `Work today: ${hours} hours.`,
  );
  return { state: current, journal };
}
