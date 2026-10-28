// Authenticated fixed-fixture browser diagnostic. Never reads/writes storage,
// accepts a document/path/file argument, or changes any upload/MCP policy.
import { authenticatedOwner } from './transfer.mjs';
import { transferFixture, verifyTransferFixture } from './synthetic-transfer.mjs';
import { createDocumentEngine } from '../../../src/one_hwp/engine/document.mjs';

export const SYNTHETIC_DOWNLOAD_BYTES = 13312;
export const SYNTHETIC_DOWNLOAD_SHA256 = '1d3f1472a2637a5fed2672109de946843acd07034756a4273b7fcd43ef159286';
export const SYNTHETIC_DOWNLOAD_NAME = 'hwp-easy-synthetic-edited.hwp';
const pagePath = '/diagnostics/download', filePath = '/diagnostics/synthetic-result.hwp';
const commonHeaders = {
  'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
};
const errorResponse = (error, status, headers = {}) => Response.json({ error }, {
  status, headers: { ...commonHeaders, ...headers },
});

export async function verifySyntheticDownload(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length !== SYNTHETIC_DOWNLOAD_BYTES) throw new Error('SYNTHETIC_OUTPUT_MISMATCH');
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const sha256 = [...new Uint8Array(digest)].map((n) => n.toString(16).padStart(2, '0')).join('');
  if (sha256 !== SYNTHETIC_DOWNLOAD_SHA256) throw new Error('SYNTHETIC_OUTPUT_MISMATCH');
}
export async function syntheticDownloadBytes(HwpDocument) {
  const source = transferFixture(HwpDocument);
  await verifyTransferFixture(source);
  const engine = createDocumentEngine(HwpDocument), before = await engine.open(source);
  const read = before.read({ expected_sha256: before.source_sha256 });
  const targets = ['paragraph', 'cell'].map((kind) => read.blocks.find((b) => b.kind === kind && b.editable && b.text));
  if (!read.complete || !targets.every(Boolean)) throw new Error('SYNTHETIC_OUTPUT_MISMATCH');
  const result = await before.edit({ expected_sha256: before.source_sha256,
    operations: targets.map((b, i) => ({ target_id: b.target_id, expected_old: b.text, new_text: `인증 범위 합성 편집 ${i} 😀` })) });
  if (!result.content_verified || !result.raw_preservation_verified || result.saved !== false) throw new Error('SYNTHETIC_OUTPUT_MISMATCH');
  const reopened = await engine.open(result.bytes);
  const after = reopened.read({ expected_sha256: reopened.source_sha256 });
  if (!after.complete || targets.some((b, i) => after.blocks.find((v) => v.id === b.id)?.text !== `인증 범위 합성 편집 ${i} 😀`)) {
    throw new Error('SYNTHETIC_OUTPUT_MISMATCH');
  }
  await verifySyntheticDownload(result.bytes);
  return result.bytes;
}
const page = `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>HWP Easy — 합성 다운로드 시험</title>
<style>
:root{font-family:system-ui,sans-serif;color:#172033;background:#f6f7f9;line-height:1.65}
body{margin:0;padding:48px 20px}main{max-width:680px;margin:auto;background:#fff;padding:36px;border:1px solid #dde2e8;border-radius:12px}
small{color:#526075}h1{font-size:28px;line-height:1.35;margin:8px 0 20px}p{margin:16px 0}
a{display:inline-block;background:#172033;color:#fff;border-radius:6px;padding:12px 20px;text-decoration:none;font-weight:600}
a:focus-visible{outline:3px solid #3578c5;outline-offset:4px}dl{padding:18px;background:#f6f7f9;border-radius:6px}
dt{font-weight:600}dd{margin:0 0 12px;overflow-wrap:anywhere}dd:last-child{margin-bottom:0}code{font-size:13px}
@media(max-width:480px){body{padding:20px 12px}main{padding:24px 20px}h1{font-size:24px}}
</style></head><body><main>
<small>HWP Easy · 비공개 개발 시험</small><h1>편집한 시험 HWP 내려받기</h1>
<p>개인정보가 없는 고정 합성 문서입니다. 문단과 표 셀을 수정한 결과를 HWP 그대로 내려받습니다. PDF·DOCX 변환은 하지 않습니다.</p>
<a href="${filePath}" download="${SYNTHETIC_DOWNLOAD_NAME}">시험 HWP 다운로드</a>
<dl><dt>파일 크기</dt><dd>${SYNTHETIC_DOWNLOAD_BYTES.toLocaleString('en-US')} 바이트</dd>
<dt>검증용 SHA-256</dt><dd><code>${SYNTHETIC_DOWNLOAD_SHA256}</code></dd></dl>
<p>이 화면은 로그인한 브라우저의 파일 수신만 시험합니다. 개인 문서 업로드, 저장된 사용자 문서의 다운로드, Codex Cloud·Dots 연결, 서식 정확성을 검증한 것은 아닙니다.</p>
<small>시험 파일은 요청 때 생성하며 문서 저장소에는 보관하지 않습니다. 세부 배치는 외부 HWP 뷰어에서 확인할 수 있습니다.</small>
</main></body></html>`;

export async function syntheticDownloadResponse(request, buildOutput) {
  try { await authenticatedOwner(request.headers); }
  catch { return errorResponse('AUTHENTICATION_REQUIRED', 401); }
  const url = new URL(request.url);
  if (![pagePath, filePath].includes(url.pathname)) return errorResponse('NOT_FOUND', 404);
  if (request.method !== 'GET') return errorResponse('METHOD_NOT_ALLOWED', 405, { Allow: 'GET' });
  if (url.search || request.body || request.headers.has('Range')) return errorResponse('NO_INPUT_ACCEPTED', 400);
  if (url.pathname === pagePath) return new Response(page, { headers: { ...commonHeaders, 'Content-Type': 'text/html; charset=utf-8' } });
  try {
    const bytes = await buildOutput();
    // Recheck the pin at the response boundary. Never return unverified bytes.
    await verifySyntheticDownload(bytes);
    return new Response(bytes, { headers: { ...commonHeaders, 'Content-Type': 'application/x-hwp',
      'Content-Length': String(bytes.length), 'Content-Disposition': `attachment; filename="${SYNTHETIC_DOWNLOAD_NAME}"` } });
  } catch { return errorResponse('SYNTHETIC_DOWNLOAD_UNAVAILABLE', 503); }
}

