import { getMedia } from '../core/anilist.js';
import { episodeMeta, expectedCount, json } from '../core/new-provider-utils.js';

const BASE = 'https://meguanime.com';
const CDN_BASE = 'https://cdn.meguanime.com';

// Fetch availability of a show on MeguAnime
async function checkAvailability(anilistId, malId, titles) {
  // Try all possible titles to find a match
  for (const title of titles) {
    try {
      const url = `${CDN_BASE}/aa/avail?al=${anilistId}&mal=${malId || ''}&title=${encodeURIComponent(title)}`;
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (res.ok) {
        const data = await res.json();
        if (data && data.matched) {
          return data; // returns { matched: true, sub: number, dub: number }
        }
      }
    } catch (e) {
      console.warn(`[Megu] Avail check failed for title "${title}":`, e.message);
    }
  }
  return null;
}

export async function getEpisodes(anilistId, ctx = {}) {
  const media = ctx.media ?? await getMedia(anilistId);
  const malId = media?.idMal || ctx.anizip?.mappings?.mal_id || '';
  
  // Extract all potential titles
  const titles = [];
  if (media?.title?.english) titles.push(media.title.english);
  if (media?.title?.romaji) titles.push(media.title.romaji);
  if (media?.title?.userPreferred) titles.push(media.title.userPreferred);
  if (ctx.anizip?.mappings?.title) titles.push(ctx.anizip.mappings.title);
  
  const uniqueTitles = [...new Set(titles.filter(Boolean))];
  
  // Check availability
  const avail = await checkAvailability(anilistId, malId, uniqueTitles);
  
  let subCount = 0;
  let dubCount = 0;
  
  if (avail && avail.matched) {
    subCount = avail.sub || 0;
    dubCount = avail.dub || 0;
  } else {
    // If not matched via availability endpoint, fallback to expected count from other metadata
    const expected = expectedCount(media, ctx.anizip, ctx.jikanEps) || 12;
    subCount = expected;
    dubCount = 0; // Default to 0 dubs for unmatched titles to avoid showing invalid dub options
  }
  
  const sub = [];
  const dub = [];
  
  for (let i = 1; i <= subCount; i++) {
    const meta = episodeMeta(i, ctx);
    sub.push({
      id: `watch/megu/${anilistId}/sub/megu-${i}`,
      number: i,
      title: meta?.title ?? `Episode ${i}`,
      duration: meta?.duration ?? null,
      filler: meta?.filler ?? false,
      uncensored: meta?.uncensored ?? false,
      description: meta?.description ?? null,
      image: meta?.image ?? null,
      airDate: meta?.airDate ?? null,
      audio: 'sub',
      sourceNumber: i
    });
  }
  
  for (let i = 1; i <= dubCount; i++) {
    const meta = episodeMeta(i, ctx);
    dub.push({
      id: `watch/megu/${anilistId}/dub/megu-${i}`,
      number: i,
      title: meta?.title ?? `Episode ${i}`,
      duration: meta?.duration ?? null,
      filler: meta?.filler ?? false,
      uncensored: meta?.uncensored ?? false,
      description: meta?.description ?? null,
      image: meta?.image ?? null,
      airDate: meta?.airDate ?? null,
      audio: 'dub',
      sourceNumber: i
    });
  }
  
  return {
    meta: {
      id: String(anilistId),
      title: media?.title?.english || media?.title?.romaji || 'Megu Show',
      source: 'megu',
      matchScore: avail?.matched ? 1 : 0.8,
      numbering: 'standard',
      episodeOffset: 0
    },
    episodes: { softsub: sub, dub }
  };
}

// Watch function to resolve streams
export async function scrapeEpisodeWatch(anilistId, epNum, audio) {
  const streams = [];
  const subtitles = [];
  let intro = null;
  let outro = null;
  
  const endpoints = [
    // 1. Miruro API (Source 1)
    `${BASE}/api/miruro?al=${anilistId}&ep=${epNum}&lang=${audio}`,
    // 2. Kiwi API (Source 2)
    `${BASE}/api/kiwi?al=${anilistId}&ep=${epNum}&lang=${audio}`,
  ];
  
  // Call all endpoints in parallel and collect whatever is available
  const results = await Promise.allSettled(
    endpoints.map(url => 
      fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
        .then(r => r.ok ? r.json() : null)
    )
  );
  
  results.forEach((res, index) => {
    if (res.status !== 'fulfilled' || !res.value) return;
    const data = res.value;
    const serverPrefix = index === 0 ? 'Megu-Source-1' : 'Megu-Source-2';
    
    // Extract stream url
    if (data.source) {
      streams.push({
        url: data.source,
        type: data.source.includes('.m3u8') ? 'hls' : 'embed',
        audio: audio,
        server: serverPrefix,
        referer: BASE
      });
    }
    
    // Extract qualities from Kiwi/others
    if (Array.isArray(data.qualities)) {
      data.qualities.forEach(q => {
        if (q.source) {
          streams.push({
            url: q.source,
            type: q.source.includes('.m3u8') ? 'hls' : 'embed',
            audio: audio,
            server: `${serverPrefix}-${q.label || 'unknown'}`,
            quality: q.label || 'unknown',
            referer: BASE
          });
        }
      });
    }
    
    // Extract other sources (like in Miruro)
    if (Array.isArray(data.sources)) {
      data.sources.forEach(src => {
        const url = src.source || src.url;
        if (url) {
          streams.push({
            url,
            type: url.includes('.m3u8') ? 'hls' : 'embed',
            audio: audio,
            server: serverPrefix,
            referer: BASE
          });
        }
      });
    }
    
    // Extract subtitles/tracks
    const tracks = data.tracks || data.subtitles || [];
    if (Array.isArray(tracks)) {
      tracks.forEach(track => {
        const file = track.file || track.url;
        if (file) {
          subtitles.push({
            file,
            label: track.label || 'Unknown',
            kind: track.kind || 'captions',
            default: track.default || false
          });
        }
      });
    }
    
    // Extract intro/outro
    if (data.intro && (data.intro.start || data.intro.end)) {
      intro = { start: Number(data.intro.start) || 0, end: Number(data.intro.end) || 0 };
    }
    if (data.outro && (data.outro.start || data.outro.end)) {
      outro = { start: Number(data.outro.start) || 0, end: Number(data.outro.end) || 0 };
    }
  });
  
  // Deduplicate streams by URL
  const seenUrls = new Set();
  const uniqueStreams = streams.filter(s => {
    if (seenUrls.has(s.url)) return false;
    seenUrls.add(s.url);
    return true;
  });
  
  // Deduplicate subtitles by file
  const seenFiles = new Set();
  const uniqueSubtitles = subtitles.filter(s => {
    if (seenFiles.has(s.file)) return false;
    seenFiles.add(s.file);
    return true;
  });
  
  return {
    streams: uniqueStreams,
    subtitles: uniqueSubtitles,
    intro,
    outro
  };
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET,OPTIONS',
          'Access-Control-Allow-Headers': '*'
        }
      });
    }
    try {
      const m = url.pathname.match(/^\/watch\/megu\/(\d+)\/(sub|dub)\/megu-(\d+)\/?$/);
      if (m) {
        const anilistId = m[1];
        const audio = m[2];
        const epNum = m[3];
        const watchData = await scrapeEpisodeWatch(anilistId, epNum, audio);
        return json({
          anilistId: Number(anilistId),
          episode: Number(epNum),
          providerEpisode: Number(epNum),
          audio,
          ...watchData
        });
      }
      return json({ error: 'Not found' }, 404);
    } catch (err) {
      return json({ error: err.message, stack: err.stack }, 500);
    }
  }
};
