# MathTyper

A visual editor that writes LaTeX for you. You type like in Google Docs, math works like Desmos, and the real LaTeX shows up live in a pane on the right. Exports a .tex file or a PDF.

Built with Tauri, TipTap and MathLive.

## Install

Download the installer for your system from the [Releases](../../releases) page:

| system | file |
|---|---|
| macOS (Intel + Apple Silicon) | `.dmg`, drag MathTyper into Applications |
| Windows | `.exe` or `.msi` |
| Linux | `.AppImage`, `.deb` or `.rpm` |

The builds are not code signed, so the first launch needs one extra step:
- macOS: right-click the app and choose Open, then Open again
- Windows: More info, then Run anyway

PDF export uses `pdflatex`, so it needs a TeX distribution: [MacTeX](https://tug.org/mactex/) on macOS, [MiKTeX](https://miktex.org/) or TeX Live on Windows, `texlive` from the package manager on Linux. Everything else works without one.

## What it does

- `$` or Cmd-E opens an inline equation, Cmd-Shift-E a display equation. `/` makes a fraction, `^` an exponent, `\alpha` + space the Greek letter, and any raw LaTeX command works too
- Escape, Enter or the arrow keys leave an equation
- symbol library with 410 commands, in five category buttons, an Ω button for the rest and a search that understands plain English ("not equal" finds ≠)
- bold, italic, underline, headings (`\section` to `\subsubsection`), lists, code blocks
- font, size, color and highlight for the selected text
- tables with math in the cells, exported as a grid or in booktabs style
- page setup: font, font size, paper and margins, all written into the preamble
- packages are added to the preamble only when the document uses them (cancel, braket, mhchem, booktabs)
- dark mode for the editor, the PDF stays black on white

## Files

- documents are `.mtd` files (JSON: page settings + content), double-clicking one opens it in MathTyper
- autosaves 1.5s after you stop typing. A new document gets its file once it has content, in `Documents/MathTyper/`, named after its first heading
- writes go to a temp file first and are then renamed, so a crash during a save can't damage the document
- reopens the last document on launch, the ▾ button lists the recent ones
- Export .tex and Export PDF ask where to save and default to the document's folder and name

| key | does |
|---|---|
| Cmd-N | new document |
| Cmd-O | open |
| Cmd-S | save (Cmd-Shift-S to save a copy somewhere else) |

On Windows and Linux it is Ctrl instead of Cmd.

## Build from source

Needs [Node](https://nodejs.org/) and [Rust](https://rustup.rs/), plus the [Tauri system libraries](https://tauri.app/start/prerequisites/) on Linux.

```
npm install
npm run tauri dev
```

`npm run tauri build` makes the installer for the system it runs on. `npm run dev` runs only the editor in a browser, without saving to files or PDF export.

Pushing a version tag (`git tag v0.1.0 && git push --tags`) builds all three systems on GitHub Actions and puts the installers in a draft release.

## Code

- `src/main.ts`: editor setup, toolbar, popovers, autosave, open/save, export
- `src/math-nodes.ts`: the equation nodes. Equations are static markup until clicked, only the one being edited is a live MathLive field
- `src/latex.ts`: document to LaTeX. `node src/latex.test.ts` runs its checks
- `src/symbols.ts`: the symbol library
- `src-tauri/src/lib.rs`: file commands and the pdflatex call

## Not in yet

Images, citations and theorems, importing .tex files, merged table cells, PDF preview inside the app.
