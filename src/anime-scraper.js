const PROVIDERS = {
  solaris: './providers/solaris.js',
  nexus: './providers/nexus.js',
  prism: './providers/prism.js',
  lynx: './providers/lynx.js',
  orion: './providers/orion.js',
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
  async getEpisodes(providerId, anilistId) {
    const provider = await this.getProvider(providerId);
    if (typeof provider.getEpisodes !== 'function') {
      throw new Error(`Provider ${providerId} does not support getEpisodes directly.`);
    }
    return provider.getEpisodes(anilistId);
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
    if (providerId === 'nexus') matchedId = 'anidbapp';
    if (providerId === 'prism') matchedId = 'animegg';
    if (providerId === 'lynx') matchedId = 'anineko';
    if (providerId === 'orion') matchedId = 'reanime';

    const fakeUrl = `http://localhost/watch/${matchedId}/${anilistId}/${audio}/${matchedId}-${epNum}`;
    const req = new Request(fakeUrl);
    const response = await handler.fetch(req);

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Provider watch request failed: ${response.status} - ${errText}`);
    }

    return response.json();
  }

  /**
   * Get aggregated episodes listings from all active providers for an AniList ID
   */
  async getAggregatedEpisodes(anilistId) {
    const results = {};
    
    await Promise.all(
      Object.keys(PROVIDERS).map(async (providerId) => {
        try {
          const res = await this.getEpisodes(providerId, anilistId);
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
