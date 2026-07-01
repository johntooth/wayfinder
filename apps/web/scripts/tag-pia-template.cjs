// Authoring step for the devtest PIA seed: derives `pia-tool.tagged.docx` from the
// provided `pia-tool.docx` fixture by inserting a {{placeholder}} paragraph after
// each body section heading. generate_document needs {{ }} tags to know what the
// AI should fill; the source fixture has none. The original is left untouched.
//
//   node apps/web/scripts/tag-pia-template.cjs
//
// pizzip is resolved from the adapters package (it is not a web dependency).
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.join(__dirname, "..", "..", "..");
const adaptersDir = path.join(repoRoot, "packages", "adapters");
const PizZip = require(require.resolve("pizzip", { paths: [adaptersDir] }));

const fixtures = path.join(repoRoot, "tests", "e2e", "fixtures");
const source = path.join(fixtures, "pia-tool.docx");
const target = path.join(fixtures, "pia-tool.tagged.docx");

// Body section heading → placeholder the AI fills. Headings appear in both the
// TOC (TOC2/TOC3 styles) and the body (Heading2/Heading3); we only tag the body.
const headingTags = [
  ["Description of the project and parties", "project_description"],
  ["Scope of this privacy impact assessment", "scope"],
  ["Stakeholder identification and consultation", "stakeholders"],
  ["Map information flows", "information_flows"],
  ["Privacy impact analysis", "privacy_impact_analysis"],
  ["Ensuring compliance", "compliance"],
];

const tagParagraph = (tag) =>
  `<w:p><w:r><w:t xml:space="preserve">{{${tag}}}</w:t></w:r></w:p>`;

// Concatenate a paragraph's visible text — handles headings whose text Word split
// across multiple runs.
const visibleText = (paragraph) =>
  (paragraph.match(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g) || [])
    .map((run) => run.replace(/<[^>]+>/g, ""))
    .join("");

const zip = new PizZip(fs.readFileSync(source));
let xml = zip.file("word/document.xml").asText();

const paragraphs = xml.match(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g) || [];

let injected = 0;
const missed = [];
for (const [title, tag] of headingTags) {
  // The body heading is the last Heading-styled paragraph carrying the title; the
  // Heading-style filter skips the earlier TOC entry (TOC* style).
  let targetParagraph = null;
  for (const paragraph of paragraphs) {
    if (visibleText(paragraph).includes(title) && /w:val="Heading\d"/.test(paragraph)) {
      targetParagraph = paragraph;
    }
  }
  if (!targetParagraph) {
    missed.push(title);
    continue;
  }
  const insertAt = xml.lastIndexOf(targetParagraph) + targetParagraph.length;
  xml = xml.slice(0, insertAt) + tagParagraph(tag) + xml.slice(insertAt);
  injected += 1;
}

zip.file("word/document.xml", xml);
fs.writeFileSync(target, zip.generate({ type: "nodebuffer" }));

console.log(`Injected ${injected}/${headingTags.length} tags -> ${path.basename(target)}`);
if (missed.length > 0) console.log(`  no body heading matched for: ${missed.join("; ")}`);
