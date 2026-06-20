import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
// On GitHub Pages the app is served from /projects/app/; in dev it's served
// from the root. base drives both asset URLs and the router basename.
export default defineConfig(({ command }) => ({
  plugins: [react()],
  base: command === 'build' ? '/projects/app/' : '/',
  server: {
    host: true,
    port: 5173,
  },
}))
