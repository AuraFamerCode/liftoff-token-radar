/**
 * Lift-off: Token Launch Radar Valuation & Readiness Engine
 * 
 * Model Design Philosophy:
 * Traditional crypto valuation often leans on flat TVL multiples or arbitrary rules of thumb.
 * We reject that: a dollar of TVL in a cross-chain bridge does not command the same market
 * multiple as a dollar locked in an automated market maker or an over-collateralized lending pool.
 * Instead, we calibrate expectations directly against the snapshot's own trading reality:
 * 
 * 1. Category-Relative Ground Truth:
 *    We derive peer multiples (mcap_usd / tvl_usd) exclusively from live tokenized protocols within
 *    the same category. Outliers outside [0.02, 12] are pruned to discard mis-tagged assets or broken
 *    share wrappers. For thin categories, we shrink the sample median toward the global cross-category
 *    median using an empirical Bayes shrinkage factor (K = 4), ensuring small cohorts do not produce
 *    wild extrapolations.
 * 
 * 2. Capped Growth Velocity:
 *    Recent 7-day momentum tilts implied valuation, but is strictly constrained within [-50%, +100%]
 *    with a 30% weighting. A protocol doubling TVL in a week earns a modest 30% valuation bump; a protocol
 *    bleeding TVL is penalized, but neither can distort fundamental scale.
 * 
 * 3. Track Record & Seasoning:
 *    A project operating quietly for two or three years without issuing a token has proven protocol-market
 *    fit and battle-tested smart contract reliability far beyond a month-old fork. We reward maturity
 *    monotonically up to a 4-year plateau (0.70 base up to 1.00 at 1,460 days).
 * 
 * 4. Chain Breadth & Distribution:
 *    Multi-chain footprint expands the addressable user base and diversifies infrastructure risk, adding
 *    up to 12% across 5+ chains.
 * 
 * 5. Independent Launch Readiness:
 *    Implied value reflects what a token should trade at; Launch Readiness measures how close the project
 *    is to actually executing a token event. We separate the two completely: age, momentum, absolute scale,
 *    deployment breadth, and economic fee capture combine into a clean 0..100 readiness index.
 */

// --- Types & Interfaces ---

export interface SnapshotProtocol {
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

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

export interface ModelConstants {
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  breadth_step: number;
  breadth_cap_chains: number;
  bench_shrink: number;
  bench_floor: number;
  bench_cap: number;
  ratio_low: number;
  ratio_high: number;
  early_rows: number;
  live_rows: number;
}

export const MODEL: ModelConstants = {
  growth_weight: 0.30,
  growth_floor: -50,
  growth_cap: 100,
  maturity_floor: 0.70,
  maturity_range: 0.30,
  maturity_days: 1460,
  unknown_age_days: 365,
  breadth_step: 0.03,
  breadth_cap_chains: 4,
  bench_shrink: 4,
  bench_floor: 0.05,
  bench_cap: 3.5,
  ratio_low: 0.02,
  ratio_high: 12,
  early_rows: 2000,
  live_rows: 40,
};

export const MODEL_VERSION = 'lift-off-1';

export interface CategoryBench {
  category: string;
  peers: number;
  median_ratio: number | null;
  q1: number | null;
  q3: number | null;
  benchmark: number;
  benchmark_low?: number;
  benchmark_high?: number;
  source: 'category' | 'global';
  basis: 'category' | 'sector' | 'global';
  sector: string;
  peer_names: string[];
}

export interface ImpliedBreakdown {
  bench: number;
  bench_source: 'category' | 'sector' | 'global';
  peers: number;
  median_ratio: number | null;
  growth_pct: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  breadth_multiplier: number;
  age_days: number | null;
  formula: string;
}

export interface ReadinessParts {
  track_record: number;
  growth: number;
  scale: number;
  distribution: number;
  fee_engine: number;
}

export interface Readiness {
  score: number;
  parts: ReadinessParts;
  weights: {
    track_record: number;
    growth: number;
    scale: number;
    distribution: number;
    fee_engine: number;
  };
}

export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  value_low_usd: number;
  value_high_usd: number;
  confidence: 'high' | 'medium' | 'low';
  implied_multiple: number;
  token_status: 'pre-token';
  tier: 'watchlist' | 'early';
  why: string;
  readiness: Readiness;
  model: ImpliedBreakdown;
  farm_steps: string[];
}

export interface RadarRow extends Omit<BoardRow, 'model' | 'readiness'> {}

export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number;
  ratio: number;
}

export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  generated_by: string;
  watchlist_size: number;
  watchlist_covered: number;
  pre_token_total: number;
  board_size: number;
  early_size: number;
  live_size: number;
  categories: string[];
  chains: string[];
  benchmarks: CategoryBench[];
  rows: RadarRow[];
  live: LiveRow[];
}

// --- Internal Helper Functions ---

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function usd(n: number): string {
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  if (abs >= 1e9) {
    const val = (abs / 1e9).toFixed(2).replace(/\.?0+$/, '');
    return `${sign}$${val}B`;
  }
  if (abs >= 1e6) {
    const val = (abs / 1e6).toFixed(1).replace(/\.?0+$/, '');
    return `${sign}$${val}M`;
  }
  if (abs >= 1e3) {
    return `${sign}$${Math.round(abs / 1e3)}K`;
  }
  return `${sign}$${Math.round(abs)}`;
}

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

function quantile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const pos = (sorted.length - 1) * p;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (base + 1 < sorted.length) {
    return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
  }
  return sorted[base];
}

export function categoryToSector(category: string | null): string {
  if (!category) return 'OTHER';
  const c = category.toLowerCase();
  if (c.includes('dex') || c.includes('swap') || c.includes('amm')) return 'DEX';
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral') || c.includes('credit')) return 'LENDING';
  if (c.includes('yield') || c.includes('vault') || c.includes('curator') || c.includes('allocator') || c.includes('aggregator') || c.includes('basis')) return 'YIELD';
  if (c.includes('rwa') || c.includes('real world')) return 'RWA';
  if (c.includes('bridge')) return 'BRIDGE';
  if (c.includes('stak') || c.includes('restak')) return 'STAKING';
  if (c.includes('chain') || c.includes('rollup') || c.includes('l2')) return 'CHAIN';
  if (c.includes('perpetual') || c.includes('derivative')) return 'PERPS';
  if (c.includes('stable')) return 'STABLECOIN';
  if (c.includes('insurance')) return 'INSURANCE';
  if (c.includes('payment')) return 'PAYMENTS';
  return 'OTHER';
}

function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

const EXCLUDED_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Cross Chain Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'Stablecoin Wrapper',
  'CEX',
]);

const VERSION_MARKER = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_STAKED = /\b(wrapped|staked|staking)\b/i;
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/i;

/** Whether a pre-token protocol is a launch candidate at all (the watchlist's own exclusions). */
export function isLaunchCandidate(p: SnapshotProtocol): boolean {
  if (VERSION_MARKER.test(p.name)) return false;
  if (p.category && EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (WRAPPED_STAKED.test(p.name)) return false;
  if (EXCHANGE_PREFIX.test(p.name)) return false;
  return true;
}

function whyProtocol(p: SnapshotProtocol, asOf: string): string {
  const parts: string[] = [];
  parts.push(`${usd(p.tvl_usd)} of TVL`);
  const age = ageDays(asOf, p.listed_at);
  if (age !== null) {
    const months = Math.round(age / 30.4);
    if (months >= 1) {
      parts.push(`${months} month${months === 1 ? '' : 's'} with no token`);
    } else {
      parts.push(`${age} day${age === 1 ? '' : 's'} with no token`);
    }
  } else {
    parts.push('established tenure with no token');
  }
  if (p.change_7d !== null) {
    const sign = p.change_7d > 0 ? '+' : '';
    parts.push(`${sign}${p.change_7d.toFixed(1)}% on the week`);
  }
  let s = parts.join(', ');
  if (s.length > 140) s = s.slice(0, 140);
  return s;
}

// --- Public Core API ---

/**
 * Parses snapshot JSON string and performs schema validation.
 */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw new SnapshotError(`Failed to parse snapshot JSON: ${(err as Error).message}`);
  }

  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new SnapshotError('Snapshot root must be an object');
  }

  const obj = raw as Record<string, unknown>;

  if (typeof obj.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(obj.as_of)) {
    throw new SnapshotError('Snapshot field "as_of" must be a valid YYYY-MM-DD date string');
  }

  if (typeof obj.source !== 'string' || obj.source.trim().length === 0) {
    throw new SnapshotError('Snapshot field "source" must be a non-empty string');
  }

  if (typeof obj.floor_usd !== 'number' || !Number.isSafeInteger(obj.floor_usd) || obj.floor_usd <= 0) {
    throw new SnapshotError('Snapshot field "floor_usd" must be a positive safe integer');
  }

  if (!Array.isArray(obj.protocols)) {
    throw new SnapshotError('Snapshot field "protocols" must be an array');
  }

  if (!Array.isArray(obj.watchlist)) {
    throw new SnapshotError('Snapshot field "watchlist" must be an array');
  }

  const watchlist: string[] = [];
  for (let i = 0; i < obj.watchlist.length; i++) {
    const item = obj.watchlist[i];
    if (typeof item !== 'string' || item.trim().length === 0) {
      throw new SnapshotError(`Watchlist item at index ${i} must be a non-empty string`);
    }
    watchlist.push(item);
  }

  const protocols: SnapshotProtocol[] = [];
  for (let i = 0; i < obj.protocols.length; i++) {
    const p = obj.protocols[i];
    if (typeof p !== 'object' || p === null || Array.isArray(p)) {
      throw new SnapshotError(`Protocol at index ${i} must be an object`);
    }
    const pr = p as Record<string, unknown>;

    if (typeof pr.slug !== 'string' || pr.slug.trim().length === 0) {
      throw new SnapshotError(`Protocol at index ${i} has invalid or missing "slug"`);
    }
    if (typeof pr.name !== 'string' || pr.name.trim().length === 0) {
      throw new SnapshotError(`Protocol "${pr.slug}" has invalid or missing "name"`);
    }
    if (typeof pr.tvl_usd !== 'number' || !Number.isFinite(pr.tvl_usd)) {
      throw new SnapshotError(`Protocol "${pr.slug}" has non-finite "tvl_usd"`);
    }

    const chains: string[] = [];
    if (Array.isArray(pr.chains)) {
      for (const c of pr.chains) {
        if (typeof c === 'string' && c.trim().length > 0) chains.push(c);
      }
    }

    protocols.push({
      slug: pr.slug,
      name: pr.name,
      category: typeof pr.category === 'string' && pr.category.trim().length > 0 ? pr.category : null,
      chains,
      tvl_usd: pr.tvl_usd,
      change_7d: typeof pr.change_7d === 'number' && Number.isFinite(pr.change_7d) ? pr.change_7d : null,
      mcap_usd: typeof pr.mcap_usd === 'number' && Number.isFinite(pr.mcap_usd) ? pr.mcap_usd : null,
      listed_at: typeof pr.listed_at === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(pr.listed_at) ? pr.listed_at : null,
      gecko_id: typeof pr.gecko_id === 'string' && pr.gecko_id.trim().length > 0 ? pr.gecko_id : null,
      symbol: typeof pr.symbol === 'string' && pr.symbol.trim().length > 0 ? pr.symbol : null,
    });
  }

  return {
    as_of: obj.as_of,
    source: obj.source,
    floor_usd: obj.floor_usd,
    protocols,
    watchlist,
  };
}

/**
 * Calculates day difference between snapshot asOf and protocol listedAt date in UTC.
 */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (!listedAt) return null;
  const asOfMs = Date.parse(`${asOf}T00:00:00Z`);
  const listedMs = Date.parse(`${listedAt}T00:00:00Z`);
  if (isNaN(asOfMs) || isNaN(listedMs)) return null;
  const diff = Math.floor((asOfMs - listedMs) / 86400000);
  return Math.max(0, diff);
}

/**
 * Computes category valuation benchmarks from tokenized peers in the snapshot.
 */
export function categoryBenchmarks(snapshot: Snapshot, model: ModelConstants = MODEL): CategoryBench[] {
  // 1. Identify valid tokenized peers
  interface TokenPeer {
    protocol: SnapshotProtocol;
    ratio: number;
  }
  const validPeers: TokenPeer[] = [];
  for (const p of snapshot.protocols) {
    if (p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0) {
      const ratio = p.mcap_usd / p.tvl_usd;
      if (ratio >= model.ratio_low && ratio <= model.ratio_high) {
        validPeers.push({ protocol: p, ratio });
      }
    }
  }

  const allRatios = validPeers.map(p => p.ratio).sort((a, b) => a - b);
  const globalMed = median(allRatios);
  const clampedGlobal = clamp(globalMed, model.bench_floor, model.bench_cap);

  // Group peers by sector
  const sectorPeersMap = new Map<string, TokenPeer[]>();
  for (const item of validPeers) {
    const sec = categoryToSector(item.protocol.category);
    let list = sectorPeersMap.get(sec);
    if (!list) {
      list = [];
      sectorPeersMap.set(sec, list);
    }
    list.push(item);
  }

  // Compute sector benchmarks
  const sectorBenchMap = new Map<string, number>();
  const ALL_SECTORS = ['DEX', 'LENDING', 'YIELD', 'RWA', 'BRIDGE', 'STAKING', 'CHAIN', 'PERPS', 'STABLECOIN', 'INSURANCE', 'PAYMENTS', 'OTHER'];
  for (const sec of ALL_SECTORS) {
    const sPeers = sectorPeersMap.get(sec) || [];
    const sn = sPeers.length;
    if (sn > 0) {
      const sMed = median(sPeers.map(p => p.ratio));
      const sRaw = (sn * sMed + model.bench_shrink * globalMed) / (sn + model.bench_shrink);
      sectorBenchMap.set(sec, clamp(sRaw, model.bench_floor, model.bench_cap));
    } else {
      sectorBenchMap.set(sec, clampedGlobal);
    }
  }

  // Group peers by category
  const peersByCat = new Map<string, TokenPeer[]>();
  for (const item of validPeers) {
    const cat = item.protocol.category || 'Uncategorized';
    let list = peersByCat.get(cat);
    if (!list) {
      list = [];
      peersByCat.set(cat, list);
    }
    list.push(item);
  }

  // Gather all unique categories present in the snapshot protocols
  const allCategories = new Set<string>();
  for (const p of snapshot.protocols) {
    if (p.category) allCategories.add(p.category);
  }

  const results: CategoryBench[] = [];

  for (const cat of allCategories) {
    const peers = peersByCat.get(cat) || [];
    const sec = categoryToSector(cat);
    const secBench = sectorBenchMap.get(sec) ?? clampedGlobal;
    const n = peers.length;

    let benchmark: number;
    let basis: 'category' | 'sector' | 'global';
    let catMed: number | null = null;
    let q1: number | null = null;
    let q3: number | null = null;
    let benchLow: number;
    let benchHigh: number;

    if (n >= 3) {
      const catRatios = peers.map(p => p.ratio).sort((a, b) => a - b);
      catMed = median(catRatios);
      const rawBench = (n * catMed + model.bench_shrink * globalMed) / (n + model.bench_shrink);
      benchmark = clamp(rawBench, model.bench_floor, model.bench_cap);
      basis = 'category';
      q1 = quantile(catRatios, 0.25);
      q3 = quantile(catRatios, 0.75);
      benchLow = clamp((n * q1 + model.bench_shrink * globalMed) / (n + model.bench_shrink), model.bench_floor, model.bench_cap);
      benchHigh = clamp((n * q3 + model.bench_shrink * globalMed) / (n + model.bench_shrink), model.bench_floor, model.bench_cap);
    } else if (n > 0) {
      const catRatios = peers.map(p => p.ratio).sort((a, b) => a - b);
      catMed = median(catRatios);
      const rawBench = (n * catMed + 3 * secBench) / (n + 3);
      benchmark = clamp(rawBench, model.bench_floor, model.bench_cap);
      basis = 'sector';
      if (n >= 2) {
        q1 = quantile(catRatios, 0.25);
        q3 = quantile(catRatios, 0.75);
        benchLow = clamp((n * q1 + 3 * secBench) / (n + 3), model.bench_floor, model.bench_cap);
        benchHigh = clamp((n * q3 + 3 * secBench) / (n + 3), model.bench_floor, model.bench_cap);
      } else {
        benchLow = benchmark * 0.6;
        benchHigh = benchmark * 1.6;
      }
    } else {
      benchmark = secBench;
      const sPeersCount = (sectorPeersMap.get(sec) || []).length;
      basis = sPeersCount > 0 ? 'sector' : 'global';
      benchLow = benchmark * 0.6;
      benchHigh = benchmark * 1.6;
    }

    const topPeers = [...peers]
      .sort((a, b) => (b.protocol.mcap_usd ?? 0) - (a.protocol.mcap_usd ?? 0))
      .slice(0, 6)
      .map(p => p.protocol.name);

    results.push({
      category: cat,
      peers: n,
      median_ratio: catMed !== null ? Math.round(catMed * 10000) / 10000 : null,
      q1: q1 !== null ? Math.round(q1 * 10000) / 10000 : null,
      q3: q3 !== null ? Math.round(q3 * 10000) / 10000 : null,
      benchmark: Math.round(benchmark * 10000) / 10000,
      benchmark_low: Math.round(benchLow * 10000) / 10000,
      benchmark_high: Math.round(benchHigh * 10000) / 10000,
      source: basis === 'global' ? 'global' : 'category',
      basis,
      sector: sec,
      peer_names: topPeers,
    });
  }

  // Sort by peers desc then category asc
  results.sort((a, b) => {
    if (b.peers !== a.peers) return b.peers - a.peers;
    return a.category < b.category ? -1 : a.category > b.category ? 1 : 0;
  });

  // Global benchmark entry '*'
  const topGlobalPeers = [...validPeers]
    .sort((a, b) => (b.protocol.mcap_usd ?? 0) - (a.protocol.mcap_usd ?? 0))
    .slice(0, 6)
    .map(p => p.protocol.name);

  const globalQ1 = validPeers.length >= 2 ? quantile(allRatios, 0.25) : null;
  const globalQ3 = validPeers.length >= 2 ? quantile(allRatios, 0.75) : null;

  const globalEntry: CategoryBench = {
    category: '*',
    peers: validPeers.length,
    median_ratio: Math.round(globalMed * 10000) / 10000,
    q1: globalQ1 !== null ? Math.round(globalQ1 * 10000) / 10000 : null,
    q3: globalQ3 !== null ? Math.round(globalQ3 * 10000) / 10000 : null,
    benchmark: Math.round(clampedGlobal * 10000) / 10000,
    benchmark_low: globalQ1 !== null ? Math.round(clamp(globalQ1, model.bench_floor, model.bench_cap) * 10000) / 10000 : Math.round(clampedGlobal * 0.6 * 10000) / 10000,
    benchmark_high: globalQ3 !== null ? Math.round(clamp(globalQ3, model.bench_floor, model.bench_cap) * 10000) / 10000 : Math.round(clampedGlobal * 1.6 * 10000) / 10000,
    source: 'global',
    basis: 'global',
    sector: 'GLOBAL',
    peer_names: topGlobalPeers,
  };

  // Add global entry at the beginning
  return [globalEntry, ...results];
}

/**
 * Calculates the implied market valuation and derivation breakdown for a protocol.
 */
export function impliedValue(
  p: SnapshotProtocol,
  asOf: string,
  bench: CategoryBench,
  model: ModelConstants = MODEL
): { implied: number; value_low: number; value_high: number; confidence: 'high' | 'medium' | 'low'; breakdown: ImpliedBreakdown } {
  const g = clamp(p.change_7d ?? 0, model.growth_floor, model.growth_cap);
  const growthMultiplier = 1 + (g / 100) * model.growth_weight;

  const age = ageDays(asOf, p.listed_at);
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMultiplier =
    model.maturity_floor + (model.maturity_range * Math.min(ageForModel, model.maturity_days)) / model.maturity_days;

  const chainCount = p.chains ? p.chains.length : 1;
  const breadthMultiplier =
    1 + model.breadth_step * Math.min(Math.max(chainCount - 1, 0), model.breadth_cap_chains);

  const baseMultiplier = growthMultiplier * maturityMultiplier * breadthMultiplier;
  const rawImplied = p.tvl_usd * bench.benchmark * baseMultiplier;
  const implied = Math.max(1, Math.round(rawImplied));

  const benchLow = bench.benchmark_low ?? Math.round(bench.benchmark * 0.6 * 10000) / 10000;
  const benchHigh = bench.benchmark_high ?? Math.round(bench.benchmark * 1.6 * 10000) / 10000;

  let value_low = Math.max(1, Math.round(p.tvl_usd * benchLow * baseMultiplier));
  let value_high = Math.max(1, Math.round(p.tvl_usd * benchHigh * baseMultiplier));

  if (value_low > implied) value_low = implied;
  if (value_high < implied) value_high = implied;
  value_low = Math.max(1, Math.round(value_low));
  value_high = Math.max(value_low, Math.round(value_high));

  let confidence: 'high' | 'medium' | 'low';
  if (bench.peers >= 6) {
    confidence = 'high';
  } else if (bench.peers >= 3) {
    confidence = 'medium';
  } else {
    confidence = 'low';
  }

  const formula = `${usd(p.tvl_usd)} TVL x ${bench.benchmark.toFixed(2)} bench x ${growthMultiplier.toFixed(3)} growth x ${maturityMultiplier.toFixed(3)} maturity x ${breadthMultiplier.toFixed(2)} breadth`;

  const breakdown: ImpliedBreakdown = {
    bench: bench.benchmark,
    bench_source: bench.basis,
    peers: bench.peers,
    median_ratio: bench.median_ratio,
    growth_pct: g,
    growth_multiplier: Math.round(growthMultiplier * 10000) / 10000,
    maturity_multiplier: Math.round(maturityMultiplier * 10000) / 10000,
    breadth_multiplier: Math.round(breadthMultiplier * 10000) / 10000,
    age_days: age,
    formula,
  };

  return { implied, value_low, value_high, confidence, breakdown };
}

/**
 * Computes launch readiness score (0..100) across 5 independent dimensions.
 */
export function readiness(
  p: SnapshotProtocol,
  age: number | null,
  bench: CategoryBench,
  model: ModelConstants = MODEL
): Readiness {
  const weights = {
    track_record: 0.30,
    growth: 0.20,
    scale: 0.25,
    distribution: 0.15,
    fee_engine: 0.10,
  };

  const ageForReadiness = age ?? model.unknown_age_days;
  const track_record = Math.min(Math.max(ageForReadiness, 0), model.maturity_days) / model.maturity_days;

  const g = clamp(p.change_7d ?? 0, model.growth_floor, model.growth_cap);
  const growth = clamp((g + 30) / 60, 0, 1);

  const scale = Math.min(1, Math.max(0, p.tvl_usd / 1_000_000_000));
  const distribution = Math.min(1, Math.max(0, (p.chains ? p.chains.length : 1) / 4));

  const catLower = (p.category || '').toLowerCase();
  const highFeeKeywords = [
    'dex',
    'lending',
    'lend',
    'perpetual',
    'derivative',
    'yield',
    'curator',
    'cdp',
    'liquidity',
    'aggregator',
    'basis',
  ];
  const midFeeKeywords = ['rwa', 'chain', 'payments', 'governance', 'insurance', 'stable'];

  let fee_engine = 0.25;
  if (highFeeKeywords.some(k => catLower.includes(k))) {
    fee_engine = 1.0;
  } else if (midFeeKeywords.some(k => catLower.includes(k))) {
    fee_engine = 0.45;
  }

  const rawScore =
    100 *
    (track_record * weights.track_record +
      growth * weights.growth +
      scale * weights.scale +
      distribution * weights.distribution +
      fee_engine * weights.fee_engine);

  const score = clamp(Math.round(rawScore), 0, 100);

  return {
    score,
    parts: {
      track_record: Math.round(track_record * 1000) / 1000,
      growth: Math.round(growth * 1000) / 1000,
      scale: Math.round(scale * 1000) / 1000,
      distribution: Math.round(distribution * 1000) / 1000,
      fee_engine: Math.round(fee_engine * 1000) / 1000,
    },
    weights,
  };
}

/**
 * Generates actionable 6 to 8 farm steps tailored to protocol category, chain, momentum, and scale.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null, tier: 'watchlist' | 'early'): string[] {
  const chainCount = p.chains ? p.chains.length : 1;
  const primaryChain = p.chains && p.chains[0] ? p.chains[0] : 'Ethereum';
  const name = p.name;
  const sec = categoryToSector(p.category);

  const capital =
    p.tvl_usd >= 5_000_000_000
      ? '$500'
      : p.tvl_usd >= 1_000_000_000
      ? '$250'
      : p.tvl_usd >= 100_000_000
      ? '$100'
      : p.tvl_usd >= 20_000_000
      ? '$50'
      : '$25';

  const gasEst =
    chainCount <= 1
      ? '$3-$5 of gas'
      : chainCount <= 3
      ? '$8-$12 of gas across routes'
      : '$15-$25 of gas across multi-chain routes';

  // Step 1: Wallet isolation & funding
  let s1 = '';
  switch (sec) {
    case 'LENDING':
      s1 = `Configure a dedicated collateral management wallet on ${primaryChain} funded with sufficient reserve gas.`;
      break;
    case 'DEX':
      s1 = `Initialize an isolated liquidity provisioning wallet on ${primaryChain} with separated signer permissions.`;
      break;
    case 'BRIDGE':
      s1 = `Prepare a clean routing wallet on ${primaryChain} with native gas reserves ready for cross-chain execution.`;
      break;
    case 'YIELD':
    case 'RWA':
      s1 = `Establish an institutional-grade sub-account on ${primaryChain} designated specifically for ${name} vault interaction.`;
      break;
    case 'STAKING':
      s1 = `Set up an isolated non-custodial staking address on ${primaryChain} pre-funded for validator delegation.`;
      break;
    case 'CHAIN':
      s1 = `Spin up a dedicated network participant wallet targeting ${primaryChain} with gas reserves.`;
      break;
    case 'PAYMENTS':
      s1 = `Deploy an isolated state-channel operational wallet on ${primaryChain} with sufficient gas overhead.`;
      break;
    default:
      s1 = `Provision a clean farming wallet on ${primaryChain} segregated from primary treasury holdings.`;
      break;
  }
  const step1 = `${s1} Cost: ${gasEst}. Time: 10 minutes.`;

  // Step 2: Risk / Pre-flight / Drawdown check
  let step2 = '';
  if (p.change_7d !== null && p.change_7d < -8.0) {
    step2 = `Review the recent ${Math.abs(p.change_7d).toFixed(1)}% 7-day TVL contraction on ${primaryChain} to confirm protocol solvency, oracle feeds, and liquidation margins prior to committing deposits. Cost: $0. Time: 10 minutes.`;
  } else {
    switch (sec) {
      case 'LENDING':
        step2 = `Verify pool utilization caps and collateral liquidation parameters on ${name} before allocating borrowing capital. Cost: $0. Time: 5 minutes.`;
        break;
      case 'DEX':
        step2 = `Check 24-hour pool turnover and impermanent loss volatility on ${name} to identify optimal liquidity ranges. Cost: $0. Time: 5 minutes.`;
        break;
      case 'BRIDGE':
        step2 = `Confirm liquidity rebalancing depth and destination gas settlement rates across ${name}'s supported routes. Cost: $0. Time: 5 minutes.`;
        break;
      case 'YIELD':
      case 'RWA':
        step2 = `Inspect asset custodian audits and current yield composition across ${name}'s underlying strategy allocations. Cost: $0. Time: 5 minutes.`;
        break;
      case 'STAKING':
        step2 = `Check active validator performance metrics, slashing safeguards, and current commission rates for ${name}. Cost: $0. Time: 5 minutes.`;
        break;
      case 'CHAIN':
        step2 = `Inspect network block propagation times and current validator synchronization status for ${name}. Cost: $0. Time: 5 minutes.`;
        break;
      case 'PAYMENTS':
        step2 = `Verify payment channel hub liquidity capacity and settlement finality thresholds on ${name}. Cost: $0. Time: 5 minutes.`;
        break;
      default:
        step2 = `Audit smart contract verification status and recent transaction volume on ${name} via ${primaryChain} explorers. Cost: $0. Time: 5 minutes.`;
        break;
    }
  }

  // Step 3: Core on-chain category action
  let s3 = '';
  let s3Cost = gasEst;
  let s3Time = '15 minutes';
  switch (sec) {
    case 'LENDING':
      s3 = `Supply ${capital} of USDC into ${name} on ${primaryChain}, borrow a conservative 35% debt allocation in stablecoins, and maintain the account health factor strictly above 1.75 to prevent liquidation.`;
      s3Time = '15 minutes';
      break;
    case 'DEX':
      s3 = `Deposit ${capital} into the highest-volume paired pool on ${name} with pool depth exceeding $1M, selecting the 0.05% concentrated fee tier for stable pairs or 0.30% for volatile assets.`;
      s3Time = '20 minutes';
      break;
    case 'BRIDGE':
      s3 = `Initiate a cross-chain transfer of ${capital} from ${primaryChain} to the secondary route, bridging canonical native assets to maximize verified volume since wrapped synthetics receive lower weighting.`;
      s3Cost = `bridge fee plus ${gasEst}`;
      s3Time = '25 minutes';
      break;
    case 'YIELD':
    case 'RWA':
      s3 = `Deposit ${capital} into ${name}'s primary curated vault on ${primaryChain}, receive vault share tokens, and register the position while noting the protocol 7-day redemption settlement queue.`;
      s3Time = '15 minutes';
      break;
    case 'STAKING':
      s3 = `Stake ${capital} of native assets into ${name} on ${primaryChain}, select a high-uptime verified node operator, and retain the receipt token while planning around the stated 14-day unbonding window.`;
      s3Time = '15 minutes';
      break;
    case 'CHAIN':
      s3 = `Delegate ${capital} of network stake to an active community validator on ${name}, or deploy a light node instance on an external VPS to earn node qualification points.`;
      s3Cost = `$40/month hardware or ${gasEst}`;
      s3Time = '30 minutes';
      break;
    case 'PAYMENTS':
      s3 = `Open a bidirectional payment channel on ${name} with ${capital} of committed routing liquidity, executing test transfers before closing the settlement state.`;
      s3Cost = `channel fee plus ${gasEst}`;
      s3Time = '20 minutes';
      break;
    case 'PERPS':
      s3 = `Deposit ${capital} margin into ${name} on ${primaryChain} and establish a low-leverage delta-neutral hedged position across market contracts to generate organic maker volume.`;
      s3Cost = `trading fees plus ${gasEst}`;
      s3Time = '20 minutes';
      break;
    case 'STABLECOIN':
      s3 = `Mint ${capital} of ${name}'s pegged asset using collateralized reserves on ${primaryChain} and stake the resulting balance in the stability module.`;
      s3Time = '15 minutes';
      break;
    case 'INSURANCE':
      s3 = `Underwrite ${capital} into ${name}'s capital protection pool on ${primaryChain} to earn premium yields while backing coverage policies.`;
      s3Time = '15 minutes';
      break;
    default:
      s3 = `Deposit ${capital} into ${name}'s core application contract on ${primaryChain} and interact with primary protocol features.`;
      s3Time = '15 minutes';
      break;
  }
  const step3 = `${s3} Cost: ${s3Cost}. Time: ${s3Time}.`;

  // Step 4: Recurring cadence / volume compounding
  let s4 = '';
  switch (sec) {
    case 'LENDING':
      s4 = `Rebalance borrowed debt and compound accrued interest rewards weekly across ${chainCount > 1 ? chainCount + ' supported chains' : primaryChain} over 4 consecutive weeks.`;
      break;
    case 'DEX':
      s4 = `Adjust concentrated tick ranges and harvest accumulated trading fees on a bi-weekly cycle to maintain active provider status.`;
      break;
    case 'BRIDGE':
      s4 = `Execute return bridging transactions across alternating networks every two weeks to log multi-hop usage diversity.`;
      break;
    case 'YIELD':
    case 'RWA':
      s4 = `Reinvest vault yield distributions and verify share token balances monthly to demonstrate sustained participation.`;
      break;
    case 'STAKING':
      s4 = `Restake accumulated validator rewards and participate in on-chain governance snapshot votes to build voter tenure.`;
      break;
    case 'CHAIN':
      s4 = `Broadcast periodic transactions across testnet and mainnet contracts to demonstrate continuous user activity.`;
      break;
    case 'PAYMENTS':
      s4 = `Route recurring micro-transactions through active channels over a 4-week span to build operational velocity.`;
      break;
    default:
      s4 = `Perform recurring interactions on ${name} across at least 4 distinct calendar weeks to satisfy activity thresholds.`;
      break;
  }
  const step4 = `${s4} Cost: ${gasEst}. Time: 10 minutes.`;

  // Step 5: Holding & seasoning window
  const holdDays = age === null ? 30 : age < 180 ? 60 : age < 365 ? 45 : 30;
  const step5 = `Maintain capital committed in ${name} for no less than ${holdDays} consecutive days to clear retroactive snapshot filters that purge transient capital. Cost: opportunity cost of capital. Time: 5 minutes.`;

  // Step 6: Official communication & claim security
  const step6 = `Monitor official distribution announcements exclusively through ${name}'s verified governance portal and domain; never approve unverified signatures or fee payments for airdrop claims. Cost: $0. Time: 5 minutes.`;

  // Step 7: Ledger tracking & audit log
  const step7 = `Archive transaction hashes, deposited contract addresses, and snapshot timestamp receipts in an offline audit record to support retroactive claims dispute. Cost: $0. Time: 10 minutes.`;

  const steps = [step1, step2, step3, step4, step5, step6, step7];

  return steps.map(s => {
    let trimmed = s.trim();
    if (trimmed.length > 600) {
      const costMatch = trimmed.match(/Cost:.*Time:.*$/);
      if (costMatch) {
        const tail = ` ${costMatch[0]}`;
        const room = 600 - tail.length;
        trimmed = trimmed.slice(0, room).trim() + tail;
      } else {
        trimmed = trimmed.slice(0, 600);
      }
    }
    return trimmed;
  });
}

/**
 * Builds the complete ranked board of pre-token opportunities.
 */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const benchmarks = categoryBenchmarks(snapshot, model);
  const benchMap = new Map<string, CategoryBench>();
  for (const b of benchmarks) {
    benchMap.set(b.category, b);
  }
  const fallbackBench = benchMap.get('*')!;

  const watchlistSet = new Set(snapshot.watchlist);

  // 1. All watchlist protocols
  const watchlistProtocols: SnapshotProtocol[] = [];
  const protoMap = new Map<string, SnapshotProtocol>();
  for (const p of snapshot.protocols) {
    protoMap.set(p.slug, p);
  }

  for (const slug of snapshot.watchlist) {
    const p = protoMap.get(slug);
    if (p) watchlistProtocols.push(p);
  }

  // 2. Early-stage candidate protocols: pre-token protocols not on watchlist that pass isLaunchCandidate
  const earlyCandidates = snapshot.protocols
    .filter(p => isPreToken(p) && !watchlistSet.has(p.slug) && isLaunchCandidate(p))
    .sort((a, b) => {
      if (b.tvl_usd !== a.tvl_usd) return b.tvl_usd - a.tvl_usd;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    })
    .slice(0, model.early_rows);

  // Combine rows with their tier
  interface RowCandidate {
    protocol: SnapshotProtocol;
    tier: 'watchlist' | 'early';
  }

  const candidates: RowCandidate[] = [
    ...watchlistProtocols.map(p => ({ protocol: p, tier: 'watchlist' as const })),
    ...earlyCandidates.map(p => ({ protocol: p, tier: 'early' as const })),
  ];

  interface EvaluatedRow {
    slug: string;
    name: string;
    category: string | null;
    chains: string[];
    tvl_usd: number;
    change_7d: number | null;
    listed_at: string | null;
    age_days: number | null;
    implied_value_usd: number;
    value_low_usd: number;
    value_high_usd: number;
    confidence: 'high' | 'medium' | 'low';
    implied_multiple: number;
    token_status: 'pre-token';
    tier: 'watchlist' | 'early';
    why: string;
    readiness: Readiness;
    model: ImpliedBreakdown;
    farm_steps: string[];
  }

  const evaluated: EvaluatedRow[] = [];

  for (const { protocol: p, tier } of candidates) {
    const bench = (p.category && benchMap.get(p.category)) || fallbackBench;
    const { implied, value_low, value_high, confidence, breakdown } = impliedValue(p, snapshot.as_of, bench, model);
    const age = ageDays(snapshot.as_of, p.listed_at);
    const ready = readiness(p, age, bench, model);
    const steps = farmSteps(p, age, tier);
    const multiple = Math.round((implied / Math.max(1, p.tvl_usd)) * 100) / 100;
    const why = whyProtocol(p, snapshot.as_of);

    evaluated.push({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      listed_at: p.listed_at,
      age_days: age,
      implied_value_usd: implied,
      value_low_usd: value_low,
      value_high_usd: value_high,
      confidence,
      implied_multiple: multiple,
      token_status: 'pre-token',
      tier,
      why,
      readiness: ready,
      model: breakdown,
      farm_steps: steps,
    });
  }

  // Sort by implied_value_usd desc, then slug asc
  evaluated.sort((a, b) => {
    if (b.implied_value_usd !== a.implied_value_usd) {
      return b.implied_value_usd - a.implied_value_usd;
    }
    return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
  });

  return evaluated.map((row, index) => ({
    rank: index + 1,
    ...row,
  }));
}

/**
 * Gathers the top live tokenized comparison set for market multiple context.
 */
export function liveRows(snapshot: Snapshot, model: ModelConstants = MODEL): LiveRow[] {
  return snapshot.protocols
    .filter(p => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0)
    .map(p => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd!,
      ratio: Math.round((p.mcap_usd! / p.tvl_usd) * 1000) / 1000,
    }))
    .sort((a, b) => {
      if (b.mcap_usd !== a.mcap_usd) return b.mcap_usd - a.mcap_usd;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    })
    .slice(0, model.live_rows);
}

/**
 * Builds the full radar data payload and ranked board.
 */
export function buildRadar(
  snapshot: Snapshot,
  model: ModelConstants = MODEL
): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const benchmarks = categoryBenchmarks(snapshot, model);
  const live = liveRows(snapshot, model);

  // Categories: sorted unique non-null categories of the board rows
  const catSet = new Set<string>();
  for (const r of board) {
    if (r.category) catSet.add(r.category);
  }
  const categories = Array.from(catSet).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  // Chains: sorted unique chains over board rows, capped at 40 by frequency
  const chainFreq = new Map<string, number>();
  for (const r of board) {
    for (const c of r.chains) {
      chainFreq.set(c, (chainFreq.get(c) || 0) + 1);
    }
  }

  const topChains = Array.from(chainFreq.entries())
    .sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1];
      return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
    })
    .slice(0, 40)
    .map(entry => entry[0])
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  // Omit model and readiness from RadarRow
  const radarRows: RadarRow[] = board.map(row => {
    const { model: _m, readiness: _r, ...rest } = row;
    return rest;
  });

  const watchlistCovered = board.filter(r => r.tier === 'watchlist').length;
  const earlySize = board.filter(r => r.tier === 'early').length;
  const preTokenTotal = snapshot.protocols.filter(isPreToken).length;

  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    generated_by: 'token-radar-entry/lib/model.ts',
    watchlist_size: snapshot.watchlist.length,
    watchlist_covered: watchlistCovered,
    pre_token_total: preTokenTotal,
    board_size: board.length,
    early_size: earlySize,
    live_size: live.length,
    categories,
    chains: topChains,
    benchmarks,
    rows: radarRows,
    live,
  };

  return { board, radar };
}

/**
 * Returns executable JavaScript code assigning window.RADAR.
 */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}

/**
 * Validates board hard contract against the competition gate rules.
 * Returns the first problem encountered as a readable sentence, or null if all pass.
 */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) {
    return `Board row count (${board.length}) must be between 100 and 4000.`;
  }

  const snapshotSlugs = new Set(snapshot.protocols.map(p => p.slug));
  const boardSlugs = new Set<string>();

  for (const r of board) {
    if (!snapshotSlugs.has(r.slug)) {
      return `Board slug "${r.slug}" does not exist in the snapshot protocols.`;
    }
    if (boardSlugs.has(r.slug)) {
      return `Duplicate slug "${r.slug}" found on board.`;
    }
    boardSlugs.add(r.slug);

    if (typeof r.name !== 'string' || r.name.trim().length === 0) {
      return `Row with slug "${r.slug}" has an empty name.`;
    }

    if (typeof r.why !== 'string' || r.why.length > 140) {
      return `Row with slug "${r.slug}" has invalid why field (must be string <= 140 chars).`;
    }

    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 100000000000000) {
      return `Row with slug "${r.slug}" has invalid implied_value_usd: ${r.implied_value_usd}. Must be positive safe integer <= 100,000,000,000,000.`;
    }

    if (!Array.isArray(r.farm_steps) || r.farm_steps.length < 3 || r.farm_steps.length > 12) {
      return `Row with slug "${r.slug}" has ${r.farm_steps ? r.farm_steps.length : 0} farm steps; must be 3..12.`;
    }

    for (let sIdx = 0; sIdx < r.farm_steps.length; sIdx++) {
      const step = r.farm_steps[sIdx];
      if (typeof step !== 'string') {
        return `Row "${r.slug}" step ${sIdx + 1} is not a string.`;
      }
      const len = step.trim().length;
      if (len < 20 || len > 600) {
        return `Row "${r.slug}" step ${sIdx + 1} trimmed length (${len}) outside allowed range [20, 600].`;
      }
    }
  }

  for (const w of snapshot.watchlist) {
    if (!boardSlugs.has(w)) {
      return `Watchlist slug "${w}" is missing from the board.`;
    }
  }

  for (let i = 0; i < board.length; i++) {
    if (board[i].rank !== i + 1) {
      return `Row at index ${i} has rank ${board[i].rank}; expected ${i + 1}.`;
    }
  }

  for (let i = 1; i < board.length; i++) {
    if (board[i].implied_value_usd > board[i - 1].implied_value_usd) {
      return `Implied value increased at rank ${board[i].rank}: ${board[i].implied_value_usd} > ${board[i - 1].implied_value_usd}.`;
    }
  }

  const firstVal = board[0].implied_value_usd;
  if (board.every(r => r.implied_value_usd === firstVal)) {
    return 'All board rows share the exact same implied value.';
  }

  return null;
}
