# Grid, Obstacles, Terrain & Line of Sight — PF2e Remastered

## Core distance rules

- 1 square = **5 feet**.
- Cells are integer coordinates `(x, y)`; `(0, 0)` is the top-left cell.
- A straight step costs **5 ft**.
- Diagonal steps alternate: **5 ft → 10 ft → 5 ft → 10 ft ...**
  - 1 diagonal = 5 ft
  - 2 diagonals = 15 ft
  - 3 diagonals = 20 ft
  - 4 diagonals = 30 ft
  - 5 diagonals = 35 ft
- All diagonal squares moved during a turn share one alternation. Straight steps do not reset the count. The count resets at the start of the creature's next turn.
- Closed form for an unobstructed square grid:

```text
dx = |x2 - x1|
dy = |y2 - y1|
diagonalCount = min(dx, dy)
straightCount = max(dx, dy) - diagonalCount

distance = straightCount * 5 + diagonalCount * 5 + floor(diagonalCount / 2) * 5
         = 5 * (max(dx, dy) + floor(min(dx, dy) / 2))
```

## Obstacles, map data, and difficult terrain

`src/Core/Grid/grid-map.js` provides `GridMap`:

| Method | Purpose |
|---|---|
| `new GridMap({ cols, rows, blocked, difficult })` | Build a map with walls and difficult terrain |
| `GridMap.fromAscii(rows, "#", { difficultChars: "~" })` | Build from ASCII art |
| `isInBounds(x, y)` | Bounds check |
| `hasObstacle(x, y)` | Static wall check |
| `hasDifficultTerrain(x, y)` | Difficult-terrain check |
| `isBlocked(x, y)` | True for walls **or** out-of-bounds cells |
| `setBlocked(x, y, boolean)` | Mutate the wall set |
| `setDifficultTerrain(x, y, boolean)` | Mutate the terrain set |
| `getBlockedCells()` | Sorted wall cells for rendering |
| `getDifficultTerrainCells()` | Sorted terrain cells for rendering |

**Difficult terrain:** entering a difficult square adds **5 ft** to the normal step cost
(`DIFFICULT_TERRAIN_EXTRA_FEET` in `grid-math.js`). The origin square of a move never
charges terrain. The extra cost applies on diagonals as well, after the normal 5-10-5
diagonal cost.

## Creature occupancy (alliances)

`src/Core/Grid/occupancy.js` converts combatants into two pathfinding sets:

| Set | Meaning | Pathfinding behaviour |
|---|---|---|
| `blockedCells` | Hostile combatants | Impassable |
| `passThroughCells` | Allied combatants | Traversable, but not a valid destination |

`buildOccupancy(combatants, mover)` compares `Combatant.alliance` (`player` / `enemy`).
Moving through an ally is allowed at normal cost; ending a move on an ally fails with
`goal-occupied` / `destination-occupied`. Enemy squares are omitted from reachable-cell
highlights and block routes entirely.

Creature occupancy does **not** feed the diagonal corner rule. Only solid map obstacles
affect corner cutting, so a body in a corner cell is not treated as a wall.

## Pathfinding

`src/Core/Grid/pathfinding.js` implements A* over the state space **(cell, diagonalParity)**.
The parity is required because the next diagonal step costs 5 ft when `diagonalSteps % 2 === 0`
and 10 ft when it is odd.

Heuristic (admissible and consistent; terrain only increases real edge costs):

```text
h = 5 * (max(dx, dy) - min(dx, dy))
  + 5 * min(dx, dy)
  + 5 * floor((min(dx, dy) + parity) / 2)
```

API:

- `findPath(start, goal, { map, startDiagonalParity, diagonalCornerPolicy, occupancy })`
  - Returns `{ found: true, path, costFeet, diagonalSteps, diagonalParity }` or
    `{ found: false, reason }`.
  - Reasons: `out-of-bounds`, `blocked-start`, `blocked-goal`, `goal-occupied`, `no-path`.
- `reachableCells(map, origin, maxFeet, { startDiagonalParity, diagonalCornerPolicy, occupancy })`
  - Dijkstra over the same state space; returns `{ x, y, costFeet }` cells within budget,
    excluding the origin and any ally-occupied destination.

## Diagonal corner-cut policy — canonical `block-any`

PF2e Remastered tactical movement forbids cutting a solid obstacle corner. In cell terms:

- `(x, y) → (x+1, y+1)` is allowed **only if both** `(x+1, y)` and `(x, y+1)` are free.
- If either orthogonal side cell is a wall, the diagonal is forbidden.
- Passing through the joint between two touching obstacle corners is forbidden.

The engine default and the application default are **`block-any`**. `allow` and
`block-both` remain available for experiments, but `block-any` is the canonical project rule.

## Line of sight

`src/Core/Grid/los-math.js` casts a centre-to-centre ray between two cells and collects
every cell it touches:

- `lineCells(from, to)` — conservative supercover cell list.
- `traceLineOfSight(from, to, map)` — `{ visible, blockedBy, blockedCells, cells }`.
- `hasLineOfSight(from, to, map)` — boolean.

A ray that passes exactly through a grid vertex also touches the two orthogonal cells at
that vertex. If any touched cell is a solid obstacle, sight is blocked. This is consistent
with the canonical `block-any` movement policy. Creature occupancy and cover degrees are
not part of the line-of-sight calculation yet.

## Acceptance tests

`tests/Grid/` and `tests/Actions/` cover:

- straight/diagonal/mixed distance and cumulative 5-10-5;
- A* around walls, through gaps, and around obstacles;
- terrain cost accumulation and reachable-cell budgets;
- ally pass-through, ally destination rejection, enemy blocking;
- line-of-sight rays, corner-touch blocking, and wall occlusion;
- Step validation (adjacency, terrain, occupancy, corners, action cost);
- Strike reach, LoS, alliance check, action spending, and d20 reporting.

Run with `npm test`, `node tests/run-node.js`, or open `test_runner.html`.
