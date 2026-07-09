import lynx, { getEpisodes as getLynxEpisodes } from './lynx.js';

export async function getEpisodes(anilistId, ctx = {}) {
  const data = await getLynxEpisodes(anilistId, ctx);
  
  if (data && data.episodes) {
    const rewrite = (list) => {
      if (!Array.isArray(list)) return;
      list.forEach(ep => {
        if (ep.id) {
          ep.id = ep.id.replace('watch/anineko', 'watch/lunar')
                       .replace('anineko-', 'lunar-');
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
    url.pathname = url.pathname.replace(/^\/watch\/lunar\//, '/watch/anineko/')
                               .replace(/\/lunar-/, '/anineko-');
                               
    const req = new Request(url.toString(), request);
    return lynx.fetch(req);
  }
};
