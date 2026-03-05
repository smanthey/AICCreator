# Inayan Builder — Video-derived spec

Generated from YouTube transcript+visual index. Use as the spec/starting point for what Inayan builder should do.

- **Source index:** `youtube-transcript-visual-index-latest.json`
- **Generated:** 2026-03-05T04:03:09.497Z
- **Videos indexed:** 12
- **With transcript:** 0

## Goal

Build and ship **InayanBuilderBot** as a product that:
- Researches Reddit and GitHub for a repo's domain (builder automation, dashboards, auth, payments, etc.).
- Finds similar repos to index, benchmark, and compare.
- Benchmarks the indexed repo (and similar ones) using claw-architect tools (repo-completion-gap, capability-factory, feature-benchmark).
- Compares the app to best-case exemplars and fills gaps (docs, code, or tasks).
- Exposes APIs for Mission Control / builder-gap-pulse: Reddit search, GitHub research, research fusion (magic-run).
- Is continuously improved from real use (builder pulse, repo_autofix, opencode_controller).

## Source video IDs

| Video ID | URL | Title | Has transcript |
|----------|-----|-------|----------------|


| 2UxulrochNI | https://youtu.be/2UxulrochNI | (no title) | no |

| ivty6t0lUkQ | https://youtu.be/ivty6t0lUkQ | (no title) | no |

| 4ZI_fL4cw_c | https://youtu.be/4ZI_fL4cw_c | (no title) | no |

| 1q__Vs2JqbI | https://youtu.be/1q__Vs2JqbI | (no title) | no |

| LFO4cP0KMwk | https://youtu.be/LFO4cP0KMwk | (no title) | no |

| DqY797MuQio | https://youtu.be/DqY797MuQio | (no title) | no |

| rp6_d6sNYXY | https://youtu.be/rp6_d6sNYXY | (no title) | no |

| QR4Tt6j8aNU | https://youtu.be/QR4Tt6j8aNU | (no title) | no |

| 0rMMWOWVBo0 | https://youtu.be/0rMMWOWVBo0 | (no title) | no |

| R9c_JQrEtu8 | https://youtu.be/R9c_JQrEtu8 | (no title) | no |

| Jsx-rImkdQk | https://youtu.be/Jsx-rImkdQk | (no title) | no |

| MH1xW_7YRHw | https://youtu.be/MH1xW_7YRHw | (no title) | no |

## Combined transcript

No transcript text in the index (e.g. dry-run or captions unavailable). Re-run `npm run youtube:index:auto` with yt-dlp installed and sufficient disk, or run with `--keyshots 0` to get metadata+subs only. Then re-run this script to regenerate the brief with transcript content.


## Steps (from plan)

1. **Index** — jCodeMunch index_folder for claw-architect and InayanBuilderBot (and similar repos).
2. **Research** — Reddit search + builder research agenda (from rolling gap report).
3. **Benchmark** — repo-completion-gap, capability-factory, feature-benchmark vs exemplars.
4. **Update** — Apply improvements, remove placeholders, fix gaps; queue repo_autofix / opencode_controller as needed.
5. **Integrate** — Document endpoints, env, runbook; Mission Control / builder-gap-pulse can call InayanBuilderBot APIs.

## Features to implement

- **Reddit search API** — Query-driven Reddit research (subreddits, ranking).
- **GitHub research API** — Repo discovery, releases, signals.
- **Research fusion** — Combine Reddit + GitHub into a single research output (magic-run).
- **Runbook and env** — README, RUNBOOK.md, .env.example; clone-and-run friendly.
- **Quality bar** — Align with sections_to_complete where applicable (observability, security_sweep, e2e if relevant).
