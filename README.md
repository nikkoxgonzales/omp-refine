# omp-hotkeys

**Claude-style hotkeys for [Oh My Pi](https://github.com/can1357/oh-my-pi) and pi** — v1 does one thing: `\` + `Enter` inserts a newline instead of submitting.

```text
hello \<Enter>   keeps editing:  "hello⏎|"   (backslash consumed, no submit)
hello <Enter>    submits "hello"
hello \\<Enter>  submits "hello\\"            (escape hatch: double it)
```

**Why an extension, not a keybinding:** `\` is an ordinary character and `Enter` is plain `Enter`, so this works on *every* terminal. Modified-Enter chords (`Shift+Enter`, `Ctrl+Enter`) need terminal CSI support that Windows Terminal and multiplexers routinely swallow — the exact failure mode this replaces. Complements the built-in `tui.input.newLine` (`Shift+Enter` / `Ctrl+J`); those never reach submit, so nothing conflicts.

## Install

Requirements: Node.js 22+, and omp (`@oh-my-pi/pi-coding-agent`) 18.1.x or pi.

**Marketplace (recommended — enables updates via `omp plugin upgrade omp-hotkeys@omp-hotkeys`):**

```sh
omp plugin marketplace add nikkoxgonzales/omp-hotkeys
omp plugin install omp-hotkeys@omp-hotkeys
```

**Direct from GitHub:**

```sh
omp plugin install github:nikkoxgonzales/omp-hotkeys
```

**From npm** — once published; `omp-hotkeys` is not on npm yet, but the package is npm-ready (`npm publish` after `npm login`):

```sh
omp plugin install omp-hotkeys
```

Then restart omp. Verify: type `test\`, press `Enter` — the message must NOT send; you stay in the editor on a new line.

<details>
<summary>Manual install (if the CLI errors on your machine)</summary>

`omp plugin install <local-path>` fails with `EPERM` on Windows without admin rights or Developer Mode — the CLI calls `fs.symlink` without a junction type, while its own marketplace path correctly uses junctions. Until that's fixed upstream, reproduce what a correct install would do:

1. `npm run build` in a clone of this repo.
2. Create a junction (the same mechanism the CLI's marketplace path uses):

   ```sh
   cmd /c mklink /J "%USERPROFILE%\.omp\plugins\node_modules\omp-hotkeys" "C:\path\to\omp-hotkeys"
   ```

3. Add the plugin to `%USERPROFILE%\.omp\plugins\omp-plugins.lock.json`:

   ```json
   { "plugins": { "omp-hotkeys": { "version": "0.1.0", "enabledFeatures": null, "enabled": true } }, "settings": {} }
   ```

4. `omp plugin list` should show `omp-hotkeys@0.1.0`. Restart omp.

</details>

## Behavior

| You type + `Enter` | Result |
|---|---|
| `text\` | newline, keeps editing (`text⏎`) — the `\` is consumed |
| `text` | submits `text` |
| `text\\` | submits `text\\` (even count = literal backslashes) |
| `text\` + image attached | submits as-is (attachments never swallowed) |
| headless / RPC submits | untouched — interactive only |

Fail-open by design: if there is no live editor to restore into, the submit goes through literally. This extension never eats a message.

## Development

```sh
npm install
npm test        # build + acceptance tests (pure logic + fake-pi handler)
```

`dist/` is committed so installs load without a build step; run `npm run build` after changing `src/` and commit both.

## License

[MIT](LICENSE)
