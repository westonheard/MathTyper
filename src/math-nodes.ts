//TipTap atom nodes for math. An equation is drawn as static markup and only the one being
//edited gets a live MathLive <math-field>, since a live field per equation got heavy on long documents.
import { Node, nodeInputRule } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { MathfieldElement, convertLatexToMarkup } from "mathlive";

//focus a math field only when the user just asked for one (input rule, shortcut,
//palette), never on document load or undo
let focusRequested = false;
export function requestMathFocus(){
  focusRequested = true;
}

//turns the equation that currently holds the live field back into static markup,
//so there is never more than one field alive
let closeLive: (() => void) | null = null;

declare module "@tiptap/core"{
  interface Commands<ReturnType>{
    math: {
      insertMathInline: (latex?: string) => ReturnType;
      insertMathBlock: (latex?: string) => ReturnType;
    };
  }
}

function makeMathNode(name: "mathInline" | "mathBlock"){
  const inline = name === "mathInline";
  return Node.create({
    name,
    group: inline ? "inline" : "block",
    inline,
    atom: true,
    selectable: true,

    addAttributes(){
      return { latex: { default: "" } };
    },

    parseHTML(){
      return [
        {
          tag: `${inline ? "span" : "div"}[data-type="${name}"]`,
          getAttrs: (el) => ({ latex: (el as HTMLElement).dataset.latex ?? "" }),
        },
      ];
    },

    renderHTML({ node }){
      return [
        inline ? "span" : "div",
        { "data-type": name, "data-latex": node.attrs.latex },
        node.attrs.latex,
      ];
    },

    //the cursor is back in the document text, so the field is not needed anymore
    onFocus(){
      closeLive?.();
    },

    addNodeView(){
      return ({ node, editor, getPos }) => {
        const dom: HTMLElement = document.createElement(inline ? "span" : "div");
        dom.className = inline ? "math-inline" : "math-block";
        let mf: MathfieldElement | null = null;

        const pos = () => {
          const p = getPos();
          return typeof p === "number" ? p : null;
        };

        const showStatic = () => {
          mf = null;
          try{
            //an empty equation stays an empty element, the stylesheet draws a box for it
            dom.innerHTML = node.attrs.latex.trim() ? convertLatexToMarkup(node.attrs.latex) : "";
          }catch{
            dom.textContent = node.attrs.latex;
          }
        };

        const exit = (side: 1 | -1) => {
          const p = pos();
          if(p === null){return;}
          const { state, view } = editor;
          const target = side === 1 ? p + node.nodeSize : p;
          const sel = TextSelection.near(state.doc.resolve(target), side);
          view.dispatch(state.tr.setSelection(sel));
          view.focus();
        };

        //swap the static markup for a live field. x/y is where the user clicked, so the
        //caret lands there and not at the end
        const open = (x?: number, y?: number) => {
          if(mf){
            mf.focus();
            return;
          }
          closeLive?.();
          const field = new MathfieldElement();
          mf = field;
          field.value = node.attrs.latex;
          field.setAttribute("math-virtual-keyboard-policy", "manual");

          field.addEventListener("input", () => {
            const p = pos();
            if(p === null || field.value === node.attrs.latex){return;}
            const { state, view } = editor;
            view.dispatch(
              state.tr.setNodeMarkup(p, undefined, { latex: field.value }).setMeta("addToHistory", true)
            );
          });

          field.addEventListener("move-out", ((ev: CustomEvent) => {
            const dir = ev.detail?.direction;
            exit(dir === "backward" || dir === "upward" ? -1 : 1);
          }) as EventListener);

          field.addEventListener(
            "keydown",
            (ev) => {
              if(ev.key === "Escape" || (ev.key === "Enter" && !ev.shiftKey)){
                ev.preventDefault();
                ev.stopPropagation();
                exit(1);
              }else if(ev.key === "Backspace" && field.value === ""){
                ev.preventDefault();
                ev.stopPropagation();
                const p = pos();
                if(p === null){return;}
                const { state, view } = editor;
                view.dispatch(state.tr.delete(p, p + node.nodeSize));
                view.focus();
              }
            },
            { capture: true }
          );

          dom.replaceChildren(field);
          closeLive = () => {
            closeLive = null;
            showStatic();
          };
          setTimeout(() => {
            field.focus();
            if(x === undefined || y === undefined){return;}
            const offset = field.getOffsetFromPoint(x, y);
            if(offset >= 0){field.position = offset;}
          }, 0);
        };

        dom.addEventListener("mousedown", (ev) => {
          if(mf){return;}
          ev.preventDefault();
          open(ev.clientX, ev.clientY);
        });

        if(focusRequested){
          focusRequested = false;
          open();
        }else{
          showStatic();
        }

        return {
          dom,
          update: (updated) => {
            if(updated.type.name !== name){return false;}
            const changed = updated.attrs.latex !== node.attrs.latex;
            node = updated;
            if(mf){
              if(mf.value !== node.attrs.latex){mf.value = node.attrs.latex;}
            }else if(changed){
              showStatic();
            }
            return true;
          },
          selectNode: () => open(),
          stopEvent: () => true,
          ignoreMutation: () => true,
          destroy: () => {
            if(mf){closeLive = null;}
          },
        };
      };
    },

    addCommands(){
      const insert =
        (latex = "") =>
        ({ commands, dispatch, editor }: any) => {
          if(editor.isActive("codeBlock")){return false;} //would split the code block
          if(dispatch && !latex){requestMathFocus();}
          return commands.insertContent({ type: name, attrs: { latex } });
        };
      return inline ? { insertMathInline: insert } : { insertMathBlock: insert };
    },

    addKeyboardShortcuts(){
      //Mod-e and not Mod-m: Cmd-M is Minimize on macOS and the native menu wins in Tauri
      const key = inline ? "Mod-e" : "Mod-Shift-e";
      return {
        [key]: () =>
          inline ? this.editor.commands.insertMathInline() : this.editor.commands.insertMathBlock(),
      };
    },

    addInputRules(){
      if(!inline){return [];}
      //typing $ opens a live math field, Desmos style
      const rule = nodeInputRule({ find: /\$$/, type: this.type });
      const orig = rule.handler;
      (rule as any).handler = (props: any) => {
        //a $ inside a code block is literal code, not a math trigger
        if(props.state.doc.resolve(props.range.from).parent.type.name === "codeBlock"){return null;}
        requestMathFocus();
        return orig(props);
      };
      return [rule];
    },
  });
}

export const MathInline = makeMathNode("mathInline");
export const MathBlock = makeMathNode("mathBlock");
