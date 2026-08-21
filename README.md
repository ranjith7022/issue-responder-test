# 🤖 Docs-Aware Issue Responder

A GitHub bot that automatically replies to new issues using **your repository's
documentation** and **previously resolved issues** — drafted by **GitHub
Copilot models** via the official [`actions/ai-inference`](https://github.com/actions/ai-inference)
action (Copilot CLI provider).

> ℹ️ This repo originally used GitHub Models, which GitHub retired on July 30,
> 2026. The official replacement for AI in Actions is the Copilot-backed
> `actions/ai-inference` action.

```
New issue opened ──▶ GitHub Actions triggers
                        │
                        ├─ 1. src/gather.js: reads the issue, collects docs
                        │     (README.md, docs/**), searches similar closed issues
                        ├─ 2. actions/ai-inference: Copilot drafts a grounded reply
                        └─ 3. gh issue comment: posts it on the issue
```

## Quick start

1. Copy these files into your target repo.
2. Create one secret:
   - Go to **Settings → Secrets and variables → Actions → New repository secret**
   - Name: `COPILOT_GITHUB_TOKEN`
   - Value: a classic personal access token created at
     <https://github.com/settings/tokens>, tied to an account with **any
     Copilot plan enabled** (Free tier works).
3. Push and open a test issue — no other configuration needed.

## Files

| File | Purpose |
|---|---|
| `.github/workflows/issue-responder.yml` | Trigger: `issues.opened` (+ manual dispatch) |
| `src/gather.js` | Step 1: fetch issue → collect docs + resolved issues → write prompt files |
| `src/context.js` | Doc collection + resolved-issue search helpers |

## Configuration

Edit in the workflow:

| What | Where | Default |
|---|---|---|
| Model | `Draft reply with Copilot` step | `gpt-4.1` (try `claude-sonnet-4.5`) |
| Dry run (log only, don't post) | set env `DRY_RUN: "true"` on `Post reply`'s job | unset |
| Prompt rules | `SYSTEM_RULES` in `src/gather.js` | grounded-answer rules |
| Doc budget / limits | constants in `src/context.js` | 40k chars, 25 files, top-5 matches |

## Built-in safety rails

- Skips issues created by bots (prevents loops).
- Skips issues humans have already replied to (`skip=true` step output gates all later steps).
- Never runs on pull requests.
- The prompt forbids inventing features/links; instructs honesty when unsure.
- Comments are clearly marked as automated; concurrency group prevents duplicates.

## Testing locally

```bash
export GITHUB_TOKEN=github_pat_xxx   # Windows PowerShell: $env:GITHUB_TOKEN="..."
export REPO=owner/name
export ISSUE_NUMBER=123

node src/gather.js                   # writes _bot/system.txt + _bot/prompt.txt
cat _bot/prompt.txt                  # inspect what Copilot will receive
```

## Ideas to extend

- Add an `ai-answer` label instead of replying to *every* new issue.
- React 👍 to its own comment so users can signal "this helped".
- Also trigger on `issue_comment` to answer follow-ups in-thread.
- Pair with **Copilot coding agent**: assign the issue to Copilot for an actual fix PR.

## Notes & caveats

- Issue search indexing can lag a few minutes after an issue closes.
- Copilot usage consumes your plan's premium requests / AI credits.
- Issue bodies are untrusted input; the bot only posts text, never executes
  anything, but keep secrets out of `*.md` files since they're read as docs.
