import { AnimeScraper } from './src/anime-scraper.js';

async function main() {
  const scraper = new AnimeScraper();
  const anilistId = '151807'; // Solo Leveling

  console.log(`[Example] Testing Clean Restructured Scrapers...`);
  try {
    const targets = ['solaris', 'frost', 'lunar', 'lynx', 'prism'];
    
    for (const providerId of targets) {
      console.log(`\n-----------------------------------------`);
      console.log(`[Example] Resolving user-facing provider: "${providerId}"...`);
      try {
        const episodesData = await scraper.getEpisodes(providerId, anilistId);
        const subEpisodes = episodesData.episodes.sub || [];
        const ep1 = subEpisodes.find(e => Number(e.number) === 1);
        
        if (!ep1) {
          console.log(`[Example] Episode 1 not found for: ${providerId}`);
          continue;
        }
        
        const epId = ep1.sourceNumber || ep1.number;
        console.log(`[Example] Fetching watch links for ${providerId} - Episode 1 (ID/Num: ${epId})...`);
        
        const rawWatch = await scraper.watch(providerId, anilistId, 'sub', epId);
        
        // Normalize nested output (simulate what server.js does)
        let watchData = rawWatch;
        if (rawWatch.ssub || rawWatch.sdub) {
          const nested = rawWatch.ssub || rawWatch.sdub;
          watchData = {
            streams: nested.streams || [],
            subtitles: nested.subtitles || nested.tracks || []
          };
        }

        console.log(`[Example] watch() succeeded for ${providerId}!`);
        console.log(`[Example] Streams count: ${watchData.streams?.length || 0}`);
        console.log(`[Example] Sample Stream URL: ${watchData.streams?.[0]?.url || 'None'}`);
        console.log(`[Example] Subtitles count: ${watchData.subtitles?.length || 0}`);
      } catch (e) {
        console.log(`[Example] Resolution failed for ${providerId}: ${e.message}`);
      }
    }
  } catch (err) {
    console.error('[Example] Error:', err.message);
  }
}

main();
