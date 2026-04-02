import { Hono } from "hono";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { getNotification, getAgent, createNotification } from "../../agents/db.js";
import { createClient, getModelId } from "../../client.js";
import nodemailer from "nodemailer";

/**
 * Inbound email webhook for Resend.
 *
 * When a user replies to a Kai notification email, Resend forwards the reply
 * to this endpoint. We extract the notification ID from the subject line,
 * look up the agent, and continue a threaded conversation with the LLM.
 */

// In-memory conversation threads keyed by notification ID.
// Each thread persists the full message history so multi-reply threads work.
const threads = new Map<number, ChatCompletionMessageParam[]>();

/** Strip quoted reply text (lines starting with >) and email signatures */
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

/** Extract [kai-123] notification ID from subject */
function extractNotificationId(subject: string): number | null {
  const match = subject.match(/\[kai-(\d+)\]/);
  return match ? parseInt(match[1], 10) : null;
}

function getMailTransport(): nodemailer.Transporter | null {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) return null;

  return nodemailer.createTransport({
    host,
    port: parseInt(process.env.SMTP_PORT || "587"),
    secure: process.env.SMTP_SECURE === "true",
    auth: { user, pass },
  });
}

export function registerWebhookRoutes(app: Hono) {
  app.post("/api/webhooks/inbound-email", async (c) => {
    let payload: any;
    try {
      payload = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON" }, 400);
    }

    const data = payload.data || payload;
    const subject = data.subject || "";
    const textBody = data.text || data.body || "";

    const replyText = extractReplyBody(textBody);
    if (!replyText) {
      return c.json({ ok: true, skipped: "empty reply" });
    }

    const notifId = extractNotificationId(subject);
    if (!notifId) {
      return c.json({ ok: true, skipped: "no notification reference found" });
    }

    const notification = getNotification(notifId);
    if (!notification) {
      return c.json({ ok: true, skipped: "notification not found" });
    }

    const agentId = notification.agent_id;
    if (!agentId) {
      return c.json({ ok: true, skipped: "no agent linked to notification" });
    }

    const agent = getAgent(agentId);
    if (!agent) {
      return c.json({ ok: true, skipped: "agent not found" });
    }

    // Get or create the conversation thread for this notification
    let messages = threads.get(notifId);
    if (!messages) {
      messages = [
        {
          role: "system",
          content: `You are ${agent.name}. ${agent.description || ""}
You are conversing with the user via email about this notification:

Title: ${notification.title}
Details: ${notification.body || "none"}

Respond helpfully and concisely. Keep responses under 200 words.`,
        },
      ];
      threads.set(notifId, messages);
    }

    // Add the user's reply
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

      // Persist assistant reply in thread
      if (llmReply) {
        messages.push({ role: "assistant", content: llmReply });
      }

      // Send response email
      const to = process.env.NOTIFICATION_EMAIL;
      const transport = getMailTransport();

      if (to && llmReply && transport) {
        const fromAddr = process.env.SMTP_FROM || "Kai <kai@thetravelingdeveloper.com>";

        await transport.sendMail({
          from: fromAddr,
          to,
          subject: `Re: ${subject}`,
          text: llmReply,
          html: buildReplyHtml(agent.name, llmReply, replyText),
        });
      }

      // Log as notification
      createNotification({
        type: "email_reply",
        title: `${agent.name}: email reply`,
        body: `User: ${replyText.substring(0, 100)}${replyText.length > 100 ? "..." : ""}\nKai: ${llmReply.substring(0, 100)}${llmReply.length > 100 ? "..." : ""}`,
        agentId,
      });

      return c.json({ ok: true, agentId, replied: true });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return c.json({ error: msg }, 500);
    }
  });
}

function buildReplyHtml(agentName: string, reply: string, originalMessage: string): string {
  const timestamp = new Date().toLocaleString("en-US", {
    weekday: "short", month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit", hour12: true,
  });

  const replyHtml = reply.replace(/\n/g, "<br>");
  const originalHtml = originalMessage.replace(/\n/g, "<br>");

  return `
<!DOCTYPE html>
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
