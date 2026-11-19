#!/usr/bin/env node
// Generates the terminal-style SVG cards for the GitHub profile README.
//
//   node scripts/generate.mjs           fetch live data if GITHUB_TOKEN is set, else use sample-data.json
//   node scripts/generate.mjs --sample  force sample-data.json
//   node scripts/generate.mjs --dump    fetch live data and also save it to sample-data.json
//
// Node 20+, no dependencies.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = join(ROOT, 'assets');
const args = new Set(process.argv.slice(2));

// ---------------------------------------------------------------------------
// Theme + text metrics
// ---------------------------------------------------------------------------

const C = {
  frame: '#0d1117',
  card: '#0b0f14',
  border: '#21262d',
  text: '#c9d1d9',
  bright: '#e6edf3',
  muted: '#8b949e',
  faint: '#484f58',
  blue: '#58a6ff',
  green: '#3fb950',
  track: '#30363d',
  red: '#ff5f56',
  yellow: '#ffbd2e',
  dot3: '#27c93f',
  heat: ['#161b22', '#0e4429', '#006d32', '#26a641', '#39d353'],
};

const FONT = "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace";
const WIDTH = 840;
const PAD = 8; // frame padding around the card
const INSET = 28; // content inset inside the card
const BAR_H = 34; // macOS title bar height

/** Monospace advance width: ~0.6em (7.2px at 12px). */
const cw = (size) => size * 0.6;

const esc = (s) =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const trunc = (s, n) => {
  s = String(s ?? '');
  return s.length <= n ? s : n <= 1 ? s.slice(0, n) : s.slice(0, n - 1) + '…';
};

const fmt = (n) => Number(n ?? 0).toLocaleString('en-US');

function wrap(text, cols) {
  const lines = [];
  let cur = '';
  for (const word of String(text).split(/\s+/).filter(Boolean)) {
    if (!cur) cur = word;
    else if (cur.length + 1 + word.length <= cols) cur += ' ' + word;
    else {
      lines.push(cur);
      cur = word;
    }
  }
  if (cur) lines.push(cur);
  return lines.map((l) => trunc(l, cols));
}

// ---------------------------------------------------------------------------
// SVG primitives
// ---------------------------------------------------------------------------

/**
 * One line of monospace text built from colored segments.
 * Every run of non-space characters becomes its own <text> at an absolute
 * column (x = col * 0.6em) with a pinned textLength, so alignment never
 * depends on whitespace handling or the viewer's fallback font width.
 */
function line(x, y, segs, { size = 12, anchor } = {}) {
  const chars = segs.reduce((n, s) => n + [...s.t].length, 0);
  if (!chars) return '';
  const w = cw(size);
  const start = anchor === 'end' ? x - chars * w : x;
  let col = 0;
  let out = '';
  for (const s of segs) {
    const glyphs = [...s.t];
    for (const m of s.t.matchAll(/\S+(?: \S+)*/g)) {
      const offset = [...s.t.slice(0, m.index)].length;
      const len = [...m[0]].length;
      const weight = s.w ? ` font-weight="${s.w}"` : '';
      out += `<text x="${(start + (col + offset) * w).toFixed(1)}" y="${y}" font-size="${size}" fill="${s.c ?? C.text}"${weight} textLength="${(len * w).toFixed(1)}" lengthAdjust="spacingAndGlyphs">${esc(m[0])}</text>`;
    }
    col += glyphs.length;
  }
  return out;
}

const promptSegs = (cfg, cmd, full = false) => [
  ...(full
    ? [
        { t: cfg.handle, c: C.green, w: 700 },
        { t: '@', c: C.muted },
        { t: cfg.host, c: C.green, w: 700 },
        { t: ':', c: C.muted },
        { t: '~', c: C.blue },
        { t: '$', c: C.muted },
      ]
    : [{ t: '$', c: C.green, w: 700 }]),
  ...(cmd ? [{ t: ' ' + cmd, c: C.bright }] : [{ t: ' ' }]),
];

/** Prompt line, optionally followed by a blinking block cursor. */
function prompt(cfg, x, y, cmd, { full = false, cursor = false } = {}) {
  const segs = promptSegs(cfg, cmd, full);
  const chars = segs.reduce((n, s) => n + s.t.length, 0);
  let out = line(x, y, segs);
  if (cursor) {
    const cx = x + chars * cw(12) + (cmd ? 4 : 0);
    out += `<rect x="${cx.toFixed(1)}" y="${y - 10}" width="${cw(12).toFixed(1)}" height="13" fill="${C.green}"><animate attributeName="opacity" values="1;0" dur="1.1s" calcMode="discrete" repeatCount="indefinite"/></rect>`;
  }
  return out;
}

/** Outer frame + window card + macOS title bar. */
function card({ height, title, body, label }) {
  const w = WIDTH - PAD * 2;
  const h = height - PAD * 2;
  const total = height;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${total}" viewBox="0 0 ${WIDTH} ${total}" role="img" aria-label="${esc(label)}">
<title>${esc(label)}</title>
<rect width="${WIDTH}" height="${total}" fill="${C.frame}"/>
<g font-family="${esc(FONT)}">
<rect x="${PAD + 0.5}" y="${PAD + 0.5}" width="${w - 1}" height="${h - 1}" rx="10" fill="${C.card}" stroke="${C.border}"/>
<circle cx="${PAD + 20}" cy="${PAD + BAR_H / 2}" r="6" fill="${C.red}"/>
<circle cx="${PAD + 40}" cy="${PAD + BAR_H / 2}" r="6" fill="${C.yellow}"/>
<circle cx="${PAD + 60}" cy="${PAD + BAR_H / 2}" r="6" fill="${C.dot3}"/>
${title ? `<text x="${WIDTH / 2}" y="${PAD + BAR_H / 2 + 4}" font-size="11" fill="${C.muted}" text-anchor="middle">${esc(title)}</text>` : ''}
<line x1="${PAD + 1}" y1="${PAD + BAR_H + 0.5}" x2="${PAD + w - 1}" y2="${PAD + BAR_H + 0.5}" stroke="${C.border}"/>
${body}
</g>
</svg>
`;
}

/** Small rounded language badge with a 1–2 letter glyph. */
const GLYPHS = {
  JavaScript: 'JS', TypeScript: 'TS', Go: 'Go', Svelte: 'S', HTML: '<>', CSS: '#', SCSS: '#',
  Python: 'Py', Rust: 'Rs', Lua: 'Lu', Shell: '$', PHP: 'P', Java: 'J', C: 'C', 'C++': '++',
  Vue: 'V', Astro: 'A', Dockerfile: 'D', Nix: 'N', 'Vim Script': 'v',
};
function luminance(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return 0;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function badge(x, y, size, lang) {
  const color = lang?.color || C.faint;
  const glyph = lang ? GLYPHS[lang.name] ?? lang.name.slice(0, 2) : '·';
  const fg = luminance(color) > 0.55 ? '#0d1117' : '#ffffff';
  const fs = glyph.length > 1 ? size * 0.5 : size * 0.62;
  return `<rect x="${x}" y="${y}" width="${size}" height="${size}" rx="4" fill="${color}"/><text x="${x + size / 2}" y="${(y + size / 2 + fs * 0.36).toFixed(1)}" font-size="${fs.toFixed(1)}" font-weight="700" fill="${fg}" text-anchor="middle">${esc(glyph)}</text>`;
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

function uptime(createdAt, now = new Date()) {
  const c = new Date(createdAt);
  let months = (now.getUTCFullYear() - c.getUTCFullYear()) * 12 + (now.getUTCMonth() - c.getUTCMonth());
  if (now.getUTCDate() < c.getUTCDate()) months--;
  months = Math.max(0, months);
  const y = Math.floor(months / 12);
  const m = months % 12;
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const parts = [];
  if (y) parts.push(plural(y, 'year'));
  if (m || !y) parts.push(plural(m, 'month'));
  return `${parts.join(', ')} on GitHub`;
}

function streaks(days) {
  const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date));
  let best = 0, run = 0, active = 0;
  for (const d of sorted) {
    if (d.count > 0) {
      active++;
      run++;
      best = Math.max(best, run);
    } else run = 0;
  }
  // Current streak: today may not have contributions yet, so it doesn't break the streak.
  let i = sorted.length - 1;
  if (i >= 0 && sorted[i].count === 0) i--;
  let current = 0;
  while (i >= 0 && sorted[i].count > 0) {
    current++;
    i--;
  }
  return { current, best, active };
}

function languagePercents(langs, top, exclude = []) {
  const ex = new Set(exclude.map((s) => s.toLowerCase()));
  const kept = langs.filter((l) => !ex.has(l.name.toLowerCase()));
  const total = kept.reduce((n, l) => n + l.bytes, 0) || 1;
  return kept
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, top)
    .map((l) => ({ ...l, pct: (l.bytes / total) * 100 }));
}

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

function neofetchCard(cfg, data, st) {
  const x0 = PAD + INSET;
  let y = PAD + BAR_H + 26;
  let body = prompt(cfg, x0, y, 'neofetch', { full: true });

  // Right column geometry.
  const rx = 316;
  const cols = Math.floor((WIDTH - PAD - INSET - rx) / cw(12)); // ~66
  const LH = 19;
  const top = y + 34;
  const rows = [];
  let ry = top;
  const push = (svg) => {
    rows.push(svg);
    ry += LH;
  };

  const kv = (key, value, width = cols, x = rx) => {
    const head = `${key}: `;
    const room = width - head.length - 3; // dots need at least 2 + 1 space
    const v = trunc(value, Math.max(4, room));
    const dots = Math.max(2, width - head.length - 1 - v.length);
    return line(x, ry, [
      { t: key, c: C.blue },
      { t: ': ', c: C.muted },
      { t: '.'.repeat(dots), c: C.faint },
      { t: ' ' + v, c: C.text },
    ]);
  };
  const section = (title) => {
    const t = `${title} `;
    const textW = t.length * cw(12);
    return (
      line(rx, ry, [{ t, c: C.blue, w: 700 }]) +
      `<line x1="${(rx + textW + 2).toFixed(1)}" y1="${ry - 3.5}" x2="${(rx + cols * cw(12)).toFixed(1)}" y2="${ry - 3.5}" stroke="${C.border}"/>`
    );
  };

  push(line(rx, ry, [
    { t: cfg.handle, c: C.green, w: 700 },
    { t: '@', c: C.muted },
    { t: cfg.host, c: C.green, w: 700 },
  ]));
  rows.push(`<line x1="${rx}" y1="${ry - 7.5}" x2="${(rx + cols * cw(12)).toFixed(1)}" y2="${ry - 7.5}" stroke="${C.faint}" stroke-dasharray="4 3"/>`);
  ry += 8;
  push(kv('Name', cfg.name));
  push(kv('Role', cfg.role));
  push(kv('Host', cfg.hostLabel));
  push(kv('Location', cfg.location));
  push(kv('Uptime', uptime(data.user.createdAt)));
  push(kv('Languages', cfg.languagesLine.join(', ')));
  ry += 8;
  push(section('About'));
  for (const l of wrap(cfg.about, cols)) push(line(rx, ry, [{ t: l, c: C.text }]));
  ry += 8;
  push(section('Contact'));
  push(kv('GitHub', `github.com/${cfg.username.toLowerCase()}`));
  push(kv('Website', cfg.website));
  ry += 8;
  push(section('GitHub Stats'));
  const half = Math.floor((cols - 3) / 2);
  const sepX = rx + (half + 1) * cw(12) + cw(12) / 2;
  const pair = (a, b) => {
    const left = kv(a[0], a[1], half, rx);
    const right = kv(b[0], b[1], half, rx + (half + 3) * cw(12));
    return left + `<text x="${sepX.toFixed(1)}" y="${ry}" font-size="12" fill="${C.faint}" text-anchor="middle">|</text>` + right;
  };
  push(pair(['Repos', fmt(data.user.repos)], ['Stars', fmt(data.user.stars)]));
  push(pair(['Followers', fmt(data.user.followers)], ['Following', fmt(data.user.following)]));
  push(pair(['Contributions', fmt(data.calendar.total)], ['Active days', fmt(st.active)]));
  push(pair(['Streak', `${st.current}d`], ['Best streak', `${st.best}d`]));

  const rightBottom = ry - LH;

  // ASCII art, vertically centred against the right column.
  const art = cfg.ascii;
  const aSize = 8.5;
  const aLH = 10.5;
  const artH = art.length * aLH;
  const artW = Math.max(...art.map((l) => l.length)) * cw(aSize);
  const ax = x0 + Math.max(0, (rx - 24 - x0 - artW) / 2);
  const ay = top - 12 + Math.max(0, (rightBottom - top + 12 - artH) / 2) + aLH;
  const art_svg = art
    .map((l, i) => line(+ax.toFixed(1), +(ay + i * aLH).toFixed(1), [{ t: l, c: C.green }], { size: aSize }))
    .join('\n');

  y = Math.max(rightBottom, ay + artH) + 36;
  body += '\n' + art_svg + '\n' + rows.join('\n') + '\n' + prompt(cfg, x0, y, '', { full: true, cursor: true });
  return card({ height: y + 26 + PAD, title: `${cfg.handle}@${cfg.host}: ~`, body, label: `neofetch: ${cfg.name}, ${cfg.role}, ${cfg.location}. ${data.user.repos} repos, ${data.user.stars} stars, ${data.calendar.total} contributions in the last year.` });
}

function projectsCard(cfg, data) {
  const x0 = PAD + INSET;
  const right = WIDTH - PAD - INSET;
  let y = PAD + BAR_H + 26;
  let body = prompt(cfg, x0, y, 'ls ~/projects');
  y += 18;
  const RH = 36;
  const metric = cfg.projectMetric === 'commits' ? 'commits' : 'stars';
  const rows = data.projects.map((p, i) => {
    const top = y + i * RH;
    const ty = top + RH / 2 + 4;
    const name = trunc(p.name, 22) + '/';
    const descX = x0 + 270;
    const descCols = Math.floor((right - 80 - descX) / cw(11));
    const n = metric === 'commits' ? p.commits : p.stars;
    return [
      i ? `<line x1="${x0}" y1="${top + 0.5}" x2="${right}" y2="${top + 0.5}" stroke="${C.border}"/>` : '',
      line(x0, ty, [{ t: 'drwx', c: C.faint }]),
      badge(x0 + 50, top + RH / 2 - 9, 18, p.language),
      line(x0 + 78, ty, [{ t: name, c: C.blue, w: 700 }]),
      p.description ? line(descX, ty, [{ t: trunc(p.description, descCols), c: C.muted }], { size: 11 }) : '',
      line(right, ty, [{ t: `+ ${fmt(n)}`, c: C.green }], { anchor: 'end' }),
    ].join('');
  });
  y += data.projects.length * RH + 30;
  body += '\n' + rows.join('\n') + '\n' + prompt(cfg, x0, y, '', { cursor: true });
  const label = `ls ~/projects: ${data.projects
    .map((p) => {
      const n = metric === 'commits' ? p.commits : p.stars;
      return `${p.name} (${n} ${n === 1 ? metric.slice(0, -1) : metric})`;
    })
    .join(', ')}`;
  return card({ height: y + 24 + PAD, title: '~/projects', body, label });
}

function languagesCard(cfg, data) {
  const x0 = PAD + INSET;
  const right = WIDTH - PAD - INSET;
  let y = PAD + BAR_H + 26;
  let body = prompt(cfg, x0, y, 'cat languages.txt');
  y += 22;
  const langs = languagePercents(data.languages, cfg.topLanguages ?? 5, cfg.excludeLanguages);
  const RH = 32;
  const barX = x0 + 170;
  const barW = right - 56 - barX;
  const rows = langs.map((l, i) => {
    const top = y + i * RH;
    const cy = top + RH / 2;
    const fill = Math.max(2, (barW * l.pct) / 100);
    return [
      badge(x0, cy - 9, 18, l),
      line(x0 + 28, cy + 4, [{ t: trunc(l.name, 18), c: C.bright, w: 700 }]),
      `<rect x="${barX}" y="${cy - 5}" width="${barW}" height="10" rx="5" fill="${C.track}"/>`,
      `<rect x="${barX}" y="${cy - 5}" width="${fill.toFixed(1)}" height="10" rx="5" fill="${l.color || C.muted}"/>`,
      line(right, cy + 4, [{ t: `${l.pct < 10 ? l.pct.toFixed(1) : Math.round(l.pct)}%`, c: C.muted }], { anchor: 'end' }),
    ].join('');
  });
  y += langs.length * RH + 28;
  body += '\n' + rows.join('\n') + '\n' + prompt(cfg, x0, y, '', { cursor: true });
  const label = `Top languages: ${langs.map((l) => `${l.name} ${Math.round(l.pct)}%`).join(', ')}`;
  return card({ height: y + 24 + PAD, title: 'languages.txt', body, label });
}

function gitlogCard(cfg, data, st) {
  const x0 = PAD + INSET;
  let y = PAD + BAR_H + 26;
  let body = prompt(cfg, x0, y, 'git log --since=26.weeks');

  const weeks = data.calendar.weeks.slice(-26);
  const CELL = 13, GAP = 3, STEP = CELL + GAP;
  const gx = x0;
  const gy = y + 40;

  // Month labels above the columns.
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  let lastMonth = -1, lastCol = -10;
  const labels = [];
  weeks.forEach((w, c) => {
    const m = new Date(w[0].date + 'T00:00:00Z').getUTCMonth();
    if (m !== lastMonth) {
      if (c - lastCol < 3 && lastCol === 0) labels.pop();
      if (c - lastCol >= 3 || lastCol === 0) {
        labels.push(`<text x="${gx + c * STEP}" y="${gy - 8}" font-size="10" fill="${C.muted}">${MONTHS[m]}</text>`);
        lastCol = c;
      }
      lastMonth = m;
    }
  });

  const cells = [];
  weeks.forEach((w, c) => {
    for (const d of w) {
      const r = new Date(d.date + 'T00:00:00Z').getUTCDay();
      cells.push(`<rect x="${gx + c * STEP}" y="${gy + r * STEP}" width="${CELL}" height="${CELL}" rx="2" fill="${C.heat[d.level] ?? C.heat[0]}"/>`);
    }
  });

  // Legend.
  const ly = gy + 7 * STEP + 14;
  const legendX = gx + 26 * STEP - GAP - (5 * 13 + 64);
  const legend =
    line(legendX, ly + 9, [{ t: 'less', c: C.muted }], { size: 10 }) +
    C.heat.map((col, i) => `<rect x="${legendX + 30 + i * 13}" y="${ly}" width="10" height="10" rx="2" fill="${col}"/>`).join('') +
    line(legendX + 30 + 5 * 13 + 4, ly + 9, [{ t: 'more', c: C.muted }], { size: 10 });

  // Stat blocks.
  const sx = gx + 26 * STEP + 56;
  const commitsYear = (() => {
    const year = new Date(data.generatedAt ?? Date.now()).getUTCFullYear().toString();
    return data.calendar.weeks.flat().filter((d) => d.date.startsWith(year)).reduce((n, d) => n + d.count, 0);
  })();
  const stat = (i, label, value) => {
    const by = gy + 4 + i * 42;
    return (
      `<text x="${sx}" y="${by}" font-size="10" fill="${C.muted}" letter-spacing="1.5">${esc(label)}</text>` +
      line(sx, by + 22, [{ t: value, c: C.bright, w: 700 }], { size: 18 })
    );
  };
  const stats = [
    stat(0, 'STREAK', `${st.current} day${st.current === 1 ? '' : 's'}`),
    stat(1, 'LONGEST', `${st.best} day${st.best === 1 ? '' : 's'}`),
    stat(2, 'COMMITS THIS YEAR', fmt(commitsYear)),
  ].join('\n');

  y = ly + 48;
  body += '\n' + labels.join('') + '\n' + cells.join('') + '\n' + legend + '\n' + stats + '\n' + prompt(cfg, x0, y, '', { cursor: true });
  const label = `Contribution heatmap for the last 26 weeks. Current streak ${st.current} days, longest ${st.best} days, ${commitsYear} contributions this year.`;
  return card({ height: y + 24 + PAD, title: 'git log', body, label });
}

// ---------------------------------------------------------------------------
// GitHub GraphQL
// ---------------------------------------------------------------------------

async function gql(token, query, variables, { allowNotFound = false } = {}) {
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      Authorization: `bearer ${token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'profile-readme-cards',
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json().catch(() => ({}));
  const errors = (json.errors ?? []).filter((e) => !(allowNotFound && e.type === 'NOT_FOUND' && json.data));
  if (!res.ok || errors.length) {
    throw new Error(`GraphQL ${res.status}: ${JSON.stringify(json.errors ?? json).slice(0, 500)}`);
  }
  return json.data;
}

const LEVELS = { NONE: 0, FIRST_QUARTILE: 1, SECOND_QUARTILE: 2, THIRD_QUARTILE: 3, FOURTH_QUARTILE: 4 };

const USER_QUERY = `
query($login: String!, $after: String) {
  user(login: $login) {
    createdAt
    followers { totalCount }
    following { totalCount }
    pinnedItems(first: 6, types: REPOSITORY) { nodes { ... on Repository { name } } }
    contributionsCollection {
      contributionCalendar {
        totalContributions
        weeks { contributionDays { date contributionCount contributionLevel } }
      }
    }
    repositories(first: 100, after: $after, ownerAffiliations: OWNER, privacy: PUBLIC) {
      totalCount
      pageInfo { hasNextPage endCursor }
      nodes {
        name
        isFork
        stargazerCount
        languages(first: 20, orderBy: { field: SIZE, direction: DESC }) {
          edges { size node { name color } }
        }
      }
    }
  }
}`;

async function fetchData(token, cfg) {
  const login = cfg.username;
  let after = null;
  let first;
  const repos = [];
  do {
    const d = await gql(token, USER_QUERY, { login, after });
    if (!d.user) throw new Error(`User ${login} not found`);
    first ??= d.user;
    repos.push(...d.user.repositories.nodes);
    const pi = d.user.repositories.pageInfo;
    after = pi.hasNextPage ? pi.endCursor : null;
  } while (after);

  const langMap = new Map();
  for (const r of repos) {
    if (r.isFork) continue;
    for (const e of r.languages.edges) {
      const cur = langMap.get(e.node.name) ?? { name: e.node.name, color: e.node.color, bytes: 0 };
      cur.bytes += e.size;
      langMap.set(e.node.name, cur);
    }
  }

  // Pinned projects: config order wins, otherwise the profile's pinned items.
  const names = cfg.pinned?.length ? cfg.pinned : first.pinnedItems.nodes.map((n) => n.name);
  let projects = [];
  if (names.length) {
    const vars = Object.fromEntries(names.map((n, i) => [`n${i}`, n]));
    const q = `query($owner: String!, ${names.map((_, i) => `$n${i}: String!`).join(', ')}) {
${names.map((_, i) => `  r${i}: repository(owner: $owner, name: $n${i}) { ...R }`).join('\n')}
}
fragment R on Repository {
  name url description stargazerCount
  primaryLanguage { name color }
  defaultBranchRef { target { ... on Commit { history { totalCount } } } }
}`;
    // A missing/renamed repo comes back as null with a NOT_FOUND error; keep the rest.
    const d = await gql(token, q, { owner: login, ...vars }, { allowNotFound: true });
    names.forEach((n, i) => d[`r${i}`] || console.warn(`! pinned repo "${n}" not found, skipping`));
    projects = names
      .map((_, i) => d[`r${i}`])
      .filter(Boolean)
      .map((r) => ({
        name: r.name,
        url: r.url,
        description: r.description,
        stars: r.stargazerCount,
        commits: r.defaultBranchRef?.target?.history?.totalCount ?? 0,
        language: r.primaryLanguage,
      }));
  }

  const cal = first.contributionsCollection.contributionCalendar;
  return {
    generatedAt: new Date().toISOString(),
    user: {
      createdAt: first.createdAt,
      repos: first.repositories.totalCount,
      stars: repos.reduce((n, r) => n + r.stargazerCount, 0),
      followers: first.followers.totalCount,
      following: first.following.totalCount,
    },
    calendar: {
      total: cal.totalContributions,
      weeks: cal.weeks.map((w) =>
        w.contributionDays.map((d) => ({ date: d.date, count: d.contributionCount, level: LEVELS[d.contributionLevel] ?? 0 })),
      ),
    },
    projects,
    languages: [...langMap.values()].sort((a, b) => b.bytes - a.bytes),
  };
}

// ---------------------------------------------------------------------------
// README sync (keeps the plain-markdown project links in step with config)
// ---------------------------------------------------------------------------

async function syncReadme(cfg, data) {
  const path = join(ROOT, 'README.md');
  let md;
  try {
    md = await readFile(path, 'utf8');
  } catch {
    return;
  }
  const links = data.projects.map((p) => `<a href="${esc(p.url)}">${esc(p.name)}</a>`).join(' · ');
  const next = md.replace(
    /(<!-- projects:start -->)[\s\S]*?(<!-- projects:end -->)/,
    `$1\n${links}\n$2`,
  );
  if (next !== md) await writeFile(path, next);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const cfg = JSON.parse(await readFile(join(ROOT, 'config.json'), 'utf8'));
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  let data;
  if (token && !args.has('--sample')) {
    console.log(`Fetching live data for ${cfg.username}…`);
    data = await fetchData(token, cfg);
    if (args.has('--dump')) {
      await writeFile(join(ROOT, 'sample-data.json'), JSON.stringify(data, null, 2) + '\n');
      console.log('Wrote sample-data.json');
    }
  } else {
    console.log('No GITHUB_TOKEN, using sample-data.json');
    data = JSON.parse(await readFile(join(ROOT, 'sample-data.json'), 'utf8'));
    // Fill in project URLs if the sample omits them.
    for (const p of data.projects) p.url ??= `https://github.com/${cfg.username}/${p.name}`;
  }

  const st = streaks(data.calendar.weeks.flat());
  await mkdir(ASSETS, { recursive: true });
  const out = {
    'neofetch.svg': neofetchCard(cfg, data, st),
    'projects.svg': projectsCard(cfg, data),
    'languages.svg': languagesCard(cfg, data),
    'gitlog.svg': gitlogCard(cfg, data, st),
  };
  for (const [file, svg] of Object.entries(out)) {
    await writeFile(join(ASSETS, file), svg);
    const kb = Buffer.byteLength(svg) / 1024;
    console.log(`  assets/${file}  ${kb.toFixed(1)} KB${kb > 60 ? '  ⚠ over 60 KB' : ''}`);
  }
  await syncReadme(cfg, data);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
