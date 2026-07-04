#!/usr/bin/env node
// Validates the Monday Compiler DSL example fixture.
//   1. JSON Schema (ajv) — intra-row shape
//   2. Cross-sheet reference integrity
//   3. Sheet processing-order (no forward references)
// Exit code: 0 on success, 1 on any failure.
// Usage: node scripts/verify-monday-fixture.mjs

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const schemaPath = resolve(repoRoot, "docs/monday-compiler/schema.json");
const fixturePath = resolve(repoRoot, "docs/monday-compiler/examples/summit-realty.json");

const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));

// ---------- Phase 1: JSON Schema ----------
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validate = ajv.compile(schema);
const schemaOk = validate(fixture);

// ---------- Phase 2: Cross-sheet refs ----------
const PROCESSING_ORDER = [
  "workspaces", "boards", "groups", "enums", "columns",
  "items", "dataMappings", "members", "dashboards",
  "widgets", "views", "webhooks", "aiJobs", "appInstalls"
];
const orderIndex = Object.fromEntries(PROCESSING_ORDER.map((s, i) => [s, i]));

// Build alias indices per sheet. For Enums, the alias is reused across rows,
// so we collapse to a Set of distinct aliases plus track label index uniqueness.
const aliasIndex = {};
for (const sheet of PROCESSING_ORDER) {
  aliasIndex[sheet] = new Set();
}

// Members has no alias; skip.
const errors = [];

function checkDuplicateAliases(sheetKey, rows, ignoreDuplicates = false) {
  if (!Array.isArray(rows)) return;
  const seen = new Set();
  for (const [i, row] of rows.entries()) {
    if (!row || typeof row !== "object") continue;
    const a = row.alias;
    if (!a) continue;
    if (seen.has(a) && !ignoreDuplicates) {
      errors.push(`[${sheetKey}] duplicate alias "${a}" at row ${i}`);
    }
    seen.add(a);
    aliasIndex[sheetKey].add(a);
  }
}

checkDuplicateAliases("workspaces", fixture.workspaces);
checkDuplicateAliases("boards", fixture.boards);
checkDuplicateAliases("groups", fixture.groups);
checkDuplicateAliases("enums", fixture.enums, /*ignoreDuplicates=*/ true); // multi-row alias = set
checkDuplicateAliases("columns", fixture.columns);
checkDuplicateAliases("items", fixture.items);
checkDuplicateAliases("dataMappings", fixture.dataMappings);
checkDuplicateAliases("dashboards", fixture.dashboards);
checkDuplicateAliases("widgets", fixture.widgets);
checkDuplicateAliases("views", fixture.views);
checkDuplicateAliases("webhooks", fixture.webhooks);
checkDuplicateAliases("aiJobs", fixture.aiJobs);

function expect(sheetFrom, sheetTo, fromRowIdx, fieldName, value) {
  if (value === undefined || value === null || value === "") return;
  if (!aliasIndex[sheetTo].has(value)) {
    errors.push(`[${sheetFrom} row ${fromRowIdx}] ${fieldName}="${value}" does not resolve to any ${sheetTo}.alias`);
    return;
  }
  if (orderIndex[sheetTo] > orderIndex[sheetFrom]) {
    errors.push(`[${sheetFrom} row ${fromRowIdx}] ${fieldName} is a forward reference (${sheetFrom} → ${sheetTo})`);
  }
}

function expectMany(sheetFrom, sheetTo, fromRowIdx, fieldName, values) {
  if (!values) return;
  const list = Array.isArray(values) ? values : String(values).split(",").map((s) => s.trim()).filter(Boolean);
  for (const v of list) expect(sheetFrom, sheetTo, fromRowIdx, fieldName, v);
}

// Meta
if (fixture.meta) {
  expect("meta", "workspaces", 0, "default_workspace_ref", fixture.meta.default_workspace_ref);
}

// Boards
(fixture.boards || []).forEach((row, i) => {
  expect("boards", "workspaces", i, "workspace_ref", row.workspace_ref);
});

// Groups
(fixture.groups || []).forEach((row, i) => {
  expect("groups", "boards", i, "board_ref", row.board_ref);
});

// Enums: check contiguous label_index_int starting at 0 per alias
const enumsByAlias = {};
for (const row of fixture.enums || []) {
  if (!row?.alias) continue;
  (enumsByAlias[row.alias] ||= []).push(row.label_index_int);
}
for (const [alias, idxs] of Object.entries(enumsByAlias)) {
  const sorted = [...idxs].sort((a, b) => a - b);
  const unique = new Set(sorted);
  if (unique.size !== sorted.length) {
    errors.push(`[enums] alias "${alias}" has duplicate label_index_int values`);
  }
  if (sorted[0] !== 0) {
    errors.push(`[enums] alias "${alias}" does not start at label_index_int=0`);
  }
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i] !== i) {
      errors.push(`[enums] alias "${alias}" label_index_int sequence is not contiguous (got ${sorted.join(",")})`);
      break;
    }
  }
}

// Columns
const columnBoardByAlias = {};
(fixture.columns || []).forEach((row, i) => {
  expect("columns", "boards", i, "board_ref", row.board_ref);
  if (row.alias) columnBoardByAlias[row.alias] = row.board_ref;
  if ((row.type === "status" || row.type === "dropdown")) {
    if (!row.enum_ref && !row.inline_labels_json) {
      errors.push(`[columns row ${i}] ${row.alias}: type=${row.type} needs enum_ref or inline_labels_json`);
    }
    if (row.enum_ref) expect("columns", "enums", i, "enum_ref", row.enum_ref);
  }
  if (row.type === "board_relation") {
    if (!row.target_board_ref) {
      errors.push(`[columns row ${i}] ${row.alias}: type=board_relation requires target_board_ref`);
    } else {
      expect("columns", "boards", i, "target_board_ref", row.target_board_ref);
    }
  }
  if (row.type === "mirror") {
    if (!row.mirror_source_column_ref) {
      errors.push(`[columns row ${i}] ${row.alias}: type=mirror requires mirror_source_column_ref`);
    } else {
      expect("columns", "columns", i, "mirror_source_column_ref", row.mirror_source_column_ref);
    }
  }
  if (row.type === "dependency") {
    if (!row.dependency_column_ref) {
      errors.push(`[columns row ${i}] ${row.alias}: type=dependency requires dependency_column_ref`);
    } else {
      expect("columns", "columns", i, "dependency_column_ref", row.dependency_column_ref);
    }
  }
});

// Groups belonging to a given board
const groupsByBoard = {};
const groupBoardByAlias = {};
(fixture.groups || []).forEach((row) => {
  if (row.board_ref && row.alias) {
    (groupsByBoard[row.board_ref] ||= new Set()).add(row.alias);
    groupBoardByAlias[row.alias] = row.board_ref;
  }
});

// Items
(fixture.items || []).forEach((row, i) => {
  expect("items", "boards", i, "board_ref", row.board_ref);
  expect("items", "groups", i, "group_ref", row.group_ref);
  if (row.group_ref && row.board_ref && groupBoardByAlias[row.group_ref] && groupBoardByAlias[row.group_ref] !== row.board_ref) {
    errors.push(`[items row ${i}] group_ref "${row.group_ref}" belongs to board "${groupBoardByAlias[row.group_ref]}", not "${row.board_ref}"`);
  }
  if (row.parent_item_ref) expect("items", "items", i, "parent_item_ref", row.parent_item_ref);
  if (row.column_values_json && typeof row.column_values_json === "object") {
    for (const key of Object.keys(row.column_values_json)) {
      if (!aliasIndex.columns.has(key)) {
        errors.push(`[items row ${i}] column_values_json key "${key}" is not a Columns.alias`);
      } else if (columnBoardByAlias[key] && columnBoardByAlias[key] !== row.board_ref) {
        errors.push(`[items row ${i}] column_values_json key "${key}" is on board "${columnBoardByAlias[key]}", not item board "${row.board_ref}"`);
      }
    }
  }
});

// DataMappings
(fixture.dataMappings || []).forEach((row, i) => {
  expect("dataMappings", "boards", i, "target_board_ref", row.target_board_ref);
  if (row.target_group_ref) expect("dataMappings", "groups", i, "target_group_ref", row.target_group_ref);
  if (row.field_map_json && typeof row.field_map_json === "object") {
    for (const [src, colAlias] of Object.entries(row.field_map_json)) {
      if (!aliasIndex.columns.has(colAlias)) {
        errors.push(`[dataMappings row ${i}] field_map_json maps "${src}"→"${colAlias}" — column alias not found`);
      } else if (row.target_board_ref && columnBoardByAlias[colAlias] !== row.target_board_ref) {
        errors.push(`[dataMappings row ${i}] field_map_json target column "${colAlias}" is on board "${columnBoardByAlias[colAlias]}", not target "${row.target_board_ref}"`);
      }
    }
  }
});

// Members
(fixture.members || []).forEach((row, i) => {
  expectMany("members", "boards", i, "board_refs", row.board_refs);
});

// Dashboards
const dashboardBoards = {};
(fixture.dashboards || []).forEach((row, i) => {
  expect("dashboards", "workspaces", i, "workspace_ref", row.workspace_ref);
  expectMany("dashboards", "boards", i, "board_refs", row.board_refs);
  if (row.alias) {
    const list = Array.isArray(row.board_refs) ? row.board_refs : String(row.board_refs || "").split(",").map((s) => s.trim()).filter(Boolean);
    dashboardBoards[row.alias] = new Set(list);
  }
});

// Widgets
(fixture.widgets || []).forEach((row, i) => {
  expect("widgets", "dashboards", i, "dashboard_ref", row.dashboard_ref);
  expect("widgets", "boards", i, "source_board_ref", row.source_board_ref);
  if (row.dashboard_ref && row.source_board_ref && dashboardBoards[row.dashboard_ref] && !dashboardBoards[row.dashboard_ref].has(row.source_board_ref)) {
    errors.push(`[widgets row ${i}] source_board_ref "${row.source_board_ref}" is not in parent dashboard "${row.dashboard_ref}".board_refs`);
  }
});

// Views
(fixture.views || []).forEach((row, i) => {
  expect("views", "boards", i, "board_ref", row.board_ref);
});

// Webhooks
const webhookBoardByAlias = {};
(fixture.webhooks || []).forEach((row, i) => {
  expect("webhooks", "boards", i, "board_ref", row.board_ref);
  if (row.alias && row.board_ref) webhookBoardByAlias[row.alias] = row.board_ref;
});

// AIJobs
(fixture.aiJobs || []).forEach((row, i) => {
  expect("aiJobs", "webhooks", i, "trigger_webhook_ref", row.trigger_webhook_ref);
  expectMany("aiJobs", "columns", i, "input_columns", row.input_columns);
  expect("aiJobs", "columns", i, "output_column_ref", row.output_column_ref);
  const hookBoard = webhookBoardByAlias[row.trigger_webhook_ref];
  if (hookBoard && row.output_column_ref && columnBoardByAlias[row.output_column_ref] && columnBoardByAlias[row.output_column_ref] !== hookBoard) {
    errors.push(`[aiJobs row ${i}] output_column_ref "${row.output_column_ref}" is on board "${columnBoardByAlias[row.output_column_ref]}", but its trigger webhook fires on "${hookBoard}"`);
  }
  const inputList = Array.isArray(row.input_columns) ? row.input_columns : [];
  for (const c of inputList) {
    if (hookBoard && columnBoardByAlias[c] && columnBoardByAlias[c] !== hookBoard) {
      errors.push(`[aiJobs row ${i}] input_columns entry "${c}" is on board "${columnBoardByAlias[c]}", not the trigger's board "${hookBoard}"`);
    }
  }
});

// AppInstalls
(fixture.appInstalls || []).forEach((row, i) => {
  expect("appInstalls", "workspaces", i, "workspace_ref", row.workspace_ref);
  expectMany("appInstalls", "boards", i, "board_refs", row.board_refs);
});

// ---------- Report ----------
let failed = false;

console.log("Monday Compiler DSL — fixture verification");
console.log("------------------------------------------");
console.log(`fixture: ${fixturePath}`);
console.log(`schema:  ${schemaPath}`);
console.log("");

if (!schemaOk) {
  failed = true;
  console.log(`JSON Schema: FAIL (${validate.errors.length} errors)`);
  for (const e of validate.errors.slice(0, 50)) {
    console.log(`  ${e.instancePath || "<root>"} ${e.message}${e.params ? " " + JSON.stringify(e.params) : ""}`);
  }
  if (validate.errors.length > 50) console.log(`  ... and ${validate.errors.length - 50} more`);
} else {
  console.log("JSON Schema: ok");
}

if (errors.length) {
  failed = true;
  console.log("");
  console.log(`Cross-ref validation: FAIL (${errors.length} errors)`);
  for (const e of errors) console.log(`  ${e}`);
} else {
  console.log("Cross-ref validation: ok");
}

console.log("");
console.log("Summary:");
console.log(`  workspaces:    ${fixture.workspaces?.length ?? 0}`);
console.log(`  boards:        ${fixture.boards?.length ?? 0}`);
console.log(`  groups:        ${fixture.groups?.length ?? 0}`);
console.log(`  columns:       ${fixture.columns?.length ?? 0}`);
console.log(`  enum sets:     ${Object.keys(enumsByAlias).length}`);
console.log(`  items:         ${fixture.items?.length ?? 0}`);
console.log(`  dataMappings:  ${fixture.dataMappings?.length ?? 0}`);
console.log(`  dashboards:    ${fixture.dashboards?.length ?? 0}`);
console.log(`  widgets:       ${fixture.widgets?.length ?? 0}`);
console.log(`  views:         ${fixture.views?.length ?? 0}`);
console.log(`  webhooks:      ${fixture.webhooks?.length ?? 0}`);
console.log(`  aiJobs:        ${fixture.aiJobs?.length ?? 0}`);
console.log(`  appInstalls:   ${fixture.appInstalls?.length ?? 0}`);

process.exit(failed ? 1 : 0);
