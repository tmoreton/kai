/**
 * LSP Client - JSON-RPC communication with language servers
 */

import { spawn, ChildProcess } from "child_process";
import { EventEmitter } from "events";
import type {
  LSPRequest,
  LSPResponse,
  LSPNotification,
  LSPConnection,
  InitializeParams,
  InitializeResult,
  TextDocumentItem,
  SymbolInfo,
  Location,
  Hover,
  DocumentSymbolParams,
  WorkspaceSymbolParams,
  ReferenceParams,
  DefinitionParams,
  HoverParams,
  Position,
} from "./types.js";

// Message delimiter for LSP over stdio
const CONTENT_LENGTH = "Content-Length: ";
const CRLF = "\r\n";

export class LSPClient extends EventEmitter {
  private process: ChildProcess | null = null;
  private requestId = 0;
  private pendingRequests = new Map<number | string, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  private buffer = "";
  private contentLength = -1;
  private capabilities: InitializeResult["capabilities"] = {};
  private isInitialized = false;
  private rootUri: string;
  private languageId: string;

  constructor(rootUri: string, languageId: string) {
    super();
    this.rootUri = rootUri;
    this.languageId = languageId;
  }

  /**
   * Start the LSP server process
   */
  async start(command: string, args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.process = spawn(command, args, {
          stdio: ["pipe", "pipe", "pipe"],
        });

        this.process.on("error", (err) => {
          reject(new Error(`Failed to start LSP server: ${err.message}`));
        });

        this.process.on("exit", (code) => {
          if (code !== 0 && !this.isInitialized) {
            reject(new Error(`LSP server exited with code ${code}`));
          }
          this.emit("exit", code);
        });

        this.process.stdout?.on("data", (data: Buffer) => {
          this.handleData(data.toString());
        });

        this.process.stderr?.on("data", (data: Buffer) => {
          const msg = data.toString().trim();
          // Ignore npm warnings, npx install messages, and other non-errors
          if (msg && 
              !msg.includes("debug") && 
              !msg.includes("INFO") &&
              !msg.includes("npm warn") &&
              !msg.includes("will be installed") &&
              !msg.includes("added ") &&
              !msg.toLowerCase().includes("deprecated")) {
            // Only emit actual errors, not warnings
            if (msg.includes("Error:") || msg.includes("error") || msg.includes("ERR!")) {
              this.emit("error", new Error(`LSP stderr: ${msg}`));
            }
          }
        });

        // Give server time to start (npx may need to install packages)
        setTimeout(() => {
          if (this.process && this.process.pid) {
            resolve();
          } else {
            reject(new Error("LSP server failed to start"));
          }
        }, 3000);
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * Initialize the LSP connection
   */
  async initialize(): Promise<InitializeResult> {
    const params: InitializeParams = {
      processId: process.pid,
      rootUri: this.rootUri,
      capabilities: {
        textDocument: {
          synchronization: {
            dynamicRegistration: false,
            willSave: true,
            willSaveWaitUntil: true,
            didSave: true,
          },
          completion: { dynamicRegistration: false },
          hover: { dynamicRegistration: false },
          definition: { dynamicRegistration: false, linkSupport: true },
          documentSymbol: { dynamicRegistration: false, hierarchicalDocumentSymbolSupport: true },
          references: { dynamicRegistration: false },
        },
        workspace: {
          workspaceFolders: true,
          configuration: false,
        },
      },
    };

    const result = await this.request("initialize", params) as InitializeResult;
    this.capabilities = result.capabilities;
    this.isInitialized = true;

    // Send initialized notification
    this.notify("initialized", {});

    return result;
  }

  /**
   * Shutdown the LSP connection
   */
  async shutdown(): Promise<void> {
    if (!this.process || this.process.killed) {
      return;
    }

    try {
      await this.request("shutdown", {});
      this.notify("exit", {});
    } catch {
      // Ignore errors during shutdown
    }

    // Kill the process
    this.process.kill("SIGTERM");
    
    // Force kill after timeout
    setTimeout(() => {
      if (this.process && !this.process.killed) {
        this.process.kill("SIGKILL");
      }
    }, 5000);
  }

  /**
   * Send a request and wait for response
   */
  private request(method: string, params: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.process || this.process.killed) {
        reject(new Error("LSP server not running"));
        return;
      }

      const id = ++this.requestId;
      const request: LSPRequest = {
        jsonrpc: "2.0",
        id,
        method,
        params,
      };

      this.pendingRequests.set(id, { resolve, reject });

      // Set timeout
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`LSP request timeout: ${method}`));
        }
      }, 10000);

      this.sendMessage(request);
    });
  }

  /**
   * Send a notification (no response expected)
   */
  private notify(method: string, params: unknown): void {
    if (!this.process || this.process.killed) {
      return;
    }

    const notification: LSPNotification = {
      jsonrpc: "2.0",
      method,
      params,
    };

    this.sendMessage(notification);
  }

  /**
   * Send a message to the LSP server
   */
  private sendMessage(msg: LSPRequest | LSPNotification): void {
    const content = JSON.stringify(msg);
    const headers = `${CONTENT_LENGTH}${Buffer.byteLength(content, "utf8")}${CRLF}${CRLF}`;
    const data = headers + content;

    this.process?.stdin?.write(data);
  }

  /**
   * Handle incoming data from stdout
   */
  private handleData(data: string): void {
    this.buffer += data;

    while (true) {
      // Find Content-Length header
      if (this.contentLength === -1) {
        const headerEnd = this.buffer.indexOf(CRLF + CRLF);
        if (headerEnd === -1) return; // Wait for more data

        const header = this.buffer.substring(0, headerEnd);
        const match = header.match(/Content-Length: (\d+)/);
        if (!match) {
          // Skip this message and continue
          this.buffer = this.buffer.substring(headerEnd + 4);
          continue;
        }

        this.contentLength = parseInt(match[1], 10);
        this.buffer = this.buffer.substring(headerEnd + 4);
      }

      // Check if we have the full content
      if (this.buffer.length < this.contentLength) {
        return; // Wait for more data
      }

      // Extract and parse the JSON message
      const content = this.buffer.substring(0, this.contentLength);
      this.buffer = this.buffer.substring(this.contentLength);
      this.contentLength = -1;

      try {
        const message = JSON.parse(content) as LSPResponse | LSPNotification;
        this.handleMessage(message);
      } catch (err) {
        this.emit("error", new Error(`Failed to parse LSP message: ${err}`));
      }
    }
  }

  /**
   * Handle parsed LSP message
   */
  private handleMessage(msg: LSPResponse | LSPNotification): void {
    // Check if it's a response with an id
    if ("id" in msg && msg.id !== null && msg.id !== undefined) {
      const pending = this.pendingRequests.get(msg.id);
      if (pending) {
        this.pendingRequests.delete(msg.id);
        if ("error" in msg && msg.error) {
          pending.reject(new Error(msg.error.message));
        } else {
          pending.resolve(msg.result);
        }
      }
    } else if ("method" in msg) {
      // It's a notification
      this.emit("notification", msg);
    }
  }

  // === LSP Methods ===

  /**
   * Open a text document
   */
  textDocumentDidOpen(document: TextDocumentItem): void {
    this.notify("textDocument/didOpen", { textDocument: document });
  }

  /**
   * Change a text document
   */
  textDocumentDidChange(uri: string, version: number, changes: { range?: Range; text: string }[]): void {
    this.notify("textDocument/didChange", {
      textDocument: { uri, version },
      contentChanges: changes,
    });
  }

  /**
   * Save a text document
   */
  textDocumentDidSave(uri: string, text?: string): void {
    const params: { textDocument: { uri: string }; text?: string } = {
      textDocument: { uri },
    };
    if (text) params.text = text;
    this.notify("textDocument/didSave", params);
  }

  /**
   * Close a text document
   */
  textDocumentDidClose(uri: string): void {
    this.notify("textDocument/didClose", {
      textDocument: { uri },
    });
  }

  /**
   * Get document symbols
   */
  async textDocumentDocumentSymbol(uri: string): Promise<SymbolInfo[] | null> {
    if (!this.capabilities.documentSymbolProvider) {
      return null;
    }

    const params: DocumentSymbolParams = {
      textDocument: { uri },
    };

    try {
      const result = await this.request("textDocument/documentSymbol", params) as SymbolInfo[] | { name: string; kind: number; location: Location }[];
      
      // Handle both flat and hierarchical results
      if (Array.isArray(result)) {
        return result.map((item) => ({
          name: item.name,
          kind: typeof item.kind === "number" ? item.kind : 12, // default to function
          location: "location" in item ? item.location : { uri, range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } } },
        }));
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Get workspace symbols
   */
  async workspaceSymbol(query: string): Promise<SymbolInfo[] | null> {
    if (!this.capabilities.workspaceSymbolProvider) {
      return null;
    }

    const params: WorkspaceSymbolParams = { query };

    try {
      const result = await this.request("workspace/symbol", params) as SymbolInfo[];
      return result || null;
    } catch {
      return null;
    }
  }

  /**
   * Go to definition
   */
  async textDocumentDefinition(uri: string, position: Position): Promise<Location | Location[] | null> {
    if (!this.capabilities.definitionProvider) {
      return null;
    }

    const params: DefinitionParams = {
      textDocument: { uri },
      position,
    };

    try {
      const result = await this.request("textDocument/definition", params) as Location | Location[] | null;
      return result;
    } catch {
      return null;
    }
  }

  /**
   * Find references
   */
  async textDocumentReferences(uri: string, position: Position, includeDeclaration = true): Promise<Location[] | null> {
    if (!this.capabilities.referencesProvider) {
      return null;
    }

    const params: ReferenceParams = {
      textDocument: { uri },
      position,
      context: { includeDeclaration },
    };

    try {
      const result = await this.request("textDocument/references", params) as Location[] | null;
      return result;
    } catch {
      return null;
    }
  }

  /**
   * Get hover information
   */
  async textDocumentHover(uri: string, position: Position): Promise<Hover | null> {
    if (!this.capabilities.hoverProvider) {
      return null;
    }

    const params: HoverParams = {
      textDocument: { uri },
      position,
    };

    try {
      const result = await this.request("textDocument/hover", params) as Hover | null;
      return result;
    } catch {
      return null;
    }
  }

  // === Getters ===

  get isReady(): boolean {
    return this.isInitialized && !!this.process && !this.process.killed;
  }

  get serverCapabilities(): InitializeResult["capabilities"] {
    return this.capabilities;
  }
}

// Type for Range used in didChange
interface Range {
  start: Position;
  end: Position;
}
