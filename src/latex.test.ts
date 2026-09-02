//Run with: node src/latex.test.ts
import assert from "node:assert/strict";
import { docToLatex, escapeLatex } from "./latex.ts";

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
  "\\section{Intro}",
  "Let $x=\\frac{1}{2}$ be \\textbf{bold}.",
  "\\[\n\\int_0^1 x\\,dx\n\\]",
  "$\\frac{}{}$",
  "\ntrimmed\n",
  //embedded \end{verbatim} gets its token broken so the environment survives
  "safe code\n\\end {verbatim}\nmore code",
  "\\begin{itemize}\n  \\item one\n  \\item two\n\\end{itemize}",
  "\\end{document}",
]){
  assert.ok(tex.includes(expected), `missing: ${expected}\n---\n${tex}`);
}

console.log("latex serializer: all checks passed");
