# omp-refine

**General refinements for [Oh My Pi](https://github.com/can1357/oh-my-pi) and pi** — currently: Claude-style hotkeys (`\` + `Enter` for newline, double-`Escape` to clear the draft, `Escape` interrupt guard).

```text
hello \<Enter>   keeps editing:  "hello⏎|"   (backslash consumed, no submit)
hello <Enter>    submits "hello"
hello \\<Enter>  submits "hello\\"            (escape hatch: double it)
<Esc> streaming  swallowed — never interrupts while the draft is non-empty
<Esc> idle       passes through — draft safe (host no-op), menus still dismiss
double-<Esc>     clears the draft (no interrupt; empty box keeps host rewind)
triple-<Esc>     clears, then interrupts (third lands on the empty box)
```

**Why an extension, not a keybinding:** `\` is an ordinary character and `Enter` is plain `Enter`, so this works on *every* terminal. Modified-Enter chords (`Shift+Enter`, `Ctrl+Enter`) need terminal CSI support that Windows Terminal and multiplexers routinely swallow — the exact failure mode this replaces. Complements the built-in `tui.input.newLine` (`Shift+Enter` / `Ctrl+J`); those never reach submit, so nothing conflicts.

## Install

Requirements: Node.js 22+, and omp (`@oh-my-pi/pi-coding-agent`) 18.1.x or pi.

**Marketplace (recommended — enables updates via `omp plugin upgrade omp-refine@omp-refine`):**

```sh
omp plugin marketplace add nikkoxgonzales/omp-refine
omp plugin install omp-refine@omp-refine
```

**Direct from GitHub:**

```sh
omp plugin install github:nikkoxgonzales/omp-refine
```

Then restart omp. Verify: type `test\`, press `Enter` — the message must NOT send; you stay in the editor on a new line.

<details>
<summary>Manual install (if the CLI errors on your machine)</summary>

`omp plugin install <local-path>` fails with `EPERM` on Windows without admin rights or Developer Mode — the CLI calls `fs.symlink` without a junction type, while its own marketplace path correctly uses junctions. Until that's fixed upstream, reproduce what a correct install would do:

1. `npm run build` in a clone of this repo.
2. Create a junction (the same mechanism the CLI's marketplace path uses):

   ```sh
   cmd /c mklink /J "%USERPROFILE%\.omp\plugins\node_modules\omp-refine" "C:\path\to\omp-refine"
   ```

3. Add the plugin to `%USERPROFILE%\.omp\plugins\omp-plugins.lock.json`:

   ```json
   { "plugins": { "omp-refine": { "version": "0.4.1", "enabledFeatures": null, "enabled": true } }, "settings": {} }
   ```

4. `omp plugin list` should show `omp-refine@0.4.1`. Restart omp.

</details>

## Behavior

| You type + `Enter` | Result |
|---|---|
| `text\` (cursor at end) | newline, keeps editing (`text⏎`) — the `\` is consumed |
| `\` + `Enter` with cursor mid-draft (exactly one `\`-ended line) | newline spliced at the end of THAT line, keeps editing — head + tail preserved; when the host reports a cursor offset that governs instead (pi's editor already handles `\`+`Enter` at the cursor natively). Cursor: the splice offset (just after the created newline) is passed to `setEditorText`, but neither host honors it today — both park the cursor at the end of the draft; exact once a host adopts the arg |
| `\` + `Enter` with zero or 2+ `\`-ended lines | submits literally — never guesses (`C:\new\file` multiline pastes survive); a trailing space after the `\` also vetoes |
| `text\` + trailing space | submits literally — any whitespace after the `\` vetoes; decided on a pre-submit draft snapshot, because both hosts trim the draft and clear the editor before the `input` event fires |
| `text` | submits `text` |
| `text\\` | submits `text\\` (even count = literal backslashes) |
| `text\` + image attached | submits as-is (attachments never swallowed) |
| headless / RPC submits | untouched — interactive only |

| `Esc` while the agent runs (draft non-empty) | swallowed — never interrupts (lone `Esc` is a no-op) |
| `Esc` `Esc` while the agent runs | clears the draft (both limbs consumed, no interrupt) |
| `Esc` `Esc` `Esc` while the agent runs | clears, then the third passes on the empty box (interrupts) |
| `Esc` while idle (draft non-empty) | passes through — host no-op, so autocomplete/overlay dismiss keeps working |
| `Esc` `Esc` while idle | clears the draft (first limb was a harmless host no-op) |
| `Esc` `Esc` on an empty box | untouched — host rewind/tree selector as configured |

The guard is busy-gated: the extension tracks `agent_start` / `agent_end` / `agent_settled`, so idle `Esc` keeps full host behavior. A whitespace-only draft counts as empty (mirroring the host), keeping the rewind gesture.

Fail-open by design: if there is no live editor to restore into, the submit goes through literally. This extension never eats a message.

```sh
npm install
npm test        # build + acceptance tests (pure logic + fake-pi handler)
npm run coverage  # same suite with line/branch/function coverage (holds ≥80%)
```

`dist/` is committed so installs load without a build step; run `npm run build` after changing `src/` and commit both.

## License

[MIT](LICENSE)
