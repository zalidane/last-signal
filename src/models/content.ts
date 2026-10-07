import type { GameData, Threat } from "./types.ts";
import needs from "../../data/needs.json";
import biome from "../../data/biome.json";
import rescue from "../../data/rescue.json";
import score from "../../data/score.json";
import starting from "../../data/starting.json";
import conditions from "../../data/conditions.json";
import items from "../../data/items.json";
import discoveries from "../../data/discoveries.json";
import recipes from "../../data/recipes.json";
import zones from "../../data/zones.json";
import camp from "../../data/camp.json";
import hazards from "../../data/hazards.json";
import events from "../../data/events.json";
import lessons from "../../data/lessons.json";
import copy from "../../data/copy.json";
import schematics from "../../data/schematics.json";
import wildlife from "../../data/wildlife.json";
import crafting from "../../data/crafting.json";
import woundcare from "../../data/woundcare.json";

function indexBy<T extends { id: string }>(rows: T[]): Map<string, T> {
  return new Map(rows.map((row) => [row.id, row]));
}

export function createGameData(): GameData {
  const itemRows = items as unknown as GameData["items"];
  const discoveryRows = discoveries as unknown as GameData["discoveries"];
  const zoneRows = zones as unknown as GameData["zones"];
  const recipeRows = recipes as unknown as GameData["recipes"];
  const hazardRows = hazards as unknown as GameData["hazards"];
  const schematicRows = schematics as unknown as GameData["schematics"];
  const data: GameData = {
    needs: needs as unknown as GameData["needs"],
    biome: biome as unknown as GameData["biome"],
    rescue: rescue as unknown as GameData["rescue"],
    score: score as unknown as GameData["score"],
    starting: starting as unknown as GameData["starting"],
    conditions: conditions as unknown as GameData["conditions"],
    items: itemRows,
    itemById: indexBy(itemRows),
    discoveries: discoveryRows,
    discoveryById: indexBy(discoveryRows),
    discoveryByItemId: new Map(discoveryRows.map((d) => [d.itemId, d])),
    recipes: recipeRows,
    recipeById: indexBy(recipeRows),
    zones: zoneRows,
    zoneById: indexBy(zoneRows),
    camp: camp as unknown as GameData["camp"],
    hazards: hazardRows,
    hazardById: indexBy(hazardRows),
    events: events as unknown as GameData["events"],
    lessons: lessons as unknown as GameData["lessons"],
    copy: copy as unknown as GameData["copy"],
    schematics: schematicRows,
    schematicById: indexBy(schematicRows),
    wildlife: wildlife as unknown as GameData["wildlife"],
    animalById: new Map(),
    crafting: crafting as unknown as GameData["crafting"],
    woundcare: woundcare as unknown as GameData["woundcare"],
    materialById: new Map(),
    toolById: new Map(),
  };
  data.animalById = indexBy(data.wildlife.animals);
  data.materialById = indexBy(data.crafting.materials);
  data.toolById = indexBy(data.crafting.tools);
  assertContent(data);
  return data;
}

export function assertContent(data: GameData): void {
  const need = (ok: boolean, message: string) => {
    if (!ok) throw new Error(`content: ${message}`);
  };
  for (const discovery of data.discoveries) {
    need(data.itemById.has(discovery.itemId), `${discovery.id} missing item`);
    for (const effect of [discovery.eat, discovery.experiment, discovery.overeat]) {
      for (const cond of effect?.addConditions ?? []) {
        need(Boolean(data.conditions[cond.id]), `${discovery.id} missing condition ${cond.id}`);
      }
    }
  }
  for (const hazard of data.hazards) {
    if (hazard.condition) {
      need(Boolean(data.conditions[hazard.condition.id]), `${hazard.id} missing condition`);
    }
  }
  for (const zone of data.zones) {
    for (const loot of zone.loot) {
      if (loot.id !== "nothing") need(data.itemById.has(loot.id), `${zone.id} loot ${loot.id}`);
    }
  }
  const lessonKeys: Threat[] = [
    "heat",
    "cold",
    "dehydration",
    "starvation",
    "injury",
    "sickness",
    "exhaustion",
    "infection",
    "rescued",
  ];
  for (const key of lessonKeys) need(Boolean(data.lessons[key]), `missing lesson ${key}`);
  need(Boolean(data.schematicById.get("solar-still")), "solar still schematic");
  for (const animal of data.wildlife.animals) {
    need(data.hazardById.has(animal.strikeHazard), `${animal.id} strike hazard`);
    need(data.itemById.has(animal.meat.item), `${animal.id} meat item`);
    need(Boolean(data.wildlife.meat[animal.meat.item]), `${animal.id} meat def`);
  }
  for (const weapon of data.wildlife.weapons) {
    need(weapon.id === "none" || data.itemById.has(weapon.id), `weapon ${weapon.id}`);
  }
  for (const recipe of data.recipes) {
    for (const id of Object.keys(recipe.yields ?? {})) need(data.itemById.has(id), `${recipe.id} yields ${id}`);
  }
  for (const animal of data.wildlife.animals) {
    for (const drop of animal.drops ?? []) need(data.itemById.has(drop.item), `${animal.id} drop ${drop.item}`);
  }
  for (const material of data.crafting.materials) {
    for (const id of Object.keys(material.consumes)) need(data.itemById.has(id), `material ${material.id} uses ${id}`);
    need(material.slot !== "handle" || Boolean(material.length), `handle ${material.id} needs a length`);
  }
  for (const tool of data.crafting.tools) {
    need(data.itemById.has(tool.item), `tool ${tool.id} item`);
    need(!tool.weapon || data.wildlife.weapons.some((w) => w.id === tool.weapon), `tool ${tool.id} weapon`);
    for (const slot of ["handle", "end", "binding"] as const) {
      const ok = data.crafting.materials.some((m) =>
        m.slot === slot &&
        (slot !== "handle" || (m.length !== undefined && tool.handle.lengths.includes(m.length))) &&
        (slot !== "end" || m.kind === tool.end),
      );
      need(ok, `tool ${tool.id} has no ${slot} material`);
    }
  }
}

export const gameData = createGameData();
