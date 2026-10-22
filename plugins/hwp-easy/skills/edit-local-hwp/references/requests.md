# Agent request format

Complex local documents return raw-order target IDs, recursive `cell_path` (each entry: `controlIndex`, `cellIndex`, `cellParaIndex`), `fields`, and `picture_groups`. All IDs remain tied to the source hash.

Repeated names require the exact field ID; `expected_old` is the field value for `set_field`, and the full host block text for group operations. `replace_text`/`splice_text` on mapped ordinary or nested cell text preserve controls and mixed raw styles.

LF in these operations or `set_field` stores HWP character 10 line breaks inside the existing paragraph, preserving its paragraph count and anchors. Empty lines and up to 100 lines per inserted value are supported; CR, tab and other control inputs and ranges consuming anchors are refused.

No-op field/text edits leave bytes, timestamps and recovery storage unchanged. The complex profile refuses paragraph boundary changes; verified rectangular table axes use the bounded raw path described below. Verified character and paragraph formatting can append or reuse derived definitions while retaining existing definitions exactly.

Complex blocks expose `text_mapping_verified`; unverified blocks have no edit target. Opaque headers/footers/textboxes and unsupported drawing groups can coexist with proven body/cell targets, without becoming readable or editable themselves.

Complex `format_paragraph` requires a block's `paragraph_format_editable:true` and whole `expected_old` text. Properties are `alignment` (`justify`, `left`, `right`, `center`), `lineSpacing` (integer stored value, 1–720000), `marginLeft`, `marginRight`, `spacingBefore`, `spacingAfter` (integer raw HWP units, 0–720000), and `indent` (raw HWP units, −72000–720000). **Complex margins/spacing use stored HWP units (100 per point)**; do not apply the ordinary model's doubled-margin scaling. The existing line-spacing type is retained, so read the document's properties rather than assuming every stored value is a percentage. Read `paragraph_properties` for the original stored values. Field IDs and group IDs cannot select paragraph formatting.

Plan/edit results include `verified_edit_sha256`: the SHA-256 of the verified candidate before derived preview-cache refresh. Compare this value to confirm the same edit; `output_sha256` identifies the actual delivered bytes after preview refresh. If the bounded renderer succeeds in one request and times out in another, their preview streams and output hashes can differ while the verified edit matches. Keep source/version checks and exact recovery unchanged.

Changed plan/edit results include `preview_cache`. `updated` means a bounded UTF-16 excerpt and first-page BMP were regenerated from the checked candidate; `text_updated_image_unavailable` means the stale image was cleared after bounded rendering failed. The preview cache is derived data and does not certify page layout. No-op edits and exact recovery preserve the prior caches.

```json
{"action":"edit","source":"<path>","expected_sha256":"<hash>","operations":[{"type":"set_field","target_id":"<returned field target>","expected_old":"<old field value>","new_text":"New value"}]}
```

```json
{"action":"edit","source":"<path>","expected_sha256":"<hash>","operations":[{"type":"move_picture_group","target_id":"<returned group target>","expected_old":"<whole host text>","expected_properties":{"width":7200,"height":3600,"horzOffset":0,"vertOffset":0},"props":{"horzOffset":500,"vertOffset":200}}]}
```

For `crop_group_picture`, use its group's target ID and the returned zero-based leaf `picture_index`. `expected_properties` is that child's full properties excluding `picture_index`: `rotationAngle`, `sourceWidth`, `sourceHeight`, `cropLeft`, `cropTop`, `cropRight`, `cropBottom`.

`props` contains one or more of the crop amounts, in original-image HWP units (75 per source pixel). The crop must leave a positive width and height. Group transformations and sibling image bytes are retained. Group resize/rotation and child image replacement are refused.

`move_paragraph` moves a plain body paragraph, and `move_table` moves the complete table selected by an actual cell target. Both take `target_id`, `expected_old`, `after_target_id` (a body paragraph in the same section) and `expected_after` (its full text).

The first body group and tables grouped with section settings there stay in place. Styles, cell geometry and supported cell pictures travel as complete raw groups. Moving a group already immediately after its anchor is unchanged.

No-op same-file edits return `saved:false, unchanged:true, save_required:false`; explicit Save As still writes the requested result.

Invoke the bundled `scripts/local-runner.mjs` with `--request <absolute JSON file>`. All responses are JSON: `{ "ok": true, "result": {...} }` or `{ "ok": false, "error": "FIXED_CODE", "save_confirmed": false }`.

Process timeout is 60 seconds. Inputs and saved outputs are limited to 4 MiB; normal model limits still apply. The runner performs no network requests.

Use absolute filesystem paths. The examples below use placeholders, not executable example documents. Unknown fields and operations are rejected.

```json
{"action":"capabilities"}
```

```json
{"action":"read","source":"<selected absolute HWP path>","max_chars":64000,"max_blocks":128}
```

Pass returned `source_sha256` and `next_cursor` to continue. Each block includes `target_id`, full or fragmented `text`, `editable`, kind and coordinates. Assemble all fragments for `expected_old`. Row/column indexes are zero-based, spans are counts; cell indexes are not necessarily row-times-column.

`structural_editable` identifies a uniform-style structural candidate, including a target with existing LF line breaks. It still requires serialization preflight. `editable` retains the existing nonstructural engine profile.

Outside `complex_profile`, `text_range_editable` identifies a plain-text range candidate, including mixed character styles and empty paragraphs. It excludes raw section/table/drawing anchors even when the visible text looks plain.

A supported anchored title can still allow `editable:true` and a checked single-line `replace_text`. Preflight still checks raw controls. Use `splice_text` to insert (`start == end`), delete (empty `new_text`) or replace a range of Unicode code points. An emoji counts as one point.

Retained characters keep their exact styles; replacement inherits the first removed character, and pure insertion inherits the left neighbour (the first character at paragraph start). LF in the new text creates actual HWP paragraphs, retaining the original paragraph properties and prefix/suffix character styles.

At most 100 resulting paragraphs and 100,000 UTF-16 units are permitted. Other controls, CR and malformed surrogates are refused. Existing inline-control/LF targets remain outside this plain-range profile.

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

Paragraphs and tables are inserted **after** the selected body paragraph, including an empty paragraph. Structural targets require a uniform character style. Table creation inserts a rectangular table plus a following empty caret paragraph; maximum 50 rows/columns and 256 cells.

New paragraphs: at most 100 and total 100,000 UTF-16 units. Supported structural operations can share a checked atomic batch. Verified page-number controls are preserved as opaque bytes; this does not make semantic reading complete.

Duplicate a plain body/cell paragraph immediately after itself with `duplicate_paragraph`. It retains the complete text, mixed character runs and paragraph properties; empty paragraphs are supported.

The new paragraph has its own verified engine instance value. Confirm the full old text; the source is limited to 100,000 UTF-16 units and cannot contain hidden controls, tabs or LF. Read again to select the newly created paragraph.

The original target remains usable inside the current batch.

```json
{"action":"edit","source":"<selected path>","expected_sha256":"<hash>","operations":[{"type":"duplicate_paragraph","target_id":"<paragraph ID>","expected_old":"<whole old text>"}]}
```

`history` is read only: provide the selected path and current file hash to obtain up to 50 verified recovery entries (default 10). Each entry includes its backup ID, hash, size, recorded time, time source and whether it matches the current bytes.

Other selected paths are excluded, and corrupt, missing or linked backup payloads are omitted. `more_available` means additional candidates were not checked/returned. The finite scan allows 2,048 directory entries and at most 100 payload checks.

Old format-one metadata uses its file modification time; recorded dates can be changed locally and are not an immutable edit log. This operation creates no recovery directory and never restores automatically.

```json
{"action":"history","source":"<selected path>","expected_sha256":"<current hash>","limit":10}
```

Restore a chosen entry only for the user's requested undo/recovery. Restore verifies the selected path, current version and backup bytes, and preserves the replaced current version as another recovery copy. A recovery history listing is not a cursor-based chronological undo stack.

`find` searches exact case-sensitive text within supported body/cell blocks without saving. It returns version-bound target IDs, Unicode code-point start/end offsets and short excerpts with their offsets.

Query text is 1–256 UTF-16 units, well formed and without control characters; it is literal rather than regex or Unicode-normalized. Separate paragraphs/cells do not join into one match. Results do not overlap and paginate with `max_matches` (default 50, maximum 200).

Follow `next_cursor` with the same file hash and query; `complete` covers the supported block search only, and `all_content_supported` separately reports whether other document content is unsupported. A cursor is a validated position, not authorization.

Read the full matched block before editing; a search result is not proof of editability.

```json
{"action":"find","source":"<selected path>","expected_sha256":"<current hash>","query":"<literal text>","max_matches":50}
```

For several requested replacements in one paragraph, use the matched code-point ranges in descending order in one atomic batch, updating that paragraph's `expected_old` after each step. This preserves the original earlier ranges. Confirm the intended occurrence scope when the wording is ambiguous.

Delete a plain body paragraph, or a cell paragraph after the first; supported mixed character styles are allowed. A paragraph carrying section, page, table or other extended controls cannot be deleted.

Merging requires the selected paragraph and its immediate predecessor to have matching paragraph styles; supported plain mixed character styles are retained. Text is concatenated without an added separator.

```json
{"action":"edit","source":"<selected path>","expected_sha256":"<hash>","operations":[{"type":"delete_paragraph","target_id":"<paragraph ID>","expected_old":"<whole old text>"}]}
```

```json
{"action":"edit","source":"<selected path>","expected_sha256":"<hash>","operations":[{"type":"merge_paragraph","target_id":"<second paragraph ID>","expected_old":"<second text>","previous_target_id":"<first paragraph ID>","expected_previous":"<first text>"}]}
```

Change an existing rectangular table through one of its actual cell targets. `index` is the inserted row/column position (0 through the current count), or deleted position (0 through count minus one).

Inserted `texts` has one string per new cell, in column order for a row or row order for a column. Deleted `expected_cells` has one array of full paragraph texts per removed cell, in the same order. The last row/column cannot be removed.

```json
{"action":"edit","source":"<selected path>","expected_sha256":"<hash>","operations":[{"type":"insert_table_row","target_id":"<cell ID>","expected_old":"<cell text>","index":1,"texts":["New A","New B"]}]}
```

```json
{"action":"edit","source":"<selected path>","expected_sha256":"<hash>","operations":[{"type":"delete_table_column","target_id":"<cell ID>","expected_old":"<cell text>","index":1,"expected_cells":[["Top paragraph 1","Top paragraph 2"],["Bottom paragraph"]]}]}
```

`insert_table_column` and `delete_table_row` use the corresponding schemas. The plain rectangular profile retains its uniform-geometry bounds. The merged profile checks a complete nonoverlapping grid, at most 512 rows, 128 columns and 4096 positions.

A merged cell crossing an insertion expands; crossing a deletion shrinks and keeps its paragraphs. A cell covering only the deleted axis position is removed. Deleted `expected_cells` must include **all intersecting cells**, including retained merged cells, in storage order.

Insert `texts` contains one slot per opposite-axis position; a slot covered by an expanded merged cell must be empty. Never omit requested text to satisfy this guard. New cells inherit a supported adjacent uniform style. Retained cells keep other metadata and paragraphs.

Table size changes along the requested axis using adjacent stored geometry, preserving display-height scaling.

Split an existing merged cell into its original grid positions. Its full paragraph list stays in the top-left cell; other cells become empty. Merge requires the top-left cell target, a complete rectangle with no partially intersected merged cell, and every selected cell's full paragraph texts in storage order.

Nonempty paragraphs from other cells are appended to the first cell; their empty paragraphs are removed. Exact selected edge dimensions are retained, including integer division remainders. The checked rectangle is limited to 256 grid positions.

Nested objects, picture-bearing cell structural changes and arbitrary mixed-style restructuring remain unsupported.

```json
{"action":"edit","source":"<path>","expected_sha256":"<hash>","operations":[{"type":"split_table_cell","target_id":"<merged cell paragraph ID>","expected_old":"<target text>","expected_cells":[["First paragraph","Second paragraph"]]}]}
```

```json
{"action":"edit","source":"<path>","expected_sha256":"<hash>","operations":[{"type":"merge_table_cells","target_id":"<top-left cell ID>","expected_old":"<target text>","range":{"top":0,"left":0,"bottom":0,"right":1},"expected_cells":[["Left"],["Right"]]}]}
```

Formatting operations leave text unchanged and can share an atomic batch. `format_text` offsets are Unicode code points, end exclusive, with at most 100,000 points. Plain targets cannot contain tabs, LF or extended control slots.

Supported properties: booleans `bold`, `italic`, `underline`, `strikethrough`; `fontSize` (100 HWP units per point, 100–72000); `textColor` (`#RRGGBB`); `fontFamily` (one trimmed font name, up to 100 UTF-16 units, no control characters or font-list separators).

Font family applies to all seven language slots, reusing matching IDs or registering one verified name in all equally sized language tables. Partial language matches or unsupported font tables are refused. It does not install/embed fonts; installed fonts and visual rendering remain separate.

Existing mixed character runs keep their other properties. Existing definitions remain byte-exact; newly referenced definitions equal the requested patches.

```json
{"action":"edit","source":"<path>","expected_sha256":"<hash>","operations":[{"type":"format_text","target_id":"<ID>","expected_old":"<whole text>","start":0,"end":4,"props":{"bold":true,"fontSize":1400,"textColor":"#123456"}}]}
```

`format_paragraph` properties: `alignment` (`justify`, `left`, `right`, `center`), `lineSpacing` (existing spacing type retained), `marginLeft`, `marginRight`, `indent`, `spacingBefore`, `spacingAfter`.

Numeric properties use the engine's raw HWP units; model margins/indent are reported divided by 150 and spacing by 75, rounded to one decimal. Nonnegative numeric values have a 720000 ceiling, indent also permits down to -72000.

This operation can target a supported body/cell paragraph without changing its character runs.

`read` returns complete `tables` with `table_metadata_complete=true`, table dimensions and properties, and each cell's coordinates, spans, properties and paragraph IDs. The remote engine does not enable this local metadata option by default.

`resize_table_columns` takes `widths` for every grid column; `resize_table_rows` takes `heights` for every grid row. Entries are integer HWP units, 100–720000, with a sum of at most 720000.

Choose an actual cell target and its full expected text. Merged cells receive the sum across their span. Stored heights are minimum geometry; content can expand a rendered row.

Metadata changes preserve text, pictures, raw definition streams and opaque header tails.

```json
{"action":"edit","source":"<path>","expected_sha256":"<hash>","operations":[{"type":"resize_table_columns","target_id":"<cell ID>","expected_old":"<cell text>","widths":[12000,30000]}]}
```

`format_cell` takes `props`: `paddingLeft`, `paddingRight`, `paddingTop`, `paddingBottom` (integer 0–65535), `applyInnerMargin` (boolean), `verticalAlign` (0 top, 1 center, 2 bottom).

`format_table` accepts the four paddings and `cellSpacing` with the same integer bounds. Units are raw HWP units, 100 per point. All paragraphs of the selected cell share its metadata; cell pictures are preserved.

Arbitrary nested tables and overlapping/incomplete grids are refused.

```json
{"action":"edit","source":"<path>","expected_sha256":"<hash>","operations":[{"type":"format_cell","target_id":"<cell ID>","expected_old":"<cell text>","props":{"verticalAlign":1,"applyInnerMargin":true,"paddingLeft":400,"paddingTop":200}}]}
```

```json
{"action":"edit","source":"<path>","expected_sha256":"<hash>","operations":[{"type":"format_paragraph","target_id":"<ID>","expected_old":"<whole text>","props":{"alignment":"center","lineSpacing":180}}]}
```

`read` also returns `pictures` with `target_id`, zero-based paragraph-local `picture_index`, full `properties` and `format` (`body_picture` or `cell_picture`), plus `picture_profile_supported`. Cell pictures also report `control`, `cell` and `cell_paragraph`.

This profile verifies one section and up to 32 ungrouped pictures per plain body or top-level cell paragraph. Cell insertion stores an actual inline control in the selected cell.

Insertion/replacement reads an explicitly selected absolute local `.png`, `.jpg` or `.jpeg` with its SHA-256, at most 1 MiB, dimensions up to 8192 and 16 million pixels. JPEG supports 8-bit baseline/progressive frames with one or three components; four-component, lossless and arithmetic coding are refused.

PNG chunk checks and JPEG marker/scan framing do not fully decode raster data. Embedded bytes must exactly equal the selected image. Width/height are positive HWP units (100 per point), at most 720000. Offset is a code-point position. File links, extension/signature mismatches and changed image hashes are rejected.

```json
{"action":"edit","source":"<path>","expected_sha256":"<hash>","operations":[{"type":"insert_picture","target_id":"<plain body paragraph ID>","expected_old":"<whole text>","offset":0,"image":{"source":"<absolute PNG path>","expected_sha256":"<PNG hash>"},"width":7200,"height":3600}]}
```

```json
{"action":"edit","source":"<path>","expected_sha256":"<hash>","operations":[{"type":"update_picture","target_id":"<picture target ID>","expected_old":"<anchor paragraph text>","picture_index":1,"expected_properties":{},"props":{"rotationAngle":90,"cropLeft":75,"cropTop":75,"cropRight":150,"cropBottom":150}}]}
```

Replace the placeholder `{}` with the **complete current selected `pictures[].properties`** object.

Update, replacement and deletion require `picture_index` when that paragraph has multiple pictures; with one picture it defaults to zero for compatibility.

Insertion does not take `picture_index`: its code-point `offset` places the new anchor after any existing pictures at that visible position. Reread after insertion/deletion; picture indexes can change.

Update accepts width/height, `horzOffset`, `vertOffset`, `cropLeft`, `cropTop`, `cropRight`, `cropBottom` and `rotationAngle`. Offsets can be negative with absolute value at most 720000.

Crop values are nonnegative integers, individually at most 720000, in **source-image HWP units, 75 per pixel**, not displayed-frame units. Left plus right must be less than current `sourceWidth`, and top plus bottom less than `sourceHeight`. Zero on all edges removes the crop.

Rotation is an integer from -359 through 359 degrees; zero removes it. The serializer updates the bounding frame, center and matrices, preserving the frame center when rotation changes. Width/height changes resize an already rotated frame; if size and angle are supplied together, resizing is applied before rotation.

`replace_picture` uses the same target/text/index/expected-properties schema and an `image` object instead of `props`:

```json
{"action":"edit","source":"<path>","expected_sha256":"<hash>","operations":[{"type":"replace_picture","target_id":"<body or cell picture ID>","expected_old":"<whole anchor text>","picture_index":1,"expected_properties":{},"image":{"source":"<absolute replacement JPEG path>","expected_sha256":"<image hash>"}}]}
```

Replacement retains frame size, position and rotation, uses the whole new image and keeps previous unused embedded bytes. `delete_picture` uses the same target/text/index/expected-properties schema with no `props`.

It removes only the selected anchor and shape records, also retaining unused image bytes (`retained_unused_image_data=true`). These operations do not permanently purge sensitive data; recovery copies remain. Non-target objects, cell metadata and body records stay exact.

A bounded local mini-stream extension may add at most one root sector and one miniFAT sector using existing FAT capacity; unsupported allocation changes are refused before saving. Grouped pictures, captions, structural changes to picture-bearing cells and general page-layout changes remain unsupported.

The picture profile can be preserved through edits to other supported paragraphs/cells.

Save As adds `output` to an edit only when the user requests it. If that output exists, also provide `expected_output_sha256` from a read of that exact destination.

Up to 100 supported operations can share one plan/edit. All `target_id` and `previous_target_id` values belong to the initial source hash, including later steps. Verified structural remapping follows the same original paragraph through body/cell position changes, table-axis changes and moved paragraphs in merged cells.

Expected text and picture properties refer to the state at that step: if an earlier step changed the same block, provide its new full text in the next step. New inserted blocks cannot be selected with an initial ID; reread in a separate request. Removed blocks produce `BATCH_TARGET_REMOVED`.

Every step is checked in memory; failure leaves the selected file and recovery folder unchanged. The successful edit writes one result and one backup of the initial file. Mixed batches return `atomic_batch=true`, `operation_count` and per-step verification summaries.

Existing replacement-only batches retain their optimized engine contract. Process time and file limits apply to the whole request.

```json
{"action":"preview","source":"<selected path>","expected_sha256":"<read hash>","page":0}
```

Preview returns passive SVG in memory. Write a preview file only when useful and authorized by the task; do not upload it automatically.

```json
{"action":"restore","source":"<selected path>","expected_sha256":"<current hash>","backup_id":"<returned recovery ID>"}
```

Successful saves return `saved_path`, `save_mode`, `selected_file_updated`, `output_sha256` and a `backup_id` for any replaced version. `file_location` is always the current execution environment; the runner does not infer a link between an attachment and the original PC path. Restoring creates another backup.

The script lock prevents cooperating HWP Easy saves from overlapping; version checks detect ordinary external changes. Unrelated programs do not participate in that lock. A crash can leave a lock requiring deliberate inspection; never delete it merely to force a retry.

This package edits the file in the **current execution environment**. In Codex Cloud, that is the Cloud file, not a automatically synchronized PC file. Local file access and public-directory acceptance are separate from package execution tests.

## Complex character formatting (0.2.15)

`format_text` also accepts a body paragraph, recursively mapped cell or explicit ClickHere field in a `complex_profile`. The same seven character properties above are supported. Field targets use the entire field value for `expected_old`, and `start`/`end` are relative to that value.

Block targets use the whole block text and its code-point offsets. `blocks[].style.character_runs` reports whole-block ranges and model properties; subtract the field's returned `start` when comparing a field-relative selection. LF is eligible; tabs and ranges crossing field/table/drawing controls are refused.

Formatting a field via its explicit ID avoids consuming its anchors.

```json
{"action":"edit","source":"<path>","expected_sha256":"<hash>","operations":[{"type":"format_text","target_id":"<field target ID>","expected_old":"<whole field value>","start":0,"end":4,"props":{"bold":true,"fontSize":1200,"fontFamily":"함초롬바탕"}}]}
```

The local formatter retains every original character definition, adds only requested derived definitions, and updates the selected UTF-16 runs (both halves of an emoji). Other runs/control slots retain their IDs.

Existing fonts are reused; a new font is registered only when all seven language tables have equal counts and no partial match. Requested font changes apply to all language slots and do not install fonts. The selected line cache is invalidated.

CFB allocation may be rebuilt for definition growth; independent readers verify the exact stream set and all other packed stream bytes before a same-file save. A repeated byte-identical format request creates no backup.

Character formatting itself does not change table structure or create fields; the separately documented complex operations provide those bounded edits. External visual certification remains separate.

## Complex field and group operations

`insert_field` uses a body/cell block target, its whole `expected_old` text, zero-based code-point `offset`, `name` (1–128 characters), `guide` (up to 512), and `value` (up to 100,000 UTF-16 units / 100 LF lines). Names need not be unique; reread to obtain the created field ID. Insertion inside or on another field boundary is refused.

`delete_field` uses the explicit returned field target and its whole value as `expected_old`. It deletes the ClickHere wrapper, retaining its displayed value and character styles. Other field types/formulas are unsupported.

```json
{"type":"insert_field","target_id":"<block ID>","expected_old":"<whole block text>","offset":3,"name":"answer","guide":"Enter an answer","value":"First line\nSecond line"}
```

```json
{"type":"delete_field","target_id":"<field ID>","expected_old":"<whole field value>"}
```

Group operations use a returned group target and its host block's whole text as `expected_old`. `expected_properties` is the complete selected leaf object minus `picture_index`, including `rotationAngle`, source dimensions and crop. `replace_group_picture` requires the same local `image` object as ordinary picture replacement. It preserves transforms and resets crop; old unused image data is retained.

```json
{"type":"replace_group_picture","target_id":"<group ID>","expected_old":"<host text>","picture_index":1,"expected_properties":{"rotationAngle":0,"sourceWidth":4800,"sourceHeight":3000,"cropLeft":0,"cropTop":0,"cropRight":0,"cropBottom":0},"image":{"source":"<absolute PNG/JPEG path>","expected_sha256":"<image hash>"}}
```

`rotate_group_picture` accepts only `props.rotationAngle` (integer -359…359). It preserves the center and parent/sibling transforms. Nested parents and 1–9 transform pairs are supported with verified unscaled leaf geometry; rotated corners must fit the immediate parent's transformed coordinate frame. A failed plan never saves. Keep the group hierarchy intact.

```json
{"type":"rotate_group_picture","target_id":"<group ID>","expected_old":"<host text>","picture_index":1,"expected_properties":{"rotationAngle":0,"sourceWidth":4800,"sourceHeight":3000,"cropLeft":0,"cropTop":0,"cropRight":0,"cropBottom":0},"props":{"rotationAngle":90}}
```

## Outer group transforms and complex paragraph boundaries

`transform_picture_group` uses a returned outer group ID, host text, its complete `expected_properties`, and `expected_rotation_angle`. `props` accepts `width`, `height` (positive integer HWP units ≤720000, **unrotated** frame size) and/or `rotationAngle` (integer -359…359). Read `frame_size` for unrotated size; `properties.width/height` are the current rotated bounding dimensions. Native common-frame-only sizing is included in the displayed size; rotating it retains that size. Absolute common frames are required. It updates every component's composed transform and retains nested grouping and embedded image data. Root shear/flip, singular transforms and unsupported profiles are refused. Inner subgroup selection is not an operation target.

```json
{"type":"transform_picture_group","target_id":"<group ID>","expected_old":"<host text>","expected_properties":{"width":11600,"height":9600,"horzOffset":0,"vertOffset":0},"expected_rotation_angle":0,"props":{"width":23200,"height":19200,"rotationAngle":90}}
```

Complex paragraph operations use a whole block's text and `structural_editable:true`. The schemas match ordinary boundaries: `split_paragraph` adds `offset`; `merge_paragraph` adds `previous_target_id` and `expected_previous`; `insert_paragraphs` adds `paragraphs` (1–100 strings). `duplicate_paragraph` and `delete_paragraph` have no extra keys and refuse paragraphs containing controls. Splits move intact controls with their anchors; field values cannot straddle a new boundary. Existing page/column break flags stay on the retained first paragraph and are not copied onto newly created paragraphs. Merge targets must be consecutive within the same body/cell list and have equal paragraph formatting; a break at the second paragraph prevents merging. The last cell paragraph cannot be deleted. Initial read targets remain valid within a checked batch after supported boundary shifts.

## Geometry diagnostics and guarded fitting

```json
{"action":"layout","source":"<absolute HWP path>","expected_sha256":"<hash>"}
```

Plan/edit requests accept `layout_policy:"report"` (default), `"reject_new_overflow"` or `"reject_new_risk"`. Results include `layout_diagnostics.issues`, `new_issues`, `geometry_overflows`, `font_warnings` and unchecked scope. `reject_new_overflow` rejects new geometry issues as `NEW_LAYOUT_OVERFLOW`; `reject_new_risk` also rejects new font estimates as `NEW_LAYOUT_RISK`, before saving or creating a backup. `NESTED_TABLE_MAY_EXCEED_PAGE_HEIGHT` estimates wrapped character heights, direct cell paragraphs and child tables against a full body page. Stored row heights remain minimums, not clipping boundaries. Existing object risks are matched by a unique instance identity across picture-index changes; a deleted/recreated object cannot reuse an old risk. Zero or duplicate instance IDs are unverified: a changed strict request may conservatively refuse an existing object risk, while a byte-identical no-op does not save. The estimate is guidance, not native pagination. Shorten content or restructure only when requested. Never retry without the selected policy just to force a save.

`FIXED_TEXT_BOX_MAY_EXCEED_PAGE_HEIGHT` estimates wrapped text and paragraph spacing against the remaining paper height for supported body rectangles anchored to the paper top on portrait single-column pages. It can warn even when a file has no tables. The default reports the risk; `reject_new_risk` refuses a newly detected risk before saving. Internal box padding, other anchor/alignment profiles, exact font metrics and native automatic box growth are not certified. Box geometry and all supplied text remain unchanged by diagnostics; never shrink text, resize a box or remove lines without an explicit request.

Changed saves and recovery use a process-owned local lock. A lock from this version can be reclaimed when its owner on this host is proven absent; live owners, reused live PIDs, foreign-host locks and unverifiable pre-0.2.26 lock files remain `DOCUMENT_BUSY`. Unknown legacy lock files are never automatically erased. Inspect and report an unverifiable lock instead of retrying with weaker version checks. `abandoned_lock_recovered:true` reports successful recovery of this version's abandoned lock.

To grow row minima and enable reader page continuation for a supported root table and its nested tables, read `table_reflow`. Select its root context and copy the complete `expected_tables` array:

```json
{"type":"reflow_table","target_id":"<context.target_id>","expected_old":"<context.expected_old>","expected_tables":["<copy all returned descriptors as objects>"]}
```

This explicitly changes **the entire selected root tree**: top-left paragraph/column anchoring, non-inline Square wrapping, line-level page splitting, growing row minima, cleared size/page-break prevention and mapped line caches. Widths, padding, borders, repeat-header flags, text, styles and other streams are retained. Any cell paragraph target also selects its containing root tree. Put answer/text operations first and `reflow_table` last, copying the original context. From 0.2.35, a complete root tree matching this flow profile automatically synchronizes supported later text/font/cell-paragraph changes before the final candidate is saved, also after reopening. The runner compares root instance identity, content, styles, geometry and page reserve; unrelated body edits do not trigger height changes. Explicit reflow earlier in a batch also enables synchronization after subsequent edits. `table_auto_sync` lists checked roots and whether flow/height bytes changed. A sync refusal aborts the whole request without a backup. Stored minima never shrink automatically. A changed page count is not clipping-free certification.

The 0.2.38 profile requires one column, horizontal top/center/bottom-aligned cells, ordinary paragraph spacing (100–300%), depth at most three, verified outer cell boundaries and enough width. Multiple nested tables without interleaved text retain the 0.2.36 vertical stack profile. Text between/after table anchors, or multiple roots in one body paragraph, uses explicit **paragraph partition**: text and table anchors become separate paragraphs in original order with retained UTF-16 character styles and paragraph styles. This changes paragraph boundaries and reports `structure_changed`, `host_normalization:"paragraph_segments_around_table_anchors"` and `normalized_hosts`. The source host target is invalidated; read again to edit its new pieces. Retained leaf-cell/other targets are remapped within the same batch. Co-hosted body roots share one read context with `scope:"whole_body_host_forest"`, `root_table_ids` and the complete `expected_tables`; selecting any contained cell reflows that entire forest. New block tables use left-only Square flow to keep surrounding text below them. Reopened edits synchronize each root, and body text edits in a flowing-table section use the raw preservation path. Horizontal and vertical merges remain supported. Duplicate co-host root instance IDs, fields/competing controls inside a host that needs partitioning, font-uncertain cells or a grapheme wider than the available cell width, arbitrary paragraph drawings and floating/unknown footer controls refuse before saving. Unrelated fields retain identity and remain editable in the same batch. `protect_page_bottom` preserves supported multi-paragraph mixed-style footers, inline tables and automatic page numbers, including odd/even application, by compensating the first footer paragraph spacing and clearing its subtree line caches. Floating drawings and vertical footer lists refuse before saving. Paper-fixed drawings need a protected header/footer reserve. Unverified layouts fail before saving. Limits: 16 tables, 32 rows/16 columns per table, 100,000 total text units, 10,000 per paragraph, height at most 720,000 HWP units/12 body heights. `layout_verified:false` remains.

To shrink an overflowing nested table, use any cell paragraph target of that table and its complete returned dimensions/properties:

```json
{"type":"fit_table_to_cell","target_id":"<nested cell paragraph ID>","expected_old":"<cell text>","expected_dimensions":{"rowCount":1,"colCount":2,"cellCount":2},"expected_properties":{"tableWidth":40000,"tableHeight":1282,"cellSpacing":0,"paddingLeft":510,"paddingRight":510,"paddingTop":141,"paddingBottom":141}}
```

It retains column ratios with integer rounding, cell spans, text, styles and child objects. It never enlarges an already-contained table or changes fonts. `LAYOUT_CANNOT_FIT_WITHOUT_REFLOW` means the available width is insufficient for the checked content; other existing object/track guards can also refuse the request. This default geometry scope does not measure page boundaries, multi-line text height or floating-object overlap.

## Selected paragraph and object reflow

`action:"layout", scope:"rendered"` inspects current WASM text/control bounding boxes for text-line intersections, floating-object/text intersections and body overflow. Limits are 32 pages, 20,000 items, 200,000 intersection checks and 2,000 issues. It is read-only. Font substitution and renderer pagination can differ from Hancom; intentional overlays remain possible. This scope is separate from the horizontal geometry save policy and keeps `layout_verified:false`.

Raw inline control identities override a contradictory render plane for floating-object classification; `INLINE_CONTROL_RENDER_PLANE_DISAGREEMENT` discloses the discrepancy. Nested-table sections disclose `NESTED_TABLE_PAGINATION_UNVERIFIED` even with clean boxes. Cell runs outside the body add `CELL_TEXT_OUTSIDE_BODY_PAGINATION_UNVERIFIED`. These limitations keep `diagnostics_complete:false`; no checked collision does not certify that native pages will contain the answer.

```json
{"type":"reflow_paragraph","target_id":"<paragraph ID>","expected_old":"<full text>","expected_properties":"<complete returned paragraph_properties object>"}
{"type":"reflow_object","target_id":"<group ID or picture host paragraph ID>","expected_old":"<full host text>","expected_properties":"<complete returned object properties>","expected_flow":"<complete returned object flow>"}
```

The values shown as placeholders above must be JSON objects copied from `read`. `reflow_paragraph` uses the paragraph target, including a paragraph containing a field, rather than the field-value target. It changes fixed/minimum/space-only line height to 160% of character height; an existing percentage is retained within 100–1000%. It enables font-aware height and widow/orphan protection and clears keep-lines/keep-next. It preserves explicit page/column breaks, text, character runs, numbering and outline-tail bytes. Cells grow according to their reader's table flow rules; stored minimum row heights are preserved. Vertical cells and legacy ambiguous break flags are refused.

`reflow_object` converts the selected floating picture or **whole outer group** to inline (`treatAsChar:true`, affects line height), keeping image bytes, crop, matrices, size and text-anchor order. This reserves paragraph height and lets it move with text across pages. It resets floating offsets to zero and removes overlap permission. Select one picture with `picture_index` when necessary; this key is not valid for a whole group. Absolute sizes and a verified portrait page definition are required. An object wider than its container or taller than the body is refused as `OBJECT_TOO_LARGE_FOR_FLOW`; no silent resizing occurs. This changes the selected object's floating behavior, so use it when flow adjustment is requested, not to alter a watermark or fixed logo. `flow_editable:true` on a `raw_flow_only_picture` permits this operation only, even if general picture editing is unavailable.

Both operations invalidate mapped body/cell line caches across the affected section, retaining opaque header/footer lists and all other content. This allows following paragraphs and ancestor cells to reflow. Repeating canonical settings with no caches is a true no-op. A batch can edit text/size first and then reflow using the properties expected at that step; target IDs still come from the initial read.

## Floating placement, fixed footer protection and text boxes

Read returns `page_definitions` in HWP units and supported `text_boxes` separately from body/cell blocks. Every operation below supports plan, checked same-file save and exact recovery. Expected objects are complete JSON objects copied from the current read, not strings. Targets in a batch belong to its initial read; expected text/properties describe each step.

```json
{"type":"reposition_floating_object","target_id":"<outer group, box or picture host ID>","expected_old":"<full host body text>","expected_properties":{},"expected_flow":{},"clearance":900}
{"type":"protect_page_bottom","target_id":"<paragraph in chosen section>","expected_old":"<full paragraph text>","expected_page":{},"protected_objects":["<page-fixed box/group/picture host ID>"],"clearance":900}
{"type":"protect_page_bottom","target_id":"<paragraph in chosen section>","expected_old":"<full paragraph text>","expected_page":{},"minimum_footer_height":10000}
{"type":"splice_text_box","target_id":"<text_boxes[].paragraphs[].target_id>","expected_old":"<whole box paragraph text>","expected_properties":{},"start":0,"end":3,"new_text":"안내"}
```

When `text_boxes[].geometry_editable` is true, explicitly move or resize that existing rectangle:

```json
{"type":"transform_text_box","target_id":"<text_boxes[].target_id>","expected_old":"<full host block text>","expected_properties":{},"expected_flow":{},"props":{"width":12000,"height":6000,"horzOffset":500,"vertOffset":1200}}
```

Copy complete `expected_properties` and `expected_flow` from the selected box; `expected_old` is its containing block's text, not a paragraph inside the box. `props` supplies one or more absolute HWP-unit values. Width/height must be integers from 1 to 720000; signed offsets from -720000 to 720000. Plain body, cell and nested-cell rectangles are supported when their absolute dimensions, top/left alignment, unrotated component and rectangle corners agree. Rotated, scaled, flipped, inline and other unverified frames return `geometry_editable:false` and refuse geometry edits. The operation preserves text/styles, anchor/wrap, fill/borders, tables and unrelated controls; it clears affected line caches. No-op geometry creates no backup. Cell-column-relative horizontal overflow is reported as `TEXT_BOX_EXCEEDS_CELL_WIDTH`; `reject_new_overflow` refuses new such risks before saving. Page-relative cell boxes are not certified against cell bounds. This is explicit geometry editing, not automatic fitting, collision avoidance or page splitting; native pagination remains unverified.

`reposition_floating_object` preserves floating state, reference **flags**, wrap, margins, size, images, instance IDs and drawing payloads. It changes offsets and can explicitly transfer the complete drawing anchor/subtree between verified body/cell paragraphs, including another section in the same HWP. Only record nesting levels and the two hosts' anchor/style indices change during transfer. Global DocInfo/BinData are retained. Defaults to 900 HWP units (12 preview pixels) clearance; 0–7200 is allowed. Select only an object whose relocation was requested.

- Body placement supports portrait pages with 1–8 normal left-to-right columns. Equal-width columns and verified unequal-width proportional definitions are supported. `destination_column` is zero-based; every candidate fits one column. Malformed weights, right-to-left/distributed columns or disagreeing raw/rendered bounds are refused.
- Supply **both** `destination_target_id` and `expected_destination` to move to a different mapped body/cell paragraph. Its full visible text and style runs remain intact. Its existing section/page determines the destination; this does not insert a page. `destination_column` is valid only for a body destination. Box identities and table/cell paths are remapped by original raw records, including moves between levels/sections; later batch steps can keep using initial box/paragraph targets.
- Cell destinations support plain unrotated rectangle text boxes, verified embedded PNG/JPEG pictures and bounded picture groups, with column/root-body-paragraph top/left anchors and raw `textWrap:3`. Text boxes require zero internal metrics and content estimated to fit the box. Pictures/groups require finite matrices whose visible bounds fit the declared common frame; image bytes, crop and every matrix stay unchanged. Depth 1–3, later rows, multiple plain leaf paragraphs, uniquely recoverable merged-cell boundaries and leaf top/center/bottom alignment are supported. Fixed ancestor grids also support several inline tables (including identical sizes/text), explicit or automatic prefix wrapping, preceding/following plain paragraphs and top/center/bottom alignment. Raw control-anchor order and complete cell/paragraph ancestry select the table; rendered nested origins never establish identity. Natural glyph advances come from ephemeral left-aligned measurement documents, then line spacing, justification and table outer margins determine the composed origin. A 4% width sensitivity check reserves the intersection of candidate cell interiors; different vertical wrap outcomes are refused. These are font estimates, not native-layout certification. Composed-flow paragraphs require one font size, ordinary horizontal shaping, percentage spacing 100–300%, and zero paragraph margins/indent/spacing; cells must have sufficient fixed room. Root body host is empty, normally aligned and single-column. Measured prefix tolerance, padding, table margins and conservative word/emoji height estimates define the interior. The operation never grows cells or shortens content.
- Other supported rectangles, pictures and picture groups in that root host are projected as obstacles. A nested table in a disjoint sibling cell is accepted only when its contained geometry is checked. Unknown inline controls, mixed-size/complex font metrics, ambiguous vertical wrapping, insufficient fixed-cell room, outlying child matrices, unresolved raw identity or changed preceding-row origins remain refused. Dynamic cell growth and nested page splitting are separate unsupported layout work.
- Cell placement uses `coordinate_basis:"hwp_column_and_root_paragraph_reference"`, projected cell/frame bounds, `raw_hierarchy_checked:true` and `engine_checked:false`. `NESTED_FLOATING_RENDER_ORIGIN_DISAGREEMENT` remains explicit: current WASM SVG/thumbnail/control coordinates can disagree with the saved HWP. Risk diagnostics use projected boundaries/text bands when verified; `reject_new_risk` refuses new risks. Raw page-column offsets must not be counted as cell-local widths, including pictures/groups. Aligned-ancestor diagnostics remove the selected floating plane before reading table flow; current WASM inclusion of floating offsets in alignment height is not a native origin. Native layout is never certified by a preview.
- `overlap_policy` defaults to `"avoid"`. Use `"preserve_existing"` only when preserving the existing overlap was requested: an already in-bounds drawing stays byte-exact with `saved:false` and `existing_overlap_preserved:true`. Bounds are still enforced; an out-of-bounds object uses normal collision avoidance. This option cannot be combined with a changed anchor. It never guesses intent, changes flow flags or permits a new overlap.
- No free rectangle returns `NO_FLOATING_PLACEMENT_SPACE`; unverified raw geometry, pagination or identity is refused before saving. `layout_verified:false` and `native_layout_verified:false` remain authoritative. A recorded synthetic native check is not a certificate for other documents.

```json
{"type":"reposition_floating_object","target_id":"<selected supported drawing>","expected_old":"<host text>","expected_properties":{},"expected_flow":{},"destination_target_id":"<destination mapped paragraph>","expected_destination":"<destination text>","destination_column":1,"clearance":900}
```

Batch destination IDs are remapped after earlier structural edits. Box/group targets remain traceable after relocation. A standalone picture is addressed by its host paragraph, so a later picture/placement operation using that old host in the same batch is refused with `BATCH_RELOCATED_PICTURE_REQUIRES_READ`; save, reread and select its new host instead. Plan remains unsaved; checked same-file save and byte-exact recovery apply. `layout_verified:false` and `native_layout_verified:false` remain authoritative outside the recorded synthetic native checks.

`read.opaque_drawings` also exposes outer body drawing groups whose children remain unsupported, such as vector-only maps. Select their returned target and expected properties/flow for outer placement or bottom protection. `contents_read_only:true` remains authoritative: no child editing, rotation, scaling or content-completeness claim is implied. Every descendant drawing record stays byte-exact. Identical ambiguous subtrees cannot be tracked through structural batches; reread after the structural edit instead of forging a target.

`protect_page_bottom` increases the section's footer reserve so body paragraphs/tables can continue above the fixed region. Supply a total `minimum_footer_height` or up to 16 `protected_objects` from that section. Protected objects must be page/paper anchored, with unrestricted vertical placement; paragraph-anchored objects are refused. All protected geometry stays exact. For plain horizontal text footers it clones/reuses the first paragraph style with compensating before-spacing to preserve native footer position; footer text/character styles and old definitions remain exact. Footers containing controls, fields or drawings, unsupported page definitions, and a reserve leaving less than 7200 HWP units of body height are refused. This operates on the whole section and may increase its page count. It does not add repeat-on-every-page behavior to a body object.

`splice_text_box` edits a verified plain paragraph in an existing body or table-cell rectangle, including an empty one. Cell and nested-cell boxes expose `cell_path` and profile `cell_rectangle_plain_paragraphs`; model text must match the full recursive path. `start`/`end` count code points, so an emoji counts once. Retained text keeps character runs; new text inherits the replaced/adjacent style. LF is a line break within the same paragraph. Geometry, fill/borders, list properties, other paragraphs and controls stay intact. Group boxes, boxes inside another box, fields/controls within the list and structural paragraph insertion remain unsupported. It does not resize the box to fit text or certify clipping-free display. Automatic cell-box placement has the narrower `reposition_floating_object` profile above.

Cell text-box diagnostics include `cell_text_boxes` coverage and limitations in geometry/rendered layout and edit results. For supported paragraph/column-relative, plain rectangles in a cell's first paragraph, they compare displayed cell bounds, normal cell text/nested-table height estimates and estimated box content height. `CELL_TEXT_BOX_*` warnings distinguish observed top/bottom/body intersections (`engine_render`) from possible content/normal-flow height and body overlap (`font_estimate`). Only nonempty ordinary body text is considered surrounding body; a box's own text and empty anchor runs are excluded. Stored minimum cell height is not clipping proof, and the renderer may enlarge cells differently from Hancom. Paper/page anchors, nonzero internal metrics and ambiguous nested identities remain explicitly inconclusive; content-height warnings may still apply. `reject_new_risk` refuses new/worsening cell risks before saving, while `reject_new_overflow` remains limited to raw geometry. Smaller existing cell risks on the same verified object/related paragraph are not counted as new; missing/duplicate instance IDs remain conservative. No-op requests do not save. Diagnostics do not move objects, shorten text or split tables.

Rendered diagnostics also separate fixed header/footer text and a text box's own text. `engine_limitations` reports inconsistent page/run membership, multiline pagination uncertainty and footer spacing unsupported by the renderer. With such limitations and no definite issues, `status:"inconclusive"` and `diagnostics_complete:false` are returned. Footer compensation is verified against native synthetic images; the current WASM renderer ignores that before-spacing. Keep `layout_verified:false` even when no checked intersection remains.

Complex `tables` return `axis_editable`, `layout_editable`, cell geometry and `subtree_sha256`. Verified rectangular and merged nested tables support row/column insertion and deletion. Crossing merged cells expand or shrink without deleting their paragraphs. Inserted positions already covered by an expanded merge require an empty text slot. Deletion `expected_cells` includes all affected cells, including retained crossing merges, in storage order.

Deleting a cell containing a field, picture, nested table, other control or an extended named-cell header also requires `expected_cell_sha256`: the exact returned subtree hashes of **all affected cells**, in the same order as `expected_cells`. This confirms the complete cell subtree, not just its visible text. Only use this operation when deleting those cells and their contents is requested; do not supply the hash merely to bypass a refused unrelated edit. Retained cells and embedded binary streams survive; removal is not permanent deletion of sensitive data. Hashes and text conditions refer to the state at that operation, so reread after earlier changes before constructing a controlled deletion.

```json
{"type":"delete_table_row","target_id":"<cell target>","expected_old":"<whole host paragraph>","index":0,"expected_cells":[["<first affected cell paragraph>"],["<second affected cell paragraph>"]],"expected_cell_sha256":["<first returned subtree hash>","<second returned subtree hash>"]}
```

`merge_table_cells` and `split_table_cell` use the existing range/text-confirmation schemas in complex tables. Complex merge keeps **every** selected paragraph, including empty paragraphs, and retains each paragraph's ClickHere/picture/nested-table controls and mixed styles. Split leaves all existing content in the top-left cell and creates empty neighbouring cells. Multiple independent named-cell identities cannot be merged into one cell. An empty new cell remains editable without an initial save.

The raw grid must be complete and non-overlapping, with no zone records and at most 50 rows, 50 columns and 256 grid positions. Axis changes require determined, consistent column-width and stored-row-height tracks. If a fully merged table hides its internal tracks, `split_table_cell` can additionally supply `widths` and/or `heights` for the **entire table grid**; their sums across every existing cell must match its current size. Do not guess unsupported geometry.

Complex `resize_table_columns/rows`, `format_cell` and `format_table` use the existing documented schemas. Explicit resizing sums each merged span; padding/spacing/vertical alignment are raw metadata patches. `layout_editable` may be true even when axis-track inference is unavailable. Retained drawings and nested tables must fit a narrowed cell. Paragraph line caches are invalidated only at the changed cell's own level; a retained nested table's records remain exact. Repeating identical metadata produces no save or backup. Stored heights and preview rendering do not certify final external page layout.

The 0.2.38 text metric profile permits narrow cells when each complete grapheme fits, and mixed font sizes across graphemes. Line minima use adjacent line maxima and ordinary 100–300% spacing. Decomposed Hangul, combining Latin accents and horizontal CJK/Latin/Greek/Cyrillic text retain their original UTF-16 and styles; no normalization or font shrink is applied. A metric-changing format boundary inside a grapheme, orphan/stacked marks beyond the bounded profile, Arabic/Indic/Thai shaping, format controls and multi-scalar symbol/ZWJ emoji clusters fail with `TABLE_REFLOW_SHAPING_UNVERIFIED` before saving. Script-specific font substitution and identical line/page calculation across readers remain unverified.
