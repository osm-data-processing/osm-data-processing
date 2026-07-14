const fs = require("fs");
const path = require("path");

function readRaw(inputPath) {
  try {
    return fs.readFileSync(inputPath, "utf8");
  } catch {
    return "";
  }
}

function extractTitle(raw) {
  const m = raw.match(/^#\s+(.+?)\s*$/m);
  return m ? m[1].trim() : null;
}

function extractDescription(raw) {
  const lines = raw.split("\n");
  let pastH1 = false;
  const buf = [];
  for (const line of lines) {
    if (!pastH1) {
      if (/^#\s+/.test(line)) pastH1 = true;
      continue;
    }
    if (line.trim() === "") {
      if (buf.length) break;
      continue;
    }
    if (/^#{1,6}\s+/.test(line)) break;
    if (/^```/.test(line)) break;
    buf.push(line.trim());
  }
  let text = buf.join(" ");
  text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
  text = text.replace(/`([^`]+)`/g, "$1");
  text = text.replace(/\*\*?([^*]+)\*\*?/g, "$1");
  text = text.replace(/\s+/g, " ").trim();
  // Keep description ≤ 165 chars (audit limit)
  if (text.length > 165) text = text.slice(0, 162).replace(/\s+\S*$/, "") + "…";
  return text;
}

module.exports = {
  layout: "layouts/content.njk",
  tags: ["content"],
  eleventyComputed: {
    permalink: (data) => {
      // Strip the /content/ prefix so e.g.
      // src/content/osm-data-fundamentals-architecture/index.md
      // is published at /osm-data-fundamentals-architecture/
      const fp = data.page.filePathStem || "";
      let p = fp.replace(/^\/content/, "");
      if (p.endsWith("/index")) p = p.slice(0, -"/index".length);
      if (!p.endsWith("/")) p += "/";
      return p + "index.html";
    },
    title: (data) => {
      // Prefer an explicit frontmatter page title when one is set
      if (data.pageTitle) return data.pageTitle;
      const raw = readRaw(data.page.inputPath);
      return extractTitle(raw) || data.title || data.page.fileSlug;
    },
    description: (data) => {
      // Prefer an explicit frontmatter page description when one is set
      if (data.pageDescription) return data.pageDescription;
      const raw = readRaw(data.page.inputPath);
      return extractDescription(raw) || data.description || "";
    }
  }
};
