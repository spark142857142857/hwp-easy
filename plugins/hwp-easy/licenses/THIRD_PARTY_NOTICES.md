# Third-party engine notices

HWP Easy's own code is licensed under [MIT](LICENSE). The components below retain their respective licenses.

This source repository depends on `@rhwp/core` **0.8.6**, pinned by `package-lock.json`. The npm package provides the HWP parser, writer and SVG renderer reused by the native adapter. It is not an engine authored by HWP Easy.

- Upstream: [edwardkim/rhwp](https://github.com/edwardkim/rhwp)
- npm source provenance: `e8800c8def63449808a4092798442652ed460552`
- Package integrity: `sha512-ZMO2QMHbR4v7t86feMWiRJ4QozjjqHDGv4PyzTT4LyMuX1LeUpmQaOHrGLQpbYMJV0IWCYjVRewKqkXx+w16XQ==`
- Upstream [license at that revision](https://github.com/edwardkim/rhwp/blob/e8800c8def63449808a4092798442652ed460552/LICENSE) and [additional dependency/resource notices](https://github.com/edwardkim/rhwp/blob/e8800c8def63449808a4092798442652ed460552/THIRD_PARTY_LICENSES.md).

The revision and integrity above match npm's metadata for this exact package; a native release tag with the same version number is not used as a substitute. HWP Easy copies `rhwp_bg.wasm` and bundles its JavaScript glue into the local client distributions and the archived Sites Worker artifact. It copies the package's MIT license alongside that binary, and includes an unchanged [supplemental upstream notice snapshot](probes/sites-runtime/licenses/rhwp/THIRD_PARTY_LICENSES.md) from the same source revision.

The local formatter's [font-name alias data](src/one_hwp/font_defaults.json) derives from `FONT_DEFAULT_NAMES` in [the pinned serializer source](https://github.com/edwardkim/rhwp/blob/e8800c8def63449808a4092798442652ed460552/src/serializer/doc_info.rs). The local bundle includes this data and the upstream MIT notice. This name mapping does not redistribute or install any font file.

That supplemental document describes the entire upstream source project, including optional/native backends, web editors and font resources. It is **not** a resolved inventory of everything compiled into this npm WASM artifact, and does not mean HWP Easy bundles every listed resource. The build copies no standalone rhwp font files or web-editor resources; local 0.2.19 separately bundles the Korean thumbnail fallback font described below. This statement is not an audit of resources embedded inside WASM. Preserve all applicable notices when redistributing; the current notice bundle is not a complete WASM SBOM or legal-compliance certification.

The Python wheel contains our adapter and bridge, not the npm runtime or a Hancom engine. Optional Python SDK/library and Node runtime distributions retain their own licenses. No Hancom engine, security DLL or format manual is redistributed by this repository. This notice does not relicense the repository.

## Synthetic Worker dependencies

The Worker guard uses `pako` **3.0.2**, pinned by `probes/sites-runtime/package-lock.json`, for low-level bounded raw-DEFLATE. Its declared license is `MIT AND Zlib`. Source provenance is `32be8f8e0ead1e6e8a74a1586a34f84734382d01` in [nodeca/pako](https://github.com/nodeca/pako/tree/32be8f8e0ead1e6e8a74a1586a34f84734382d01). The build copies the npm MIT license and the unchanged [pinned inflater Zlib notice](https://github.com/nodeca/pako/blob/32be8f8e0ead1e6e8a74a1586a34f84734382d01/src/zlib/inflate.mjs) into the deployment artifact. HWP Easy authors the surrounding validation adapter, not the inflater.

`cfb` **1.2.2** ([SheetJS/js-cfb](https://github.com/SheetJS/js-cfb)) is an Apache-2.0 synthetic fixture writer and, from local candidate 0.2.15, a bundled local CFB writer for complex character formatting. The local adapter patches selected definitions/runs, then independently checks the packed stream set, retained stream bytes and decoded edits before publication. It is not imported by the deployed Worker or used as its production reader. The unchanged [Apache-2.0 license](probes/sites-runtime/licenses/cfb/LICENSE.txt) ships in the local package as `licenses/CFB-LICENSE.txt`; its npm integrity, source digest and notice digest are checked by [the local builder](scripts/local-cfb-notices.mjs) and recorded in `build-manifest.json`. The bundled CFB source imports only Node's `fs`; its declared `adler-32`/`crc-32` package dependencies are not in the local bundle, checked using esbuild's input manifest. Drizzle generates development schemas/migrations, and esbuild and Miniflare are build/test dependencies; their package license notices remain applicable. These JavaScript packages are distinct from similarly named Rust crates that upstream may compile into WASM.

## Build-time notice checks

Local 0.2.19 bundles `@resvg/resvg-wasm` **2.6.2** (MPL-2.0) for derived thumbnails and unchanged **NanumGothic Regular** (SIL OFL-1.1, NHN Corporation copyright) for Korean fallback rendering. The root lockfile pins the renderer's npm integrity. [Resource provenance](vendor/local-preview/README.md), the unchanged [renderer license](vendor/local-preview/RESVG-LICENSE.txt), [font license](vendor/local-preview/OFL.txt), and [build-time digest checks](scripts/local-preview-notices.mjs) identify the exact resources. Corresponding unmodified renderer source is available at [resvg-js v2.6.2](https://github.com/thx/resvg-js/tree/v2.6.2). The binaries, glue and applicable notices ship in all three local client packages. These resources are not deployed to the archived Worker. The font is not installed on the user's system or inserted into HWP font definitions.

The local preview stream implementation references Hancom's public HWP 5.0 revision 1.3 specification. 본 제품은 한컴의 HWP 문서 파일(.hwp) 공개 문서를 참고하여 개발하였습니다.

The bundled local CFB writer retains this source attribution: `cfb.js (C) 2013-present SheetJS -- http://sheetjs.com`. Its embedded CRC implementation carries `crc32.js (C) 2014-present SheetJS -- http://sheetjs.com` in the bundle's legal comments.

`probes/sites-runtime/scripts/runtime-notices.mjs` checks installed package names, versions and license declarations, lockfile integrity pins and the exact notice text (allowing only Windows CRLF normalization). The build includes `RHWP-LICENSE.txt`, `RHWP-THIRD-PARTY-LICENSES.md`, `PAKO-LICENSE.txt`, `PAKO-ZLIB-LICENSE.txt` and `THIRD-PARTY-NOTICES.json` in `dist/server`. The manifest records source revisions, notice digests and the bundled WASM digest. Missing/altered notices and inconsistent package pins fail the build. These packaging checks do not replace a full compiled-dependency license review.

## @rhwp/core MIT license

The following is the license shipped in the installed npm package:

```text
MIT License

Copyright (c) 2025-2026 Edward Kim

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
