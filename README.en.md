# Overclock Mode (dsh-overclock-preset) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

GitHub: https://github.com/kamioyuri/dsh-overclock-preset

中文：[README.md](README.md)

An agent preset plugin for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`) that **stops the model from trimming output for token economy** and **orchestrates multiple sub-agents by default**.

Enable the plugin and the preset picker gains an「超频模式 / Overclock Mode」entry; disable it and the entry disappears — existing presets and the deployment default are untouched. Zero dependencies, no build step, no tools registered: it only declares one preset through the host registry.

## Capabilities

The preset ships no code of its own. It changes *how a session is composed*: persona, compaction policy, tool-result pruning and delegation limits.

| Problem | What the preset does |
| --- | --- |
| Answers written short, "rest omitted" | Persona declares an unbounded token budget and lists the omission patterns that are forbidden |
| Long tasks end early | Long content continues from the breakpoint until complete; `ralph` rounds raised from 64 to 96 |
| No multi-agent by default | Decomposes into 2–5 parallel sub-tasks; the lead agent merges, dedupes and cross-checks |
| Tool descriptions say "use sparingly" | Persona explicitly outranks tool-level "only when the user asks for it" guidance |
| Compaction fires early, tool output gets pruned | Compaction threshold pushed back (0.8 → 0.9), verbatim retention raised (0.16 → 0.3), prune threshold 6× wider |

## Differences from the built-in `standard` preset

Everything else stays identical (27 rows: 24 plugin rows + 3 isolation groups).

| Dimension | standard | Overclock |
| --- | --- | --- |
| Persona | deployment default | unbounded budget, no self-truncation, multi-agent by default |
| Compaction threshold | `thresholdRatio 0.8` / `retainRatio 0.16` | `0.9` / `0.3` |
| Compaction headroom | `headroomTokens 65536` | `8192` (see below) |
| Tool-result pruning | 8,192 chars (head 4,096 / tail 1,024) | 49,152 chars (head 36,864 / tail 8,192) |
| Delegation depth | 1 | 2 |
| `workflow` result cap | 50,000 chars | 200,000 chars |
| `ralph` rounds | 64 | 96 |

**Why lower `headroomTokens`** — it is not a "save tokens" knob, it prevents the compaction policy from failing outright. The threshold is `floor(min(W × ratio, W − O − headroom))`. With the default 65,536, small-context models (32K / 49K) compute a **negative pressure budget**, the plugin throws `TargetPressureConfigError`, and compaction becomes unavailable. At 8,192 small models work, and large models compact *later* than default (131K window: 57,344 tokens in `standard` vs 114,688 here).

## Install into a profile

```bash
git clone https://github.com/kamioyuri/dsh-overclock-preset.git

# install into the profile you actually use (desktop / web / custom)
dsh plugin --profile desktop add file:<absolute-path-to-the-clone>
```

Restart dsh afterwards — the host reads bundles and preset declarations at startup only. Then create a session, open the preset picker, and pick「超频模式」.

> A `file:` dependency is **copied** into the profile. After editing the source, either re-run `add` or copy `lib/` over `~/.dsh/profiles/<profile>/node_modules/dsh-overclock-preset/`.

## Verify

```powershell
# 1) the bundle list contains the package
Select-String -Path "$env:USERPROFILE\.dsh\profiles\desktop\package.json" -Pattern overclock

# 2) the composed tree contains the plugin row
#    (the desktop profile is owned by the desktop app, so the CLI can only do this for other profiles)
dsh --profile <profile> --dump-config | Select-String overclock
```

The only UI-level check that matters: **the preset appears in the picker without a load-failure note**. dsh lists broken presets together with the reason instead of hiding them — so "not there" means not installed, "there but red" means a row inside the assembly failed to activate.

## Uninstall / temporarily disable

```powershell
# temporarily off: add disabled: true to this row in ~/.dsh/profiles/<profile>/cordis.patch.yml
- id: overclock-preset
  disabled: true

# full removal
dsh plugin --profile desktop remove dsh-overclock-preset
```

## Design note: why register in code instead of declaring in YAML

dsh 0.2.x lets you declare a preset by inserting an `@deepseek-ai/dsh-agent-preset` row into `cordis.patch.yml`. For a **third-party package** that path has a trap:

- Child rows of a declaration are resolved with the Loader's `import.meta.resolve`, anchored at the **package root of the file that declares them**.
- Once the plugin lives in `profiles/<profile>/node_modules`, the host's own `@deepseek-ai/dsh-*` packages are not resolvable from there — the whole preset turns broken.

`ctx.agentPresets.register()` instead resolves against the **registry service's own install location** (the dsh host package dir), so it works no matter which profile the plugin is installed into.

The trade-off is that the plugin must run an `apply()` inside the host process; the upside is **zero imports, zero dependencies, no build artifacts to drift**. The disposer returned by `register()` goes to `ctx.effect`, so disabling the plugin unregisters the preset automatically.

## Three limits you must know

1. **Cost.** The preset deliberately spends more tokens (parallel agents + longer output). It is a mode you switch into when you want one complete pass, not a daily default.
2. **Per-response output cap is not here.** `maxTokens` belongs to the model route (`models[].maxTokens`). A preset can decline to compress; it cannot raise the adapter's physical ceiling. For local small models, that is where you lift the single-turn length.
3. **A preset can only be switched on a blank session.** This is a dsh rule (swapping tool catalogs mid-conversation invalidates recorded tool calls), not a plugin limitation.

## Test

Zero dependencies, no `npm install` needed:

```bash
node --test tests/preset.test.mjs
```

Nine structure assertions: required config keys, unique row ids, mutually exclusive shell rows per platform, and compaction parameters that must not trip the capacity assertion (the regression where `headroomTokens` gives a 49K model a negative budget).

## Contributing

Issues and PRs are welcome. Before submitting, run `node --test tests/preset.test.mjs` and make sure `lib/preset.js` contains no `{{…}}` template variables (the persona is rendered as a template).

Releases are cut by tag: the `release` workflow runs the assertions, builds `dsh-overclock-preset-<version>.zip`, and attaches it to the GitHub Release.

```bash
git tag v1.0.1 && git push origin v1.0.1
```

## License

[MIT](LICENSE) © yuri (kamioyuri)

## Project layout

```text
lib/
  preset.js      the preset itself: id / display metadata / 27 rows / persona text
  index.js       plugin entry: ctx.agentPresets.register(PRESET), unregisters on unload
tests/
  preset.test.mjs  nine structure assertions (zero dependency, node --test)
.github/workflows/
  test.yml       CI: assertions + syntax check on Node 22 / 24
cordis.patch.yml bundle patch layer: mounts the plugin into a profile
package.json     manifest: dsh.bundle.patch / dshx.permissions / test script
```
