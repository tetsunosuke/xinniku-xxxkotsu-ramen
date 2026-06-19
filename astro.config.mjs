import { defineConfig } from 'astro/config';

// https://astro.build/config
export default defineConfig({
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
