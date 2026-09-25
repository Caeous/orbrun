import { defineConfig } from 'vite'
import { gamedataProxy } from './gamedata-proxy'
import { engineFiles } from './engine-files'
import { sitePages } from './site-pages'

export default defineConfig({
  plugins: [gamedataProxy(), engineFiles(), sitePages()],
  server: { port: 5173 },
  preview: { port: 4173 },
  build: { target: 'es2022', sourcemap: true },
})
