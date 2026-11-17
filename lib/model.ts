// Token Value Radar: the model behind the board.
//
// One sealed snapshot in, one ranked board out. The board ranks protocols that
// record no token yet, by the implied value a token would carry if the
// protocol's record stayed as it is. Protocols whose token already trades are
// kept apart in the live set and shown with the market's own value, never
// mixed into the ranked board.
//
// Implied value is computed only from the snapshot's own figures. For one
// protocol:
//
//   base      = tvl_usd x TVL_MULTIPLE
//   growth    = clamp(change_7d, GROWTH_MIN, GROWTH_MAX)          (per cent)
//   growthMul = 1 + (growth / 100) x GROWTH_WEIGHT
//   age       = days from listed_at to as_of (UNKNOWN_AGE_DAYS when unlisted)
//   maturity  = MATURITY_BASE + min(age, MATURITY_CAP_DAYS)
//               / MATURITY_CAP_DAYS x MATURITY_SPAN
//   breadth   = 1 + min(chains - 1, BREADTH_MAX_EXTRA) x BREADTH_PER_CHAIN
//   implied   = max(1, round(base x growthMul x maturity x breadth))
//
// No protocol name is ever special-cased: the same function scores every row,
// and the dashboard states the constants so a reader can recompute any row.

/** One protocol entry: exactly the ten fields the sealed snapshot carries. */
export interface Protocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole sealed snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: Protocol[];
  watchlist: string[];
}

/** The model's constants, stated in the dashboard so any row can be recomputed. */
export interface ModelConstants {
  tvl_multiple: number;
  growth_weight: number;
  growth_min: number;
  growth_max: number;
  maturity_base: number;
  maturity_span: number;
  maturity_cap_days: number;
  unknown_age_days: number;
  breadth_per_chain: number;
  breadth_max_extra: number;
}

export const MODEL: ModelConstants = {
  tvl_multiple: 0.3,
  growth_weight: 0.6,
  growth_min: -50,
  growth_max: 100,
  maturity_base: 0.7,
  maturity_span: 0.3,
  maturity_cap_days: 730,
  unknown_age_days: 365,
  breadth_per_chain: 0.05,
  breadth_max_extra: 4,
};

/** The model's version label, shown in the dashboard and carried in board.json. */
export const MODEL_VERSION = 'tvr-1';

/** How many live-token protocols the Live tab carries, by market cap. */
export const LIVE_COUNT = 24;

/** One row of board.json. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  on_watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  model: {
    version: string;
    tvl_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    breadth_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** A live-token protocol for the dashboard's Live tab: the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs, written to data.js beside the page. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  protocols_scanned: number;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: BoardRow[];
  live: LiveRow[];
}

/** Why a snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;
const VERSIONED_NAME = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
/** Categories that name a wrapped, staked or bridged product, not a launch of its own. */
const PRODUCT_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
/** Exchange names: a protocol beginning with one is that exchange's product, not a launch of its own. */
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/i;

/** A finite number, else the fallback. */
function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Whole days from `listedAt` to `asOf`, clamped at zero; null when either is absent or bad. */
export function ageInDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Whether the snapshot records no token at all for this protocol. */
export function isPreToken(p: Protocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/**
 * Whether the board may rank a protocol: pre-token, not an exchange product,
 * not a wrapped, staked or bridged product of a token that already trades, and
 * not a versioned pool of another protocol. The watchlist's own hygiene,
 * applied to the early rows the radar adds below the floor: WBTC is Bitcoin
 * on Ethereum and a bridged stablecoin is no protocol waiting on a launch.
 */
export function isRankable(p: Protocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && PRODUCT_CATEGORIES.has(p.category)) return false;
  if (VERSIONED_NAME.test(p.name) || WRAPPED_WORD.test(p.name) || EXCHANGE_PREFIX.test(p.name)) return false;
  return true;
}

/** The score of one protocol under the model: every multiplier, stated. */
export function scoreProtocol(
  p: Protocol,
  asOf: string,
  model: ModelConstants,
): { implied: number; growthPct: number; growthMult: number; maturityMult: number; breadthMult: number; age: number | null } {
  const age = ageInDays(asOf, p.listed_at);
  const growthPct = Math.min(model.growth_max, Math.max(model.growth_min, num(p.change_7d, 0)));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult =
    model.maturity_base + (Math.min(Math.max(ageForModel, 0), model.maturity_cap_days) / model.maturity_cap_days) * model.maturity_span;
  const breadthMult = 1 + Math.min(Math.max(p.chains.length - 1, 0), model.breadth_max_extra) * model.breadth_per_chain;
  const implied = Math.max(1, Math.round(p.tvl_usd * model.tvl_multiple * growthMult * maturityMult * breadthMult));
  return { implied, growthPct, growthMult, maturityMult, breadthMult, age };
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** The ranked board: every watchlist slug, plus every other rankable pre-token protocol. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const chosen = new Map<string, Protocol>();
  // The watchlist is the floor: every slug it names is on the board.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: every other rankable pre-token protocol, whatever its size.
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isRankable(p)) chosen.set(p.slug, p);
  }
  const watch = new Set(snapshot.watchlist);
  const scored = [...chosen.values()].map((p) => ({ p, s: scoreProtocol(p, snapshot.as_of, model) }));
  scored.sort((a, b) => b.s.implied - a.s.implied || b.p.tvl_usd - a.p.tvl_usd || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map(({ p, s }, i) => ({
    rank: i + 1,
    slug: p.slug,
    name: p.name,
    category: p.category,
    chains: p.chains,
    tvl_usd: p.tvl_usd,
    change_7d: p.change_7d,
    mcap_usd: p.mcap_usd,
    listed_at: p.listed_at,
    gecko_id: p.gecko_id,
    symbol: p.symbol,
    token_status: 'pre-token',
    on_watchlist: watch.has(p.slug),
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      version: MODEL_VERSION,
      tvl_multiple: model.tvl_multiple,
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      breadth_multiplier: round4(s.breadthMult),
      age_days: s.age,
    },
    farm_steps: farmPlan(p, s.age),
  }));
}

/** The live-token protocols, by market cap, for the dashboard's Live tab. */
export function liveSet(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => num(b.mcap_usd, 0) - num(a.mcap_usd, 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_COUNT)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

// ---------------------------------------------------------------- farm plans

/** A typical single-transaction gas cost in dollars, by chain, as the plan states it. */
const GAS_USD: Record<string, number> = {
  Ethereum: 4,
  Arbitrum: 0.25,
  Base: 0.08,
  Optimism: 0.12,
  Solana: 0.02,
  Avalanche: 0.15,
  Polygon: 0.05,
  Binance: 0.1,
  Bitcoin: 2,
  Tron: 0.5,
  Linea: 0.1,
  Monad: 0.05,
  'Hyperliquid L1': 0.05,
  Plasma: 0.1,
  'Robinhood Chain': 0.1,
  Gnosis: 0.05,
  Fantom: 0.05,
  zkSync: 0.15,
  Scroll: 0.1,
  Blast: 0.08,
  Berachain: 0.05,
  Sui: 0.02,
  Aptos: 0.02,
  Near: 0.02,
  Cosmos: 0.05,
  Sei: 0.02,
  Injective: 0.02,
  Mantle: 0.08,
  Mode: 0.05,
  Fraxtal: 0.05,
  Unichain: 0.05,
  Sonic: 0.05,
  Abstract: 0.05,
  HyperEVM: 0.05,
};

const DEFAULT_GAS_USD = 0.5;

/** The first chain the protocol names, or a neutral phrase when it names none. */
function mainChain(p: Protocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** Gas for one transaction on the protocol's main chain, formatted for a plan step. */
function gasCost(p: Protocol): string {
  const chain = mainChain(p);
  const g = GAS_USD[chain] ?? DEFAULT_GAS_USD;
  return g < 1 ? `$${g.toFixed(2)}` : `$${g.toFixed(0)}`;
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: Protocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 500;
  if (p.tvl_usd >= 1_000_000_000) return 250;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 90) return 90;
  if (age < 365) return 60;
  return 30;
}

/** The category's main farming action, in words a farmer can follow. */
function mainAction(p: Protocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) {
    return `Lend $${capital} of USDC into ${name}'s ${chain} market and leave the deposit earning.`;
  }
  if (c.includes('dex') || c.includes('amm') || c.includes('liquidity manager')) {
    return `Add $${capital} of liquidity to ${name}'s deepest ${chain} pool and hold the LP position.`;
  }
  if (c.includes('yield') || c.includes('vault') || c.includes('curator') || c.includes('allocator') || c.includes('farm')) {
    return `Deposit $${capital} into ${name}'s ${chain} vault and hold the receipt tokens in the same wallet.`;
  }
  if (c.includes('bridge')) {
    return `Bridge $${capital} of stablecoins through ${name} onto ${chain}, then use the funds in the destination app.`;
  }
  if (c.includes('stak') || c.includes('restak')) {
    return `Stake $${capital} through ${name} on ${chain} and keep the staking receipt in the farming wallet.`;
  }
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options') || c.includes('basis')) {
    return `Post $${capital} of USDC as margin on ${name} and open one small hedged position.`;
  }
  if (c.includes('prediction')) {
    return `Fund the wallet with $${capital} and take one position in an active ${name} market.`;
  }
  if (c.includes('rwa')) {
    return `Mint $${capital} of ${name}'s tokenized asset on ${chain} and hold it in the farming wallet.`;
  }
  if (c.includes('insurance')) {
    return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active.`;
  }
  if (c.includes('stable')) {
    return `Mint or hold $${capital} of ${name}'s stable asset on ${chain}.`;
  }
  if (c.includes('payment') || c.includes('card')) {
    return `Route $${capital} of spending through ${name} on ${chain} and keep the receipts.`;
  }
  if (c.includes('privacy')) {
    return `Shield $${capital} through ${name}'s private pool on ${chain} and keep the notes safe.`;
  }
  if (c.includes('index')) {
    return `Buy $${capital} of the ${name} index token on ${chain} and hold it.`;
  }
  if (c.includes('chain')) {
    return `Bridge $${capital} to the chain and use ${name}'s native app: one swap and one stake.`;
  }
  if (c.includes('otc')) {
    return `Complete one $${capital} OTC trade through ${name} on ${chain} and keep the settlement record.`;
  }
  return `Put $${capital} to work in ${name}'s main ${chain} product and keep the position open.`;
}

/**
 * One protocol's farm plan: six steps, each an action with a cost and a time.
 * Every step is derived from the protocol's own record (category, chains,
 * TVL, age), never from a hand-written list of names.
 */
export function farmPlan(p: Protocol, age: number | null): string[] {
  const chain = mainChain(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = gasCost(p);
  const steps: Array<{ text: string; cost: string; time: string }> = [
    {
      text: 'Set up a fresh wallet that holds only the funds you plan to farm, and store its seed phrase offline where no one else can read it.',
      cost: `no cost to create; first gas about ${gas} on ${chain}`,
      time: '5 minutes',
    },
    {
      text: mainAction(p, capital, chain),
      cost: `$${capital} of capital plus about ${gas} of gas on ${chain}`,
      time: '10 to 20 minutes to set up',
    },
    {
      text: 'Do one qualifying action every week: a deposit, a swap, a vote, or a claim on the protocol, so the wallet shows repeat activity.',
      cost: `about ${gas} of gas a week on ${chain}`,
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity lands in more than one snapshot window.`,
      cost: `the $${capital} stays in the position for the whole hold`,
      time: `${hold} days`,
    },
    {
      text: 'Before withdrawing, open the protocol\u2019s own points or rewards page from its official channel and claim only from the link it publishes.',
      cost: 'free to check; never pay anyone to claim',
      time: '10 minutes',
    },
    {
      text: 'Log the wallet address, the dates, and every transaction hash, and plan the exit: check unstaking or unlock windows before you unwind.',
      cost: 'one more gas payment to exit',
      time: '5 minutes to log',
    },
  ];
  return steps.map((s) => {
    let line = `${s.text} Cost: ${s.cost}. Time: ${s.time}.`;
    if (line.length > 600) line = `${line.slice(0, 596)}...`;
    if (line.length < 20) line = `${line} Keep the position open and recheck the protocol's own page.`;
    return line;
  });
}

// ---------------------------------------------------------------- snapshot

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) {
    throw new SnapshotError('snapshot.json has no floor_usd');
  }
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) {
    throw new SnapshotError('snapshot.json has no watchlist of slugs');
  }
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

/** Why a board is not one the gate will take, or null when it is sound. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `the board holds ${board.length} rows, outside 100..4000`;
  const slugs = new Set(board.map((r) => r.slug));
  if (slugs.size !== board.length) return 'the board repeats a slug';
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) {
    if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  }
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return 'every row shares the same implied value: a board that ranks nothing by value is not a ranking';
  }
  for (const r of board) {
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 100_000_000_000_000) {
      return `${r.slug} has implied value ${r.implied_value_usd}`;
    }
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} characters`;
    }
  }
  return null;
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveSet(snapshot);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    protocols_scanned: snapshot.protocols.length,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: board.filter((r) => !r.on_watchlist).length,
    live_size: live.length,
    rows: board,
    live,
  };
  return { board, radar };
}

/** The dashboard's dataset as one script: window.RADAR, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
