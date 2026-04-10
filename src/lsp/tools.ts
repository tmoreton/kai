/**
 * LSP-based tools - Replacement for grep with semantic code understanding
 * Falls back to grep when LSP unavailable or fails
 */

import path from "path";
import { getLSPManager } from "./manager.js";
import { grepTool } from "../tools/search.js";
import type { Position } from "./types.js";

// Maximum results to return
const MAX_RESULTS = 100;

/**
 * Find symbols by name or pattern
 * Replaces: grep pattern="export function|class MyClass"
 */
export async function findSymbol(args: {
  name: string;
  type?: "function" | "class" | "interface" | "variable" | "constant" | "import";
  file?: string;
  path?: string;
}): Promise<string> {
  const workspace = args.path ? path.resolve(args.path) : process.cwd();
  const manager = getLSPManager();

  // Ensure LSP is started
  await manager.start(workspace, "typescript");

  try {
    const results = await manager.findSymbol(workspace, {
      name: args.name,
      type: args.type,
      file: args.file,
    });

    if (results.length === 0) {
      // Fall back to grep
      return smartGrepFallback(args);
    }

    return formatSymbolResults(results.slice(0, MAX_RESULTS));
  } catch (err) {
    // Fall back to grep on error
    return smartGrepFallback(args);
  }
}

/**
 * Go to definition of a symbol
 * Replaces: grep pattern="function myFunction|class MyClass"
 */
export async function gotoDefinition(args: {
  name: string;
  file?: string;
  path?: string;
}): Promise<string> {
  const workspace = args.path ? path.resolve(args.path) : process.cwd();
  const manager = getLSPManager();

  // Try LSP first
  const conn = manager.getConnection(workspace, "typescript");
  if (conn?.isReady && args.file) {
    try {
      // Find the symbol first to get position
      const symbols = await manager.findSymbol(workspace, { name: args.name, file: args.file });
      if (symbols.length > 0) {
        const symbol = symbols[0];
        const result = await manager.gotoDefinition(
          workspace,
          args.file,
          symbol.location.range.start
        );
        
        if (result) {
          return formatLocation(result);
        }
      }
    } catch {
      // Continue to fallback
    }
  }

  // Fall back to grep
  return smartGrepFallback({ name: args.name, file: args.file, path: args.path });
}

/**
 * Find all references to a symbol
 * Replaces: grep pattern="myFunction\("
 */
export async function findReferences(args: {
  name: string;
  file?: string;
  path?: string;
}): Promise<string> {
  const workspace = args.path ? path.resolve(args.path) : process.cwd();
  const manager = getLSPManager();

  // Ensure LSP is started
  await manager.start(workspace, "typescript");

  try {
    if (args.file) {
      // Find symbol position first
      const symbols = await manager.findSymbol(workspace, { name: args.name, file: args.file });
      if (symbols.length > 0) {
        const refs = await manager.findReferences(
          workspace,
          args.file,
          symbols[0].location.range.start
        );
        
        if (refs.length > 0) {
          return formatReferences(refs.slice(0, MAX_RESULTS));
        }
      }
    }

    // Try index-based search
    const results = await manager.findSymbol(workspace, { name: args.name });
    if (results.length > 0) {
      return formatSymbolResults(results.slice(0, MAX_RESULTS));
    }

    // Fall back to grep
    return smartGrepFallback(args);
  } catch (err) {
    return smartGrepFallback(args);
  }
}

/**
 * List all symbols in a file
 * Replaces: grep pattern="export|function|class"
 */
export async function listSymbols(args: {
  file: string;
  type?: "function" | "class" | "interface" | "variable";
  path?: string;
}): Promise<string> {
  const filePath = args.path ? path.resolve(args.path, args.file) : path.resolve(args.file);
  const workspace = path.dirname(filePath);
  const manager = getLSPManager();

  // Ensure LSP is started
  await manager.start(workspace, "typescript");

  try {
    const symbols = await manager.listSymbols(workspace, filePath);
    
    if (args.type) {
      const filtered = symbols.filter((s) => {
        const kindMap: Record<string, number> = {
          function: 12,
          class: 5,
          interface: 11,
          variable: 13,
        };
        return s.kind === kindMap[args.type!];
      });
      return formatSymbolResults(filtered.slice(0, MAX_RESULTS));
    }

    return formatSymbolResults(symbols.slice(0, MAX_RESULTS));
  } catch (err) {
    // Fall back to grep
    return smartGrepFallback({ pattern: "export|function|class|interface", path: filePath });
  }
}

/**
 * Smart grep fallback - tries semantic patterns first, falls back to raw grep
 */
async function smartGrepFallback(args: { name?: string; pattern?: string; file?: string; path?: string }): Promise<string> {
  // If we have a name, construct intelligent grep patterns
  if (args.name) {
    // Try common definition patterns
    const patterns = [
      `export\\s+(?:async\\s+)?(?:function|class|interface|const|let)\\s+${args.name}\\b`,
      `(?:async\\s+)?function\\s+${args.name}\\s*\\(`,
      `class\\s+${args.name}\\b`,
      `interface\\s+${args.name}\\b`,
      `const\\s+${args.name}\\s*=`,
      `${args.name}\\s*[:=]\\s*(?:async\\s*)?\\(`,
    ];

    for (const pattern of patterns) {
      const result = await grepTool({
        pattern,
        path: args.path,
        include: args.file ? undefined : "*.ts",
        context: 2,
      });

      if (!result.includes("No matches") && !result.includes("Error")) {
        return `LSP unavailable. Using grep fallback:\n${result}`;
      }
    }
  }

  // Raw grep fallback
  const result = await grepTool({
    pattern: args.pattern || args.name || "",
    path: args.path,
    include: args.file ? undefined : "*.ts",
    context: 2,
  });

  return `LSP unavailable. Using grep fallback:\n${result}`;
}

/**
 * Format symbol results for display
 */
function formatSymbolResults(symbols: { name: string; kind: number; location: { uri: string; range: { start: { line: number } } }; detail?: string }[]): string {
  if (symbols.length === 0) {
    return "No symbols found.";
  }

  const kindNames: Record<number, string> = {
    1: "File",
    2: "Module",
    3: "Namespace",
    4: "Package",
    5: "Class",
    6: "Method",
    7: "Property",
    8: "Field",
    9: "Constructor",
    10: "Enum",
    11: "Interface",
    12: "Function",
    13: "Variable",
    14: "Constant",
    15: "String",
    16: "Number",
    17: "Boolean",
    18: "Array",
    19: "Object",
    20: "Key",
    21: "Null",
    22: "EnumMember",
    23: "Struct",
    24: "Event",
    25: "Operator",
    26: "TypeParameter",
  };

  const lines = symbols.map((s) => {
    const file = s.location.uri.replace("file://", "");
    const line = s.location.range.start.line + 1;
    const kind = kindNames[s.kind] || "Unknown";
    const detail = s.detail ? ` (${s.detail})` : "";
    return `${kind}: ${s.name}${detail} at ${file}:${line}`;
  });

  if (symbols.length >= MAX_RESULTS) {
    lines.push(`\n[Showing first ${MAX_RESULTS} results]`);
  }

  return lines.join("\n");
}

/**
 * Format location for display
 */
function formatLocation(location: { uri: string; range: { start: { line: number; character: number } } }): string {
  const file = location.uri.replace("file://", "");
  const line = location.range.start.line + 1;
  const char = location.range.start.character;
  return `Definition at ${file}:${line}:${char}`;
}

/**
 * Format references for display
 */
function formatReferences(refs: { uri: string; range: { start: { line: number } } }[]): string {
  if (refs.length === 0) {
    return "No references found.";
  }

  const lines = refs.map((r) => {
    const file = r.uri.replace("file://", "");
    const line = r.range.start.line + 1;
    return `${file}:${line}`;
  });

  if (refs.length >= MAX_RESULTS) {
    lines.push(`\n[Showing first ${MAX_RESULTS} references]`);
  }

  return `Found ${refs.length} references:\n${lines.join("\n")}`;
}
