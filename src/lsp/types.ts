/**
 * LSP Types and Interfaces
 * Based on Language Server Protocol specification
 */

// Position in a file
export interface Position {
  line: number;      // 0-based
  character: number; // 0-based
}

// Range within a file
export interface Range {
  start: Position;
  end: Position;
}

// Location of a symbol
export interface Location {
  uri: string;
  range: Range;
}

// Symbol information
export interface SymbolInfo {
  name: string;
  kind: SymbolKind;
  location: Location;
  containerName?: string;
  detail?: string;     // Type signature, etc.
}

// Symbol kinds (subset of LSP spec)
export enum SymbolKind {
  File = 1,
  Module = 2,
  Namespace = 3,
  Package = 4,
  Class = 5,
  Method = 6,
  Property = 7,
  Field = 8,
  Constructor = 9,
  Enum = 10,
  Interface = 11,
  Function = 12,
  Variable = 13,
  Constant = 14,
  String = 15,
  Number = 16,
  Boolean = 17,
  Array = 18,
  Object = 19,
  Key = 20,
  Null = 21,
  EnumMember = 22,
  Struct = 23,
  Event = 24,
  Operator = 25,
  TypeParameter = 26,
}

// LSP Message types
export interface LSPRequest {
  jsonrpc: "2.0";
  id: number | string;
  method: string;
  params?: unknown;
}

export interface LSPResponse {
  jsonrpc: "2.0";
  id: number | string | null;
  result?: unknown;
  error?: LSPError;
}

export interface LSPError {
  code: number;
  message: string;
  data?: unknown;
}

export interface LSPNotification {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
}

// Server capabilities
export interface ServerCapabilities {
  textDocumentSync?: number | {
    openClose?: boolean;
    change?: number;
    willSave?: boolean;
    willSaveWaitUntil?: boolean;
    save?: boolean | { includeText?: boolean };
  };
  hoverProvider?: boolean;
  definitionProvider?: boolean;
  referencesProvider?: boolean;
  documentSymbolProvider?: boolean;
  workspaceSymbolProvider?: boolean;
  implementationProvider?: boolean;
  typeDefinitionProvider?: boolean;
  completionProvider?: {
    resolveProvider?: boolean;
    triggerCharacters?: string[];
  };
  signatureHelpProvider?: {
    triggerCharacters?: string[];
    retriggerCharacters?: string[];
  };
}

// Initialize params
export interface InitializeParams {
  processId: number | null;
  rootUri: string | null;
  capabilities: ClientCapabilities;
  workspaceFolders?: WorkspaceFolder[] | null;
}

export interface ClientCapabilities {
  textDocument?: {
    synchronization?: {
      dynamicRegistration?: boolean;
      willSave?: boolean;
      willSaveWaitUntil?: boolean;
      didSave?: boolean;
    };
    completion?: {
      dynamicRegistration?: boolean;
    };
    hover?: {
      dynamicRegistration?: boolean;
    };
    definition?: {
      dynamicRegistration?: boolean;
      linkSupport?: boolean;
    };
    documentSymbol?: {
      dynamicRegistration?: boolean;
      hierarchicalDocumentSymbolSupport?: boolean;
    };
    references?: {
      dynamicRegistration?: boolean;
    };
  };
  workspace?: {
    workspaceFolders?: boolean;
    configuration?: boolean;
  };
}

export interface WorkspaceFolder {
  uri: string;
  name: string;
}

// Initialize result
export interface InitializeResult {
  capabilities: ServerCapabilities;
  serverInfo?: {
    name: string;
    version?: string;
  };
}

// Text document item
export interface TextDocumentItem {
  uri: string;
  languageId: string;
  version: number;
  text: string;
}

// Text document identifier
export interface TextDocumentIdentifier {
  uri: string;
}

// Versioned text document identifier
export interface VersionedTextDocumentIdentifier extends TextDocumentIdentifier {
  version: number;
}

// Text document content change event
export interface TextDocumentContentChangeEvent {
  range?: Range;
  rangeLength?: number;
  text: string;
}

// Document symbol params
export interface DocumentSymbolParams {
  textDocument: TextDocumentIdentifier;
}

// Workspace symbol params
export interface WorkspaceSymbolParams {
  query: string;
}

// Reference params
export interface ReferenceParams extends TextDocumentPositionParams {
  context: {
    includeDeclaration: boolean;
  };
}

// Definition params
export interface DefinitionParams extends TextDocumentPositionParams {}

// Hover params
export interface HoverParams extends TextDocumentPositionParams {}

// Text document position params
export interface TextDocumentPositionParams {
  textDocument: TextDocumentIdentifier;
  position: Position;
}

// Hover result
export interface Hover {
  contents: string | { language: string; value: string } | (string | { language: string; value: string })[];
  range?: Range;
}

// Completion item
export interface CompletionItem {
  label: string;
  kind?: number;
  detail?: string;
  documentation?: string | { kind: string; value: string };
  insertText?: string;
}

// Markup content
export interface MarkupContent {
  kind: "plaintext" | "markdown";
  value: string;
}

// LSP Connection state
export interface LSPConnection {
  process: import("child_process").ChildProcess;
  capabilities: ServerCapabilities;
  rootUri: string;
  languageId: string;
  isReady: boolean;
  requestId: number;
  pendingRequests: Map<number | string, { resolve: (value: unknown) => void; reject: (error: Error) => void }>;
}

// Search query types
export interface SymbolQuery {
  name?: string;
  type?: "function" | "class" | "interface" | "variable" | "constant" | "import";
  file?: string;
  exported?: boolean;
}

// Search results
export interface SearchResult {
  symbols: SymbolInfo[];
  total: number;
  truncated: boolean;
}
