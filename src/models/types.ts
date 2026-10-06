export type Activity = "sleep" | "rest" | "wait" | "camp" | "build" | "search" | "travel";

export type BandId = "cold" | "mild" | "warm" | "hot" | "extreme";

export type Threat =
  | "heat"
  | "cold"
  | "dehydration"
  | "starvation"
  | "injury"
  | "sickness"
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

export interface BudgetRule {
  meter?: "hydration" | "hunger" | "fatigue" | "morale";
  below?: number;
  above?: number;
  flag?: BudgetFlag;
  delta: number;
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
  actionBudget: { base: number; minimum: number; rules: BudgetRule[] };
  ration: {
    hunger: number;
    morale: number;
    warmedHunger: number;
    warmedMorale: number;
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
  threat: "injury" | "sickness";
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
  grants: "shelter" | "firePit" | "solarStill" | "signalFire";
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
    laborPenalty: number;
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

export interface RunState {
  seed: number;
  day: number;
  hour: number;
  laborHours: number;
  laborMax: number;
  laborNotes: string[];
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
}

export interface HealthParts {
  heat: number;
  cold: number;
  dehydration: number;
  starvation: number;
  injury: number;
  sickness: number;
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
  | { type: "douse-signal" }
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
  laborHours: number;
  laborMax: number;
  laborNotes: string[];
  forecastHours: number;
  forecastNotes: string[];
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
  journalOpen: boolean;
  title: string;
  tagline: string;
  standingOrders: string[];
  journal: JournalView;
  play: PlayView | null;
  end: EndView | null;
  modal: ItemModal | null;
}
