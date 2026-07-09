/**
 * Anivexa Stream Proxy Utility (ESM version)
 */
export class AnivexaProxy {
  /**
   * Rewrite M3U8 manifest content to route sub-playlists and segments through local proxy
   * @param {string} manifestText 
   * @param {string} baseUrl 
   * @param {string} proxyBaseUrl e.g. "http://localhost:4000/proxy"
   * @param {string} referer 
   */
  static rewriteManifest(manifestText, baseUrl, proxyBaseUrl, referer) {
    const lines = manifestText.split('\n');
    const rewrittenLines = [];

    for (let line of lines) {
      line = line.trim();
      if (!line) {
        rewrittenLines.push('');
        continue;
      }

      if (line.startsWith('#')) {
        // Tag handling (like URI rewrite in #EXT-X-KEY or #EXT-X-MEDIA)
        if (line.includes('URI=')) {
          line = line.replace(/URI="([^"]+)"/g, (match, uri) => {
            const resolvedUri = new URL(uri, baseUrl).toString();
            const proxiedUrl = `${proxyBaseUrl}?url=${encodeURIComponent(resolvedUri)}&ref=${encodeURIComponent(referer)}`;
            return `URI="${proxiedUrl}"`;
          });
        }
        rewrittenLines.push(line);
      } else {
        // HLS URL Line (Segment or playlist file)
        const resolvedUrl = new URL(line, baseUrl).toString();
        const proxiedUrl = `${proxyBaseUrl}?url=${encodeURIComponent(resolvedUrl)}&ref=${encodeURIComponent(referer)}`;
        rewrittenLines.push(proxiedUrl);
      }
    }

    return rewrittenLines.join('\n');
  }

  /**
   * Handle the proxy fetch request
   * @param {string} targetUrl The target resource to fetch
   * @param {string} referer The referer header to send
   * @param {string} proxyBaseUrl The local proxy base url to rewrite paths in manifests
   */
  static async handleRequest(targetUrl, referer, proxyBaseUrl) {
    if (!targetUrl) {
      return { status: 400, body: 'Missing url parameter', headers: {} };
    }

    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    };

    if (referer) {
      headers['Referer'] = referer;
      // Derive Origin if possible
      try {
        const parsed = new URL(referer);
        headers['Origin'] = parsed.origin;
      } catch {}
    }

    try {
      const response = await fetch(targetUrl, { headers });

      if (!response.ok) {
        return {
          status: response.status,
          body: `Target server returned ${response.status}`,
          headers: { 'Content-Type': 'text/plain' }
        };
      }

      const contentType = response.headers.get('Content-Type') || '';
      
      // If it is HLS manifest, rewrite it!
      if (
        contentType.includes('mpegurl') || 
        contentType.includes('mpegURL') || 
        targetUrl.includes('.m3u8')
      ) {
        const text = await response.text();
        const rewritten = this.rewriteManifest(text, targetUrl, proxyBaseUrl, referer || '');
        return {
          status: 200,
          body: rewritten,
          headers: {
            'Content-Type': 'application/vnd.apple.mpegurl',
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'no-cache'
          }
        };
      }

      // Otherwise, return direct stream response
      const buffer = await response.arrayBuffer();
      const resHeaders = {
        'Content-Type': contentType,
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': '*'
      };

      // Forward caching headers if present
      const cacheControl = response.headers.get('Cache-Control');
      if (cacheControl) resHeaders['Cache-Control'] = cacheControl;

      return {
        status: 200,
        body: new Uint8Array(buffer),
        headers: resHeaders
      };
    } catch (err) {
      return {
        status: 500,
        body: `Proxy Error: ${err.message}`,
        headers: { 'Content-Type': 'text/plain' }
      };
    }
  }
}
