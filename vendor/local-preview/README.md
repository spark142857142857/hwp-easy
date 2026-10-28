# Local preview resources

`NanumGothic-Regular.ttf` is an unchanged Korean fallback font from [Google Fonts at revision 133ccbee9a8b408eb71f31a36ccb9116f5c695ad](https://github.com/google/fonts/tree/133ccbee9a8b408eb71f31a36ccb9116f5c695ad/ofl/nanumgothic). Its [SIL OFL license](OFL.txt) is retained. The font is read only by the local thumbnail renderer; it is never installed or written into document font definitions.

The portable SVG renderer is `@resvg/resvg-wasm` 2.6.2, pinned in the root npm lockfile. Its unchanged [MPL-2.0 license](RESVG-LICENSE.txt) accompanies the binary and bundled glue. Corresponding source is available from [resvg-js v2.6.2](https://github.com/thx/resvg-js/tree/v2.6.2); HWP Easy does not modify that source. Resource and notice digests are checked by [the local build helper](../../scripts/lib/local-preview-notices.mjs).

HWP preview stream formats follow [Hancom HWP 5.0 revision 1.3, sections 3.2.6–3.2.7](https://cdn.hancom.com/link/docs/%ED%95%9C%EA%B8%80%EB%AC%B8%EC%84%9C%ED%8C%8C%EC%9D%BC%ED%98%95%EC%8B%9D_5.0_revision1.3.pdf). 본 제품은 한컴의 HWP 문서 파일(.hwp) 공개 문서를 참고하여 개발하였습니다.
