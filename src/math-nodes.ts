//TipTap atom nodes that embed a MathLive <math-field> for Desmos-style math typing.
import { Node, nodeInputRule } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { MathfieldElement } from "mathlive";

//focus a math field only when the user just asked for one (input rule, shortcut,
//palette), never on document load or undo
let focusRequested = false;
export function requestMathFocus(){
  focusRequested = true;
}

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

    addNodeView(){
      return ({ node, editor, getPos }) => {
        const dom = document.createElement(inline ? "span" : "div");
        dom.className = inline ? "math-inline" : "math-block";
        const mf = new MathfieldElement();
        mf.value = node.attrs.latex;
        mf.setAttribute("math-virtual-keyboard-policy", "manual");
        dom.appendChild(mf);
        if(focusRequested){
          focusRequested = false;
          setTimeout(() => mf.focus(), 0);
        }

        const pos = () => {
          const p = getPos();
          return typeof p === "number" ? p : null;
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

        mf.addEventListener("input", () => {
          const p = pos();
          if(p === null || mf.value === node.attrs.latex){return;}
          const { state, view } = editor;
          view.dispatch(
            state.tr.setNodeMarkup(p, undefined, { latex: mf.value }).setMeta("addToHistory", true)
          );
        });

        mf.addEventListener("move-out", ((ev: CustomEvent) => {
          const dir = ev.detail?.direction;
          exit(dir === "backward" || dir === "upward" ? -1 : 1);
        }) as EventListener);

        mf.addEventListener(
          "keydown",
          (ev) => {
            if(ev.key === "Escape" || (ev.key === "Enter" && !ev.shiftKey)){
              ev.preventDefault();
              ev.stopPropagation();
              exit(1);
            }else if(ev.key === "Backspace" && mf.value === ""){
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

        return {
          dom,
          update: (updated) => {
            if(updated.type.name !== name){return false;}
            node = updated;
            if(mf.value !== updated.attrs.latex){mf.value = updated.attrs.latex;}
            return true;
          },
          selectNode: () => mf.focus(),
          stopEvent: () => true,
          ignoreMutation: () => true,
        };
      };
    },

    addCommands(){
      const insert =
        (latex = "") =>
        ({ commands, dispatch, editor }: any) => {
          if(editor.isActive("codeBlock")) return false; //would split the code block
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
