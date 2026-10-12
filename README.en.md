# HWP Easy

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Read and edit HWP files with an agent without installing Hancom.

[한국어](README.md) | [Usage](docs/quick-start.md) | [Documentation](docs/README.md)

**HWP Easy 0.2.18 is the main local execution package.** The agent edits an accessible HWP and saves verified changes to the same file. Previous bytes are retained for recovery. No HWP Easy server, account or upload is required.

Select **HWP Easy** from the skill menu in a new chat, then specify the file and changes. In Codex CLI, type `$` and search for `HWP`. The skill is not applied automatically. An attached copy is distinct from the original file on your PC; cloud tasks process files available in their own environment.

Claude Code and Cursor use personal skills invoked with **`/hwp-easy`**. Both share the same engine and remain explicit-only. See the [Korean/English installation and verification guide](docs/agent-client-skills.md).

## Current status

| Area | Status |
| --- | --- |
| Main package | HWP Easy 0.2.18, with its engine and WASM bundled. Requires filesystem access and Node.js 22+. |
| Actual local installation | Windows Codex 0.2.17 installation/enabled status and Claude Code/Cursor 0.2.18 personal skill installation were confirmed. Installed runtimes passed synthetic editing, same-file save, history and exact-byte recovery. Runtime checks and actual AI-host invocation are recorded separately. |
| Public directory | Publication of the local main package and installation by other users remain unverified. |
| Fresh chat | Explicit-only Codex skills are intentionally hidden from the initial model list. CLI selection injected the installed skill body; plain invocation text in an app-tool-created chat did not. User screenshots confirmed desktop menu display and selection, while desktop transmission/execution remains unverified. |
| Cloud | Compatible with an execution environment in principle; installing this main package and completing file transfer in a new cloud task still needs validation. |
| Remote 0.1.9 | Archived separately and excluded from the main installation. Existing deployment and submission records are retained. |

[Installation evidence and reproduction](docs/local-plugin-installation.md) distinguish the installed runtime check from public distribution and visual layout certification.

[Skill discovery and invocation diagnosis](docs/local-skill-discovery.md) explains the initial-list behavior and the limits of automated fresh-chat checks. Version 0.2.17 fixes truncated skill instructions by keeping the main prompt within the host's byte limit and retaining detailed guidance in references. The explicit-only policy remains unchanged.

Version 0.2.16 exposes observable body content as read-only when complex editing targets cannot be verified. Twelve public complex HWP files passed reading, including eight partial read-only results; four supported files passed edit/save/recovery and independent raw-record checks. See [follow-up quality evidence](docs/local-plugin-quality.md).

## Supported local editing

| Target | Supported operations |
| --- | --- |
| Text and paragraphs | Exact search, range edits, multiline answers, insert, delete, split, merge, duplicate and move |
| Tables | Create and move, supported merged-table rows and columns, cell merge/split, sizes, padding and alignment |
| Character formatting | Font, size, color, bold, italic, underline and strikethrough |
| Pictures | Body/cell PNG and JPEG insertion, replacement, size and position changes, crop and rotation |
| Complex objects | ClickHere values, nested-cell text and character formatting, group movement and selected child-picture cropping |

Support depends on document structure and the requested operation. Nested-table structure changes, field creation/deletion, grouped-picture replacement/rotation and unrestricted page-layout editing remain unsupported. Every operation in a batch must pass before a single save. Exact external-viewer page layout is not certified. See [local editing](docs/local-file-editing.md).

HWP processing uses [`@rhwp/core`](https://github.com/edwardkim/rhwp) **0.8.6**. HWP Easy adds target checks, independent preservation validation, conflict-checked saving and recovery.

## Repository map

| Directory | Responsibility |
| --- | --- |
| `plugins/hwp-easy/` | Main local plugin source |
| `plugins/archive/` | Preserved remote 0.1.9 package |
| `src/one_hwp/` | Node/WASM local runner, shared engine, older Python MCP and COM prototype |
| `probes/sites-runtime/` | Preserved remote Worker, guards, D1/R2 storage and browser flows |
| `tests/` | Synthetic engine, editing, storage and MCP checks |
| `scripts/` | Packaging, installation preparation and verification |
| `docs/` | Usage, developer guides, validation and historical release records |

The remote service edits uploaded copies and returns downloads. Its [archived package](plugins/archive/README.md), [previous usage guide](docs/remote-quick-start.md) and [submission history](docs/public-plugin-release.md) remain available. This pivot does not shut down the service, delete stored documents or withdraw the existing submission.

## Support and licensing

Report bugs in [Issues](https://github.com/spark142857142857/hwp-easy/issues), using synthetic reproductions without personal documents or credentials.

HWP Easy is available under the [MIT License](LICENSE). External libraries retain their own licenses; see [third-party notices](THIRD_PARTY_NOTICES.md). HWPX/PDF/DOCX conversion is outside the product scope.
