#!/usr/bin/env node
// Regenerates docs/monday-compiler/examples/summit-realty.xlsx from the JSON fixture.
// Usage: node scripts/generate-monday-example.mjs

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import ExcelJS from "exceljs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const fixturePath = resolve(repoRoot, "docs/monday-compiler/examples/summit-realty.json");
const outPath = resolve(repoRoot, "docs/monday-compiler/examples/summit-realty.xlsx");

const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));

const JSON_COLS = new Set([
  "inline_labels_json",
  "settings_json",
  "column_values_json",
  "field_map_json",
  "config_json"
]);

const REFLIST_COLS = new Set([
  "board_refs",
  "input_columns"
]);

function toCell(key, value) {
  if (value === undefined || value === null) return "";
  if (JSON_COLS.has(key)) {
    return typeof value === "string" ? value : JSON.stringify(value);
  }
  if (REFLIST_COLS.has(key)) {
    if (Array.isArray(value)) return value.join(",");
    return String(value);
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "object") return JSON.stringify(value);
  return value;
}

const SHEETS = [
  {
    name: "_Meta",
    columns: ["dsl_version","client_id","monday_api_version","env","default_workspace_ref","strict_cross_refs","dry_run"],
    rows: () => [fixture.meta]
  },
  {
    name: "Workspaces",
    columns: ["alias","name","kind","description"],
    rows: () => fixture.workspaces
  },
  {
    name: "Boards",
    columns: ["alias","workspace_ref","name","board_kind","folder_name","template_board_id","description"],
    rows: () => fixture.boards
  },
  {
    name: "Groups",
    columns: ["alias","board_ref","name","position_int","color_hint"],
    rows: () => fixture.groups
  },
  {
    name: "Enums",
    columns: ["alias","label_index_int","label_text","color"],
    rows: () => fixture.enums
  },
  {
    name: "Columns",
    columns: ["alias","board_ref","title","type","enum_ref","inline_labels_json","target_board_ref","mirror_source_column_ref","dependency_column_ref","formula_text","settings_json","description","required_for_item"],
    rows: () => fixture.columns
  },
  {
    name: "Items",
    columns: ["alias","board_ref","group_ref","name","column_values_json","parent_item_ref"],
    rows: () => fixture.items
  },
  {
    name: "DataMappings",
    columns: ["alias","target_board_ref","target_group_ref","source_type","source_locator","field_map_json","group_by_field","rate_limit_hint","schedule","dedup_key"],
    rows: () => fixture.dataMappings
  },
  {
    name: "Members",
    columns: ["identifier","kind","board_refs","role"],
    rows: () => fixture.members
  },
  {
    name: "Dashboards",
    columns: ["alias","workspace_ref","name","board_refs","description"],
    rows: () => fixture.dashboards
  },
  {
    name: "Widgets",
    columns: ["alias","dashboard_ref","type","source_board_ref","name","config_json"],
    rows: () => fixture.widgets
  },
  {
    name: "Views",
    columns: ["alias","board_ref","name","type","config_json"],
    rows: () => fixture.views
  },
  {
    name: "Webhooks",
    columns: ["alias","board_ref","event","target_url","config_json"],
    rows: () => fixture.webhooks
  },
  {
    name: "AIJobs",
    columns: ["alias","trigger_webhook_ref","prompt_template","input_columns","output_column_ref","model_hint","retry_policy","max_tokens_hint"],
    rows: () => fixture.aiJobs
  },
  {
    name: "AppInstalls",
    columns: ["app_slug","workspace_ref","board_refs","config_json","manual_install_required"],
    rows: () => fixture.appInstalls
  }
];

const workbook = new ExcelJS.Workbook();
workbook.creator = "Unilift — Monday Compiler DSL Generator";
workbook.created = new Date();

for (const sheet of SHEETS) {
  const ws = workbook.addWorksheet(sheet.name, {
    views: [{ state: "frozen", ySplit: 1 }]
  });
  ws.columns = sheet.columns.map((c) => ({ header: c, key: c, width: Math.max(14, c.length + 2) }));
  const headerRow = ws.getRow(1);
  headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
  headerRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E1B4B" } };
  headerRow.alignment = { vertical: "middle", horizontal: "left" };
  headerRow.height = 22;

  const rows = sheet.rows() || [];
  for (const row of rows) {
    const rowData = {};
    for (const col of sheet.columns) {
      rowData[col] = toCell(col, row?.[col]);
    }
    ws.addRow(rowData);
  }

  const aliasColIdx = sheet.columns.indexOf("alias");
  if (aliasColIdx >= 0) {
    ws.getColumn(aliasColIdx + 1).font = { name: "Consolas", size: 10 };
  }
  const jsonColNames = sheet.columns.filter((c) => JSON_COLS.has(c));
  for (const c of jsonColNames) {
    ws.getColumn(c).alignment = { wrapText: true, vertical: "top" };
    ws.getColumn(c).width = 60;
  }
}

await workbook.xlsx.writeFile(outPath);
console.log(`Wrote ${outPath}`);
console.log(`  sheets: ${SHEETS.length}`);
console.log(`  total rows: ${SHEETS.reduce((acc, s) => acc + (s.rows()?.length ?? 0), 0)}`);
