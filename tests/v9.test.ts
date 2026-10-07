import { describe, expect, it } from "vitest";
import { gameData } from "../src/models/content.ts";
import type { HourContext, RunState } from "../src/models/types.ts";
import { applyCommand, listActions, previewLine } from "../src/logic/actions.ts";
import { resolveDawn } from "../src/logic/dawn.ts";
import { emptyJournal } from "../src/logic/journal.ts";
import { isDark } from "../src/logic/pace.ts";
import { makeRng, type Rng } from "../src/logic/rng.ts";
import { createRun } from "../src/logic/setup.ts";

const flat = (v: number): Rng => ({ next: () => v, getState: () => 1, setState() {} });
const INJURY = /\b(ankle|limp|wound|bite|sting|cut|calf)\b/i;
const SUN = /\b(sun|sunlit|glare|noon|shade)\b/i;

function fresh(patch: Partial<RunState> = {}): RunState {
  const s = createRun(gameData, emptyJournal(), makeRng(9), 9);
  return {
    ...s, conditions: [], sprainHours: 0, sandstorm: false, hydration: 95, hunger: 95, morale: 60, fatigue: 10,
    health: 100, bodyTempC: 37, hour: 4, day: 1, location: "rocky-ridge", inventory: { water: 6, torch: 3, knife: 1 },
    rescue: { baseDay: 25, signalDays: 0 }, ...patch,
  };
}
const texts = (s: RunState) => s.log.map((l: any) => (typeof l === "string" ? l : l.text));
const newLines = (before: RunState, after: RunState) => texts(after).slice(texts(before).length);

describe("travel lines only say what is true", () => {
  it("the bug: D01 04:00 return, no injury, says nothing about an ankle or the sun", () => {
    const s = fresh();
    const out = applyCommand(s, emptyJournal(), { type: "return" } as any, gameData, flat(0.99));
    const opener = newLines(s, out.state).find((l) => l.startsWith("You turn back"))!;
    expect(opener).toBeDefined();
    expect(opener).not.toMatch(INJURY);
    expect(opener).not.toMatch(SUN);
    expect(opener).toMatch(/dark|cold/);
  });

  it("every hour, uninjured: no injury words in leave/return lines; at night no sun words", () => {
    for (let hour = 0; hour < 24; hour += 1) {
      const back = fresh({ hour });
      const b = newLines(back, applyCommand(back, emptyJournal(), { type: "return" } as any, gameData, flat(0.99)).state);
      const leave = fresh({ hour, location: "camp" });
      const l = newLines(leave, applyCommand(leave, emptyJournal(), { type: "travel", zoneId: "dry-wash" } as any, gameData, flat(0.99)).state);
      const lines = [b.find((x) => x.startsWith("You turn back")), l.find((x) => x.startsWith("You leave camp"))];
      for (const line of lines) {
        expect(line, `${hour}`).toBeDefined();
        expect(line!, `${hour}: ${line}`).not.toMatch(INJURY);
        if (isDark(hour, gameData)) expect(line!, `${hour}: ${line}`).not.toMatch(SUN);
      }
      const arrive = b.find((x) => x.startsWith("The fuselage comes up"));
      if (arrive && isDark((hour + 5) % 24, gameData) && isDark(hour, gameData)) expect(arrive).not.toMatch(SUN);
    }
  });

  it("the ankle shows up only with a sprain; a wound only with that condition", () => {
    const sprained = fresh({ hour: 12, sprainHours: 5 });
    const a = newLines(sprained, applyCommand(sprained, emptyJournal(), { type: "return" } as any, gameData, flat(0.99)).state);
    expect(a.find((x) => x.startsWith("You turn back"))).toMatch(/ankle/);
    const cut = fresh({ hour: 12, conditions: [{ id: "laceration", hoursLeft: 10 }] as any });
    const c = newLines(cut, applyCommand(cut, emptyJournal(), { type: "return" } as any, gameData, flat(0.99)).state);
    const line = c.find((x) => x.startsWith("You turn back"))!;
    expect(line).toMatch(/laceration/);
    expect(line).not.toMatch(/ankle/);
  });

  it("static: night variants never mention the sun; base variants never mention injuries", () => {
    const t = gameData.copy.travel;
    for (const set of [t.leave, t.back, t.arrive]) {
      expect(set.night).not.toMatch(SUN);
      for (const v of [set.neutral, set.night, set.heat]) expect(v).not.toMatch(INJURY);
      expect(set.neutral).not.toMatch(SUN);
    }
    expect(gameData.needs.wait.logs.waitOpenNight).not.toMatch(SUN);
    for (const z of gameData.zones) if (z.arriveLogNight) expect(z.arriveLogNight).not.toMatch(/bright|glare|white/);
  });

  it("static audit: 'ankle' appears in data only where a sprain is actually being described", () => {
    const hits: string[] = [];
    const seen = new Set<unknown>();
    const walk = (v: unknown, path: string) => {
      if (typeof v === "string") { if (/\bankle\b/i.test(v)) hits.push(path); return; }
      if (!v || typeof v !== "object" || seen.has(v)) return;
      seen.add(v);
      const entries = v instanceof Map ? [...v.entries()] : Object.entries(v);
      for (const [k, x] of entries) walk(x, `${path}.${String(k)}`);
    };
    walk(gameData, "data");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((h) => /start|travel\.injury\.ankle$/.test(h)), hits.join(", ")).toBe(true);
  });

  it("dawn lines do not claim you woke up or are at camp when you were walking", () => {
    for (let day = 1; day <= 6; day += 1) {
      const out = resolveDawn(fresh({ day, hour: 6 }), emptyJournal(), gameData, flat(0.99), { activity: "travel", atCamp: false });
      const line = texts(out.state).find((x) => x.startsWith(`Day ${day}.`))!;
      expect(line).not.toMatch(/\b(wake|camp|metal)\b/i);
    }
    const home = resolveDawn(fresh({ day: 4, hour: 6, location: "camp" }), emptyJournal(), gameData, flat(0.99), { activity: "sleep", atCamp: true });
    expect(texts(home.state).some((x) => x.startsWith("Day 4. You wake"))).toBe(true);
  });

  it("rest and wait at night do not talk about sun or shade", () => {
    for (const location of ["camp", "dry-wash"]) {
      const s = fresh({ hour: 23, location });
      const rest = listActions(s, emptyJournal(), gameData).find((a) => a.id === "rest")!;
      expect(rest.label).not.toMatch(SUN);
      expect(newLines(s, applyCommand(s, emptyJournal(), { type: "rest" } as any, gameData, flat(0.99)).state).join(" ")).not.toMatch(SUN);
      expect(newLines(s, applyCommand(s, emptyJournal(), { type: "wait", hours: 1 } as any, gameData, flat(0.99)).state).join(" ")).not.toMatch(SUN);
    }
  });
});

describe("previews are consistent", () => {
  const camp = (activity: string): HourContext => ({ activity, atCamp: true, exposure: 1 }) as any;

  it("the screenshot: D02 06:00 at camp, still chilled from the night walk", () => {
    const s = fresh({ hour: 6, day: 2, location: "camp", bodyTempC: 35.2, health: 70, hydration: 60 });
    const w1 = previewLine(s, 1, camp("wait"), gameData);
    const w2 = previewLine(s, 2, camp("wait"), gameData);
    const r2 = previewLine(s, 2, camp("rest"), gameData);
    // One hour still below the cold line (−4), then the body is past it: 2h costs the same.
    expect(w1.detail).toContain("−4 health");
    expect(w2.detail).toContain("−4 health");
    expect(r2.detail).toContain("−4 health");
    // He is warming, not getting colder.
    expect(w1.warning).toBe("Still chilled, warming slowly");
    for (const p of [w1, w2, r2]) expect(p.detail).not.toContain("0.0 L");
  });

  it("at normal body temperature 06:00 at camp carries no cold warning", () => {
    const s = fresh({ hour: 6, day: 2, location: "camp" });
    for (const h of [1, 2, 3]) expect(previewLine(s, h, camp("wait"), gameData).warning).toBe("");
  });

  it("the health in a wait preview is what the wait actually costs, and it never shows 0.0 L", () => {
    for (let hour = 0; hour < 24; hour += 1) {
      for (const bodyTempC of [34, 35.2, 37, 39.5]) {
        for (const h of [1, 2, 3, 4]) {
          const s = fresh({ hour, location: "camp", bodyTempC, health: 80 });
          const p = previewLine(s, h, camp("wait"), gameData);
          expect(p.detail).not.toContain("0.0 L");
          const out = applyCommand(s, emptyJournal(), { type: "wait", hours: h } as any, gameData, flat(0.99));
          const delta = out.state.health - s.health;
          const shown = p.detail.match(/([−+])(\d+(?:\.\d)?) health/);
          const value = shown ? (shown[1] === "−" ? -1 : 1) * Number(shown[2]) : 0;
          if (delta < -1) expect(value, `${hour} ${bodyTempC} ${h}h`).toBe(-Math.round(-delta));
          else if (delta >= 0.5) expect(value).toBeCloseTo(delta, 1);
          else expect(value).toBe(0);
        }
      }
    }
  });
});
