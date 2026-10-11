# HWP Easy

**Read and edit supported HWP form fields with an agent, without installing Hancom.**

[한국어](README.md) · [Documentation](docs/README.md) · [Developer setup](docs/developer-guide.md)

HWP Easy combines the pinned `@rhwp/core` WASM engine with exact target selection, independent preservation checks and recoverable storage. The local Codex execution path reads the selected HWP and saves checked changes to that same file, without an upload, browser or download step. It supports multiline body/cell answers, paragraph and table creation, supported merged-table row/column changes, font formatting and multiple PNG/JPEG pictures in body or cell paragraphs, including replacement, cropping and rotation. See [local editing](docs/local-file-editing.md). The separate remote MCP edits a hosted copy.

## Status

The owner-only remote MVP has been tested through upload, full supported-content reads, paragraph and table-cell edits, saving, previews, download and restore. The remote 0.1.9 package is In review and Not published. The local 0.2.4 candidate passed real execution in an isolated folder without node_modules, same-file save/restore and independent record checks. Its latest 50 picture-edit checks used copies of three local forms; the originals stayed unchanged. External-viewer layout remains unverified. It has not been installed or submitted to the directory.

**A public source repository does not publish the plugin or grant access to hosted documents.** The Site URL is publicly reachable for domain verification; document operations still require sign-in and owner checks. Live public checks rejected anonymous requests and forged identity headers. Actual second-account installation and isolation remain untested. Codex Cloud verification covers fixed synthetic HWP flows; arbitrary forms and the complete attachment UI are not certified. Authentication refresh remains under investigation. See [MVP evidence](docs/mvp-status.md) and [public release preparation](docs/public-plugin-release.md).

## Remote MCP editing contract

- Read supported paragraphs and top-level table cells in unencrypted HWP 5.x. Follow paginated reads on one pinned version.
- Check exact target IDs, full old text, the expected version and preservation before saving.
- Save as a new version of the same remote document and retain earlier versions. Reading and summarizing do not save. Remote saving does not overwrite the original PC file.
- Provide HWP downloads, previous-version restoration and direct SVG previews. Content checks do not certify pixel-identical layout in external viewers.
- Remote limits are **4 MiB** per input and **400,000 UTF-16 units** across body and table text. Documents within those limits can still be unsupported.
- New paragraphs, table rows, images, formatting changes, new line breaks, encryption/DRM bypass and HWPX/PDF/DOCX conversion are outside the supported scope.

The remote path also supports validated empty-cell fills/clears and narrowly constrained mixed-style replacements. This does not imply equivalent support in the local Python MCP or arbitrary documents.

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

Developer setup requires Node.js 22+ and Python 3.11+. The new engine path does not require Hancom, COM, Wine or a GUI. Follow the [developer guide](docs/developer-guide.md) and [architecture](docs/architecture.md); CLI setup is not the promised normal user installation flow. Historical directory names and entry points are retained for compatibility.

## Support and licensing

Use [Issues](https://github.com/spark142857142857/hwp-easy/issues) for ordinary bugs and proposals, with synthetic reproductions. Do not post personal HWP files, credentials, cookies or authentication codes.

The license for HWP Easy itself is not yet specified. Upstream engine notices apply to their respective components and do not relicense this project. See [third-party notices](THIRD_PARTY_NOTICES.md). Dots integration remains outside the MVP scope.
