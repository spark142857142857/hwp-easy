// Public metadata only. Authentication and per-document ownership stay separate.
export const challengePath = '/.well-known/openai-apps-challenge';

export function domainChallengeResponse(request, token) {
  if (new URL(request.url).pathname !== challengePath) return null;
  const headers = { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff' };
  // Fail closed for absent/malformed configuration. Never echo request values.
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{16,256}$/.test(token)) {
    return new Response('Not found', { status: 404, headers });
  }
  if (!['GET', 'HEAD'].includes(request.method)) {
    return new Response(null, { status: 405, headers: { ...headers, Allow: 'GET, HEAD' } });
  }
  return new Response(request.method === 'HEAD' ? null : token, { headers });
}

export function documentSignInResponse(request) {
  const url = new URL(request.url);
  if (url.pathname !== '/documents' || !['GET', 'HEAD'].includes(request.method)
    || !request.headers.get('Accept')?.includes('text/html')) return null;
  // A fixed same-origin return path prevents caller-controlled redirect URLs.
  const html = `<!doctype html><html lang="ko"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>HWP Easy 로그인</title>
<style>body{margin:0;background:#f6f7f6;color:#172523;font:17px/1.7 system-ui,sans-serif}
main{max-width:480px;margin:12vh auto;padding:32px}h1{font-size:32px;margin:0 0 20px}
p{margin:0 0 24px}.login{display:inline-block;padding:12px 20px;background:#245c57;color:white;
border-radius:8px;text-decoration:none}.policy{margin-top:32px;font-size:14px}a{color:#245c57}
</style><main><h1>HWP Easy</h1><p>HWP 양식을 올리고 필요한 칸을 수정하세요.<br>
문서를 열려면 ChatGPT 계정으로 로그인해 주세요.</p>
<a class="login" href="/signin-with-chatgpt?return_to=%2Fdocuments" target="_top">ChatGPT로 로그인</a>
<p class="policy"><a href="https://github.com/spark142857142857/hwp-easy/blob/main/docs/privacy-policy.md">개인정보처리방침</a>
 · <a href="https://github.com/spark142857142857/hwp-easy/blob/main/docs/terms-of-service.md">이용약관</a></p></main></html>`;
  return new Response(request.method === 'HEAD' ? null : html, { status: 401, headers: {
    'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  } });
}
