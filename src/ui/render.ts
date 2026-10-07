import type { ActionButton, CraftView, PlayView, ViewModel } from "../models/types.ts";

function esc(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function cmd(command: object): string {
  return encodeURIComponent(JSON.stringify(command));
}

function button(label: string, command: object, className = "", extra = ""): string {
  return `<button type="button" class="${className}" data-cmd="${cmd(command)}" ${extra}>${label}</button>`;
}

export function render(view: ViewModel): string {
  if (view.screen === "title") {
    return `<div class="shell title-shell">${renderTitle(view)}${renderJournal(view)}${renderModal(view)}</div>`;
  }
  const band = view.play?.bandId ?? "mild";
  return `<div class="shell play-shell" data-band="${band}" data-dark="${view.play?.dark ? "1" : "0"}">
    ${view.play ? renderPlay(view.play, view.journal.stats.runs) : ""}
    ${renderJournal(view)}
    ${renderModal(view)}
    ${view.craft && view.screen === "play" && !view.journalOpen ? renderCraft(view.craft) : ""}
    ${view.play?.sighting && view.screen === "play" && !view.journalOpen ? renderSighting(view.play) : ""}
    ${view.screen === "end" && view.end && !view.journalOpen ? renderEnd(view) : ""}
  </div>`;
}

function renderTitle(view: ViewModel): string {
  const stats = view.journal.stats;
  const known = view.journal.discoveries.length + view.journal.schematics.length + view.journal.hazards.length;
  return `<main class="title">
    <div class="title-copy">
      <p class="eyebrow">Field study · Sonoran scrub</p>
      <h1>${esc(view.title)}</h1>
      <p class="tagline">${esc(view.tagline)}</p>
      ${view.notice ? `<p class="banner notice">${esc(view.notice)}</p>` : ""}
      <ul class="orders">
        ${view.standingOrders.map((line) => `<li>${esc(line)}</li>`).join("")}
      </ul>
      <div class="title-actions">
        ${button("Begin a run", { type: "new-run" }, "primary")}
        <label class="seed">Replay seed <input id="seed-input" inputmode="numeric" placeholder="optional" /></label>
        ${button("Open the journal", { type: "open-journal" }, "ghost")}
      </div>
      <p class="record">Runs ${stats.runs} · Rescues ${stats.rescues} · Best ${stats.bestDays} days · Journal ${known} entries · ${Math.round(view.journal.completion * 100)}%</p>
    </div>
    <div class="title-art" aria-hidden="true">${titleArt()}</div>
  </main>`;
}

function titleArt(): string {
  return `<svg viewBox="0 0 520 640" class="art">
    <rect width="520" height="640" fill="#1a1410"/>
    <path d="M0 430 C80 400 140 450 220 420 C300 390 360 450 520 400 L520 640 L0 640 Z" fill="#2a211b"/>
    <path d="M0 500 C120 470 180 520 280 490 C380 460 430 510 520 480 L520 640 L0 640 Z" fill="#3a2c22"/>
    <circle cx="390" cy="150" r="54" fill="#e7a15a"/>
    <circle cx="390" cy="150" r="78" fill="none" stroke="#e7a15a" stroke-opacity="0.35"/>
    <path d="M70 470 L150 430 L210 455 L250 390 L300 470" fill="none" stroke="#c6a36a" stroke-width="3"/>
    <path d="M150 430 L168 470 M210 455 L198 490 M250 390 L270 455" stroke="#8d6a45" stroke-width="2"/>
    <rect x="232" y="402" width="46" height="16" rx="2" transform="rotate(-18 255 410)" fill="#d9d2c5"/>
    <path d="M300 470 C340 360 360 330 372 250" fill="none" stroke="#e25c2c" stroke-width="3" stroke-dasharray="3 7"/>
    <text x="36" y="80" fill="#f3eadf" font-family="Fraunces, serif" font-size="28">Day unknown</text>
    <text x="36" y="112" fill="#b3a394" font-family="Outfit, sans-serif" font-size="14">Rescue window classified</text>
  </svg>`;
}

function renderPlay(play: PlayView, priorRuns: number): string {
  return `<header class="top">
      <div class="brand">
        <p class="eyebrow">Last Signal</p>
        <strong>Day ${play.day}</strong>
      </div>
      <div class="clock" data-band="${play.bandId}">
        <b>${esc(play.hourLabel)}</b>
        <span>${esc(play.bandName)} · air ${play.airTempC}°C</span>
        <span class="light ${play.dark ? "dark" : ""}">${esc(play.lightLabel)}</span>
      </div>
      <div class="pace ${play.pace.mult >= 1.5 ? "low" : ""}" title="How much longer actions take right now">
        <b>${esc(play.pace.label)}</b>
        <span>action pace</span>
      </div>
      <div class="top-actions">
        ${button("Journal", { type: "open-journal" }, "ghost")}
        ${button("Leave run", { type: "abandon" }, "ghost danger-text")}
      </div>
    </header>
    <p class="classified">${esc(play.classified)}${priorRuns > 0 ? " · the journal came with you" : ""}</p>
    ${play.sandstorm ? `<p class="banner">Sandstorm. Travel away from camp is shut. A shelter turns it into noise.</p>` : ""}
    <div class="stage">
      <aside class="vitals">${renderMeters(play)}${renderConditions(play)}</aside>
      <section class="world">
        ${renderMap(play)}
        ${renderInventory(play)}
        ${renderLog(play)}
      </section>
      <aside class="act-col">${play.sighting ? `<p class="quiet">Something is watching you. Decide first.</p>` : renderActions(play)}</aside>
    </div>`;
}

function renderMeters(play: PlayView): string {
  return `<div class="meter-block">
    ${play.meters
      .map(
        (meter) => `<div class="meter tone-${meter.tone}">
          <div class="meter-label"><span>${esc(meter.label)}</span><b>${esc(meter.valueLabel)}</b></div>
          <div class="track" role="meter" aria-valuenow="${Math.round(meter.fill)}" aria-valuemin="0" aria-valuemax="100" aria-label="${esc(meter.label)}">
            <i style="width:${Math.max(0, Math.min(100, meter.fill))}%"></i>
          </div>
        </div>`,
      )
      .join("")}
    <ul class="pace-notes">${play.pace.notes.map((note) => `<li>${esc(note)}</li>`).join("")}</ul>
  </div>`;
}

function renderConditions(play: PlayView): string {
  if (play.conditions.length === 0) return `<p class="quiet">No open wounds. That can change on a walk.</p>`;
  return `<ul class="chips">${play.conditions.map((condition) => `<li>${esc(condition)}</li>`).join("")}</ul>`;
}

function renderMap(play: PlayView): string {
  const signal =
    play.signal === "lit"
      ? `Signal burning · ${play.fuel} fuel · ${play.beaconNights} night${play.beaconNights === 1 ? "" : "s"} of smoke`
      : play.signal === "out"
        ? "Signal cold. Relight it or the smoke stops counting."
        : "No signal. A fire here can pull a search closer. The day stays hidden.";
  return `<div class="map-card">
    <div class="map-head">
      <div>
        <p class="eyebrow">Tier ${play.tierLevel} · ${esc(play.tierName)}</p>
        <h2>${esc(play.locationName)}</h2>
      </div>
      <p>${esc(play.locationBlurb)}</p>
    </div>
    ${mapSvg(play)}
    <ul class="structures">
      <li class="${play.shelter ? "on" : ""}">Shelter ${play.shelter ? "dug" : "none"}</li>
      <li class="${play.firePit ? "on" : ""}">Fire pit ${play.firePit ? "built" : "none"}</li>
      <li class="${play.stillCount ? "on" : ""}">Stills ${play.stillCount}</li>
      <li class="${play.signal === "lit" ? "on hot" : ""}">${esc(signal)}</li>
    </ul>
    <p class="still-line">${esc(play.stillDetail)}</p>
  </div>`;
}

function mapSvg(play: PlayView): string {
  const here = play.locationId;
  const mark = (id: string) => (here === id ? "here" : "");
  return `<svg class="map" viewBox="0 0 640 280" role="img" aria-label="Camp and three zones">
    <rect width="640" height="280" fill="#1a1512"/>
    <path d="M0 190 C80 160 140 210 230 180 C320 150 400 200 520 160 C580 145 610 170 640 150 L640 280 L0 280 Z" fill="#2a221c"/>
    <path d="M0 230 C100 210 200 250 320 220 C440 190 540 230 640 200 L640 280 L0 280 Z" fill="#3a2e26"/>
    <path d="M90 200 C180 150 240 170 300 120 C380 70 470 90 560 40" fill="none" stroke="#c6a36a" stroke-width="2" stroke-dasharray="4 6"/>
    ${pin(90, 200, "Crash Site", "camp", mark("camp"), "0h")}
    ${pin(250, 145, "Wreckage", "wreckage-field", mark("wreckage-field"), "1h")}
    ${pin(400, 100, "Dry Wash", "dry-wash", mark("dry-wash"), "3h")}
    ${pin(560, 42, "Ridge", "rocky-ridge", mark("rocky-ridge"), "5h")}
  </svg>`;
}

function pin(x: number, y: number, label: string, id: string, cls: string, hours: string): string {
  return `<g class="pin ${cls}" data-id="${id}">
    <circle cx="${x}" cy="${y}" r="${cls ? 11 : 7}" fill="${cls ? "#e25c2c" : "#f3eadf"}"/>
    <text x="${x + 14}" y="${y - 8}" fill="#f3eadf" font-size="13" font-family="Outfit, sans-serif">${label}</text>
    <text x="${x + 14}" y="${y + 10}" fill="#c6a36a" font-size="11" font-family="Outfit, sans-serif">${hours}</text>
  </g>`;
}

function renderInventory(play: PlayView): string {
  if (play.inventory.length === 0) {
    return `<div class="pack"><p class="quiet">Pockets empty.</p></div>`;
  }
  return `<div class="pack">
    ${play.inventory
      .map(
        (item) =>
          `<button type="button" class="chip ${item.warning ? "unknown" : ""}" data-cmd="${cmd({ type: "open-item", itemId: item.id })}">
            <b>${esc(item.name)}</b><span>${esc(item.qtyLabel)}</span>
          </button>`,
      )
      .join("")}
  </div>`;
}

function renderLog(play: PlayView): string {
  return `<div class="paper">
    <p class="eyebrow dark">Run log</p>
    <div class="log">
      ${play.log
        .map(
          (line) =>
            `<p><time>${esc(line.stamp)}</time> ${esc(line.text)}</p>`,
        )
        .join("")}
    </div>
  </div>`;
}

function renderActions(play: PlayView): string {
  const groups = ["Now", "Move", "Build"];
  return groups
    .map((group) => {
      const items = play.actions.filter((action) => action.group === group);
      if (items.length === 0) return "";
      return `<section class="group"><h3>${group}</h3>${items.map(renderAction).join("")}</section>`;
    })
    .join("");
}

function renderAction(action: ActionButton): string {
  const warning = action.warning ? `<em>${esc(action.warning)}</em>` : "";
  // Crafting opens the build dialog first, where each slot can be chosen.
  const command = action.command?.type === "craft" ? { type: "open-craft", toolId: action.command.toolId } : action.command;
  const attr = action.disabled || !command ? "disabled" : `data-cmd="${cmd(command)}"`;
  return `<button type="button" class="action ${action.warning ? "hot" : ""}" ${attr}>
    <b>${esc(action.label)}</b>
    <small>${esc(action.detail)}</small>
    ${warning}
  </button>`;
}

function renderSighting(play: PlayView): string {
  const sighting = play.sighting;
  if (!sighting) return "";
  return `<div class="overlay sighting-layer">
    <article class="modal sighting">
      <p class="eyebrow">Sighting · the clock stops</p>
      <h2>${esc(sighting.animalName)}</h2>
      <p>${esc(sighting.text)}</p>
      <p class="quiet">Best weapon in the pack: ${esc(sighting.weaponName)}.</p>
      <div class="modal-actions">
        ${play.actions.map(renderAction).join("")}
      </div>
    </article>
  </div>`;
}

function renderCraft(craft: CraftView): string {
  const slots = craft.slots
    .map((slot) => {
      const options = slot.options
        .map((option) => {
          const pick = { type: "craft-pick", slot: slot.id, materialId: option.materialId };
          const state = option.selected ? "selected" : option.have ? "" : "missing";
          const attr = option.have && !option.selected ? `data-cmd="${cmd(pick)}"` : option.have ? "" : "disabled";
          return `<button type="button" class="part ${state}" ${attr} aria-pressed="${option.selected}">
            <b>${esc(option.name)}</b><small>${esc(option.have ? option.detail : "none in pack")}</small>
          </button>`;
        })
        .join("");
      return `<section class="slot ${slot.missing ? "empty" : ""}">
        <h3>${esc(slot.label)}</h3>
        <p class="rule">${esc(slot.rule)}</p>
        ${slot.missing ? `<p class="slot-missing">${esc(slot.missing)}</p>` : ""}
        <div class="parts">${options}</div>
      </section>`;
    })
    .join("");
  const go = craft.command
    ? button(`<b>Craft · ${esc(craft.timeLabel)}</b><small>Uses the selected parts.</small>`, craft.command, "primary craft-go")
    : `<button type="button" class="primary craft-go" disabled><b>Can't craft yet</b><small>${esc(craft.block ?? "")}</small></button>`;
  return `<div class="overlay">
    <article class="modal craft-modal">
      <p class="eyebrow">${craft.known ? "Pattern in the journal" : "Untried pattern"} · handle + tool end + binding</p>
      <h2>${esc(craft.toolName)}</h2>
      <div class="slots">${slots}</div>
      ${craft.summary.length ? `<ul class="craft-summary">${craft.summary.map((line) => `<li>${esc(line)}</li>`).join("")}</ul>` : ""}
      <div class="craft-actions">
        ${go}
        ${button("<b>Cancel</b><small>Keep the parts.</small>", { type: "close-craft" }, "ghost")}
      </div>
    </article>
  </div>`;
}

function renderModal(view: ViewModel): string {
  const modal = view.modal;
  if (!modal) return "";
  return `<div class="overlay">
    <article class="modal">
      <p class="eyebrow">${modal.known ? "In the journal" : "Not in the journal"}</p>
      <h2>${esc(modal.title)} ${modal.qtyLabel ? `<span>${esc(modal.qtyLabel)}</span>` : ""}</h2>
      <p>${esc(modal.blurb)}</p>
      <div class="modal-actions">
        ${modal.actions
          .map((action) => {
            const command = { type: "item", itemId: modal.itemId, action: action.id };
            return `<button type="button" ${action.disabled ? "disabled" : `data-cmd="${cmd(command)}"`}>
              <b>${esc(action.label)}</b><small>${esc(action.detail)}</small>
            </button>`;
          })
          .join("")}
      </div>
    </article>
  </div>`;
}

function renderJournal(view: ViewModel): string {
  if (!view.journalOpen) return "";
  const journal = view.journal;
  const section = (title: string, body: string) =>
    `<section><h3>${title}</h3>${body || `<p class="quiet">Nothing written yet.</p>`}</section>`;
  return `<div class="overlay journal-layer">
    <article class="journal">
      <header>
        <p class="eyebrow">Survival journal</p>
        <h2>What survives is what you learned.</h2>
        <p>${esc(journal.preface)}</p>
        ${button("Close", { type: "close-journal" }, "ghost")}
      </header>
      <p class="record">Completion ${Math.round(journal.completion * 100)}% · Runs ${journal.stats.runs} · Rescues ${journal.stats.rescues} · Best ${journal.stats.bestDays}d · Score ${journal.stats.bestScore}</p>
      ${section(
        "Plants and finds",
        journal.discoveries.map((entry) => `<article><h4>${esc(entry.name)}</h4><p>${esc(entry.text)}</p></article>`).join(""),
      )}
      ${section(
        "Schematics",
        journal.schematics.map((entry) => `<article><h4>${esc(entry.name)}</h4><p>${esc(entry.text)}</p></article>`).join(""),
      )}
      ${section(
        "Hazards",
        journal.hazards.map((entry) => `<article><h4>${esc(entry.name)}</h4><p>${esc(entry.text)}</p></article>`).join(""),
      )}
      ${section(
        "Deaths",
        journal.lessons
          .map(
            (entry) =>
              `<article><h4>${esc(entry.cause)} · day ${entry.day} · run ${entry.run}</h4><p>${esc(entry.text)}</p></article>`,
          )
          .join(""),
      )}
    </article>
  </div>`;
}

function renderEnd(view: ViewModel): string {
  const end = view.end;
  if (!end) return "";
  const pulled =
    end.effectiveRescueDay < end.baseRescueDay
      ? `Smoke moved the window from day ${end.baseRescueDay} to day ${end.effectiveRescueDay}.`
      : `No smoke shifted it. The hidden day was ${end.baseRescueDay}.`;
  const rescueLine = end.rescued
    ? `Rescue made on the morning of day ${end.day}. ${pulled}`
    : `Rescue missed. You died on day ${end.day}. Search would have reached this grid on day ${end.effectiveRescueDay}. ${pulled}`;
  const list = (items: string[], empty: string) =>
    items.length ? items.map((item) => `<li>${esc(item)}</li>`).join("") : `<li>${empty}</li>`;
  return `<div class="overlay end-layer">
    <article class="end-card ${end.rescued ? "saved" : "lost"}">
      <p class="eyebrow">Field report · ${esc(end.biomeName)}</p>
      <h2>${esc(end.heading)}</h2>
      <p class="card-line">${esc(end.card)}</p>
      <dl>
        <div><dt>Days survived</dt><dd>${end.day}</dd></div>
        <div><dt>Clock</dt><dd>${esc(end.hourLabel)}</dd></div>
        <div><dt>Outcome</dt><dd>${esc(end.causeLabel)}</dd></div>
        <div><dt>Beacon nights</dt><dd>${end.signalDays}</dd></div>
      </dl>
      <p>${esc(rescueLine)}</p>
      ${end.lesson ? `<blockquote>${esc(end.lesson)}</blockquote>` : ""}
      <div class="end-cols">
        <div><h3>Discoveries</h3><ul>${list(end.discoveries, "Nothing new.")}</ul></div>
        <div><h3>Schematics</h3><ul>${list(end.schematics, "None learned.")}</ul></div>
      </div>
      <dl class="score">
        <div><dt>Time</dt><dd>${end.score.survival}</dd></div>
        <div><dt>Discoveries</dt><dd>${end.score.discoveries}</dd></div>
        <div><dt>Schematics</dt><dd>${end.score.schematics}</dd></div>
        <div><dt>Rescue</dt><dd>${end.score.rescue}</dd></div>
        <div><dt>Journal</dt><dd>${end.score.journal}</dd></div>
        <div><dt>Total</dt><dd>${end.score.total}</dd></div>
      </dl>
      <p class="seed-line">Seed ${end.seed}</p>
      <div class="title-actions">
        ${button("New run", { type: "new-run" }, "primary")}
        ${button("Replay this seed", { type: "new-run", seed: end.seed }, "ghost")}
        ${button("Journal", { type: "open-journal" }, "ghost")}
      </div>
    </article>
  </div>`;
}
