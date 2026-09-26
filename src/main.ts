import "./styles.css";
import "mathlive/fonts.css";
import "mathlive/static.css";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Color, FontFamily, FontSize, TextStyle } from "@tiptap/extension-text-style";
import { Highlight } from "@tiptap/extension-highlight";
import { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import { MathfieldElement, convertLatexToMarkup } from "mathlive";
import { invoke } from "@tauri-apps/api/core";
import { documentDir } from "@tauri-apps/api/path";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open as openDialog, save } from "@tauri-apps/plugin-dialog";
import { MathBlock, MathInline, requestMathFocus } from "./math-nodes";
import { cssToHex, DEFAULT_SETTINGS, docToLatex, type DocSettings } from "./latex";
import { SYMBOL_CATEGORIES, type SymbolEntry } from "./symbols";

MathfieldElement.soundsDirectory = null;
MathfieldElement.fontsDirectory = null; //fonts come from the bundled fonts.css

const isTauri = "__TAURI_INTERNALS__" in window;

//---------- document state ----------
const settings: DocSettings = { ...DEFAULT_SETTINGS };
let zoom = 1;
let filePath: string | null = null;

const FONT_CSS: Record<DocSettings["font"], string> = {
  "latin-modern": '"Latin Modern Roman", "CMU Serif", Georgia, serif',
  times: '"Times New Roman", Times, serif',
  palatino: 'Palatino, "Palatino Linotype", "Book Antiqua", serif',
  helvetica: '"Helvetica Neue", Helvetica, Arial, sans-serif',
};

function applySettings(){
  const r = document.documentElement.style;
  r.setProperty("--page-w", settings.paper === "a4" ? "210mm" : "8.5in");
  r.setProperty("--page-min-h", settings.paper === "a4" ? "297mm" : "11in");
  r.setProperty("--page-margin", `${settings.marginIn}in`);
  r.setProperty("--doc-font", FONT_CSS[settings.font]);
  r.setProperty("--doc-size", `${settings.fontSize}pt`);
  r.setProperty("--zoom", String(zoom));
}

//---------- editor ----------
const editor = new Editor({
  element: document.querySelector("#editor")!,
  extensions: [
    StarterKit,
    TextStyle,
    Color,
    FontFamily,
    FontSize,
    Highlight.configure({ multicolor: true }),
    //per-table grid vs booktabs choice, carried into the LaTeX export
    Table.extend({
      addAttributes(){
        return {
          ...this.parent?.(),
          tableStyle: {
            default: "grid",
            parseHTML: (el: HTMLElement) => el.dataset.tableStyle ?? "grid",
            renderHTML: (attrs: any) => ({ "data-table-style": attrs.tableStyle }),
          },
        };
      },
    }),
    TableRow,
    TableHeader,
    TableCell,
    MathInline,
    MathBlock,
  ],
  content: `
    <h1>Welcome to MathTyper</h1>
    <p>Type <strong>$</strong> (or press <strong>Cmd-E</strong>) to open a math field, then
    type like Desmos: <code>/</code> makes a fraction, <code>^</code> an exponent, and
    <code>\\alpha</code> plus space makes the Greek letter. Press <strong>Cmd-Shift-E</strong>
    for display math.</p>
    <p>The pane on the right is the live LaTeX for this document.</p>
  `,
  autofocus: "end",
});
if(import.meta.env.DEV){(window as any).editor = editor;}

//---------- toolbar ----------
type Btn = { label: string; title: string; run: () => void; active?: () => boolean };
const c = editor.chain.bind(editor);
const toolbar = document.querySelector("#toolbar")!;
const btnEls: [HTMLButtonElement, Btn][] = [];
function addButton(b: Btn, cls = ""): HTMLButtonElement{
  const el = document.createElement("button");
  el.textContent = b.label;
  el.title = b.title;
  if(cls){el.className = cls;}
  el.addEventListener("mousedown", (e) => e.preventDefault()); //keep editor focus
  el.addEventListener("click", b.run);
  toolbar.appendChild(el);
  if(b.active){btnEls.push([el, b]);}
  return el;
}
const sep = () => toolbar.appendChild(Object.assign(document.createElement("span"), { className: "sep" }));
const addButtons = (list: Btn[]) => list.forEach((b) => addButton(b));
function toolbarSelect(options: [string, string][], title: string, onchange: (v: string) => void): HTMLSelectElement{
  const s = document.createElement("select");
  s.title = title;
  for(const [v, text] of options){
    const o = document.createElement("option");
    o.value = v;
    o.textContent = text;
    s.appendChild(o);
  }
  s.addEventListener("change", () => onchange(s.value));
  toolbar.appendChild(s);
  return s;
}

//---------- popovers ----------
function popover(anchor: HTMLElement): HTMLDivElement{
  const panel = document.createElement("div");
  panel.className = "popover";
  panel.hidden = true;
  document.querySelector("#app")!.appendChild(panel);
  //keep the editor/math field focused when clicking inside, except in text inputs
  panel.addEventListener("mousedown", (e) => {
    const t = e.target as HTMLElement;
    if(t.tagName !== "INPUT" && t.tagName !== "SELECT"){e.preventDefault();}
  });
  anchor.addEventListener("click", () => {
    panel.hidden = !panel.hidden;
    if(!panel.hidden){
      const r = anchor.getBoundingClientRect();
      panel.style.top = `${r.bottom + 6}px`;
      panel.style.left = `${Math.min(r.left, window.innerWidth - panel.offsetWidth - 12)}px`;
    }
  });
  document.addEventListener("mousedown", (e) => {
    if(!panel.hidden && !panel.contains(e.target as Node) && !anchor.contains(e.target as Node)){
      panel.hidden = true;
    }
  });
  return panel;
}

//document-mutating buttons are inert while a math field holds focus (stale PM selection)
const g = (fn: () => void) => () => {
  if(!inMathField()){fn();}
};

addButtons([
  { label: "B", title: "Bold (⌘B)", run: g(() => c().focus().toggleBold().run()), active: () => editor.isActive("bold") },
  { label: "I", title: "Italic (⌘I)", run: g(() => c().focus().toggleItalic().run()), active: () => editor.isActive("italic") },
  { label: "U", title: "Underline (⌘U)", run: g(() => c().focus().toggleUnderline().run()), active: () => editor.isActive("underline") },
]);
sep();

//per-selection type, size, color, highlight (exports as \textrm/\textsf/\texttt,
//\fontsize, \textcolor, and soul \hl)
const familySel = toolbarSelect(
  [["", "Doc font"], ["serif", "Serif"], ["sans-serif", "Sans"], ["monospace", "Mono"]],
  "Font of the selected text",
  (v) => { if(!inMathField()){(v ? c().focus().setFontFamily(v) : c().focus().unsetFontFamily()).run();} }
);
const sizeSel = toolbarSelect(
  [["", "Size"], ...[8, 9, 10, 11, 12, 14, 17, 20, 24].map((n) => [`${n}pt`, `${n}`] as [string, string])],
  "Size of the selected text (pt)",
  (v) => { if(!inMathField()){(v ? c().focus().setFontSize(v) : c().focus().unsetFontSize()).run();} }
);

//no black/white swatches: each is invisible in one theme — "None" is the default color
const TEXT_COLORS = ["#e03131", "#f08c00", "#f5c518", "#2f9e44", "#0b7285", "#1971c2", "#9c36b5", "#e64980", "#868e96", "#795548"];
const HL_COLORS = ["#fff59d", "#b2f2bb", "#a5d8ff", "#fcc2d7", "#ffd8a8", "#e9d8fd", "#d3f9d8", "#ffe066"];

function buildPalette(anchor: HTMLElement, colors: string[], h: { apply: (hex: string) => void; clear: () => void }){
  const panel = popover(anchor);
  panel.classList.add("palette");
  const grid = document.createElement("div");
  grid.className = "swatches";
  for(const hex of colors){
    const b = document.createElement("button");
    b.className = "swatch";
    b.style.background = hex;
    b.title = hex;
    b.addEventListener("click", () => { h.apply(hex); panel.hidden = true; });
    grid.appendChild(b);
  }
  panel.appendChild(grid);
  const row = document.createElement("div");
  row.className = "palette-row";
  const none = document.createElement("button");
  none.textContent = "None";
  none.addEventListener("click", () => { h.clear(); panel.hidden = true; });
  const custom = document.createElement("input");
  custom.type = "color";
  custom.title = "Custom color…";
  custom.addEventListener("change", () => { h.apply(custom.value); panel.hidden = true; });
  row.append(none, custom);
  panel.appendChild(row);
}

//style controls act on the document's text selection — while a math field holds
//focus the stored ProseMirror selection is stale and styling would land elsewhere.
function inMathField(): boolean{
  if(document.activeElement?.tagName === "MATH-FIELD"){
    setStatus("Text styling applies to document text — click out of the math field first.", true);
    return true;
  }
  return false;
}

const colorBtn = addButton({ label: "A", title: "Text color", run: () => {} }, "color-a");
buildPalette(colorBtn, TEXT_COLORS, {
  apply: (hex) => { if(!inMathField()){c().focus().setColor(hex).run();} },
  clear: () => { if(!inMathField()){c().focus().unsetColor().run();} },
});
const hlBtn = addButton({ label: "🖍", title: "Highlight color", run: () => {} });
buildPalette(hlBtn, HL_COLORS, {
  apply: (hex) => { if(!inMathField()){c().focus().setHighlight({ color: hex }).run();} },
  clear: () => { if(!inMathField()){c().focus().unsetHighlight().run();} },
});

sep();
addButtons([
  { label: "H1", title: "Section", run: g(() => c().focus().toggleHeading({ level: 1 }).run()), active: () => editor.isActive("heading", { level: 1 }) },
  { label: "H2", title: "Subsection", run: g(() => c().focus().toggleHeading({ level: 2 }).run()), active: () => editor.isActive("heading", { level: 2 }) },
  { label: "H3", title: "Subsubsection", run: g(() => c().focus().toggleHeading({ level: 3 }).run()), active: () => editor.isActive("heading", { level: 3 }) },
]);
sep();
addButtons([
  { label: "•", title: "Bullet list", run: g(() => c().focus().toggleBulletList().run()), active: () => editor.isActive("bulletList") },
  { label: "1.", title: "Numbered list", run: g(() => c().focus().toggleOrderedList().run()), active: () => editor.isActive("orderedList") },
]);
sep();
addButtons([
  { label: "√x", title: "Inline math (⌘E)", run: g(() => editor.commands.insertMathInline()) },
  { label: "∑", title: "Display math (⌘⇧E)", run: g(() => editor.commands.insertMathBlock()) },
]);

//---------- tables ----------
const tableBtn = addButton({ label: "⊞", title: "Table", run: () => {} });
const tablePanel = popover(tableBtn);
tablePanel.classList.add("menu-panel");
function renderTablePanel(){
  tablePanel.innerHTML = "";
  const btn = (label: string, run: () => void) => {
    const b = document.createElement("button");
    b.textContent = label;
    b.addEventListener("click", () => {
      if(inMathField()){return;}
      run();
      renderTablePanel();
      refresh();
    });
    tablePanel.appendChild(b);
    return b;
  };
  if(editor.isActive("table")){
    btn("+ Row above", () => c().focus().addRowBefore().run());
    btn("+ Row below", () => c().focus().addRowAfter().run());
    btn("+ Column left", () => c().focus().addColumnBefore().run());
    btn("+ Column right", () => c().focus().addColumnAfter().run());
    btn("− Delete row", () => c().focus().deleteRow().run());
    btn("− Delete column", () => c().focus().deleteColumn().run());
    const style = editor.getAttributes("table").tableStyle ?? "grid";
    btn(style === "grid" ? "Style: Grid → Booktabs" : "Style: Booktabs → Grid", () =>
      c().focus().updateAttributes("table", { tableStyle: style === "grid" ? "booktabs" : "grid" }).run()
    );
    const del = btn("✕ Delete table", () => { c().focus().deleteTable().run(); tablePanel.hidden = true; });
    del.classList.add("danger");
  }else{
    const rows = Object.assign(document.createElement("input"), { type: "number", min: "1", max: "20", value: "3", title: "Rows" });
    const cols = Object.assign(document.createElement("input"), { type: "number", min: "1", max: "10", value: "3", title: "Columns" });
    const wrap = document.createElement("div");
    wrap.className = "table-insert";
    wrap.append(rows, document.createTextNode("×"), cols);
    tablePanel.appendChild(wrap);
    btn("Insert table", () => {
      c().focus().insertTable({
        rows: Math.max(1, Math.min(20, Number(rows.value) || 3)),
        cols: Math.max(1, Math.min(10, Number(cols.value) || 3)),
        withHeaderRow: true,
      }).run();
      tablePanel.hidden = true;
    });
  }
}
tableBtn.addEventListener("click", () => { if(!tablePanel.hidden){renderTablePanel();} });

//---------- symbol palettes ----------
//the math field being edited when a palette opens — search inputs steal DOM focus,
//so activeElement alone can't be trusted at insert time.
let paletteTarget: MathfieldElement | null = null;
function captureMathTarget(){
  const el = document.activeElement;
  paletteTarget = el?.tagName === "MATH-FIELD" ? (el as MathfieldElement) : null;
}
//once the user is back in document text, a remembered field is stale
editor.on("focus", () => {
  paletteTarget = null;
});

function renderGlyph(latex: string): string{
  try{
    return convertLatexToMarkup(latex.replace(/#0/g, "\\square"));
  }catch{
    return latex.replace(/\\/g, "");
  }
}

function symbolGrid(symbols: SymbolEntry[]): HTMLDivElement{
  const grid = document.createElement("div");
  grid.className = "symbol-grid";
  for(const entry of symbols){
    const el = document.createElement("button");
    el.innerHTML = renderGlyph(entry.latex);
    el.title = entry.aliases ? `${entry.latex} — ${entry.aliases.join(", ")}` : entry.latex;
    el.addEventListener("click", () => insertSymbol(entry.latex));
    grid.appendChild(el);
  }
  return grid;
}

//one small button per major category…
for(const cat of SYMBOL_CATEGORIES.filter((c2) => c2.button)){
  const b = addButton({ label: cat.button!, title: cat.label, run: () => {} }, "symbol-cat");
  b.addEventListener("click", captureMathTarget);
  const panel = popover(b);
  panel.classList.add("symbol-panel");
  panel.appendChild(symbolGrid(cat.symbols));
}
//…an Ω button holding everything else…
{
  const b = addButton({ label: "Ω", title: "More symbols", run: () => {} }, "symbol-cat");
  b.addEventListener("click", captureMathTarget);
  const panel = popover(b);
  panel.classList.add("symbol-panel");
  const body = document.createElement("div");
  body.className = "symbol-body";
  for(const cat of SYMBOL_CATEGORIES.filter((c2) => !c2.button)){
    const section = document.createElement("div");
    section.innerHTML = `<h4>${cat.label}</h4>`;
    section.appendChild(symbolGrid(cat.symbols));
    body.appendChild(section);
  }
  panel.appendChild(body);
}
//…and a search across all of it, matching commands and plain-English aliases.
{
  const b = addButton({ label: "🔍", title: "Search all symbols", run: () => {} }, "symbol-cat");
  b.addEventListener("click", captureMathTarget);
  const panel = popover(b);
  panel.classList.add("symbol-panel");
  const search = document.createElement("input");
  search.placeholder = "Search symbols… (integral, not equal, matrix)";
  search.className = "symbol-search";
  panel.appendChild(search);
  const results = document.createElement("div");
  results.className = "symbol-body";
  panel.appendChild(results);
  const ALL = SYMBOL_CATEGORIES.flatMap((cat) =>
    cat.symbols.map((sym) => ({ ...sym, category: cat.label.toLowerCase() }))
  );
  const update = () => {
    const q = search.value.trim().toLowerCase();
    results.innerHTML = "";
    if(!q){
      results.innerHTML = '<p class="hint">Type to search every symbol by name or meaning.</p>';
      return;
    }
    const hits = ALL.filter(
      (sym2) =>
        sym2.latex.toLowerCase().includes(q) ||
        sym2.category.includes(q) ||
        sym2.aliases?.some((a) => a.includes(q))
    ).slice(0, 80);
    if(hits.length){results.appendChild(symbolGrid(hits));}
    else{results.innerHTML = '<p class="hint">No matches.</p>';}
  };
  search.addEventListener("input", update);
  b.addEventListener("click", () => {
    if(!panel.hidden){
      update();
      search.focus();
    }
  });
  update();
}

function insertSymbol(latex: string){
  const active = document.activeElement;
  const mf =
    active?.tagName === "MATH-FIELD"
      ? (active as MathfieldElement)
      : paletteTarget?.isConnected
        ? paletteTarget
        : null;
  if(mf){
    mf.focus();
    mf.insert(latex);
    return;
  }
  //not in a math field: wrap it in a fresh inline math node. Constructs keep
  //editable placeholder slots and get focus so the user can fill them.
  const hasSlots = latex.includes("#0");
  if(hasSlots){requestMathFocus();}
  editor.chain().focus().insertMathInline(latex.replace(/#0/g, "\\placeholder{}")).run();
}

//right side of the toolbar
toolbar.appendChild(Object.assign(document.createElement("span"), { className: "spacer" }));

const zoomSel = document.createElement("select");
zoomSel.title = "Zoom";
for(const z of [50, 75, 90, 100, 125, 150, 200]){
  const o = document.createElement("option");
  o.value = String(z);
  o.textContent = `${z}%`;
  if(z === 100){o.selected = true;}
  zoomSel.appendChild(o);
}
zoomSel.addEventListener("change", () => {
  zoom = Number(zoomSel.value) / 100;
  applySettings();
  scheduleAutosave();
});
toolbar.appendChild(zoomSel);

//page setup
function settingsChanged(){
  applySettings();
  refresh();
  scheduleAutosave();
}
const pageBtn = addButton({ label: "Page", title: "Page setup (font, size, margins)", run: () => {} }, "action");
const pagePanel = popover(pageBtn);
const syncPageControls: (() => void)[] = [];
{
  pagePanel.classList.add("page-setup");
  const row = (label: string, control: HTMLElement) => {
    const div = document.createElement("label");
    div.innerHTML = `<span>${label}</span>`;
    div.appendChild(control);
    pagePanel.appendChild(div);
  };
  const sel = (options: [string, string][], get: () => string, onchange: (v: string) => void) => {
    const s = document.createElement("select");
    for(const [v, text] of options){
      const o = document.createElement("option");
      o.value = v;
      o.textContent = text;
      s.appendChild(o);
    }
    s.value = get();
    s.addEventListener("change", () => onchange(s.value));
    syncPageControls.push(() => (s.value = get()));
    return s;
  };
  row("Font", sel(
    [["latin-modern", "Latin Modern (default)"], ["times", "Times"], ["palatino", "Palatino"], ["helvetica", "Helvetica (sans)"]],
    () => settings.font,
    (v) => { settings.font = v as DocSettings["font"]; settingsChanged(); }
  ));
  row("Font size", sel(
    [["10", "10 pt"], ["11", "11 pt"], ["12", "12 pt"]],
    () => String(settings.fontSize),
    (v) => { settings.fontSize = Number(v) as DocSettings["fontSize"]; settingsChanged(); }
  ));
  row("Paper", sel(
    [["letter", "US Letter"], ["a4", "A4"]],
    () => settings.paper,
    (v) => { settings.paper = v as DocSettings["paper"]; settingsChanged(); }
  ));
  const margin = document.createElement("input");
  Object.assign(margin, { type: "number", min: "0.25", max: "2.5", step: "0.25", value: String(settings.marginIn) });
  margin.addEventListener("change", () => {
    settings.marginIn = Math.min(2.5, Math.max(0.25, Number(margin.value) || 1));
    margin.value = String(settings.marginIn);
    settingsChanged();
  });
  syncPageControls.push(() => (margin.value = String(settings.marginIn)));
  row("Margin (in)", margin);
}

addButton({ label: "Open", title: "Open document (⌘O)", run: openDoc }, "action");
addButton({ label: "Save", title: "Save document (⌘S)", run: () => saveDoc() }, "action");
addButton({ label: "Export .tex", title: "Export LaTeX source", run: exportTex }, "action");
addButton({ label: "Compile PDF", title: "Compile with pdflatex and open", run: compilePdf }, "action");

addButton({ label: "◐", title: "Dark mode", run: () => {
  const on = document.body.classList.toggle("dark");
  try{ localStorage.setItem("mt-theme", on ? "dark" : "light"); }catch{}
} });
try{
  if(localStorage.getItem("mt-theme") === "dark"){document.body.classList.add("dark");}
}catch{}

addButton({ label: "⇥", title: "Show/hide LaTeX pane", run: () => {
  document.querySelector("#panes")!.classList.toggle("pane-hidden");
} });

//---------- live LaTeX pane ----------
const pane = document.querySelector("#latex-pane")!;
let timer: number | undefined;
function refresh(){
  pane.textContent = docToLatex(editor.getJSON() as any, settings);
  for(const [el, b] of btnEls){el.classList.toggle("active", b.active?.() ?? false);}
  if(!tablePanel.hidden){renderTablePanel();} //keep the open panel in sync with keyboard edits
  const ts = editor.getAttributes("textStyle");
  familySel.value = ts.fontFamily ?? "";
  sizeSel.value = ts.fontSize ?? "";
  const color = ts.color ? cssToHex(ts.color) : null;
  colorBtn.style.borderBottom = color ? `3px solid #${color}` : "";
}
editor.on("transaction", () => {
  clearTimeout(timer);
  timer = window.setTimeout(refresh, 100);
});

//---------- status ----------
const status = document.querySelector("#status")!;
let lastErrorAt = 0;
function setStatus(msg: string, isError = false){
  if(isError){lastErrorAt = Date.now();}
  status.textContent = msg;
  status.classList.toggle("error", isError);
}
//routine notices (autosave ticks) must not bury a recent error
function setStatusSoft(msg: string){
  if(Date.now() - lastErrorAt < 8000){return;}
  setStatus(msg);
}

//---------- documents (.mtd = MathTyper document JSON) ----------
function docFile(): string{
  return JSON.stringify({ version: 1, settings, zoom, doc: editor.getJSON() });
}

function loadDocFile(text: string){
  let data: any;
  try{
    data = JSON.parse(text);
  }catch{
    throw new Error("Not a MathTyper document (invalid JSON)");
  }
  if(!data || typeof data !== "object" || !data.doc){
    throw new Error("Not a MathTyper document (no content)");
  }
  //validate before touching state. no update event, so the source file isn't
  //immediately rewritten with whatever the parse produced
  editor.commands.setContent(data.doc, { emitUpdate: false, errorOnInvalidContent: true });
  Object.assign(settings, DEFAULT_SETTINGS, data.settings ?? {});
  zoom = typeof data.zoom === "number" && data.zoom > 0 ? data.zoom : 1;
  zoomSel.value = String(Math.round(zoom * 100));
  applySettings();
  syncPageControls.forEach((f) => f());
  refresh();
}

//every document lives in a real file from its first edit, no save dialog needed
function two(n: number){
  return String(n).padStart(2, "0");
}
async function allocateAutosavePath(): Promise<string>{
  const d = new Date();
  const name = `Untitled ${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}.${two(d.getMinutes())}.${two(d.getSeconds())}.mtd`;
  return `${await documentDir()}/MathTyper/${name}`;
}

//---------- autosave ----------
let autosaveTimer: number | undefined;
let autosavePending = false; //an edit is waiting on the debounce
let autosaving = false;
function scheduleAutosave(){
  autosavePending = true;
  clearTimeout(autosaveTimer);
  autosaveTimer = window.setTimeout(autosave, 1500);
}
async function autosave(){
  if(autosaving){
    scheduleAutosave();
    return;
  }
  autosaving = true;
  autosavePending = false;
  try{
    const contents = docFile();
    if(isTauri){
      if(!filePath){filePath = await allocateAutosavePath();}
      const target = filePath;
      await invoke("write_file", { path: target, contents });
      setStatusSoft(`Autosaved ${new Date().toLocaleTimeString()} — ${target}`);
    }else{
      localStorage.setItem("mt-draft", contents);
      setStatusSoft(`Draft autosaved ${new Date().toLocaleTimeString()} (browser storage)`);
    }
  }catch(e){
    setStatus(`Autosave failed: ${e}`, true);
  }finally{
    autosaving = false;
  }
}
//write the outgoing document's pending edits before switching documents or quitting
async function flushAutosave(){
  clearTimeout(autosaveTimer);
  if(autosavePending){await autosave();}
}
editor.on("update", scheduleAutosave);

//flush the tail of the last edit on quit/close
if(isTauri){
  getCurrentWindow().onCloseRequested(async (e) => {
    if(autosavePending || autosaving){
      e.preventDefault();
      await flushAutosave();
      await invoke("quit_app");
    }
  });
}else{
  window.addEventListener("beforeunload", () => {
    if(autosavePending){
      clearTimeout(autosaveTimer);
      try{ localStorage.setItem("mt-draft", docFile()); }catch{}
    }
  });
}

//---------- new / open / save ----------

async function openDoc(){
  try{
    await flushAutosave(); //the outgoing doc keeps its last edits
    if(isTauri){
      const p = await openDialog({ filters: [{ name: "MathTyper document", extensions: ["mtd"] }], multiple: false });
      if(typeof p !== "string"){return;}
      loadDocFile(await invoke<string>("read_file", { path: p }));
      filePath = p;
      setStatus(`Opened ${p}`);
    }else{
      const input = Object.assign(document.createElement("input"), { type: "file", accept: ".mtd,application/json" });
      input.addEventListener("change", async () => {
        try{
          if(input.files?.[0]){loadDocFile(await input.files[0].text());}
        }catch(e){
          setStatus(`Open failed: ${e}`, true);
        }
      });
      input.click();
    }
  }catch(e){
    setStatus(`Open failed: ${e}`, true);
  }
}

async function saveDoc(saveAs = false){
  try{
    if(isTauri){
      let p = filePath;
      if(!p || saveAs){
        p = await save({ defaultPath: "document.mtd", filters: [{ name: "MathTyper document", extensions: ["mtd"] }] });
        if(!p){return;}
      }
      await invoke("write_file", { path: p, contents: docFile() });
      filePath = p; //only committed once the write succeeded
      setStatus(`Saved ${p}`);
    }else{
      download("document.mtd", docFile());
    }
  }catch(e){
    setStatus(`Save failed: ${e}`, true);
  }
}

window.addEventListener("keydown", (e) => {
  if(!(e.metaKey || e.ctrlKey)){return;}
  const k = e.key.toLowerCase();
  if(k === "s"){
    e.preventDefault();
    //commit any in-progress page-setup input before serializing
    if(document.activeElement instanceof HTMLInputElement){document.activeElement.blur();}
    saveDoc(e.shiftKey);
  }else if(k === "o"){
    e.preventDefault();
    openDoc();
  }
});

//---------- export ----------
function download(name: string, contents: string){
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([contents]));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

async function exportTex(){
  try{
    const latex = docToLatex(editor.getJSON() as any, settings);
    if(!isTauri){
      download("document.tex", latex);
      return;
    }
    const path = await save({ defaultPath: "document.tex", filters: [{ name: "LaTeX", extensions: ["tex"] }] });
    if(!path){return;}
    await invoke("write_file", { path, contents: latex });
    setStatus(`Saved ${path}`);
  }catch(e){
    setStatus(`Export failed: ${e}`, true);
  }
}

async function compilePdf(){
  if(!isTauri){
    setStatus("Compile needs the desktop app, run: npm run tauri dev", true);
    return;
  }
  setStatus("Compiling…");
  try{
    const pdf = await invoke<string>("compile_pdf", { latex: docToLatex(editor.getJSON() as any, settings) });
    setStatus(`Compiled → ${pdf}`);
  }catch(e){
    setStatus(`pdflatex failed:\n${e}`, true);
  }
}

applySettings();
refresh();
