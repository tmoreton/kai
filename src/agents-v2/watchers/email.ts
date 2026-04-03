import { eventBus } from "../event-bus.js";

interface EmailMessage {
  messageId: string;
  subject: string;
  from: string;
  to: string;
  date: string;
  preview?: string;
}

let emailInterval: ReturnType<typeof setInterval> | null = null;
let isRunning = false;

/**
 * Start polling for new emails and emit events.
 * Uses existing email-poller logic.
 */
export async function startEmailWatcher(pollIntervalMs: number = 60000): Promise<void> {
  if (isRunning) {
    return;
  }

  // Check if email is configured
  if (!process.env.RESEND_API_KEY && !process.env.IMAP_HOST) {
    return; // Email not configured, skip silently
  }

  isRunning = true;

  // Start polling using existing email poller
  try {
    const { startEmailPoller } = await import("../../agents/email-poller.js");
    
    // Override the poller's callback to emit events
    // For now, we'll just start the existing poller
    // Events will be emitted when emails are processed by the agent system
    startEmailPoller();
    
    console.log(`[EmailWatcher] Started via email-poller`);
  } catch {
    // Email poller not available
    isRunning = false;
  }
}

/**
 * Stop the email watcher.
 */
export function stopEmailWatcher(): void {
  if (emailInterval) {
    clearInterval(emailInterval);
    emailInterval = null;
  }
  isRunning = false;
}
