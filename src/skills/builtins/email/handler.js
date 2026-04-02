/**
 * Email Skill Handler — Nodemailer SMTP + basic IMAP
 *
 * Provides tools to send emails via SMTP and read emails via IMAP.
 * Supports any SMTP/IMAP provider (Gmail, Outlook, custom servers).
 */

import { createRequire } from "module";
import { connect as tlsConnect } from "tls";
import { connect as netConnect } from "net";

let transporter = null;
let smtpConfig = {};
let imapConfig = {};

function loadNodemailer() {
  const require = createRequire(process.cwd() + "/package.json");
  return require("nodemailer");
}

function initTransporter(config) {
  const nodemailer = loadNodemailer();

  smtpConfig = {
    host: config.SMTP_HOST,
    port: config.SMTP_PORT || 587,
    secure: config.SMTP_SECURE || false,
    auth: {
      user: config.SMTP_USER,
      pass: config.SMTP_PASS,
    },
  };

  imapConfig = {
    host: config.IMAP_HOST || config.SMTP_HOST?.replace("smtp.", "imap."),
    port: config.IMAP_PORT || 993,
    user: config.IMAP_USER || config.SMTP_USER,
    pass: config.IMAP_PASS || config.SMTP_PASS,
  };

  transporter = nodemailer.createTransport(smtpConfig);
  return transporter;
}

function ensureTransporter(config) {
  if (!transporter && config) initTransporter(config);
  if (!transporter) throw new Error("Email not configured. Set SMTP_HOST, SMTP_USER, and SMTP_PASS environment variables (prefixed with KAI_SKILL_EMAIL_).");
  return transporter;
}

// ─── Minimal IMAP client (no extra dependency) ───────────────────────────────
// Implements just enough of IMAP to fetch recent messages and search.

class SimpleIMAP {
  constructor(config) {
    this.host = config.host;
    this.port = config.port;
    this.user = config.user;
    this.pass = config.pass;
    this.socket = null;
    this.tagCounter = 0;
    this.buffer = "";
  }

  async connect() {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("IMAP connection timeout")), 15000);

      this.socket = tlsConnect(
        { host: this.host, port: this.port, rejectUnauthorized: true },
        () => {
          clearTimeout(timeout);
          this._readGreeting().then(resolve).catch(reject);
        }
      );
      this.socket.setEncoding("utf8");
      this.socket.on("error", (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  }

  async _readGreeting() {
    return this._readUntilTag("*");
  }

  _nextTag() {
    return `A${++this.tagCounter}`;
  }

  async _command(cmd) {
    const tag = this._nextTag();
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`IMAP command timeout: ${cmd}`)), 15000);
      this.socket.write(`${tag} ${cmd}\r\n`);
      this._readUntilTag(tag)
        .then((lines) => {
          clearTimeout(timeout);
          resolve(lines);
        })
        .catch((err) => {
          clearTimeout(timeout);
          reject(err);
        });
    });
  }

  _readUntilTag(tag) {
    return new Promise((resolve, reject) => {
      const lines = [];

      const onData = (chunk) => {
        this.buffer += chunk;
        const parts = this.buffer.split("\r\n");
        this.buffer = parts.pop(); // keep incomplete line

        for (const line of parts) {
          lines.push(line);
          if (tag === "*" && line.startsWith("* OK")) {
            this.socket.removeListener("data", onData);
            resolve(lines);
            return;
          }
          if (tag !== "*" && line.startsWith(tag + " ")) {
            this.socket.removeListener("data", onData);
            if (line.includes("OK")) {
              resolve(lines);
            } else {
              reject(new Error(`IMAP error: ${line}`));
            }
            return;
          }
        }
      };

      this.socket.on("data", onData);
    });
  }

  async login() {
    // Escape password in quotes
    const escapedPass = this.pass.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    await this._command(`LOGIN "${this.user}" "${escapedPass}"`);
  }

  async select(folder = "INBOX") {
    const lines = await this._command(`SELECT "${folder}"`);
    let exists = 0;
    for (const line of lines) {
      const match = line.match(/\* (\d+) EXISTS/);
      if (match) exists = parseInt(match[1]);
    }
    return exists;
  }

  async search(criteria = "ALL") {
    const lines = await this._command(`SEARCH ${criteria}`);
    for (const line of lines) {
      if (line.startsWith("* SEARCH")) {
        const ids = line.replace("* SEARCH", "").trim();
        return ids ? ids.split(" ").map(Number) : [];
      }
    }
    return [];
  }

  async fetchHeaders(seqNums) {
    if (seqNums.length === 0) return [];

    const range = seqNums.join(",");
    const lines = await this._command(
      `FETCH ${range} (BODY.PEEK[HEADER.FIELDS (FROM TO SUBJECT DATE)] BODY.PEEK[TEXT]<0.500>)`
    );

    const messages = [];
    let current = null;
    let collectingBody = false;
    let bodyLines = [];

    for (const line of lines) {
      if (line.match(/^\* \d+ FETCH/)) {
        if (current) {
          current.preview = bodyLines.join(" ").replace(/\s+/g, " ").trim().substring(0, 300);
          messages.push(current);
        }
        current = { from: "", to: "", subject: "", date: "", preview: "" };
        collectingBody = false;
        bodyLines = [];
      }

      if (current) {
        if (line.match(/^From:/i)) current.from = line.replace(/^From:\s*/i, "").trim();
        if (line.match(/^To:/i)) current.to = line.replace(/^To:\s*/i, "").trim();
        if (line.match(/^Subject:/i)) current.subject = line.replace(/^Subject:\s*/i, "").trim();
        if (line.match(/^Date:/i)) current.date = line.replace(/^Date:\s*/i, "").trim();

        // Collect body text preview
        if (line === "" && current.subject) collectingBody = true;
        else if (collectingBody && !line.startsWith(")")) bodyLines.push(line);
      }
    }

    if (current) {
      current.preview = bodyLines.join(" ").replace(/\s+/g, " ").trim().substring(0, 300);
      messages.push(current);
    }

    return messages;
  }

  async logout() {
    try {
      await this._command("LOGOUT");
    } catch {}
    this.socket?.destroy();
    this.socket = null;
  }
}

async function withIMAP(fn) {
  if (!imapConfig.host) {
    throw new Error("IMAP not configured. Set IMAP_HOST or ensure SMTP_HOST uses a provider with a matching IMAP server.");
  }

  const imap = new SimpleIMAP(imapConfig);
  try {
    await imap.connect();
    await imap.login();
    return await fn(imap);
  } finally {
    await imap.logout();
  }
}

// ─── Skill exports ───────────────────────────────────────────────────────────

let _config = null;

export default {
  install: async (config) => {
    _config = config;
    try {
      initTransporter(config);
    } catch {
      // Will fail at action time with a clear message
    }
  },

  uninstall: async () => {
    if (transporter) {
      transporter.close();
      transporter = null;
    }
  },

  actions: {
    send: async (params) => {
      const t = ensureTransporter(_config);

      const fromAddr = smtpConfig.auth.user;
      const from = params.from_name ? `"${params.from_name}" <${fromAddr}>` : fromAddr;

      const mailOptions = {
        from,
        to: params.to,
        subject: params.subject,
        text: params.body,
      };

      if (params.html) mailOptions.html = params.html;
      if (params.cc) mailOptions.cc = params.cc;
      if (params.bcc) mailOptions.bcc = params.bcc;
      if (params.reply_to) mailOptions.replyTo = params.reply_to;

      const info = await t.sendMail(mailOptions);

      return JSON.stringify({
        success: true,
        message_id: info.messageId,
        to: params.to,
        subject: params.subject,
        response: info.response,
      });
    },

    read: async (params) => {
      return await withIMAP(async (imap) => {
        const folder = params.folder || "INBOX";
        const limit = Math.min(params.limit || 10, 50);
        const exists = await imap.select(folder);

        if (exists === 0) {
          return JSON.stringify({ folder, messages: [], total: 0 });
        }

        let seqNums;
        if (params.unseen_only) {
          seqNums = await imap.search("UNSEEN");
          seqNums = seqNums.slice(-limit);
        } else {
          const start = Math.max(1, exists - limit + 1);
          seqNums = [];
          for (let i = start; i <= exists; i++) seqNums.push(i);
        }

        const messages = await imap.fetchHeaders(seqNums);

        return JSON.stringify({
          folder,
          total: exists,
          fetched: messages.length,
          messages: messages.reverse(), // newest first
        });
      });
    },

    search: async (params) => {
      return await withIMAP(async (imap) => {
        const limit = Math.min(params.limit || 10, 50);
        await imap.select("INBOX");

        const criteria = [];
        if (params.from) criteria.push(`FROM "${params.from}"`);
        if (params.subject) criteria.push(`SUBJECT "${params.subject}"`);
        if (params.since) criteria.push(`SINCE ${params.since}`);
        if (params.before) criteria.push(`BEFORE ${params.before}`);
        if (params.unseen_only) criteria.push("UNSEEN");
        if (criteria.length === 0) criteria.push("ALL");

        const seqNums = await imap.search(criteria.join(" "));
        const selected = seqNums.slice(-limit);
        const messages = await imap.fetchHeaders(selected);

        return JSON.stringify({
          criteria: criteria.join(" "),
          total_matches: seqNums.length,
          fetched: messages.length,
          messages: messages.reverse(),
        });
      });
    },

    verify: async () => {
      const t = ensureTransporter(_config);
      await t.verify();
      return JSON.stringify({
        success: true,
        smtp_host: smtpConfig.host,
        smtp_port: smtpConfig.port,
        user: smtpConfig.auth.user,
        message: "SMTP connection verified successfully",
      });
    },
  },
};
