import assert from "node:assert/strict";
import test from "node:test";

import {
  getFallbackQuranTextBox,
  parseQuranTextBoxFromSvgXml,
} from "./quranTextBox";

const approxEqual = (actual: number, expected: number, tolerance = 0.002) => {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `Expected ${actual} to be within ${tolerance} of ${expected}`,
  );
};

test("parses absolute clipPath rectangle into normalized text-box ratios", () => {
  const svgXml = `<svg><defs><clipPath id="page-rect"><path d="M0 547.086h382.677V0H0Z"/></clipPath><clipPath id="text"><path d="M94.437 472.248H334.729V73.858H94.437Z"/></clipPath></defs></svg>`;
  const parsed = parseQuranTextBoxFromSvgXml(svgXml);

  assert.ok(parsed);
  assert.equal(parsed.isFallback, false);
  assert.equal(parsed.clipPathId, "text");

  approxEqual(parsed.xRatio, 0.247);
  approxEqual(parsed.yRatio, 0.137);
  approxEqual(parsed.widthRatio, 0.628);
  approxEqual(parsed.heightRatio, 0.728);
});

test("parses relative-h clipPath rectangle into normalized text-box ratios", () => {
  const svgXml = `<svg><defs><clipPath id="page-rect"><path d="M0 547.086h382.677V0H0Z"/></clipPath><clipPath id="text"><path d="M85.11 423.161h212.457V123.925H85.11Z"/></clipPath></defs></svg>`;
  const parsed = parseQuranTextBoxFromSvgXml(svgXml);

  assert.ok(parsed);
  assert.equal(parsed.isFallback, false);
  assert.equal(parsed.clipPathId, "text");

  approxEqual(parsed.xRatio, 0.222);
  approxEqual(parsed.yRatio, 0.227);
  approxEqual(parsed.widthRatio, 0.555);
  approxEqual(parsed.heightRatio, 0.547);
});

test("falls back to large rectangle subpath when clipPaths only contain tiny boxes", () => {
  const svgXml = `<svg><defs><clipPath id="page-rect"><path d="M0 547.086h382.677V0H0Z"/></clipPath><clipPath id="tiny"><path d="M305.259 517.091h50.488v-13.315h-50.488z"/></clipPath></defs><path d="M342.48 67.827H86.681v411.431H342.48ZM120 130h20v-12h-20z"/></svg>`;
  const parsed = parseQuranTextBoxFromSvgXml(svgXml);

  assert.ok(parsed);
  assert.equal(parsed.isFallback, false);
  assert.equal(parsed.clipPathId, undefined);

  approxEqual(parsed.xRatio, 0.227);
  approxEqual(parsed.yRatio, 0.124);
  approxEqual(parsed.widthRatio, 0.668);
  approxEqual(parsed.heightRatio, 0.752);
});

test("returns null when no non-full-page text rectangle can be found", () => {
  const svgXml = `<svg><defs><clipPath id="page-rect"><path d="M0 547.086h382.677V0H0Z"/></clipPath></defs></svg>`;
  const parsed = parseQuranTextBoxFromSvgXml(svgXml);
  assert.equal(parsed, null);
});

test("fallback text-box is stable and marked as fallback", () => {
  const oddFallback = getFallbackQuranTextBox(3);
  const evenFallback = getFallbackQuranTextBox(300);

  assert.equal(oddFallback.isFallback, true);
  assert.equal(evenFallback.isFallback, true);

  approxEqual(oddFallback.xRatio, 0.121, 0.0001);
  approxEqual(oddFallback.yRatio, 0.137, 0.0001);
  approxEqual(oddFallback.widthRatio, 0.636, 0.0001);
  approxEqual(oddFallback.heightRatio, 0.729, 0.0001);

  approxEqual(evenFallback.xRatio, 0.241, 0.0001);
  approxEqual(evenFallback.yRatio, 0.137, 0.0001);
  approxEqual(evenFallback.widthRatio, 0.631, 0.0001);
  approxEqual(evenFallback.heightRatio, 0.724, 0.0001);
});
