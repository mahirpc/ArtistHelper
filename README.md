# ArtRef Studio

A grid-and-reference drawing assistant for artists — upload a reference photo,
lay a compositional grid or armature over it, strip it down to values, take
sighting measurements, and calculate the matching marks for your physical
paper. Everything runs **inside the browser**: no server, no account, no
upload. It's a static site, so it deploys to GitHub Pages as-is.

## Features

- **Image acquisition** — drag-and-drop, file picker, clipboard paste, or a
  URL; JPEG/PNG/WEBP/AVIF up to 50MB; smooth zoom (10–1000%), pan, fit-to-window,
  90° rotation, flip horizontal/vertical, and free-form crop.
- **Grid & overlay engine** — square/Cartesian grid, custom row×column grid,
  cell subdivision (X-in-box), harmonic armature, rule of thirds, golden ratio
  (phi grid + logarithmic spiral), 1- and 2-point perspective guides with
  draggable vanishing points, and Loomis-style face proportion lines. Line
  color, width, opacity, and dash pattern are all adjustable, with optional
  edge or per-cell coordinate labels.
- **Value & tone tools** — grayscale, brightness/contrast, 2–10 step
  posterization, binary threshold silhouette, invert, a squint-simulating
  blur, and a Sobel-edge **pen art** mode that traces the image into a sketchy
  ink-line study. A color loupe reads RGB/HEX/HSL under the cursor and pins up
  to 10 swatches.
- **Sighting tools** — a virtual caliper for proportion ratios (first
  measurement becomes the 1.0× baseline), unlimited draggable plumb lines, and
  a three-point angle finder.
- **Paper calibration** — enter your paper size and margins and the app
  computes exact real-world grid spacing ("mark every 2.25 in"), with common
  presets (9×12, 11×14, 16×20, A4, A3, and standard aspect ratios), plus a
  printable, paper-matched blank grid PDF export.
- **Export** — full-resolution PNG with the grid burned in, a vector PDF of
  the blank paper-matched grid, and a JSON project file (grid, tone, and
  calibration settings) you can reload later.
- **Recent references** — every image you work on is auto-saved locally
  (IndexedDB) with a thumbnail, so you can pick up where you left off. Nothing
  ever leaves the device.
- **PWA** — installable, works offline after the first visit (stale-while-
  revalidate service worker), with a full keyboard shortcut set (see the `?`
  button in the header).

## Deploying to GitHub Pages

This is a plain static site (HTML/CSS/ES modules) — there is no build step.

1. Push this folder to the root of a GitHub repository's `main` branch.
2. In the repo, go to **Settings → Pages** and set **Source** to
   **GitHub Actions** (the included workflow at
   `.github/workflows/deploy.yml` will build and publish automatically on
   every push to `main`), *or* set **Source** to **Deploy from a branch** →
   `main` / `/ (root)` if you'd rather skip Actions entirely.
3. Your site will be live at `https://<username>.github.io/<repo-name>/`.

Because every asset reference in `index.html`, `manifest.webmanifest`, and
`service-worker.js` is relative, the app works identically whether it's
served from the domain root or from a `/<repo-name>/` subpath — no
`vite.config.ts`-style base-path edit needed, since there's no bundler in
the loop.

## Architecture

- **Dual-canvas viewport** (`js/canvas-engine.js`): a WebGL "base" canvas
  renders the reference image and all tonal filters; a 2D "overlay" canvas
  renders the grid, sighting tools, and labels. Panning/zooming only touches
  the cheap overlay layer's transform; the megapixel base image is re-rendered
  only when a filter or crop actually changes.
- **`js/gl-filters.js`** — a single WebGL fragment shader handling grayscale,
  brightness/contrast, posterization, threshold, invert, an approximate
  multi-tap blur, and the Sobel-based pen-art mode.
- **`js/grid-renderer.js`** — pure drawing functions for every overlay type.
- **`js/sighting-tools.js`** — data model + drawing for calipers, plumb
  lines, and the angle finder (points are stored normalized to the image so
  measurements survive zoom/pan/rotate).
- **`js/paper-calibration.js`** — the physical-to-digital spacing math.
- **`js/export.js`** — PNG/PDF/JSON export; jsPDF is lazy-loaded from a CDN
  only when a PDF is actually requested, to keep the initial load light.
- **`js/storage.js`** — IndexedDB (full images + project snapshots) and
  LocalStorage (small UI preferences).
- **`js/app.js`** — wires all of the above to the DOM: tool state, pointer
  interactions, keyboard shortcuts, modals, and the auto-save/recent list.

## Known limitations

- Rotation is lossless in 90° steps; arbitrary fine-angle rotation isn't
  exposed in the UI yet (the engine's rasterizer supports it, so it's a
  straightforward follow-up).
- Loading a reference **by URL** works only if the host serves the image
  with permissive CORS headers — otherwise the browser taints the canvas and
  blocks color sampling/export, which is a browser security rule, not
  something this app can bypass. Drag-and-drop, file picker, and clipboard
  paste are unaffected and are the recommended import paths.
- The blur ("squint") filter is a fast multi-tap approximation rather than a
  true separable Gaussian — visually similar, cheaper on large images.

## Keyboard shortcuts

| Key | Action |
|---|---|
| Space + drag | Pan viewport |
| `+` / `-` | Zoom in / out |
| `0` | Reset zoom & fit to screen |
| `H` | Flip horizontally |
| `V` | Flip vertically |
| `G` | Toggle grid visibility |
| `M` | Toggle grayscale |
| `P` | Cycle posterize levels (Off → 2 → 3 → 4 → 5) |
| `T` | Toggle threshold silhouette |
| `C` | Caliper tool |
| `L` | Plumb line tool |
| `E` | Open export menu |
