/**
 * Token usage tracking across all sessions.
 * Persists to ~/.kai/usage.json.
 */

import fs from "fs";
import path from "path";

const USAGE_PATH = path.resolve(process.env.HOME || "~", ".kai/usage.json");

export interface UsageRecord {
  date: string;       // YYYY-MM-DD
  input: number;
  output: number;
}

export interface UsageStore {
  totalInput: number;
  totalOutput: number;
  daily: UsageRecord[];
}

function load(): UsageStore {
  try {
    if (fs.existsSync(USAGE_PATH)) {
      return JSON.parse(fs.readFileSync(USAGE_PATH, "utf8")) as UsageStore;
    }
  } catch { /* ignore corrupt file */ }
  return { totalInput: 0, totalOutput: 0, daily: [] };
}

function save(store: UsageStore): void {
  try {
    fs.writeFileSync(USAGE_PATH, JSON.stringify(store, null, 2), "utf8");
  } catch { /* ignore write errors */ }
}

export function recordUsage(input: number, output: number): UsageStore {
  const store = load();
  store.totalInput  += input;
  store.totalOutput += output;

  const today = new Date().toISOString().slice(0, 10);
  const day   = store.daily.find((d) => d.date === today);
  if (day) {
    day.input  += input;
    day.output += output;
  } else {
    store.daily.push({ date: today, input, output });
    // Keep last 30 days
    if (store.daily.length > 30) store.daily.splice(0, store.daily.length - 30);
  }

  save(store);
  return store;
}

export function getUsageStats(): UsageStore {
  return load();
}
