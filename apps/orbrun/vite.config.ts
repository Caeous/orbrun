import { defineConfig } from 'vite'
import { gamedataProxy } from './gamedata-proxy'

export default defineConfig({
  plugins: [gamedataProxy()],
  server: { port: 5173 },
  preview: { port: 4173 },
  build: { target: 'es2022', sourcemap: true },
})
