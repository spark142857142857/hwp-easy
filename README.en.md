# HWP Easy

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

HWP Easy is a local plugin and skill for reading and editing HWP documents in Codex, Claude Code and Cursor.

It uses a Node/WASM runner built on [`@rhwp/core`](https://github.com/edwardkim/rhwp), without requiring Hancom installation or an HWP Easy server. Verified edits save to the same HWP file, with previous bytes retained for recovery. All three client distributions share the same source and runner.

[한국어](README.md) · [Usage guide](docs/quick-start.md) · [Documentation](docs/README.md)

<a id="supported-local-editing"></a>
<a id="what-can-i-use-it-for"></a>

## Features

- Body and table-cell reading, phrase search and SVG previews of the current document
- Text replacement, multiline answers, paragraph insertion, deletion, duplication and movement
- Supported table structure changes and font, size, color and alignment editing
- PNG/JPEG insertion, replacement, resizing, cropping and rotation
- Same-file saving with conflict detection and preservation checks for untargeted content
- Recovery history, previous-version restoration and retention of the edited version before recovery

Supported edits depend on the document structure and target. Nested-table structure changes, field creation/deletion and grouped-picture replacement/rotation remain unsupported. See [features and limits](docs/supported-features.md) for the complete scope.

<a id="choose-your-app"></a>

## Installation

The execution environment requires Node.js 22+ and access to the target file. The document engine, WASM and JavaScript dependencies are bundled. Login and usage requirements follow the agent application.

| Client | Distribution | Installation guide |
| --- | --- | --- |
| Codex | Local plugin | [Installation record and reproduction](docs/local-plugin-installation.md) |
| Claude Code | Personal skill | [Installation and invocation](docs/agent-client-skills.md#설치와-호출) |
| Cursor | Personal skill | [Installation and invocation](docs/agent-client-skills.md#설치와-호출) |

The current source and generated package version is **0.2.18**. Public downloads and directory publication are being prepared. See [project status](docs/project-status.md) for installed versions and verified scope.

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

Actual Claude Code and Cursor CLI invocations passed editing, same-file saving, rereading and exact original recovery. Codex's installed runner checks and the 0.2.18 code's [Linux/Windows CI](https://github.com/spark142857142857/hwp-easy/actions/runs/38252416686) also passed. Cursor IDE chat UI, execution after desktop skill selection in Codex, the complete flow in a new Cloud task and other-user installation require additional verification.

Remote **0.1.9** and the Windows COM prototype are retained earlier implementations. Their code, packages and review records are indexed under [archived material](docs/README.md#보관-자료).

<a id="support-and-licensing"></a>

## License

HWP Easy is released under the [MIT License](LICENSE). Licenses for `@rhwp/core` 0.8.6 and other dependencies are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
