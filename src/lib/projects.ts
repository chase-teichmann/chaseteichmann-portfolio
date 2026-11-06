// Projects are the "products" of the store. Each one lives in src/data/projects/NN-slug.json;
// the NN prefix sets the store order.

export type CompanyKey = 'returnlogic' | 'actifai';

export interface Metric { value: string; unit: string | null; label: string }

export interface Section {
  key: string;
  label: string;
  html: string;
  /** Append the Retro-theme prompt (see lib/retro-egg.ts). */
  retroEgg?: boolean;
}

/** One image in a project's gallery. "cover" art is drawn by CoverArt; "map" and "flow" are stored figures. */
export interface Shot {
  shot: string | null;
  primary: boolean;
  kind: 'cover' | 'map' | 'flow';
  file: string;
  viewBox?: string;
  title?: string;
  desc?: string;
  caption?: string;
  /** Colour of the cover's thumbnail button. */
  thumbColor?: string;
}

export interface Project {
  id: string;
  slug: string;
  number: string;
  name: string;
  bookmark: string;
  summary: string;
  /** Shorter summary for the shelf card, when the full one is too long. */
  cardSummary?: string;
  category: string;
  period: string;
  sortYear: number;
  addOn: boolean;
  tile: string;
  numberTile?: string;
  company: CompanyKey | null;
  companyLabel: string;
  role: string;
  stack: string[];
  metric: Metric | null;
  seo: { title: string; description: string; about: string[] };
  gallery: Shot[];
  sections: Section[];
  /** Renders the company slot one space tighter (matches how this project has always rendered). */
  compactBrand?: boolean;
}

const modules = import.meta.glob<{ default: Project }>('../data/projects/*.json', { eager: true });

export const projects: Project[] = Object.keys(modules)
  .sort()
  .map((k) => modules[k].default);

export const projectById = (id: string): Project => {
  const p = projects.find((x) => x.id === id);
  if (!p) throw new Error(`Unknown project ${id}`);
  return p;
};

/** Projects on the shelf (the add-on lives in the cart, not on the shelf). */
export const shelfProjects = projects.filter((p) => !p.addOn);

/** Tile colour of a project's numbered chip. */
export const numberTile = (p: Project) => p.numberTile ?? p.tile;

/** "Category · period", the small line under a related project. */
export const metaLine = (p: Project) => `${p.category} · ${p.period}`;

/** Cross-sell on the in-store product view: the first three other projects. */
export const studyRelated = (p: Project) => projects.filter((x) => x.id !== p.id).slice(0, 3);

/** "More projects" on a project page: every other project. */
export const pageRelated = (p: Project) => projects.filter((x) => x.id !== p.id);

/** Previous/next for the Retro theme's webring (wraps around). */
export function webring(p: Project) {
  const i = projects.indexOf(p);
  return {
    prev: projects[(i - 1 + projects.length) % projects.length],
    next: projects[(i + 1) % projects.length],
  };
}

// Art files (SVG bodies and stored figures).
const art = import.meta.glob<string>('../data/art/*', { eager: true, query: '?raw', import: 'default' });
export function artFile(file: string): string {
  const v = art[`../data/art/${file}`];
  if (v === undefined) throw new Error(`Missing art ${file}`);
  return v;
}
