# win98-site-kit

Quick start for building a windows 98 style website! Includes draggable 
windows, a dock, a calendar, carousels, system alerts, 98.css, 626 Windows
icons, and downloadable apps and games, with no build step and no backend. 
It is the reusable core of [rohin.shanker.me](https://rohin.shanker.me/), whose source
lives at [rohinshanker/personal-website](https://github.com/rohinshanker/personal-website).

**Showcase:** [rohinshanker.github.io/win98-site-kit](https://rohinshanker.github.io/win98-site-kit/)
shows every app, game and component in one desktop (or serve `showcase/`
locally, see below).

## Quick start

```bash
npx github:rohinshanker/win98-site-kit init my-desktop
cd my-desktop
npx github:rohinshanker/win98-site-kit serve        # http://127.0.0.1:4173/
```

Then:

1. Edit `site.config.js`: title, background (image, color or time of day),
   the order of icons on the desktop and in the dock, calendar photos.
2. Edit the apps in `apps/`: `about`, `projects`, `socials`, `credits`,
   `cursor-settings`, `display-properties`, and the `my-site` link.
3. Add more from the registry:

   ```bash
   npx github:rohinshanker/win98-site-kit list
   npx github:rohinshanker/win98-site-kit add snake minesweeper solitaire sudoku
   npx github:rohinshanker/win98-site-kit add neko counter study-resources clash-royale
   ```

   `add` downloads the complete package (code, styles, assets) into your
   site and registers it; `remove` takes it out again.

4. Deploy the folder to any static host (GitHub Pages, Netlify, Cloudflare
   Pages). Nothing needs a server.

If you cloned this repository instead, the same commands are
`node bin/win98-site-kit.mjs …` and the site template is `template/`.

## What is in the box

| Piece | Where | Notes |
| --- | --- | --- |
| Window manager | `kit/windows.js` | open/close/stack, drag with clamping, corner resize, maximize, dialogs with Escape and focus return, keyboard routing |
| Desktop + dock | `kit/desktop.js` | icons and taskbar generated from config; pressed state for open windows; Start closes everything |
| Calendar | `kit/calendar.js` | month grid, digital clock, per-day photos (`calendar.photos`), per-month quotes and backgrounds |
| Background | `kit/background.js` + Display Properties app | image, solid color or sunrise/day/sunset/night set; visitor choice persists |
| Carousel | `kit/carousel.js` | image/video items, lazy loading with hourglass, neighbour preloading, captions, five size variants with a documented spacing contract |
| Selector windows | `kit/selector.js` | explorer-style list + viewer (Projects, Writing, Creative Work) with draggable divider |
| Alerts | `kit/alerts.js` | `showAlert()` system popups with buttons and optional image |
| Cursors | `kit/cursor.js` + `styles/cursors.css` | light/dark pack switching and a working-cursor animation; ships empty, see `assets/cursors/README.md` |
| Assets | `assets/` | 626 `.ico` files with a JSON manifest, backgrounds, fonts, 98.css icons, Pixelarticons |

Registry packages (`npx … list`): games **snake**, **minesweeper**,
**solitaire**, **sudoku**; apps **writing**, **creative-work**,
**study-resources**, **neko**, **counter**, **clash-royale** (with an optional
proxy for your own API key and player tag), **components** (live demo of
every widget plus an icon browser).

## Writing an app

Create `apps/hello/index.js`:

```js
import { showAlert } from "../../kit/index.js";

export default {
  id: "hello",
  title: "Hello",
  icon: "assets/app-icons/ico/notepad.ico",
  window: { width: 320, controls: ["close"] },
  render: () => `<p>Hi there.</p><button type="button" data-say-hi>Say hi</button>`,
  mount({ window }) {
    window.querySelector("[data-say-hi]").addEventListener("click", () => {
      showAlert({ title: "Hello", body: "<p>Hi!</p>" });
    });
  },
};
```

Run `npx github:rohinshanker/win98-site-kit sync` (or add the import to
`apps/installed.js` by hand) and the icon appears. The full contract, kit
API and styling rules are in [AGENTS.md](AGENTS.md), written for both people
and coding agents.

## Development

```bash
npm install
npm run check          # syntax, showcase freshness, node tests
npm run test:ui        # Playwright against showcase/ (npx playwright install chromium once)
npm run showcase:build # regenerate showcase/ after changing template/ or registry/
```

## Licensing

The kit's own code is MIT. Some bundled assets are not: the 626 Windows 98
icons and the hourglass animation are Microsoft artwork that is widely
redistributed but never formally licensed for reuse, and the Digital-7 clock
font is free for personal use only. This kit is meant for free, personal,
non-commercial sites, which those terms allow. For a commercial site, trim
the icon set and replace the clock font. Everything else (98.css,
Pixelarticons, Neko sprites, the Solitaire card pack) is open-licensed; the
full list is in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
