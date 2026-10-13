
const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const CACHE_MS = Number(process.env.CACHE_MINUTES || 15) * 60 * 1000;
const REGIONS = (process.env.TREND_REGIONS || 'US,GB,IN,CA,AU')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

let cache = { at: 0, trends: [], errors: [], demo: false };
let pendingFetch = null;

const SAMPLE_TRENDS = [
  { title: 'AI agents', category: 'Technology', description: 'Autonomous AI tools and assistants', regions: ['US', 'GB'] },
  { title: 'Renewable energy storage', category: 'Science', description: 'Battery storage and clean energy research', regions: ['US', 'AU'] },
  { title: 'Consumer loyalty', category: 'Business', description: 'Customer retention and brand strategy', regions: ['GB', 'IN'] },
  { title: 'Creator economy', category: 'Culture', description: 'Digital creators and entertainment', regions: ['US', 'CA'] },
  { title: 'Personal AI assistants', category: 'Technology', description: 'AI-powered digital assistants', regions: ['US', 'GB'] },
  { title: 'Urban mobility', category: 'Science', description: 'Transport and urban research', regions: ['AU', 'CA'] },
  { title: 'Small business automation', category: 'Business', description: 'Business operations and automation', regions: ['IN', 'US'] },
  { title: 'Digital wellbeing', category: 'Culture', description: 'Online lifestyles and digital culture', regions: ['GB', 'CA'] }
];

function decodeXml(s = '') {
  return String(s)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, n) =>
      String.fromCodePoint(parseInt(n, 16)))
    .replace(/&#(\d+);/g, (_, n) =>
      String.fromCodePoint(Number(n)))
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tag(block, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(
    `<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escaped}>`,
    'i'
  );
  const match = block.match(re);
  return match ? decodeXml(match[1]) : '';
}

// Category rules use word boundaries to avoid false matches.
// The title is given more weight than the description.
const CATEGORY_RULES = [
  {
    name: 'Business',
    patterns: [
      /\bstock(?:s)?\b/i,
      /\bshares?\b/i,
      /\bwall street\b/i,
      /\bnasdaq\b/i,
      /\bdow jones\b/i,
      /\bs&p 500\b/i,
      /\btrading\b/i,
      /\bfinancial\b/i,
      /\bfinance\b/i,
      /\bbanking?\b/i,
      /\bbanks?\b/i,
      /\binterest rates?\b/i,
      /\binflation\b/i,
      /\beconom(?:y|ic|ics)\b/i,
      /\bbusiness(?:es)?\b/i,
      /\bcompanies?\b/i,
      /\bcorporat(?:e|ion)\b/i,
      /\bmerger(?:s)?\b/i,
      /\bacquisition(?:s)?\b/i,
      /\bearnings?\b/i,
      /\brevenue\b/i,
      /\bprofit(?:s)?\b/i,
      /\bipo\b/i,
      /\bstartup(?:s)?\b/i,
      /\bretail(?:er|ers)?\b/i,
      /\bconsumer spending\b/i,
      /\btrade agreement\b/i,
      /\btariffs?\b/i,
      /\boil prices?\b/i,
      /\bcryptocurrency\b/i,
      /\bbitcoin\b/i,
      /\bethereum\b/i,
      /\bforex\b/i,
      /\bcurrency\b/i,
      /\bexchange rates?\b/i,
      /\bceo\b/i,
      /\btesla (?:stock|shares|earnings)\b/i
    ]
  },
  {
    name: 'Science',
    patterns: [
      /\bscience\b/i,
      /\bscientists?\b/i,
      /\bscientific\b/i,
      /\bresearch(?:ers)?\b/i,
      /\bdiscovery\b/i,
      /\bexperiment(?:s)?\b/i,
      /\bphysics\b/i,
      /\bchemistry\b/i,
      /\bbiology\b/i,
      /\bgenetics?\b/i,
      /\bgenome\b/i,
      /\bdna\b/i,
      /\bclinical trials?\b/i,
      /\bvaccines?\b/i,
      /\bmedical research\b/i,
      /\bhealth study\b/i,
      /\bdisease\b/i,
      /\bvirus\b/i,
      /\bnasa\b/i,
      /\bspacex\b/i,
      /\bspace mission\b/i,
      /\bspacecraft\b/i,
      /\bastronaut(?:s)?\b/i,
      /\bgalax(?:y|ies)\b/i,
      /\basteroid(?:s)?\b/i,
      /\bplanet(?:s)?\b/i,
      /\bsolar system\b/i,
      /\bclimate change\b/i,
      /\bglobal warming\b/i,
      /\brenewable energy\b/i,
      /\bsolar energy\b/i,
      /\bbattery research\b/i,
      /\bearthquake(?:s)?\b/i,
      /\bvolcano(?:es)?\b/i,
      /\benvironmental research\b/i,
      /\bquantum\b/i
    ]
  },
  {
    name: 'Culture',
    patterns: [
      /\bmovies?\b/i,
      /\bfilms?\b/i,
      /\bcinema\b/i,
      /\bhollywood\b/i,
      /\bbollywood\b/i,
      /\bnetflix\b/i,
      /\bdisney\b/i,
      /\btelevision\b/i,
      /\btv series\b/i,
      /\bepisodes?\b/i,
      /\bseasons?\s+\d+\b/i,
      /\bactors?\b/i,
      /\bactresses?\b/i,
      /\bcelebrit(?:y|ies)\b/i,
      /\bsingers?\b/i,
      /\bmusicians?\b/i,
      /\bconcert(?:s)?\b/i,
      /\bmusic\b/i,
      /\balbums?\b/i,
      /\bsongs?\b/i,
      /\bgrammy(?:s)?\b/i,
      /\boscar(?:s)?\b/i,
      /\bfashion\b/i,
      /\bdesigner(?:s)?\b/i,
      /\bfestival(?:s)?\b/i,
      /\bentertainment\b/i,
      /\binfluencers?\b/i,
      /\bcreators?\b/i,
      /\bviral video\b/i,
      /\btiktok\b/i,
      /\byoutube(?:r|rs)?\b/i,
      /\bfootball\b/i,
      /\bsoccer\b/i,
      /\bcricket\b/i,
      /\bbasketball\b/i,
      /\bbaseball\b/i,
      /\bhockey\b/i,
      /\btennis\b/i,
      /\bnba\b/i,
      /\bnfl\b/i,
      /\bnhl\b/i,
      /\bmlb\b/i,
      /\bfifa\b/i,
      /\buefa\b/i,
      /\bpremier league\b/i,
      /\bworld cup\b/i,
      /\bolympics?\b/i,
      /\bplayoffs?\b/i,
      /\bchampionship\b/i,
      /\bvs\.?\b/i,
      /\bmatch\b/i,
      /\btournament\b/i,
      /\bsports?\b/i
    ]
  },
  {
    name: 'Technology',
    patterns: [
      /\bartificial intelligence\b/i,
      /\bai\b/i,
      /\bchatgpt\b/i,
      /\bopenai\b/i,
      /\bmachine learning\b/i,
      /\bsoftware\b/i,
      /\bsmartphones?\b/i,
      /\biphone\b/i,
      /\bandroid\b/i,
      /\bapps?\b/i,
      /\bcybersecurity\b/i,
      /\bcyberattack\b/i,
      /\bhackers?\b/i,
      /\brobot(?:s|ics)?\b/i,
      /\btechnology\b/i,
      /\btech\b/i,
      /\bsemiconductor(?:s)?\b/i,
      /\bmicrochips?\b/i,
      /\bprocessors?\b/i,
      /\bnvidia\b/i,
      /\bmicrosoft\b/i,
      /\bgoogle\b/i,
      /\bapple (?:iphone|ios|device|event)\b/i,
      /\bcloud computing\b/i,
      /\bdata centers?\b/i,
      /\bprogramming\b/i,
      /\bblockchain\b/i,
      /\bvirtual reality\b/i,
      /\baugmented reality\b/i,
      /\bvideo games?\b/i,
      /\bplaystation\b/i,
      /\bxbox\b/i,
      /\bnintendo\b/i,
      /\bgaming\b/i
    ]
  }
];

function categoryFor(title, description = '') {
  const headline = String(title || '');
  const details = String(description || '');

  let bestCategory = 'World';
  let bestScore = 0;

  for (const rule of CATEGORY_RULES) {
    let score = 0;

    for (const pattern of rule.patterns) {
      if (pattern.test(headline)) score += 3;
      else if (pattern.test(details)) score += 1;
    }

    if (score > bestScore) {
      bestScore = score;
      bestCategory = rule.name;
    }
  }

  return bestCategory;
}

function trafficValue(text) {
  const match = String(text || '')
    .replace(/,/g, '')
    .match(/([\d.]+)\s*([KMB])?/i);

  if (!match) return 0;

  const number = Number(match[1]);
  const multipliers = {
    K: 1000,
    M: 1000000,
    B: 1000000000
  };

  return number * (multipliers[(match[2] || '').toUpperCase()] || 1);
}

// Pulse Score is an estimate, not an official Google Trends metric.
function scoreFor(traffic, regionCount) {
  const base = Math.min(
    88,
    25 + Math.log10(Math.max(traffic, 1)) * 12
  );

  return Math.max(
    35,
    Math.min(
      99,
      Math.round(base + Math.min(10, (regionCount - 1) * 3))
    )
  );
}

function trendUrl(title) {
  return 'https://trends.google.com/trends/explore?q=' +
    encodeURIComponent(title);
}

async function fetchRegion(region) {
  const feedUrl =
    'https://trends.google.com/trending/rss?geo=' +
    encodeURIComponent(region);

  const response = await fetch(feedUrl, {
    headers: {
      'User-Agent': 'Pulse500/1.0 trend research website'
    },
    signal: AbortSignal.timeout(9000)
  });

  if (!response.ok) {
    throw new Error(
      `${region}: source returned ${response.status}`
    );
  }

  const xml = await response.text();

  const blocks = xml.match(
    /<item(?:\s[^>]*)?>[\s\S]*?<\/item>/gi
  ) || [];

  return blocks.map(block => {
    const title = tag(block, 'title');
    const description = tag(block, 'description');
    const pubDate = tag(block, 'pubDate');
    const traffic = tag(block, 'ht:approx_traffic') ||
      tag(block, 'approx_traffic') || '';

    return {
      title,
      description,
      pubDate,
      traffic,
      region,
      trafficNumber: trafficValue(traffic)
    };
  }).filter(item => item.title);
}

async function getTrends(force = false) {
  if (
    !force &&
    cache.trends.length &&
    Date.now() - cache.at < CACHE_MS
  ) {
    return { ...cache, cached: true };
  }

  if (pendingFetch) return pendingFetch;

  pendingFetch = loadTrends();

  try {
    return await pendingFetch;
  } finally {
    pendingFetch = null;
  }
}

async function loadTrends() {
  const results = await Promise.allSettled(
    REGIONS.map(fetchRegion)
  );

  const items = [];
  const errors = [];

  results.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      items.push(...result.value);
    } else {
      errors.push(
        `${REGIONS[index]}: ${result.reason.message}`
      );
    }
  });

  if (!items.length) {
    if (cache.trends.length) {
      return {
        ...cache,
        errors,
        stale: true
      };
    }

    return {
      at: Date.now(),
      trends: SAMPLE_TRENDS.map((trend, index) => ({
        ...trend,
        id: `sample-${index}`,
        rank: index + 1,
        score: null,
        change: 'New',
        source: 'Pulse500 sample data',
        url: trendUrl(trend.title),
        updatedAt: new Date().toISOString(),
        demo: true
      })),
      errors,
      demo: true
    };
  }

  const grouped = new Map();

  for (const item of items) {
    const key = item.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();

    if (!key) continue;

    const previous = grouped.get(key);

    if (!previous) {
      grouped.set(key, {
        ...item,
        regions: [item.region],
        totalTraffic: item.trafficNumber
      });
    } else {
      if (!previous.regions.includes(item.region)) {
        previous.regions.push(item.region);
      }

      previous.totalTraffic += item.trafficNumber;

      if (item.description.length > previous.description.length) {
        previous.description = item.description;
      }
    }
  }

  const trends = Array.from(grouped.values())
    .map(trend => ({
      id: 'trend-' +
        Buffer.from(trend.title)
          .toString('base64url')
          .slice(0, 18),

      title: trend.title,

      description: trend.description ||
        `A topic appearing in Google Trends for ` +
        trend.regions.join(', ') + '.',

      category: categoryFor(
        trend.title,
        trend.description
      ),

      score: scoreFor(
        trend.totalTraffic,
        trend.regions.length
      ),

      // Actual momentum requires historical observations.
      change: 'New',

      source: 'Google Trends',

      regions: trend.regions,

      url: trendUrl(trend.title),

      traffic: trend.traffic,

      updatedAt: new Date().toISOString(),

      demo: false
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 500)
    .map((trend, index) => ({
      ...trend,
      rank: index + 1
    }));

  cache = {
    at: Date.now(),
    trends,
    errors,
    demo: false
  };

  return {
    ...cache,
    cached: false,
    demo: false
  };
}

function send(
  res,
  status,
  data,
  contentType = 'application/json; charset=utf-8'
) {
  res.writeHead(status, {
    'Content-Type': contentType,
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store'
  });

  res.end(
    contentType.startsWith('application/json')
      ? JSON.stringify(data)
      : data
  );
}

const server = http.createServer(async (req, res) => {
  const url = new URL(
    req.url,
    `http://${req.headers.host || 'localhost'}`
  );

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    return res.end();
  }

  if (url.pathname === '/api/health') {
    return send(res, 200, {
      ok: true,
      service: 'Pulse500',
      timestamp: new Date().toISOString()
    });
  }

  if (url.pathname === '/api/trends') {
    try {
      const data = await getTrends(
        url.searchParams.get('refresh') === '1'
      );

      return send(res, 200, {
        updatedAt: new Date(data.at).toISOString(),
        count: data.trends.length,
        demo: !!data.demo,
        stale: !!data.stale,
        errors: data.errors,
        trends: data.trends
      });
    } catch (error) {
      return send(res, 500, {
        error: 'Unable to load trends',
        details: error.message
      });
    }
  }

  if (url.pathname === '/api/config') {
    return send(res, 200, {
      regions: REGIONS,
      refreshMinutes: CACHE_MS / 60000,
      sources: ['Google Trends RSS'],
      note:
        'Pulse Scores are estimates, not official Google Trends scores. ' +
        'Availability depends on third-party source access.'
    });
  }

  const requestedPath =
    url.pathname === '/' ? '/index.html' : url.pathname;

  let decodedPath;

  try {
    decodedPath = decodeURIComponent(requestedPath);
  } catch {
    return send(
      res, 400, 'Bad request', 'text/plain; charset=utf-8'
    );
  }

  const filePath = path.resolve(
    PUBLIC_DIR,
    '.' + decodedPath
  );

  if (
    filePath !== PUBLIC_DIR &&
    !filePath.startsWith(PUBLIC_DIR + path.sep)
  ) {
    return send(
      res, 403, 'Forbidden', 'text/plain; charset=utf-8'
    );
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      return send(
        res, 404, 'Not found', 'text/plain; charset=utf-8'
      );
    }

    const ext = path.extname(filePath).toLowerCase();

    const types = {
      '.html': 'text/html; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.svg': 'image/svg+xml',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.ico': 'image/x-icon'
    };

    res.writeHead(200, {
      'Content-Type':
        types[ext] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    });

    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(
    `Pulse500 running at http://localhost:${PORT}`
  );
});
