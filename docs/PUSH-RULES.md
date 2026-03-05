# Push Rules (Public Repo)

These rules are mandatory before every push.

## 1) Single public version

- Push only to `main` for public release.
- Do not keep long-lived alternate release branches.

## 2) Privacy and public-info scrub

Run:

```bash
npm run public:safety:check
```

Push is blocked if personal/local identifiers are found in tracked files.

## 3) InayanBuilderBot coordination rule

When changes touch any InayanBuilderBot-related logic or docs:
- Update the corresponding integration documentation in this repo.
- Ensure `content-creator:pipeline` and AICC scripts still run.
- Push both the fix and the documentation update in the same `main` push.

## 4) Required pre-push checklist

- `npm run public:safety:check`
- `git status` is clean except intentional changes
- `git branch --show-current` is `main`
- `git push origin main`
