"""Synthetic orchestration tests, not proof of real HWP or visual fidelity."""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
import copy
from dataclasses import dataclass
import hashlib
import json
from pathlib import Path
import unittest

from one_hwp.native_service import NativeService, NativeServiceError


SOURCE = Path("C:/synthetic/input.hwp").absolute()
OUTPUT = Path("C:/synthetic/output.hwp").absolute()


def document(texts=("첫 문장", "같은 문장", "같은 문장"), *, unsupported=None):
    return {
        "blocks": [{"id": f"s0:p{index}", "text": text,
                    "kind": "cell" if index == 1 else "paragraph", "section": 0,
                    "paragraph": index, "editable": True,
                    "style": {"char_shape_ids": [0], "paragraph": {"align": "left"}}}
                   for index, text in enumerate(texts)],
        "tables": [{"id": "s0:t0", "rows": 1, "columns": 1}],
        "warnings": ["Synthetic fixture; layout unverified"],
        "unsupported": [] if unsupported is None else unsupported,
    }


def encode(value):
    return json.dumps(value, ensure_ascii=True, sort_keys=True).encode("utf-8")


def digest(data):
    return hashlib.sha256(data).hexdigest()


class FakeEngine:
    def __init__(self):
        self.edit_calls = 0
        self.inspect_calls = 0
        self.preview_calls = 0
        self.damage = None
        self.fail = None

    def capabilities(self):
        if self.fail == "capabilities":
            raise RuntimeError("PRIVATE DOCUMENT BODY")
        return {"name": "synthetic-mock", "hancom_required": False}

    def inspect(self, data):
        self.inspect_calls += 1
        if self.fail == "inspect":
            raise RuntimeError("PRIVATE DOCUMENT BODY")
        return json.loads(data)

    def edit(self, data, operations):
        self.edit_calls += 1
        if self.fail == "edit":
            raise RuntimeError("PRIVATE DOCUMENT BODY")
        value = json.loads(data)
        blocks = {block["id"]: block for block in value["blocks"]}
        for operation in operations:
            blocks[operation["target_id"]]["text"] = operation["new_text"]
        if self.damage is not None:
            self.damage(value, operations)
        return encode(value)

    def preview(self, data, page):
        self.preview_calls += 1
        if self.fail == "preview":
            raise RuntimeError("PRIVATE DOCUMENT BODY")
        return {"svg": "<svg></svg>", "page": page, "page_count": 2,
                "warnings": ["Mock preview"], "layout_verified": True}


@dataclass
class FakeSnapshot:
    path: Path
    data: bytes
    sha256: str


@dataclass
class FakeReceipt:
    path: Path
    sha256: str
    mode: str
    backup_id: str | None
    durability_warnings: tuple[str, ...] = ("Mock storage durability unverified",)


class FakeStore:
    def __init__(self, value):
        self.documents = {SOURCE: encode(value)}
        self.save_calls = []
        self.restore_calls = []
        self.backups = {}

    def read(self, source):
        path = Path(source)
        data = self.documents[path]
        return FakeSnapshot(path, data, digest(data))

    def save(self, snapshot, data, *, output=None, expected_destination_sha256=None):
        if digest(self.documents[snapshot.path]) != snapshot.sha256:
            raise RuntimeError("Source conflict")
        destination = snapshot.path if output is None else Path(output)
        if destination != snapshot.path and destination in self.documents:
            if expected_destination_sha256 != digest(self.documents[destination]):
                raise RuntimeError("Destination conflict")
        self.save_calls.append((snapshot, data, output, expected_destination_sha256))
        backup_id = None
        if destination in self.documents:
            backup_id = f"backup-{len(self.backups)}"
            self.backups[backup_id] = (destination, self.documents[destination])
        self.documents[destination] = data
        return FakeReceipt(destination, digest(data),
                           "save" if destination == snapshot.path else "save_as", backup_id)

    def restore(self, path, backup_id, expected_sha256):
        self.restore_calls.append((path, backup_id, expected_sha256))
        current = self.read(path)
        if current.sha256 != expected_sha256:
            raise RuntimeError("Restore conflict")
        destination, data = self.backups[backup_id]
        if Path(path) != destination:
            raise RuntimeError("Backup scope conflict")
        return self.save(current, data)


class NativeServiceTests(unittest.TestCase):
    def setUp(self):
        self.value = document()
        self.engine = FakeEngine()
        self.store = FakeStore(self.value)
        self.service = NativeService(self.engine, self.store)
        self.version = self.store.read(SOURCE).sha256

    def replace_document(self, value):
        self.store.documents[SOURCE] = encode(value)
        self.version = digest(self.store.documents[SOURCE])

    def operation(self, index=0, new_text="새 문장"):
        block = self.service.read(SOURCE, self.version)["blocks"][index]
        return {"target_id": block["target_id"], "expected_old": block["text"],
                "new_text": new_text}

    def assert_safe_json(self, value):
        json.dumps(value, ensure_ascii=False, allow_nan=False)
        self.assertIs(value["layout_verified"], False)

    def test_capabilities_disclose_bounds_and_process_local_cache(self):
        result = self.service.capabilities()
        self.assert_safe_json(result)
        self.assertFalse(result["idempotency"]["persistent"])
        self.assertEqual(result["idempotency"]["max_entries"], 128)
        self.assertEqual(result["save_default"], "same_file")
        self.assertTrue(result["cursor"]["issued_only"])

    def test_read_whole_supported_document_and_versioned_ids(self):
        result = self.service.read(SOURCE)
        self.assert_safe_json(result)
        self.assertTrue(result["complete"])
        self.assertTrue(result["content_complete"])
        self.assertIsNone(result["next_cursor"])
        self.assertEqual(result["source_sha256"], self.version)
        self.assertNotEqual(result["blocks"][1]["target_id"], result["blocks"][2]["target_id"])
        self.assertIn(self.version, result["blocks"][0]["target_id"])
        self.assertEqual(result["edit_expected_old_scope"], "whole_block")

    def test_first_read_page_is_not_whole_document_content_coverage(self):
        first = self.service.read(SOURCE, max_chars=1)
        self.assertFalse(first["content_complete"])
        self.assertTrue(first["all_content_supported"])
        self.assertEqual(first["page_starts_at"], {"block_index": 0, "offset": 0})
        cursor = first["next_cursor"]
        last = self.service.read(SOURCE, cursor=cursor)
        self.assertTrue(last["content_complete"])
        self.assertEqual(last["page_starts_at"], {"block_index": 0, "offset": 1})
        self.assertIn("cursor_chain", last["content_complete_scope"])
        self.assertLess(len(last["blocks"][0]["text"]), len(self.value["blocks"][0]["text"]))

    def test_long_paragraph_pagination_has_no_loss_or_duplication(self):
        value = document(("", "가" * 19_777 + "끝", "", "tail"))
        self.replace_document(value)
        cursor = None
        reconstructed = {block["id"]: "" for block in value["blocks"]}
        offsets = {block["id"]: 0 for block in value["blocks"]}
        pages = 0
        while True:
            result = self.service.read(SOURCE, self.version, cursor, max_chars=101)
            self.assert_safe_json(result)
            self.assertLessEqual(sum(len(block["text"]) for block in result["blocks"]), 101)
            for block in result["blocks"]:
                self.assertEqual(block["start_offset"], offsets[block["id"]])
                reconstructed[block["id"]] += block["text"]
                offsets[block["id"]] = block["end_offset"]
            pages += 1
            if result["complete"]:
                self.assertIsNone(result["next_cursor"])
                break
            self.assertTrue(result["next_cursor"])
            cursor = result["next_cursor"]
            self.assertLess(pages, 300)
        self.assertGreater(pages, 190)
        self.assertEqual(reconstructed, {block["id"]: block["text"] for block in value["blocks"]})

    def test_empty_document_and_many_empty_blocks_finish(self):
        self.replace_document(document(()))
        self.assertTrue(self.service.read(SOURCE)["complete"])
        self.replace_document(document(tuple("" for _ in range(300))))
        first = self.service.read(SOURCE, max_chars=1)
        second = self.service.read(SOURCE, cursor=first["next_cursor"], max_chars=1)
        third = self.service.read(SOURCE, cursor=second["next_cursor"], max_chars=1)
        self.assertEqual(len(first["blocks"]), 128)
        self.assertEqual(len(second["blocks"]), 128)
        self.assertEqual(len(third["blocks"]), 44)
        self.assertTrue(third["complete"])

    def test_read_partial_coverage_discloses_unsupported_content(self):
        self.replace_document(document(unsupported=[{"kind": "textbox", "section": 0}]))
        result = self.service.read(SOURCE)
        self.assertTrue(result["complete"])
        self.assertFalse(result["content_complete"])
        self.assertFalse(result["all_content_supported"])
        self.assertEqual(result["scope"], "supported_paragraph_and_cell_blocks")
        self.assertEqual(result["unsupported"][0]["kind"], "textbox")

    def test_unknown_and_arbitrary_cursor_rejected(self):
        for cursor in ("eyJibG9jayI6OTl9", {"block": 1}, 1, ""):
            with self.subTest(cursor=cursor), self.assertRaises(NativeServiceError):
                self.service.read(SOURCE, cursor=cursor)

    def test_cursor_replay_is_valid_but_mismatch_is_rejected(self):
        cursor = self.service.read(SOURCE, max_chars=1)["next_cursor"]
        first = self.service.read(SOURCE, cursor=cursor, max_chars=1)
        second = self.service.read(SOURCE, cursor=cursor, max_chars=1)
        self.assertEqual(first["blocks"], second["blocks"])
        self.store.documents[OUTPUT] = self.store.documents[SOURCE]
        with self.assertRaises(NativeServiceError):
            self.service.read(OUTPUT, cursor=cursor)
        with self.assertRaises(NativeServiceError):
            self.service.search(SOURCE, self.version, "문", cursor=cursor)
        self.replace_document(document(("changed",)))
        with self.assertRaises(NativeServiceError):
            self.service.read(SOURCE, cursor=cursor)

    def test_cursor_eviction_is_bounded(self):
        service = NativeService(self.engine, self.store, cursor_limit=1)
        old = service.read(SOURCE, max_chars=1)["next_cursor"]
        new = service.read(SOURCE, max_chars=1)["next_cursor"]
        self.assertNotEqual(old, new)
        with self.assertRaisesRegex(NativeServiceError, "expired"):
            service.read(SOURCE, cursor=old)

    def test_bad_page_sizes_and_versions_rejected(self):
        for value in (True, 0, -1, 64_001, 1.5, "10"):
            with self.subTest(value=value), self.assertRaises(NativeServiceError):
                self.service.read(SOURCE, max_chars=value)
        for version in ("0" * 64, "A" * 64, "", True):
            with self.subTest(version=version), self.assertRaises(NativeServiceError):
                self.service.read(SOURCE, expected_sha256=version)

    def test_search_disambiguates_duplicate_and_overlapping_occurrences(self):
        self.replace_document(document(("ababa", "ababa", "tail aba")))
        cursor = None
        hits = []
        while True:
            page = self.service.search(SOURCE, self.version, "aba", cursor, max_results=1)
            self.assert_safe_json(page)
            self.assertFalse(page["content_complete"])
            self.assertEqual(page["response_scope"], "search_matches")
            self.assertIn("cursor_chain", page["complete_scope"])
            hits.extend((item["id"], item["match_start"]) for item in page["results"])
            if page["complete"]:
                break
            cursor = page["next_cursor"]
        self.assertEqual(hits, [("s0:p0", 0), ("s0:p0", 2), ("s0:p1", 0), ("s0:p1", 2), ("s0:p2", 5)])
        self.assertIsNone(page["next_cursor"])

    def test_search_context_is_bounded_and_empty_results_complete(self):
        self.replace_document(document(("A" * 1000 + "needle" + "Z" * 1000,)))
        result = self.service.search(SOURCE, self.version, "needle")
        hit = result["results"][0]
        self.assertEqual(hit["match_start"], 1000)
        self.assertLessEqual(len(hit["context"]), 166)
        self.assertTrue(result["complete"])
        missing = self.service.search(SOURCE, self.version, "not present")
        self.assertTrue(missing["complete"])
        self.assertEqual(missing["results"], [])

    def test_search_cursor_query_and_version_fixed(self):
        cursor = self.service.search(SOURCE, self.version, "문장", max_results=1)["next_cursor"]
        with self.assertRaises(NativeServiceError):
            self.service.search(SOURCE, self.version, "문", cursor)
        self.replace_document(document(("new text",)))
        with self.assertRaises(NativeServiceError):
            self.service.search(SOURCE, self.version, "문장", cursor)

    def test_search_reports_cell_address_spans_without_guessing_from_cell_index(self):
        value = document(("같은 문구", "같은 문구", "같은 문구"))
        value["blocks"][1].update(control=2, cell=7, cell_paragraph=3,
                                   row=1, column=4, row_span=2, column_span=3)
        self.replace_document(value)
        first = self.service.search(SOURCE, self.version, "같은", max_results=1)
        second = self.service.search(SOURCE, self.version, "같은", first["next_cursor"], max_results=1)
        third = self.service.search(SOURCE, self.version, "같은", second["next_cursor"], max_results=1)
        hit = second["results"][0]
        self.assertEqual(hit["location"], {"section": 0, "paragraph": 1, "control": 2,
            "cell": 7, "cell_paragraph": 3, "row": 1, "column": 4, "row_span": 2,
            "column_span": 3, "table_id": "s0:p1:t2"})
        self.assertTrue(hit["location_complete"])
        self.assertEqual(first["results"][0]["location"], {"section": 0, "paragraph": 0})
        self.assertTrue(first["results"][0]["location_complete"])
        self.assertNotEqual(hit["target_id"], third["results"][0]["target_id"])
        self.assertEqual(second["location_index_base"], 0)
        self.assertEqual(second["edit_expected_old_scope"], "whole_block")
        self.assertFalse(second["content_complete"])
        self.assertTrue(third["complete"])
        self.assertEqual(self.store.save_calls, [])

    def test_search_missing_cell_address_is_disclosed_not_invented(self):
        hit = self.service.search(SOURCE, self.version, "같은")["results"][0]
        self.assertEqual(hit["kind"], "cell")
        self.assertEqual(hit["location"], {"section": 0, "paragraph": 1})
        self.assertFalse(hit["location_complete"])

    def test_search_unicode_context_offsets_do_not_become_edit_values(self):
        text = "😀" * 100 + "반복 문구" + "끝" * 100
        self.replace_document(document((text,)))
        result = self.service.search(SOURCE, self.version, "반복 문구")
        hit = result["results"][0]
        self.assertEqual(result["text_offset_unit"], "unicode_code_points")
        self.assertEqual(hit["match_start"], 100)
        self.assertEqual(hit["total_chars"], len(text))
        self.assertEqual(hit["context"], text[hit["context_start"]:hit["context_end"]])
        with self.assertRaises(NativeServiceError):
            self.service.plan(SOURCE, self.version, [{"target_id": hit["target_id"],
                "expected_old": hit["context"], "new_text": "다른 문구"}])
        self.assertEqual(self.store.save_calls, [])

    def test_invalid_cell_coordinates_fail_safely_before_search_or_read(self):
        for key in ("control", "cell", "cell_paragraph", "row", "column", "row_span", "column_span"):
            invalid = [True, -1, "PRIVATE_COORDINATE", 1.5, None]
            if key.endswith("_span"):
                invalid.append(0)
            for item in invalid:
                value = document()
                value["blocks"][1][key] = item
                self.replace_document(value)
                for method in (lambda: self.service.read(SOURCE),
                               lambda: self.service.search(SOURCE, self.version, "같은")):
                    with self.subTest(key=key, item=item):
                        with self.assertRaises(NativeServiceError) as failure:
                            method()
                        self.assertNotIn("PRIVATE_COORDINATE", str(failure.exception))
        self.assertEqual(self.store.save_calls, [])

    def test_search_invalid_query_or_limits_rejected(self):
        for query in ("", None, 1, "x" * 8001):
            with self.subTest(query=type(query)), self.assertRaises(NativeServiceError):
                self.service.search(SOURCE, self.version, query)
        for limit in (True, 0, 501, "2"):
            with self.subTest(limit=limit), self.assertRaises(NativeServiceError):
                self.service.search(SOURCE, self.version, "문", max_results=limit)

    def test_plan_is_write_free_and_summaries_do_not_repeat_text(self):
        operation = self.operation(new_text="private replacement")
        result = self.service.plan(SOURCE, self.version, [operation])
        self.assert_safe_json(result)
        self.assertTrue(result["valid"])
        self.assertFalse(result["write_performed"])
        self.assertEqual(result["change_count"], 1)
        self.assertNotIn("private replacement", json.dumps(result))
        self.assertEqual(self.engine.edit_calls, 0)
        self.assertEqual(self.store.save_calls, [])

    def test_plan_rejects_native_profile_linebreak_control_and_character_limits(self):
        value = document()
        value["blocks"][0]["edit_limit"] = 5
        self.replace_document(value)
        for text in ("too long", "a\nb", "a\rb", "a\x00b", "a\x0bb", "a\x1fb", "\ud800"):
            operation = self.operation(new_text=text)
            with self.subTest(text=repr(text)), self.assertRaises(NativeServiceError):
                self.service.plan(SOURCE, self.version, [operation])
            with self.assertRaises(NativeServiceError):
                self.service.edit(SOURCE, self.version, [operation], "profile")
        self.assertEqual(self.engine.edit_calls, 0)
        self.assertEqual(self.store.save_calls, [])

    def test_plan_hard_limit_and_nondefault_style_empty_replacement(self):
        operation = self.operation(new_text="x" * 100_001)
        with self.assertRaises(NativeServiceError):
            self.service.plan(SOURCE, self.version, [operation])
        value = document()
        value["blocks"][0]["style"]["char_shape_ids"] = [1]
        self.replace_document(value)
        with self.assertRaises(NativeServiceError):
            self.service.plan(SOURCE, self.version, [self.operation(new_text="")])
        self.assertEqual(self.store.save_calls, [])

    def test_plan_accepts_tabs_and_non_bmp_unicode_within_codepoint_limit(self):
        value = document()
        value["blocks"][0]["edit_limit"] = 3
        self.replace_document(value)
        result = self.service.plan(SOURCE, self.version, [self.operation(new_text="😀\t가")])
        self.assertTrue(result["valid"])
        self.assertEqual(result["changes"][0]["after_chars"], 3)

    def test_operation_contract_rejects_empty_duplicate_unknown_keys_and_types(self):
        operation = self.operation()
        bad_operations = [None, {}, [], [operation, operation], ["not dict"],
                          [{**operation, "unknown": 1}],
                          [{key: value for key, value in operation.items() if key != "expected_old"}],
                          [{**operation, "new_text": 1}],
                          [{**operation, "expected_old": True}],
                          [{**operation, "target_id": "s0:p0"}],
                          [{**operation, "target_id": "hwp5:" + "0" * 64 + ":czA6cDA"}]]
        for operations in bad_operations:
            with self.subTest(operations=operations), self.assertRaises(NativeServiceError):
                self.service.edit(SOURCE, self.version, operations, "bad")
        self.assertEqual(self.engine.edit_calls, 0)
        self.assertEqual(self.store.save_calls, [])

    def test_canonical_target_encoding_and_missing_target_rejected(self):
        operation = self.operation()
        for target in (operation["target_id"] + "=", operation["target_id"] + "$",
                       NativeService._target_id(self.version, "s0:p999")):
            with self.subTest(target=target), self.assertRaises(NativeServiceError):
                self.service.plan(SOURCE, self.version, [{**operation, "target_id": target}])

    def test_expected_old_must_match_whole_block_and_batch_is_preflighted(self):
        first = self.operation(0)
        second = {**self.operation(1), "expected_old": "wrong"}
        with self.assertRaises(NativeServiceError):
            self.service.edit(SOURCE, self.version, [first, second], "bad-batch")
        self.assertEqual(self.engine.edit_calls, 0)
        self.assertEqual(self.store.save_calls, [])
        self.assertEqual(self.store.read(SOURCE).sha256, self.version)
        fragment = self.service.read(SOURCE, max_chars=1)["blocks"][0]
        with self.assertRaises(NativeServiceError):
            self.service.plan(SOURCE, self.version, [{"target_id": fragment["target_id"],
                                                   "expected_old": fragment["text"], "new_text": "new"}])

    def test_unsupported_or_noneditable_blocks_refuse_before_engine_edit(self):
        for feature in ("unsupported", "noneditable"):
            value = document()
            if feature == "unsupported":
                value["unsupported"] = [{"kind": "image"}]
            else:
                value["blocks"][0].update(editable=False, reason="mixed styles")
            self.replace_document(value)
            operation = self.operation()
            with self.subTest(feature=feature), self.assertRaises(NativeServiceError):
                self.service.plan(SOURCE, self.version, [operation])
            with self.assertRaises(NativeServiceError):
                self.service.edit(SOURCE, self.version, [operation], "not-supported")
        self.assertEqual(self.engine.edit_calls, 0)
        self.assertEqual(self.store.save_calls, [])

    def test_samefile_edit_verifies_and_returns_recoverable_receipt(self):
        original = self.store.documents[SOURCE]
        operations = [self.operation(0, "새로운 문장"), self.operation(1, "")]
        result = self.service.edit(SOURCE, self.version, operations, "request-a")
        self.assert_safe_json(result)
        self.assertEqual(result["mode"], "save")
        self.assertEqual(result["path"], str(SOURCE))
        self.assertEqual(result["previous_sha256"], self.version)
        self.assertTrue(result["content_verified"])
        self.assertTrue(result["structure_verified"])
        self.assertTrue(result["idempotency_retained"])
        self.assertIn("Mock storage durability unverified", result["warnings"])
        self.assertEqual(self.store.backups[result["backup_id"]][1], original)
        edited = json.loads(self.store.documents[SOURCE])
        self.assertEqual(edited["blocks"][0]["text"], "새로운 문장")
        self.assertEqual(edited["blocks"][1]["text"], "")
        self.assertEqual(edited["blocks"][2], self.value["blocks"][2])
        self.assertEqual(edited["tables"], self.value["tables"])

    def test_save_as_preserves_source_and_routes_destination_version(self):
        original = self.store.documents[SOURCE]
        self.store.documents[OUTPUT] = encode(document(("older destination",)))
        destination_version = digest(self.store.documents[OUTPUT])
        result = self.service.edit(SOURCE, self.version, [self.operation()], "save-as",
                                   output=OUTPUT, expected_destination_sha256=destination_version)
        self.assertEqual(result["mode"], "save_as")
        self.assertEqual(self.store.documents[SOURCE], original)
        self.assertNotEqual(self.store.documents[OUTPUT], original)
        self.assertEqual(self.store.save_calls[0][3], destination_version)

    def test_post_edit_content_structure_and_table_damage_refuses_save(self):
        damages = {
            "target": lambda value, operations: value["blocks"][0].update(text="wrong"),
            "nontarget": lambda value, operations: value["blocks"][2].update(text="wrong"),
            "metadata": lambda value, operations: value["blocks"][0].update(paragraph=999),
            "style": lambda value, operations: value["blocks"][0]["style"].update(char_shape_ids=[5]),
            "table": lambda value, operations: value["tables"][0].update(rows=2),
            "extra": lambda value, operations: value["blocks"].append(copy.deepcopy(value["blocks"][0])),
            "unsupported": lambda value, operations: value["unsupported"].append({"kind": "image"}),
            "reorder": lambda value, operations: value["blocks"].reverse(),
        }
        operation = self.operation()
        for label, damage in damages.items():
            self.engine.damage = damage
            with self.subTest(label=label), self.assertRaises(NativeServiceError):
                self.service.edit(SOURCE, self.version, [operation], "bad-edit")
            self.assertEqual(self.store.save_calls, [])
            self.assertEqual(self.store.read(SOURCE).sha256, self.version)

    def test_engine_cannot_mutate_requested_operations_to_bypass_verification(self):
        def mutate(value, operations):
            operations[0]["new_text"] = "engine changed request"
            value["blocks"][0]["text"] = "engine changed request"
        self.engine.damage = mutate
        operation = self.operation()
        with self.assertRaises(NativeServiceError):
            self.service.edit(SOURCE, self.version, [operation], "mutating-engine")
        self.assertEqual(operation["new_text"], "새 문장")
        self.assertEqual(self.store.save_calls, [])

    def test_idempotency_replay_after_samefile_version_change(self):
        operation = self.operation()
        first = self.service.edit(SOURCE, self.version, [operation], "retry")
        second = self.service.edit(SOURCE, self.version, [operation], "retry")
        self.assertEqual(first, second)
        self.assertEqual(self.engine.edit_calls, 1)
        self.assertEqual(len(self.store.save_calls), 1)
        second["warnings"].append("caller mutation")
        third = self.service.edit(SOURCE, self.version, [operation], "retry")
        self.assertNotIn("caller mutation", third["warnings"])

    def test_idempotency_conflict_includes_output_and_destination_version(self):
        operation = self.operation()
        self.service.edit(SOURCE, self.version, [operation], "same-id")
        for kwargs in ({"output": OUTPUT}, {"expected_destination_sha256": "0" * 64}):
            with self.subTest(kwargs=kwargs), self.assertRaisesRegex(NativeServiceError, "different inputs"):
                self.service.edit(SOURCE, self.version, [operation], "same-id", **kwargs)
        with self.assertRaisesRegex(NativeServiceError, "different inputs"):
            self.service.edit(SOURCE, self.version, [{**operation, "new_text": "other"}], "same-id")
        self.assertEqual(len(self.store.save_calls), 1)

    def test_idempotency_bounded_eviction_applies_normal_version_check(self):
        service = NativeService(self.engine, self.store, request_limit=1)
        op1 = self.operation()
        service.edit(SOURCE, self.version, [op1], "old")
        version2 = self.store.read(SOURCE).sha256
        block = service.read(SOURCE)["blocks"][0]
        op2 = {"target_id": block["target_id"], "expected_old": block["text"], "new_text": "third"}
        service.edit(SOURCE, version2, [op2], "new")
        with self.assertRaisesRegex(NativeServiceError, "version changed"):
            service.edit(SOURCE, self.version, [op1], "old")
        self.assertEqual(len(self.store.save_calls), 2)

    def test_oversized_idempotency_receipt_is_honestly_not_retained(self):
        service = NativeService(self.engine, self.store, request_bytes_limit=1)
        result = service.edit(SOURCE, self.version, [self.operation()], "oversize")
        self.assertFalse(result["idempotency_retained"])
        self.assertEqual(len(service._requests), 0)

    def test_concurrent_same_request_only_applies_once(self):
        operation = self.operation()
        def edit(_):
            return self.service.edit(SOURCE, self.version, [operation], "concurrent")
        with ThreadPoolExecutor(max_workers=4) as pool:
            results = list(pool.map(edit, range(8)))
        self.assertTrue(all(value == results[0] for value in results))
        self.assertEqual(self.engine.edit_calls, 1)
        self.assertEqual(len(self.store.save_calls), 1)

    def test_preview_is_version_fixed_read_only_not_layout_certification(self):
        result = self.service.preview(SOURCE, self.version, page=1)
        self.assert_safe_json(result)
        self.assertEqual(result["page"], 1)
        self.assertEqual(result["source_sha256"], self.version)
        self.assertEqual(self.store.save_calls, [])
        for page in (True, -1, "0"):
            with self.subTest(page=page), self.assertRaises(NativeServiceError):
                self.service.preview(SOURCE, self.version, page)
        with self.assertRaises(NativeServiceError):
            self.service.preview(SOURCE, "0" * 64)

    def test_restore_routes_bound_backup_and_reports_durability(self):
        result = self.service.edit(SOURCE, self.version, [self.operation()], "before-restore")
        restored = self.service.restore(SOURCE, result["backup_id"], result["sha256"])
        self.assert_safe_json(restored)
        self.assertEqual(restored["sha256"], self.version)
        self.assertEqual(restored["restored_from_backup_id"], result["backup_id"])
        self.assertEqual(self.store.restore_calls, [(SOURCE, result["backup_id"], result["sha256"])])
        self.assertIn("Mock storage durability unverified", restored["warnings"])
        self.assertFalse(restored["content_verified"])

    def test_engine_errors_never_forward_private_body(self):
        operation = self.operation()
        actions = {
            "capabilities": lambda: self.service.capabilities(),
            "inspect": lambda: self.service.read(SOURCE),
            "edit": lambda: self.service.edit(SOURCE, self.version, [operation], "error"),
            "preview": lambda: self.service.preview(SOURCE, self.version),
        }
        for action, call in actions.items():
            self.engine.fail = action
            with self.subTest(action=action), self.assertRaises(NativeServiceError) as caught:
                call()
            self.assertNotIn("PRIVATE", str(caught.exception))
            self.assertIsNone(caught.exception.__cause__)
        self.assertEqual(self.store.save_calls, [])

    def test_invalid_engine_inspection_rejected(self):
        invalid = [None, {}, {**document(), "blocks": ["bad"]},
                   {**document(), "warnings": [b"bytes"]},
                   {**document(), "tables": float("nan")}]
        for response in invalid:
            self.engine.inspect = lambda data, response=response: response
            with self.subTest(response=response), self.assertRaises(NativeServiceError):
                self.service.read(SOURCE)

    def test_invalid_snapshot_rejected(self):
        self.store.read = lambda source: FakeSnapshot(SOURCE, b"bytes", "0" * 64)
        with self.assertRaisesRegex(NativeServiceError, "invalid snapshot"):
            self.service.read(SOURCE)

    def test_bad_request_id_and_destination_hash_rejected_before_write(self):
        operation = self.operation()
        for request in ("", None, 1, "x" * 257):
            with self.subTest(request=type(request)), self.assertRaises(NativeServiceError):
                self.service.edit(SOURCE, self.version, [operation], request)
        with self.assertRaises(NativeServiceError):
            self.service.edit(SOURCE, self.version, [operation], "destination",
                              expected_destination_sha256="invalid")
        self.assertEqual(self.engine.edit_calls, 0)
        self.assertEqual(self.store.save_calls, [])


if __name__ == "__main__":
    unittest.main()
