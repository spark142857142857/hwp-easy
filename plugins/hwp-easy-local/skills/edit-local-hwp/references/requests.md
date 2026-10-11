# Agent request format

`move_paragraph` moves a plain body paragraph, and `move_table` moves the complete table selected by an actual cell target. Both take `target_id`, `expected_old`, `after_target_id` (a body paragraph in the same section) and `expected_after` (its full text). The first body group and tables grouped with section settings there stay in place. Styles, cell geometry and supported cell pictures travel as complete raw groups. Moving a group already immediately after its anchor is unchanged. No-op same-file edits return `saved:false, unchanged:true, save_required:false`; explicit Save As still writes the requested result.

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

`text_range_editable` identifies a plain-text range candidate, including mixed character styles and empty paragraphs. Preflight still checks raw controls. Use `splice_text` to insert (`start == end`), delete (empty `new_text`) or replace a range of Unicode code points. An emoji counts as one point. Retained characters keep their exact styles; replacement inherits the first removed character, and pure insertion inherits the left neighbour (the first character at paragraph start). LF in the new text creates actual HWP paragraphs, retaining the original paragraph properties and prefix/suffix character styles. At most 100 resulting paragraphs and 100,000 UTF-16 units are permitted. Other controls, CR and malformed surrogates are refused. Existing inline-control/LF targets remain outside this plain-range profile.

```json
{"action":"edit","source":"<path>","expected_sha256":"<hash>","operations":[{"type":"splice_text","target_id":"<ID>","expected_old":"<whole text>","start":2,"end":4,"new_text":"Longer replacement"}]}
```

Split a plain body/cell paragraph at a code-point offset while retaining mixed character runs on both sides. `offset` can be zero or the paragraph length, producing an empty paragraph. Adjacent plain mixed-style paragraphs can be merged when their paragraph properties match. Extended controls are refused for these mixed-style boundary operations.

```json
{"action":"edit","source":"<path>","expected_sha256":"<hash>","operations":[{"type":"split_paragraph","target_id":"<ID>","expected_old":"<whole text>","offset":3}]}
```

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

Paragraphs and tables are inserted **after** the selected body paragraph, including an empty paragraph. Structural targets require a uniform character style. Table creation inserts a rectangular table plus a following empty caret paragraph; maximum 50 rows/columns and 256 cells. New paragraphs: at most 100 and total 100,000 UTF-16 units. Supported structural operations can share a checked atomic batch. Verified page-number controls are preserved as opaque bytes; this does not make semantic reading complete.

Delete a plain body paragraph, or a cell paragraph after the first. A paragraph carrying section, page, table or other extended controls cannot be deleted. Merging requires the selected paragraph and its immediate predecessor to have matching paragraph styles; supported plain mixed character styles are retained. Text is concatenated without an added separator.

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

`insert_table_column` and `delete_table_row` use the corresponding schemas. The plain rectangular profile retains its uniform-geometry bounds. The merged profile checks a complete nonoverlapping grid, at most 512 rows, 128 columns and 4096 positions. A merged cell crossing an insertion expands; crossing a deletion shrinks and keeps its paragraphs. A cell covering only the deleted axis position is removed. Deleted `expected_cells` must include **all intersecting cells**, including retained merged cells, in storage order. Insert `texts` contains one slot per opposite-axis position; a slot covered by an expanded merged cell must be empty. Never omit requested text to satisfy this guard. New cells inherit a supported adjacent uniform style. Retained cells keep other metadata and paragraphs. Table size changes along the requested axis using adjacent stored geometry, preserving display-height scaling.

Split an existing merged cell into its original grid positions. Its full paragraph list stays in the top-left cell; other cells become empty. Merge requires the top-left cell target, a complete rectangle with no partially intersected merged cell, and every selected cell's full paragraph texts in storage order. Nonempty paragraphs from other cells are appended to the first cell; their empty paragraphs are removed. Exact selected edge dimensions are retained, including integer division remainders. The checked rectangle is limited to 256 grid positions. Nested objects, picture-bearing cell structural changes and arbitrary mixed-style restructuring remain unsupported.

```json
{"action":"edit","source":"<path>","expected_sha256":"<hash>","operations":[{"type":"split_table_cell","target_id":"<merged cell paragraph ID>","expected_old":"<target text>","expected_cells":[["First paragraph","Second paragraph"]]}]}
```

```json
{"action":"edit","source":"<path>","expected_sha256":"<hash>","operations":[{"type":"merge_table_cells","target_id":"<top-left cell ID>","expected_old":"<target text>","range":{"top":0,"left":0,"bottom":0,"right":1},"expected_cells":[["Left"],["Right"]]}]}
```

Formatting operations leave text unchanged and can share an atomic batch. `format_text` offsets are Unicode code points, end exclusive, with at most 100,000 points. Plain targets cannot contain tabs, LF or extended control slots. Supported properties: booleans `bold`, `italic`, `underline`, `strikethrough`; `fontSize` (100 HWP units per point, 100–72000); `textColor` (`#RRGGBB`); `fontFamily` (one trimmed font name, up to 100 UTF-16 units, no control characters or font-list separators). Font family applies to all seven language slots, reusing matching IDs or registering one verified name in all equally sized language tables. Partial language matches or unsupported font tables are refused. It does not install/embed fonts; installed fonts and visual rendering remain separate. Existing mixed character runs keep their other properties. Existing definitions remain byte-exact; newly referenced definitions equal the requested patches.

```json
{"action":"edit","source":"<path>","expected_sha256":"<hash>","operations":[{"type":"format_text","target_id":"<ID>","expected_old":"<whole text>","start":0,"end":4,"props":{"bold":true,"fontSize":1400,"textColor":"#123456"}}]}
```

`format_paragraph` properties: `alignment` (`justify`, `left`, `right`, `center`), `lineSpacing` (existing spacing type retained), `marginLeft`, `marginRight`, `indent`, `spacingBefore`, `spacingAfter`. Numeric properties use the engine's raw HWP units; model margins/indent are reported divided by 150 and spacing by 75, rounded to one decimal. Nonnegative numeric values have a 720000 ceiling, indent also permits down to -72000. This operation can target a supported body/cell paragraph without changing its character runs.

`read` returns complete `tables` with `table_metadata_complete=true`, table dimensions and properties, and each cell's coordinates, spans, properties and paragraph IDs. The remote engine does not enable this local metadata option by default.

`resize_table_columns` takes `widths` for every grid column; `resize_table_rows` takes `heights` for every grid row. Entries are integer HWP units, 100–720000, with a sum of at most 720000. Choose an actual cell target and its full expected text. Merged cells receive the sum across their span. Stored heights are minimum geometry; content can expand a rendered row. Metadata changes preserve text, pictures, raw definition streams and opaque header tails.

```json
{"action":"edit","source":"<path>","expected_sha256":"<hash>","operations":[{"type":"resize_table_columns","target_id":"<cell ID>","expected_old":"<cell text>","widths":[12000,30000]}]}
```

`format_cell` takes `props`: `paddingLeft`, `paddingRight`, `paddingTop`, `paddingBottom` (integer 0–65535), `applyInnerMargin` (boolean), `verticalAlign` (0 top, 1 center, 2 bottom). `format_table` accepts the four paddings and `cellSpacing` with the same integer bounds. Units are raw HWP units, 100 per point. All paragraphs of the selected cell share its metadata; cell pictures are preserved. Arbitrary nested tables and overlapping/incomplete grids are refused.

```json
{"action":"edit","source":"<path>","expected_sha256":"<hash>","operations":[{"type":"format_cell","target_id":"<cell ID>","expected_old":"<cell text>","props":{"verticalAlign":1,"applyInnerMargin":true,"paddingLeft":400,"paddingTop":200}}]}
```

```json
{"action":"edit","source":"<path>","expected_sha256":"<hash>","operations":[{"type":"format_paragraph","target_id":"<ID>","expected_old":"<whole text>","props":{"alignment":"center","lineSpacing":180}}]}
```

`read` also returns `pictures` with `target_id`, zero-based paragraph-local `picture_index`, full `properties` and `format` (`body_picture` or `cell_picture`), plus `picture_profile_supported`. Cell pictures also report `control`, `cell` and `cell_paragraph`. This profile verifies one section and up to 32 ungrouped pictures per plain body or top-level cell paragraph. Cell insertion stores an actual inline control in the selected cell. Insertion/replacement reads an explicitly selected absolute local `.png`, `.jpg` or `.jpeg` with its SHA-256, at most 1 MiB, dimensions up to 8192 and 16 million pixels. JPEG supports 8-bit baseline/progressive frames with one or three components; four-component, lossless and arithmetic coding are refused. PNG chunk checks and JPEG marker/scan framing do not fully decode raster data. Embedded bytes must exactly equal the selected image. Width/height are positive HWP units (100 per point), at most 720000. Offset is a code-point position. File links, extension/signature mismatches and changed image hashes are rejected.

```json
{"action":"edit","source":"<path>","expected_sha256":"<hash>","operations":[{"type":"insert_picture","target_id":"<plain body paragraph ID>","expected_old":"<whole text>","offset":0,"image":{"source":"<absolute PNG path>","expected_sha256":"<PNG hash>"},"width":7200,"height":3600}]}
```

```json
{"action":"edit","source":"<path>","expected_sha256":"<hash>","operations":[{"type":"update_picture","target_id":"<picture target ID>","expected_old":"<anchor paragraph text>","picture_index":1,"expected_properties":{},"props":{"rotationAngle":90,"cropLeft":75,"cropTop":75,"cropRight":150,"cropBottom":150}}]}
```

Replace the placeholder `{}` with the **complete current selected `pictures[].properties`** object. Update, replacement and deletion require `picture_index` when that paragraph has multiple pictures; with one picture it defaults to zero for compatibility. Insertion does not take `picture_index`: its code-point `offset` places the new anchor after any existing pictures at that visible position. Reread after insertion/deletion; picture indexes can change.

Update accepts width/height, `horzOffset`, `vertOffset`, `cropLeft`, `cropTop`, `cropRight`, `cropBottom` and `rotationAngle`. Offsets can be negative with absolute value at most 720000. Crop values are nonnegative integers, individually at most 720000, in **source-image HWP units, 75 per pixel**, not displayed-frame units. Left plus right must be less than current `sourceWidth`, and top plus bottom less than `sourceHeight`. Zero on all edges removes the crop. Rotation is an integer from -359 through 359 degrees; zero removes it. The serializer updates the bounding frame, center and matrices, preserving the frame center when rotation changes. Width/height changes resize an already rotated frame; if size and angle are supplied together, resizing is applied before rotation. `replace_picture` uses the same target/text/index/expected-properties schema and an `image` object instead of `props`:

```json
{"action":"edit","source":"<path>","expected_sha256":"<hash>","operations":[{"type":"replace_picture","target_id":"<body or cell picture ID>","expected_old":"<whole anchor text>","picture_index":1,"expected_properties":{},"image":{"source":"<absolute replacement JPEG path>","expected_sha256":"<image hash>"}}]}
```

Replacement retains frame size, position and rotation, uses the whole new image and keeps previous unused embedded bytes. `delete_picture` uses the same target/text/index/expected-properties schema with no `props`. It removes only the selected anchor and shape records, also retaining unused image bytes (`retained_unused_image_data=true`). These operations do not permanently purge sensitive data; recovery copies remain. Non-target objects, cell metadata and body records stay exact. A bounded local mini-stream extension may add at most one root sector and one miniFAT sector using existing FAT capacity; unsupported allocation changes are refused before saving. Grouped pictures, captions, structural changes to picture-bearing cells and general page-layout changes remain unsupported. The picture profile can be preserved through edits to other supported paragraphs/cells.

Save As adds `output` to an edit only when the user requests it. If that output exists, also provide `expected_output_sha256` from a read of that exact destination.

Up to 100 supported operations can share one plan/edit. All `target_id` and `previous_target_id` values belong to the initial source hash, including later steps. Verified structural remapping follows the same original paragraph through body/cell position changes, table-axis changes and moved paragraphs in merged cells. Expected text and picture properties refer to the state at that step: if an earlier step changed the same block, provide its new full text in the next step. New inserted blocks cannot be selected with an initial ID; reread in a separate request. Removed blocks produce `BATCH_TARGET_REMOVED`. Every step is checked in memory; failure leaves the selected file and recovery folder unchanged. The successful edit writes one result and one backup of the initial file. Mixed batches return `atomic_batch=true`, `operation_count` and per-step verification summaries. Existing replacement-only batches retain their optimized engine contract. Process time and file limits apply to the whole request.

```json
{"action":"preview","source":"<selected path>","expected_sha256":"<read hash>","page":0}
```

Preview returns passive SVG in memory. Write a preview file only when useful and authorized by the task; do not upload it automatically.

```json
{"action":"restore","source":"<selected path>","expected_sha256":"<current hash>","backup_id":"<returned recovery ID>"}
```

Successful saves return `saved_path`, `save_mode`, `selected_file_updated`, `output_sha256` and a `backup_id` for any replaced version. `file_location` is always the current execution environment; the runner does not infer a link between an attachment and the original PC path. Restoring creates another backup. The script lock prevents cooperating HWP Easy saves from overlapping; version checks detect ordinary external changes. Unrelated programs do not participate in that lock. A crash can leave a lock requiring deliberate inspection; never delete it merely to force a retry.

This package edits the file in the **current execution environment**. In Codex Cloud, that is the Cloud file, not a automatically synchronized PC file. Local file access and public-directory acceptance are separate from package execution tests.
