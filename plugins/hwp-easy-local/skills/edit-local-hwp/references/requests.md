# Agent request format

Invoke the bundled `scripts/local-runner.mjs` with `--request <absolute JSON file>`. All responses are JSON: `{ "ok": true, "result": {...} }` or `{ "ok": false, "error": "FIXED_CODE", "save_confirmed": false }`. Process timeout is 60 seconds. Inputs and saved outputs are limited to 4 MiB; normal model limits still apply. The runner performs no network requests.

Use absolute filesystem paths. The examples below use placeholders, not executable example documents. Unknown fields and operations are rejected.

```json
{"action":"capabilities"}
```

```json
{"action":"read","source":"<selected absolute HWP path>","max_chars":64000,"max_blocks":128}
```

Pass returned `source_sha256` and `next_cursor` to continue. Each block includes `target_id`, full or fragmented `text`, `editable`, kind and coordinates. Assemble all fragments for `expected_old`. Row/column indexes are zero-based, spans are counts; cell indexes are not necessarily row-times-column.

`structural_editable` identifies a uniform-style structural candidate, including a target with existing LF line breaks. It still requires serialization preflight. `editable` retains the existing nonstructural engine profile.

```json
{"action":"plan","source":"<selected path>","expected_sha256":"<read hash>","operations":[{"type":"replace_text","target_id":"<returned target ID>","expected_old":"<whole old text>","new_text":"New answer"}]}
```

Change `action` to `edit` to save. `replace_text` with `\n` creates real paragraphs on a supported uniform-style target. CR characters are rejected rather than silently normalized. Nonstructural replacement supports the existing raw-verified text profile, including its constrained mixed-style replacement and empty-cell checks.

```json
{"action":"edit","source":"<selected path>","expected_sha256":"<read hash>","operations":[{"type":"insert_paragraphs","target_id":"<body paragraph ID>","expected_old":"<whole old text>","paragraphs":["First new paragraph","Second new paragraph"]}]}
```

```json
{"action":"edit","source":"<selected path>","expected_sha256":"<read hash>","operations":[{"type":"create_table","target_id":"<body paragraph ID>","expected_old":"<whole old text>","cells":[["Name","Synthetic name"],["Answer","Synthetic answer"]]}]}
```

Paragraphs and tables are inserted **after** the selected body paragraph, including an empty paragraph. Structural targets require a uniform character style. Table creation inserts a rectangular table plus a following empty caret paragraph; maximum 50 rows/columns and 256 cells. New paragraphs: at most 100 and total 100,000 UTF-16 units. Structural operations cannot share a batch. Verified page-number controls are preserved as opaque bytes; this does not make semantic reading complete.

Delete a plain body paragraph, or a cell paragraph after the first. A paragraph carrying section, page, table or other extended controls cannot be deleted. Merging requires the selected paragraph and its immediate predecessor to have matching paragraph/character styles. Text is concatenated without an added separator.

```json
{"action":"edit","source":"<selected path>","expected_sha256":"<hash>","operations":[{"type":"delete_paragraph","target_id":"<paragraph ID>","expected_old":"<whole old text>"}]}
```

```json
{"action":"edit","source":"<selected path>","expected_sha256":"<hash>","operations":[{"type":"merge_paragraph","target_id":"<second paragraph ID>","expected_old":"<second text>","previous_target_id":"<first paragraph ID>","expected_previous":"<first text>"}]}
```

Change an existing rectangular table through one of its actual cell targets. `index` is the inserted row/column position (0 through the current count), or deleted position (0 through count minus one). Inserted `texts` has one string per new cell, in column order for a row or row order for a column. Deleted `expected_cells` has one array of full paragraph texts per removed cell, in the same order. The last row/column cannot be removed.

```json
{"action":"edit","source":"<selected path>","expected_sha256":"<hash>","operations":[{"type":"insert_table_row","target_id":"<cell ID>","expected_old":"<cell text>","index":1,"texts":["New A","New B"]}]}
```

```json
{"action":"edit","source":"<selected path>","expected_sha256":"<hash>","operations":[{"type":"delete_table_column","target_id":"<cell ID>","expected_old":"<cell text>","index":1,"expected_cells":[["Top paragraph 1","Top paragraph 2"],["Bottom paragraph"]]}]}
```

`insert_table_column` and `delete_table_row` use the corresponding schemas. This profile requires unmerged cells, row-major storage, plain uniform-style cell paragraphs and supported uniform table geometry. Retained cell metadata stays exact except requested coordinates; the table grows/shrinks along the changed axis. Arbitrary merged tables, mixed-style restructuring, nested objects and general page-layout editing remain unsupported.

Save As adds `output` to an edit only when the user requests it. If that output exists, also provide `expected_output_sha256` from a read of that exact destination.

```json
{"action":"preview","source":"<selected path>","expected_sha256":"<read hash>","page":0}
```

Preview returns passive SVG in memory. Write a preview file only when useful and authorized by the task; do not upload it automatically.

```json
{"action":"restore","source":"<selected path>","expected_sha256":"<current hash>","backup_id":"<returned recovery ID>"}
```

Successful saves return `saved_path`, `save_mode`, `selected_file_updated`, `output_sha256` and a `backup_id` for any replaced version. `file_location` is always the current execution environment; the runner does not infer a link between an attachment and the original PC path. Restoring creates another backup. The script lock prevents cooperating HWP Easy saves from overlapping; version checks detect ordinary external changes. Unrelated programs do not participate in that lock. A crash can leave a lock requiring deliberate inspection; never delete it merely to force a retry.

This package edits the file in the **current execution environment**. In Codex Cloud, that is the Cloud file, not a automatically synchronized PC file. Local file access and public-directory acceptance are separate from package execution tests.
