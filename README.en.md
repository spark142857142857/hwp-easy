# HWP Easy

**Read and edit supported HWP form fields with an agent, without installing Hancom.**

[한국어](README.md) · [Documentation](docs/README.md) · [Developer setup](docs/developer-guide.md) · [Contributing](CONTRIBUTING.md)

HWP Easy combines the pinned `@rhwp/core` WASM engine with exact target selection, independent preservation checks, recoverable version storage and MCP tools for agents. The intended user experience is to connect HWP Easy in ChatGPT or Codex, upload an HWP, request an edit, and download the verified HWP.

## Status

The owner-only private MVP has been tested through upload, full supported-content reads, paragraph and table-cell edits, saving, previews, download and restore. Public plugin distribution is in preparation: a package draft exists, but developer verification, actual multi-account checks, review and directory publication are incomplete.

**A public source repository does not publish the plugin or grant access to hosted documents.** The hosted Site currently remains owner-only. Codex Cloud verification covers fixed synthetic HWP flows; arbitrary forms and the complete attachment UI are not certified. Authentication refresh remains under investigation. See [MVP evidence](docs/mvp-status.md) and [public release preparation](docs/public-plugin-release.md).

## Editing contract

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
| `probes/sites-runtime/` | Remote Worker, guards, D1/R2 storage and browser flows |
| `src/one_hwp/` | Shared engine code, local Python MCP and preserved COM prototype |
| `tests/` | Synthetic local engine, storage and MCP checks |
| `scripts/` | Repository hygiene and plugin packaging |
| `docs/` | User, developer, verification and release documentation |
| `docs/legacy/` | Historical Windows COM documentation |

Developer setup requires Node.js 22+ and Python 3.11+. The new engine path does not require Hancom, COM, Wine or a GUI. Follow the [developer guide](docs/developer-guide.md) and [architecture](docs/architecture.md); CLI setup is not the promised normal user installation flow. Historical directory names and entry points are retained for compatibility.

## Support and licensing

Use [Issues](https://github.com/spark142857142857/hwp-easy/issues) for ordinary bugs and proposals, with synthetic reproductions. Do not post personal HWP files, credentials, cookies or authentication codes. Follow [SECURITY.md](SECURITY.md) for security reports.

The license for HWP Easy itself is not yet specified. Upstream engine notices apply to their respective components and do not relicense this project. See [third-party notices](THIRD_PARTY_NOTICES.md). Dots integration remains outside the MVP scope.
