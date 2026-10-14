/**
 * Reporta a Precios Tandil el resultado REAL de cada scraper y del finalize de esta corrida.
 * Lee estados y duraciones de la API de GitHub Actions y, si existe, los conteos que dejÃ³
 * serving-sync.mjs en sync-counts.json. No inventa valores: si algo no se conoce, va vacÃ­o.
 *
 * Env: GITHUB_TOKEN, GITHUB_REPOSITORY, GITHUB_RUN_ID, SCRAPE_REPORT_SECRET, [REPORT_URL]
 */
import { existsSync, readFileSync } from 'node:fs';

const { GITHUB_TOKEN, GITHUB_REPOSITORY, GITHUB_RUN_ID, SCRAPE_REPORT_SECRET } = process.env;
const REPORT_URL = process.env.REPORT_URL || 'https://preciostandil.com/api/public/scrape-runs';
if (!SCRAPE_REPORT_SECRET) throw new Error('falta SCRAPE_REPORT_SECRET');

const SOURCES = ['carrefour', 'vea', 'dia', 'monarca', 'golopolis', 'cooperativa-obrera'];

const res = await fetch(
  `https://api.github.com/repos/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}/jobs?per_page=100`,
  { headers: { authorization: `Bearer ${GITHUB_TOKEN}`, accept: 'application/vnd.github+json' } },
);
if (!res.ok) throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
const { jobs } = await res.json();

const counts = existsSync('sync-counts.json') ? JSON.parse(readFileSync('sync-counts.json', 'utf8')) : null;

const statusOf = (job) =>
  !job ? 'failed' : job.conclusion === 'success' ? 'success' : job.conclusion === 'skipped' || job.conclusion === 'cancelled' ? 'failed' : job.conclusion ? 'failed' : 'partial';

const dur = (j) => (j?.started_at && j?.completed_at ? Math.round((Date.parse(j.completed_at) - Date.parse(j.started_at)) / 1000) : null);

const failedStep = (j) => j?.steps?.find((s) => s.conclusion === 'failure')?.name ?? null;

const runs = [];
for (const src of SOURCES) {
  const job = jobs.find((j) => j.name.includes(`scrape-${src}`) || j.name === `scrape (${src})`);
  const c = counts?.byStore?.[src];
  let status = statusOf(job);
  if (status === 'success' && counts && !c?.prices) status = 'partial'; // terminÃ³ pero no aportÃ³ precios
  runs.push({
    github_run_id: String(GITHUB_RUN_ID),
    source: src,
    status,
    started_at: job?.started_at ?? null,
    finished_at: job?.completed_at ?? null,
    duration_seconds: dur(job),
    products_count: c?.products ?? null,
    prices_count: c?.prices ?? null,
    discarded_count: c?.discarded ?? null,
    error_message: !job ? 'job no encontrado en la corrida' : status !== 'success' ? `${job.conclusion ?? 'sin terminar'}${failedStep(job) ? ` en paso "${failedStep(job)}"` : ''}` : null,
    details: { job_url: job?.html_url ?? null },
  });
}

const fin = jobs.find((j) => j.name.startsWith('finalize') || j.name.startsWith('sync'));
runs.push({
  github_run_id: String(GITHUB_RUN_ID),
  source: 'sync',
  status: statusOf(fin),
  started_at: fin?.started_at ?? null,
  finished_at: fin?.completed_at ?? null,
  duration_seconds: dur(fin),
  products_count: counts?.products ?? null,
  prices_count: counts?.offers ?? null,
  discarded_count: null,
  error_message: fin && fin.conclusion !== 'success' ? `${fin.conclusion ?? 'sin terminar'}${failedStep(fin) ? ` en paso "${failedStep(fin)}"` : ''}` : !fin ? 'job no encontrado' : null,
  details: { job_url: fin?.html_url ?? null, history_rows: counts?.history ?? null, closed_offers: counts?.closed ?? null },
});

const post = await fetch(REPORT_URL, {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${SCRAPE_REPORT_SECRET}` },
  body: JSON.stringify({ runs }),
});
console.log('reporte:', post.status, await post.text());
if (!post.ok) process.exit(1);
