# HWP Easy

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

HWP Easy is a local tool for reading and editing HWP documents in Codex, Claude Code and Cursor. It is distributed as a plugin for Codex and as personal skill packages containing the runner and engine for Claude Code and Cursor.

It uses an engine built on [`@rhwp/core`](https://github.com/edwardkim/rhwp), without requiring Hancom installation or an HWP Easy server. HWP Easy adds edit-target and preservation checks, conflict detection, same-file saving and recovery. Only verified edits are saved, with previous bytes retained for recovery.

[한국어](README.md) · [Usage guide](docs/quick-start.md) · [Documentation](docs/README.md) · [Roadmap (Korean)](docs/remaining-work.md)

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

Supported edits depend on document structure and target. The [table-flow support added in 0.2.42](docs/local-release-0.2.42.md) can fit row and nested table heights to content when explicitly requested. Ordinary edits preserve stored minima and explicit page breaks. Supported floating pictures and plain text boxes reuse verified current-page space, with a new-page fallback for insufficient or uncertain flow. Same-file saves, byte-exact recovery and actual Hancom layouts are checked. Codex is installed at 0.2.51; Claude Code and Cursor remain on 0.2.19. Unverifiable structures produce partial read-only results or refused operations. Partial reads may omit object content. The F2 core profiles have completed [closure regression](docs/f2-closure-0.2.42.md); the frozen [support scope](docs/f2-support-0.2.42.md) defines accepted and refused structures.

The source and current Codex installation are at [0.5.0](docs/release-review-0.5.0.md). The HWP Easy name is unchanged. The 0.5.0 ZIP has been uploaded to the portal. Metadata findings include a skills-only submission restriction, and skill checks are still running. Formal review submission has not been performed. Installed-runtime save and recovery checks passed. The engine and runner are identical to the I3 verification candidate; publication has not been performed.

The [0.2.50 source and verification package](docs/local-release-0.2.50.md) completes the defined F3 rendering scope: everyday text and formatting, continued nested-table rows, automatic columns and footers. Same-file saves, exact recovery and native Hancom comparisons are verified within the [documented support boundaries](docs/f3-support-0.2.50.md). Codex is now installed at [0.2.51 with fresh-chat verification](docs/local-install-0.2.51.md). The [F4 extension](docs/f4-support-0.2.51.md) adds object-list text, subgroup transforms and additional fields; the follow-up [I3 candidate](docs/local-release-0.5.0-dev.1.md) addresses rotated rectangle text within a defined profile. Publication is tracked in [remaining work](docs/remaining-work.md).

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

The Codex plugin packages this skill and its runtime resources with `plugin.json` and listing metadata such as the name, icon, description and version. Packages built at the same version share the source, runner, WASM and editing scope. Installed version differences are recorded separately. Copying `SKILL.md` alone is insufficient to run HWP Easy. See [architecture](docs/architecture.md) for details.

<a id="choose-your-app"></a>

## Installation

Install the complete package for your client, including the runner and engine. The execution environment requires Node.js 22+ and access to the target file. The document engine, WASM and JavaScript dependencies are bundled. Login and usage requirements follow the agent application.

| Client | Distribution | Installation guide |
| --- | --- | --- |
| Codex | Local plugin | [Installation record and reproduction](docs/local-plugin-installation.md) |
| Claude Code | Personal skill package | [Installation and invocation](docs/agent-client-skills.md#설치와-호출) |
| Cursor | Personal skill package | [Installation and invocation](docs/agent-client-skills.md#설치와-호출) |

The verified Codex installation is **0.2.51**; public packages and the Claude Code/Cursor installations remain **0.2.19**. Download client ZIPs and SHA-256 checksums from the [public release](https://github.com/spark142857142857/hwp-easy/releases/tag/hwp-easy-local-v0.2.19). OpenAI directory publication is a separate process. See [project status](docs/project-status.md) for installations and verified scope.

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

A fresh Codex chat explicitly read the installed 0.2.51 skill and used its cached runner to edit body/cell text, extend a nested answer to 65 lines, and change grouped text, field metadata and an individual subgroup. All three synthetic files were saved in place and restored byte-for-byte using separate restore requests. All 25 installed files match the verified ZIP; independent raw records and nine native Hancom state files (ten pages) were checked. Rotated subgroup text is present in the HWP and native view but can be missing from the SVG preview (I3). See [installation and new-chat verification](docs/local-install-0.2.51.md) and [F2 closure regression](docs/f2-closure-0.2.42.md). Claude Code and Cursor remain on 0.2.19 with updates deferred. Other-user installation and public-release preparation are tracked in [remaining work](docs/remaining-work.md).

Remote **0.1.9** and the Windows COM prototype are retained earlier implementations. Their code, packages and review records are indexed under [archived material](docs/README.md#보관-자료).

<a id="support-and-licensing"></a>

## License

HWP Easy is released under the [MIT License](LICENSE). Licenses for `@rhwp/core` 0.8.6 and other dependencies are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
