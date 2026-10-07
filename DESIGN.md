# LAST SIGNAL — rules and tuning

Desert only. One hidden rescue clock. Nothing you can raise carries between runs except the journal.

All of the numbers below are the values in `data/`. Change those files, not the UI, when you tune.

## Day clock

- A day is 24 hours. You wake at 06:00.
- Bands are in `data/biome.json`: night, dawn, morning, midday (10:00–16:00, 53°C), afternoon, dusk, night.
- There is no work day and no work-hour budget (removed in v3). Every action costs clock time and fatigue, and any action may run across 06:00; dawn is processed mid-action.
- At dawn: stills produce, a lit signal spends fuel, rescue is checked, a sandstorm may roll.
- A sprained ankle adds 1 hour to every walk (`data/starting.json` and the fall hazard).

## Needs

Meters are 0–100. Health starts at 100. `data/needs.json`.

| Meter | Empty or extreme effect |
| --- | --- |
| Hydration | At 0, lose 2.1 health per hour. About two days from full health. |
| Hunger | At 0, lose 1.05 health per hour. About four days. |
| Temperature | Body temperature, not a bar you fill by eating. Heat and cold below. |
| Fatigue | The limiter. Slows actions at 60 and 85; at 100 you collapse until dawn. See Pace. |
| Morale | Light. Very low morale slows actions a little. |

One hour of any single empty meter cannot drop health from 100 to 0. Critical heat is 14 health per hour, thirst 2.1, hunger 1.05. They stack. Heat wins ties.

Drinking and eating are instant. 0.5 L restores 12.5 hydration (`pointsPerLiter` is 25).

### Heat and cold

Felt temperature starts from the air, then:

- Shade while resting: −14°C
- Dug shelter at midday: −19°C
- Wreckage shade while working at camp: −11°C
- Night in the open wreck, no shelter: +5°C windbreak
- Shelter at night: +10°C
- Fire pit at night: +12°C

Body temperature eases toward an equilibrium each hour (`bodyTemp.approach` 0.42). Damage starts at 39.0°C (4/h), 40.0°C (8/h), 40.7°C (14/h). Cold starts at 35.7°C (4/h) and 34.9°C (9/h). Hydration under 25 adds 0.45°C to the target in hot or extreme bands.

Travel uses full sun plus exertion. A ridge walk that starts at 10:00 is five extreme hours. The same walk at 06:00 is mostly morning.

### Water loss

Hourly hydration loss is `activity rate × band multiplier × context multiplier`, then × zone exposure for travel and off-camp search.

Band multipliers: cold 0.5, mild 0.72, warm 1.15, hot 1.7, extreme 2.55.

Context multipliers (the shade and shelter discounts): travel 1, zone search 0.95, camp search 0.68, building 0.72, rest in shade 0.4, rest in shelter 0.32, wait in the open 0.8, wait at the wreck 0.55, wait in shelter 0.4, sleep in the open 0.85, sleep at the wreck 0.6, sleep in shelter 0.45.

A solar still yields 0.5–1.0 L at dawn (`data/events.json`). A still dug in the dry wash adds 0.25 L, capped at 1.25 L. Plan on about three. Maximum four.

A sandstorm adds 1.6 hydration loss per exposed hour.

## Waiting and sleeping in the open

Waiting is a survivor's choice, not a menu state. **Invariant: a live run always offers at least one enabled action.** `Wait` is that action. It is available in any zone, at any hour, in any condition (`hasValidAction` in `src/logic/actions.ts`, covered by `tests/wait.test.ts` and a seeded random-play fuzz in `tests/v3.test.ts`). The only time Wait is not on the list is during an animal sighting, when the two sighting choices are the valid actions (Back away is always legal).

- Buttons: `Wait 1h`, `Wait 2h` (`needs.wait.hourOptions`), and `Wait until dawn` when that is a different length. A wait that crosses 06:00 runs the full dawn: day +1, stills, signal fuel, rescue check, and sandstorm roll.
- Exposure uses the normal hour tick with activity `wait` (`needs.activities.wait`). At camp the wreck, shelter, and fire modifiers apply as for rest. In a zone you are in the open: `felt.openDayDeltaC` 0 by day, `felt.openNightDeltaC` 0 at night. Hydration multipliers: `wait-open` 0.8, `wait-camp` 0.55, `wait-shelter` 0.4.
- Rough cost from 37°C and full health: 6h exposed from 10:00 takes about 32 health (heat). An open night from 22:00 to dawn takes about 48 health (cold). The same night in a shelter with a fire costs nothing.
- `Sleep in the open` (sleep away from camp) runs to dawn with the bare-air night, fatigue recovery ×0.4, morale −0.6/h, and a 12% chance of a scorpion sting at dawn (`needs.wait.openSleep`). Waiting awake skips the sting but recovers less.

## Pace, fatigue, and collapse (v3)

`data/needs.json` → `fatigue`, `strain`, `pace`, `darkness`. Code: `src/logic/pace.ts`.

Action time = base hours × fatigue × darkness × (1 + strain), rounded to whole hours, never below base, multiplier capped at ×3 (`pace.maxMult`). Rest, sleep, and wait are fixed lengths and are never scaled. The header shows the current multiplier for unlit work ("action pace"); each button shows its own hours, e.g. `3h (normally 2h)`.

- **Fatigue** (`fatigue.tiers`): at 60 "Tired" ×1.25 time and ×1.25 hazard odds; at 85 "Exhausted" ×1.5 time and ×1.6 hazard odds. Work adds fatigue per hour (camp 3.5, search 4.5, travel 5.5, build 6.5) plus heat (`fatigue.heatPerHour`: warm +0.5, hot +1.5, extreme +3). Rest −7/h, sleep −11/h, wait −3/h.
- **Collapse** (`fatigue.collapseAt` 100, `collapse`): checked after every command. A hard stop: you sleep where you stand until the next 06:00. Away from camp that is the full open exposure (bare-air heat or cold, sleep-open thirst), plus 15% scorpion and 6% snakebite at dawn. Recovery is poor (fatigue recovery ×0.5, morale −0.8/h, regen 0.1/h only if otherwise eligible). At camp you get the camp's shelter and fire. A death during collapse is recorded as **Collapse** (`lessons.exhaustion`) with its own journal lesson. Any button whose preview ends at fatigue 100 shows the warning "Collapse: fatigue will hit 100".
- **Strain** (`strain.rules`, the old work-hour cuts): hydration <50/<30/<15 slow +0.1/+0.15/+0.2 and risk +0.1/+0.15/+0.2; hunger <40/<20 slow +0.1/+0.15, risk +0.05/+0.1; morale <15 slow +0.1; injured (sprain, bite, sting, cut, concussion) slow +0.2, risk +0.15; sunburn slow +0.1; gut slow +0.2, risk +0.1. Slow is capped at +1.0. Risk multiplies every hazard roll during the action.

## Darkness (v3)

Night is 19:00–06:00 (`darkness.fromHour`/`toHour`).

- Work in the dark: ×1.6 time with no light, ×1.2 by torch, ×1.15 by the camp fire pit.
- Hazards on dark actions: snakebite ×1.6, scorpion ×1.8, fall ×2.2, thorns ×1.4. With a torch or a lit fire pit only 40% of that extra applies (`lightHazardScale`).
- Light-gated work is disabled with "Too dark. Needs light. A lit fire pit at camp, or a torch.": searching Rocky Ridge (`zones[].searchNeedsLight`), building a solar still (`recipes[].needsLight`), and reading the field manual.
- Travel at night is allowed: slower and riskier.
- **Torch**: 1 fuel + 1 cloth, 1h, buildable anywhere; carry up to 3. A torch is lit automatically for dark travel, dark searches, and light-gated work, and is used up by that one action. Plain crafting and food prep never burn a torch.

## Health regen (v3)

`data/needs.json` → `regen`. Health returns only during rest, sleep, or wait, and only when hydration > 40, hunger > 30, body temperature 36.0–38.6°C, and no condition is draining health (bites, stings, cuts, sickness). Per hour: sleep in shelter with fire 1.0, shelter 0.7, fire only 0.55, at the wreck 0.45, in the open 0.15; rest in shelter 0.4, at camp or in shade 0.3; wait in shelter 0.3, at camp 0.2, in the open 0.1; collapse 0.1. The vitals panel says what is blocking healing.

Cooked food heals a little at once: warmed ration +2, fire-prepared prickly pear or mesquite +2, cooked rattlesnake +3, cooked scorpion +1. The first aid kit treats bites, stings, cuts, and sprains as before.

## Wildlife and hunting (v3)

`data/wildlife.json`. Code: `src/logic/wildlife.ts`. There is no Hunt action. Hunting is a choice offered when an animal shows up.

- **Sightings** roll at the end of a zone search, a walk out to a zone, and a rest, wait, or open-air sleep in a zone. Never at camp. Chance per action: Wreckage Field 4%, Dry Wash 14%, Rocky Ridge 13%; × trigger (search 1, travel 0.8, rest 0.6); × band (night 1.2, dawn/dusk 1.5, morning 1, afternoon 0.6, midday 0.35); × 1.3 in the dark. Rattlesnakes are three times as common as scorpions in the wash and on the ridge.
- **The game pauses**: only two actions are legal, *Back away* (snake strikes anyway 12%, scorpion 8%) or *Try to kill it*. Everything else is refused until you choose. Saved runs keep the prompt.
- **Kill odds** by best weapon in the pack (picked automatically): bare hands and a rock 25% snake / 40% scorpion; club 60/70; knife 65/80; spear 78/72. ×0.75 in the dark with no light, ×0.85 when exhausted, clamped 5–95%. A miss means a strike (snakebite / scorpion condition) with probability bare 90%, club 70%, knife 75%, spear 50%; otherwise it gets away. A kill costs 4 fatigue (snake) or 1 (scorpion).
- **Weapons**: knife (15% in the starting pack, or found in the Wreckage Field); club (2 debris, 1h, anywhere); spear (1 debris, 1 cloth, 1 stone, 2h, at camp).
- **Meat**: rattlesnake meat or a scorpion. *Eat raw*: snake +18 hunger with 35% stomach cramps and diarrhea; scorpion +4 with 20% nausea. *Cook it* (lit fire pit at camp, 1h before pace): snake +30 hunger, +3 health, +5 morale; scorpion +8, +1, +2; never sick. Uncooked meat turns after 24h (all of that kind in the pack at once).
- **Journal**: first kill of each animal and first sickness from raw snake each write an entry ("A rattlesnake is food if you cook it. Its head can still bite after it is dead." / "Scorpions are edible cooked once the stinger is off." / "Raw snake meat can make you sick. Cook it on the fire pit."). They count toward completion.

## Saves

The active run lives in `sessionStorage` (`last-signal.session.v1`, format version 2). A run saved by an older version is discarded on load with a title-screen notice; the journal in `localStorage` is untouched.

## Camp

Tiers skip 4. Food preservation is out of scope.

| Tier | Build | Cost | Effect |
| --- | --- | --- | --- |
| 0 Crash Site | — | — | Four cabin searches, partial night windbreak |
| Gear | 1–2h | see Darkness and Wildlife | Torch, club, spear. Go in the pack, not the camp. |
| 1 Basic Shelter | 4h | 2 cloth, 3 debris | Midday heat cut, cheaper rest and sleep, sandstorms become noise |
| 2 Fire Pit | 2h | 4 stone, 1 fuel | Night warmth, cooking, no scorpion in camp, boil seep water |
| 3 Water Collection | 3h each | 1 plastic, 1 container, 1 tubing | 0.5–1 L per still per dawn. Better in the wash. |
| 5 Signal Station | 1h | Fire pit + 2 fuel | See rescue |

Recipes: `data/recipes.json`.

## Zones

`data/zones.json`. Exposure multiplies travel and search water. Higher ground rolls more snakes, scorpions, and falls (`data/hazards.json`).

| Zone | Travel | Search | Exposure |
| --- | --- | --- | --- |
| Wreckage Field | 1h | 2h | 1.00 |
| Dry Wash | 3h | 2h | 1.08 |
| Rocky Ridge | 5h | 2h | 1.15 |

Each search rolls two loot entries. Hazards roll once per hazard that can happen there, scaled by time of day (snakes prefer mild hours, scorpions prefer night). Sunburn can land on hot or extreme travel and zone searches.

Night visitor (`data/events.json`): 14% at dawn with no fire, 7% if you have a shelter but still no fire. A fire pit stops it.

Sandstorm: 8% from day 3. Blocks leaving camp. Without a shelter it deals 8 health and 10 hydration at dawn.

## Discovery

`data/discoveries.json`. Unknown items offer Eat, Ignore, or Experiment. The result is a journal entry. Known items are named automatically on later runs.

| Find | Truth |
| --- | --- |
| Barrel cactus | Trap. A sip, then vomiting (10h, +3.5 hydration loss/h) and diarrhea (18h, +2.5/h). |
| Prickly pear | Food. Prepared is better, fire is better still. The third pad in a day cramps the gut. |
| Desert mistletoe | Poison berries. Experimenting hurts less than eating the cluster. |
| Creosote | Not food. A poultice clears sunburn. |
| Mesquite pods | Calories if you pound them. |
| Seep water | Dirty. Raw drink loans hydration and then diarrhea. Boil at the fire pit for 0.5 L clean. |

Ignore writes nothing. Eat and Experiment both teach, and Experiment is the cheaper lesson.

The solar still schematic is learned by building it, or by reading a torn field manual. After that, every run shows the recipe and the missing parts. `data/schematics.json`.

## Rescue

`data/rescue.json`.

- Base day is a random integer from 18 to 25, chosen at the crash. It is not on the play screen.
- Each dawn a lit signal still has fuel, `signalDays` increases by 1 and one fuel bundle is consumed.
- Effective day = `max(11, baseDay - signalDays)`.
- If you are alive at that dawn, you are rescued. The fire does not have to be lit at the moment of pickup; nights already banked still count. Running out of fuel simply stops new nights from counting.
- The end card shows the base day, the shifted day, beacon nights, and the seed.

## Starting variance

`data/starting.json`.

- Water 1.6–3.2 L. Hunger and hydration start in the 70–90 band.
- Rations 1–2. Cloth, debris, stone, and fuel vary. Plastic, a container, and tubing are uncommon, so a still on minute one is rare.
- 30% chance of a sprain (72h), a laceration, or a concussion.

## Score

`data/score.json`, shown on the end card.

- 10 × days survived
- 25 × discoveries learned this run
- 40 × schematics learned this run
- 120 if rescued
- `round(journal completion × 100)`

Completion is the share of discoveries, schematics, and hazards (including sandstorm) already in the journal after the run. Death always appends one lesson, even if nothing else was learned. Lessons are recorded; they are not a stat bonus.

## What does not carry

Health, supplies, buildings, injuries, and the seed's rescue day. A new run is a new body. The journal only renames what you already paid to learn, and unlocks the still recipe.
