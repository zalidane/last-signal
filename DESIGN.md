# LAST SIGNAL — rules and tuning

Desert only. One hidden rescue clock. Nothing you can raise carries between runs except the journal.

All of the numbers below are the values in `data/`. Change those files, not the UI, when you tune.

## Day clock

- A day is 24 hours. You wake at 06:00.
- Bands are in `data/biome.json`: night, dawn, morning, midday (10:00–16:00, 53°C), afternoon, dusk, night.
- Work, search, travel, build, and experiments must finish before the next 06:00. Sleep is the action that crosses dawn.
- At dawn: stills produce, a lit signal spends fuel, rescue is checked, a sandstorm may roll, work hours reset.
- A sprained ankle adds 1 hour to every walk (`data/starting.json` and the fall hazard).

## Needs

Meters are 0–100. Health starts at 100. `data/needs.json`.

| Meter | Empty or extreme effect |
| --- | --- |
| Hydration | At 0, lose 2.1 health per hour. About two days from full health. |
| Hunger | At 0, lose 1.05 health per hour. About four days. |
| Temperature | Body temperature, not a bar you fill by eating. Heat and cold below. |
| Fatigue | High fatigue cuts work hours. It does not kill. |
| Morale | Light. Very low morale cuts one work hour. |

One hour of any single empty meter cannot drop health from 100 to 0. Critical heat is 14 health per hour, thirst 2.1, hunger 1.05. They stack. Heat wins ties.

Drinking is instant and free of work hours. 0.5 L restores 12.5 hydration (`pointsPerLiter` is 25).

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

Context multipliers (the shade and shelter discounts): travel 1, zone search 0.95, camp search 0.68, building 0.72, rest in shade 0.4, rest in shelter 0.32, sleep at the wreck 0.6, sleep in shelter 0.45.

A solar still yields 0.5–1.0 L at dawn (`data/events.json`). A still dug in the dry wash adds 0.25 L, capped at 1.25 L. Plan on about three. Maximum four.

A sandstorm adds 1.6 hydration loss per exposed hour.

## Work hours

`actionBudget` in `data/needs.json`. Base 12, floor 4. Cuts apply together:

- Hydration below 50 / 30 / 15: −1 / −2 / −2
- Hunger below 40 / 20: −1 / −2
- Fatigue above 60 / 85: −2 / −2
- Morale below 15: −1
- Injured (sprain, bite, sting, cut, concussion): −2
- Sunburn: −1
- Gut (vomit, diarrhea, nausea, cramps): −2

If a line is crossed mid-day, remaining hours drop by the difference and do not come back until dawn. The panel also shows what tomorrow's dawn would grant at the current condition.

## Camp

Tiers skip 4. Food preservation is out of scope.

| Tier | Build | Cost | Effect |
| --- | --- | --- | --- |
| 0 Crash Site | — | — | Four cabin searches, partial night windbreak |
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

Sandstorm: 8% from day 3. Blocks leaving camp. Without a shelter it deals 8 health and 10 hydration at dawn and cuts 2 work hours.

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
