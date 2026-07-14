/**
 * Content-hash cache-busting keys for first-party CSS/JS.
 *
 * Each first-party asset is sha1-hashed over its (combined) source content
 * and a 10-char hex slice is exported under a key. Templates append the value
 * as `?v=<hash>` to the asset URL so a deploy that changes the file changes the
 * URL — defeating the service worker's stale-while-revalidate cache without a
 * hard refresh. CDN / remote URLs are intentionally not hashed here.
 *
 * CommonJS module (package.json has no "type":"module").
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ASSETS_DIR = path.join(__dirname, "..", "assets");

function sha10(buf) {
  return crypto.createHash("sha1").update(buf).digest("hex").slice(0, 10);
}

// Recursively resolve local `@import "..."` / `@import url(...)` partials so a
// stylesheet whose imported partial changes also gets a new hash.
function readCssWithImports(absPath, seen) {
  seen = seen || new Set();
  if (seen.has(absPath)) return "";
  seen.add(absPath);
  let css;
  try {
    css = fs.readFileSync(absPath, "utf8");
  } catch {
    return "";
  }
  const importRe = /@import\s+(?:url\(\s*)?["']?([^"')]+)["']?\s*\)?[^;]*;/g;
  let combined = css;
  let m;
  while ((m = importRe.exec(css)) !== null) {
    const ref = m[1].trim();
    if (/^(https?:)?\/\//.test(ref) || ref.startsWith("data:")) continue; // remote — leave alone
    const importAbs = path.resolve(path.dirname(absPath), ref);
    combined += "\n/*@import " + ref + "*/\n" + readCssWithImports(importAbs, seen);
  }
  return combined;
}

function hashCss(relPath) {
  return sha10(readCssWithImports(path.join(ASSETS_DIR, relPath)));
}

function hashFile(relPath) {
  try {
    return sha10(fs.readFileSync(path.join(ASSETS_DIR, relPath)));
  } catch {
    return "0000000000";
  }
}

module.exports = {
  // First-party stylesheet (hashes imported partials too, if any are added later)
  styleCss: hashCss("css/style.css"),
  // First-party script
  mainJs: hashFile("js/main.js")
};
