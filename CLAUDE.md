# CLAUDE.md

Engineer notes for agents working in `omp-refine`.

## What this is

A plugin of general refinements for **OMP / pi** (Oh My Pi). It ships three
behaviors:

- **Backslash-Enter continuation** — `\` + `Enter` inserts a newline instead of
  submitting. Mid-draft, it splices the newline at the end of the sole
  `\`-ended line only when **exactly one** candidate line matches; zero or 2+
  candidates submit literally (never guess). A trailing space after the `\`
  vetoes the continuation (decided from a **pre-submit draft snapshot**, because
  both hosts trim the draft and clear the editor before the `input` event fires).
- **Trailing-space veto** — any whitespace after the trailing `\` submits
  literally.
- **Double-Escape clear + busy-gated interrupt guard** — while the agent is
  running, a lone `Esc` is swallowed (never interrupts a non-empty draft);
  double-`Esc` clears the draft. The guard is gated on
  `agent_start` / `agent_end` / `agent_settled`, so idle `Esc` keeps full host
  behavior (autocomplete/overlay dismiss, host rewind on an empty box).

Fail-open by design: with no live editor to restore into, the submit goes
through literally — the extension never eats a message.

## Key files

| File | Role |
|---|---|
| `src/continuation.ts` | Pure continuation logic (no host deps) — the candidate-line + veto rules. |
| `src/extension.ts` | Host wiring: hooks the input/submit and Escape paths into pi. |
| `src/double-escape.ts` | Double-Escape state machine + busy gate. |
| `src/index.ts` | Public surface / module exports. |
| `test/refine.mjs` | Acceptance tests for continuation (pure logic + fake-pi handler). |
| `test/double-escape.mjs` | Acceptance tests for the double-Escape guard. |
| `dist/` | **Committed** build output — installs load without a build step. |

## Commands

```sh
npm test        # build + node --test both test files
npm run coverage  # same suite with node --experimental-test-coverage — must hold >=80% everywhere
npm run build   # tsc -p tsconfig.json — run after any src/ change, then commit dist/
```

`npm test` = build then `node --test test/refine.mjs test/double-escape.mjs`.
Coverage must stay **>= 80%** on lines, branches, and functions everywhere.

## STANDING POLICIES

These are non-negotiable for every completed unit of work in this repo.

**(a) Always push completed work to git.**
Commit and push without asking. Never leave finished work uncommitted.

**(b) Every push bumps the version.**
A push that changes behavior MUST bump the version in all of:

- `package.json`
- `.omp-plugin/marketplace.json` — both the root `metadata.version` **and**
  `plugins[0].version`
- `README.md` install / upgrade / lock / list examples

`package-lock.json` is gitignored, but update it locally anyway so local
installs stay consistent. The bump commit MUST carry a behavior note — never an
empty bump commit.

**(c) After pushing, reinstall the live plugin and verify.**

```sh
omp plugin install github:nikkoxgonzales/omp-refine
```

Then verify the marker grep, and tell the user to restart omp.
