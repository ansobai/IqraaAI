import assert from "node:assert/strict";
import test from "node:test";

import type { MushafPageLines } from "./mushafData";
import {
  applyWordHighlightToSvgXml,
  buildWordSvgPathSelectionMap,
} from "./quranSvgWordHighlight";

const SAMPLE_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
  <path d="M70 80h8v4h-8zM58 80h8v4h-8zM46 80h8v4h-8zM72 60h8v4h-8zM60 60h8v4h-8z" style="fill:#231f20;fill-rule:evenodd;stroke:none" />
</svg>
`.trim();

const SAMPLE_PAGE_LINES: MushafPageLines = {
  pageNumber: 1,
  lines: [
    {
      lineNumber: 1,
      words: [
        { text: "w1", charType: "word" },
        { text: "w2", charType: "word" },
        { text: "w3", charType: "word" },
      ],
    },
    {
      lineNumber: 2,
      words: [
        { text: "w4", charType: "word" },
        { text: "w5", charType: "word" },
      ],
    },
  ],
};

test("buildWordSvgPathSelectionMap maps page word order to exact path subpaths", () => {
  const selectionMap = buildWordSvgPathSelectionMap(
    SAMPLE_SVG,
    SAMPLE_PAGE_LINES,
  );

  const selection0 = selectionMap.get(0);
  const selection1 = selectionMap.get(1);
  const selection4 = selectionMap.get(4);

  assert.ok(selection0);
  assert.ok(selection1);
  assert.ok(selection4);

  assert.deepEqual(selection0, [{ pathIndex: 0, subpathIndexes: [0] }]);
  assert.deepEqual(selection1, [{ pathIndex: 0, subpathIndexes: [1] }]);
  assert.deepEqual(selection4, [{ pathIndex: 0, subpathIndexes: [4] }]);
});

test("applyWordHighlightToSvgXml injects only selected glyph subpaths in red", () => {
  const highlighted = applyWordHighlightToSvgXml({
    pageNumber: 1,
    svgXml: SAMPLE_SVG,
    pageLines: SAMPLE_PAGE_LINES,
    activeWordIndex: 1,
    highlightColor: "#ff0000",
  });

  const redPathMatch = highlighted.match(
    /<path[^>]*?(?:style="[^"]*fill:#ff0000[^"]*"|fill="#ff0000")[^>]*>/i,
  );
  assert.ok(redPathMatch);

  const redPathData = redPathMatch?.[0].match(/\sd="([^"]+)"/i)?.[1] ?? "";
  assert.ok(redPathData.includes("M58 80h8v4h-8z"));
  assert.equal(redPathData.includes("M46 80h8v4h-8z"), false);
  assert.equal(redPathData.includes("M70 80h8v4h-8z"), false);
});

test("applyWordHighlightToSvgXml falls back to original XML for unmapped words", () => {
  const highlighted = applyWordHighlightToSvgXml({
    pageNumber: 1,
    svgXml: SAMPLE_SVG,
    pageLines: SAMPLE_PAGE_LINES,
    activeWordIndex: 99,
    highlightColor: "#ff0000",
  });

  assert.equal(highlighted, SAMPLE_SVG);
});
