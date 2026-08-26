import "./styles.css";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";

//---------- editor ----------
const editor = new Editor({
  element: document.querySelector("#editor")!,
  extensions: [
    StarterKit,
  ],
  content: "<h1>Welcome to MathTyper</h1><p>Start typing.</p>",
  autofocus: "end",
});
if(import.meta.env.DEV){(window as any).editor = editor;}
