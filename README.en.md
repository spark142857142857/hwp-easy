# HWP Easy

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

HWP Easy is a local tool for reading and editing HWP documents in Codex, Claude Code and Cursor. It is distributed as a plugin for Codex and as personal skill packages containing the runner and engine for Claude Code and Cursor.

It uses an engine built on [`@rhwp/core`](https://github.com/edwardkim/rhwp), without requiring Hancom installation or an HWP Easy server. HWP Easy adds edit-target and preservation checks, conflict detection, same-file saving and recovery. Only verified edits are saved, with previous bytes retained for recovery.

[한국어](README.md) · [Usage guide](docs/quick-start.md) · [Documentation](docs/README.md)

<a id="supported-local-editing"></a>
<a id="what-can-i-use-it-for"></a>

## Features

- Body and table-cell reading, phrase search and SVG previews of the current document
- Text replacement, multiline answers, paragraph insertion, deletion, duplication and movement
- Supported table structure changes and font, size, color and alignment editing
- Ordinary PNG/JPEG picture insertion, replacement, resizing, cropping and rotation at supported body and table-cell locations
- Same-file saving with conflict detection and preservation checks for untargeted content
- Recovery history, previous-version restoration and retention of the edited version before recovery
- Updated embedded preview text and first-page thumbnails after saving

Supported edits depend on the document structure and target. Nested-table structure changes, field creation/deletion and grouped-picture replacement/rotation remain unsupported. Documents whose structure cannot be verified are handled through partial read-only results or rejected operations. Partial reads may omit some object content.

SVG previews of the current document and rereading after saving do not guarantee identical fonts, line breaks or page layout in an external HWP application. See [features and limits](docs/supported-features.md) for operation-specific conditions and preview limitations.

## Package contents

`SKILL.md` instructs the AI on the editing workflow. The bundled runner and engine perform the actual HWP processing. Each skill directory includes:

| Component | Role |
| --- | --- |
| `SKILL.md` | Instructions for reading files, selecting targets, editing, saving and recovery |
| `references/` | Supported operations, request formats and operation-specific constraints |
| `scripts/local-runner.mjs` | JavaScript bundle that calls the engine, checks edits and handles local saving, backups and recovery |
| `scripts/rhwp_bg.wasm` | Engine that reads HWP structure and produces edited documents and SVG previews |
| Preview WASM, font and notices | Embedded BMP thumbnail generation and preview font fallback |

The Codex plugin packages this skill and its runtime resources with `plugin.json` and listing metadata such as the name, icon, description and version. All three clients use the same source, runner and WASM, with the same editing scope. Copying `SKILL.md` alone is insufficient to run HWP Easy. See [architecture](docs/architecture.md) for details.

<a id="choose-your-app"></a>

## Installation

Install the complete package for your client, including the runner and engine. The execution environment requires Node.js 22+ and access to the target file. The document engine, WASM and JavaScript dependencies are bundled. Login and usage requirements follow the agent application.

| Client | Distribution | Installation guide |
| --- | --- | --- |
| Codex | Local plugin | [Installation record and reproduction](docs/local-plugin-installation.md) |
| Claude Code | Personal skill package | [Installation and invocation](docs/agent-client-skills.md#설치와-호출) |
| Cursor | Personal skill package | [Installation and invocation](docs/agent-client-skills.md#설치와-호출) |

The current version is **0.2.19**. Download client ZIPs and SHA-256 checksums from the [public release](https://github.com/spark142857142857/hwp-easy/releases/tag/hwp-easy-local-v0.2.19). OpenAI directory publication is a separate process. See [project status](docs/project-status.md) for installations and verified scope.

<a id="install-and-use"></a>
<a id="how-does-it-work"></a>

## Usage

Select **HWP Easy** from the skill menu in Codex, or explicitly invoke `/hwp-easy` in Claude Code or Cursor. The skill applies only to the invoked task.

Example requests in Claude Code or Cursor:

```text
/hwp-easy Read C:\Documents\application.hwp and summarize its questions and answer cells. Do not modify the file.

/hwp-easy Set the motivation cell in C:\Documents\application.hwp to "I want to build experience solving community problems." Save to the same file.

/hwp-easy Restore C:\Documents\application.hwp to its state before the last edit.
```

The default save target is the specified file's original path. Previous bytes are stored in the adjacent `.hwp-easy-backups` directory. See the [usage guide](docs/quick-start.md) for file selection, save verification and recovery.

<a id="repository-map"></a>
<a id="learn-more"></a>

## Documentation

- [Usage guide](docs/quick-start.md): file selection, edit requests, saving and recovery
- [Features and limits](docs/supported-features.md): supported operations and preview limitations
- [Architecture](docs/architecture.md): shared engine, local storage and client distribution
- [Project status](docs/project-status.md): installation and invocation checks, remaining work
- [Documentation index](docs/README.md): development, detailed verification and earlier implementations

The documentation is primarily in Korean. The client installation guide also includes an English summary.

## Development

See the [developer guide](docs/developer-guide.md) for setup, source organization, package generation and checks. Report bugs and feature requests in [Issues](https://github.com/spark142857142857/hwp-easy/issues) using synthetic reproductions without personal documents or credentials.

<a id="current-status"></a>
<a id="current-readiness"></a>

## Project status

Installed 0.2.19 runners in all three clients passed editing, same-file saving, rereading and exact recovery. A fresh Codex app-server conversation executed the selected skill through the actual model; Claude Code and Cursor CLI model invocations were verified on 0.2.18. Selected edits in 12 public documents and Hancom layout checks on two representative documents also passed. See the [0.2.19 verification record](docs/local-release-0.2.19.md) and [current CI](https://github.com/spark142857142857/hwp-easy/actions). Other-user installation and the complete Cloud flow remain follow-up work.

Remote **0.1.9** and the Windows COM prototype are retained earlier implementations. Their code, packages and review records are indexed under [archived material](docs/README.md#보관-자료).

<a id="support-and-licensing"></a>

## License

HWP Easy is released under the [MIT License](LICENSE). Licenses for `@rhwp/core` 0.8.6 and other dependencies are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
