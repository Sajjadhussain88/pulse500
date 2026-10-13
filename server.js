const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const CACHE_MS = Number(process.env.CACHE_MINUTES || 15) * 60 * 1000;
const REGIONS = (process.env.TREND_REGIONS || 'US,GB,IN,CA,AU').split(',').map(s => s.trim()).filter(Boolean);
let cache = { at: 0, trends: [], errors: [] };

const SAMPLE_TRENDS = [
  { title: 'AI agents', category: 'Technology', score: 96, change: '+12', description: 'Autonomous AI tools and assistants are becoming a major topic across technology and business.', source: 'Pulse500 sample data', regions: ['US','GB'], url: 'https://trends.google.com/trends/' },
  { title: 'Renewable energy storage', category: 'Science', score: 91, change: '+8', description: 'Battery storage and grid technology are attracting attention as clean-energy systems evolve.', source: 'Pulse500 sample data', regions: ['US','AU'], url: 'https://trends.google.com/trends/' },
  { title: 'Consumer loyalty', category: 'Business', score: 87, change: '+5', description: 'Brands are exploring new approaches to retention, customer trust and personalized experiences.', source: 'Pulse500 sample data', regions: ['GB','IN'], url: 'https://trends.google.com/trends/' },
  { title: 'Creator economy', category: 'Culture', score: 82, change: '+3', description: 'Creators are experimenting with new business models, formats and audience relationships.', source: 'Pulse500 sample data', regions: ['US','CA'], url: 'https://trends.google.com/trends/' },
  { title: 'Personal AI assistants', category: 'Technology', score: 78, change: '-4', description: 'Personalized AI tools are competing to become everyday digital companions.', source: 'Pulse500 sample data', regions: ['US','GB'], url: 'https://trends.google.com/trends/' },
  { title: 'Urban mobility', category: 'Science', score: 74, change: '+6', description: 'Cities are exploring transport systems and design that improve how people move.', source: 'Pulse500 sample data', regions: ['AU','CA'], url: 'https://trends.google.com/trends/' },
  { title: 'Small business automation', category: 'Business', score: 72, change: '+4', description: 'Small companies are adopting tools to simplify repetitive operations.', source: 'Pulse500 sample data', regions: ['IN','US'], url: 'https://trends.google.com/trends/' },
  { title: 'Digital wellbeing', category: 'Culture', score: 68, change: '-2', description: 'Online communities are discussing healthier relationships with devices and digital services.', source: 'Pulse500 sample data', regions: ['GB','CA'], url: 'https://trends.google.com/trends/' }
];

function decodeXml(s = '') {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}
function tag(block, name) {
  const re = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'i');
  const m = block.match(re); return m ? decodeXml(m[1]) : '';
}
function categoryFor(title, description = '') {
  const s = `${title} ${description}`.toLowerCase();
  if (/ai|software|app|smartphone|cyber|robot|tech|chip|google|apple|microsoft|openai|gaming|game/.test(s)) return 'Technology';
  if (/stock|market|business|company|econom|trade|brand|retail|finance|bank|ceo|startup|sales/.test(s)) return 'Business';
  if (/climate|energy|science|space|health|research|weather|earthquake|planet|solar|battery|environment/.test(s)) return 'Science';
  if (/music|movie|film|celebrity|fashion|sport|football|soccer|cricket|creator|viral|show|culture/.test(s)) return 'Culture';
  return 'World';
}
function trafficValue(text) {
  const m = String(text || '').replace(/,/g, '').match(/([\d.]+)\s*([KMB])?/i);
  if (!m) return 1;
  const n = Number(m[1]); const mult = ({K: 1000, M: 1000000, B: 1000000000})[(m[2] || '').toUpperCase()] || 1;
  return n * mult;
}
function scoreFor(traffic, regionCount) {
  const base = Math.min(88, 25 + Math.log10(Math.max(traffic, 1)) * 12);
  return Math.max(35, Math.min(99, Math.round(base + Math.min(10, (regionCount - 1) * 3))));
}
async function fetchRegion(region) {
  const url = `https://trends.google.com/trending/rss?geo=${encodeURIComponent(region)}`;
  const response = await fetch(url, { headers: { 'User-Agent': 'Pulse500/1.0 trend research website' }, signal: AbortSignal.timeout(9000) });
  if (!response.ok) throw new Error(`${region}: source returned ${response.status}`);
  const xml = await response.text();
  const blocks = xml.match(/<item(?:\s[^>]*)?>[\s\S]*?<\/item>/gi) || [];
  return blocks.map(block => {
    const title = tag(block, 'title');
    const description = tag(block, 'description');
    const pubDate = tag(block, 'pubDate');
    const link = tag(block, 'link') || 'https://trends.google.com/trends/';
    const traffic = tag(block, 'ht:approx_traffic') || tag(block, 'approx_traffic') || '';
    return { title, description, pubDate, link, traffic, region, trafficNumber: trafficValue(traffic) };
  }).filter(x => x.title);
}
async function getTrends(force = false) {
  if (!force && cache.trends.length && Date.now() - cache.at < CACHE_MS) return { ...cache, cached: true };
  const results = await Promise.allSettled(REGIONS.map(fetchRegion));
  const items = []; const errors = [];
  results.forEach((r, i) => { if (r.status === 'fulfilled') items.push(...r.value); else errors.push(`${REGIONS[i]}: ${r.reason.message}`); });
  if (!items.length) {
    if (cache.trends.length) return { ...cache, errors, stale: true };
    return { at: Date.now(), trends: SAMPLE_TRENDS.map((t, i) => ({ ...t, id: `sample-${i}`, regions: t.regions, updatedAt: new Date().toISOString(), demo: true })), errors, demo: true };
  }
  const grouped = new Map();
  for (const item of items) {
    const key = item.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const prev = grouped.get(key);
    if (!prev) grouped.set(key, { ...item, regions: [item.region], maxTraffic: item.trafficNumber, totalTraffic: item.trafficNumber });
    else { if (!prev.regions.includes(item.region)) prev.regions.push(item.region); prev.maxTraffic = Math.max(prev.maxTraffic, item.trafficNumber); prev.totalTraffic += item.trafficNumber; if (item.description.length > prev.description.length) prev.description = item.description; }
  }
  const trends = Array.from(grouped.values()).map((t, i) => ({
    id: `trend-${Buffer.from(t.title).toString('base64url').slice(0, 18)}`,
    title: t.title, description: t.description || `A topic currently appearing in Google Trends for ${t.regions.join(', ')}. Open the source to explore more context.`,
    category: categoryFor(t.title, t.description), score: scoreFor(t.totalTraffic, t.regions.length),
    change: t.regions.length > 1 ? `+${Math.min(18, (t.regions.length - 1) * 3 + 2)}` : 'New',
    source: 'Google Trends', regions: t.regions, url: `https://trends.google.com/trends/explore?q=${encodeURIComponent(t.title)}`,
    traffic: t.traffic, updatedAt: new Date().toISOString(), demo: false
  })).sort((a,b) => b.score - a.score).slice(0, 500).map((t, i) => ({ ...t, rank: i + 1 }));
  cache = { at: Date.now(), trends, errors };
  return { ...cache, cached: false, demo: false };
}
function send(res, status, data, contentType = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': contentType, 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' });
  res.end(contentType.startsWith('application/json') ? JSON.stringify(data) : data);
}
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' }); return res.end(); }
  if (url.pathname === '/api/health') return send(res, 200, { ok: true, service: 'Pulse500', timestamp: new Date().toISOString() });
  if (url.pathname === '/api/trends') {
    try {
      const data = await getTrends(url.searchParams.get('refresh') === '1');
      return send(res, 200, { updatedAt: new Date(data.at).toISOString(), count: data.trends.length, demo: !!data.demo, stale: !!data.stale, errors: data.errors, trends: data.trends });
    } catch (e) { return send(res, 500, { error: 'Unable to load trends', details: e.message }); }
  }
  if (url.pathname === '/api/config') return send(res, 200, { regions: REGIONS, refreshMinutes: CACHE_MS / 60000, sources: ['Google Trends RSS'], note: 'Availability and refresh rates depend on third-party source access.' });
  let filePath = path.join(PUBLIC_DIR, url.pathname === '/' ? 'index.html' : path.normalize(url.pathname).replace(/^([.][.][/\\])+/, ''));
  if (!filePath.startsWith(PUBLIC_DIR)) return send(res, 403, 'Forbidden', 'text/plain; charset=utf-8');
  fs.readFile(filePath, (err, data) => {
    if (err) return send(res, 404, 'Not found', 'text/plain; charset=utf-8');
    const ext = path.extname(filePath).toLowerCase();
    const types = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'application/javascript; charset=utf-8', '.svg':'image/svg+xml', '.png':'image/png', '.ico':'image/x-icon' };
    send(res, 200, data.toString(), types[ext] || 'application/octet-stream');
  });
});
server.listen(PORT, () => console.log(`Pulse500 running at http://localhost:${PORT}`));
