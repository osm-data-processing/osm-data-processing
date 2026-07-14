const fs = require("fs");
const path = require("path");

const markdownIt = require("markdown-it");
const markdownItAnchor = require("markdown-it-anchor");
const markdownItAttrs = require("markdown-it-attrs");
const markdownItTaskLists = require("markdown-it-task-lists");
const markdownItKatex = require("@iktakahiro/markdown-it-katex");
const eleventyNavigation = require("@11ty/eleventy-navigation");

const Prism = require("prismjs");
const loadLanguages = require("prismjs/components/index.js");
loadLanguages([
  "bash",
  "python",
  "json",
  "yaml",
  "sql",
  "javascript",
  "typescript",
  "ini",
  "toml",
  "diff",
  "markup",
  "css"
]);

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[c]));
}

function slugify(s) {
  return String(s)
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-");
}

module.exports = function (eleventyConfig) {
  // Plugins
  eleventyConfig.addPlugin(eleventyNavigation);

  // Markdown library
  const md = markdownIt({
    html: true,
    linkify: true,
    typographer: true,
    breaks: false
  });

  md.use(markdownItAttrs);
  md.use(markdownItAnchor, {
    slugify,
    permalink: markdownItAnchor.permalink.linkInsideHeader({
      symbol: `<span class="visually-hidden">Jump to heading</span><span aria-hidden="true">#</span>`,
      placement: "after"
    })
  });
  md.use(markdownItTaskLists, { enabled: true, label: true, lineNumber: false });
  md.use(markdownItKatex, { throwOnError: false, errorColor: "#b9311a" });

  // Fence: mermaid blocks + copy-button wrapper around all others
  md.renderer.rules.fence = function (tokens, idx) {
    const token = tokens[idx];
    const info = (token.info || "").trim();
    const lang = info.split(/\s+/)[0] || "";
    const code = token.content;

    if (lang === "mermaid") {
      return `<div class="mermaid-wrap"><pre class="mermaid">${escapeHtml(code)}</pre></div>\n`;
    }

    let highlighted;
    if (lang && Prism.languages[lang]) {
      highlighted = Prism.highlight(code, Prism.languages[lang], lang);
    } else {
      highlighted = escapeHtml(code);
    }

    const label = lang || "code";
    return [
      `<figure class="code-block" data-lang="${escapeHtml(label)}">`,
      `  <figcaption class="code-block__bar">`,
      `    <span class="code-block__lang">${escapeHtml(label)}</span>`,
      `    <button type="button" class="code-block__copy" aria-label="Copy code">Copy</button>`,
      `  </figcaption>`,
      `  <pre class="code-block__pre language-${escapeHtml(label)}"><code class="language-${escapeHtml(label)}">${highlighted}</code></pre>`,
      `</figure>\n`
    ].join("\n");
  };

  // Wrap tables so they scroll horizontally on narrow viewports
  const defaultTableOpen = md.renderer.rules.table_open || function (tokens, idx, options, env, self) {
    return self.renderToken(tokens, idx, options);
  };
  const defaultTableClose = md.renderer.rules.table_close || function (tokens, idx, options, env, self) {
    return self.renderToken(tokens, idx, options);
  };
  md.renderer.rules.table_open = function (tokens, idx, options, env, self) {
    return `<div class="table-scroll">` + defaultTableOpen(tokens, idx, options, env, self);
  };
  md.renderer.rules.table_close = function (tokens, idx, options, env, self) {
    return defaultTableClose(tokens, idx, options, env, self) + `</div>`;
  };

  eleventyConfig.setLibrary("md", md);

  // Passthrough copy
  eleventyConfig.addPassthroughCopy({ "src/assets": "assets" });
  eleventyConfig.addPassthroughCopy({ "src/sw.js": "sw.js" });
  eleventyConfig.addPassthroughCopy({ "src/manifest.webmanifest": "manifest.webmanifest" });
  eleventyConfig.addPassthroughCopy({ "src/robots.txt": "robots.txt" });
  eleventyConfig.addPassthroughCopy({ "src/favicon.ico": "favicon.ico" });
  // IndexNow key file(s) — any *.txt in src root land at site root
  eleventyConfig.addPassthroughCopy({ "src/*.txt": "/" });
  eleventyConfig.addPassthroughCopy({ "node_modules/katex/dist": "assets/vendor/katex" });
  eleventyConfig.addPassthroughCopy({
    "node_modules/mermaid/dist/mermaid.esm.min.mjs": "assets/vendor/mermaid/mermaid.esm.min.mjs"
  });
  eleventyConfig.addPassthroughCopy({
    "node_modules/mermaid/dist/chunks": "assets/vendor/mermaid/chunks"
  });

  // Collections
  eleventyConfig.addCollection("contentPages", function (collectionApi) {
    return collectionApi
      .getAll()
      .filter((item) => /(^|\/)src\/content\//.test(item.inputPath))
      .sort((a, b) => a.url.localeCompare(b.url));
  });

  // Watch
  eleventyConfig.addWatchTarget("src/assets/");

  // Filters
  eleventyConfig.addFilter("absoluteUrl", function (url, base) {
    try {
      return new URL(url, base).toString();
    } catch {
      return url;
    }
  });

  eleventyConfig.addFilter("dateIso", function (d) {
    return new Date(d || Date.now()).toISOString();
  });

  eleventyConfig.addFilter("year", function () {
    return new Date().getFullYear();
  });

  eleventyConfig.addFilter("startsWith", function (str, prefix) {
    return typeof str === "string" && str.startsWith(prefix);
  });

  // Compute child + sibling pages for the "related" widget.
  eleventyConfig.addFilter("relatedPages", function (collection, currentUrl) {
    if (!collection || !currentUrl) return { children: [], siblings: [] };
    const parts = currentUrl.split("/").filter(Boolean);
    const parentUrl = parts.length > 1 ? "/" + parts.slice(0, -1).join("/") + "/" : "/";
    const children = [];
    const siblings = [];
    for (const item of collection) {
      if (item.url === currentUrl) continue;
      if (!item.url) continue;
      if (item.url.startsWith(currentUrl)) {
        const trailing = item.url.slice(currentUrl.length);
        // Direct child means one path segment plus trailing slash, e.g. "child/".
        if (trailing.split("/").filter(Boolean).length === 1) {
          children.push(item);
        }
      } else if (parentUrl !== "/" && item.url.startsWith(parentUrl)) {
        const trailing = item.url.slice(parentUrl.length);
        if (trailing.split("/").filter(Boolean).length === 1) {
          siblings.push(item);
        }
      }
    }
    children.sort((a, b) => a.url.localeCompare(b.url));
    siblings.sort((a, b) => a.url.localeCompare(b.url));
    return { children, siblings };
  });

  eleventyConfig.addFilter("findByUrl", function (collection, url) {
    if (!collection || !url) return null;
    return collection.find((it) => it.url === url) || null;
  });

  eleventyConfig.addFilter("breadcrumbs", function (url) {
    if (!url || url === "/") return [];
    const parts = url.split("/").filter(Boolean);
    const crumbs = [];
    let acc = "";
    for (const part of parts) {
      acc += "/" + part;
      crumbs.push({ url: acc + "/", slug: part });
    }
    return crumbs;
  });

  return {
    dir: {
      input: "src",
      includes: "_includes",
      data: "_data",
      output: "_site"
    },
    templateFormats: ["njk", "md", "html"],
    markdownTemplateEngine: "njk",
    htmlTemplateEngine: "njk",
    dataTemplateEngine: "njk"
  };
};
