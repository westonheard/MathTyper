//Run with: node src/latex.test.ts
import assert from "node:assert/strict";
import { cssToHex, docToLatex, escapeLatex, fontSizePt } from "./latex.ts";

assert.equal(cssToHex("rgb(300, 0, 0)"), null);
assert.equal(cssToHex("red"), "FF0000");
assert.equal(cssToHex("rgb(255, 0, 0)"), "FF0000");
assert.equal(cssToHex("#abc"), "AABBCC");
assert.equal(cssToHex("oklch(0.7 0.1 200)"), null);
assert.equal(fontSizePt("14pt"), 14);
assert.equal(fontSizePt("16px"), 12);
assert.equal(fontSizePt("1.1em"), 0);
assert.equal(fontSizePt("120%"), 0);

assert.equal(escapeLatex("50% of $10 & a_b #1 {x}"), "50\\% of \\$10 \\& a\\_b \\#1 \\{x\\}");
assert.equal(escapeLatex("a\\b~c^d"), "a\\textbackslash{}b\\textasciitilde{}c\\textasciicircum{}d");
assert.equal(escapeLatex("a<b>c|d"), "a\\textless{}b\\textgreater{}c\\textbar{}d");

const doc = {
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Intro" }] },
    {
      type: "paragraph",
      content: [
        { type: "text", text: "Let " },
        { type: "mathInline", attrs: { latex: "x=\\frac{1}{2}" } },
        { type: "text", text: " be ", marks: [] },
        { type: "text", text: "bold", marks: [{ type: "bold" }] },
        { type: "text", text: ".", marks: [] },
      ],
    },
    { type: "mathBlock", attrs: { latex: "\\int_0^1 x\\,dx" } },
    {
      type: "paragraph",
      content: [{ type: "mathInline", attrs: { latex: "\\frac{\\placeholder{}}{\\placeholder{}}" } }],
    },
    //abandoned empty fields and boundary hard breaks must not reach the output
    {
      type: "paragraph",
      content: [
        { type: "hardBreak" },
        { type: "text", text: "trimmed" },
        { type: "mathInline", attrs: { latex: "" } },
        { type: "hardBreak" },
      ],
    },
    { type: "mathBlock", attrs: { latex: "  " } },
    {
      type: "paragraph",
      content: [
        { type: "text", text: "red", marks: [{ type: "textStyle", attrs: { color: "#e03131" } }] },
        { type: "text", text: "big", marks: [{ type: "textStyle", attrs: { fontSize: "17pt" } }] },
        { type: "text", text: "mono", marks: [{ type: "textStyle", attrs: { fontFamily: "monospace" } }] },
        { type: "text", text: "marked", marks: [{ type: "highlight", attrs: { color: "rgb(255, 245, 157)" } }] },
        { type: "text", text: "mystery", marks: [{ type: "highlight", attrs: { color: "oklch(0.7 0.1 200)" } }] },
      ],
    },
    {
      type: "codeBlock",
      content: [{ type: "text", text: "safe code\n\\end{verbatim}\nmore code" }],
    },
    {
      type: "bulletList",
      content: [
        { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "one" }] }] },
        { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "two" }] }] },
      ],
    },
  ],
};

const tex = docToLatex(doc as any);
for(const expected of [
  "\\documentclass[11pt]{article}",
  "\\usepackage[letterpaper, margin=1in]{geometry}",
  "\\usepackage{lmodern}",
  "\\section{Intro}",
  "Let $x=\\frac{1}{2}$ be \\textbf{bold}.",
  "\\[\n\\int_0^1 x\\,dx\n\\]",
  "$\\frac{}{}$",
  "\ntrimmed\n",
  "\\textcolor[HTML]{E03131}{red}",
  "{\\fontsize{17pt}{20.4pt}\\selectfont big}",
  "\\texttt{mono}",
  "{\\sethlcolor{hlFFF59D}\\hl{marked}}",
  "\\definecolor{hlFFF59D}{HTML}{FFF59D}",
  "\\usepackage{soul}",
  //embedded \end{verbatim} gets its token broken so the environment survives
  "safe code\n\\end {verbatim}\nmore code",
  "\\begin{itemize}\n  \\item one\n  \\item two\n\\end{itemize}",
  "\\end{document}",
]){
  assert.ok(tex.includes(expected), `missing: ${expected}\n---\n${tex}`);
}

//unknown colors are dropped, never emitted as black
assert.ok(!tex.includes("hl000000"), "unknown highlight color must be dropped, not black");
assert.ok(tex.includes("mystery") && !tex.includes("\\hl{mystery}"), "mystery keeps its text but loses the bad highlight");

console.log("latex serializer: all checks passed");
