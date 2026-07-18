const PROVIDERS = {
  megu: './providers/megu.js',
  solaris: './providers/solaris.js',
  lynx: './providers/lynx.js',
  frost: './providers/frost.js',
  lunar: './providers/lunar.js'
};

export class AnimeScraper {
  /**
   * Load the provider module dynamically
   */
  async getProvider(providerId) {
    const importPath = PROVIDERS[providerId];
    if (!importPath) {
      throw new Error(`Provider ${providerId} is not supported.`);
    }
    const module = await import(importPath);
    return module;
  }

  /**
   * Fetch episodes list for a specific provider and AniList ID
   */
  async getEpisodes(providerId, anilistId, ctx = {}) {
    const provider = await this.getProvider(providerId);
    if (typeof provider.getEpisodes !== 'function') {
      throw new Error(`Provider ${providerId} does not support getEpisodes directly.`);
    }
    return provider.getEpisodes(anilistId, ctx);
  }

  /**
   * Resolve streams and captions using the provider's native fetch implementation
   */
  async watch(providerId, anilistId, audio, epNum) {
    const provider = await this.getProvider(providerId);
    const handler = provider.default;
    if (!handler || typeof handler.fetch !== 'function') {
      throw new Error(`Provider ${providerId} default export does not have fetch handler.`);
    }

    // Construct request conforming to provider's RegExp matchers (base key used inside provider files)
    let matchedId = providerId;
    if (providerId === 'solaris') matchedId = 'anikoto';
    if (providerId === 'lynx') matchedId = 'anineko';

    const fakeUrl = `http://localhost/watch/${matchedId}/${anilistId}/${audio}/${matchedId}-${epNum}`;
    const req = new Request(fakeUrl);
    const response = await handler.fetch(req);

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Provider watch request failed: ${response.status} - ${errText}`);
    }

    let sourceData = await response.json();

    // Normalize nested responses (like anikoto/Solaris which returns { ssub: { streams, subtitles } })
    if (sourceData.ssub || sourceData.sdub) {
      const nested = sourceData.ssub || sourceData.sdub;
      sourceData = {
        streams: nested.streams || [],
        subtitles: nested.subtitles || nested.tracks || [],
        intro: nested.intro || null,
        outro: nested.outro || null,
        headers: nested.headers || sourceData.headers || {}
      };
    }

    // Standardize subtitles field
    if (sourceData && Array.isArray(sourceData.tracks) && !sourceData.subtitles) {
      sourceData.subtitles = sourceData.tracks;
    }

    // Distinguish each stream's category (sub, dub, softsub)
    if (sourceData && Array.isArray(sourceData.streams)) {
      const hasSubtitles = Array.isArray(sourceData.subtitles) && sourceData.subtitles.length > 0;
      sourceData.streams = sourceData.streams.map(src => {
        let category = 'sub';
        if (audio === 'dub' || src.audio === 'dub') {
          category = 'dub';
        } else if (hasSubtitles) {
          category = 'softsub';
        }
        return {
          ...src,
          category
        };
      });
    }

    return sourceData;
  }

  /**
   * Get aggregated episodes listings from all active providers for an AniList ID
   */
  async getAggregatedEpisodes(anilistId) {
    const results = {};
    const ctx = {};
    
    try {
      // 1. Prefetch AniZip
      const anizipRes = await fetch(`https://api.ani.zip/mappings?anilist_id=${anilistId}`);
      if (anizipRes.ok) {
        ctx.anizip = await anizipRes.json();
      }

      // 2. Pre-fetch Media from core (which manages its own inflight deduping)
      const { getMedia } = await import('./core/anilist.js');
      ctx.media = await getMedia(anilistId).catch(() => null);

      // 3. Pre-fetch Jikan Episodes to avoid 7 providers hammering Jikan simultaneously
      const malId = ctx.media?.idMal || ctx.anizip?.mappings?.mal_id;
      if (malId) {
        const jikanRes = await fetch(`https://api.jikan.moe/v4/anime/${malId}/episodes?page=1`);
        if (jikanRes.ok) {
          const jikanData = await jikanRes.json();
          let allEps = [...(jikanData.data || [])];
          const lastPage = jikanData.pagination?.last_visible_page || 1;
          if (lastPage > 1) {
            for (let i = 2; i <= lastPage; i++) {
              await new Promise(r => setTimeout(r, 340)); // Be nice to Jikan limits (3/sec)
              const pageRes = await fetch(`https://api.jikan.moe/v4/anime/${malId}/episodes?page=${i}`);
              if (pageRes.ok) {
                const pageData = await pageRes.json();
                allEps = allEps.concat(pageData.data || []);
              }
            }
          }
          ctx.jikanEps = allEps;
        }
      }
    } catch (e) {
      console.warn("[Scraper] Pre-fetch context failed:", e.message);
    }
    
    await Promise.all(
      Object.keys(PROVIDERS).map(async (providerId) => {
        try {
          const res = await this.getEpisodes(providerId, anilistId, ctx);
          if (res && res.episodes) {
            results[providerId] = {
              meta: res.meta || {},
              episodes: res.episodes
            };
          }
        } catch (err) {
          console.warn(`[Scraper] Failed to fetch episodes from ${providerId}:`, err.message);
        }
      })
    );

    return results;
  }
}
