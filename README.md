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

The day starts at 06:00. Work hours reset at dawn and shrink when you are thirsty, hungry, exhausted, injured, or sick. Rest and sleep do not spend work hours. They do spend clock time, water, and calories.

- Search the cabin, then the wreckage field (1h), the dry wash (3h), and the rocky ridge (5h). Farther walks cost more water and roll worse hazards.
- Midday air is about 53°C. Do the walking at dawn or dusk. Sit in shade, or in a shelter, through the middle of the day.
- Build a shelter and a fire pit from scrap. A solar still is plastic + container + tubing. The first time you rig one, the journal remembers it.
- Unknown plants can be eaten, ignored, or tested. Barrel cactus is a trap. Prickly pear is food once you know how to peel it.
- A lit signal fire burns one fuel bundle each dawn and pulls the hidden rescue day earlier. The day itself stays off the screen until the end card.
- Not every seed can be won. A death still writes a lesson.

Press `J` for the journal.

## Layout

- `data/` — items, zones, recipes, discoveries, need rates, rescue, score
- `src/logic/` — the simulation (no DOM)
- `src/ui/` — the panel
- `tests/` — decay, health order, action hours, rescue, journal
- `DESIGN.md` — the numbers and the knobs
