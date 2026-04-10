import type { MushafPageLines } from "./mushafData";

export interface WordSvgPathSelection {
  pathIndex: number;
  subpathIndexes: number[];
}

type Matrix2D = [number, number, number, number, number, number];

type PathEntry = {
  index: number;
  rawTag: string;
  attrs: string;
  d: string | null;
  fill: string | null;
  transform: Matrix2D;
  subpaths: string[];
  attrsWithoutDStyleFill: string;
  baseStyle: string | null;
};

type ParsedSvgXml = {
  parts: string[];
  paths: PathEntry[];
};

type WordSubpathToken = {
  pathIndex: number;
  subpathIndex: number;
  cx: number;
  cy: number;
  weight: number;
};

type ClusterResult = {
  assignments: number[];
  centers: number[];
  variance: number;
};

type WordHighlightLayout = {
  sourceSvgXml: string;
  lineSignature: string;
  parsedSvg: ParsedSvgXml;
  selectionMap: Map<number, WordSvgPathSelection[]>;
  wordPathSelectionCache: Map<number, Map<number, number[]>>;
};

const PAGE_LAYOUT_CACHE = new Map<number, WordHighlightLayout>();
const MAX_LAYOUT_CACHE_PAGES = 12;
const PATH_TAG_REGEX = /<path\b([^>]*?)\/?>/gi;
const SVG_ATTRIBUTE_DOUBLE_QUOTE_REGEX = /"/g;
const SUBPATH_SPLIT_REGEX = /[Mm][^Mm]*/g;
const NUMBER_TOKEN_REGEX = /[+-]?(?:\d*\.\d+|\d+)(?:[eE][+-]?\d+)?/y;
const MAX_KMEANS_ITERATIONS = 24;
const DARK_TEXT_FILLS = new Set(["#231f20", "#000", "#000000", "black"]);

const identityMatrix = (): Matrix2D => [1, 0, 0, 1, 0, 0];

const normalizeFillColor = (fill: string | null): string | null => {
  if (!fill) return null;
  const normalized = fill.trim().toLowerCase();
  if (!normalized) return null;
  return normalized;
};

const parseStyleFill = (style: string | null): string | null => {
  if (!style) return null;
  const declarations = style.split(";");
  for (const declaration of declarations) {
    const [key, value] = declaration.split(":");
    if (!key || !value) continue;
    if (key.trim().toLowerCase() === "fill") {
      return normalizeFillColor(value);
    }
  }
  return null;
};

const getAttributeValue = (attrs: string, attrName: string): string | null => {
  const regex = new RegExp(`\\s${attrName}="([^"]*)"`, "i");
  const match = attrs.match(regex);
  return match?.[1] ?? null;
};

const stripAttributes = (attrs: string, names: string[]): string => {
  let cleaned = attrs;
  for (const name of names) {
    const regex = new RegExp(`\\s${name}="[^"]*"`, "gi");
    cleaned = cleaned.replace(regex, "");
  }
  const normalized = cleaned.replace(/\s+/g, " ").trim();
  return normalized ? ` ${normalized}` : "";
};

const withFillInStyle = (style: string | null, fillColor: string): string => {
  if (!style) {
    return `fill:${fillColor};`;
  }

  const declarations = style
    .split(";")
    .map((declaration) => declaration.trim())
    .filter(Boolean);
  let hasFill = false;
  const nextDeclarations = declarations.map((declaration) => {
    const [key, ...valueParts] = declaration.split(":");
    if (!key || !valueParts.length) return declaration;
    if (key.trim().toLowerCase() !== "fill") return declaration;
    hasFill = true;
    return `${key.trim()}:${fillColor}`;
  });

  if (!hasFill) {
    nextDeclarations.push(`fill:${fillColor}`);
  }

  return `${nextDeclarations.join(";")};`;
};

const escapeAttribute = (value: string) =>
  value.replace(SVG_ATTRIBUTE_DOUBLE_QUOTE_REGEX, "&quot;");

const multiplyMatrices = (left: Matrix2D, right: Matrix2D): Matrix2D => {
  const [a1, b1, c1, d1, e1, f1] = left;
  const [a2, b2, c2, d2, e2, f2] = right;

  return [
    a2 * a1 + c2 * b1,
    b2 * a1 + d2 * b1,
    a2 * c1 + c2 * d1,
    b2 * c1 + d2 * d1,
    a2 * e1 + c2 * f1 + e2,
    b2 * e1 + d2 * f1 + f2,
  ];
};

const parseTransformNumbers = (raw: string): number[] => {
  const values = raw.match(/[+-]?(?:\d*\.\d+|\d+)(?:[eE][+-]?\d+)?/g);
  if (!values) return [];
  return values
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));
};

const parseTransform = (rawTransform: string | null): Matrix2D => {
  if (!rawTransform) return identityMatrix();

  let matrix = identityMatrix();
  const transformRegex = /([a-zA-Z]+)\(([^)]*)\)/g;
  let match: RegExpExecArray | null;

  while (true) {
    match = transformRegex.exec(rawTransform);
    if (!match) break;

    const type = match[1]?.toLowerCase();
    const values = parseTransformNumbers(match[2] ?? "");
    if (!type) continue;

    if (type === "matrix" && values.length >= 6) {
      matrix = multiplyMatrices(
        matrix,
        [
          values[0] ?? 1,
          values[1] ?? 0,
          values[2] ?? 0,
          values[3] ?? 1,
          values[4] ?? 0,
          values[5] ?? 0,
        ],
      );
      continue;
    }

    if (type === "translate") {
      const tx = values[0] ?? 0;
      const ty = values[1] ?? 0;
      matrix = multiplyMatrices(matrix, [1, 0, 0, 1, tx, ty]);
      continue;
    }

    if (type === "scale") {
      const sx = values[0] ?? 1;
      const sy = values[1] ?? sx;
      matrix = multiplyMatrices(matrix, [sx, 0, 0, sy, 0, 0]);
      continue;
    }

    if (type === "rotate") {
      const angle = ((values[0] ?? 0) * Math.PI) / 180;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const rotation: Matrix2D = [cos, sin, -sin, cos, 0, 0];
      if (values.length >= 3) {
        const cx = values[1] ?? 0;
        const cy = values[2] ?? 0;
        matrix = multiplyMatrices(matrix, [1, 0, 0, 1, cx, cy]);
        matrix = multiplyMatrices(matrix, rotation);
        matrix = multiplyMatrices(matrix, [1, 0, 0, 1, -cx, -cy]);
      } else {
        matrix = multiplyMatrices(matrix, rotation);
      }
    }
  }

  return matrix;
};

const applyMatrixToPoint = (matrix: Matrix2D, x: number, y: number) => {
  const [a, b, c, d, e, f] = matrix;
  return {
    x: a * x + c * y + e,
    y: b * x + d * y + f,
  };
};

const applyMatrixToBounds = (
  matrix: Matrix2D,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
) => {
  const points = [
    applyMatrixToPoint(matrix, minX, minY),
    applyMatrixToPoint(matrix, minX, maxY),
    applyMatrixToPoint(matrix, maxX, minY),
    applyMatrixToPoint(matrix, maxX, maxY),
  ];

  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
  };
};

const buildTokenStream = (pathData: string) => {
  const tokens: { type: "cmd" | "num"; value: string | number }[] = [];
  let index = 0;

  while (index < pathData.length) {
    const current = pathData[index];
    if (!current) break;

    if (/\s|,/.test(current)) {
      index += 1;
      continue;
    }

    if (/[MmZzLlHhVvCcSsQqTtAa]/.test(current)) {
      tokens.push({ type: "cmd", value: current });
      index += 1;
      continue;
    }

    NUMBER_TOKEN_REGEX.lastIndex = index;
    const numberMatch = NUMBER_TOKEN_REGEX.exec(pathData);
    if (numberMatch?.[0]) {
      const parsed = Number(numberMatch[0]);
      if (Number.isFinite(parsed)) {
        tokens.push({ type: "num", value: parsed });
      }
      index = NUMBER_TOKEN_REGEX.lastIndex;
      continue;
    }

    index += 1;
  }

  return tokens;
};

const computePathBounds = (
  pathData: string,
): { minX: number; minY: number; maxX: number; maxY: number } | null => {
  const tokens = buildTokenStream(pathData);
  if (!tokens.length) return null;

  let tokenIndex = 0;
  let command: string | null = null;
  let x = 0;
  let y = 0;
  let subpathStartX = 0;
  let subpathStartY = 0;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  const addPoint = (px: number, py: number) => {
    minX = Math.min(minX, px);
    minY = Math.min(minY, py);
    maxX = Math.max(maxX, px);
    maxY = Math.max(maxY, py);
  };

  const readNumber = (): number | null => {
    const next = tokens[tokenIndex];
    if (!next || next.type !== "num") return null;
    tokenIndex += 1;
    return next.value as number;
  };

  while (tokenIndex < tokens.length) {
    const next = tokens[tokenIndex];
    if (!next) break;

    if (next.type === "cmd") {
      command = next.value as string;
      tokenIndex += 1;
    } else if (!command) {
      tokenIndex += 1;
      continue;
    }

    if (!command) continue;

    if (command === "M" || command === "m") {
      let isFirstPair = true;
      while (true) {
        const nx = readNumber();
        const ny = readNumber();
        if (nx == null || ny == null) break;

        const nextX = command === "m" ? x + nx : nx;
        const nextY = command === "m" ? y + ny : ny;
        x = nextX;
        y = nextY;
        addPoint(x, y);

        if (isFirstPair) {
          subpathStartX = x;
          subpathStartY = y;
          isFirstPair = false;
        }
      }

      command = command === "M" ? "L" : "l";
      continue;
    }

    if (command === "Z" || command === "z") {
      x = subpathStartX;
      y = subpathStartY;
      addPoint(x, y);
      continue;
    }

    if (command === "L" || command === "l") {
      while (true) {
        const nx = readNumber();
        const ny = readNumber();
        if (nx == null || ny == null) break;
        x = command === "l" ? x + nx : nx;
        y = command === "l" ? y + ny : ny;
        addPoint(x, y);
      }
      continue;
    }

    if (command === "H" || command === "h") {
      while (true) {
        const nx = readNumber();
        if (nx == null) break;
        x = command === "h" ? x + nx : nx;
        addPoint(x, y);
      }
      continue;
    }

    if (command === "V" || command === "v") {
      while (true) {
        const ny = readNumber();
        if (ny == null) break;
        y = command === "v" ? y + ny : ny;
        addPoint(x, y);
      }
      continue;
    }

    if (command === "C" || command === "c") {
      while (true) {
        const x1 = readNumber();
        const y1 = readNumber();
        const x2 = readNumber();
        const y2 = readNumber();
        const x3 = readNumber();
        const y3 = readNumber();
        if (
          x1 == null ||
          y1 == null ||
          x2 == null ||
          y2 == null ||
          x3 == null ||
          y3 == null
        ) {
          break;
        }

        const cp1x = command === "c" ? x + x1 : x1;
        const cp1y = command === "c" ? y + y1 : y1;
        const cp2x = command === "c" ? x + x2 : x2;
        const cp2y = command === "c" ? y + y2 : y2;
        const nextX = command === "c" ? x + x3 : x3;
        const nextY = command === "c" ? y + y3 : y3;

        addPoint(cp1x, cp1y);
        addPoint(cp2x, cp2y);
        addPoint(nextX, nextY);
        x = nextX;
        y = nextY;
      }
      continue;
    }

    if (command === "S" || command === "s") {
      while (true) {
        const x2 = readNumber();
        const y2 = readNumber();
        const x3 = readNumber();
        const y3 = readNumber();
        if (x2 == null || y2 == null || x3 == null || y3 == null) break;

        const cp2x = command === "s" ? x + x2 : x2;
        const cp2y = command === "s" ? y + y2 : y2;
        const nextX = command === "s" ? x + x3 : x3;
        const nextY = command === "s" ? y + y3 : y3;

        addPoint(cp2x, cp2y);
        addPoint(nextX, nextY);
        x = nextX;
        y = nextY;
      }
      continue;
    }

    if (command === "Q" || command === "q") {
      while (true) {
        const x1 = readNumber();
        const y1 = readNumber();
        const x2 = readNumber();
        const y2 = readNumber();
        if (x1 == null || y1 == null || x2 == null || y2 == null) break;

        const cpX = command === "q" ? x + x1 : x1;
        const cpY = command === "q" ? y + y1 : y1;
        const nextX = command === "q" ? x + x2 : x2;
        const nextY = command === "q" ? y + y2 : y2;

        addPoint(cpX, cpY);
        addPoint(nextX, nextY);
        x = nextX;
        y = nextY;
      }
      continue;
    }

    if (command === "T" || command === "t") {
      while (true) {
        const x2 = readNumber();
        const y2 = readNumber();
        if (x2 == null || y2 == null) break;

        const nextX = command === "t" ? x + x2 : x2;
        const nextY = command === "t" ? y + y2 : y2;
        addPoint(nextX, nextY);
        x = nextX;
        y = nextY;
      }
      continue;
    }

    if (command === "A" || command === "a") {
      while (true) {
        const rx = readNumber();
        const ry = readNumber();
        const angle = readNumber();
        const largeArcFlag = readNumber();
        const sweepFlag = readNumber();
        const x2 = readNumber();
        const y2 = readNumber();
        if (
          rx == null ||
          ry == null ||
          angle == null ||
          largeArcFlag == null ||
          sweepFlag == null ||
          x2 == null ||
          y2 == null
        ) {
          break;
        }
        const nextX = command === "a" ? x + x2 : x2;
        const nextY = command === "a" ? y + y2 : y2;
        addPoint(nextX, nextY);
        x = nextX;
        y = nextY;
      }
      continue;
    }

    tokenIndex += 1;
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY)) {
    return null;
  }
  if (!Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return null;
  }

  if (maxX <= minX || maxY <= minY) {
    return null;
  }

  return {
    minX,
    minY,
    maxX,
    maxY,
  };
};

const splitPathIntoSubpaths = (pathData: string): string[] => {
  const matches = pathData.match(SUBPATH_SPLIT_REGEX);
  if (!matches?.length) return [pathData];
  return matches.map((match) => match.trim()).filter(Boolean);
};

const parseSvgXml = (svgXml: string): ParsedSvgXml => {
  const parts: string[] = [];
  const paths: PathEntry[] = [];
  let lastSliceIndex = 0;
  let pathIndex = 0;
  let match: RegExpExecArray | null;

  PATH_TAG_REGEX.lastIndex = 0;
  while (true) {
    match = PATH_TAG_REGEX.exec(svgXml);
    if (!match) break;
    const rawTag = match[0];
    const attrs = match[1] ?? "";

    parts.push(svgXml.slice(lastSliceIndex, match.index));
    lastSliceIndex = match.index + rawTag.length;

    const d = getAttributeValue(attrs, "d");
    const style = getAttributeValue(attrs, "style");
    const styleFill = parseStyleFill(style);
    const fillAttr = normalizeFillColor(getAttributeValue(attrs, "fill"));
    const fill = styleFill ?? fillAttr;
    const transform = parseTransform(getAttributeValue(attrs, "transform"));

    const subpaths = d ? splitPathIntoSubpaths(d) : [];
    paths.push({
      index: pathIndex,
      rawTag,
      attrs,
      d,
      fill,
      transform,
      subpaths,
      attrsWithoutDStyleFill: stripAttributes(attrs, ["d", "style", "fill"]),
      baseStyle: style,
    });
    pathIndex += 1;
  }

  parts.push(svgXml.slice(lastSliceIndex));
  return { parts, paths };
};

const getLineWordCounts = (pageLines: MushafPageLines): number[] =>
  [...pageLines.lines]
    .sort((left, right) => left.lineNumber - right.lineNumber)
    .map((line) => line.words.filter((word) => word.charType === "word").length)
    .filter((count) => count > 0);

const toLineSignature = (lineWordCounts: number[]) => lineWordCounts.join(",");

const createWordSubpathTokens = (
  parsedSvg: ParsedSvgXml,
): WordSubpathToken[] => {
  const tokens: WordSubpathToken[] = [];

  const blackTextPaths = parsedSvg.paths.filter(
    (path) =>
      Boolean(path.d) &&
      Boolean(path.subpaths.length) &&
      Boolean(path.fill && DARK_TEXT_FILLS.has(path.fill)),
  );
  if (!blackTextPaths.length) {
    return tokens;
  }

  const sortedByLength = [...blackTextPaths].sort(
    (left, right) => (right.d?.length ?? 0) - (left.d?.length ?? 0),
  );
  const largestLength = sortedByLength[0]?.d?.length ?? 0;
  const secondLargestLength = sortedByLength[1]?.d?.length ?? 0;
  const shouldUseDominantPathOnly =
    secondLargestLength > 0 && largestLength >= secondLargestLength * 8;
  const candidatePaths = shouldUseDominantPathOnly
    ? sortedByLength.slice(0, 1)
    : blackTextPaths;

  for (const path of candidatePaths) {
    if (!path.d || !path.subpaths.length) continue;

    for (let subpathIndex = 0; subpathIndex < path.subpaths.length; subpathIndex += 1) {
      const subpathData = path.subpaths[subpathIndex];
      const localBounds = computePathBounds(subpathData);
      if (!localBounds) continue;

      const transformed = applyMatrixToBounds(
        path.transform,
        localBounds.minX,
        localBounds.minY,
        localBounds.maxX,
        localBounds.maxY,
      );
      const width = transformed.maxX - transformed.minX;
      const height = transformed.maxY - transformed.minY;
      if (width <= 0 || height <= 0) continue;

      const area = width * height;
      const weight = Math.max(0.2, Math.min(10, Math.sqrt(area)));
      tokens.push({
        pathIndex: path.index,
        subpathIndex,
        cx: (transformed.minX + transformed.maxX) / 2,
        cy: (transformed.minY + transformed.maxY) / 2,
        weight,
      });
    }
  }

  return tokens;
};

const buildWordSvgPathSelectionMapFromParsed = (
  parsedSvg: ParsedSvgXml,
  pageLines: MushafPageLines | null | undefined,
): Map<number, WordSvgPathSelection[]> => {
  if (!pageLines) return new Map();

  const lineWordCounts = getLineWordCounts(pageLines);
  if (!lineWordCounts.length) return new Map();
  const totalWords = lineWordCounts.reduce((sum, count) => sum + count, 0);
  if (totalWords <= 0) return new Map();

  const tokens = createWordSubpathTokens(parsedSvg);
  if (tokens.length < totalWords) return new Map();

  return buildWordSelectionMapFromLineClustering(tokens, lineWordCounts);
};

const cluster1D = (
  values: number[],
  weights: number[],
  clusterCount: number,
): ClusterResult | null => {
  if (clusterCount <= 0) return null;
  if (values.length < clusterCount) return null;

  const itemCount = values.length;
  const sortedIndices = values
    .map((value, index) => ({ value, index }))
    .sort((left, right) => left.value - right.value)
    .map((item) => item.index);

  const centers: number[] = Array.from({ length: clusterCount }, (_, index) => {
    const position = Math.floor(((index + 0.5) * itemCount) / clusterCount);
    const clamped = Math.max(0, Math.min(itemCount - 1, position));
    return values[sortedIndices[clamped]] ?? values[0] ?? 0;
  });

  const assignments = new Array<number>(itemCount).fill(0);
  for (let iteration = 0; iteration < MAX_KMEANS_ITERATIONS; iteration += 1) {
    let changed = false;
    for (let itemIndex = 0; itemIndex < itemCount; itemIndex += 1) {
      const value = values[itemIndex] ?? 0;
      let bestCluster = 0;
      let bestDistance = Number.POSITIVE_INFINITY;
      for (let clusterIndex = 0; clusterIndex < centers.length; clusterIndex += 1) {
        const distance = Math.abs(value - (centers[clusterIndex] ?? 0));
        if (distance < bestDistance) {
          bestDistance = distance;
          bestCluster = clusterIndex;
        }
      }
      if (assignments[itemIndex] !== bestCluster) {
        assignments[itemIndex] = bestCluster;
        changed = true;
      }
    }

    const weightedSums = new Array<number>(clusterCount).fill(0);
    const weightSums = new Array<number>(clusterCount).fill(0);
    for (let itemIndex = 0; itemIndex < itemCount; itemIndex += 1) {
      const cluster = assignments[itemIndex] ?? 0;
      const weight = weights[itemIndex] ?? 1;
      weightedSums[cluster] += (values[itemIndex] ?? 0) * weight;
      weightSums[cluster] += weight;
    }

    let shifted = false;
    for (let clusterIndex = 0; clusterIndex < clusterCount; clusterIndex += 1) {
      if (weightSums[clusterIndex] <= 0) {
        continue;
      }
      const nextCenter = weightedSums[clusterIndex] / weightSums[clusterIndex];
      if (Math.abs(nextCenter - (centers[clusterIndex] ?? 0)) > 1e-4) {
        shifted = true;
      }
      centers[clusterIndex] = nextCenter;
    }

    const emptyClusters = weightSums
      .map((sum, index) => ({ sum, index }))
      .filter((entry) => entry.sum <= 0)
      .map((entry) => entry.index);
    if (emptyClusters.length) {
      for (const emptyCluster of emptyClusters) {
        let candidateIndex = 0;
        let candidateDistance = -1;
        for (let itemIndex = 0; itemIndex < itemCount; itemIndex += 1) {
          const cluster = assignments[itemIndex] ?? 0;
          const distance = Math.abs(
            (values[itemIndex] ?? 0) - (centers[cluster] ?? 0),
          );
          if (distance > candidateDistance) {
            candidateDistance = distance;
            candidateIndex = itemIndex;
          }
        }
        assignments[candidateIndex] = emptyCluster;
        centers[emptyCluster] = values[candidateIndex] ?? 0;
      }
      continue;
    }

    if (!changed && !shifted) {
      break;
    }
  }

  let variance = 0;
  for (let itemIndex = 0; itemIndex < itemCount; itemIndex += 1) {
    const cluster = assignments[itemIndex] ?? 0;
    const delta = (values[itemIndex] ?? 0) - (centers[cluster] ?? 0);
    variance += (weights[itemIndex] ?? 1) * delta * delta;
  }

  return { assignments, centers, variance };
};

type OrientationResult = {
  score: number;
  wordSelections: Map<number, WordSvgPathSelection[]>;
};

const buildWordSelectionsFromLineBuckets = (
  lineBuckets: WordSubpathToken[][],
  lineWordCounts: number[],
): OrientationResult | null => {
  if (lineBuckets.length !== lineWordCounts.length) return null;

  const rawSelections = new Map<number, Map<number, Set<number>>>();
  let globalWordOffset = 0;
  let score = 0;

  for (let lineIndex = 0; lineIndex < lineWordCounts.length; lineIndex += 1) {
    const expectedWordCount = lineWordCounts[lineIndex] ?? 0;
    const lineTokens = lineBuckets[lineIndex] ?? [];
    if (lineTokens.length < expectedWordCount || expectedWordCount <= 0) {
      return null;
    }

    const xClusters = cluster1D(
      lineTokens.map((token) => token.cx),
      lineTokens.map((token) => token.weight),
      expectedWordCount,
    );
    if (!xClusters) return null;

    score += xClusters.variance;

    const wordClusterOrder = xClusters.centers
      .map((center, centerIndex) => ({ center, centerIndex }))
      .sort((left, right) => right.center - left.center)
      .map((item) => item.centerIndex);

    const wordOrderMap = new Map<number, number>();
    wordClusterOrder.forEach((cluster, order) => {
      wordOrderMap.set(cluster, order);
    });

    for (let tokenIndex = 0; tokenIndex < lineTokens.length; tokenIndex += 1) {
      const token = lineTokens[tokenIndex];
      const localCluster = xClusters.assignments[tokenIndex];
      if (localCluster == null) continue;
      const wordOffset = wordOrderMap.get(localCluster);
      if (wordOffset == null) continue;

      const globalWordIndex = globalWordOffset + wordOffset;
      if (!rawSelections.has(globalWordIndex)) {
        rawSelections.set(globalWordIndex, new Map());
      }
      const byPath = rawSelections.get(globalWordIndex);
      if (!byPath) continue;
      if (!byPath.has(token.pathIndex)) {
        byPath.set(token.pathIndex, new Set());
      }
      byPath.get(token.pathIndex)?.add(token.subpathIndex);
    }

    globalWordOffset += expectedWordCount;
  }

  const wordSelections = new Map<number, WordSvgPathSelection[]>();
  for (const [wordIndex, byPath] of rawSelections.entries()) {
    const selections: WordSvgPathSelection[] = [];
    for (const [pathIndex, subpathSet] of byPath.entries()) {
      const subpathIndexes = [...subpathSet].sort((left, right) => left - right);
      if (!subpathIndexes.length) continue;
      selections.push({
        pathIndex,
        subpathIndexes,
      });
    }
    selections.sort((left, right) => left.pathIndex - right.pathIndex);
    if (selections.length) {
      wordSelections.set(wordIndex, selections);
    }
  }

  return {
    score,
    wordSelections,
  };
};

const buildSelectionsForOrientation = (
  tokens: WordSubpathToken[],
  lineWordCounts: number[],
  lineClusters: ClusterResult,
  useDescendingLineOrder: boolean,
): OrientationResult | null => {
  const clustersByLine = lineClusters.centers
    .map((center, index) => ({ center, index }))
    .sort((left, right) => left.center - right.center)
    .map((item) => item.index);

  if (useDescendingLineOrder) {
    clustersByLine.reverse();
  }

  const lineBuckets: WordSubpathToken[][] = [];
  for (let lineIndex = 0; lineIndex < lineWordCounts.length; lineIndex += 1) {
    const clusterId = clustersByLine[lineIndex];
    if (clusterId == null) return null;
    lineBuckets.push(
      tokens.filter(
        (_, tokenIndex) =>
          (lineClusters.assignments[tokenIndex] ?? -1) === clusterId,
      ),
    );
  }

  return buildWordSelectionsFromLineBuckets(lineBuckets, lineWordCounts);
};

const buildSelectionsFromYRatioSlices = (
  tokens: WordSubpathToken[],
  lineWordCounts: number[],
  useDescendingLineOrder: boolean,
): OrientationResult | null => {
  if (!tokens.length || !lineWordCounts.length) return null;
  const sortedTokens = [...tokens].sort((left, right) => left.cy - right.cy);
  if (useDescendingLineOrder) {
    sortedTokens.reverse();
  }

  const totalWords = lineWordCounts.reduce((sum, count) => sum + count, 0);
  if (totalWords <= 0) return null;

  const lineBuckets: WordSubpathToken[][] = [];
  let used = 0;
  let cumulativeWords = 0;
  for (let lineIndex = 0; lineIndex < lineWordCounts.length; lineIndex += 1) {
    const wordCount = lineWordCounts[lineIndex] ?? 0;
    cumulativeWords += wordCount;

    const isLastLine = lineIndex === lineWordCounts.length - 1;
    const nextUsed = isLastLine
      ? sortedTokens.length
      : Math.floor((sortedTokens.length * cumulativeWords) / totalWords);
    lineBuckets.push(sortedTokens.slice(used, nextUsed));
    used = nextUsed;
  }

  return buildWordSelectionsFromLineBuckets(lineBuckets, lineWordCounts);
};

const pickBestOrientationResult = (
  candidates: (OrientationResult | null)[],
): OrientationResult | null => {
  const valid = candidates.filter(
    (candidate): candidate is OrientationResult => Boolean(candidate),
  );
  if (!valid.length) return null;

  valid.sort((left, right) => left.score - right.score);
  return valid[0] ?? null;
};

const buildWordSelectionMapFromLineClustering = (
  tokens: WordSubpathToken[],
  lineWordCounts: number[],
): Map<number, WordSvgPathSelection[]> => {
  const lineClusters = cluster1D(
    tokens.map((token) => token.cy),
    tokens.map((token) => token.weight),
    lineWordCounts.length,
  );
  if (!lineClusters) return new Map();

  const bestResult = pickBestOrientationResult([
    buildSelectionsForOrientation(tokens, lineWordCounts, lineClusters, false),
    buildSelectionsForOrientation(tokens, lineWordCounts, lineClusters, true),
    buildSelectionsFromYRatioSlices(tokens, lineWordCounts, false),
    buildSelectionsFromYRatioSlices(tokens, lineWordCounts, true),
  ]);

  if (!bestResult) return new Map();
  return bestResult.wordSelections;
};

export const buildWordSvgPathSelectionMap = (
  svgXml: string,
  pageLines: MushafPageLines | null | undefined,
) => {
  const parsedSvg = parseSvgXml(svgXml);
  return buildWordSvgPathSelectionMapFromParsed(parsedSvg, pageLines);
};

const resolveLayout = (
  pageNumber: number,
  svgXml: string,
  pageLines: MushafPageLines,
): WordHighlightLayout | null => {
  const lineSignature = toLineSignature(getLineWordCounts(pageLines));
  const cached = PAGE_LAYOUT_CACHE.get(pageNumber);
  if (
    cached &&
    cached.sourceSvgXml === svgXml &&
    cached.lineSignature === lineSignature
  ) {
    PAGE_LAYOUT_CACHE.delete(pageNumber);
    PAGE_LAYOUT_CACHE.set(pageNumber, cached);
    return cached;
  }

  const parsedSvg = parseSvgXml(svgXml);
  const selectionMap = buildWordSvgPathSelectionMapFromParsed(
    parsedSvg,
    pageLines,
  );
  const nextLayout: WordHighlightLayout = {
    sourceSvgXml: svgXml,
    lineSignature,
    parsedSvg,
    selectionMap,
    wordPathSelectionCache: new Map(),
  };

  PAGE_LAYOUT_CACHE.set(pageNumber, nextLayout);
  while (PAGE_LAYOUT_CACHE.size > MAX_LAYOUT_CACHE_PAGES) {
    const oldest = PAGE_LAYOUT_CACHE.keys().next().value as number | undefined;
    if (oldest == null) break;
    PAGE_LAYOUT_CACHE.delete(oldest);
  }
  return nextLayout;
};

const getWordSelectionsByPath = (
  layout: WordHighlightLayout,
  activeWordIndex: number,
): Map<number, number[]> | null => {
  if (layout.wordPathSelectionCache.has(activeWordIndex)) {
    return layout.wordPathSelectionCache.get(activeWordIndex) ?? null;
  }

  const selections = layout.selectionMap.get(activeWordIndex);
  if (!selections?.length) {
    layout.wordPathSelectionCache.set(activeWordIndex, new Map());
    return null;
  }

  const byPath = new Map<number, number[]>();
  for (const selection of selections) {
    if (!selection.subpathIndexes.length) continue;
    byPath.set(selection.pathIndex, selection.subpathIndexes);
  }
  layout.wordPathSelectionCache.set(activeWordIndex, byPath);
  return byPath.size ? byPath : null;
};

const buildHighlightPathTag = (
  path: PathEntry,
  subpathIndexes: number[],
  highlightColor: string,
): string => {
  if (!path.subpaths.length) return "";
  const pathData = subpathIndexes
    .map((index) => path.subpaths[index])
    .filter(Boolean)
    .join("");
  if (!pathData) return "";

  const escapedPathData = escapeAttribute(pathData);
  if (path.baseStyle != null) {
    const styled = withFillInStyle(path.baseStyle, highlightColor);
    return `<path${path.attrsWithoutDStyleFill} d="${escapedPathData}" style="${escapeAttribute(styled)}"/>`;
  }

  return `<path${path.attrsWithoutDStyleFill} d="${escapedPathData}" fill="${escapeAttribute(highlightColor)}"/>`;
};

const renderSvgWithWordHighlight = (
  parsedSvg: ParsedSvgXml,
  highlightedByPath: Map<number, number[]>,
  highlightColor: string,
): string => {
  if (!highlightedByPath.size) {
    const chunks: string[] = [];
    for (let pathIndex = 0; pathIndex < parsedSvg.paths.length; pathIndex += 1) {
      chunks.push(parsedSvg.parts[pathIndex] ?? "");
      chunks.push(parsedSvg.paths[pathIndex]?.rawTag ?? "");
    }
    chunks.push(parsedSvg.parts[parsedSvg.parts.length - 1] ?? "");
    return chunks.join("");
  }

  const chunks: string[] = [];
  for (let pathIndex = 0; pathIndex < parsedSvg.paths.length; pathIndex += 1) {
    chunks.push(parsedSvg.parts[pathIndex] ?? "");
    const path = parsedSvg.paths[pathIndex];
    if (!path) continue;
    chunks.push(path.rawTag);

    const subpathIndexes = highlightedByPath.get(path.index);
    if (!subpathIndexes?.length) continue;
    const highlightTag = buildHighlightPathTag(path, subpathIndexes, highlightColor);
    if (highlightTag) {
      chunks.push(highlightTag);
    }
  }

  chunks.push(parsedSvg.parts[parsedSvg.parts.length - 1] ?? "");
  return chunks.join("");
};

export interface WordHighlightSvgParams {
  pageNumber: number;
  svgXml: string;
  pageLines: MushafPageLines | null | undefined;
  activeWordIndex: number | null | undefined;
  highlightColor: string;
}

export const applyWordHighlightToSvgXml = ({
  pageNumber,
  svgXml,
  pageLines,
  activeWordIndex,
  highlightColor,
}: WordHighlightSvgParams): string => {
  if (!pageLines) return svgXml;
  if (activeWordIndex == null || !Number.isFinite(activeWordIndex)) {
    return svgXml;
  }
  const normalizedWordIndex = Math.trunc(activeWordIndex);
  if (normalizedWordIndex < 0) return svgXml;

  const layout = resolveLayout(pageNumber, svgXml, pageLines);
  if (!layout) return svgXml;

  const highlightedByPath = getWordSelectionsByPath(layout, normalizedWordIndex);
  if (!highlightedByPath) return svgXml;
  if (!highlightedByPath.size) return svgXml;

  return renderSvgWithWordHighlight(
    layout.parsedSvg,
    highlightedByPath,
    highlightColor,
  );
};
