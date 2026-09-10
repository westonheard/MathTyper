import "./styles.css";
import "mathlive/fonts.css";
import "mathlive/static.css";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { MathfieldElement, convertLatexToMarkup } from "mathlive";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog, save } from "@tauri-apps/plugin-dialog";
import { MathBlock, MathInline, requestMathFocus } from "./math-nodes";
import { DEFAULT_SETTINGS, docToLatex, type DocSettings } from "./latex";
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

//style controls act on the document's text selection — while a math field holds
//focus the stored ProseMirror selection is stale and styling would land elsewhere.
function inMathField(): boolean{
  if(document.activeElement?.tagName === "MATH-FIELD"){
    setStatus("Text styling applies to document text — click out of the math field first.", true);
    return true;
  }
  return false;
}

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
});
toolbar.appendChild(zoomSel);

//page setup
function settingsChanged(){
  applySettings();
  refresh();
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

addButton({ label: "⇥", title: "Show/hide LaTeX pane", run: () => {
  document.querySelector("#panes")!.classList.toggle("pane-hidden");
} });

//---------- live LaTeX pane ----------
const pane = document.querySelector("#latex-pane")!;
let timer: number | undefined;
function refresh(){
  pane.textContent = docToLatex(editor.getJSON() as any, settings);
  for(const [el, b] of btnEls){el.classList.toggle("active", b.active?.() ?? false);}
}
editor.on("transaction", () => {
  clearTimeout(timer);
  timer = window.setTimeout(refresh, 100);
});

//---------- status ----------
const status = document.querySelector("#status")!;
function setStatus(msg: string, isError = false){
  status.textContent = msg;
  status.classList.toggle("error", isError);
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

//---------- new / open / save ----------

async function openDoc(){
  try{
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
