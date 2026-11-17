# Knight Puzzle Game

A knight puzzle game built with plain HTML, CSS and JavaScript — no third-party dependencies.

[简体中文](README.zh.md)

## Rules

- The board is N×N (N = 4–10) with N distinct colors.
- Each row and each column contains exactly one knight.
- Each color contains exactly one knight.
- No two knights may be adjacent, including diagonally (no two knights in the same 3×3 neighborhood).

## Getting Started

Open `knight-puzzle-game.html` directly in a browser. If your browser restricts local scripts, serve the folder over HTTP:

```bash
python -m http.server 8000
```

Then visit `http://localhost:8000/knight-puzzle-game.html`.

## Controls

| Action | Result |
| --- | --- |
| Click a cell | Toggle a white ✕ mark |
| Double-click a cell | Place a knight there |
| Press and drag across cells | Add / remove ✕ marks along the path |
| Change the puzzle ID, then press Start / Regenerate | Generate the board for that ID |
| Show answer | Display a thumbnail in the bottom-right corner |
| Export image | Save the current board as a PNG |

A wrong placement costs one life and locks the cell. The timer starts with your first action.

## Puzzle ID

The format is `order-serial`, for example `6-007` or `10-056`:

- Order: 4–10
- Serial: 1–1000 (padded to 3 digits)
- Leave the field blank to get a random puzzle at the selected order

The ID is hashed with FNV-1a to seed a mulberry32 generator, so **the same ID and difficulty always produce exactly the same board** — easy to share and revisit.

## Difficulty

| Difficulty | Preplaced knights |
| --- | --- |
| Easy | 2 |
| Medium | 1 |
| Hard | 0 |

## Languages

- Language packs live in `lang/zh_CN.js` and `lang/en_US.js`. `lang/i18n.js` loads the best match from the browser's default language and falls back to `en_US` when nothing matches.
- Use the Language selector in the toolbar to switch at any time. Static labels and dynamic text (progress, messages, dialogs, timer prefix) all update immediately.
- To add a language: create a new file under `lang/` following the existing key structure, register it in `SUPPORTED` and `detectLang()` in `lang/i18n.js`, and add an option to `#langSelect` in the HTML.

## Responsive Layout

- Width ≥ 1024px: title, rules, toolbar and status on the left; board and message on the right.
- Width < 1024px: the original single-column layout is preserved.

Cell size is computed by `fitBoard()` from the viewport and layout mode, capped at 72px on large screens.

## Project Structure

```text
knight-puzzle-game/
├── knight-puzzle-game.html   # Page structure
├── knight-puzzle-game.css    # Styles and responsive layout
├── knight-puzzle-game.js     # Game logic, puzzle generation and interaction
├── lang/
│   ├── i18n.js               # Language pack loading and switching
│   ├── zh_CN.js              # Simplified Chinese pack
│   └── en_US.js              # English pack (fallback)
├── README.md                 # English documentation
├── README.zh.md              # Chinese documentation
└── LICENSE                   # MIT License
```

## Implementation Notes

- **Puzzle generation**: backtracking to place knights → multi-source BFS to grow color regions → local recoloring until the solution is unique. Orders 4–8 prefer boards solvable by pure logic.
- **Placement check**: instead of comparing with a stored answer, the game checks whether a placement can still be completed into a fully valid layout, so any alternative valid solution is accepted.
- **Double-click detection**: two clicks on the same cell within `CLICK_DELAY` (260ms) are primary, with native `dblclick` as a fallback. Quick clicks on different cells are never treated as a double-click.
- **Image export**: the board is redrawn on a Canvas at 2× resolution, including colors, knights, gold preset borders, wrong-cell overlays, ✕ marks and the puzzle ID.

## License

MIT © 2026 seth.yang
