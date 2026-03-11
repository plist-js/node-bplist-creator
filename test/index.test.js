import { test, expect } from "bun:test";
import fs from "node:fs/promises";
import path from "node:path";

import bplistParser from "bplist-parser";

import bplistCreator from "../src/index";

const testFiles = [
  "sample1.bplist",
  "sample2.bplist",
  "binaryData.bplist",
  "airplay.bplist",
  "integers.bplist",
];

// Helper to handle the specific data normalization seen in the original test
function normalizeDicts(dicts) {
  if (!dicts || !dicts[0]) return dicts;
  const d = dicts[0];

  // airplay overrides
  if (d.loadedTimeRanges?.[0]?.hasOwnProperty("start")) {
    d.loadedTimeRanges[0].start = {
      bplistOverride: true,
      type: "double",
      value: d.loadedTimeRanges[0].start,
    };
  }
  if (d.seekableTimeRanges?.[0]?.hasOwnProperty("start")) {
    d.seekableTimeRanges[0].start = {
      bplistOverride: true,
      type: "double",
      value: d.seekableTimeRanges[0].start,
    };
  }
  if (d.hasOwnProperty("rate")) {
    d.rate = { bplistOverride: true, type: "double", value: d.rate };
  }

  // utf16 / string overrides
  const stringKeys = [
    "NSHumanReadableCopyright",
    "CFBundleExecutable",
    "CFBundleDisplayName",
    "DTPlatformBuild",
  ];
  stringKeys.forEach((key) => {
    if (d.hasOwnProperty(key)) {
      d[key] = {
        bplistOverride: true,
        type: key === "NSHumanReadableCopyright" ? "string-utf16" : "string",
        value: d[key],
      };
    }
  });

  if (d.CFBundleURLTypes?.[0]?.hasOwnProperty("CFBundleURLSchemes")) {
    d.CFBundleURLTypes[0].CFBundleURLSchemes[0] = {
      bplistOverride: true,
      type: "string",
      value: d.CFBundleURLTypes[0].CFBundleURLSchemes[0],
    };
  }

  // integer
  if (d.hasOwnProperty("int64item")) {
    d.int64item = {
      bplistOverride: true,
      type: "number",
      value: d.int64item.value,
    };
  }

  return dicts;
}

// Generate tests dynamically
testFiles.forEach((fileName) => {
  test(`should round-trip ${fileName} correctly`, async () => {
    const filePath = path.join(import.meta.dir, fileName);

    // 1. Read original file
    const originalBuffer = await fs.readFile(filePath);

    // 2. Parse (using a Promise wrapper since bplist-parser is typically callback-based)
    const dicts = await new Promise((resolve, reject) => {
      bplistParser.parseFile(filePath, (err, data) =>
        err ? reject(err) : resolve(data),
      );
    });

    // 3. Normalize & Re-create
    const normalized = normalizeDicts(dicts);
    const generatedBuffer = bplistCreator(normalized);

    // 4. Assert - Bun's expect handles Buffer comparison automatically
    expect(generatedBuffer).toEqual(originalBuffer);
  });
});
