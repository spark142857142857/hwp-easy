import { StorageError } from '../storage/store.mjs';
import { configuredOrigin } from './transfer.mjs';
import { installHandoff } from './handoff-client.mjs';

export const HANDOFF_SCRIPT = '/documents/handoff-client.js';
export function handoffRequest(origin, document_id, version_id) {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  if (!uuid.test(document_id) || !uuid.test(version_id)) throw new StorageError('INVALID_IDENTIFIER');
  const link = `${configuredOrigin(origin)}/documents/${document_id}/versions/${version_id}/view`;
  return `HWP Easy로 아래 저장본의 지원하는 내용을 끝까지 읽고 구조와 내용을 요약해줘. 읽지 못한 부분이 있으면 알려줘. 다른 버전으로 바꾸지 말고, 파일은 수정하거나 저장하지 마.\n\n보기 링크: ${link}\n문서 ID: ${document_id}\n버전 ID: ${version_id}`;
}
export function handoffScriptResponse(request) {
  const url = new URL(request.url);
  const headers = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'" };
  if (url.pathname !== HANDOFF_SCRIPT || url.search)
    throw new StorageError('INVALID_VIEWER_REQUEST');
  if (request.method !== 'GET') return new Response(null, { status: 405, headers: { ...headers, Allow: 'GET' } });
  if (request.body || request.headers.has('Range')) throw new StorageError('INVALID_VIEWER_REQUEST');
  return new Response(`(${installHandoff.toString()})(globalThis);`, {
    headers: { ...headers, 'Content-Type': 'text/javascript; charset=utf-8' },
  });
}
