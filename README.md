[![token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/0xberuuu/token-radar-board/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/0xberuuu/token-radar-board/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

# Token Value Radar

An entry for the [make.fun token-radar-01 bounty](https://make.fun/bounty/token-radar-01): a radar that finds
protocols whose token does not exist yet, ranks them by an implied value, and shows a reader how to farm each one.

## What it does

`main.ts` reads the sealed DefiLlama snapshot (`/input/snapshot.json`: 758 protocols, 40 on the house watchlist),
scores every protocol that records no token, and writes:

- `board.json` — 198 ranked rows: every watchlist slug plus 158 early finds below the watchlist floor, each with
  an implied value and a six-step farm plan.
- `data.js` — the same board as the dashboard's dataset, so the page runs with no network.
- `dashboard/` — a static page: the sortable, filterable board, a detail view for every protocol with the
  model's own arithmetic and the farm plan, a live-token tab, and a model explainer.
- `screenshots/` — three real renders of the dashboard: the board, a detail view, and a filtered view.
- `dossier.json` — built with the vendored make.fun library, byte for byte what the scorer rebuilds.

## The value model (version `tvr-1`)

Every implied value follows from the snapshot's own figures — TVL, 7-day change, age, and chain count — through
one formula, applied to every protocol alike. No name is ever special-cased:

```
base      = tvl_usd × 0.30
growth    = clamp(change_7d, −50, +100) per cent
growth ×  = 1 + (growth / 100) × 0.6
maturity  = 0.7 + min(age_days, 730) / 730 × 0.3
breadth   = 1 + min(chains − 1, 4) × 0.05
implied   = max(1, round(base × growth × maturity × breadth))
```

Age is the days from `listed_at` to the snapshot date (365 assumed when unlisted). The board keeps protocols
whose token already trades apart, in the live tab, shown with the market's own value. Wrapped, staked, and
bridged products of tokens that already trade (WBTC, bridged stablecoins, exchange products) are left off the
ranked board, following the watchlist's own hygiene: they are no protocol waiting on a launch of its own.

Farm plans are generated from each protocol's own record — category, chains, TVL, and age — with concrete
steps, what each step costs (gas sized to the protocol's main chain), and how long it takes.

## Honesty note

"Records no token" means the snapshot records none; a protocol may still have a token its record does not
carry. An implied value is this radar's own claim, never a prediction that a token issues, or when, and never
financial advice.

## Run it locally

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <path-to>/snapshot.json
```

Node 22.18 or later, standard library only. The program is deterministic: two runs write the same bytes.
