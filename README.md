# LAST SIGNAL

A turn-based desert survival prototype. The plane is already down. You keep a camp, cross three zones, and try to be alive when a hidden rescue day arrives. Death ends the body. The survival journal does not end.

This is a systems slice for one biome, the Sonoran scrub. Rules live in `data/` so they can move to Godot 4 later without rewriting the numbers.

## Run

```bash
npm install
npm run dev
```

Open [http://127.0.0.1:8734](http://127.0.0.1:8734).

```bash
npm test
npm run build
```

`npm run build` writes a static site to `dist/`. There is no backend. The journal is stored in `localStorage` under `last-signal.journal.v1`. The current run is kept in `sessionStorage` so a refresh continues it.

## How to play

The day starts at 06:00. There is no work-hour budget: every action costs clock time and fatigue. Tired (60) and exhausted (85) survivors work slower and get hurt more; at 100 fatigue you collapse where you stand and are out for 10 hours, whatever the hour. Sleep for 2, 4, 6, or 8 hours, or until dawn once it is 10 hours or less away. Night (19:00–06:00) slows everything and wakes snakes and scorpions; some work needs a fire or a torch. Rest, sleep, and waiting heal slowly if you are fed, watered, warm, and not bleeding.

- In the wash and on the ridge you may meet a rattlesnake or a scorpion. Back away, or try to kill it: a knife, club, or spear makes that far safer. Cook the meat on the fire pit; raw meat can make you sick.

- Search the cabin, then the wreckage field (1h), the dry wash (3h), and the rocky ridge (5h). Farther walks cost more water and roll worse hazards.
- Midday air is about 53°C. Do the walking at dawn or dusk. Sit in shade, or in a shelter, through the middle of the day.
- Build a shelter and a fire pit from scrap. A solar still is plastic + container + tubing. The first time you rig one, the journal remembers it.
- Unknown plants can be eaten, ignored, or tested. Barrel cactus is a trap. Prickly pear is food once you know how to peel it.
- A lit signal fire burns one fuel bundle each dawn and pulls the hidden rescue day earlier. The day itself stays off the screen until the end card.
- Not every seed can be won. A death still writes a lesson.

- Cut yourself? Bandage the wound with cloth: it slows the bleeding and lets you heal, but dirty cloth can turn it (15%). Rinse it with 0.25 L of water first (5%). A first aid kit fully treats cuts, bites, stings, and infection.

### Crafting

Knife, club, spear, and torch are each built from three parts: a **handle**, a **tool end**, and a **binding**.

- Handles: wood (creosote stick, mesquite branch, ironwood), metal (seat strut, aluminum tube), or plastic (panel strip, plastic pipe). A knife needs a short handle, a spear a long one. Plastic pipe flexes on a spear. Metal is sturdier; plastic is weaker and melts on a torch.
- Tool ends: sharp for a knife or spear (glass shard: sharp but brittle; sheet-metal shard; a knapped chert flake, +1h); blunt for a club (heavy stone, metal fitting); flammable for a torch (fuel bundle = 2 burns, resin-soaked cloth from cloth + creosote = 3 burns).
- Bindings: paracord, wire, cloth strips, yucca fiber (+1h), duct tape, or sinew from a rattlesnake you killed. Better bindings come apart less.
- The build dialog shows each slot, preselects the best parts you carry, and lets you pick a different one per slot. A crafted weapon can come apart on a failed kill. A factory knife is better than any crafted one and never breaks.
- Wreckage Field has metal, plastic, glass, and wire. Dry Wash has wood, stones, and yucca. Rocky Ridge has chert for knapping and ironwood. Some runs start with cord or duct tape.
- The first time you make each tool, the journal keeps the pattern for later runs.

Press `J` for the journal.

## Layout

- `data/` — items, zones, recipes, discoveries, need rates, rescue, score
- `src/logic/` — the simulation (no DOM)
- `src/ui/` — the panel
- `tests/` — decay, health order, action hours, rescue, journal
- `DESIGN.md` — the numbers and the knobs
