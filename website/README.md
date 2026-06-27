# AusGlobal marketing website

A self-contained static marketing site for AusGlobal Ship Agent Pty Ltd, built
from the company business profile. No build step or dependencies, just HTML +
CSS.

## Files

- `index.html`, the single-page marketing site
- `styles.css`, all styling (maritime navy / signal-amber, with port-side red &
  starboard green accents)
- `ausglobal.svg`, logo / favicon

## View locally

Open `index.html` directly in a browser, or serve the folder:

```bash
# from the website/ directory
python3 -m http.server 8000
# then open http://localhost:8000
```

## The "Launch platform" links

The header and call-to-action buttons link to `/projects/app/`, where the
**AusGlobal operational platform** (the Vite app in the repo root) is served.
When deploying, host the marketing site and the app together, or update the
`href` links to wherever the app is hosted.

## Deploy

Because it's plain static files, the site drops onto any static host:
GitHub Pages, Netlify, Vercel, Cloudflare Pages, or an S3 bucket. Point the host
at this `website/` directory.
