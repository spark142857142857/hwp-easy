# HWP Easy

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

HWP Easy is a local tool for reading and editing HWP documents in Codex, Claude Code and Cursor. It saves changes in place and retains previous contents for recovery. Each client package includes the runner, document engine and required resources.

Files are processed in the agent's filesystem. No HWP Easy server or account is required. The runner and an engine based on [`@rhwp/core`](https://github.com/edwardkim/rhwp) perform document operations; `SKILL.md` describes the workflow for the agent.

[한국어](README.md) | [Installation](docs/distribution.md) | [Usage](docs/quick-start.md) | [Documentation](docs/README.md) | [Remaining work](docs/remaining-work.md)

## Features

- Body and table-cell reading, search and SVG previews
- Text, paragraphs, supported table structures and formatting
- Supported pictures, text boxes, grouped text and fields
- Table height and flow adjustments, floating-object repositioning
- Same-file saves with conflict and preservation checks
- Previous-content restoration that also retains the edited version

Support depends on document structure. Unverified structures may be read-only or refuse editing. Preview fonts, line breaks and page layout may differ from external document applications. See [features and limits](docs/supported-features.md).

## Installation

The current Codex distribution is **0.5.0**. Install Node.js 22+, run Codex once and ensure its CLI supports plugin commands.

```bash
npx hwp-easy@0.5.0 install
```

Restart Codex and explicitly select **HWP Easy** from the skill menu. For an existing installation, use `update` instead of `install`. Installing the public package does not require an npm account or 2FA.

| Client | Current distribution | Installation |
| --- | --- | --- |
| Codex | **0.5.0** | npm command above, or [GitHub marketplace and ZIP](docs/distribution.md) |
| Claude Code | **0.2.19** | [Personal skill package](docs/agent-client-skills.md#설치와-호출) |
| Cursor | **0.2.19** | [Personal skill package](docs/agent-client-skills.md#설치와-호출) |

**The npm installer currently targets Codex.** Claude Code and Cursor remain usable through their existing packages; their 0.5.0 updates are deferred. Packages built at the same version share one engine, but the currently distributed versions have different feature scopes.

The [npm package](https://www.npmjs.com/package/hwp-easy) and [GitHub 0.5.0 release](https://github.com/spark142857142857/hwp-easy/releases/tag/hwp-easy-local-v0.5.0) are public. See [installation and updates](docs/distribution.md) for rollback and alternative installation paths. OpenAI public-directory publication is separate and has not occurred.

## Usage

In Codex, explicitly select HWP Easy and provide the path and requested changes. In Claude Code and Cursor, invoke `/hwp-easy` before the request. The skill applies only to the invoked task.

```text
Read C:\Documents\application.hwp and summarize its questions and answer cells. Do not modify the file.
```

```text
Set the motivation cell in C:\Documents\application.hwp to "I want to build experience solving community problems." Save to the same file and retain the other cells.
```

```text
Restore C:\Documents\application.hwp to its state before the last edit.
```

The runner checks the file version and edit targets before saving. Previous bytes are retained in the adjacent `.hwp-easy-backups` directory. Attachments and cloud files do not automatically synchronize with the PC original. See [usage](docs/quick-start.md).

## Package contents

| Component | Role |
| --- | --- |
| `SKILL.md` and `references/` | Workflow and operation-specific support conditions |
| `local-runner.mjs` | Engine calls, edit verification, local saves and recovery |
| HWP and preview WASM, font | Document processing and preview resources |
| `plugin.json` | Plugin identity, listing metadata and version |
| Installer | Install, update and restore a previous plugin version |

GitHub and npm distributions contain the same plugin files and engine. npm is an installation channel, not a document server. Copying only `SKILL.md` omits the runtime and does not work. See [architecture](docs/architecture.md).

## Documentation

- [Installation and updates](docs/distribution.md)
- [Usage guide](docs/quick-start.md)
- [Features and limits](docs/supported-features.md)
- [Project status](docs/project-status.md)
- [Documentation index](docs/README.md)

Most detailed documentation is in Korean.

## Development

Source lives on `main`; the complete distribution lives on `distribution`. See the [developer guide](docs/developer-guide.md) for setup, packaging and checks. GitHub Actions runs only on explicit owner requests. Report reproducible issues without personal documents or credentials in [Issues](https://github.com/spark142857142857/hwp-easy/issues).

## Project status

Checks on 0.5.0 cover GitHub installation, updating from 0.2.19, recovery from an injected installation failure and plugin rollback. Installed runners also passed synthetic HWP editing, same-file saves and byte-exact restoration. The [distribution report](docs/distribution-0.5.0.md) distinguishes these checks from unverified environments and fresh-chat model calls.

OpenAI directory submission is blocked by the skills-only intake restriction. Remote 0.1.9 and the Windows COM prototype remain [archived implementations](docs/README.md#보관-자료). See [remaining work](docs/remaining-work.md).

## License

[MIT](LICENSE). External engine and font notices are recorded in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and included in each distribution.
