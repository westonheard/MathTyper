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

function preamble(s: DocSettings): string{
  return `\\documentclass[${s.fontSize}pt]{article}
\\usepackage[${s.paper === "a4" ? "a4paper" : "letterpaper"}, margin=${s.marginIn}in]{geometry}
\\usepackage{amsmath}
\\usepackage{amssymb}
\\usepackage[normalem]{ulem}
${FONT_PACKAGES[s.font]}

\\begin{document}
`;
}

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

function serializeText(node: PMNode): string{
  let out = escapeLatex(node.text ?? "");
  const basic: string[] = [];
  for(const mark of node.marks ?? []){
    switch(mark.type){
      case "bold": basic.push("\\textbf"); break;
      case "italic": basic.push("\\textit"); break;
      case "underline": basic.push("\\underline"); break;
      case "strike": basic.push("\\sout"); break;
      case "code": basic.push("\\texttt"); break;
    }
  }
  for(const cmd of basic){out = `${cmd}{${out}}`;}
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
  return preamble(settings) + "\n" + serializeBlocks(doc.content) + "\\end{document}\n";
}
