# HWP Easy

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Ask an agent to edit HWP files without installing Hancom.

[한국어](README.md) | [Documentation](docs/README.md) | [Developer setup](docs/developer-guide.md)

In local Codex, HWP Easy reads the selected file, checks the edits and **saves to that same HWP file**. It keeps the previous file for recovery. The remote MCP edits an uploaded copy; you download the result. See [local editing](docs/local-file-editing.md).

## Status

| Component | Status |
| --- | --- |
| Local editing | Package candidate 0.2.15 supports the edits listed below. Tests used copies of real forms and an isolated package. Directory distribution is pending. |
| Remote MCP | Upload, reading, editing, saving, preview, download and restore have been tested with one account. |
| Public plugin | Remote package 0.1.9 was submitted for review. Its recorded submission status is In review / Not published. |
| Codex Cloud | Fixed synthetic HWP files were tested from input through result retrieval. General forms and the full attachment UI remain untested. |
| Authentication | Automatic refresh remains under investigation. A successful call does not establish that the connection will stay active. |

The Site URL is public for domain verification. Document access requires sign-in and owner checks. Public requests without authentication or with forged identity headers were rejected.

Second-account plugin installation and document isolation still need verification. See [MVP records](docs/mvp-status.md) and [release preparation](docs/public-plugin-release.md).

## Local editing

| Target | Supported operations |
| --- | --- |
| Text and paragraphs | Search, partial edits, multiline answers, insertion, deletion, splitting, merging, duplication and movement |
| Tables | Creation and movement, supported merged-table row and column changes, cell merging and splitting, sizing, padding and alignment |
| Character formatting | Font family, size, color, bold, italic, underline and strikethrough |
| Pictures | PNG/JPEG insertion, replacement, sizing, positioning, cropping and rotation in body or cell paragraphs |
| Complex objects | ClickHere field values, nested-cell text and character formatting, picture-group movement and selected child-picture cropping |

Support depends on the document structure and requested operation. Nested-table structural changes, field creation and deletion, and grouped-picture replacement and rotation are not yet supported.

A batch is checked before one save; if any step fails, none of the changes are saved. [Local editing](docs/local-file-editing.md) documents the conditions and test results, including external-viewer checks.

## Remote MCP editing

- Read supported paragraphs and top-level table cells in unencrypted HWP 5.x. Follow paginated reads on one pinned version.
- Check exact target IDs, full old text, the expected version and preservation before saving.
- Save as a new version of the same remote document and retain earlier versions. Reading and summarizing do not save. Remote saving does not overwrite the original PC file.
- Provide HWP downloads, previous-version restoration and direct SVG previews. Content checks do not certify pixel-identical layout in external viewers.
- Remote limits are **4 MiB** per input and **400,000 UTF-16 units** across body and table text. Documents within those limits can still be unsupported.
- New paragraphs, table rows, images, formatting changes, new line breaks, encryption/DRM bypass and HWPX/PDF/DOCX conversion are outside the supported scope.

The remote path can also fill or clear validated empty cells and make some mixed-style replacements. These operations have their own restrictions; the local Python MCP uses a different support profile.

HWP processing uses [`@rhwp/core`](https://github.com/edwardkim/rhwp) **0.8.6**. HWP Easy adds target selection, independent preservation checks, storage and agent integration to this WASM engine.

## Repository map

| Directory | Responsibility |
| --- | --- |
| `plugins/hwp-easy/` | Public MCP plugin package draft |
| `plugins/hwp-easy-local/` | Explicit local-editing skill candidate |
| `probes/sites-runtime/` | Remote Worker, guards, D1/R2 storage and browser flows |
| `src/one_hwp/` | Shared engine code, local Python MCP and preserved COM prototype |
| `tests/` | Synthetic local engine, storage and MCP checks |
| `scripts/` | Repository hygiene and plugin packaging |
| `docs/` | User, developer, verification and release documentation |
| `docs/legacy/` | Historical Windows COM documentation |

Development uses Node.js 22+ and Python 3.11+. The new engine runs without Hancom, COM, Wine or a GUI. See the [developer guide](docs/developer-guide.md) for setup and the [architecture](docs/architecture.md) for code organization.

Users are not expected to install this development environment. Existing directory names and entry points are retained for compatibility.

## Support and licensing

Report bugs and suggestions in [Issues](https://github.com/spark142857142857/hwp-easy/issues). Use synthetic reproductions and leave out personal documents, credentials, cookies and authentication codes.

HWP Easy is available under the [MIT License](LICENSE). External engines and libraries retain their own licenses; see [third-party notices](THIRD_PARTY_NOTICES.md). Dots integration is reserved for later work.
