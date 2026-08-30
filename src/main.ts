import "./styles.css";
import "mathlive/fonts.css";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { MathfieldElement } from "mathlive";
import { MathBlock, MathInline } from "./math-nodes";
import { docToLatex } from "./latex";

MathfieldElement.soundsDirectory = null;
MathfieldElement.fontsDirectory = null; //fonts come from the bundled fonts.css

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

addButtons([
  { label: "B", title: "Bold (⌘B)", run: () => c().focus().toggleBold().run(), active: () => editor.isActive("bold") },
  { label: "I", title: "Italic (⌘I)", run: () => c().focus().toggleItalic().run(), active: () => editor.isActive("italic") },
  { label: "U", title: "Underline (⌘U)", run: () => c().focus().toggleUnderline().run(), active: () => editor.isActive("underline") },
]);
sep();

addButtons([
  { label: "H1", title: "Section", run: () => c().focus().toggleHeading({ level: 1 }).run(), active: () => editor.isActive("heading", { level: 1 }) },
  { label: "H2", title: "Subsection", run: () => c().focus().toggleHeading({ level: 2 }).run(), active: () => editor.isActive("heading", { level: 2 }) },
  { label: "H3", title: "Subsubsection", run: () => c().focus().toggleHeading({ level: 3 }).run(), active: () => editor.isActive("heading", { level: 3 }) },
]);
sep();
addButtons([
  { label: "•", title: "Bullet list", run: () => c().focus().toggleBulletList().run(), active: () => editor.isActive("bulletList") },
  { label: "1.", title: "Numbered list", run: () => c().focus().toggleOrderedList().run(), active: () => editor.isActive("orderedList") },
]);
sep();
addButtons([
  { label: "√x", title: "Inline math (⌘E)", run: () => editor.commands.insertMathInline() },
  { label: "∑", title: "Display math (⌘⇧E)", run: () => editor.commands.insertMathBlock() },
]);

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

refresh();
