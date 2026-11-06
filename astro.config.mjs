import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://chaseteichmann.com',
  // Pages are emitted as /work/<slug>/index.html; links between pages are relative.
  build: { format: 'directory' },
  devToolbar: { enabled: false },
});
