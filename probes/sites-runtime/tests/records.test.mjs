/**
 * Synthetic byte-array tests only. No real/user HWP, CFB reader, DEFLATE codec,
 * WASM engine, remote server, authentication, or storage is exercised here.
 * Passing does not certify all HWP variants, production safety, or layout.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_LIMITS, GuardError, parseRecords, profileSections } from "../guard/records.mjs";
import { textControlBytes, verifyPreservation } from "../guard/preservation.mjs";

function concat(...arrays) {
  const result = new Uint8Array(arrays.reduce((sum, bytes) => sum + bytes.length, 0));
  let position = 0;
  for (const bytes of arrays) {
    result.set(bytes, position);
    position += bytes.length;
  }
  return result;
}

function u32(...values) {
  const bytes = new Uint8Array(values.length * 4);
  const view = new DataView(bytes.buffer);
  values.forEach((value, index) => view.setUint32(index * 4, value, true));
  return bytes;
}

function u16(...values) {
  const bytes = new Uint8Array(values.length * 2);
  const view = new DataView(bytes.buffer);
  values.forEach((value, index) => view.setUint16(index * 2, value, true));
  return bytes;
}

function utf16(text) {
  const bytes = new Uint8Array(text.length * 2);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < text.length; index += 1) {
    view.setUint16(index * 2, text.charCodeAt(index), true);
  }
  return bytes;
}

function envelope(tag, payload = new Uint8Array(), level = 0, extended = false) {
  const size = payload.length;
  const wide = extended || size >= 0xfff;
  return concat(u32(tag | (level << 10) | ((wide ? 0xfff : size) << 20)),
    wide ? u32(size) : new Uint8Array(), payload);
}

function spec(tag, payload = new Uint8Array(), level = 0, extended = false) {
  return { tag, payload, level, extended };
}

function encode(records) {
  return concat(...records.map(({ tag, payload, level, extended }) => envelope(tag, payload, level, extended)));
}

function paragraphHeader(text, { last = false, tail = new Uint8Array() } = {}) {
  const bytes = new Uint8Array(24);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, (text.length + 1) | (last ? 0x80000000 : 0), true);
  view.setUint16(12, 1, true);
  view.setUint16(16, 1, true);
  return concat(bytes, tail);
}

function paragraph(text, { last = false, level = 0, controls = new Uint8Array(), tail = new Uint8Array() } = {}) {
  return [
    spec(66, paragraphHeader(text, { last, tail }), level),
    spec(67, concat(utf16(text), controls, u16(13)), level + 1),
    spec(68, u32(0, 0), level + 1),
    spec(69, new Uint8Array(36), level + 1),
  ];
}

const OPAQUE = utf16("SYNTHETIC_OPAQUE_HEADER_TAIL");
const BEFORE = [...paragraph("before"), ...paragraph("untouched", { last: true, tail: OPAQUE })];
const AFTER = [...paragraph("after 😀"), ...paragraph("untouched", { last: true, tail: OPAQUE })];
const OP = [{ section: 0, record_index: 0, new_text: "after 😀" }];

function streams(records, extras = []) {
  return new Map([
    ["FileHeader", new Uint8Array(256)],
    ["DocInfo", envelope(16, new Uint8Array(26))],
    ["BodyText/Section0", encode(records)],
    ...extras,
  ]);
}

function replaceRecord(records, index, patch) {
  return records.map((record, current) => current === index ? { ...record, ...patch } : record);
}

function mutateByte(bytes, index, value = bytes[index] ^ 1) {
  const result = bytes.slice();
  result[index] = value;
  return result;
}

function cloneStreams(source) {
  return new Map([...source].map(([name, bytes]) => [name, bytes.slice()]));
}

function guardCode(action, code) {
  assert.throws(action, (error) => error instanceof GuardError && error.code === code && error.message === code);
}

test("scanner discloses unknown metadata without opaque document payload", () => {
  const secret = utf16("SYNTHETIC_PRIVATE_VALUE_NEVER_IN_PROFILE");
  const result = profileSections(new Map([["BodyText/Section0", concat(envelope(66, utf16("header")), envelope(1000, secret, 1))]]));
  assert.equal(result.paragraph_records, 1);
  assert.deepEqual(result.unsupported, [{
    kind: "body_record", section: 0, record_tag: 1000, record_level: 1,
    reason: "Record is outside the verified content/preservation profile",
  }]);
  assert.equal(JSON.stringify(result).includes("SYNTHETIC_PRIVATE"), false);
  assert.equal(JSON.stringify(result).includes("payload"), false);
});

test("all envelope bit fields, extended sizes, and offset views are scanned", () => {
  const raw = concat(envelope(66, utf16("header"), 0, true), envelope(67, utf16("text"), 1));
  const padded = concat(u32(0xdeadbeef), raw, u32(0xdeadbeef));
  const section = padded.subarray(4, padded.length - 4);
  const records = [...parseRecords(section)];
  assert.deepEqual(records.map(({ tag, level, size, index }) => ({ tag, level, size, index })), [
    { tag: 66, level: 0, size: 12, index: 0 }, { tag: 67, level: 1, size: 8, index: 1 },
  ]);
  assert.equal(records[0].payload.buffer, padded.buffer);
  assert.deepEqual(profileSections(new Map([["BodyText/Section0", section]])), {
    unsupported: [], paragraph_records: 1, record_count: 2, expanded_bytes: raw.length,
    sections: [{ section: 0, paragraph_records: 1, record_count: 2, expanded_bytes: raw.length }],
  });
  assert.deepEqual([...parseRecords(envelope(1023, u16(1), 1023))].map(({ tag, level }) => [tag, level]), [[1023, 1023]]);
  assert.equal([...parseRecords(envelope(71, new Uint8Array(4095)))][0].size, 4095);
});

test("all sections are counted, sorted, and non-body streams are not interpreted", () => {
  const result = profileSections(new Map([
    ["FileHeader", utf16("opaque")],
    ["BodyText/Section1", envelope(66, utf16("two"))],
    ["BodyText/Section0", concat(envelope(66, utf16("one")), envelope(66, utf16("three")))],
  ]));
  assert.equal(result.paragraph_records, 3);
  assert.deepEqual(result.sections.map(({ section, paragraph_records }) => [section, paragraph_records]), [[0, 2], [1, 1]]);
  assert.deepEqual(result.unsupported, []);
});

test("empty scanner input matches Python, not a full-document validation claim", () => {
  assert.equal(profileSections(new Map()).paragraph_records, 0);
  guardCode(() => verifyPreservation(new Map(), new Map(), []), "REQUIRED_STREAM_MISSING");
});

test("known HWP tag 70 is not silently promoted to edit-supported", () => {
  const result = profileSections(new Map([["BodyText/Section0", envelope(70, utf16("opaque"), 1)]]));
  assert.equal(result.unsupported[0].record_tag, 70);
  const input = streams([...BEFORE, spec(70, utf16("opaque"))]);
  guardCode(() => verifyPreservation(input, input, []), "UNSUPPORTED_BODY_RECORD");
});

for (const [description, bytes, code] of [
  ["short header", new Uint8Array([1]), "TRUNCATED_RECORD_HEADER"],
  ["extended size absent", u32(66 | (0xfff << 20)), "TRUNCATED_RECORD_SIZE"],
  ["extended size partial", concat(u32(66 | (0xfff << 20)), new Uint8Array([1, 2, 3])), "TRUNCATED_RECORD_SIZE"],
  ["extended payload absent", u32(66 | (0xfff << 20), 100), "TRUNCATED_RECORD_PAYLOAD"],
  ["short payload", concat(u32(66 | (10 << 20)), new Uint8Array(5)), "TRUNCATED_RECORD_PAYLOAD"],
  ["maximum extended payload", u32(66 | (0xfff << 20), 0xffffffff), "TRUNCATED_RECORD_PAYLOAD"],
  ["trailing header fragment", concat(envelope(66), new Uint8Array([0, 0])), "TRUNCATED_RECORD_HEADER"],
]) {
  test(`scanner refuses ${description} using fixed error code`, () => {
    guardCode(() => profileSections(new Map([["BodyText/Section0", bytes]])), code);
    guardCode(() => [...parseRecords(bytes)], code);
  });
}

for (const [names, code] of [
  [["BodyText/Section2"], "INCOMPLETE_SECTIONS"],
  [["BodyText/Section0", "BodyText/Section2"], "INCOMPLETE_SECTIONS"],
  [["BodyText/Extension"], "INVALID_BODY_LAYOUT"],
  [["BodyText/Section0/Unexpected"], "INVALID_BODY_LAYOUT"],
  [["BodyText"], "INVALID_BODY_LAYOUT"],
  [["BodyText/Section-1"], "INVALID_BODY_LAYOUT"],
  [["BodyText/Section9007199254740992"], "INVALID_BODY_LAYOUT"],
  [["BodyText/Section0", "BodyText/Section00"], "INCOMPLETE_SECTIONS"],
]) {
  test(`scanner refuses invalid section sequence ${names.join(",")}`, () => {
    guardCode(() => profileSections(new Map(names.map((name) => [name, envelope(66)]))), code);
  });
}

test("expanded-byte limit is aggregate, inclusive, and never increased by options", () => {
  const body = envelope(66, new Uint8Array(12));
  const input = new Map([["BodyText/Section0", body], ["BodyText/Section1", body]]);
  assert.equal(profileSections(input, { maxExpandedBytes: 32 }).expanded_bytes, 32);
  guardCode(() => profileSections(input, { maxExpandedBytes: 31 }), "BODY_BYTES_LIMIT");
  guardCode(() => profileSections(input, { maxExpandedBytes: DEFAULT_LIMITS.maxExpandedBytes + 1 }), "INVALID_LIMITS");
});

test("record and unknown-record count budgets are bounded at their inclusive limits", () => {
  const known = new Map([["BodyText/Section0", concat(envelope(71), envelope(71), envelope(71))]]);
  assert.equal(profileSections(known, { maxRecords: 3 }).record_count, 3);
  guardCode(() => profileSections(known, { maxRecords: 2 }), "BODY_RECORD_LIMIT");
  const unknown = new Map([["BodyText/Section0", concat(envelope(1000), envelope(1000))]]);
  assert.equal(profileSections(unknown, { maxUnsupportedRecords: 2 }).unsupported.length, 2);
  guardCode(() => profileSections(unknown, { maxUnsupportedRecords: 1 }), "UNSUPPORTED_RECORD_LIMIT");
  const tooMany = concat(...Array.from({ length: 1025 }, () => envelope(1000)));
  guardCode(() => profileSections(new Map([["BodyText/Section0", tooMany]])), "UNSUPPORTED_RECORD_LIMIT");
});

for (const invalid of [null, [], {}, "secret", true]) {
  test(`stream container type ${String(invalid)} is refused without echo`, () => {
    guardCode(() => profileSections(invalid), "INVALID_STREAM_MAP");
  });
}

test("stream names/types and invalid options are rejected with fixed codes", () => {
  guardCode(() => profileSections(new Map([[123, new Uint8Array()]])), "INVALID_STREAM_MAP");
  guardCode(() => profileSections(new Map([["", new Uint8Array()]])), "INVALID_STREAM_MAP");
  guardCode(() => profileSections(new Map([["BodyText/Section0", "SYNTHETIC_SECRET"]])), "INVALID_STREAM_BYTES");
  guardCode(() => [...parseRecords("SYNTHETIC_SECRET")], "INVALID_STREAM_BYTES");
  for (const invalid of [null, true, [], { compressed: true }, { maxRecords: -1 }, { maxRecords: 0.5 }]) {
    guardCode(() => profileSections(new Map(), invalid), "INVALID_LIMITS");
  }
});

test("targeted longer UTF-16/emoji edit preserves raw non-target data without mutating inputs", () => {
  const before = streams(BEFORE);
  const after = streams(AFTER);
  const beforeCopy = cloneStreams(before);
  const afterCopy = cloneStreams(after);
  assert.deepEqual(verifyPreservation(before, after, OP), {
    verified: true, scope: "narrow_raw_record_preservation", text_verified: false, layout_verified: false,
  });
  assert.deepEqual(before, beforeCopy);
  assert.deepEqual(after, afterCopy);
});

test("raw preservation does NOT verify requested target text or certify production/storage/auth", () => {
  const report = verifyPreservation(streams(BEFORE), streams(AFTER), [{ ...OP[0], new_text: "not the output" }]);
  assert.equal(report.text_verified, false);
  assert.equal(report.layout_verified, false);
  assert.equal(Object.hasOwn(report, "storage_verified"), false);
  assert.equal(Object.hasOwn(report, "tenant_verified"), false);
});

test("short versus extended envelope encoding is not a semantic preservation change", () => {
  const after = AFTER.map((record) => ({ ...record, extended: true }));
  assert.equal(verifyPreservation(streams(BEFORE), streams(after), OP).verified, true);
});

test("target run positions/counts may change but identical style references must survive", () => {
  const before = replaceRecord(BEFORE, 2, { payload: u32(0, 0, 2, 0, 3, 0) });
  const after = replaceRecord(AFTER, 2, { payload: u32(0, 0, 99, 0) });
  assert.equal(verifyPreservation(streams(before), streams(after), OP).verified, true);
  guardCode(() => verifyPreservation(streams(before), streams(replaceRecord(AFTER, 2, { payload: u32(0, 1) })), OP), "PRESERVATION_MISMATCH");
  guardCode(() => verifyPreservation(streams(before), streams(replaceRecord(AFTER, 2, { payload: u32(0, 0, 99, 1) })), OP), "PRESERVATION_MISMATCH");
});

test("style references outside visible text cannot silently disappear", () => {
  const before = replaceRecord(BEFORE, 2, { payload: u32(0, 0, 99, 1) });
  const retained = replaceRecord(AFTER, 2, { payload: u32(0, 0, 100, 1) });
  assert.equal(verifyPreservation(streams(before), streams(retained), OP).verified, true);
  guardCode(() => verifyPreservation(streams(before), streams(AFTER), OP), "PRESERVATION_MISMATCH");
});

test("style-ID set comparison sorts numerically and ignores order/duplicate positions only", () => {
  const before = replaceRecord(BEFORE, 2, { payload: u32(0, 0xffffffff, 99, 1, 3, 10, 4, 1) });
  const after = replaceRecord(AFTER, 2, { payload: u32(100, 10, 1, 1, 2, 0xffffffff) });
  assert.equal(verifyPreservation(streams(before), streams(after), OP).verified, true);
});

for (const [description, index, byteIndex] of [
  ["target paragraph shape", 0, 8],
  ["target paragraph instance data", 0, 18],
  ["target paragraph header high bit", 0, 3],
  ["non-target paragraph count", 4, 0],
  ["non-target paragraph end-of-list bit", 4, 3],
  ["non-target char-run count", 4, 12],
  ["non-target text", 5, 0],
  ["non-target style reference", 6, 4],
  ["non-target opaque header tail", 4, 24],
]) {
  test(`${description} is preserved`, () => {
    const payload = mutateByte(AFTER[index].payload, byteIndex, byteIndex === 3 ? AFTER[index].payload[3] ^ 0x80 : undefined);
    guardCode(() => verifyPreservation(streams(BEFORE), streams(replaceRecord(AFTER, index, { payload })), OP), "PRESERVATION_MISMATCH");
  });
}

test("opaque paragraph header tails cannot be truncated", () => {
  guardCode(() => verifyPreservation(streams(BEFORE), streams(replaceRecord(AFTER, 4, { payload: AFTER[4].payload.slice(0, 24) })), OP), "PRESERVATION_MISMATCH");
});

test("regenerated line count and line geometry may change for all paragraphs", () => {
  let after = replaceRecord(AFTER, 0, { payload: mutateByte(AFTER[0].payload, 16, 9) });
  after = replaceRecord(after, 4, { payload: mutateByte(AFTER[4].payload, 16, 9) });
  after = replaceRecord(after, 3, { payload: new Uint8Array(72).fill(0x77) });
  after = replaceRecord(after, 7, { payload: new Uint8Array(36).fill(0x77) });
  assert.equal(verifyPreservation(streams(BEFORE), streams(after), OP).verified, true);
  guardCode(() => verifyPreservation(streams(BEFORE), streams(after.filter((_, index) => index !== 7)), OP), "PRESERVATION_MISMATCH");
});

test("record order, record level, and record presence cannot change", () => {
  guardCode(() => verifyPreservation(streams(BEFORE), streams(replaceRecord(AFTER, 5, { level: 2 })), OP), "PRESERVATION_MISMATCH");
  const swapped = [...AFTER];
  [swapped[5], swapped[6]] = [swapped[6], swapped[5]];
  guardCode(() => verifyPreservation(streams(BEFORE), streams(swapped), OP), "PRESERVATION_MISMATCH");
  guardCode(() => verifyPreservation(streams(BEFORE), streams(AFTER.slice(0, -1)), OP), "PRESERVATION_MISMATCH");
});

for (const tag of [71, 72, 73, 74, 75, 77]) {
  test(`non-target control/property tag ${tag} keeps opaque payload and tail`, () => {
    const extra = spec(tag, concat(u32(7, 11), OPAQUE), 1);
    const before = [...BEFORE, extra];
    const after = [...AFTER, extra];
    assert.equal(verifyPreservation(streams(before), streams(after), OP).verified, true);
    for (const payload of [mutateByte(extra.payload, 1), extra.payload.slice(0, -1)]) {
      guardCode(() => verifyPreservation(streams(before), streams([...AFTER, { ...extra, payload }]), OP), "PRESERVATION_MISMATCH");
    }
  });
}

function tableRecords(text) {
  return [
    ...paragraph("host"),
    spec(71, concat(u32(1, 2), OPAQUE), 1),
    spec(77, concat(u32(3, 4), OPAQUE), 1),
    spec(72, concat(u32(5, 6), OPAQUE), 1),
    ...paragraph(text, { level: 2 }),
    ...paragraph("last untouched", { last: true }),
  ];
}

test("table-cell target uses tag-66 paragraph ordinal, not all-record envelope ordinal", () => {
  const before = tableRecords("cell before");
  const after = tableRecords("cell after 😀");
  const operations = [{ section: 0, record_index: 1, new_text: "cell after 😀" }];
  assert.equal(verifyPreservation(streams(before), streams(after), operations).verified, true);
  guardCode(() => verifyPreservation(streams(before), streams(after), [{ ...operations[0], record_index: 7 }]), "INVALID_TARGET");
  guardCode(() => verifyPreservation(streams(before), streams(after), OP), "PRESERVATION_MISMATCH");
  for (const index of [4, 5, 6]) {
    guardCode(() => verifyPreservation(streams(before), streams(after.filter((_, current) => current !== index)), operations), "PRESERVATION_MISMATCH");
    guardCode(() => verifyPreservation(streams(before), streams(replaceRecord(after, index, { payload: after[index].payload.slice(0, -1) })), operations), "PRESERVATION_MISMATCH");
    guardCode(() => verifyPreservation(streams(before), streams(replaceRecord(after, index, { payload: mutateByte(after[index].payload, 1) })), operations), "PRESERVATION_MISMATCH");
  }
});

test("inline tab keeps width/type metadata across visible text edits", () => {
  const tab = concat(u16(9), new Uint8Array(12).fill(0x22), u16(9));
  const before = paragraph("before", { last: true, controls: tab });
  const after = paragraph("after 😀", { last: true, controls: tab });
  assert.equal(verifyPreservation(streams(before), streams(after), OP).verified, true);
  guardCode(() => verifyPreservation(streams(before), streams(paragraph("after 😀", { last: true })), OP), "PRESERVATION_MISMATCH");
  const changed = paragraph("after 😀", { last: true, controls: mutateByte(tab, 4) });
  guardCode(() => verifyPreservation(streams(before), streams(changed), OP), "PRESERVATION_MISMATCH");
});

for (const code of [0, 10, 24, 28, 31]) {
  test(`single-unit control ${code} cannot disappear`, () => {
    const before = paragraph("before", { last: true, controls: u16(code) });
    const after = paragraph("after 😀", { last: true, controls: u16(code) });
    assert.equal(verifyPreservation(streams(before), streams(after), OP).verified, true);
    guardCode(() => verifyPreservation(streams(before), streams(paragraph("after 😀", { last: true })), OP), "PRESERVATION_MISMATCH");
  });
}

for (const code of [...Array.from({ length: 9 }, (_, index) => index + 1), 11, 12,
  ...Array.from({ length: 10 }, (_, index) => index + 14)]) {
  test(`eight-unit control ${code} retains its whole binary slot`, () => {
    const slot = concat(u16(code), new Uint8Array(12).fill(0x55), u16(code));
    assert.deepEqual(textControlBytes(concat(utf16("visible 😀"), slot, u16(13))), concat(slot, u16(13)));
    guardCode(() => textControlBytes(u16(code)), "TRUNCATED_TEXT_CONTROL");
  });
}

for (const [description, index, payload, code] of [
  ["paragraph header shorter than supported layout", 0, new Uint8Array(21), "INVALID_PARAGRAPH_HEADER"],
  ["target odd text tail", 1, new Uint8Array(3), "INVALID_TEXT_TAIL"],
  ["target truncated inline control", 1, u16(9), "TRUNCATED_TEXT_CONTROL"],
  ["target char-shape opaque tail", 2, new Uint8Array(9), "INVALID_CHAR_SHAPE_TAIL"],
  ["target line-segment opaque tail", 3, new Uint8Array(37), "INVALID_LINE_SEGMENT_TAIL"],
  ["non-target line-segment opaque tail", 7, new Uint8Array(37), "INVALID_LINE_SEGMENT_TAIL"],
]) {
  test(`canonical guard refuses ${description}`, () => {
    const malformed = streams(replaceRecord(AFTER, index, { payload }));
    // Compare the malformed layout against itself to exercise validation rather
    // than allow an earlier unrelated mismatch to short-circuit the comparison.
    guardCode(() => verifyPreservation(malformed, malformed, OP), code);
  });
}

test("non-target opaque text/shape tails remain byte-identical, not reinterpreted", () => {
  let before = replaceRecord(BEFORE, 5, { payload: new Uint8Array([7, 3, 1]) });
  before = replaceRecord(before, 6, { payload: new Uint8Array(9).fill(3) });
  let after = replaceRecord(AFTER, 5, { payload: before[5].payload });
  after = replaceRecord(after, 6, { payload: before[6].payload });
  assert.equal(verifyPreservation(streams(before), streams(after), OP).verified, true);
});

test("only saved caret bytes in DocInfo may change; counters/tail must survive", () => {
  const before = streams(BEFORE);
  const after = streams(AFTER);
  const docinfo = concat(envelope(16, new Uint8Array(26)), envelope(19, OPAQUE));
  before.set("DocInfo", docinfo);
  const caret = docinfo.slice();
  caret.fill(0x44, 18, 30);
  after.set("DocInfo", caret);
  assert.equal(verifyPreservation(before, after, OP).verified, true);
  for (const offset of [4, 17, 30, docinfo.length - 1]) {
    after.set("DocInfo", mutateByte(caret, offset));
    guardCode(() => verifyPreservation(before, after, OP), "PRESERVATION_MISMATCH");
  }
});

for (const [description, docinfo, code] of [
  ["short DocInfo", new Uint8Array(29), "INVALID_DOCINFO_LAYOUT"],
  ["wrong first tag", envelope(17, new Uint8Array(26)), "INVALID_DOCINFO_PROPERTIES"],
  ["wrong first level", envelope(16, new Uint8Array(26), 1), "INVALID_DOCINFO_PROPERTIES"],
  ["wrong first size", envelope(16, new Uint8Array(27)), "INVALID_DOCINFO_PROPERTIES"],
  ["extended first header", envelope(16, new Uint8Array(26), 0, true), "INVALID_DOCINFO_PROPERTIES"],
]) {
  test(`DocInfo canonical guard refuses ${description}`, () => {
    const input = streams(BEFORE, [["DocInfo", docinfo]]);
    guardCode(() => verifyPreservation(input, input, []), code);
  });
}

test("DocInfo length has the Python 8 MiB cap even after caller decoding", () => {
  const input = streams(BEFORE, [["DocInfo", new Uint8Array(8 * 1024 * 1024 + 1)]]);
  guardCode(() => verifyPreservation(input, input, []), "INVALID_DOCINFO_LAYOUT");
});

test("stream sets are immutable and only preview payloads are excluded", () => {
  const before = streams(BEFORE, [["PrvText", OPAQUE], ["PrvImage", OPAQUE], ["BinData/BIN0001", OPAQUE]]);
  const after = streams(AFTER, [["PrvText", new Uint8Array()], ["PrvImage", u32(9)], ["BinData/BIN0001", OPAQUE]]);
  assert.equal(verifyPreservation(before, after, OP).verified, true);
  after.delete("PrvText");
  guardCode(() => verifyPreservation(before, after, OP), "STREAM_SET_CHANGED");
  after.set("PrvText", OPAQUE);
  after.set("BinData/BIN0001", mutateByte(OPAQUE, 0));
  guardCode(() => verifyPreservation(before, after, OP), "PRESERVATION_MISMATCH");
  after.set("BinData/BIN0001", OPAQUE);
  after.set("FileHeader", mutateByte(after.get("FileHeader"), 36));
  guardCode(() => verifyPreservation(before, after, OP), "PRESERVATION_MISMATCH");
});

test("similar prefix to a preview stream does not exempt opaque data", () => {
  const before = streams(BEFORE, [["PrvTextOther", OPAQUE]]);
  const after = streams(AFTER, [["PrvTextOther", new Uint8Array()]]);
  guardCode(() => verifyPreservation(before, after, OP), "PRESERVATION_MISMATCH");
});

test("same-size stream name replacement is rejected", () => {
  const before = streams(BEFORE, [["BinData/BIN0001", OPAQUE]]);
  const after = streams(AFTER, [["BinData/BIN0002", OPAQUE]]);
  guardCode(() => verifyPreservation(before, after, OP), "STREAM_SET_CHANGED");
});

for (const name of ["FileHeader", "DocInfo", "BodyText/Section0"]) {
  test(`full preservation requires ${name}`, () => {
    const input = streams(BEFORE);
    input.delete(name);
    guardCode(() => verifyPreservation(input, input, []), "REQUIRED_STREAM_MISSING");
  });
}

test("later sections and targets preserve all non-target sections", () => {
  const first = paragraph("section zero", { last: true });
  const before = streams(first, [["BodyText/Section1", encode(BEFORE)]]);
  const after = streams(first, [["BodyText/Section1", encode(AFTER)]]);
  assert.equal(verifyPreservation(before, after, [{ ...OP[0], section: 1 }]).verified, true);
  guardCode(() => verifyPreservation(before, after, OP), "PRESERVATION_MISMATCH");
});

for (const [description, operations, code] of [
  ["not an array", null, "INVALID_OPERATIONS"],
  ["missing ordinal", [{ section: 0 }], "INVALID_OPERATIONS"],
  ["null operation", [null], "INVALID_OPERATIONS"],
  ["array operation", [[]], "INVALID_OPERATIONS"],
  ["negative section", [{ section: -1, record_index: 0 }], "INVALID_OPERATIONS"],
  ["negative ordinal", [{ section: 0, record_index: -1 }], "INVALID_OPERATIONS"],
  ["fractional ordinal", [{ section: 0, record_index: 0.5 }], "INVALID_OPERATIONS"],
  ["unsafe ordinal", [{ section: 0, record_index: 2 ** 53 }], "INVALID_OPERATIONS"],
  ["new_text type", [{ section: 0, record_index: 0, new_text: 123 }], "INVALID_OPERATIONS"],
  ["missing section", [{ section: 1, record_index: 0 }], "INVALID_TARGET"],
  ["missing paragraph", [{ section: 0, record_index: 2 }], "INVALID_TARGET"],
  ["duplicate target", [OP[0], OP[0]], "DUPLICATE_TARGET"],
]) {
  test(`operation contract refuses ${description}`, () => {
    const input = streams(BEFORE);
    guardCode(() => verifyPreservation(input, input, operations), code);
  });
}

test("added unknown record cannot be hidden by matching raw stream contents", () => {
  const before = streams(BEFORE);
  const after = streams([...AFTER, spec(1000, OPAQUE)]);
  guardCode(() => verifyPreservation(before, after, OP), "UNSUPPORTED_BODY_RECORD");
});

test("no-target roundtrip checks all body text instead of granting default rewrite permission", () => {
  const before = streams(BEFORE);
  assert.equal(verifyPreservation(before, before, []).verified, true);
  guardCode(() => verifyPreservation(before, streams(AFTER), []), "PRESERVATION_MISMATCH");
});
