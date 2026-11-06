import type { APIRoute } from 'astro';
import { site } from '../lib/site';
import { projects } from '../lib/projects';

// Home, every project page (by URL), then the privacy page.
export const GET: APIRoute = () => {
  const paths = ['/', ...projects.map((p) => `/work/${p.slug}/`).sort(), '/privacy/'];
  const urls = paths.map((p) => `  <url><loc>${site.url}${p}</loc><lastmod>${site.lastModified}</lastmod></url>`);
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
  return new Response(xml, { headers: { 'Content-Type': 'application/xml' } });
};
