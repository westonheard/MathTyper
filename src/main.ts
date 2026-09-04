import "./styles.css";
import "mathlive/fonts.css";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { MathfieldElement } from "mathlive";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { MathBlock, MathInline } from "./math-nodes";
import { docToLatex } from "./latex";

MathfieldElement.soundsDirectory = null;
MathfieldElement.fontsDirectory = null; //fonts come from the bundled fonts.css

const isTauri = "__TAURI_INTERNALS__" in window;

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

//right side of the toolbar
toolbar.appendChild(Object.assign(document.createElement("span"), { className: "spacer" }));

addButton({ label: "Export .tex", title: "Export LaTeX source", run: exportTex }, "action");
addButton({ label: "Compile PDF", title: "Compile with pdflatex and open", run: compilePdf }, "action");

//---------- live LaTeX pane ----------
const pane = document.querySelector("#latex-pane")!;
let timer: number | undefined;
function refresh(){
  pane.textContent = docToLatex(editor.getJSON() as any);
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
    const latex = docToLatex(editor.getJSON() as any);
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
    const pdf = await invoke<string>("compile_pdf", { latex: docToLatex(editor.getJSON() as any) });
    setStatus(`Compiled → ${pdf}`);
  }catch(e){
    setStatus(`pdflatex failed:\n${e}`, true);
  }
}

refresh();
