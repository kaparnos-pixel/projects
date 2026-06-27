// Assembles the integrated deploy bundle in _site/:
//
//   _site/            -> marketing website (the front door, served at /projects/)
//   _site/app/        -> the AusGlobal platform (the Vite build, served at /projects/app/)
//   _site/app/404.html-> SPA fallback for deep links inside the app
//   _site/404.html    -> root SPA fallback so refreshing an app deep link
//                        (e.g. /projects/app/voyages) boots the app instead of 404ing
//
// Run AFTER `vite build` (see the `build:site` npm script). Cross-platform:
// uses Node's fs only, so it works the same on Windows, macOS and Linux.

import { existsSync, rmSync, mkdirSync, cpSync, copyFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dist = join(root, 'dist')
const website = join(root, 'website')
const out = join(root, '_site')
const outApp = join(out, 'app')

if (!existsSync(dist)) {
  console.error('✗ dist/ not found. Run `npm run build` first (or use `npm run build:site`).')
  process.exit(1)
}

// Start clean.
rmSync(out, { recursive: true, force: true })
mkdirSync(outApp, { recursive: true })

// Marketing site at the root, app under /app.
cpSync(website, out, { recursive: true })
cpSync(dist, outApp, { recursive: true })

// SPA fallbacks. The app uses client-side routing, so any unknown path must
// still serve the app shell; its assets are referenced by absolute /projects/app
// URLs, so they resolve no matter which path the browser landed on.
copyFileSync(join(outApp, 'index.html'), join(outApp, '404.html'))
copyFileSync(join(outApp, 'index.html'), join(out, '404.html'))

console.log('✓ Assembled integrated bundle in _site/')
console.log('  • marketing site  -> _site/index.html        (served at /projects/)')
console.log('  • platform app    -> _site/app/index.html    (served at /projects/app/)')
console.log('  • SPA fallbacks   -> _site/404.html, _site/app/404.html')
