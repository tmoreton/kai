#!/usr/bin/env node
/**
 * Ink-based interactive REPL for Kai.
 * Provides a Claude Code-style TUI with:
 *  - Completed messages rendered as static content (scroll naturally)
 *  - Thinking spinner + streaming response in the dynamic region
 *  - Slash-command autocomplete dropdown above the input bar
 *  - Fixed input bar at the bottom (always visible)
 *  - Input queue so you can type while the LLM is responding
 *
 * console.log() calls from client.ts (tool cards, etc.) are automatically
 * captured by Ink's patchConsole and rendered as static content above the UI.
 */

import React, { useState, useRef, useCallback, useEffect } from "react";
import { render, Box, Text, useInput, useApp, useStdout, Static } from "ink";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import fs from "fs";
import path from "path";
import chalk from "chalk";

import { createClient, chat, signalUserTyping } from "./client.js";
import { buildSystemPrompt } from "./system-prompt.js";
import { getCwd, cleanupBackgroundProcesses } from "./tools/bash.js";
import { estimateContextSize } from "./context.js";
import {
  generateSessionId,
  saveSession,
  saveSessionSync,
  loadSession,
  getMostRecentSession,
  cleanupSessions,
  autoCompact,
  type Session,
} from "./sessions/manager.js";
import { appendRecall } from "./recall.js";
import { setPermissionMode, getPermissionMode } from "./permissions.js";
import { getCurrentProject } from "./project.js";
import { renderMarkdown } from "./render.js";
import { loadCustomCommands, findCustomCommand, resolveCommand } from "./commands.js";
import { isPlanMode } from "./plan-mode.js";
import { autoRoute, applyRoute } from "./auto-route.js";
import { recordError, installGlobalErrorHandlers } from "./error-tracker.js";
import { resolveFilePath, expandHome } from "./utils.js";
import { bootstrapBuiltinAgents } from "./agents-core/bootstrap.js";
import { SLASH_COMMANDS, handleCommand } from "./repl-commands.js";
import type { ReplOptions } from "./repl.js";

// ─── Image helpers (shared with repl.ts) ─────────────────────────────────────

const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"]);
const MIME_MAP: Record<string, string> = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".gif": "image/gif", ".webp": "image/webp", ".bmp": "image/bmp",
};

function readImageAsDataUrl(
  filePath: string
): { dataUrl: string; sizeKB: number } | { error: string } {
  const resolved = resolveFilePath(expandHome(filePath));
  if (!fs.existsSync(resolved)) return { error: `Image not found: ${resolved}` };
  const ext = path.extname(resolved).toLowerCase();
  if (!IMAGE_EXTS.has(ext)) return { error: `Unsupported format: ${ext}` };
  const stat = fs.statSync(resolved);
  if (stat.size > 20 * 1024 * 1024) return { error: "Image too large (max 20MB)" };
  const base64 = fs.readFileSync(resolved).toString("base64");
  return {
    dataUrl: `data:${MIME_MAP[ext] || "image/png"};base64,${base64}`,
    sizeKB: Math.round(stat.size / 1024),
  };
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface UIMessage {
  id: string;
  role: "user" | "assistant" | "info";
  content: string; // raw text / ANSI for info, markdown text for assistant
}

interface AcItem {
  cmd: string;
  desc: string;
}

interface AppProps {
  options: ReplOptions;
  initialPrompt?: string;
  initSession: Session;
  client: ReturnType<typeof createClient>;
  initMessages: ChatCompletionMessageParam[];
}

// ─── Spinner frames ───────────────────────────────────────────────────────────

const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

// ─── Main Ink component ───────────────────────────────────────────────────────

function KaiApp({ options, initialPrompt, initSession, client, initMessages }: AppProps) {
  const { exit } = useApp();
  const { stdout } = useStdout();

  // ── Stable refs (shared across closures without triggering re-renders) ──────
  const sessionRef        = useRef<Session>(initSession);
  const chatMessagesRef   = useRef<ChatCompletionMessageParam[]>(initMessages);
  const isProcessingRef   = useRef(false);
  const inputQueueRef     = useRef<string[]>([]);
  const chatAbortRef      = useRef<AbortController | null>(null);
  const sigintCountRef    = useRef(0);
  const bootedRef         = useRef(false);

  // ── React state (drives re-renders) ─────────────────────────────────────────
  const [messages,     setMessages]     = useState<UIMessage[]>([]);
  const [streamText,   setStreamText]   = useState("");
  const [thinking,     setThinking]     = useState(false);
  const [spinnerFrame, setSpinnerFrame] = useState(0);
  const [input,        setInput]        = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [queueCount,   setQueueCount]   = useState(0);
  const [acItems,      setAcItems]      = useState<AcItem[]>([]);
  const [acIndex,      setAcIndex]      = useState(0);

  // ── Spinner animation ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!thinking) return;
    const id = setInterval(() => setSpinnerFrame((f) => f + 1), 80);
    return () => clearInterval(id);
  }, [thinking]);

  // ── Helpers ──────────────────────────────────────────────────────────────────

  const addMessage = useCallback((role: UIMessage["role"], content: string) => {
    setMessages((prev) => [...prev, { id: crypto.randomUUID(), role, content }]);
  }, []);

  const updateAc = useCallback((val: string) => {
    if (!val.startsWith("/")) { setAcItems([]); return; }
    const built  = SLASH_COMMANDS.filter((c) => c.cmd.startsWith(val));
    const custom = loadCustomCommands()
      .filter((c) => `/${c.name}`.startsWith(val))
      .map((c) => ({ cmd: `/${c.name}`, desc: (c as any).description ?? "" }));
    setAcItems([...built, ...custom].slice(0, 8));
    setAcIndex(0);
  }, []);

  // ── Core message processor ───────────────────────────────────────────────────

  const processMessage = useCallback(async (raw: string): Promise<void> => {
    const text = raw.trim();
    if (!text) return;

    isProcessingRef.current = true;
    setIsProcessing(true);
    setStreamText("");

    // Bare "/" → show command menu
    if (text === "/") {
      addMessage(
        "info",
        SLASH_COMMANDS.map(
          (c) => chalk.cyan(`  ${c.cmd.padEnd(16)}`) + chalk.dim(c.desc)
        ).join("\n")
      );
      isProcessingRef.current = false;
      setIsProcessing(false);
      return;
    }

    // Built-in slash commands / exit
    if (text.startsWith("/") || text === "exit") {
      const result = await handleCommand(text, chatMessagesRef.current, sessionRef.current);
      if (result === "exit") {
        cleanupBackgroundProcesses();
        sessionRef.current.messages = chatMessagesRef.current;
        saveSessionSync(sessionRef.current);
        exit();
        return;
      }
      if (result === "handled") {
        isProcessingRef.current = false;
        setIsProcessing(false);
        return;
      }
      // fall-through: unrecognised slash → pass to model
    }

    // Show the user's message in history
    addMessage("user", text);

    const msgs = chatMessagesRef.current;
    let messageAdded = false;

    // Custom slash commands (e.g. /review, /test)
    if (text.startsWith("/")) {
      const parts     = text.substring(1).split(/\s+/);
      const customCmd = findCustomCommand(parts[0]);
      if (customCmd) {
        msgs.push({ role: "user", content: resolveCommand(customCmd, parts.slice(1).join(" ")) });
        messageAdded = true;
      } else {
        msgs.push({ role: "user", content: text });
        messageAdded = true;
      }
    }

    // Image attachment detection
    if (!messageAdded) {
      const imageMatch = text.match(/(?:^|\s)([^\s]+\.(?:png|jpg|jpeg|gif|webp|bmp))(?:\s|$)/i);
      if (imageMatch) {
        const imgPath   = imageMatch[1].replace(/^~/, process.env.HOME ?? "~");
        const imgResult = readImageAsDataUrl(imgPath);
        if ("dataUrl" in imgResult) {
          const textPart = text.replace(imageMatch[1], "").trim() || "Analyze this image.";
          msgs.push({
            role: "user",
            content: [
              { type: "text", text: textPart },
              { type: "image_url", image_url: { url: imgResult.dataUrl } },
            ],
          } as ChatCompletionMessageParam);
          addMessage("info", chalk.dim(`  Image attached: ${imgPath} (${imgResult.sizeKB} KB)`));
          messageAdded = true;
        }
      }
    }

    if (!messageAdded) {
      msgs.push({ role: "user", content: text });
    }

    try {
      // Auto-route
      const routeDecision = await autoRoute(client, text);
      const routeHint     = applyRoute(routeDecision);
      if (routeHint) msgs.push({ role: "user", content: routeHint });

      // Auto-compact
      const compact = autoCompact(sessionRef.current);
      if (compact.compacted) chatMessagesRef.current = sessionRef.current.messages;

      // Start streaming
      setThinking(true);
      let firstToken  = true;
      let accumulated = "";

      chatAbortRef.current = new AbortController();
      const updatedMessages = await chat(
        client,
        msgs,
        (token) => {
          if (firstToken) { setThinking(false); firstToken = false; }
          accumulated += token;
          setStreamText(accumulated);
        },
        { signal: chatAbortRef.current.signal, unleash: options.unleash }
      );

      setThinking(false);
      setStreamText("");

      if (accumulated) addMessage("assistant", accumulated);

      chatMessagesRef.current = updatedMessages;

      // Context usage line
      const tokens = estimateContextSize(updatedMessages);
      const pct    = Math.round((tokens / 256_000) * 100);
      addMessage("info", chalk.dim(`  [${Math.round(tokens / 1000)}k / 256k tokens · ${pct}%]`));

      // Recall
      const lastMsg = updatedMessages.at(-1);
      appendRecall([
        { sessionId: sessionRef.current.id, timestamp: new Date().toISOString(), role: "user", content: text },
        ...(lastMsg?.role === "assistant" && typeof lastMsg.content === "string"
          ? [{ sessionId: sessionRef.current.id, timestamp: new Date().toISOString(), role: "assistant" as const, content: lastMsg.content }]
          : []),
      ]);

      sessionRef.current.messages = updatedMessages;
      saveSession(sessionRef.current);

    } catch (err) {
      setThinking(false);
      setStreamText("");
      if (err instanceof Error && (err.name === "AbortError" || err.message.includes("aborted"))) {
        // stopped by Ctrl+C
      } else {
        const msg = err instanceof Error ? err.message : String(err);
        addMessage("info", chalk.red(`  Error: ${msg}`));
        if (msg.includes("401")) addMessage("info", chalk.yellow("  Check your API key in .env"));
        recordError({ source: "repl-ink", error: err, context: { sessionId: sessionRef.current.id } });
      }
    }

    isProcessingRef.current = false;
    setIsProcessing(false);
    sigintCountRef.current = 0;

    // Drain the input queue
    if (inputQueueRef.current.length > 0) {
      const next = inputQueueRef.current.shift()!;
      setQueueCount(inputQueueRef.current.length);
      await processMessage(next);
    }
  }, [client, options, addMessage, exit]);

  // ── Ctrl+C ───────────────────────────────────────────────────────────────────

  const handleCtrlC = useCallback(() => {
    if (isProcessingRef.current) {
      sigintCountRef.current++;
      chatAbortRef.current?.abort();
      chatAbortRef.current = null;

      if (sigintCountRef.current >= 2) {
        cleanupBackgroundProcesses();
        sessionRef.current.messages = chatMessagesRef.current;
        saveSessionSync(sessionRef.current);
        exit();
        return;
      }

      addMessage("info", chalk.dim("  Stopped."));
      isProcessingRef.current = false;
      setIsProcessing(false);
      setThinking(false);
      setStreamText("");
      inputQueueRef.current = [];
      setQueueCount(0);
    } else {
      cleanupBackgroundProcesses();
      sessionRef.current.messages = chatMessagesRef.current;
      saveSessionSync(sessionRef.current);
      exit();
    }
  }, [addMessage, exit]);

  // ── Submit ───────────────────────────────────────────────────────────────────

  const handleSubmit = useCallback(() => {
    const val = input.trim();
    setInput("");
    setAcItems([]);
    if (!val) return;

    if (isProcessingRef.current) {
      inputQueueRef.current.push(val);
      setQueueCount(inputQueueRef.current.length);
      return;
    }

    processMessage(val);
  }, [input, processMessage]);

  // ── Keyboard input ───────────────────────────────────────────────────────────

  useInput((char, key) => {
    if (key.ctrl && char === "c") { handleCtrlC(); return; }

    // Autocomplete navigation
    if (acItems.length > 0) {
      if (key.upArrow)   { setAcIndex((i) => Math.max(0, i - 1)); return; }
      if (key.downArrow) { setAcIndex((i) => Math.min(acItems.length - 1, i + 1)); return; }
      if (key.tab)       { setInput(acItems[acIndex].cmd + " "); setAcItems([]); return; }
      if (key.escape)    { setAcItems([]); return; }
    }

    if (key.return) { handleSubmit(); return; }

    if (key.backspace || key.delete) {
      const next = input.slice(0, -1);
      setInput(next);
      updateAc(next);
      return;
    }

    if (!key.ctrl && !key.meta && char) {
      if (isProcessingRef.current) signalUserTyping();
      const next = input + char;
      setInput(next);
      updateAc(next);
    }
  });

  // ── Initial prompt ───────────────────────────────────────────────────────────

  useEffect(() => {
    if (bootedRef.current) return;
    bootedRef.current = true;
    if (initialPrompt) processMessage(initialPrompt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Derived display values ───────────────────────────────────────────────────

  const inPlanMode  = isPlanMode();
  const promptColor = inPlanMode ? "yellow" : "cyan";

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <Box flexDirection="column">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <Box marginBottom={1}>
        <Text bold color="cyan">  ⚡ Kai</Text>
      </Box>

      {/* ── Completed messages (static — scroll into terminal history) ─────── */}
      <Static items={messages}>
        {(msg) => (
          <Box key={msg.id} flexDirection="column" marginBottom={1}>
            {msg.role === "user" && (
              <Box>
                <Text color="cyan" bold>{"  › "}</Text>
                <Text bold>{msg.content}</Text>
              </Box>
            )}
            {msg.role === "assistant" && (
              <Box flexDirection="column">
                <Text color="cyan">{"  ⏺ "}</Text>
                <Text>{renderMarkdown(msg.content)}</Text>
              </Box>
            )}
            {msg.role === "info" && (
              <Box>
                <Text>{msg.content}</Text>
              </Box>
            )}
          </Box>
        )}
      </Static>

      {/* ── Thinking spinner ────────────────────────────────────────────────── */}
      {thinking && (
        <Box marginBottom={1}>
          <Text color="blue">{SPINNER[spinnerFrame % SPINNER.length]} </Text>
          <Text dimColor>thinking...</Text>
        </Box>
      )}

      {/* ── Live streaming response ─────────────────────────────────────────── */}
      {streamText !== "" && (
        <Box flexDirection="column" marginBottom={1}>
          <Box>
            <Text color="cyan">{"  ⏺ "}</Text>
          </Box>
          <Text>{streamText}</Text>
        </Box>
      )}

      {/* ── Autocomplete dropdown ───────────────────────────────────────────── */}
      {acItems.length > 0 && (
        <Box flexDirection="column" marginBottom={1}>
          {acItems.map((item, i) => (
            <Box key={item.cmd}>
              <Text color={i === acIndex ? "cyan" : undefined} bold={i === acIndex}>
                {"  "}{item.cmd.padEnd(20)}
              </Text>
              <Text color={i === acIndex ? "cyan" : "gray"}>
                {item.desc}
              </Text>
            </Box>
          ))}
        </Box>
      )}

      {/* ── Input bar ───────────────────────────────────────────────────────── */}
      <Box>
        <Text color={promptColor} bold>{"  › "}</Text>
        <Text>{input}</Text>
        {queueCount > 0 && (
          <Text color="yellow">{"  "}[{queueCount} in queue]</Text>
        )}
        {isProcessing && !thinking && streamText === "" && (
          <Text dimColor>{"  "}(processing...)</Text>
        )}
      </Box>

    </Box>
  );
}

// ─── Session factory ──────────────────────────────────────────────────────────

function createNewSession(
  options: ReplOptions,
  messages: ChatCompletionMessageParam[]
): Session {
  return {
    id: generateSessionId(),
    name: options.sessionName,
    cwd: getCwd(),
    type: "code",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    messages,
  };
}

// ─── Public entry point ───────────────────────────────────────────────────────

export async function startReplInk(
  options: ReplOptions = {},
  initialPrompt?: string
): Promise<void> {
  installGlobalErrorHandlers();

  // Prune old sessions in background
  setTimeout(() => {
    try {
      const pruned = cleanupSessions(30);
      if (pruned > 0) process.stderr.write(chalk.dim(`  Cleaned up ${pruned} old session(s).\n`));
    } catch { /* ignore */ }
  }, 5_000);

  // Install built-in agents once
  const bootstrapped = bootstrapBuiltinAgents();
  if (bootstrapped > 0) {
    process.stderr.write(chalk.dim(`  Installed ${bootstrapped} built-in agent(s).\n`));
  }

  if (options.autoApprove) setPermissionMode("auto");

  const client   = createClient();
  let messages: ChatCompletionMessageParam[] = [
    { role: "system", content: buildSystemPrompt() },
  ];
  let session: Session;

  if (options.continueSession) {
    const recent = getMostRecentSession();
    if (recent) {
      messages = recent.messages;
      if (messages[0]?.role === "system") messages[0] = { role: "system", content: buildSystemPrompt() };
      session = recent;
    } else {
      session = createNewSession(options, messages);
    }
  } else if (options.resumeSessionId) {
    const loaded = loadSession(options.resumeSessionId);
    if (loaded) {
      messages = loaded.messages;
      if (messages[0]?.role === "system") messages[0] = { role: "system", content: buildSystemPrompt() };
      session = loaded;
    } else {
      session = createNewSession(options, messages);
    }
  } else {
    session = createNewSession(options, messages);
  }

  const { waitUntilExit } = render(
    <KaiApp
      options={options}
      initialPrompt={initialPrompt}
      initSession={session}
      client={client}
      initMessages={messages}
    />
  );

  await waitUntilExit();
}
