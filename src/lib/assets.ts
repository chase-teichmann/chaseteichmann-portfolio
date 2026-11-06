// Stylesheets and scripts are inlined into each page (the site makes no extra requests).
// Each entry is emitted as <style id="…"> / <script id="…"> with the file's contents.
import base from '../styles/base.css?raw';
import home from '../styles/home.css?raw';
import page from '../styles/page.css?raw';
import headerSafeArea from '../styles/header-safe-area.css?raw';
import coverArt from '../styles/cover-art.css?raw';
import protectOff from '../styles/protect-off.css?raw';
import xpPoints from '../styles/xp-points.css?raw';
import stackLabCss from '../styles/stack-lab.css?raw';
import checkoutCss from '../styles/checkout.css?raw';
import shipCss from '../styles/ship.css?raw';
import heroCss from '../styles/hero.css?raw';
import navPhone from '../styles/nav-phone.css?raw';
import polish from '../styles/polish.css?raw';
import bodyCss from '../styles/body.css?raw';
import themeCss from '../styles/theme.css?raw';
import storeNote from '../styles/store-note.css?raw';

import themeInit from '../scripts/theme-init.js?raw';
import jsClass from '../scripts/js-class.js?raw';
import gallery from '../scripts/gallery.js?raw';
import requestHash from '../scripts/request-hash.js?raw';
import stackLabJs from '../scripts/stack-lab.js?raw';
import checkoutJs from '../scripts/checkout.js?raw';
import shipJs from '../scripts/ship.js?raw';
import heroJs from '../scripts/hero.js?raw';
import themeJs from '../scripts/theme.js?raw';
import store from '../scripts/store.js?raw';
import stack from '../scripts/stack.js?raw';
import retroEgg from '../scripts/retro-egg.js?raw';

type Inline = { id?: string; code: string };

export const styles = {
  base: { code: base },
  home: { code: home },
  page: { code: page },
  headerSafeArea: { code: headerSafeArea },
  coverArt: { id: 'cover-art', code: coverArt },
  protectOff: { id: 'protect-off', code: protectOff },
  xpPoints: { id: 'xp-points', code: xpPoints },
  stackLab: { id: 'stack-lab-css', code: stackLabCss },
  checkout: { id: 'co-css', code: checkoutCss },
  ship: { id: 'ship-css', code: shipCss },
  hero: { id: 'hero-css', code: heroCss },
  navPhone: { id: 'nav-phone', code: navPhone },
  polish: { id: 'polish-css', code: polish },
  body: { id: 'body-css', code: bodyCss },
  theme: { id: 'theme-css', code: themeCss },
  storeNote: { id: 'store-note-css', code: storeNote },
} satisfies Record<string, Inline>;

export const scripts = {
  themeInit: { id: 'theme-init', code: themeInit },
  jsClass: { code: jsClass },
  gallery: { code: gallery },
  requestHash: { id: 'request-hash', code: requestHash },
  stackLab: { id: 'stack-lab-js', code: stackLabJs },
  checkout: { id: 'co-js', code: checkoutJs },
  ship: { id: 'ship-js', code: shipJs },
  hero: { id: 'hero-js', code: heroJs },
  theme: { id: 'theme-js', code: themeJs },
  store: { code: store },
  stack: { code: stack },
  retroEgg: { code: retroEgg },
} satisfies Record<string, Inline>;

export type StyleName = keyof typeof styles;
export type ScriptName = keyof typeof scripts;

const tag = (name: 'style' | 'script', { id, code }: Inline) =>
  `<${name}${id ? ` id="${id}"` : ''}>${code}</${name}>`;

export const styleTag = (n: StyleName) => tag('style', styles[n]);
export const scriptTag = (n: ScriptName) => tag('script', scripts[n]);
