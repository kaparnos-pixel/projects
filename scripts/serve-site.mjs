// Serves the assembled _site/ bundle locally exactly as GitHub Pages would:
// the marketing site at /projects/ and the app at /projects/app/. Zero
// dependencies (Node's built-in http), so it runs the same on Windows,
// macOS and Linux. Run `npm run serve:site` after `npm run build:site`.

import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join, normalize, extname } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '_site')
const port = Number(process.env.PORT) || 8080
const BASE = '/projects' // matches the Vite base in vite.config.ts

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
}

async function readFileOrNull(p) {
  try {
    if ((await stat(p)).isDirectory()) p = join(p, 'index.html')
    return { body: await readFile(p), path: p }
  } catch {
    return null
  }
}

const server = createServer(async (req, res) => {
  let urlPath = decodeURIComponent((req.url || '/').split('?')[0])

  // Redirect the bare root to the site's base path.
  if (urlPath === '/' || urlPath === '') {
    res.writeHead(302, { Location: `${BASE}/` })
    return res.end()
  }

  // Everything lives under /projects; strip that prefix to find the file.
  let rel = urlPath.startsWith(BASE) ? urlPath.slice(BASE.length) : urlPath
  const filePath = join(root, normalize(rel))

  let file = await readFileOrNull(filePath)

  // SPA fallback: unknown paths under /projects/app -> the app shell;
  // anything else unknown under /projects -> the site's 404 page.
  if (!file) {
    if (urlPath.startsWith(`${BASE}/app`)) {
      file = await readFileOrNull(join(root, 'app', 'index.html'))
    } else {
      file = await readFileOrNull(join(root, '404.html'))
    }
  }

  if (!file) {
    res.writeHead(404, { 'Content-Type': 'text/plain' })
    return res.end('Not found')
  }

  res.writeHead(200, { 'Content-Type': mime[extname(file.path)] || 'application/octet-stream' })
  res.end(file.body)
})

server.listen(port, () => {
  console.log(`\n  AusGlobal site running:`)
  console.log(`  • marketing  ->  http://localhost:${port}/projects/`)
  console.log(`  • platform   ->  http://localhost:${port}/projects/app/\n`)
  console.log('  Press Ctrl+C to stop.\n')
})
