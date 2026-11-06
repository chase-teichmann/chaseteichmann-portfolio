import home from '../data/home.json';
import { site } from './site';

/** schema.org ProfilePage for the home page; the Person details live in src/data/home.json. */
export const personJsonLd = () =>
  JSON.stringify({ '@context': 'https://schema.org', '@type': 'ProfilePage', url: site.url, mainEntity: home.person });
