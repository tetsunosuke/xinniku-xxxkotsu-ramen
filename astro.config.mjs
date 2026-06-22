import { defineConfig } from 'astro/config';

// https://astro.build/config
export default defineConfig({
  site: 'https://xinniku-xxxkotsu-ramen.pages.dev',
  publicDir: 'public',
  outDir: 'dist',
  devToolbar: {
    enabled: false
  },
  server: {
    fs: {
      allow: ['..']
    }
  }
});
