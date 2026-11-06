import { scripts } from './assets';

/**
 * The "Haven't found it yet?" prompt that points first-time visitors at the Retro theme.
 * It stays hidden once a theme choice is saved (localStorage "ct-theme").
 */
export const retroEggHtml = () =>
  `<p class="egg" data-egg hidden><span>Haven’t found it yet?</span> <button type="button" class="btn" data-egg-go>Switch to the 1990s design</button></p><script>${scripts.retroEgg.code}</script>`;

/** A prose section's HTML, with the Retro prompt appended where the section asks for it. */
export const sectionHtml = (s: { html: string; retroEgg?: boolean }) => (s.retroEgg ? s.html + retroEggHtml() : s.html);
