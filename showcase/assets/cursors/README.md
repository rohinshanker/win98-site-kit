# Cursor packs

The kit ships no cursor artwork. To enable custom cursors:

1. Put a pack in `assets/cursors/light/` (and optionally `assets/cursors/dark/`)
   using exactly these file names:

   | File | Used for |
   | --- | --- |
   | `normal.cur` | the arrow |
   | `select.cur` | links, buttons, icons |
   | `text.cur` | text fields |
   | `move.cur` | window title bars |
   | `help.cur` | title-bar Help button |
   | `unavailable.cur` | disabled controls |
   | `precision.cur` | crosshair (games) |
   | `resize-ew.cur`, `resize-ns.cur`, `resize-nwse.cur`, `resize-nesw.cur` | resize handles |
   | `busy.ani` | wait |
   | `working.ani` | background work (`observeLoading`) |
   | `working-1.png` … `working-9.png` | optional animated frames for browsers that ignore `.ani` |

2. Set `cursor: { enabled: true, defaultMode: "light" }` in `site.config.js`.
3. The Cursor Settings app switches between the light and dark packs and
   persists the choice; `kit/cursor.js` exposes `observeLoading(predicate)` so
   an app can show the working cursor while it is busy.

A free pack that fits this layout is Jeelh's
[Retro Cursor](https://jeelh.itch.io/retro-cursor); rename its files to the
names above. Keep the `.gitkeep` files so the folders exist in a fresh clone.
