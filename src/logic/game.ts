import { gameData } from "../models/content.ts";
import type { Command, GameData, Journal, RunState, ViewModel } from "../models/types.ts";
import { applyCommand } from "./actions.ts";
import { loadJournal, saveJournal, type KeyValueStore } from "./journal.ts";
import { makeRng, randomSeed, type Rng } from "./rng.ts";
import { createRun } from "./setup.ts";
import { projectView, type UiFlags } from "./view.ts";

export const SESSION_KEY = "last-signal.session.v1";

interface SessionFile {
  version: 1;
  state: RunState;
  rngState: number;
  ui: UiFlags;
}

export class Game {
  state: RunState | null = null;
  journal: Journal;
  ui: UiFlags = { journalOpen: false, itemId: null };
  readonly data: GameData;
  private rng: Rng = makeRng(1);
  private readonly journalStore: KeyValueStore;
  private readonly sessionStore: KeyValueStore;

  constructor(journalStore: KeyValueStore, sessionStore: KeyValueStore, data: GameData = gameData) {
    this.journalStore = journalStore;
    this.sessionStore = sessionStore;
    this.data = data;
    this.journal = loadJournal(journalStore);
    this.restore();
  }

  dispatch(command: Command): void {
    if (command.type === "open-journal") {
      this.ui = { ...this.ui, journalOpen: true };
      this.persist();
      return;
    }
    if (command.type === "close-journal") {
      this.ui = { ...this.ui, journalOpen: false };
      this.persist();
      return;
    }
    if (command.type === "close-item") {
      this.ui = { ...this.ui, itemId: null };
      this.persist();
      return;
    }
    if (command.type === "abandon") {
      this.state = null;
      this.ui = { journalOpen: false, itemId: null };
      this.sessionStore.removeItem(SESSION_KEY);
      saveJournal(this.journalStore, this.journal);
      return;
    }
    if (command.type === "new-run") {
      this.start(command.seed);
      return;
    }
    if (!this.state || this.state.phase === "ended") return;
    if (command.type === "open-item") {
      this.ui = { ...this.ui, itemId: command.itemId };
      this.persist();
      return;
    }
    const result = applyCommand(this.state, this.journal, command, this.data, this.rng);
    this.state = result.state;
    this.journal = result.journal;
    if (command.type === "item") this.ui = { ...this.ui, itemId: null };
    this.persist();
  }

  view(): ViewModel {
    const screen = !this.state ? "title" : this.state.phase === "ended" ? "end" : "play";
    return projectView(this.state, this.journal, this.ui, this.data, screen);
  }

  private start(seed?: number): void {
    const chosen = seed && Number.isFinite(seed) && seed > 0 ? Math.floor(seed) : randomSeed();
    this.rng = makeRng(chosen);
    this.state = createRun(this.data, this.journal, this.rng, chosen);
    this.ui = { journalOpen: false, itemId: null };
    this.persist();
  }

  private persist(): void {
    saveJournal(this.journalStore, this.journal);
    if (!this.state) {
      this.sessionStore.removeItem(SESSION_KEY);
      return;
    }
    const file: SessionFile = {
      version: 1,
      state: this.state,
      rngState: this.rng.getState(),
      ui: this.ui,
    };
    this.sessionStore.setItem(SESSION_KEY, JSON.stringify(file));
  }

  private restore(): void {
    const raw = this.sessionStore.getItem(SESSION_KEY);
    if (!raw) return;
    try {
      const file = JSON.parse(raw) as SessionFile;
      if (file.version !== 1 || !file.state) return;
      this.state = file.state;
      this.ui = file.ui ?? { journalOpen: false, itemId: null };
      this.rng = makeRng(file.state.seed || 1);
      this.rng.setState(file.rngState);
    } catch {
      this.sessionStore.removeItem(SESSION_KEY);
    }
  }
}
