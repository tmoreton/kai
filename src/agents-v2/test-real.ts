#!/usr/bin/env node
/**
 * Real test of Agent v2 event system
 */

import { eventBus } from "./event-bus.js";
import { watchFile, unwatchAll } from "./watchers/file.js";
import path from "path";
import os from "os";
import fs from "fs";

async function runTests() {
  console.log("=== Testing Kai Agent v2 Event System ===\n");

  // Test 1: Event Bus Basic
  console.log("Test 1: Event Bus");
  let received = false;
  
  console.log("  Subscribing to 'file:changed'...");
  const unsub = eventBus.subscribe("file:changed", (e) => {
    console.log("  ✓ Handler called with:", e.type);
    received = true;
  });
  console.log("  Stats after subscribe:", eventBus.getStats());

  console.log("  Publishing event...");
  eventBus.publish({
    id: "test-1",
    type: "file:changed",
    timestamp: Date.now(),
    payload: { path: "/test" },
    source: "test"
  });
  console.log("  Stats after publish:", eventBus.getStats());

  // Wait for async handler
  await new Promise(r => setTimeout(r, 50));

  if (received) {
    console.log("✓ Event bus works\n");
  } else {
    console.log("✗ Event bus FAILED - checking stats:", eventBus.getStats());
    process.exit(1);
  }
  unsub();

  // Test 2: File Watcher
  console.log("Test 2: File Watcher");
  const testFile = path.join(os.homedir(), "kai-test-file.txt");
  fs.writeFileSync(testFile, "initial");

  let fileEventReceived = false;
  const fileUnsub = eventBus.subscribe("file:changed", (e) => {
    if (e.payload.path === testFile || e.payload.resolvedPath === testFile) {
      console.log("✓ File change detected:", e.payload.path);
      fileEventReceived = true;
    }
  });

  watchFile(testFile);
  console.log("Watching:", testFile);

  // Trigger change
  await new Promise(r => setTimeout(r, 100));
  fs.appendFileSync(testFile, "\nchange");
  console.log("Modified file, waiting...");

  // Check result
  await new Promise(r => setTimeout(r, 200));

  if (fileEventReceived) {
    console.log("✓ File watcher works\n");
  } else {
    const { getWatchedFiles } = await import("./watchers/file.js");
    console.log("✗ File watcher FAILED (no event received)");
    console.log("Stats:", eventBus.getStats());
    console.log("Watched files:", getWatchedFiles?.() || "N/A");
  }

  // Cleanup
  fileUnsub();
  unwatchAll();
  try { fs.unlinkSync(testFile); } catch {}
  
  console.log("=== Tests Complete ===");
  process.exit(fileEventReceived ? 0 : 1);
}

runTests();
