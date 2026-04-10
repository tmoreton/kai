/**
 * Symbol Index - Fast in-memory symbol indexing for code navigation
 * Falls back to regex-based parsing when LSP unavailable
 */

import fs from "fs";
import path from "path";
import { glob } from "glob";
import type { SymbolInfo, Location, Position, Range } from "./types.js";
import { SymbolKind } from "./types.js";

// File extensions by language
const EXTENSIONS: Record<string, string[]> = {
  typescript: [".ts", ".tsx"],
  javascript: [".js", ".jsx"],
  python: [".py"],
};

// Regex patterns for symbol extraction (fallback when no LSP)
const SYMBOL_PATTERNS: Record<string, RegExp[]> = {
  typescript: [
    // Export function/class/interface/const/let/var
    /export\s+(?:async\s+)?(?:function|class|interface|type|const|let|var|enum)\s+(\w+)/g,
    // Function declarations
    /(?:async\s+)?function\s+(\w+)\s*\(/g,
    // Method definitions
    /(\w+)\s*\([^)]*\)\s*[:\{]/g,
    // Class methods
    /(?:public|private|protected|static|readonly)?\s*(\w+)\s*\([^)]*\)\s*[:\{]/g,
    // Interface properties
    /(\w+)\s*[:?]\s*[^;,=]+[,;]/g,
    // Arrow functions assigned to const
    /const\s+(\w+)\s*[=:]\s*[^=]*=>/g,
    // React components (uppercase functions)
    /(?:function|const)\s+([A-Z][A-Za-z0-9]*)\s*[=\(]/g,
  ],
  javascript: [
    /export\s+(?:default\s+)?(?:function|class|const|let|var)\s+(\w+)/g,
    /(?:async\s+)?function\s+(\w+)\s*\(/g,
    /const\s+(\w+)\s*[=:]\s*[^=]*=>/g,
    /(?:function|const)\s+([A-Z][A-Z][A-Za-z0-9]*)\s*[=\(]/g,
  ],
  python: [
    /(?:async\s+)?def\s+(\w+)\s*\(/g,
    /class\s+(\w+)\s*[\(:]/g,
    /^([A-Z_][A-Z0-9_]*)\s*=/gm,
  ],
};

export function fileToUri(filePath: string): string {
  // Convert file path to file:// URI
  const absolute = path.resolve(filePath);
  return "file://" + absolute;
}

export function uriToFile(uri: string): string {
  return uri.replace(/^file:\/\//, "");
}

export class SymbolIndex {
  private workspace: string;
  private languageId: string;
  
  // filePath -> symbols in that file
  private fileSymbols = new Map<string, SymbolInfo[]>();
  
  // symbol name -> all locations
  private nameIndex = new Map<string, SymbolInfo[]>();
  
  // symbol name -> locations where it's referenced
  private referenceIndex = new Map<string, Location[]>();

  constructor(workspace: string, languageId: string) {
    this.workspace = workspace;
    this.languageId = languageId;
  }

  /**
   * Build index from all files in workspace
   */
  async buildIndex(): Promise<void> {
    const exts = EXTENSIONS[this.languageId] || [".ts"];
    const pattern = `**/*{${exts.join(",")}}`;
    
    const files = await glob(pattern, {
      cwd: this.workspace,
      ignore: ["**/node_modules/**", "**/dist/**", "**/build/**", "**/.git/**"],
      absolute: true,
    });

    for (const file of files.slice(0, 1000)) { // Limit to prevent memory issues
      try {
        const content = fs.readFileSync(file, "utf-8");
        await this.indexFile(file, content);
      } catch {
        // Skip unreadable files
      }
    }

    console.log(`Indexed ${this.fileSymbols.size} files, ${this.nameIndex.size} unique symbols`);
  }

  /**
   * Index a single file
   */
  async indexFile(filePath: string, content: string): Promise<void> {
    const symbols = this.extractSymbols(filePath, content);
    this.fileSymbols.set(filePath, symbols);

    // Update name index
    for (const symbol of symbols) {
      const existing = this.nameIndex.get(symbol.name) || [];
      existing.push(symbol);
      this.nameIndex.set(symbol.name, existing);
    }

    // Build reference index (approximate)
    this.buildReferences(filePath, content, symbols);
  }

  /**
   * Update file in index
   */
  async updateFile(filePath: string, content: string): Promise<void> {
    // Remove old symbols for this file
    const oldSymbols = this.fileSymbols.get(filePath) || [];
    for (const symbol of oldSymbols) {
      const existing = this.nameIndex.get(symbol.name) || [];
      const filtered = existing.filter((s) => s.location.uri !== fileToUri(filePath));
      if (filtered.length > 0) {
        this.nameIndex.set(symbol.name, filtered);
      } else {
        this.nameIndex.delete(symbol.name);
      }
    }

    // Re-index
    await this.indexFile(filePath, content);
  }

  /**
   * Find symbols by name (exact or partial match)
   */
  findByName(name: string, type?: string): SymbolInfo[] {
    // Exact match
    const exact = this.nameIndex.get(name);
    if (exact) {
      return type ? this.filterByType(exact, type) : exact;
    }

    // Partial match
    const results: SymbolInfo[] = [];
    const lowerName = name.toLowerCase();
    
    for (const [symbolName, symbols] of this.nameIndex) {
      if (symbolName.toLowerCase().includes(lowerName)) {
        results.push(...symbols);
      }
    }

    return type ? this.filterByType(results, type) : results;
  }

  /**
   * Find symbols in a specific file
   */
  findInFile(filePath: string): SymbolInfo[] {
    return this.fileSymbols.get(filePath) || [];
  }

  /**
   * Find references to a symbol
   */
  findReferences(name: string): Location[] {
    return this.referenceIndex.get(name) || [];
  }

  /**
   * Get all symbols of a specific type
   */
  getAllByType(type: string): SymbolInfo[] {
    const results: SymbolInfo[] = [];
    for (const symbols of this.nameIndex.values()) {
      results.push(...this.filterByType(symbols, type));
    }
    return results;
  }

  /**
   * Get index statistics
   */
  getStats(): { files: number; symbols: number; references: number } {
    let totalSymbols = 0;
    for (const symbols of this.fileSymbols.values()) {
      totalSymbols += symbols.length;
    }
    
    let totalRefs = 0;
    for (const refs of this.referenceIndex.values()) {
      totalRefs += refs.length;
    }
    
    return {
      files: this.fileSymbols.size,
      symbols: totalSymbols,
      references: totalRefs,
    };
  }

  // === Private methods ===

  private extractSymbols(filePath: string, content: string): SymbolInfo[] {
    const patterns = SYMBOL_PATTERNS[this.languageId] || SYMBOL_PATTERNS.typescript;
    const symbols: SymbolInfo[] = [];
    const lines = content.split("\n");
    const seen = new Set<string>(); // Prevent duplicates

    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(content)) !== null) {
        const name = match[1];
        if (!name || seen.has(name)) continue;
        seen.add(name);

        // Find line number
        const upToMatch = content.substring(0, match.index);
        const line = upToMatch.split("\n").length - 1;
        const lineContent = lines[line] || "";
        const character = lineContent.indexOf(name);

        // Determine kind
        const kind = this.inferKind(lineContent, name);

        symbols.push({
          name,
          kind,
          location: {
            uri: fileToUri(filePath),
            range: {
              start: { line, character: Math.max(0, character) },
              end: { line, character: Math.max(0, character) + name.length },
            },
          },
        });
      }
      // Reset regex
      pattern.lastIndex = 0;
    }

    return symbols;
  }

  private inferKind(lineContent: string, name: string): SymbolKind {
    const lower = lineContent.toLowerCase();
    
    if (lower.includes("class ") && lower.includes(name.toLowerCase())) {
      return SymbolKind.Class;
    }
    if (lower.includes("interface ") && lower.includes(name.toLowerCase())) {
      return SymbolKind.Interface;
    }
    if (lower.includes("function ") && lower.includes(name.toLowerCase())) {
      return SymbolKind.Function;
    }
    if (lower.includes("const ") && lower.includes(name.toLowerCase())) {
      return SymbolKind.Constant;
    }
    if (lower.includes("export ") && lower.includes(name.toLowerCase())) {
      if (/^[A-Z]/.test(name)) {
        return SymbolKind.Class;
      }
      return SymbolKind.Function;
    }
    if (name[0] === name[0].toUpperCase() && name[0] !== name[0].toLowerCase()) {
      // PascalCase - likely a class or component
      if (lower.includes("function") || lower.includes("const") || lower.includes("=>")) {
        return SymbolKind.Function; // React component
      }
      return SymbolKind.Class;
    }
    
    return SymbolKind.Function;
  }

  private buildReferences(filePath: string, content: string, symbols: SymbolInfo[]): void {
    // Simple reference detection - find mentions of symbol names
    const lines = content.split("\n");
    
    for (const symbol of symbols) {
      const refs: Location[] = [];
      const name = symbol.name;
      
      // Simple regex to find usages (not perfect but fast)
      const usagePattern = new RegExp(`\\b${this.escapeRegex(name)}\\b`, "g");
      
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        let match;
        while ((match = usagePattern.exec(line)) !== null) {
          // Skip the definition line
          if (i === symbol.location.range.start.line && 
              match.index >= symbol.location.range.start.character &&
              match.index <= symbol.location.range.end.character) {
            continue;
          }
          
          refs.push({
            uri: fileToUri(filePath),
            range: {
              start: { line: i, character: match.index },
              end: { line: i, character: match.index + name.length },
            },
          });
        }
        usagePattern.lastIndex = 0;
      }
      
      const existing = this.referenceIndex.get(name) || [];
      this.referenceIndex.set(name, [...existing, ...refs]);
    }
  }

  private filterByType(symbols: SymbolInfo[], type: string): SymbolInfo[] {
    const kindMap: Record<string, SymbolKind> = {
      function: SymbolKind.Function,
      class: SymbolKind.Class,
      interface: SymbolKind.Interface,
      variable: SymbolKind.Variable,
      constant: SymbolKind.Constant,
      import: SymbolKind.Module,
    };
    
    const kind = kindMap[type];
    if (!kind) return symbols;
    
    return symbols.filter((s) => s.kind === kind);
  }

  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
}
