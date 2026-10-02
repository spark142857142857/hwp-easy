# Third-party engine notices

This source repository depends on `@rhwp/core` **0.8.6**, pinned by `package-lock.json`. The npm package provides the HWP parser, writer and SVG renderer reused by the native adapter. It is not an engine authored by HWP Easy.

- Upstream: [edwardkim/rhwp](https://github.com/edwardkim/rhwp)
- npm source provenance: `e8800c8def63449808a4092798442652ed460552`
- Package integrity: `sha512-ZMO2QMHbR4v7t86feMWiRJ4QozjjqHDGv4PyzTT4LyMuX1LeUpmQaOHrGLQpbYMJV0IWCYjVRewKqkXx+w16XQ==`
- Upstream [license at that revision](https://github.com/edwardkim/rhwp/blob/e8800c8def63449808a4092798442652ed460552/LICENSE) and [additional dependency/resource notices](https://github.com/edwardkim/rhwp/blob/e8800c8def63449808a4092798442652ed460552/THIRD_PARTY_LICENSES.md).

The native release tag with the same version number is not assumed to be the npm artifact's source revision. Upstream fonts, external rendering resources and documentation are not bundled here. Any future redistribution of a WASM/runtime/font package must preserve the applicable licenses and review all included dependencies and resources. This notice is not a complete notice bundle for a future installer or hosted service.

The Python wheel contains our adapter and bridge, not the npm runtime or a Hancom engine. Optional Python SDK/library and Node runtime distributions retain their own licenses. No Hancom engine, security DLL or format manual is redistributed by this repository. This notice does not relicense the repository.

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
