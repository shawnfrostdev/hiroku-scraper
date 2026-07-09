import solaris, { getEpisodes as getSolarisEpisodes } from './solaris.js';

export async function getEpisodes(anilistId, ctx = {}) {
  const data = await getSolarisEpisodes(anilistId, ctx);
  
  if (data && data.episodes) {
    const rewrite = (list) => {
      if (!Array.isArray(list)) return;
      list.forEach(ep => {
        if (ep.id) {
          ep.id = ep.id.replace('watch/anikoto', 'watch/frost')
                       .replace('anikoto-', 'frost-');
        }
      });
    };
    rewrite(data.episodes.sub);
    rewrite(data.episodes.dub);
  }
  return data;
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    url.pathname = url.pathname.replace(/^\/watch\/frost\//, '/watch/anikoto/')
                               .replace(/\/frost-/, '/anikoto-');
                               
    const req = new Request(url.toString(), request);
    return solaris.fetch(req);
  }
};
