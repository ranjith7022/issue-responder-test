/**
 * Context gathering for the issue responder:
 *  - collectDocs():      reads README + markdown docs from the checked-out repo
 *  - findSimilarIssues(): searches closed issues that look like the new one
 *
 * No dependencies — uses the global fetch (Node 18+) and fs/promises.
 */

const fs = require("fs/promises");
const path = require("path");

const API_ROOT = "https://api.github.com";

/* Limits to keep prompts (and rate limits) under control */
const MAX_TOTAL_DOC_CHARS = 40_000;
const MAX_FILE_CHARS = 8_000;
const MAX_DOC_FILES = 25;
const MAX_SIMILAR_ISSUES = 5;
const MAX_COMMENTS_PER_ISSUE = 3;
const KEYWORD_ATTEMPTS = [6, 3, 1]; // progressively narrower searches

/* ------------------------------------------------------------------ */
/* Shared helpers                                                      */
/* ------------------------------------------------------------------ */

function ghHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "docs-aware-issue-responder",
  };
}

function truncate(text, maxChars) {
  const clean = String(text ?? "");
  return clean.length <= maxChars ? clean : clean.slice(0, maxChars) + "\n…[truncated]";
}

/* ------------------------------------------------------------------ */
/* Documentation                                                       */
/* ------------------------------------------------------------------ */

const DOC_EXTENSIONS = new Set([".md", ".mdx", ".txt"]);
const SKIPPED_DIRS = new Set([
  ".git", ".github", "node_modules", "dist", "build", "out", "vendor", "coverage",
]);

/** Priority: README first, then docs/ folders, then other doc-ish files. */
function docPriority(relPath) {
  if (relPath.toLowerCase() === "readme.md") return 0;
  if (/^docs?\//i.test(relPath)) return 1;
  if (/doc|guide|tutorial/i.test(relPath)) return 2;
  return 3;
}

async function walkMarkdown(dir, base, files) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return files; // unreadable dir — skip
  }
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRS.has(entry.name)) await walkMarkdown(fullPath, base, files);
    } else if (DOC_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      files.push(path.relative(base, fullPath).split(path.sep).join("/"));
    }
  }
  return files;
}

/**
 * Collects an excerpt of the repository documentation.
 * @param {string} repoRoot checked-out repository root
 * @returns {Promise<string>} concatenated markdown sections
 */
async function collectDocs(repoRoot) {
  const allFiles = await walkMarkdown(repoRoot, repoRoot, []);
  allFiles.sort((a, b) => docPriority(a) - docPriority(b) || a.localeCompare(b));

  const sections = [];
  let used = 0;

  for (const relPath of allFiles.slice(0, MAX_DOC_FILES)) {
    const budgetLeft = MAX_TOTAL_DOC_CHARS - used;
    if (budgetLeft <= 200) break;

    const raw = await fs
      .readFile(path.join(repoRoot, relPath), "utf8")
      .catch(() => "");
    if (!raw.trim()) continue;

    const excerpt = truncate(raw, Math.min(MAX_FILE_CHARS, budgetLeft));
    used += excerpt.length;
    sections.push(`### File: ${relPath}\n${excerpt}`);
  }

  console.log(`  → collected ${sections.length} doc file(s), ~${used} chars`);
  return sections.join("\n\n") || "(no documentation found)";
}

/* ------------------------------------------------------------------ */
/* Previously resolved issues                                          */
/* ------------------------------------------------------------------ */

const STOPWORDS = new Set([
  "the","and","for","with","this","that","not","are","was","but","has","have",
  "how","what","when","why","who","can","does","did","from","your","you","our",
  "their","its","all","any","out","use","using","after","before","while","into",
  "then","than","them","there","here","which","will","would","should","could",
  "may","might","must","been","being","were","also","just","very","some","such",
  "only","own","same","too","each","other","more","most","get","got","make",
  "made","try","tried","need","want","help","please","new","issue","error",
]);

/** Pull a few significant keywords out of the title/body. */
function extractKeywords(text, maxWords) {
  const seen = new Set();
  const words = String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s.-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
  for (const w of words) seen.add(w);
  return [...seen].slice(0, maxWords);
}

async function searchClosedIssues(token, repo, query) {
  const params = new URLSearchParams({
    q: `repo:${repo} is:issue is:closed ${query}`,
    per_page: String(MAX_SIMILAR_ISSUES),
  });
  const res = await fetch(`${API_ROOT}/search/issues?${params}`, {
    headers: ghHeaders(token),
  });
  if (!res.ok) throw new Error(`Issue search failed (${res.status}).`);
  const data = await res.json();
  return data.items ?? [];
}

async function fetchLastComments(token, repo, issueNumber) {
  const res = await fetch(
    `${API_ROOT}/repos/${repo}/issues/${issueNumber}/comments?per_page=100`,
    { headers: ghHeaders(token) }
  );
  if (!res.ok) return [];
  const all = await res.json();
  return all.slice(-MAX_COMMENTS_PER_ISSUE).map((c) => ({
    user: c.user?.login ?? "unknown",
    body: truncate(c.body, 1200),
  }));
}

/**
 * Finds closed issues similar to the given one.
 * Tries progressively shorter keyword lists so we still get results when
 * many keywords don't co-occur in past issues.
 */
async function findSimilarIssues({ token, repo, issue }) {
  const keywords = extractKeywords(`${issue.title} ${issue.body}`, 10);

  for (const count of KEYWORD_ATTEMPTS) {
    const words = keywords.slice(0, count);
    if (words.length === 0) break;

    const items = await searchClosedIssues(token, repo, words.join(" "));
    if (items.length === 0) continue;

    const detailed = [];
    for (const item of items) {
      detailed.push({
        number: item.number,
        title: item.title,
        url: item.html_url,
        stateReason: item.state_reason,
        body: truncate(item.body, 1500),
        comments: await fetchLastComments(token, repo, item.number),
      });
    }
    console.log(`  → matched with keywords: "${words.join(" ")}"`);
    return detailed;
  }

  return [];
}

module.exports = { ghHeaders, collectDocs, findSimilarIssues };
