//serialize a TipTap/ProseMirror document (editor.getJSON()) to a compilable LaTeX file.

type PMNode = {
  type: string;
  attrs?: Record<string, any>;
  content?: PMNode[];
  marks?: { type: string; attrs?: Record<string, any> }[];
  text?: string;
};

export type DocSettings = {
  fontSize: 10 | 11 | 12;
  font: "latin-modern" | "times" | "palatino" | "helvetica";
  paper: "letter" | "a4";
  marginIn: number;
};

export const DEFAULT_SETTINGS: DocSettings = {
  fontSize: 11,
  font: "latin-modern",
  paper: "letter",
  marginIn: 1,
};

const FONT_PACKAGES: Record<DocSettings["font"], string> = {
  "latin-modern": "\\usepackage{lmodern}",
  times: "\\usepackage{mathptmx}",
  palatino: "\\usepackage{mathpazo}",
  helvetica: "\\usepackage[scaled]{helvet}\n\\renewcommand{\\familydefault}{\\sfdefault}",
};

function preamble(s: DocSettings, highlightColors: Set<string>): string{
  const defs = [...highlightColors]
    .map((hex) => `\\definecolor{hl${hex}}{HTML}{${hex}}`)
    .join("\n");
  return `\\documentclass[${s.fontSize}pt]{article}
\\usepackage[${s.paper === "a4" ? "a4paper" : "letterpaper"}, margin=${s.marginIn}in]{geometry}
\\usepackage{amsmath}
\\usepackage{amssymb}
\\usepackage[normalem]{ulem}
\\usepackage{xcolor}
\\usepackage{soul}
${FONT_PACKAGES[s.font]}${defs ? "\n" + defs : ""}

\\begin{document}
`;
}

const NAMED_COLORS: Record<string, string> = {
  black: "000000", white: "FFFFFF", red: "FF0000", green: "008000", blue: "0000FF",
  yellow: "FFFF00", orange: "FFA500", purple: "800080", pink: "FFC0CB", gray: "808080",
  grey: "808080", brown: "A52A2A", cyan: "00FFFF", magenta: "FF00FF", lime: "00FF00",
  navy: "000080", teal: "008080", maroon: "800000", olive: "808000", silver: "C0C0C0",
  gold: "FFD700", violet: "EE82EE", indigo: "4B0082", coral: "FF7F50",
};

//"#f00", "#ff0000", "rgb(255, 0, 0)", or a common named color → "FF0000".
//unknown values (oklch(), lab(), obscure names) → null; callers DROP the mark
//rather than exporting black-by-accident.
export function cssToHex(c: string): string | null{
  const m = c.match(/^rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)/);
  if(m){
    const parts = [m[1], m[2], m[3]].map(Number);
    if(parts.some((n) => n > 255)){return null;} //invalid CSS, drop it. 7 hex digits would break \definecolor
    return parts.map((n) => n.toString(16).padStart(2, "0")).join("").toUpperCase();
  }
  const named = NAMED_COLORS[c.trim().toLowerCase()];
  if(named){return named;}
  let h = c.replace("#", "").trim();
  if(h.length === 3){h = [...h].map((ch) => ch + ch).join("");}
  return /^[0-9a-fA-F]{6}$/.test(h) ? h.toUpperCase() : null;
}

//pasted content carries px/em/% sizes; only pt and px map cleanly to LaTeX.
export function fontSizePt(v: string): number{
  const m = String(v).trim().match(/^([\d.]+)(pt|px)?$/);
  if(!m){return 0;} //em / rem / % / keywords: drop the size rather than guess
  const n = parseFloat(m[1]);
  return m[2] === "px" ? n * 0.75 : n;
}

//collected during serialization, reset per docToLatex call
let usedHighlights: Set<string> = new Set();

//MathLive leaves \placeholder{} atoms in unfilled construct slots; empty braces compile fine.
function cleanMath(latex: string): string{
  return latex.replace(/\\placeholder\{\}/g, "");
}

export function escapeLatex(text: string): string{
  return text
    .replace(/\\/g, "\u0000")
    .replace(/([&%$#_{}])/g, "\\$1")
    .replace(/~/g, "\\textasciitilde{}")
    .replace(/\^/g, "\\textasciicircum{}")
    .replace(/</g, "\\textless{}")
    .replace(/>/g, "\\textgreater{}")
    .replace(/\|/g, "\\textbar{}")
    .replace(/\u0000/g, "\\textbackslash{}");
}

const FAMILY_CMD: Record<string, string> = {
  serif: "\\textrm",
  "sans-serif": "\\textsf",
  monospace: "\\texttt",
};

function serializeText(node: PMNode): string{
  let out = escapeLatex(node.text ?? "");
  let style: Record<string, any> | null = null;
  let highlight: Record<string, any> | null = null;
  const basic: string[] = [];
  for(const mark of node.marks ?? []){
    switch(mark.type){
      case "bold": basic.push("\\textbf"); break;
      case "italic": basic.push("\\textit"); break;
      case "underline": basic.push("\\underline"); break;
      case "strike": basic.push("\\sout"); break;
      case "code": basic.push("\\texttt"); break;
      case "textStyle": style = mark.attrs ?? null; break;
      case "highlight": highlight = mark.attrs ?? {}; break;
    }
  }
  //soul's \hl chokes on commands in its argument — keep it innermost, around plain text only
  if(highlight){
    const hex = cssToHex(highlight.color || "#fff59d"); //"" (pasted bare <mark>) → default yellow
    if(hex){
      usedHighlights.add(hex);
      const hl = (s: string) => `{\\sethlcolor{hl${hex}}\\hl{${s}}}`;
      const strikeIdx = basic.indexOf("\\sout");
      if(strikeIdx >= 0){
        //ulem's \sout over \hl breaks on any space — strike word by word instead
        basic.splice(strikeIdx, 1);
        out = out.split(" ").map((w) => (w ? `\\sout{${hl(w)}}` : "")).join(hl(" "));
      }else{
        out = hl(out);
      }
    }
    //unknown color: drop the highlight — never emit a black bar
  }
  for(const cmd of basic){out = `${cmd}{${out}}`;}
  const family = style?.fontFamily && FAMILY_CMD[style.fontFamily];
  if(family){out = `${family}{${out}}`;}
  const colorHex = style?.color ? cssToHex(style.color) : null;
  if(colorHex){out = `\\textcolor[HTML]{${colorHex}}{${out}}`;}
  const pt = style?.fontSize ? fontSizePt(style.fontSize) : 0;
  if(pt){out = `{\\fontsize{${pt}pt}{${(pt * 1.2).toFixed(1)}pt}\\selectfont ${out}}`;}
  return out;
}

function serializeInline(nodes: PMNode[] = []): string{
  return nodes
    .map((n) => {
      switch(n.type){
        case "text": return serializeText(n);
        case "mathInline": {
          const m = cleanMath(n.attrs?.latex ?? "");
          return m.trim() ? `$${m}$` : ""; //an abandoned empty field must not emit bare $$
        }
        case "hardBreak": return "\\\\\n";
        default: return "";
      }
    })
    .join("");
}

const SECTION = ["\\section", "\\subsection", "\\subsubsection"];

function serializeBlock(node: PMNode): string{
  switch(node.type){
    case "paragraph": {
      //\\ at a paragraph boundary is a TeX error ("no line here to end") — trim them
      const inline = serializeInline(node.content)
        .replace(/^(\\\\\n)+/, "")
        .replace(/(\\\\\n)+$/, "");
      return inline.trim() === "" ? "" : inline + "\n\n";
    }
    case "heading": {
      const level = Math.min(node.attrs?.level ?? 1, 3);
      return `${SECTION[level - 1]}{${serializeInline(node.content)}}\n\n`;
    }
    case "mathBlock": {
      const m = cleanMath(node.attrs?.latex ?? "");
      return m.trim() ? `\\[\n${m}\n\\]\n\n` : "";
    }
    case "bulletList":
      return wrapList("itemize", node.content);
    case "orderedList":
      return wrapList("enumerate", node.content);
    case "blockquote":
      return `\\begin{quote}\n${serializeBlocks(node.content)}\\end{quote}\n\n`;
    case "codeBlock": {
      //a literal \end{verbatim} in the code would terminate the environment early;
      //break the token with a space (visible in the PDF, but honest and compilable)
      const raw = (node.content ?? [])
        .map((n) => n.text ?? "")
        .join("")
        .replace(/\\end\{verbatim\}/g, "\\end {verbatim}");
      return `\\begin{verbatim}\n${raw}\n\\end{verbatim}\n\n`;
    }
    case "horizontalRule":
      return "\\par\\noindent\\hrulefill\\par\n\n";
    default:
      return "";
  }
}

function wrapList(env: string, items: PMNode[] = []): string{
  //no continuation-line indenting: it would inject spaces into verbatim bodies
  const body = items
    .map((item) => "  \\item " + serializeBlocks(item.content).trim())
    .join("\n");
  return `\\begin{${env}}\n${body}\n\\end{${env}}\n\n`;
}

function serializeBlocks(nodes: PMNode[] = []): string{
  return nodes.map(serializeBlock).join("");
}

export function docToLatex(doc: PMNode, settings: DocSettings = DEFAULT_SETTINGS): string{
  usedHighlights = new Set();
  const body = serializeBlocks(doc.content); //fills usedHighlights
  return preamble(settings, usedHighlights) + "\n" + body + "\\end{document}\n";
}
