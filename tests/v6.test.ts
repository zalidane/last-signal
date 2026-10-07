import { describe, expect, it } from "vitest";
import { gameData } from "../src/models/content.ts";
import type { Command, RunState } from "../src/models/types.ts";
import { applyCommand, collapse, hasValidAction, listActions } from "../src/logic/actions.ts";
import { emptyJournal } from "../src/logic/journal.ts";
import { makeRng, type Rng } from "../src/logic/rng.ts";
import { createRun } from "../src/logic/setup.ts";
import { hoursUntilDawn } from "../src/logic/time.ts";

function flatRng(value: number): Rng {
  return { next: () => value, getState: () => 1, setState() {} };
}

function fresh(patch: Partial<RunState> = {}): RunState {
  const state = createRun(gameData, emptyJournal(), makeRng(31), 31);
  return {
    ...state,
    conditions: [],
    sprainHours: 0,
    sandstorm: false,
    hydration: 85,
    hunger: 85,
    morale: 60,
    fatigue: 30,
    health: 100,
    bodyTempC: 37,
    inventory: { water: 2 },
    rescue: { baseDay: 25, signalDays: 0 },
    ...patch,
  };
}

const step = (state: RunState, command: Command, rng: Rng = flatRng(0.99)) =>
  applyCommand(state, emptyJournal(), command, gameData, rng);
const sleeps = (state: RunState) => listActions(state, emptyJournal(), gameData).filter((a) => a.group === "Sleep");
/** Hours since the dawn that started the current day. */
const clock = (s: { day: number; hour: number }) => s.day * 24 + ((s.hour - 6 + 24) % 24);

describe("sleep durations", () => {
  it("offers 2/4/6/8h by day and adds 'until dawn' only when dawn is 10h or less away", () => {
    for (const location of ["camp", "dry-wash"]) {
      for (let hour = 0; hour < 24; hour += 1) {
        const state = fresh({ location, hour });
        const ids = sleeps(state).map((a) => a.id);
        const dawn = hoursUntilDawn(hour);
        expect(ids.includes("sleep-dawn"), `${location} ${hour}`).toBe(dawn <= 10);
        for (const h of [2, 4, 6, 8]) expect(ids.includes(`sleep-${h}`), `${location} ${hour} ${h}h`).toBe(dawn > 10 || h < dawn);
        for (const a of sleeps(state)) expect(a.disabled).toBe(false);
        expect(sleeps(state).every((a) => /^\d+h/.test(a.detail) && !a.detail.includes("0.0 L"))).toBe(true);
      }
    }
    const morning = sleeps(fresh({ hour: 7 })).map((a) => a.label);
    expect(morning).toEqual(["Sleep 2h", "Sleep 4h", "Sleep 6h", "Sleep 8h"]);
    const night = sleeps(fresh({ hour: 22 })).map((a) => a.label);
    expect(night).toEqual(["Sleep 2h", "Sleep 4h", "Sleep 6h", "Sleep until dawn"]);
  });

  it("never sleeps 23 hours by day: 'until dawn' is refused when dawn is far, and a chosen length runs exactly", () => {
    const morning = fresh({ hour: 7 });
    const refused = step(morning, { type: "sleep" }).state;
    expect(refused.hour).toBe(7);
    const four = step(morning, { type: "sleep", hours: 4 }).state;
    expect(four.hour).toBe(11);
    expect(four.day).toBe(morning.day);
    const night = step(fresh({ hour: 22 }), { type: "sleep" }).state;
    expect(night.hour).toBe(6);
    expect(night.day).toBe(2);
  });

  it("keeps camp vs open differences for the same sleep", () => {
    const dusk = fresh({ hour: 22, fatigue: 50, health: 90 });
    const camp = step({ ...dusk, camp: { ...dusk.camp, shelter: true, firePit: true } }, { type: "sleep", hours: 6 }).state;
    const open = step({ ...dusk, location: "dry-wash" }, { type: "sleep", hours: 6 }).state;
    expect(open.fatigue).toBeGreaterThan(camp.fatigue);
    expect(open.health).toBeLessThan(camp.health);
    const stung = step({ ...dusk, location: "dry-wash" }, { type: "sleep", hours: 8 }, flatRng(0)).state;
    expect(stung.conditions.some((c) => c.id === "scorpion")).toBe(true);
    const safeCamp = step({ ...dusk, camp: { ...dusk.camp, firePit: true } }, { type: "sleep", hours: 8 }, flatRng(0)).state;
    expect(safeCamp.conditions.some((c) => c.id === "scorpion")).toBe(false);
  });
});

describe("collapse lasts a fixed 10 hours", () => {
  it("is exactly 10h at any hour, crossing dawn when it has to, and dawn still resolves", () => {
    expect(gameData.needs.collapse.hours).toBe(10);
    for (const hour of [0, 3, 8, 12, 17, 21, 23]) {
      const state = fresh({ hour, fatigue: 100, location: "camp" });
      const after = collapse(state, emptyJournal(), gameData, flatRng(0.99)).state;
      expect(after.phase, `camp ${hour}`).toBe("playing");
      expect(clock(after) - clock(state), `camp ${hour}`).toBe(10);
      expect(after.hour).toBe((hour + 10) % 24);
      const crosses = hoursUntilDawn(hour) <= 10;
      expect(after.log.some((l) => l.text.startsWith(`Day ${state.day + 1}.`)), `dawn ${hour}`).toBe(crosses);
      expect(hasValidAction(after, emptyJournal(), gameData)).toBe(true);
    }
  });

  it("can kill at midday in the open (full sun), with the collapse lesson; the same hours at camp survive", () => {
    const state = fresh({ hour: 10, location: "dry-wash", fatigue: 100, health: 35, hydration: 40 });
    const out = collapse(state, emptyJournal(), gameData, flatRng(0.99));
    expect(out.state.phase).toBe("ended");
    expect(out.state.ending?.cause).toBe("exhaustion");
    expect(out.journal.lessons.at(-1)?.text).toBe(gameData.lessons.exhaustion.lesson);
    const camp = collapse({ ...state, location: "camp" }, emptyJournal(), gameData, flatRng(0.99)).state;
    expect(camp.phase).toBe("playing");
    expect(camp.health).toBeGreaterThan(out.state.health);
    // Even from full health, ten midday hours in the open cost a lot more than at camp.
    const full = collapse({ ...state, health: 100, hydration: 85 }, emptyJournal(), gameData, flatRng(0.99)).state;
    const fullCamp = collapse({ ...state, health: 100, hydration: 85, location: "camp" }, emptyJournal(), gameData, flatRng(0.99)).state;
    expect(full.health).toBeLessThan(fullCamp.health - 25);
  });

  it("lets nothing else happen while out, warns ahead, and rolls bites in the open", () => {
    const tired = fresh({ hour: 9, location: "dry-wash", fatigue: 97 });
    const search = listActions(tired, emptyJournal(), gameData).find((a) => a.id === "search-zone");
    expect(search?.warning).toBe("Collapse: you'll be out for 10 hours");
    const bitten = collapse(fresh({ hour: 20, location: "dry-wash", fatigue: 100 }), emptyJournal(), gameData, flatRng(0)).state;
    expect(bitten.conditions.some((c) => c.id === "scorpion" || c.id === "snakebite")).toBe(true);
    const texts = bitten.log.map((l) => l.text);
    const fell = texts.indexOf(gameData.needs.collapse.logOpen);
    const woke = texts.indexOf(gameData.needs.collapse.logWake);
    expect(woke).toBeGreaterThan(fell);
  });
});
