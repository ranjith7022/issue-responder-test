# 🤖 Docs-Aware Issue Responder

A GitHub bot that automatically replies to new issues using **your repository's
documentation** and **previously resolved issues** — powered by
[GitHub Models](https://docs.github.com/en/github-models) (the same models that
power Copilot), with **zero API keys and zero npm dependencies**.

```
New issue opened ──▶ GitHub Actions triggers
                        │
                        ├─ 1. Reads the issue (title, body, labels)
                        ├─ 2. Collects docs (README.md, docs/**, *.md)
                        ├─ 3. Searches similar closed issues + their resolutions
                        ├─ 4. Asks GitHub Models to draft a grounded reply
                        └─ 5. Posts it as a comment on the issue
```

## Quick start

1. Copy this repository's contents into your target repo (or use it directly).
2. Push to GitHub. **That's it** — no secrets to configure. The workflow uses:
   - built-in `GITHUB_TOKEN` for posting comments,
   - the same token for AI inference via the `models: read` permission.
3. Open a test issue and watch the Actions tab.

> **Requirements:** a public repo works on the free GitHub Models tier.
> For private repos / heavy usage you may need a paid GitHub Models tier or a
> Copilot subscription, and org admins may need to enable GitHub Models in
> org policies.

## Files

| File | Purpose |
|---|---|
| `.github/workflows/issue-responder.yml` | Trigger: `issues.opened` (+ manual dispatch) |
| `src/index.js` | Orchestration: fetch → gather context → generate → post |
| `src/context.js` | Doc collection + resolved-issue search |
| `src/model.js` | Minimal GitHub Models chat client |

## Configuration

Set these in the workflow's `env:` block:

| Variable | Default | Description |
|---|---|---|
| `GITHUB_MODEL` | `openai/gpt-4o-mini` | Any model from [GitHub Marketplace models](https://github.com/marketplace/models) (e.g. `openai/gpt-4o`) |
| `DRY_RUN` | unset | Set `"true"` to print the reply in the job log without posting |

Tune behaviour in code:

- **Prompt** — edit the system rules in `src/index.js` (`buildMessages`).
- **Doc budget** — `MAX_TOTAL_DOC_CHARS`, `MAX_FILE_CHARS`, `MAX_DOC_FILES` in `src/context.js`.
- **Similar-issue matching** — keyword count and limits in `src/context.js`.

## Built-in safety rails

- Skips issues created by bots (prevents loops).
- Skips issues humans have already replied to.
- Never runs on pull requests.
- The prompt forbids inventing features/links and instructs honesty when unsure.
- Comments are clearly marked as automated.
- `concurrency` group prevents duplicate comments per issue.

## Testing locally

```bash
# needs Node 18+, and a PAT with "models: read" + repo access
export GITHUB_TOKEN=github_pat_xxx   # Windows PowerShell: $env:GITHUB_TOKEN="..."
export REPO=owner/name
export ISSUE_NUMBER=123
export DRY_RUN=true                  # print instead of posting

node src/index.js
```

## Ideas to extend

- Add an `ai-answer` label instead of replying to *every* new issue.
- React 👍 to its own comment so users can signal "this helped".
- Also trigger on `issue_comment` to answer follow-up questions in-thread.
- Pair with **Copilot coding agent**: assign the issue to Copilot and it will
  attempt an actual fix as a draft PR — this bot handles the support side.

## Notes & caveats

- Issue search indexing can lag a few minutes after an issue closes.
- Free-tier rate limits apply per model (~150 requests/day on some models).
- Issue bodies are untrusted input; the bot only posts text, never executes
  anything, but keep the docs folder free of secrets since it reads `*.md`.
