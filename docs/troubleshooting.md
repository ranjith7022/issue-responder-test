# Troubleshooting Guide

## Port 3000 is already in use

The dev server binds to port `3000` by default. If another process is
using it, start the server on a different port:

```bash
PORT=4000 node src/index.js
```

## Authentication failures (401 / Bad credentials)

All commands authenticate through the GitHub token in your environment.
Make sure `GITHUB_TOKEN` is exported and has at least the `repo` scope.
Tokens expire — generate a fresh one at
https://github.com/settings/tokens if you see `Bad credentials`.

## Rate limit errors (403 / rate limit exceeded)

GitHub API and GitHub Models requests are rate limited. Wait for the
window to reset or reduce request frequency. Check your remaining quota:

```bash
curl -s https://api.github.com/rate_limit -H "Authorization: Bearer $GITHUB_TOKEN"
```
