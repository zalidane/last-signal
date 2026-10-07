export type Activity = "sleep" | "rest" | "wait" | "camp" | "build" | "search" | "travel";

export type BandId = "cold" | "mild" | "warm" | "hot" | "extreme";

export type Threat =
  | "heat"
  | "cold"
  | "dehydration"
  | "starvation"
  | "injury"
  | "sickness"
  | "exhaustion"
  | "infection"
  | "rescued";

export type BudgetFlag = "injured" | "sunburn" | "gut";

export type Tone = "ok" | "warn" | "danger" | "cold";

export interface BandDef {
  from: number;
  to: number;
  id: BandId;
  name: string;
  airTempC: number;
}

export interface ActivityRates {
  hunger: number;
  hydration: number;
  fatigue: number;
  morale: number;
  exertionC: number;
}

/** A low meter or a wound no longer shortens a work day: it slows actions and raises hazard odds. */
export interface StrainRule {
  meter?: "hydration" | "hunger" | "morale";
  below?: number;
  above?: number;
  flag?: BudgetFlag;
  slow: number;
  risk: number;
  note: string;
}

export interface FatigueTier {
  above: number;
  mult: number;
  risk: number;
  label: string;
  note: string;
}

export interface NeedsConfig {
  pointsPerLiter: number;
  drinkLiters: number;
  meters: Record<
    string,
    { warn: number; danger: number; highIsBad?: boolean }
  >;
  bodyTemp: {
    startC: number;
    minC: number;
    maxC: number;
    approach: number;
    comfortMinC: number;
    comfortMaxC: number;
    heatMildC: number;
    heatSevereC: number;
    heatCriticalC: number;
    coldMildC: number;
    coldSevereC: number;
    coldBaseC: number;
    coldAnchorC: number;
    coldSlope: number;
    coldCapC: number;
    heatBaseC: number;
    heatAnchorC: number;
    heatSlope: number;
    heatFloorC: number;
    dehydratedHeatBonusC: number;
    dehydratedHeatBelow: number;
  };
  heatHealthPerHour: { mild: number; severe: number; critical: number };
  coldHealthPerHour: { mild: number; severe: number };
  emptyHydrationHealthPerHour: number;
  emptyHungerHealthPerHour: number;
  activities: Record<Activity, ActivityRates>;
  bandHydrationMultiplier: Record<BandId, number>;
  contextHydrationMultiplier: Record<string, number>;
  felt: {
    shadeDeltaC: number;
    shelterDayDeltaC: number;
    shelterNightDeltaC: number;
    fireNightDeltaC: number;
    wreckNightDeltaC: number;
    wreckShadeDeltaC: number;
    zoneSearchShadeC: number;
    /** Waiting in the open away from camp, daytime: sparse brush, almost no shade. */
    openDayDeltaC: number;
    /** Waiting in the open away from camp, at night: nothing between you and the sky. */
    openNightDeltaC: number;
  };
  strain: { maxSlow: number; rules: StrainRule[] };
  fatigue: {
    collapseAt: number;
    tiers: FatigueTier[];
    heatPerHour: Record<BandId, number>;
  };
  pace: { maxMult: number };
  darkness: {
    fromHour: number;
    toHour: number;
    timeMult: number;
    torchTimeMult: number;
    fireTimeMult: number;
    hazardMult: Record<string, number>;
    lightHazardScale: number;
    blockedText: string;
    lightHint: string;
  };
  regen: {
    minHydration: number;
    minHunger: number;
    minBodyC: number;
    maxBodyC: number;
    rates: Record<string, number>;
  };
  collapse: {
    fatigueMultiplier: number;
    moralePerHour: number;
    hazards: { id: string; chance: number }[];
    logOpen: string;
    logCamp: string;
    logWake: string;
    warning: string;
  };
  ration: {
    hunger: number;
    morale: number;
    warmedHunger: number;
    warmedMorale: number;
    warmedHealth: number;
  };
  restHours: number;
  sandstormHydrationBonus: number;
  wait: WaitConfig;
}

export interface WaitConfig {
  /** Fixed wait lengths offered as buttons. "Until dawn" is offered on top. */
  hourOptions: number[];
  openSleep: {
    fatigueMultiplier: number;
    moralePerHour: number;
    hazardChance: number;
    hazardId: string;
    hazardLog: string;
  };
  logs: {
    waitOpen: string;
    waitCamp: string;
    waitShelter: string;
    waitDone: string;
    sleepOpen: string;
    sleepOpenDone: string;
  };
}

export interface BiomeConfig {
  id: string;
  name: string;
  hours: BandDef[];
}

export interface RescueConfig {
  rollMin: number;
  rollMax: number;
  minDay: number;
  fuelPerDawn: number;
}

export interface ScoreConfig {
  perDay: number;
  perDiscovery: number;
  perSchematic: number;
  rescueBonus: number;
  journalScale: number;
}

export interface StartingInjury {
  id: string;
  weight: number;
  sprainHours?: number;
  condition?: { id: string; hours: number };
  fatigue?: number;
  morale?: number;
  health?: number;
  log: string;
}

export interface StartingStack {
  id: string;
  min?: number;
  max?: number;
  chance?: number;
  qty?: number;
}

export interface StartingConfig {
  injuryChance: number;
  injuries: StartingInjury[];
  hydration: [number, number];
  hunger: [number, number];
  morale: [number, number];
  fatigue: [number, number];
  waterLiters: [number, number];
  stacks: StartingStack[];
}

export interface ConditionDef {
  name: string;
  hydrationPerHour: number;
  healthPerHour: number;
  budgetFlag?: BudgetFlag;
  threat: "injury" | "sickness" | "infection";
  /** Counts as treated: does not block health regen. */
  treated?: boolean;
  /** When this condition runs out, this one starts (a dirty bandage turns into infection). */
  becomes?: string;
  /** Raises the body's target temperature while active. */
  feverC?: number;
}

export interface WoundCareConfig {
  treats: string;
  hours: number;
  cloth: string;
  drainCut: number;
  hoursFactor: number;
  minHours: number;
  infectionChance: number;
  rinse: { liters: number; infectionChance: number };
  clean: string;
  dirty: string;
  infection: { id: string; hours: number };
  logs: { bandage: string; rinse: string; noCloth: string; onset: string };
  journal: { id: string; name: string; text: string };
  infectionJournal: { id: string; name: string; text: string };
}

export interface ItemDef {
  id: string;
  name: string;
  category: "water" | "food" | "material" | "discovery" | "medical" | "tool";
  unit?: string;
  blurb: string;
  foundLog?: string;
  teachesSchematic?: string;
}

export interface EffectDef {
  hours?: number;
  hunger?: number;
  hydration?: number;
  health?: number;
  morale?: number;
  fatigue?: number;
  addConditions?: { id: string; hours: number }[];
  learn?: boolean;
  log?: string;
  journal?: string;
}

export interface PrepareDef extends EffectDef {
  fireBonus?: {
    health?: number;
    hunger?: number;
    hydration?: number;
    morale?: number;
    log?: string;
  };
}

export interface BoilDef {
  hours: number;
  requiresFire: boolean;
  yieldsWater: number;
  log: string;
}

export interface PoulticeDef {
  clears: string;
  morale?: number;
  log: string;
}

export interface DiscoveryDef {
  id: string;
  itemId: string;
  name: string;
  unknownName: string;
  unknownBlurb: string;
  summary: string;
  safe: boolean;
  countsAs?: "pear";
  overeatAt?: number;
  unknownActions: string[];
  knownActions: string[];
  eat: EffectDef;
  experiment: EffectDef;
  prepare?: PrepareDef;
  overeat?: EffectDef;
  boil?: BoilDef;
  poultice?: PoulticeDef;
}

export interface RecipeDef {
  id: string;
  name: string;
  tier: number;
  tierName: string;
  hours: number;
  where: string[];
  requires: Record<string, number>;
  grants: "shelter" | "firePit" | "solarStill" | "signalFire" | "item";
  /** For grants "item": what lands in the pack. */
  yields?: Record<string, number>;
  /** For grants "item": hide the recipe once you carry this many. */
  maxCarry?: number;
  /** Fine work: impossible in the dark without a lit camp fire or a torch. */
  needsLight?: boolean;
  schematic?: string;
  max?: number;
  requiresFlag?: "firePit";
  log: string;
  washLog?: string;
  already?: string;
  unknownLabel?: string;
  unknownDetail?: string;
  knownLabel?: string;
  relight?: { hours: number; requires: Record<string, number>; log: string };
}

export interface LootEntry {
  id: string;
  weight: number;
  qty: number;
}

export interface ZoneDef {
  id: string;
  name: string;
  travelHours: number;
  searchHours: number;
  exposure: number;
  /** Searching here in the dark needs light. */
  searchNeedsLight?: boolean;
  blurb: string;
  arriveLog: string;
  loot: LootEntry[];
}

export interface CampConfig {
  id: string;
  name: string;
  searchHours: number;
  wreckSearches: number;
  tierName: string;
  blurb: string;
  loot: LootEntry[];
}

export interface HazardDef {
  id: string;
  name: string;
  on: string[];
  chance: Record<string, number>;
  bandChance?: Partial<Record<BandId, number>>;
  bands?: BandId[];
  effect?: { health?: number; fatigue?: number; morale?: number };
  condition?: { id: string; hours: number };
  sprainHours?: number;
  log: string;
  journal: string;
}

export interface EventsConfig {
  sandstorm: {
    id: string;
    name: string;
    chance: number;
    minDay: number;
    healthNoShelter: number;
    hydrationNoShelter: number;
    fatigue: number;
    shelterFatigue: number;
    logOpen: string;
    logShelter: string;
    journal: string;
  };
  nightVisitor: {
    chance: number;
    shelterChance: number;
    requiresNoFire: boolean;
    hazardId: string;
    log: string;
    shelterLog: string;
  };
  stillLitersMin: number;
  stillLitersMax: number;
  washStillBonus: number;
  washStillCap: number;
}

export interface LessonDef {
  label: string;
  card: string;
  lesson: string;
}

export interface CopyConfig {
  title: string;
  tagline: string;
  standingOrders: string[];
  opening: string[];
  dawnLines: string[];
  schematic: { id: string; name: string; text: string };
  nothingLog: string;
  knownFindLog: string;
  journalPreface: string;
  classified: string;
}

export interface AnimalDef {
  id: string;
  name: string;
  zoneWeight: Record<string, number>;
  strikeHazard: string;
  backAwayStrike: number;
  meat: { item: string; qty: number };
  killFatigue: number;
  sightLog: string;
  backAwayLog: string;
  backAwayStrikeLog: string;
  killLog: string;
  failLog: string;
  escapeLog: string;
  journal: { id: string; name: string; text: string };
  /** Extra things a kill leaves you, e.g. snake sinew for bindings. */
  drops?: { item: string; qty: number; log: string }[];
}

export interface WeaponDef {
  id: string;
  name: string;
  tier: number;
  kill: Record<string, number>;
  failStrike: number;
  /** Built from components: material modifiers apply and it can break on a failed kill. */
  crafted?: boolean;
  /** Effective weapons only: chance it comes apart when a kill fails. */
  breakChance?: number;
  /** Effective weapons only: the build that made it. */
  build?: GearBuild;
}

export type SlotId = "handle" | "end" | "binding";
export type EndKind = "sharp" | "blunt" | "flammable";

export interface MaterialMods {
  /** Added to kill odds for weapons. */
  kill: number;
  /** Added to the chance a crafted weapon breaks on a failed kill. */
  breakOnFail: number;
  /** Flammable ends: base burns for a torch. */
  burns?: number;
  /** Added to a torch's burns. */
  torchBurns?: number;
}

export interface MaterialDef {
  id: string;
  slot: SlotId;
  /** Handles: wood | metal | plastic. Ends: sharp | blunt | flammable. Bindings: their own kind. */
  kind: string;
  length?: "short" | "long";
  name: string;
  short: string;
  consumes: Record<string, number>;
  extraHours?: number;
  mods: MaterialMods;
  breakLog?: string;
  note: { name: string; text: string };
}

export interface ToolDef {
  id: string;
  name: string;
  item: string;
  weapon?: string;
  hours: number;
  where: string[];
  maxCarry: number;
  handle: {
    lengths: ("short" | "long")[];
    label: string;
    kindPenalty?: Record<string, number>;
    kindNote?: Record<string, string>;
  };
  end: EndKind;
  lengthNote?: string;
  log: string;
  pattern: { name: string; text: string };
}

export interface CraftingConfig {
  slots: { id: SlotId; label: string }[];
  maxBreak: number;
  autoPick: { breakWeight: number; hourWeight: number };
  materials: MaterialDef[];
  tools: ToolDef[];
  slotWords: Record<EndKind, string>;
}

/** What a crafted tool in the pack is made of. */
export interface GearBuild {
  handle: string;
  end: string;
  binding: string;
}

export interface MeatDef {
  spoilHours: number;
  raw: {
    hunger: number;
    morale: number;
    sickChance: number;
    sick: { id: string; hours: number }[];
    log: string;
    sickLog: string;
    journal?: { id: string; name: string; text: string };
  };
  cook: { hours: number; hunger: number; health: number; morale: number; log: string };
}

export interface WildlifeConfig {
  sighting: {
    zoneChance: Record<string, number>;
    triggerMult: Record<string, number>;
    bandMult: Record<BandId, number>;
    darkMult: number;
  };
  animals: AnimalDef[];
  weapons: WeaponDef[];
  killMods: { darkNoLight: number; exhausted: number; min: number; max: number };
  meat: Record<string, MeatDef>;
  spoilLog: string;
}

export interface SchematicDef {
  id: string;
  name: string;
  requires: Record<string, number>;
  text: string;
}

export interface GameData {
  needs: NeedsConfig;
  biome: BiomeConfig;
  rescue: RescueConfig;
  score: ScoreConfig;
  starting: StartingConfig;
  conditions: Record<string, ConditionDef>;
  items: ItemDef[];
  itemById: Map<string, ItemDef>;
  discoveries: DiscoveryDef[];
  discoveryById: Map<string, DiscoveryDef>;
  discoveryByItemId: Map<string, DiscoveryDef>;
  recipes: RecipeDef[];
  recipeById: Map<string, RecipeDef>;
  zones: ZoneDef[];
  zoneById: Map<string, ZoneDef>;
  camp: CampConfig;
  hazards: HazardDef[];
  hazardById: Map<string, HazardDef>;
  events: EventsConfig;
  lessons: Record<Threat, LessonDef>;
  copy: CopyConfig;
  schematics: SchematicDef[];
  schematicById: Map<string, SchematicDef>;
  wildlife: WildlifeConfig;
  animalById: Map<string, AnimalDef>;
  crafting: CraftingConfig;
  woundcare: WoundCareConfig;
  materialById: Map<string, MaterialDef>;
  toolById: Map<string, ToolDef>;
}

export interface ConditionInstance {
  id: string;
  hoursLeft: number;
}

export interface Still {
  id: number;
  wash: boolean;
}

export interface LogLine {
  id: number;
  day: number;
  hour: number;
  text: string;
}

export interface CampState {
  shelter: boolean;
  firePit: boolean;
  stills: Still[];
  signalBuilt: boolean;
  signalLit: boolean;
  wreckSearchesLeft: number;
}

export interface RescueState {
  baseDay: number;
  signalDays: number;
}

export interface ScoreBreakdown {
  survival: number;
  discoveries: number;
  schematics: number;
  rescue: number;
  journal: number;
  total: number;
  completion: number;
}

export interface Ending {
  rescued: boolean;
  day: number;
  hour: number;
  cause: Threat;
  causeLabel: string;
  card: string;
  lesson: string;
  baseRescueDay: number;
  effectiveRescueDay: number;
  signalDays: number;
  discoveries: string[];
  schematics: string[];
  hazards: string[];
  score: ScoreBreakdown;
  seed: number;
  biomeId: string;
  biomeName: string;
}

export interface Sighting {
  type: "sighting";
  animalId: string;
}

export interface RunState {
  seed: number;
  day: number;
  hour: number;
  health: number;
  hunger: number;
  hydration: number;
  bodyTempC: number;
  fatigue: number;
  morale: number;
  conditions: ConditionInstance[];
  sprainHours: number;
  pearsToday: number;
  inventory: Record<string, number>;
  location: string;
  camp: CampState;
  rescue: RescueState;
  visited: string[];
  runDiscoveries: string[];
  runSchematics: string[];
  runHazards: string[];
  log: LogLine[];
  nextLogId: number;
  phase: "playing" | "ended";
  lastThreat: Threat | null;
  pendingCause: Threat | null;
  sandstorm: boolean;
  nextStillId: number;
  ending: Ending | null;
  /** A choice the game is waiting on. While set, only its answers are legal. */
  pending: Sighting | null;
  /** Hours until uncooked meat in the pack turns. Keyed by item id. */
  spoil: Record<string, number>;
  /** Crafted weapons in the pack and what they are made of. Keyed by item id. */
  gear: Record<string, GearBuild>;
}

export interface JournalEntry {
  id: string;
  name: string;
  text: string;
  learnedOnRun: number;
}

export interface LessonEntry {
  id: string;
  cause: string;
  day: number;
  text: string;
  run: number;
  seed: number;
}

export interface Journal {
  version: 1;
  discoveries: Record<string, JournalEntry>;
  hazards: Record<string, JournalEntry>;
  schematics: Record<string, JournalEntry>;
  lessons: LessonEntry[];
  stats: {
    runs: number;
    deaths: number;
    rescues: number;
    bestDays: number;
    bestScore: number;
  };
}

export interface HourContext {
  activity: Activity;
  atCamp: boolean;
  exposure: number;
  /** Forced sleep after fatigue hit 100: poor recovery. */
  collapsed?: boolean;
}

export interface HealthParts {
  heat: number;
  cold: number;
  dehydration: number;
  starvation: number;
  injury: number;
  sickness: number;
  infection: number;
}

export type Command =
  | { type: "new-run"; seed?: number }
  | { type: "abandon" }
  | { type: "rest" }
  | { type: "sleep" }
  /** Always legal. hours omitted means "until dawn". */
  | { type: "wait"; hours?: number }
  | { type: "travel"; zoneId: string }
  | { type: "return" }
  | { type: "search" }
  | { type: "build"; recipeId: string }
  /** Component crafting. Missing picks are filled with the best material in the pack. */
  | { type: "craft"; toolId: string; picks?: Partial<Record<SlotId, string>> }
  | { type: "open-craft"; toolId: string }
  | { type: "craft-pick"; slot: SlotId; materialId: string }
  | { type: "close-craft" }
  | { type: "douse-signal" }
  | { type: "sighting"; choice: "back-away" | "kill" }
  | { type: "open-journal" }
  | { type: "close-journal" }
  | { type: "open-item"; itemId: string }
  | { type: "close-item" }
  | { type: "item"; itemId: string; action: string };

export interface ActionButton {
  id: string;
  group: string;
  label: string;
  detail: string;
  warning: string;
  disabled: boolean;
  command: Command | null;
}

export interface ItemActionView {
  id: string;
  label: string;
  detail: string;
  disabled: boolean;
  reason: string;
}

export interface ItemModal {
  itemId: string;
  title: string;
  blurb: string;
  known: boolean;
  qtyLabel: string;
  actions: ItemActionView[];
}

export interface MeterView {
  id: string;
  label: string;
  valueLabel: string;
  fill: number;
  tone: Tone;
}

export interface InvItemView {
  id: string;
  name: string;
  qtyLabel: string;
  category: string;
  known: boolean;
  warning: boolean;
}

export interface ZonePin {
  id: string;
  name: string;
  hours: number;
  blurb: string;
  here: boolean;
  x: number;
  y: number;
}

export interface PlayView {
  day: number;
  hourLabel: string;
  bandId: BandId;
  bandName: string;
  airTempC: number;
  locationId: string;
  locationName: string;
  locationBlurb: string;
  /** Current action-time multiplier and why. Replaces the old work-hour budget. */
  pace: { mult: number; label: string; notes: string[] };
  dark: boolean;
  lightLabel: string;
  sighting: SightingView | null;
  meters: MeterView[];
  conditions: string[];
  tierLevel: number;
  tierName: string;
  shelter: boolean;
  firePit: boolean;
  stillCount: number;
  stillDetail: string;
  signal: "unbuilt" | "lit" | "out";
  beaconNights: number;
  fuel: number;
  sandstorm: boolean;
  wreckSearchesLeft: number;
  inventory: InvItemView[];
  actions: ActionButton[];
  log: { id: number; stamp: string; text: string }[];
  pins: ZonePin[];
  classified: string;
}

export interface SightingView {
  animalName: string;
  text: string;
  weaponName: string;
  killOdds: number;
}

export interface EndView {
  rescued: boolean;
  heading: string;
  card: string;
  day: number;
  hourLabel: string;
  biomeName: string;
  causeLabel: string;
  lesson: string;
  baseRescueDay: number;
  effectiveRescueDay: number;
  signalDays: number;
  discoveries: string[];
  schematics: string[];
  score: ScoreBreakdown;
  seed: number;
}

export interface JournalView {
  preface: string;
  discoveries: JournalEntry[];
  hazards: JournalEntry[];
  schematics: JournalEntry[];
  lessons: LessonEntry[];
  completion: number;
  stats: Journal["stats"];
  knownIds: string[];
}

export interface ViewModel {
  screen: "title" | "play" | "end";
  notice: string | null;
  journalOpen: boolean;
  title: string;
  tagline: string;
  standingOrders: string[];
  journal: JournalView;
  play: PlayView | null;
  end: EndView | null;
  modal: ItemModal | null;
  craft: CraftView | null;
}

export interface CraftOptionView {
  materialId: string;
  name: string;
  detail: string;
  have: boolean;
  selected: boolean;
}

export interface CraftSlotView {
  id: SlotId;
  label: string;
  rule: string;
  options: CraftOptionView[];
  /** Set when nothing in the pack fits this slot. */
  missing: string | null;
}

export interface CraftView {
  toolId: string;
  toolName: string;
  known: boolean;
  slots: CraftSlotView[];
  summary: string[];
  timeLabel: string;
  block: string | null;
  command: Command | null;
}
