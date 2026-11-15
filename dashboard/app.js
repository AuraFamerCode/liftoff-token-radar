(function () {
  'use strict';

  function fmtMoney(n) {
    if (typeof n !== 'number' || !Number.isFinite(n)) return '—';
    const s = n < 0 ? '-' : '', a = Math.abs(n);
    if (a >= 1e12) return s + '$' + (a / 1e12).toFixed(2) + 'T';
    if (a >= 1e9) return s + '$' + (a / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return s + '$' + (a / 1e6).toFixed(1) + 'M';
    if (a >= 1e3) return s + '$' + Math.round(a / 1e3) + 'K';
    return s + '$' + Math.round(a);
  }

  function fmtPct(n) {
    return (typeof n === 'number' && Number.isFinite(n)) ? (n > 0 ? '+' : '') + n.toFixed(1) + '%' : '—';
  }

  function fmtAge(d) {
    if (typeof d !== 'number' || !Number.isFinite(d)) return '—';
    return d < 30 ? d + 'd' : d < 365 ? Math.round(d / 30.4) + 'mo' : (d / 365.25).toFixed(1) + 'y';
  }

  function el(tag, attrs, ...children) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (k === 'className') node.className = v;
        else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
        else if (v !== null && v !== undefined && v !== false) node.setAttribute(k, v === true ? '' : String(v));
      }
    }
    const append = (c) => {
      if (c === null || c === undefined || c === false) return;
      if (Array.isArray(c)) c.forEach(append);
      else if (typeof c === 'string' || typeof c === 'number') node.appendChild(document.createTextNode(String(c)));
      else if (c instanceof Node) node.appendChild(c);
    };
    children.forEach(append);
    return node;
  }

  function findBench(radar, cat) {
    const fb = radar.benchmarks?.find(b => b.source === 'global' || b.category === '*') || { benchmark: 0.25, peers: 0, median_ratio: 0.25 };
    return (cat && radar.benchmarks?.find(b => b.category === cat)) || fb;
  }

  function computeDeriv(row, bench) {
    const g = Math.min(100, Math.max(-50, row.change_7d ?? 0)), growthMult = 1 + (g / 100) * 0.30;
    const age = row.age_days ?? 365, maturityMult = 0.70 + (0.30 * Math.min(age, 1460)) / 1460;
    const chainCount = row.chains?.length || 1, breadthMult = 1 + 0.03 * Math.min(Math.max(chainCount - 1, 0), 4);
    const implied = Math.max(1, Math.round(row.tvl_usd * bench.benchmark * growthMult * maturityMult * breadthMult));
    return { bench, g, growthMult, age, maturityMult, chainCount, breadthMult, implied, formula: `${fmtMoney(row.tvl_usd)} TVL × ${bench.benchmark.toFixed(2)} bench × ${growthMult.toFixed(3)} growth × ${maturityMult.toFixed(3)} maturity × ${breadthMult.toFixed(2)} breadth` };
  }

  function computeReadiness(row) {
    const age = row.age_days ?? 365;
    const track_record = Math.min(Math.max(age, 0), 1460) / 1460;
    const g = Math.min(100, Math.max(-50, row.change_7d ?? 0));
    const growth = Math.min(1, Math.max(0, (g + 30) / 60));
    const scale = Math.min(1, Math.max(0, row.tvl_usd / 1e9));
    const distribution = Math.min(1, Math.max(0, (row.chains?.length || 1) / 4));

    const cat = (row.category || '').toLowerCase();
    const fee_engine = /dex|lend|perpetual|derivative|yield|curator|cdp|liquidity|aggregator|basis/.test(cat) ? 1.0 : /rwa|chain|payments|governance|insurance|stable/.test(cat) ? 0.45 : 0.25;

    const weights = { track_record: 0.30, scale: 0.25, growth: 0.20, distribution: 0.15, fee_engine: 0.10 };
    const raw = 100 * (track_record * 0.30 + scale * 0.25 + growth * 0.20 + distribution * 0.15 + fee_engine * 0.10);
    return { score: Math.min(100, Math.max(0, Math.round(raw))), parts: { track_record, scale, growth, distribution, fee_engine }, weights };
  }

  function parseStep(t) {
    const c = t.match(/Cost:\s*([^.]+\.)/i), tm = t.match(/Time:\s*([^.]+\.?)/i);
    let txt = t;
    if (c) txt = txt.replace(c[0], '');
    if (tm) txt = txt.replace(tm[0], '');
    return { text: txt.trim().replace(/\s{2,}/g, ' '), cost: c ? c[0].trim() : 'Cost: gas only.', time: tm ? tm[0].trim() : 'Time: 10 minutes.' };
  }

  const CAND_TITLE = 'launch candidate the house watchlist does not name — the snapshot rule left it out (a parent, wrapped or staked product, bridge, exchange record or version marker); it is ranked on the same model';

  // Derived directly in the client to ensure visible, deterministic farm planning
  function farmPlan(r) {
    const n = r.name || 'protocol', ch = (r.chains && r.chains[0]) || 'Ethereum', cn = (r.chains && r.chains.length) || 1;
    const tvl = r.tvl_usd || 0, age = r.age_days, c = (r.category || '').toLowerCase();
    const cap = tvl >= 5e8 ? '$2,500–$10,000' : tvl >= 5e7 ? '$1,000–$2,500' : '$250–$500';
    const gas = cn > 2 ? '~$5–$15 multichain gas' : '~$3–$8 L1/L2 gas';
    const hold = age === null ? 30 : age < 180 ? 60 : age < 365 ? 45 : 30;

    let act = `Deposit ${cap} into ${n}'s core contract on ${ch} to establish verified tenure.`;
    if (/lend|borrow|cdp/.test(c)) act = `Supply ${cap} collateral into ${n} on ${ch} and borrow debt maintaining health factor > 1.8.`;
    else if (/dex|swap|amm/.test(c)) act = `Deposit ${cap} into a pool on ${n} on ${ch} selecting concentrated fee tiers.`;
    else if (/yield|curator|vault|rwa/.test(c)) act = `Deposit ${cap} into ${n}'s primary vault on ${ch} registering share tokens.`;
    else if (/bridge|cross/.test(c)) act = `Bridge ${cap} of canonical assets through ${n} from ${ch} to log multi-hop volume.`;
    else if (/stak/.test(c)) act = `Stake ${cap} into ${n} on ${ch} with a verified validator node retaining receipt tokens.`;

    const s = [
      `Fund a dedicated non-custodial wallet on ${ch} with native gas tokens; avoid mixing sybil addresses. Cost: ${gas}. Time: 10 minutes.`,
      `Audit smart contract verification status and liquidity depth on ${n} via ${ch} explorer. Cost: $0. Time: 5 minutes.`,
      `${act} Cost: ${gas}. Time: 15 minutes.`,
      `Execute periodic interactions on ${n} across ${cn > 1 ? cn + ' supported chains' : ch} over 4 consecutive weeks to log recurring usage. Cost: ${gas}. Time: 10 minutes.`,
      `Maintain committed capital in ${n} for at least ${hold} consecutive days to satisfy retroactive seasoning thresholds. Cost: capital opportunity cost. Time: 5 minutes.`,
      `Track official claim announcements exclusively through ${n}'s verified domain; never approve unverified signatures or claim fees. Cost: $0. Time: 5 minutes.`,
      `Archive transaction receipts, contract addresses, and snapshot timestamp proofs in an offline ledger for claim verification. Cost: $0. Time: 10 minutes.`
    ];
    if (r.change_7d !== null && r.change_7d < -8) {
      s.splice(3, 0, `Caution: ${n} recorded a ${r.change_7d.toFixed(1)}% 7-day TVL contraction; verify pool solvency and reduce margin exposure before committing new capital. Cost: $0. Time: 5 minutes.`);
    }
    return s;
  }

  function peerBadge(r, R) {
    const b = findBench(R, r.category), p = b.peers ?? 0, conf = r.confidence || 'low';
    let label = `${p} peer${p === 1 ? '' : 's'}`;
    if (b.basis === 'sector') label = p > 0 ? `sector · ${p} peer${p === 1 ? '' : 's'}` : 'no peers · sector';
    else if (b.basis === 'global') label = 'no peers · global';

    let title = `${p} traded peer${p === 1 ? '' : 's'} (${b.basis} benchmark)`;
    if (b.basis === 'sector') title = `Category had ${p} traded peer${p === 1 ? '' : 's'}; benchmark shrunk to ${b.sector} sector with widened band`;
    else if (conf === 'high') title = `${p} traded comps in category; tight quartile band`;
    else if (conf === 'low') title = `Sparse comps (<3 peers); valuation band widened 0.6x–1.6x`;

    return { label, title, conf, basis: b.basis, peers: p, sector: b.sector };
  }

  function impliedCell(r, R) {
    const low = r.value_low_usd ?? r.implied_value_usd, high = r.value_high_usd ?? r.implied_value_usd;
    const dot = Math.min(100, Math.max(0, Math.round(((r.implied_value_usd - low) / Math.max(1, high - low)) * 100)));
    const pb = peerBadge(r, R);
    return el('div', { className: 'val-cell' },
      el('div', { className: 'val-top-row' },
        el('span', { className: 'val-main' }, fmtMoney(r.implied_value_usd)),
        el('span', { className: `conf-chip conf-${pb.conf}`, title: pb.title }, pb.label)
      ),
      el('div', { className: 'range-sub-row', title: `Range: ${fmtMoney(low)} .. ${fmtMoney(high)}` },
        el('div', { className: 'range-bar-track' }, el('div', { className: 'range-bar-dot', style: `left: ${dot}%;` })),
        el('span', { className: 'val-sub' }, `${fmtMoney(low)}–${fmtMoney(high)}`)
      )
    );
  }

  function defaultBoardFilters() {
    return { q: '', cat: 'all', chain: 'all', tier: 'all', min: '0', sort: 'implied', dir: 'desc' };
  }

  const state = {
    radar: null,
    boardFilters: defaultBoardFilters(),
    liveFilters: { q: '', cat: 'all', sort: 'mcap', dir: 'desc' }
  };

  let isInitialLoad = true;

  function parseQueryParams() {
    const p = new URLSearchParams(window.location.search || '');
    if (window.location.hash && window.location.hash.includes('?')) {
      const hp = new URLSearchParams(window.location.hash.slice(window.location.hash.indexOf('?') + 1));
      for (const [k, v] of hp.entries()) p.set(k, v);
    }
    if (p.has('q')) state.boardFilters.q = p.get('q') || '';
    if (p.has('cat')) state.boardFilters.cat = p.get('cat') || 'all';
    if (p.has('chain')) state.boardFilters.chain = p.get('chain') || 'all';
    if (p.has('tier')) {
      const t = (p.get('tier') || 'all').toLowerCase();
      state.boardFilters.tier = (t === 'early' || t === 'candidate') ? 'candidate' : (t === 'watchlist' ? 'watchlist' : 'all');
    }
    if (p.has('min')) state.boardFilters.min = p.get('min') || '0';
    if (p.has('sort')) state.boardFilters.sort = p.get('sort') || 'implied';
    if (p.has('dir')) {
      const d = p.get('dir');
      state.boardFilters.dir = (d === 'asc' || d === '1') ? 'asc' : 'desc';
    }
  }

  function updateActiveNav(a) {
    ['board', 'live', 'method'].forEach(n => {
      const b = document.getElementById('nav-' + n);
      if (b) b.className = 'nav-btn' + (a === n ? ' is-active' : '');
    });
  }

  function focusMainHeading() {
    window.scrollTo(0, 0);
    if (isInitialLoad) return;
    const h = document.querySelector('main h2, main h1, h1');
    if (h) {
      h.setAttribute('tabindex', '-1');
      h.focus({ preventScroll: true });
    }
    window.scrollTo(0, 0);
  }

  function selField(id, label, val, opts, onChg) {
    return el('div', { className: 'ctrl-field' },
      el('label', { htmlFor: id, className: 'ctrl-label' }, label),
      el('select', { id, className: 'ctrl-select', onchange: onChg },
        opts.map(([v, l]) => el('option', { value: v, selected: val === v }, l))
      )
    );
  }

  function renderMissingDataView() {
    document.title = 'Missing Data — Lift-off';
    const c = document.getElementById('view-container');
    c.replaceChildren(el('div', { className: 'detail-card empty-view' },
      el('h2', { tabindex: '-1' }, 'Dataset Not Found'),
      el('p', {}, 'data.js missing beside dashboard/index.html.'),
      el('div', { className: 'formula-box' }, 'mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input /tmp/tr-snapshot.json')
    ));
    focusMainHeading();
  }

  // --- 1. Board View ---
  function renderBoardView() {
    document.title = 'Lift-off — Token Launch Radar';
    updateActiveNav('board');

    const container = document.getElementById('view-container');
    container.replaceChildren();

    const R = state.radar, f = state.boardFilters;
    const qLower = f.q.trim().toLowerCase(), minTvl = parseFloat(f.min) || 0;

    let rows = R.rows.filter(r => {
      if (f.tier === 'watchlist' && r.tier !== 'watchlist') return false;
      if (f.tier === 'candidate' && r.tier === 'watchlist') return false;
      if (f.cat !== 'all' && r.category !== f.cat) return false;
      if (f.chain !== 'all' && (!r.chains || !r.chains.includes(f.chain))) return false;
      if (r.tvl_usd < minTvl) return false;
      if (qLower) {
        const str = `${r.name} ${r.slug} ${r.category} ${(r.chains || []).join(' ')}`.toLowerCase();
        if (!str.includes(qLower)) return false;
      }
      return true;
    });

    const readyMap = new Map();
    for (const r of rows) readyMap.set(r.slug, computeReadiness(r));

    const dirMult = f.dir === 'asc' ? 1 : -1;
    rows.sort((a, b) => {
      const S = { rank: a.rank - b.rank, implied: a.implied_value_usd - b.implied_value_usd, tvl: a.tvl_usd - b.tvl_usd, growth: (a.change_7d ?? -999) - (b.change_7d ?? -999), age: (a.age_days ?? 0) - (b.age_days ?? 0), readiness: readyMap.get(a.slug).score - readyMap.get(b.slug).score, name: (a.name || '').localeCompare(b.name || '') };
      const cmp = S[f.sort] ?? S.implied;
      return (cmp !== 0 ? cmp * dirMult : a.rank - b.rank);
    });

    container.appendChild(el('h2', { className: 'sr-only', tabindex: '-1' }, 'Radar Board Protocols'));

    const toolbar = el('div', { className: 'toolbar', role: 'region', 'aria-label': 'Board controls' },
      el('div', { className: 'ctrl-field ctrl-search' },
        el('label', { htmlFor: 'ctrl-q', className: 'ctrl-label' }, 'Search'),
        el('input', {
          type: 'search', id: 'ctrl-q', className: 'ctrl-input',
          placeholder: 'Search name, category, chain...', value: f.q, autocomplete: 'off',
          oninput: (e) => { f.q = e.target.value; renderBoardView(); }
        })
      ),
      selField('ctrl-cat', 'Category', f.cat, [['all', 'All Categories'], ...R.categories.map(c => [c, c])], (e) => { f.cat = e.target.value; renderBoardView(); }),
      selField('ctrl-chain', 'Chain', f.chain, [['all', 'All Chains'], ...R.chains.map(c => [c, c])], (e) => { f.chain = e.target.value; renderBoardView(); }),
      selField('ctrl-tier', 'Tier', f.tier === 'early' ? 'candidate' : f.tier, [['all', 'All Tiers'], ['watchlist', 'Watchlist'], ['candidate', 'Candidate']], (e) => { f.tier = e.target.value; renderBoardView(); }),
      selField('ctrl-min', 'Min TVL', f.min, [['0', 'All Scales'], ['10000000', '≥ $10M'], ['50000000', '≥ $50M'], ['100000000', '≥ $100M'], ['250000000', '≥ $250M'], ['1000000000', '≥ $1B']], (e) => { f.min = e.target.value; renderBoardView(); }),
      selField('ctrl-sort', 'Sort', f.sort, [['implied', 'Implied Value'], ['rank', 'Rank'], ['tvl', 'TVL'], ['growth', '7d Growth'], ['readiness', 'Readiness'], ['age', 'Age without Token'], ['name', 'Name']], (e) => { f.sort = e.target.value; renderBoardView(); }),
      el('button', {
        type: 'button', className: 'ctrl-btn', title: f.dir === 'desc' ? 'Descending' : 'Ascending',
        onclick: () => { f.dir = f.dir === 'desc' ? 'asc' : 'desc'; renderBoardView(); }
      }, f.dir === 'desc' ? '▼ Desc' : '▲ Asc'),
      el('div', { className: 'result-count tabular', id: 'result-count', role: 'status', 'aria-live': 'polite' },
        `Showing ${rows.length} of ${R.rows.length}`
      )
    );
    container.appendChild(toolbar);

    const boardContainer = el('div', { className: 'board-container' });
    const scrollBox = el('div', { className: 'table-scroll' });

    if (rows.length === 0) {
      scrollBox.appendChild(el('div', { className: 'empty-view' },
        el('h3', {}, 'No protocols match your active filters'),
        el('p', {}, 'Try clearing search terms or resetting filters.'),
        el('button', {
          className: 'ctrl-btn',
          onclick: () => {
            state.boardFilters = defaultBoardFilters();
            renderBoardView();
          }
        }, 'Reset Filters')
      ));
    } else {
      const headers = [
        ['rank', 'Rank', 'col-rank'],
        ['name', 'Protocol', 'col-protocol'],
        [null, 'Chains', 'col-chains'],
        ['tvl', 'TVL', 'col-tvl'],
        ['growth', '7d TVL', 'col-7d'],
        ['age', 'Age', 'col-age'],
        ['implied', 'Implied Value', 'col-implied'],
        ['readiness', 'Readiness', 'col-ready'],
        [null, 'Action', 'col-action']
      ];

      const thead = el('thead', {}, el('tr', {}, headers.map(([k, l, c]) => {
        const thAttrs = { scope: 'col', className: c };
        if (k) {
          thAttrs.className += ' sortable';
          thAttrs.onclick = () => {
            if (f.sort === k) f.dir = f.dir === 'desc' ? 'asc' : 'desc';
            else { f.sort = k; f.dir = (k === 'name' || k === 'rank') ? 'asc' : 'desc'; }
            renderBoardView();
          };
          if (f.sort === k) thAttrs['aria-sort'] = f.dir === 'desc' ? 'descending' : 'ascending';
        }
        const ch = [l];
        if (k && f.sort === k) ch.push(el('span', { className: 'sort-indicator' }, f.dir === 'desc' ? '▼' : '▲'));
        return el('th', thAttrs, ...ch);
      })));

      const tbody = el('tbody', {}, rows.map(row => {
        const ready = readyMap.get(row.slug);
        const rankCls = 'rank-badge' + (row.rank <= 3 ? ' rank-top3' : row.rank <= 10 ? ' rank-top10' : '');
        const chains = row.chains || [], chainsStr = chains.join(', ');
        const chainNodes = chains.slice(0, 2).map(c => el('span', { className: 'chain-chip', title: c }, c));
        if (chains.length > 2) chainNodes.push(el('span', { className: 'chain-more', title: chainsStr }, `+${chains.length - 2}`));

        let growthCls = 'growth-neutral';
        if (row.change_7d !== null) {
          if (row.change_7d > 0.05) growthCls = 'growth-pos';
          else if (row.change_7d < -0.05) growthCls = 'growth-neg';
        }
        const catTitle = row.category || 'Uncategorized';

        return el('tr', {
          tabindex: '0', role: 'link',
          'aria-label': `${row.name}, Rank ${row.rank}, Implied ${fmtMoney(row.implied_value_usd)}`,
          onclick: () => { window.location.hash = '#/p/' + encodeURIComponent(row.slug); },
          onkeydown: (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              window.location.hash = '#/p/' + encodeURIComponent(row.slug);
            }
          }
        },
          el('td', { className: 'col-rank' }, el('span', { className: rankCls }, row.rank)),
          el('td', { className: 'col-protocol' },
            el('div', { className: 'proto-cell' },
              el('div', { className: 'proto-title-row' },
                el('span', { className: 'proto-name', title: row.name }, row.name),
                el('span', { className: row.tier === 'watchlist' ? 'badge-tier tier-watchlist' : 'badge-tier tier-candidate', ...(row.tier === 'watchlist' ? {} : { title: CAND_TITLE }) }, row.tier === 'watchlist' ? 'Watchlist' : 'Candidate')
              ),
              el('div', { className: 'proto-meta', title: catTitle }, el('span', {}, catTitle))
            )
          ),
          el('td', { className: 'col-chains' }, el('div', { className: 'chains-cell', title: chainsStr }, ...chainNodes)),
          el('td', { className: 'col-tvl num-cell' }, fmtMoney(row.tvl_usd)),
          el('td', { className: 'col-7d' }, el('span', { className: `growth-pill ${growthCls}` }, fmtPct(row.change_7d))),
          el('td', { className: 'col-age num-cell' }, fmtAge(row.age_days)),
          el('td', { className: 'col-implied' }, impliedCell(row, R)),
          el('td', { className: 'col-ready' },
            el('div', { className: 'mini-meter', title: `Launch Readiness: ${ready.score}/100` },
              el('div', { className: 'mini-meter-bar' }, el('div', { className: 'mini-meter-fill', style: `width: ${ready.score}%;` })),
              el('span', { className: 'mini-meter-val' }, ready.score)
            )
          ),
          el('td', { className: 'col-action' },
            el('a', { href: '#/p/' + encodeURIComponent(row.slug), className: 'open-link', onclick: (e) => e.stopPropagation() }, 'Open')
          )
        );
      }));

      scrollBox.appendChild(el('table', { className: 'radar-table' }, thead, tbody));
    }

    boardContainer.appendChild(scrollBox);
    container.appendChild(boardContainer);
  }

  // --- 2. Detail View ---
  function renderDetailView(slug) {
    updateActiveNav('board');
    const container = document.getElementById('view-container');
    container.replaceChildren();

    const R = state.radar, row = R.rows.find(r => r.slug === slug);
    if (!row) {
      document.title = 'Protocol Not Found — Lift-off';
      container.appendChild(el('div', { className: 'detail-card empty-view' },
        el('h2', { tabindex: '-1' }, `Protocol "${slug}" not found`),
        el('p', {}, 'The protocol slug may be mistyped or excluded from pre-token radar.'),
        el('a', { href: '#/', className: 'ctrl-btn' }, 'Back to Radar Board')
      ));
      focusMainHeading();
      return;
    }

    document.title = `${row.name} — Lift-off Valuation Detail`;
    const bench = findBench(R, row.category);
    const deriv = computeDeriv(row, bench), ready = computeReadiness(row);

    const pb = peerBadge(row, R);
    let rangeDesc = `${fmtMoney(row.value_low_usd)} to ${fmtMoney(row.value_high_usd)} (${pb.label} benchmark). `;
    if (bench.basis === 'sector') {
      rangeDesc += `Category "${row.category || 'Unknown'}" had too few traded peers (${pb.peers} peer${pb.peers === 1 ? '' : 's'}); benchmark fell back to the ${bench.sector || 'sector'} sector.`;
    } else if (bench.basis === 'category') {
      rangeDesc += `Derived from ${pb.peers} peer${pb.peers === 1 ? '' : 's'} in the ${row.category || 'General'} category.`;
    } else {
      rangeDesc += `Fallback to global cross-universe median.`;
    }

    const mCard = (k, v, hl) => el('div', { className: 'metric-card' + (hl ? ' highlight' : '') }, el('span', { className: 'metric-card-k' }, k), el('span', { className: 'metric-card-v' }, v));

    const view = el('div', { className: 'detail-view' },
      el('div', { className: 'detail-nav-row' },
        el('a', {
          href: '#/',
          className: 'back-link',
          onclick: () => {
            state.boardFilters = defaultBoardFilters();
          }
        }, '← Back to Radar Board'),
        el('span', { className: 'result-count' }, `Rank #${row.rank} of ${R.rows.length}`)
      ),
      el('div', { className: 'detail-header-card' },
        el('div', { className: 'detail-hero-top' },
          el('div', { className: 'detail-title-group' },
            el('div', { className: 'detail-title-row' },
              el('h2', { className: 'detail-title', tabindex: '-1' }, row.name),
              el('span', { className: row.tier === 'watchlist' ? 'badge-tier tier-watchlist' : 'badge-tier tier-candidate', ...(row.tier === 'watchlist' ? {} : { title: CAND_TITLE }) }, row.tier === 'watchlist' ? 'Watchlist' : 'Candidate'),
              el('span', { className: 'rank-badge' }, `#${row.rank}`)
            ),
            el('div', { className: 'detail-meta-row', title: `Category: ${row.category || 'Uncategorized'} | Chains: ${(row.chains || []).join(', ')}` },
              el('span', {}, `Category: ${row.category || 'Uncategorized'}`),
              el('span', {}, '•'),
              el('span', {}, `Chains: ${(row.chains || []).join(', ')}`),
              el('span', {}, '•'),
              el('span', {}, `Slug: ${row.slug}`)
            )
          ),
          el('div', { className: 'metric-card highlight' },
            el('span', { className: 'metric-card-k' }, 'Implied Value'),
            el('span', { className: 'metric-card-v' }, fmtMoney(row.implied_value_usd)),
            el('span', { className: 'val-sub' }, `${row.implied_multiple.toFixed(2)}x TVL multiple`)
          )
        ),
        el('div', { className: 'detail-why-box' },
          el('strong', {}, 'Thesis: '),
          row.why || `${fmtMoney(row.tvl_usd)} TVL with proven track record and no token recorded.`
        ),
        el('div', { className: 'detail-range-box' },
          el('strong', {}, 'Valuation Range: '),
          rangeDesc
        )
      ),
      el('div', { className: 'metrics-strip' },
        mCard('TVL', fmtMoney(row.tvl_usd)),
        mCard('7d Growth', fmtPct(row.change_7d)),
        mCard('Tenure (No Token)', fmtAge(row.age_days)),
        mCard('Chains', String(row.chains?.length || 1)),
        mCard('Readiness', `${ready.score} / 100`)
      )
    );

    const dRow = (k, v, m, cls) => el('tr', cls ? { className: cls } : null, el('td', null, k), el('td', { className: 'num' }, v), el('td', { className: 'num' }, m));

    const grid1 = el('div', { className: 'detail-grid detail-grid-2col' });
    grid1.appendChild(el('div', { className: 'detail-card' },
      el('h3', { className: 'card-title' }, 'Implied Value Arithmetic', el('span', { className: 'val-sub' }, 'Derived from Snapshot')),
      el('table', { className: 'derivation-table' },
        el('thead', {}, el('tr', {}, el('th', {}, 'Component'), el('th', { className: 'num' }, 'Base / Param'), el('th', { className: 'num' }, 'Multiplier'))),
        el('tbody', {},
          dRow('TVL Base', fmtMoney(row.tvl_usd), '1.000x'),
          dRow(`Category Benchmark (${row.category || 'Global'})`, `${bench.peers} ${bench.peers === 1 ? 'peer' : 'peers'}, med ${(bench.median_ratio || 0).toFixed(4)}`, `${bench.benchmark.toFixed(3)}x`),
          dRow('7-Day TVL Velocity Tilt', `clamped ${deriv.g.toFixed(1)}% × 0.30`, `${deriv.growthMult.toFixed(3)}x`),
          dRow('Tenure Seasoning (No Token)', `${deriv.age}d unissued (cap 1,460d)`, `${deriv.maturityMult.toFixed(3)}x`),
          dRow('Distribution Breadth', `${deriv.chainCount} chain(s)`, `${deriv.breadthMult.toFixed(3)}x`),
          dRow(el('strong', {}, 'Implied Valuation'), `${row.implied_multiple.toFixed(2)}x TVL`, el('strong', {}, fmtMoney(row.implied_value_usd)), 'derivation-result-row'),
          dRow('Valuation Range (Q1–Q3)', `${pb.label} (${bench.basis || 'category'})`, `${fmtMoney(row.value_low_usd)} – ${fmtMoney(row.value_high_usd)}`)
        )
      ),
      el('div', { className: 'formula-box' }, deriv.formula)
    ));

    const catPeers = R.live.filter(p => p.category === row.category);
    const compsCard = el('div', { className: 'detail-card' },
      el('h3', { className: 'card-title' }, `Traded Comps (${row.category || 'Global'})`, el('span', { className: 'val-sub' }, `${catPeers.length} ${catPeers.length === 1 ? 'peer' : 'peers'}`))
    );
    if (catPeers.length === 0) {
      compsCard.appendChild(el('p', { className: 'text-muted' },
        `No protocols in "${row.category}" currently trade a token. Model falls back to global median ratio of ${bench.benchmark.toFixed(4)}x.`
      ));
    } else {
      compsCard.appendChild(el('table', { className: 'comps-table' },
        el('thead', {}, el('tr', {}, el('th', {}, 'Peer Protocol'), el('th', { className: 'num' }, 'TVL'), el('th', { className: 'num' }, 'Market Cap'), el('th', { className: 'num' }, 'Mcap / TVL'))),
        el('tbody', {},
          el('tr', { className: 'comps-bench-row' },
            el('td', {}, el('strong', {}, '→ Category Benchmark Used')),
            el('td', { className: 'num' }, '—'),
            el('td', { className: 'num' }, '—'),
            el('td', { className: 'num' }, el('strong', {}, `${bench.benchmark.toFixed(3)}x`))
          ),
          ...catPeers.slice(0, 6).map(peer => el('tr', {},
            el('td', {}, el('span', { className: 'proto-name', title: peer.name }, peer.name), el('br'), el('small', { className: 'text-muted', title: peer.chains.join(', ') }, peer.chains.slice(0, 2).join(', '))),
            el('td', { className: 'num' }, fmtMoney(peer.tvl_usd)),
            el('td', { className: 'num' }, fmtMoney(peer.mcap_usd)),
            el('td', { className: 'num' }, `${peer.ratio.toFixed(3)}x`)
          ))
        )
      ));
    }
    grid1.appendChild(compsCard);
    view.appendChild(grid1);

    const grid2 = el('div', { className: 'detail-grid detail-grid-2col' });
    grid2.appendChild(el('div', { className: 'detail-card' },
      el('h3', { className: 'card-title' }, 'Launch Readiness Index', el('span', { className: 'val-sub' }, '0..100 Scorecard')),
      el('div', { className: 'readiness-meter-total' },
        el('div', { className: 'readiness-big-score' }, ready.score),
        el('div', {},
          el('strong', {}, ready.score >= 70 ? 'High Launch Propensity' : ready.score >= 50 ? 'Moderate Seasoning' : 'Incubation Phase'),
          el('p', { className: 'text-muted', style: 'font-size: 12px; margin-top: 2px;' }, 'Weighted blend of tenure, scale, velocity, multi-chain footprint, and fee mechanics.')
        )
      ),
      el('div', { className: 'readiness-bars-list' },
        bar('Track Record (30%)', ready.parts.track_record, `${fmtAge(row.age_days)} unissued`),
        bar('Scale relative to $1B (25%)', ready.parts.scale, `${fmtMoney(row.tvl_usd)} TVL`),
        bar('7d Velocity (20%)', ready.parts.growth, fmtPct(row.change_7d)),
        bar('Distribution Breadth (15%)', ready.parts.distribution, `${row.chains?.length || 1} chains`),
        bar('Fee Capture (10%)', ready.parts.fee_engine, ready.parts.fee_engine >= 0.9 ? 'Direct Fees' : 'Incidental')
      )
    ));

    const steps = farmPlan(row);
    grid2.appendChild(el('div', { className: 'detail-card' },
      el('h3', { className: 'card-title' }, 'Protocol Farm Plan', el('span', { className: 'val-sub' }, `${steps.length} Steps`)),
      el('ol', { className: 'farm-steps-list' }, steps.map((step, idx) => {
        const p = parseStep(step);
        return el('li', { className: 'farm-step-item' },
          el('div', { className: 'farm-step-header' },
            el('span', { className: 'farm-step-num' }, idx + 1),
            el('span', { className: 'farm-step-text' }, p.text)
          ),
          el('div', { className: 'farm-chips-row' },
            el('span', { className: 'chip-cost' }, p.cost),
            el('span', { className: 'chip-time' }, p.time)
          )
        );
      }))
    ));
    view.appendChild(grid2);
    container.appendChild(view);
  }

  function bar(label, frac, sublabel) {
    const pct = Math.min(100, Math.max(0, Math.round(frac * 100)));
    return el('div', { className: 'readiness-bar-row' },
      el('div', { className: 'readiness-bar-meta' }, el('span', {}, label), el('span', { className: 'text-muted' }, `${sublabel} (${pct}%)`)),
      el('div', { className: 'readiness-track' }, el('div', { className: 'readiness-fill', style: `width: ${pct}%;` }))
    );
  }

  // --- 3. Method View ---
  function renderMethodView() {
    document.title = 'Methodology — Lift-off Token Launch Radar';
    updateActiveNav('method');

    const container = document.getElementById('view-container');
    container.replaceChildren();
    const R = state.radar;

    container.appendChild(el('div', { className: 'method-view' },
      el('div', { className: 'method-section' },
        el('h2', { tabindex: '-1' }, 'Quantitative Valuation Methodology'),
        el('p', {}, 'The watchlist serves as the established capital floor, and the board comprehensively ranks every pre-token launch candidate the snapshot records. Protocols carry either a Watchlist badge (meeting the house capital floor) or a Candidate badge (launch candidate the house watchlist does not name — the snapshot rule left it out; it is ranked on the same model). Implied valuation is calibrated directly against traded peers rather than flat multiples.'),
        el('h3', {}, '1. Traded Peer Benchmark & Empirical Bayes Shrinkage'),
        el('p', {}, 'For every protocol with mcap_usd > 0 and tvl_usd > 0, we measure mcap_usd / tvl_usd. Outliers outside [0.02, 12] are pruned. For thin categories, the empirical Bayes shrinkage formula bench = (n * median_ratio + K * global_median) / (n + K) with K = 4 pulls small samples toward the global cross-universe median (clamped to [0.05, 3.5]).'),
        el('h3', {}, '2. Valuation Bands & Empirical Peer Depth'),
        el('p', {}, 'Each valuation includes an uncertainty range bounded by value_low_usd and value_high_usd derived from the 25th (Q1) and 75th (Q3) percentiles of traded peer multiples. Robust categories with 6+ traded peers produce tight interquartile bands. Moderate categories with 3–5 peers shrink toward the sector median. When comps are few or absent (<3 peers), the benchmark falls back to sector clusters, and sparse samples (<2 peers) widen the range by 0.6x low and 1.6x high to reflect wider dispersion.'),
        el('h3', {}, '3. Sector Fallback with Weighted Blending'),
        el('p', {}, 'When a specific category has fewer than 3 traded comps, the benchmark smoothly incorporates the broader sector fallback across 12 sector clusters via weighted blend (n * cat_median + 3 * sector_benchmark) / (n + 3). If sector data is also missing, it defaults to the global universe median.')
      ),
      el('div', { className: 'method-section' },
        el('h3', {}, '4. Velocity Tilt, Tenure Seasoning, and Multi-chain Breadth'),
        el('div', { className: 'method-formula-card' },
          'growthMult   = 1 + (clamp(change_7d, -50%, +100%) / 100) * 0.30\n' +
          'maturityMult = 0.70 + 0.30 * min(age_days, 1460) / 1460   (age null defaults to 365d)\n' +
          'breadthMult  = 1 + min(chains.length - 1, 4) * 0.03\n' +
          'implied_usd  = max(1, round(tvl_usd * bench * growthMult * maturityMult * breadthMult))'
        ),
        el('p', {}, 'Doubling TVL in 7 days adds a 30% premium. Running unissued for years rewards proven protocol-market fit up to 4 years. Multi-chain deployment adds up to 12%.')
      ),
      el('div', { className: 'method-section' },
        el('h3', {}, '5. Independent Launch Readiness Score (0..100)'),
        el('div', { className: 'method-formula-card' },
          'Readiness = 100 * (0.30 * age/1460 + 0.25 * scale + 0.20 * growth + 0.15 * distribution + 0.10 * fee_engine)'
        ),
        el('p', {}, 'Decoupled from valuation: assesses protocol maturity across tenure, capital scale, velocity, chains, and fee generation.')
      ),
      el('div', { className: 'method-section' },
        el('h3', {}, 'Calibrated Category Benchmarks Table'),
        el('div', { className: 'benchmarks-table-wrap' },
          el('table', { className: 'benchmarks-table' },
            el('thead', {}, el('tr', {}, el('th', {}, 'Category'), el('th', { className: 'num' }, 'Peers'), el('th', { className: 'num' }, 'Observed Median'), el('th', { className: 'num' }, 'Benchmark Used'), el('th', {}, 'Sample Comps'))),
            el('tbody', {}, (R.benchmarks || []).map(b => el('tr', {},
              el('td', {}, el('strong', {}, b.category === '*' ? 'Global Universe' : b.category)),
              el('td', { className: 'num' }, b.peers),
              el('td', { className: 'num' }, b.median_ratio !== null ? `${b.median_ratio.toFixed(4)}x` : '—'),
              el('td', { className: 'num' }, el('strong', {}, `${b.benchmark.toFixed(4)}x`)),
              el('td', { className: 'text-muted', title: (b.peer_names || []).join(', ') }, (b.peer_names || []).slice(0, 4).join(', ') + ((b.peer_names && b.peer_names.length > 4) ? '...' : ''))
            )))
          )
        )
      ),
      el('div', { className: 'method-section' },
        el('h3', {}, 'Disclosures and Snapshot Provenance'),
        el('p', {}, el('strong', {}, 'DefiLlama Source: '), R.source || 'Public DefiLlama snapshot.'),
        el('p', {}, el('strong', {}, 'Absence of Evidence: '), 'DefiLlama recording no token does not prove a protocol has no token.'),
        el('p', {}, el('strong', {}, 'Entry Claim: '), 'Implied value is this model\'s quantitative estimate, not financial advice.')
      )
    ));
  }

  // --- 4. Live Comps View ---
  function renderLiveCompsView() {
    document.title = 'Live Traded Peers — Lift-off';
    updateActiveNav('live');

    const container = document.getElementById('view-container');
    container.replaceChildren();
    const R = state.radar, f = state.liveFilters;

    const qLower = f.q.trim().toLowerCase();
    let list = R.live.filter(p => {
      if (f.cat !== 'all' && p.category !== f.cat) return false;
      if (qLower) {
        const str = `${p.name} ${p.slug} ${p.category} ${(p.chains || []).join(' ')}`.toLowerCase();
        if (!str.includes(qLower)) return false;
      }
      return true;
    });

    const dirMult = f.dir === 'asc' ? 1 : -1;
    list.sort((a, b) => {
      const S = { mcap: a.mcap_usd - b.mcap_usd, tvl: a.tvl_usd - b.tvl_usd, ratio: a.ratio - b.ratio, name: a.name.localeCompare(b.name) };
      const cmp = S[f.sort] ?? S.mcap;
      return cmp !== 0 ? cmp * dirMult : a.slug.localeCompare(b.slug);
    });

    container.appendChild(el('h2', { className: 'sr-only', tabindex: '-1' }, 'Traded Peer Comparisons'));

    const scrollBox = el('div', { className: 'table-scroll' },
      el('table', { className: 'radar-table' },
        el('thead', {}, el('tr', {},
          el('th', { className: 'live-col-rank' }, '#'),
          el('th', { className: 'live-col-proto' }, 'Traded Protocol'),
          el('th', { className: 'live-col-chains' }, 'Chains'),
          el('th', { className: 'live-col-tvl' }, 'TVL'),
          el('th', { className: 'live-col-mcap' }, 'Market Cap'),
          el('th', { className: 'live-col-ratio' }, 'Mcap / TVL')
        )),
        el('tbody', {}, list.map((peer, idx) => el('tr', {},
          el('td', { className: 'live-col-rank' }, el('span', { className: 'rank-badge' }, idx + 1)),
          el('td', { className: 'live-col-proto' },
            el('span', { className: 'proto-name', title: peer.name }, peer.name), el('br'),
            el('small', { className: 'text-muted', title: peer.category || 'Uncategorized' }, peer.category || 'Uncategorized')
          ),
          el('td', { className: 'live-col-chains' }, (peer.chains || []).slice(0, 2).map(c => el('span', { className: 'chain-chip', title: c }, c))),
          el('td', { className: 'live-col-tvl num-cell' }, fmtMoney(peer.tvl_usd)),
          el('td', { className: 'live-col-mcap num-cell' }, el('strong', { style: 'color: var(--val-accent);' }, fmtMoney(peer.mcap_usd))),
          el('td', { className: 'live-col-ratio' }, el('span', { className: 'growth-pill growth-neutral' }, `${peer.ratio.toFixed(3)}x`))
        )))
      )
    );

    container.appendChild(el('div', { className: 'live-view' },
      el('div', { className: 'toolbar' },
        el('div', { className: 'ctrl-field ctrl-search' },
          el('label', { htmlFor: 'live-q', className: 'ctrl-label' }, 'Search'),
          el('input', {
            id: 'live-q', className: 'ctrl-input', type: 'search',
            placeholder: 'Search traded protocol, category, chain...', value: f.q,
            oninput: (e) => { f.q = e.target.value; renderLiveCompsView(); }
          })
        ),
        selField('live-cat', 'Category', f.cat, [['all', 'All Categories'], ...R.categories.map(c => [c, c])], (e) => { f.cat = e.target.value; renderLiveCompsView(); }),
        selField('live-sort', 'Sort', f.sort, [['mcap', 'Market Cap'], ['tvl', 'TVL'], ['ratio', 'Mcap / TVL Ratio'], ['name', 'Protocol Name']], (e) => { f.sort = e.target.value; renderLiveCompsView(); }),
        el('button', {
          type: 'button', className: 'ctrl-btn',
          onclick: () => { f.dir = f.dir === 'desc' ? 'asc' : 'desc'; renderLiveCompsView(); }
        }, f.dir === 'desc' ? '▼ Desc' : '▲ Asc'),
        el('div', { className: 'result-count tabular' }, `Showing ${list.length} of ${R.live.length} traded peers`)
      ),
      el('div', { className: 'board-container' }, scrollBox)
    ));
  }

  // --- Router ---
  function route() {
    if (!state.radar) {
      renderMissingDataView();
      return;
    }
    const hash = window.location.hash || '#/';
    const clean = hash.split('?')[0];

    if (clean === '#/method') renderMethodView();
    else if (clean === '#/live') renderLiveCompsView();
    else if (clean.startsWith('#/p/')) renderDetailView(decodeURIComponent(clean.slice(4)));
    else renderBoardView();

    focusMainHeading();
  }

  // --- Init ---
  function init() {
    if (typeof window.RADAR === 'object' && window.RADAR !== null) {
      state.radar = window.RADAR;
      const R = state.radar;
      const setVal = (id, v) => { const n = document.getElementById(id); if (n) n.textContent = v; };
      setVal('stat-asof', R.as_of || '—');
      setVal('stat-read', `${R.snapshot_total || 758} protocols`);
      setVal('stat-floor', fmtMoney(R.floor_usd || 50000000));
      const cov = `${R.watchlist_covered || R.watchlist_size || 40}/${R.watchlist_size || 40}`;
      const isFull = (R.watchlist_covered || 0) >= (R.watchlist_size || 40);
      setVal('stat-watch', isFull ? `${cov} ✓` : cov);
      setVal('stat-board', `${R.board_size || 196} of ${R.pre_token_total || 342} pre-token`);
      setVal('stat-live', `${R.live_size || 40} comps`);
      setVal('stat-ver', R.model_version || 'lift-off-1');

      const foot = document.getElementById('foot-provenance');
      if (foot && R.source) foot.textContent = `Snapshot source: ${R.source}`;
    }

    parseQueryParams();
    route();
    isInitialLoad = false;

    window.addEventListener('hashchange', route);
    window.addEventListener('popstate', route);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

})();
