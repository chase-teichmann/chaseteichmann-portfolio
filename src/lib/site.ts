import siteData from '../data/site.json';
import faviconSvg from '../assets/favicon.svg?raw';

export const site = siteData;

/** Where a page sits in the folder tree: 0 = home, 1 = /privacy/, 2 = /work/<slug>/. */
export type Depth = 0 | 1 | 2;

/** The site is published with relative links (it also works when opened from disk). */
export function linksFor(depth: Depth) {
  const up = depth === 0 ? '' : depth === 1 ? '../' : '../../';
  const home = `${up}index.html`;
  return {
    up,
    home,
    /** Link to a section of the home page; on the home page itself it is just the anchor. */
    section: (anchor: string) => (depth === 0 ? `#${anchor}` : `${home}#${anchor}`),
    /** Link to a project page. */
    project: (slug: string) =>
      depth === 0 ? `work/${slug}/index.html` : depth === 1 ? `../work/${slug}/index.html` : `../${slug}/index.html`,
    privacy: depth === 0 ? 'privacy/index.html' : depth === 1 ? 'index.html' : '../../privacy/index.html',
  };
}

export const faviconHref = `data:image/svg+xml;base64,${btoa(faviconSvg)}`;

/** Adds a scoped-style attribute to every opening tag of an HTML fragment (how project prose is styled). */
export function scopeHtml(html: string, cid: string): string {
  return html.replace(/<([a-z][a-z0-9]*)(?=[\s>])/g, `<$1 ${cid}`);
}

/** JSON written with ", " and ": " separators (the format some of the embedded data uses). */
export function spacedJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(spacedJson).join(', ')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => `${JSON.stringify(k)}: ${spacedJson(v)}`)
      .join(', ')}}`;
  }
  return JSON.stringify(value);
}

/** Escapes text for HTML content, leaving quotes as typed (for use with set:html). */
export const escText = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
