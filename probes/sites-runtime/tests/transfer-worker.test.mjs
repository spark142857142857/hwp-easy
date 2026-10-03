// Actual workerd timer/stream semantics, not simulated OAuth or personal input.
import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

test('workerd bounds stalled transfers and never-settling cancel hooks', { timeout: 30000 }, async () => {
  const bundle = await build({ stdin: { contents: `
    import { boundedBytes, fetchInputFile } from './host/transfer.mjs';
    export default { async fetch(request) {
      const scenario = new URL(request.url).pathname.slice(1);
      let cancelled = false, interval, body;
      const cancel = () => { cancelled = true; clearInterval(interval); return new Promise(() => {}); };
      if (scenario === 'normal') body = new ReadableStream({ start(c) { c.enqueue(new Uint8Array([1, 2])); c.close(); } });
      else if (scenario === 'trickle') body = new ReadableStream({
        start(c) { interval = setInterval(() => c.enqueue(new Uint8Array([1])), 5); }, cancel,
      });
      else if (scenario === 'overflow') body = new ReadableStream({ start(c) { c.enqueue(new Uint8Array(6)); }, cancel });
      else body = new ReadableStream({ cancel });
      try {
        if (scenario === 'failed-fetch') await fetchInputFile({ file_id: 'synthetic', download_url: 'https://files.example.invalid/file' },
          '["https://files.example.invalid"]', async () => new Response(body, { status: 403 }));
        else {
          const bytes = await boundedBytes(body, scenario === 'trickle' ? 1000 : 5, scenario === 'declared-overflow' ? '6' : null, 30);
          return Response.json({ bytes: bytes.length, locked: body.locked });
        }
      } catch (error) { return Response.json({ error: error.code, cancelled, locked: body.locked }); }
      finally { clearInterval(interval); }
    } };
  `, resolveDir: process.cwd(), sourcefile: 'synthetic-transfer-worker.mjs' },
    bundle: true, format: 'esm', platform: 'browser', target: 'es2022', write: false });
  const runtime = new Miniflare(convertV4MiniflareOptions({ compatibilityDate: '2026-10-01',
    modules: true, script: bundle.outputFiles[0].text }));
  try {
    const scenarios = [['stall', 'TRANSFER_TIMEOUT'], ['trickle', 'TRANSFER_TIMEOUT'],
      ['overflow', 'TRANSFER_LIMIT_EXCEEDED'], ['declared-overflow', 'TRANSFER_LIMIT_EXCEEDED'],
      ['failed-fetch', 'FILE_FETCH_FAILED']];
    for (const [scenario, expected] of scenarios) {
      const response = await runtime.dispatchFetch('https://transfer.invalid/' + scenario);
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { error: expected, cancelled: true, locked: false }, scenario);
    }
    assert.deepEqual(await (await runtime.dispatchFetch('https://transfer.invalid/normal')).json(), { bytes: 2, locked: false });
  } finally { await runtime.dispose(); }
});
