import { Game } from "./logic/game.ts";
import type { Command } from "./models/types.ts";
import { render } from "./ui/render.ts";
import "./ui/style.css";

const found = document.querySelector<HTMLElement>("#app");
if (!found) throw new Error("Missing #app");
const root: HTMLElement = found;

const game = new Game(localStorage, sessionStorage);

function paint(): void {
  root.innerHTML = render(game.view());
  const log = root.querySelector<HTMLElement>(".log");
  if (log) log.scrollTop = log.scrollHeight;
}

root.addEventListener("click", (event) => {
  const target = (event.target as HTMLElement | null)?.closest<HTMLElement>("[data-cmd]");
  if (!target || target.hasAttribute("disabled")) return;
  const raw = target.getAttribute("data-cmd");
  if (!raw) return;
  const command = JSON.parse(decodeURIComponent(raw)) as Command;
  if (command.type === "new-run" && !command.seed) {
    const input = root.querySelector<HTMLInputElement>("#seed-input");
    const text = input?.value.trim() ?? "";
    if (text) {
      const parsed = Number(text);
      if (Number.isFinite(parsed) && parsed > 0) command.seed = Math.floor(parsed);
    }
  }
  game.dispatch(command);
  paint();
});

window.addEventListener("keydown", (event) => {
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
  const view = game.view();
  if (event.key === "Escape") {
    if (view.craft) game.dispatch({ type: "close-craft" });
    else if (view.modal) game.dispatch({ type: "close-item" });
    else if (view.journalOpen) game.dispatch({ type: "close-journal" });
    else return;
    paint();
  }
  if (event.key === "j" || event.key === "J") {
    game.dispatch({ type: view.journalOpen ? "close-journal" : "open-journal" });
    paint();
  }
});

if (import.meta.env.DEV) {
  const dev = window as unknown as { __game: Game; __paint: () => void };
  dev.__game = game;
  dev.__paint = paint;
}

paint();
