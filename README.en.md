# HWP Easy

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

**A local tool for reading and editing HWP documents with Codex, Claude Code or Cursor.**

Ask your agent to revise text, fill table cells or change supported formatting without installing Hancom. Verified edits save **to the same HWP file**, with previous bytes retained for recovery.

[한국어](README.md) · [Get started](docs/quick-start.md) · [Features](docs/supported-features.md) · [Documentation](docs/README.md)

<a id="install-and-use"></a>

## How does it work?

1. Install HWP Easy for your app and select the skill.
2. Specify the HWP file path and requested changes.
3. The agent checks the targets, saves verified changes and reports the result. Restore a previous version when needed.

In Claude Code or Cursor:

> /hwp-easy Read C:\Documents\application.hwp, set the motivation cell to “I want to build experience solving community problems,” and save to the same file. Preserve the other cells.

In Codex, select **HWP Easy** from the skill menu before making the same request. The skill applies only to the explicitly invoked task.

<a id="supported-local-editing"></a>

## What can I use it for?

| Task | Examples |
| --- | --- |
| Inspect content | Find questions, answer cells and exact phrases |
| Edit answers and body text | Fill applications, revise paragraphs and write multiline answers |
| Change structure and formatting | Supported paragraph/table insertion and movement; font, size and color changes |
| Edit pictures | Supported PNG/JPEG insertion, resizing, cropping and rotation |
| Recover earlier content | Restore the original and recover the edited version again |

Support depends on the document structure. Nested-table structure changes, field creation/deletion and grouped-picture replacement/rotation remain unsupported. See the [feature guide](docs/supported-features.md) for details.

## Choose your app

| App | Invocation | Guide |
| --- | --- | --- |
| Codex | Select **HWP Easy** from the skill menu | [Usage](docs/quick-start.md), [Codex installation status](docs/local-plugin-installation.md) |
| Claude Code | `/hwp-easy` | [Personal skill installation](docs/agent-client-skills.md) |
| Cursor | `/hwp-easy` | [Personal skill installation](docs/agent-client-skills.md) |

HWP document processing needs no HWP Easy server, account or web upload. All three distributions share the **same bundled Node/WASM runner and engine**. The environment requires filesystem access and Node.js 22+; the agent's own login and usage requirements still apply.

<a id="current-status"></a>

## Current readiness

The current local main version is **0.2.18**. Actual Claude Code and Cursor CLI invocations passed editing, same-file saving, rereading and exact original recovery. Codex's installed runtime checks and all [10 Linux/Windows CI jobs](https://github.com/spark142857142857/hwp-easy/actions/runs/38252416686) also passed.

Public downloads and directory publication are still being prepared. Cursor IDE chat UI, the full flow in a new Codex Cloud task and unrestricted external-viewer layout remain unverified. See [current status](docs/project-status.md) for installed versions and remaining work.

<a id="repository-map"></a>

## Learn more

| Question | Document |
| --- | --- |
| How do I select files, edit, save and restore? | [Get started](docs/quick-start.md) |
| Which edits are supported? | [Features and limits](docs/supported-features.md) |
| How do the engine, storage and clients fit together? | [Architecture](docs/architecture.md) |
| How do I run the source, build packages and verify them? | [Developer guide](docs/developer-guide.md) |
| Where are detailed checks and earlier implementation records? | [Documentation index](docs/README.md) |

The guides primarily use Korean; the client installation guide includes an English summary. Remote **0.1.9** and the Windows COM prototype are preserved earlier implementations, indexed separately from the main local flow.

## Support and licensing

Report bugs in [Issues](https://github.com/spark142857142857/hwp-easy/issues) with synthetic reproductions rather than personal documents or credentials.

HWP Easy uses the [MIT License](LICENSE) and [`@rhwp/core`](https://github.com/edwardkim/rhwp) 0.8.6 for document processing. External libraries retain their own licenses; see [third-party notices](THIRD_PARTY_NOTICES.md).
