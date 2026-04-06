import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import nodemailer from "nodemailer";
import { connect as tlsConnect } from "tls";
import { getNotification, getAgent, createNotification } from "../../agents-core/db.js";
import { createClient, getModelId } from "../../client.js";

/**
 * Unified Email Service
 *
 * Combines outbound notifications and inbound reply polling.
 * Handles both SMTP (sending) and IMAP (receiving).
 */

// ─── SMTP Transport (shared) ───────────────────────────────────────────────

let transporter: nodemailer.Transporter | null = null;

export function getTransporter(): nodemailer.Transporter | null {
  if (transporter) return transporter;

  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) return null;

  transporter = nodemailer.createTransport({
    host,
    port: parseInt(process.env.SMTP_PORT || "587"),
    secure: process.env.SMTP_SECURE === "true",
    auth: { user, pass },
  });

  return transporter;
}

// ─── Outbound Notifications ────────────────────────────────────────────────

function markdownToHtml(markdown: string): string {
  if (!markdown) return "";

  let html = markdown
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/^### (.*$)/gim, '<h3 style="margin:16px 0 8px;font-size:16px;font-weight:600;">$1</h3>')
    .replace(/^## (.*$)/gim, '<h2 style="margin:20px 0 10px;font-size:18px;font-weight:600;border-bottom:1px solid #eee;padding-bottom:8px;">$1</h2>')
    .replace(/^# (.*$)/gim, '<h1 style="margin:24px 0 12px;font-size:22px;font-weight:600;">$1</h1>')
    .replace(/\*\*\*(.*?)\*\*\*/g, "<strong><em>$1</em></strong>")
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.*?)\*/g, "<em>$1</em>")
    .replace(/```([\s\S]*?)```/g, '<pre style="background:#f5f5f5;padding:12px;border-radius:6px;overflow-x:auto;font-size:13px;font-family:monospace;margin:12px 0;"><code>$1</code></pre>')
    .replace(/`([^`]+)`/g, '<code style="background:#f5f5f5;padding:2px 6px;border-radius:3px;font-size:13px;font-family:monospace;">$1</code>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" style="color:#0066cc;text-decoration:none;">$1</a>')
    .replace(/^\s*[-*+]\s+(.+)$/gim, '<li style="margin:4px 0;">$1</li>')
    .replace(/^\s*\[([ xX])\]\s+(.+)$/gim, '<li style="margin:4px 0;"><span style="margin-right:8px;">[$1]</span>$2</li>')
    .replace(/\n/g, "<br>");

  html = html.replace(/(<li[^>]*>.*?<\/li>)(?:<br>)+(?=<li)/g, "$1");
  html = html.replace(/(?:<li[^>]*>.*?<\/li>)+/g, '<ul style="margin:8px 0;padding-left:24px;">$&</ul>');

  const tableRegex = /(?:<br>)?\|([^\n]+)\|<br>\|[-:\|\s]+\|<br>((?:\|[^\n]+\|<br>)+)/g;
  html = html.replace(tableRegex, (match, headerRow, dataRows) => {
    const headers = headerRow.split("|").map((h: string) => h.trim()).filter(Boolean);
    const headerHtml = "<thead><tr>" + headers.map((h: string) =>
      `<th style="padding:10px 12px;border-bottom:2px solid #ddd;text-align:left;background:#f8f8f8;font-weight:600;font-size:13px;">${h}</th>`
    ).join("") + "</tr></thead>";

    const rows = dataRows.split("<br>").filter((r: string) => r.trim() && r.includes("|"));
    const bodyHtml = "<tbody>" + rows.map((row: string) => {
      const cells = row.split("|").map((c: string) => c.trim()).filter(Boolean);
      return "<tr>" + cells.map((c: string) =>
        `<td style="padding:8px 12px;border-bottom:1px solid #eee;font-size:14px;">${c}</td>`
      ).join("") + "</tr>";
    }).join("") + "</tbody>";

    return `<table style="width:100%;border-collapse:collapse;margin:16px 0;background:#fff;">${headerHtml}${bodyHtml}</table>`;
  });

  return html;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildHtml(n: { type: string; title: string; body?: string; agentId?: string }): string {
  const timestamp = new Date().toLocaleString("en-US", {
    weekday: "short", month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit", hour12: true,
  });

  const bodyHtml = n.body ? markdownToHtml(n.body) : "";

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1a1a1a;background:#f5f5f5;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
        <tr>
          <td style="padding:32px 32px 16px;">
            <strong style="font-size:13px;color:#666;text-transform:uppercase;letter-spacing:0.5px;">Kai</strong>
          </td>
        </tr>
        <tr>
          <td style="padding:0 32px 32px;">
            <h2 style="margin:0 0 16px;font-size:20px;font-weight:600;color:#1a1a1a;">${escapeHtml(n.title)}</h2>
            ${bodyHtml ? `<div style="font-size:15px;color:#333;line-height:1.6;">${bodyHtml}</div>` : ""}
            ${n.agentId ? `<p style="margin:24px 0 0;font-size:13px;color:#888;font-family:monospace;background:#f5f5f5;padding:8px 12px;border-radius:6px;">kai agent run ${n.agentId}</p>` : ""}
          </td>
        </tr>
        <tr>
          <td style="padding:24px 32px;background:#fafafa;border-top:1px solid #eee;border-radius:0 0 12px 12px;">
            <p style="margin:0 0 8px;font-size:13px;color:#666;">Reply to this email to message the agent.</p>
            <span style="font-size:12px;color:#999;">${timestamp}</span>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`.trim();
}

export async function sendNotificationEmail(n: {
  type: string;
  title: string;
  body?: string;
  agentId?: string;
  notificationId?: number;
  attachments?: string | string[];
}): Promise<void> {
  const to = process.env.NOTIFICATION_EMAIL;
  if (!to) return;

  // Check per-agent email notification settings
  if (n.agentId && n.type === "agent_completed") {
    const agent = getAgent(n.agentId);
    if (agent) {
      const config = JSON.parse(agent.config || "{}");
      // Default to true if not explicitly set to false
      if (config.emailNotifications === false) {
        return; // Skip sending email for this agent
      }
    }
  }

  const transport = getTransporter();
  if (!transport) return;

  const from = process.env.SMTP_FROM || "Kai <kai@thetravelingdeveloper.com>";
  const ref = n.notificationId ? `[kai-${n.notificationId}]` : "";
  const subject = ref ? `Kai — ${n.title} ${ref}` : `Kai — ${n.title}`;

  try {
    const replyTo = process.env.IMAP_USER ?
      `Kai <${process.env.IMAP_USER}>` : undefined;

    await transport.sendMail({
      from,
      to,
      replyTo,
      subject,
      headers: n.notificationId ? {
        "X-Kai-Notification-Id": String(n.notificationId),
        "X-Kai-Agent-Id": n.agentId || "",
      } : undefined,
      text: `${n.title}\n\n${n.body || ""}\n\n${n.agentId ? `kai agent run ${n.agentId}` : ""}\n\nReply to this email to send a message to the agent.`.trim(),
      html: buildHtml(n),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`  Warning: email notification failed: ${msg}`);
  }
}

// ─── IMAP Reply Polling ──────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 60_000;
let pollTimer: ReturnType<typeof setInterval> | null = null;
const processedUids = new Set<string>();
const threads = new Map<number, ChatCompletionMessageParam[]>();

interface ImapEmail {
  uid: string;
  subject: string;
  from: string;
  body: string;
}

class ImapClient {
  private socket: any = null;
  private buffer = "";
  private tag = 0;
  private host: string;
  private port: number;
  private user: string;
  private pass: string;

  constructor() {
    this.host = process.env.IMAP_HOST || (process.env.SMTP_HOST || "").replace("smtp.", "imap.");
    this.port = parseInt(process.env.IMAP_PORT || "993");
    this.user = process.env.IMAP_USER || process.env.NOTIFICATION_EMAIL || "";
    this.pass = process.env.IMAP_PASS || "";
  }

  isConfigured(): boolean {
    return !!(this.host && this.user && this.pass);
  }

  private command(cmd: string): Promise<string> {
    return new Promise((resolve, reject) => {
      if (!this.socket) {
        reject(new Error("IMAP socket not connected"));
        return;
      }

      const t = `A${++this.tag}`;
      let response = "";
      let settled = false;

      const onData = (chunk: Buffer) => {
        response += chunk.toString();
        if (response.includes(`${t} OK`) || response.includes(`${t} NO`) || response.includes(`${t} BAD`)) {
          if (settled) return;
          settled = true;
          this.socket?.removeListener("data", onData);
          if (response.includes(`${t} OK`)) resolve(response);
          else reject(new Error(response.trim()));
        }
      };

      this.socket.on("data", onData);
      this.socket.write(`${t} ${cmd}\r\n`);

      setTimeout(() => {
        if (settled) return;
        settled = true;
        this.socket?.removeListener("data", onData);
        reject(new Error("IMAP command timeout"));
      }, 15000);
    });
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      this.socket = tlsConnect({ host: this.host, port: this.port }, () => {
        const onGreeting = (chunk: Buffer) => {
          const data = chunk.toString();
          if (data.includes("OK")) {
            if (settled) return;
            settled = true;
            this.socket?.removeListener("data", onGreeting);
            resolve();
          }
        };
        this.socket?.on("data", onGreeting);
      });
      this.socket.on("error", (err: Error) => {
        if (settled) return;
        settled = true;
        reject(err);
      });
      setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error("IMAP connect timeout"));
      }, 10000);
    });
  }

  async login(): Promise<void> {
    await this.command(`LOGIN "${this.user}" "${this.pass}"`);
  }

  async listMailboxes(): Promise<string[]> {
    const response = await this.command('LIST "" "*"');
    const mailboxes: string[] = [];
    for (const line of response.split("\r\n")) {
      const match = line.match(/"([^"]+)"\s*$/);
      if (match) mailboxes.push(match[1]);
    }
    return mailboxes;
  }

  async selectMailbox(mailbox: string): Promise<void> {
    await this.command(`SELECT "${mailbox}"`);
  }

  async search(criteria: string): Promise<string[]> {
    const response = await this.command(`SEARCH ${criteria}`);
    const uids: string[] = [];
    const match = response.match(/\* SEARCH (.+)/);
    if (match) {
      uids.push(...match[1].trim().split(" ").filter(Boolean));
    }
    return uids;
  }

  async fetch(uid: string): Promise<string> {
    const response = await this.command(`FETCH ${uid} (RFC822)`);
    const match = response.match(/\* \d+ FETCH \(RFC822 \{([\d]+)\}\r\n([\s\S]+?)\r\n\)/);
    if (match) return match[2];

    const simpleMatch = response.match(/RFC822 \{[\d]+\}\r\n([\s\S]+?)\r\n\w+ OK/);
    if (simpleMatch) return simpleMatch[1];

    return "";
  }

  async disconnect(): Promise<void> {
    if (!this.socket) return;
    try {
      await this.command("LOGOUT");
    } catch {}
    try {
      this.socket.end();
      this.socket.destroy();
    } catch {}
    this.socket = null;
  }

  async searchKaiReplies(): Promise<ImapEmail[]> {
    const emails: ImapEmail[] = [];
    const mailboxes = await this.listMailboxes();
    const inbox = mailboxes.find(m => m.toLowerCase() === "inbox") || "INBOX";

    await this.selectMailbox(inbox);
    const uids = await this.search("UNSEEN");

    for (const uid of uids) {
      if (processedUids.has(uid)) continue;

      const raw = await this.fetch(uid);
      if (!raw) continue;

      const subjectMatch = raw.match(/Subject:\s*([^\r\n]+)/i);
      const fromMatch = raw.match(/From:\s*([^\r\n]+)/i);
      const subject = subjectMatch ? subjectMatch[1].trim() : "";
      const from = fromMatch ? fromMatch[1].trim() : "";

      if (!subject.includes("[kai-")) continue;

      const body = this.extractPlainText(raw);
      emails.push({ uid, subject, from, body });
      processedUids.add(uid);
    }

    if (processedUids.size > 1000) {
      const arr = Array.from(processedUids).slice(-500);
      processedUids.clear();
      arr.forEach(u => processedUids.add(u));
    }

    return emails;
  }

  private decodeMimeHeader(header: string): string {
    return header.replace(/=\?([^?]+)\?([QqBb])\?([^?]+)\?=/g, (_, _charset, encoding, encoded) => {
      if (encoding.toUpperCase() === "B") {
        return Buffer.from(encoded, "base64").toString("utf-8");
      }
      return encoded
        .replace(/_/g, " ")
        .replace(/=([0-9A-Fa-f]{2})/g, (_: string, hex: string) =>
          String.fromCharCode(parseInt(hex, 16))
        );
    });
  }

  private decodeQuotedPrintable(text: string): string {
    return text
      .replace(/=\r?\n/g, "")
      .replace(/=([0-9A-Fa-f]{2})/g, (_, hex) =>
        String.fromCharCode(parseInt(hex, 16))
      );
  }

  private extractPlainText(raw: string): string {
    const plainMatch = raw.match(
      /Content-Type:\s*text\/plain[^\r\n]*\r?\n(?:Content-Transfer-Encoding:\s*([^\r\n]+)\r?\n)?(?:\r?\n)([\s\S]*?)(?=-[a-zA-Z0-9]+|$)/i
    );

    if (plainMatch) {
      const encoding = (plainMatch[1] || "").trim().toLowerCase();
      let body = plainMatch[2].trim();
      if (encoding === "quoted-printable") body = this.decodeQuotedPrintable(body);
      return body;
    }

    return raw;
  }
}

function extractNotificationId(subject: string): number | null {
  const match = subject.match(/\[kai-(\d+)\]/);
  return match ? parseInt(match[1], 10) : null;
}

function extractReplyBody(text: string): string {
  const lines = text.split("\n");
  const cleaned: string[] = [];

  for (const line of lines) {
    if (/^--\s*$/.test(line)) break;
    if (/^On .+ wrote:$/.test(line)) break;
    if (/^Sent from my/.test(line)) break;
    if (line.startsWith(">")) continue;
    cleaned.push(line);
  }

  return cleaned.join("\n").trim();
}

function buildReplyHtml(agentName: string, reply: string, originalMessage: string): string {
  const timestamp = new Date().toLocaleString("en-US", {
    weekday: "short", month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit", hour12: true,
  });

  const replyHtml = reply.replace(/\n/g, "<br>");
  const originalHtml = originalMessage.replace(/\n/g, "<br>");

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1a1a1a;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px;">
    <tr><td align="center">
      <table width="520" cellpadding="0" cellspacing="0">
        <tr>
          <td style="padding-bottom:24px;">
            <strong style="font-size:13px;color:#999;text-transform:uppercase;letter-spacing:0.5px;">Kai - ${agentName}</strong>
          </td>
        </tr>
        <tr>
          <td>
            <p style="margin:0 0 20px;font-size:14px;color:#1a1a1a;line-height:1.6;">${replyHtml}</p>
          </td>
        </tr>
        <tr>
          <td style="padding-top:20px;border-top:1px solid #eee;">
            <p style="margin:0 0 4px;font-size:12px;color:#999;">Your message:</p>
            <p style="margin:0;font-size:13px;color:#888;line-height:1.5;font-style:italic;">${originalHtml}</p>
          </td>
        </tr>
        <tr>
          <td style="padding-top:20px;">
            <span style="font-size:12px;color:#bbb;">${timestamp}</span>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`.trim();
}

async function handleReply(subject: string, body: string): Promise<void> {
  const notifId = extractNotificationId(subject);
  if (!notifId) return;

  const notif = getNotification(notifId);
  if (!notif) {
    console.log(`  ✉ No notification found for [kai-${notifId}]`);
    return;
  }

  const agentId = notif.agent_id;
  const agent = agentId ? getAgent(agentId) : null;
  if (!agent || !agentId) {
    console.log(`  ✉ No agent found for notification [kai-${notifId}]`);
    return;
  }

  const replyText = extractReplyBody(body);
  if (!replyText) {
    console.log(`  ✉ Empty reply for [kai-${notifId}]`);
    return;
  }

  let messages = threads.get(notifId);
  if (!messages) {
    const workflowDef = JSON.parse(agent.workflow_path || "{}") as { systemPrompt?: string };
    messages = [
      { role: "system", content: workflowDef.systemPrompt || `You are ${agent.name}. Reply concisely.` },
    ];
    threads.set(notifId, messages);
  }

  messages.push({ role: "user", content: replyText });

  try {
    const client = createClient();
    const response = await client.chat.completions.create({
      model: getModelId(),
      messages,
      max_tokens: 1024,
    });

    const llmReply = response.choices[0]?.message?.content
      || (response.choices[0]?.message as any)?.reasoning || "";

    if (llmReply) {
      messages.push({ role: "assistant", content: llmReply });
    }

    const to = process.env.NOTIFICATION_EMAIL;
    const transport = getTransporter();

    if (to && llmReply && transport) {
      const fromAddr = process.env.SMTP_FROM || "Kai <kai@thetravelingdeveloper.com>";
      const replyTo = process.env.IMAP_USER ?
        `Kai <${process.env.IMAP_USER}>` : undefined;

      await transport.sendMail({
        from: fromAddr,
        replyTo,
        to,
        subject: `Re: ${subject}`,
        text: llmReply,
        html: buildReplyHtml(agent.name, llmReply, replyText),
      });
    }

    createNotification({
      type: "email_reply",
      title: `${agent.name}: email reply`,
      body: `User: ${replyText.substring(0, 100)}${replyText.length > 100 ? "..." : ""}\nKai: ${llmReply.substring(0, 100)}${llmReply.length > 100 ? "..." : ""}`,
      agentId,
    });

    console.log(`  ✉ Email reply processed for ${agent.name} [kai-${notifId}]`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`  ✉ Email reply failed: ${msg}`);
  }
}

async function pollOnce(): Promise<void> {
  const imap = new ImapClient();
  if (!imap.isConfigured()) return;

  try {
    await imap.connect();
    await imap.login();
    const emails = await imap.searchKaiReplies();

    for (const email of emails) {
      await handleReply(email.subject, email.body);
    }

    await imap.disconnect();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`  ✉ Email poll error: ${msg}`);
    try { await imap.disconnect(); } catch {}
  }
}

export function startEmailPoller(): void {
  const imap = new ImapClient();
  if (!imap.isConfigured()) return;
  if (pollTimer) return;

  const safePoll = () => {
    pollOnce().catch((err) => {
      console.error(`  ✉ Email poll uncaught error: ${err?.message || err}`);
    });
  };

  setTimeout(safePoll, 10_000);
  pollTimer = setInterval(safePoll, POLL_INTERVAL_MS);
  console.log("  ✉ Email reply poller started (60s interval)");
}

export function stopEmailPoller(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}
