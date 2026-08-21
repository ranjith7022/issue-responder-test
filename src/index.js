#!/usr/bin/env node
/**
 * Docs-aware issue responder.
 *
 * Flow: fetch the new issue → gather repo docs + similar resolved issues →
 * ask GitHub Models for a helpful reply → post it as a comment.
 *
 * Required env vars: GITHUB_TOKEN, REPO ("<owner>/<name>"), ISSUE_NUMBER.
 * Optional env vars: GITHUB_MODEL (default openai/gpt-4o-mini), DRY_RUN=true.
 */

const { ghHeaders, collectDocs, findSimilarIssues } = require("./context");
const { chat } = require("./model");

const API_ROOT = "https://api.github.com";

/* ------------------------------------------------------------------ */
/* GitHub REST helpers                                                 */
/* ------------------------------------------------------------------ */

async function getIssue(token, repo, number) {
  const res = await fetch(`${API_ROOT}/repos/${repo}/issues/${number}`, {
    headers: ghHeaders(token),
  });
  if (!res.ok) throw new Error(`Failed to fetch issue #${number} (${res.status}).`);
  return res.json();
}

async function postComment(token, repo, number, body) {
  const res = await fetch(`${API_ROOT}/repos/${repo}/issues/${number}/comments`, {
    method: "POST",
    headers: { ...ghHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify({ body }),
  });
  if (!res.ok) throw new Error(`Failed to post comment (${res.status}): ${(await res.text()).slice(0, 400)}`);
}

/* ------------------------------------------------------------------ */
/* Prompt construction                                                 */
/* ------------------------------------------------------------------ */

function formatSimilarIssues(similar) {
  if (similar.length === 0) return "None found.";
  return similar
    .map((item) => {
      const comments = item.comments
        .map((c) => `- @${c.user}: ${c.body}`)
        .join("\n");
      return [
        `### Issue #${item.number} — "${item.title}" (${item.stateReason || "closed"})`,
        `Link: ${item.url}`,
        `Body: ${item.body || "(empty)"}`,
        comments ? `Resolution discussion:\n${comments}` : "",
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");
}

function buildMessages(repo, issue, docs, similar) {
  const system = [
    `You are the support assistant bot for the GitHub repository "${repo}".`,
    `When someone files a new issue, you draft the first reply for the maintainers.`,
    ``,
    `Rules:`,
    `- Base your answer ONLY on the documentation and previously resolved issues provided below.`,
    `  Never invent features, commands, APIs, or links.`,
    `- When a past resolved issue answers this one, reference it as #<number>, briefly summarise the fix,`,
    `  and link to it.`,
    `- Cite specific documentation files/sections when relevant.`,
    `- Be concise and friendly. Use GitHub-flavored Markdown: short paragraphs, bullet lists, fenced code blocks.`,
    `- If the information is missing or unclear, say so honestly and ask targeted follow-up questions`,
    `  (versions, error logs, reproduction steps).`,
    `- Never promise timelines or speak on behalf of maintainers.`,
    `Output only the comment body.`,
  ].join("\n");

  const user = [
    `## New issue #${issue.number}`,
    `Title: ${issue.title}`,
    `Author: @${issue.user?.login}`,
    `Labels: ${(issue.labels ?? []).map((l) => l.name).join(", ") || "none"}`,
    `Body:`,
    issue.body?.slice(0, 6000) || "(empty)",
    ``,
    `## Repository documentation (excerpts)`,
    docs,
    ``,
    `## Previously resolved issues that look related`,
    formatSimilarIssues(similar),
  ].join("\n");

  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

/* ------------------------------------------------------------------ */
/* Main                                                                */
/* ------------------------------------------------------------------ */

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

async function main() {
  const repo = requiredEnv("REPO");
  const issueNumber = Number(requiredEnv("ISSUE_NUMBER"));
  const token = requiredEnv("GITHUB_TOKEN");
  const dryRun = process.env.DRY_RUN === "true";

  console.log(`Fetching ${repo}#${issueNumber}…`);
  const issue = await getIssue(token, repo, issueNumber);

  // Safety guards -----------------------------------------------------
  if (issue.pull_request) {
    console.log("This is actually a pull request — nothing to do.");
    return;
  }
  if ((issue.comments ?? 0) > 0) {
    console.log("Humans have already replied — staying quiet.");
    return;
  }

  // Gather context ----------------------------------------------------
  console.log("Collecting documentation…");
  const docs = await collectDocs(process.cwd());

  console.log("Searching previously resolved issues…");
  const similar = await findSimilarIssues({ token, repo, issue });
  console.log(`Found ${similar.length} similar resolved issue(s).`);

  // Generate + post ---------------------------------------------------
  console.log("Drafting reply via GitHub Models…");
  const reply = await chat(buildMessages(repo, issue, docs, similar));

  const body =
    `${reply}\n\n` +
    `---\n` +
    `> 🤖 _Automated reply generated from the repo docs and past resolved issues._ ` +
    `_If this solved your problem, feel free to close the issue — otherwise a maintainer will follow up._`;

  if (dryRun) {
    console.log("\n=== DRY RUN — comment NOT posted ===\n");
    console.log(body);
    return;
  }

  await postComment(token, repo, issueNumber, body);
  console.log(`✅ Reply posted on issue #${issueNumber}`);
}

main().catch((err) => {
  console.error("❌ Bot failed:", err.message);
  process.exit(1);
});
