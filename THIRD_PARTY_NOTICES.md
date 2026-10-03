# Third-party engine notices

This source repository depends on `@rhwp/core` **0.8.6**, pinned by `package-lock.json`. The npm package provides the HWP parser, writer and SVG renderer reused by the native adapter. It is not an engine authored by HWP Easy.

- Upstream: [edwardkim/rhwp](https://github.com/edwardkim/rhwp)
- npm source provenance: `e8800c8def63449808a4092798442652ed460552`
- Package integrity: `sha512-ZMO2QMHbR4v7t86feMWiRJ4QozjjqHDGv4PyzTT4LyMuX1LeUpmQaOHrGLQpbYMJV0IWCYjVRewKqkXx+w16XQ==`
- Upstream [license at that revision](https://github.com/edwardkim/rhwp/blob/e8800c8def63449808a4092798442652ed460552/LICENSE) and [additional dependency/resource notices](https://github.com/edwardkim/rhwp/blob/e8800c8def63449808a4092798442652ed460552/THIRD_PARTY_LICENSES.md).

The revision and integrity above match npm's metadata for this exact package; a native release tag with the same version number is not used as a substitute. HWP Easy already copies `rhwp_bg.wasm` and bundles its JavaScript glue into the private Sites Worker artifact. It copies the package's MIT license alongside that binary, and now also includes an unchanged [supplemental upstream notice snapshot](probes/sites-runtime/licenses/rhwp/THIRD_PARTY_LICENSES.md) from the same source revision.

That supplemental document describes the entire upstream source project, including optional/native backends, web editors and font resources. It is **not** a resolved inventory of everything compiled into this npm WASM artifact, and does not mean HWP Easy bundles every listed resource. The current build copies no standalone upstream font files or web-editor resources; this statement is not an audit of resources embedded inside WASM. Before general redistribution, review the actual compiled/transitive dependencies and embedded resources and preserve all applicable notices. The current notice bundle is not a complete WASM SBOM or legal-compliance certification.

The Python wheel contains our adapter and bridge, not the npm runtime or a Hancom engine. Optional Python SDK/library and Node runtime distributions retain their own licenses. No Hancom engine, security DLL or format manual is redistributed by this repository. This notice does not relicense the repository.

## Synthetic Worker dependencies

The Worker guard uses `pako` **3.0.2**, pinned by `probes/sites-runtime/package-lock.json`, for low-level bounded raw-DEFLATE. Its declared license is `MIT AND Zlib`. Source provenance is `32be8f8e0ead1e6e8a74a1586a34f84734382d01` in [nodeca/pako](https://github.com/nodeca/pako/tree/32be8f8e0ead1e6e8a74a1586a34f84734382d01). The build copies the npm MIT license and the unchanged [pinned inflater Zlib notice](https://github.com/nodeca/pako/blob/32be8f8e0ead1e6e8a74a1586a34f84734382d01/src/zlib/inflate.mjs) into the deployment artifact. HWP Easy authors the surrounding validation adapter, not the inflater.

`cfb` **1.2.2** is a dev-only synthetic fixture writer under Apache-2.0. It is not imported by the deployed Worker, used as its production reader, or bundled as a runtime dependency. Drizzle generates development schemas/migrations, and esbuild and Miniflare are build/test dependencies; their package license notices remain applicable. These JavaScript packages are distinct from similarly named Rust crates that upstream may compile into WASM.

## Build-time notice checks

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
