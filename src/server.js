import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { AnimeScraper } from './anime-scraper.js';
import { AnivexaProxy } from './anivexa-proxy.js';

const app = new Hono();
const scraper = new AnimeScraper();
const PORT = 4000;

// Enable CORS
app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'OPTIONS'],
}));

// Helper to get the base URL of the incoming request
const getBaseUrl = (c) => {
  const host = c.req.header('host') || `localhost:${PORT}`;
  const protocol = c.req.header('x-forwarded-proto') || (host.includes('localhost') ? 'http' : 'https');
  return `${protocol}://${host}`;
};

// Route: Get Aggregated Episodes listings from all scrapers
app.get('/api/episodes/:anilistId', async (c) => {
  const anilistId = c.req.param('anilistId');
  try {
    const data = await scraper.getAggregatedEpisodes(anilistId);
    return c.json(data);
  } catch (err) {
    return c.json({ error: err.message }, 500);
  }
});

// Route: Resolve Stream Sources & Subtitles directly from Provider scraper
app.get('/api/watch/:providerId/:anilistId/:audio/:epNum', async (c) => {
  const providerId = c.req.param('providerId');
  const anilistId = c.req.param('anilistId');
  const audio = c.req.param('audio');
  const epNum = c.req.param('epNum');
  const baseUrl = getBaseUrl(c);

  try {
    let sourceData = await scraper.watch(providerId, anilistId, audio, epNum);

    // Rewrite HLS links and Subtitles to run through our local proxy
    if (sourceData) {
      const referer = sourceData.headers?.Referer || sourceData.headers?.referer || '';
      
      if (Array.isArray(sourceData.streams)) {
        sourceData.streams = sourceData.streams.map(src => {
          const url = src.url || src.file;
          if (url && (src.type === 'video/mpegurl' || src.type === 'hls' || url.includes('.m3u8'))) {
            const proxiedUrl = `${baseUrl}/proxy?url=${encodeURIComponent(url)}&ref=${encodeURIComponent(referer)}`;
            return {
              ...src,
              originalUrl: url,
              url: proxiedUrl,
              file: proxiedUrl,
              proxied: true
            };
          }
          return src;
        });
      }

      if (Array.isArray(sourceData.subtitles)) {
        sourceData.subtitles = sourceData.subtitles.map(sub => {
          const url = sub.file || sub.url;
          if (url && (url.startsWith('http') || url.startsWith('//'))) {
            const absoluteUrl = url.startsWith('//') ? 'https:' + url : url;
            const proxiedUrl = `${baseUrl}/proxy?url=${encodeURIComponent(absoluteUrl)}&ref=${encodeURIComponent(referer)}`;
            return {
              ...sub,
              originalUrl: absoluteUrl,
              file: proxiedUrl,
              url: proxiedUrl,
              proxied: true
            };
          }
          return sub;
        });
      }
    }

    return c.json(sourceData);
  } catch (err) {
    return c.json({ error: err.message }, 500);
  }
});

// Route: Stream Proxy Bypass
app.get('/proxy', async (c) => {
  const url = c.req.query('url');
  const ref = c.req.query('ref');
  const baseUrl = getBaseUrl(c);

  if (!url) {
    return c.text('Missing url parameter', 400);
  }

  const proxyBaseUrl = `${baseUrl}/proxy`;
  const result = await AnivexaProxy.handleRequest(url, ref, proxyBaseUrl);

  // Set response headers
  Object.entries(result.headers).forEach(([k, v]) => {
    c.header(k, v);
  });

  c.status(result.status);

  // Return stream body, binary body, or text
  if (result.body instanceof Uint8Array || (result.body && typeof result.body === 'object')) {
    return c.body(result.body);
  }
  return c.text(result.body);
});

console.log(`Standalone Anime Scraper Microservice running on http://localhost:${PORT}`);

export default {
  port: PORT,
  fetch: app.fetch,
};
