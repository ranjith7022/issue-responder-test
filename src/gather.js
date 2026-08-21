#!/usr/bin/env node
/**
 * Step 1 of the bot — gather context and write prompt files for
 * actions/ai-inference (which invokes the Copilot CLI in step 2).
 *
 * Writes (to PROMPT_DIR, default "./_bot"):
 *   system.txt — behaviour rules for the assistant
 *   prompt.txt — the new issue + doc excerpts + similar resolved issues
 *
 * Sets a "skip=true" step output when there is nothing to answer
 * (pull requests, bot authors, issues humans already replied to).
 *
 * Required env: GITHUB_TOKEN, REPO ("<owner>/<name>"), ISSUE_NUMBER.
 */

const fs = require("fs/promises");
const path = require("path");
const { ghHeaders, collectDocs, findSimilarIssues } = require("./context");

const API_ROOT = "https://api.github.com";
const OUT_DIR = process.env.PROMPT_DIR || "_bot";

/* ------------------------------------------------------------------ */

const SYSTEM_RULES = [
  `You are the support assistant bot for a GitHub repository.`,
  `When someone files a new issue you draft the first reply for the maintainers.`,
  ``,
  `Rules:`,
  `- Base your answer ONLY on the documentation and previously resolved issues provided below.`,
  `  Never invent features, commands, APIs, or links.`,
  `- When a past resolved issue answers this one, reference it as #<number>, briefly summarise`,
  `  the fix, and link to it.`,
  `- Cite specific documentation files/sections when relevant.`,
  `- Be concise and friendly. Use GitHub-flavored Markdown: short paragraphs, bullet lists,`,
  `  fenced code blocks where useful.`,
  `- If the information is missing or unclear, say so honestly and ask targeted follow-up`,
  `  questions (versions, error logs, reproduction steps).`,
  `- Never promise timelines or speak on behalf of maintainers.`,
  `Output only the comment body.`,
].join("\n");

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

async function getIssue(token, repo, number) {
  const res = await fetch(`${API_ROOT}/repos/${repo}/issues/${number}`, {
    headers: ghHeaders(token),
  });
  if (!res.ok) throw new Error(`Failed to fetch issue #${number} (${res.status}).`);
  return res.json();
}

async function main() {
  const repo = process.env.REPO;
  const issueNumber = Number(process.env.ISSUE_NUMBER);
  const token = process.env.GITHUB_TOKEN;
  if (!repo || !issueNumber || !token) {
    throw new Error("REPO, ISSUE_NUMBER and GITHUB_TOKEN are required.");
  }

  console.log(`Fetching ${repo}#${issueNumber}…`);
  const issue = await getIssue(token, repo, issueNumber);

  // Safety guards -----------------------------------------------------
  const skip =
    Boolean(issue.pull_request) ||
    issue.user?.type === "Bot" ||
    (issue.comments ?? 0) > 0;

  if (process.env.GITHUB_OUTPUT) {
    const value = skip ? "skip=true\n" : "skip=false\n";
    await fs.appendFile(process.env.GITHUB_OUTPUT, value);
  }
  if (skip) {
    console.log(
      issue.pull_request
        ? "This is actually a pull request — nothing to do."
        : "Humans/bots already replied — staying quiet."
    );
    return;
  }

  // Gather context ----------------------------------------------------
  console.log("Collecting documentation…");
  const docs = await collectDocs(process.cwd());

  console.log("Searching previously resolved issues…");
  const similar = await findSimilarIssues({ token, repo, issue });
  console.log(`Found ${similar.length} similar resolved issue(s).`);

  const prompt = [
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

  // Write prompt files for actions/ai-inference ------------------------
  await fs.mkdir(OUT_DIR, { recursive: true });
  await fs.writeFile(path.join(OUT_DIR, "system.txt"), SYSTEM_RULES);
  await fs.writeFile(path.join(OUT_DIR, "prompt.txt"), prompt);
  console.log(`✅ Prompt files written to ${OUT_DIR}/`);
}

main().catch((err) => {
  console.error("❌ Gather failed:", err.message);
  process.exit(1);
});
