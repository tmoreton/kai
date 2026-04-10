/**
 * LSP Manager - Manages language server lifecycle and provides search capabilities
 */

import path from "path";
import { LSPClient } from "./client.js";
import { SymbolIndex, fileToUri } from "./symbol-index.js";
import type { SymbolInfo, Location, Position, SymbolQuery } from "./types.js";
import { EXCLUDED_DIRS } from "../constants.js";

interface LSPConnection {
  client: LSPClient;
  index: SymbolIndex;
  workspace: string;
  languageId: string;
  isReady: boolean;
}

// Language to LSP server mapping
const LSP_SERVERS: Record<string, { command: string; args: string[] }> = {
  typescript: {
    command: "npx",
    args: ["typescript-language-server", "--stdio"],
  },
  javascript: {
    command: "npx",
    args: ["typescript-language-server", "--stdio"],
  },
  python: {
    command: "pylsp",
    args: [],
  },
};

class LSPManager {
  private connections = new Map<string, LSPConnection>();
  private fallbackIndex = new Map<string, SymbolIndex>(); // Non-LSP projects

  /**
   * Start LSP server for a workspace
   */
  async start(workspace: string, languageId: string): Promise<boolean> {
    const key = this.getKey(workspace, languageId);

    if (this.connections.has(key)) {
      return true;
    }

    const serverConfig = LSP_SERVERS[languageId];
    if (!serverConfig) {
      // No LSP server available, use fallback indexing
      console.log(`No LSP server for ${languageId}, using fallback index`);
      return false;
    }

    const client = new LSPClient(fileToUri(workspace), languageId);
    const index = new SymbolIndex(workspace, languageId);

    try {
      // Build index first (fast fallback)
      await index.buildIndex();

      // Try to start LSP server with timeout
      const startPromise = client.start(serverConfig.command, serverConfig.args);
      const timeoutPromise = new Promise<void>((_, reject) => {
        setTimeout(() => reject(new Error("LSP server startup timeout")), 10000);
      });
      
      await Promise.race([startPromise, timeoutPromise]);
      await client.initialize();

      const connection: LSPConnection = {
        client,
        index,
        workspace,
        languageId,
        isReady: true,
      };

      this.connections.set(key, connection);
      console.log(`LSP ready for ${languageId} in ${workspace}`);
      return true;
    } catch (err) {
      console.warn(`LSP failed for ${languageId}:`, (err as Error).message);
      
      // Fall back to index-only mode
      if (!this.fallbackIndex.has(key)) {
        this.fallbackIndex.set(key, index);
      }
      return false;
    }
  }

  /**
   * Stop LSP server
   */
  async stop(workspace: string, languageId: string): Promise<void> {
    const key = this.getKey(workspace, languageId);
    const conn = this.connections.get(key);
    
    if (conn) {
      await conn.client.shutdown();
      this.connections.delete(key);
    }
    
    this.fallbackIndex.delete(key);
  }

  /**
   * Get connection for workspace/language
   */
  getConnection(workspace: string, languageId: string): LSPConnection | null {
    return this.connections.get(this.getKey(workspace, languageId)) || null;
  }

  /**
   * Check if LSP is available and ready
   */
  isReady(workspace: string, languageId: string): boolean {
    const conn = this.getConnection(workspace, languageId);
    return conn?.isReady || false;
  }

  /**
   * Find symbols by name
   */
  async findSymbol(workspace: string, query: SymbolQuery): Promise<SymbolInfo[]> {
    const languageId = query.file ? this.detectLanguage(query.file) : "typescript";
    const conn = this.getConnection(workspace, languageId);
    
    // Try LSP first
    if (conn?.isReady && query.name) {
      // Use workspace symbols
      const symbols = await conn.client.workspaceSymbol(query.name);
      if (symbols && symbols.length > 0) {
        return this.filterSymbols(symbols, query);
      }
    }

    // Fall back to index
    const index = conn?.index || this.fallbackIndex.get(this.getKey(workspace, languageId));
    if (index && query.name) {
      return index.findByName(query.name, query.type);
    }

    return [];
  }

  /**
   * Go to definition
   */
  async gotoDefinition(workspace: string, filePath: string, position: Position): Promise<Location | null> {
    const languageId = this.detectLanguage(filePath);
    const conn = this.getConnection(workspace, languageId);

    if (conn?.isReady) {
      const uri = fileToUri(filePath);
      const result = await conn.client.textDocumentDefinition(uri, position);
      if (result) {
        return Array.isArray(result) ? result[0] : result;
      }
    }

    return null;
  }

  /**
   * Find references
   */
  async findReferences(workspace: string, filePath: string, position: Position): Promise<Location[]> {
    const languageId = this.detectLanguage(filePath);
    const conn = this.getConnection(workspace, languageId);

    if (conn?.isReady) {
      const uri = fileToUri(filePath);
      const result = await conn.client.textDocumentReferences(uri, position);
      if (result) {
        return result;
      }
    }

    // Fall back to index-based search
    const index = conn?.index || this.fallbackIndex.get(this.getKey(workspace, languageId));
    if (index) {
      // Get symbol name at position (approximate)
      const symbols = index.findInFile(filePath);
      const symbol = symbols.find((s) => 
        s.location.range.start.line <= position.line &&
        s.location.range.end.line >= position.line
      );
      
      if (symbol) {
        const refs = index.findReferences(symbol.name);
        return refs;
      }
    }

    return [];
  }

  /**
   * List symbols in file
   */
  async listSymbols(workspace: string, filePath: string): Promise<SymbolInfo[]> {
    const languageId = this.detectLanguage(filePath);
    const conn = this.getConnection(workspace, languageId);

    if (conn?.isReady) {
      const uri = fileToUri(filePath);
      const result = await conn.client.textDocumentDocumentSymbol(uri);
      if (result) {
        return result;
      }
    }

    const index = conn?.index || this.fallbackIndex.get(this.getKey(workspace, languageId));
    if (index) {
      return index.findInFile(filePath);
    }

    return [];
  }

  /**
   * Get hover info
   */
  async getHover(workspace: string, filePath: string, position: Position): Promise<string | null> {
    const languageId = this.detectLanguage(filePath);
    const conn = this.getConnection(workspace, languageId);

    if (conn?.isReady) {
      const uri = fileToUri(filePath);
      const result = await conn.client.textDocumentHover(uri, position);
      if (result?.contents) {
        return this.formatHoverContents(result.contents);
      }
    }

    return null;
  }

  /**
   * Notify file opened
   */
  async fileOpened(filePath: string, content: string): Promise<void> {
    const workspace = path.dirname(filePath);
    const languageId = this.detectLanguage(filePath);
    const conn = this.getConnection(workspace, languageId);

    if (conn?.isReady) {
      await conn.client.textDocumentDidOpen({
        uri: fileToUri(filePath),
        languageId,
        version: 1,
        text: content,
      });
    }

    // Also update index
    const index = conn?.index || this.fallbackIndex.get(this.getKey(workspace, languageId));
    if (index) {
      await index.updateFile(filePath, content);
    }
  }

  /**
   * Notify file changed
   */
  async fileChanged(filePath: string, content: string): Promise<void> {
    const workspace = path.dirname(filePath);
    const languageId = this.detectLanguage(filePath);
    const conn = this.getConnection(workspace, languageId);

    if (conn?.isReady) {
      await conn.client.textDocumentDidChange(fileToUri(filePath), 2, [{ text: content }]);
    }

    const index = conn?.index || this.fallbackIndex.get(this.getKey(workspace, languageId));
    if (index) {
      await index.updateFile(filePath, content);
    }
  }

  // === Private helpers ===

  private getKey(workspace: string, languageId: string): string {
    return `${workspace}:${languageId}`;
  }

  private detectLanguage(filePath: string): string {
    const ext = path.extname(filePath);
    switch (ext) {
      case ".ts":
      case ".tsx":
        return "typescript";
      case ".js":
      case ".jsx":
        return "javascript";
      case ".py":
        return "python";
      default:
        return "typescript";
    }
  }

  private filterSymbols(symbols: SymbolInfo[], query: SymbolQuery): SymbolInfo[] {
    let filtered = symbols;

    if (query.type) {
      const kindMap: Record<string, number> = {
        function: 12,
        class: 5,
        interface: 11,
        variable: 13,
        constant: 14,
      };
      const kind = kindMap[query.type];
      if (kind) {
        filtered = filtered.filter((s) => s.kind === kind);
      }
    }

    if (query.file) {
      filtered = filtered.filter((s) => s.location.uri.includes(query.file!));
    }

    return filtered;
  }

  private formatHoverContents(contents: unknown): string {
    if (typeof contents === "string") {
      return contents;
    }
    if (Array.isArray(contents)) {
      return contents.map((c) => typeof c === "string" ? c : c.value || "").join("\n");
    }
    if (typeof contents === "object" && contents !== null) {
      return (contents as { value?: string }).value || "";
    }
    return "";
  }
}

// Singleton instance
let manager: LSPManager | null = null;

export function getLSPManager(): LSPManager {
  if (!manager) {
    manager = new LSPManager();
  }
  return manager;
}

export function resetLSPManager(): void {
  manager = null;
}
