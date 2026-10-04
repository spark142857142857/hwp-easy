const uuid = { type: 'string', pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' };
const hash = { type: 'string', pattern: '^[0-9a-f]{64}$' };
const object = (properties, required = Object.keys(properties)) => ({ type: 'object', properties, required, additionalProperties: false });
const version = { document_id: uuid, version_id: uuid };
const operation = object({ target_id: { type: 'string', maxLength: 256 },
  expected_old: { type: 'string', maxLength: 200000 }, new_text: { type: 'string', maxLength: 200000 } });
const edits = { expected_sha256: hash, operations: { type: 'array', items: operation, minItems: 1, maxItems: 100 } };
const file = object({ download_url: { type: 'string', maxLength: 8192 }, file_id: { type: 'string', maxLength: 256 },
  mime_type: { type: 'string', maxLength: 256 }, file_name: { type: 'string', maxLength: 512 } }, ['download_url', 'file_id']);
const resultSchema = object({ stage: { type: 'string', enum: ['private-development'] },
  data: { type: 'object', additionalProperties: true }, layout_verified: { type: 'boolean', const: false } });
const tool = (name, description, properties = {}, required, write = false, destructive = false) => ({ name,
  description, inputSchema: object(properties, required), outputSchema: resultSchema,
  annotations: { readOnlyHint: !write, destructiveHint: destructive, idempotentHint: true, openWorldHint: false } });
export const documentTools = [
  tool('hwp_capabilities', 'Check private-development HWP features, transfer gates and limits. No file changes.'),
  tool('hwp_import', 'Import an explicitly supplied HWP file into your remote document area. Requires upload enablement and a verified file host. Does not change the PC original.', {
    request_id: uuid, file,
  }, undefined, true),
  tool('hwp_transfer_probe', 'DIAGNOSTIC ONLY: supply ONLY the fixed file from make-transfer-fixture.mjs, never a personal HWP. With no separately verified diagnostic file host, inspect only the HTTPS origin without fetching. Once configured, receive at most 13312 bytes, require the server-pinned synthetic hash, test edit/save/reopen/restore, return edited synthetic HWP as embedded MCP bytes, and clean up. Does not enable general uploads or certify client download UI.', { file }, undefined, true),
  tool('hwp_read', 'Read a pinned HWP version, including paragraph/cell targets. Follow next_cursor until complete; report unsupported content.', {
    ...version, max_chars: { type: 'integer', minimum: 1, maximum: 64000 }, max_blocks: { type: 'integer', minimum: 1, maximum: 128 },
    cursor: object({ sha256: hash, block_index: { type: 'integer', minimum: 0 }, offset: { type: 'integer', minimum: 0 } }),
  }, ['document_id', 'version_id']),
  tool('hwp_plan', 'Validate version-bound targets, serialize and reopen in memory, and check content/raw preservation. Does not save any HWP or version; a later save still checks the current version.', { ...version, ...edits }),
  tool('hwp_edit', 'Apply validated edits and save the SAME remote document. Keeps earlier versions. Requires expected current version and exact-request retry ID; does not update the PC original.', {
    document_id: uuid, expected_version: uuid, request_id: uuid, ...edits,
  }, undefined, true, true),
  tool('hwp_versions', 'List versions and the explicitly marked current version of your document. Creation-time ties are not revision order. No file changes.', { document_id: uuid }),
  tool('hwp_restore', 'Restore your earlier HWP bytes as a NEW version of the SAME document. Requires current-version guard and request ID.', {
    document_id: uuid, expected_version: uuid, source_version: uuid, request_id: uuid,
  }, undefined, true, true),
  tool('hwp_delete', 'ONLY after an explicit user deletion request: irreversibly remove this logical document and its recorded versions. Requires current-version guard and exact-request retry ID. Unpublished/in-flight blob garbage collection is not certified.', {
    document_id: uuid, expected_version: uuid, request_id: uuid,
    confirmation: { type: 'string', pattern: '^delete_document_and_recorded_versions$' },
  }, undefined, true, true),
  tool('hwp_download', 'Retrieve your chosen immutable HWP version. Default delivery is a browser-sign-in link. Explicit delivery=embedded returns HWP bytes as an MCP resource, at most 256 KiB; larger files must use the link. Neither mode saves locally or certifies client attachment UI.', {
    ...version, delivery: { type: 'string', pattern: '^(link|embedded)$', maxLength: 8 },
  }, ['document_id', 'version_id']),
  tool('hwp_preview', 'Get an authenticated page SVG preview link. Layout fidelity is unverified; HWP remains the final document.', {
    ...version, page: { type: 'integer', minimum: 0, maximum: 9999 },
  }),
  tool('hwp_workflow_probe', 'Create, read, plan, edit, retrieve and restore ONLY a built-in synthetic HWP under the signed-in user scope, then clean up that generated document. No personal file input.', {}, undefined, true),
];
for (const name of ['hwp_import', 'hwp_transfer_probe']) {
  documentTools.find((t) => t.name === name)._meta = { 'openai/fileParams': ['file'] };
  documentTools.find((t) => t.name === name).annotations.openWorldHint = true;
}
export function validateArguments(name, args) {
  const schema = documentTools.find((t) => t.name === name)?.inputSchema;
  const valid = (value, s) => {
    if (s.type === 'object') return value && typeof value === 'object' && !Array.isArray(value)
      && Object.keys(value).every((k) => Object.hasOwn(s.properties, k))
      && s.required.every((k) => Object.hasOwn(value, k))
      && Object.entries(value).every(([k, v]) => valid(v, s.properties[k]));
    if (s.type === 'array') return Array.isArray(value) && value.length >= (s.minItems ?? 0)
      && value.length <= (s.maxItems ?? 100) && value.every((v) => valid(v, s.items));
    if (s.type === 'integer') return Number.isSafeInteger(value) && value >= s.minimum && value <= (s.maximum ?? Number.MAX_SAFE_INTEGER);
    return typeof value === 'string' && value.length <= (s.maxLength ?? 8192) && (!s.pattern || new RegExp(s.pattern).test(value));
  };
  return !!schema && !!valid(args, schema);
}
