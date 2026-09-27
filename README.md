# MathTyper

A visual editor that writes LaTeX for you. You type like in Google Docs, math works like Desmos, and the real LaTeX shows up live in a pane on the right.

Built with Tauri, TipTap and MathLive. Only tested on macOS so far.

## What it does

- `$` or Cmd-E opens an inline equation, Cmd-Shift-E a display equation. `/` makes a fraction, `^` an exponent, `\alpha` + space the Greek letter
- Escape, Enter or the arrow keys leave an equation
- symbol library with 410 commands and a search that understands plain English ("not equal" finds ≠)
- bold, italic, underline, headings, lists, code blocks
- font, size, color and highlight for the selected text
- tables with math in the cells, exported as a grid or in booktabs style
- page setup: font, font size, paper and margins
- dark mode for the editor, the PDF stays black on white
- autosaves into `Documents/MathTyper/` and reopens the last document on launch
- Export .tex saves the LaTeX file, Compile PDF runs pdflatex and opens the result

## Running it

Needs Node, Rust and MacTeX (for Compile PDF).

```
npm install
npm run tauri dev
```

`npm run dev` runs only the editor in a browser, `node src/latex.test.ts` checks the serializer.

## Not in yet

Images, citations and theorems, importing .tex files, merged table cells, PDF preview inside the app.
