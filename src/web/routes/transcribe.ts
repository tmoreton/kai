import { Hono } from "hono";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";

// Whisper API configuration
const WHISPER_API_URL = "https://api.openai.com/v1/audio/transcriptions";
const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/audio/transcriptions";

export function registerTranscribeRoutes(app: Hono) {
  // Transcribe audio using Whisper API
  app.post("/api/transcribe", async (c) => {
    try {
      const body = await c.req.parseBody();
      const audioFile = body.audio as File;

      if (!audioFile) {
        return c.json({ error: "No audio file provided" }, 400);
      }

      // Convert to buffer
      const arrayBuffer = await audioFile.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      // Try OpenAI Whisper first, fall back to OpenRouter
      let transcription: string | null = null;
      let error: string | null = null;

      // Try OpenAI if key exists
      const openaiKey = process.env.OPENAI_API_KEY;
      if (openaiKey) {
        try {
          const formData = new FormData();
          formData.append("file", new Blob([buffer]), "audio.webm");
          formData.append("model", "whisper-1");
          formData.append("language", "en");

          const response = await fetch(WHISPER_API_URL, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${openaiKey}`,
            },
            body: formData,
          });

          if (response.ok) {
            const data = await response.json();
            transcription = data.text;
          } else {
            error = `OpenAI: ${await response.text()}`;
          }
        } catch (err) {
          error = err instanceof Error ? err.message : "OpenAI request failed";
        }
      }

      // Try OpenRouter if OpenAI failed or no key
      if (!transcription) {
        const openrouterKey = process.env.OPENROUTER_API_KEY;
        if (openrouterKey) {
          try {
            const formData = new FormData();
            formData.append("file", new Blob([buffer]), "audio.webm");
            formData.append("model", "openai/whisper-1");
            formData.append("language", "en");

            const response = await fetch(OPENROUTER_API_URL, {
              method: "POST",
              headers: {
                Authorization: `Bearer ${openrouterKey}`,
                "HTTP-Referer": "https://kai-ai.app",
                "X-Title": "Kai AI",
              },
              body: formData,
            });

            if (response.ok) {
              const data = await response.json();
              transcription = data.text || data.choices?.[0]?.text;
            } else {
              error = `OpenRouter: ${await response.text()}`;
            }
          } catch (err) {
            error = err instanceof Error ? err.message : "OpenRouter request failed";
          }
        }
      }

      // Last resort: try local whisper if installed
      if (!transcription) {
        try {
          const tempDir = os.tmpdir();
          const inputPath = path.join(tempDir, `kai-audio-${Date.now()}.webm`);
          const outputPath = path.join(tempDir, `kai-audio-${Date.now()}.wav`);

          // Write audio file
          fs.writeFileSync(inputPath, buffer);

          // Convert to wav using ffmpeg if available
          try {
            execSync(`ffmpeg -i "${inputPath}" -ar 16000 -ac 1 -c:a pcm_s16le "${outputPath}"`, {
              stdio: "pipe",
              timeout: 30000,
            });

            // Try running local whisper
            const result = execSync(`whisper "${outputPath}" --language en --model tiny --output_format txt 2>&1`, {
              encoding: "utf-8",
              stdio: "pipe",
              timeout: 60000,
            });

            transcription = result.trim();

            // Cleanup
            fs.unlinkSync(inputPath);
            fs.unlinkSync(outputPath);
          } catch {
            // ffmpeg or whisper not available
          }
        } catch {
          // Local transcription failed
        }
      }

      if (transcription) {
        return c.json({ text: transcription });
      } else {
        return c.json({ 
          error: error || "Transcription failed. Please set OPENAI_API_KEY or OPENROUTER_API_KEY environment variable." 
        }, 500);
      }

    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Transcription failed";
      return c.json({ error: errorMsg }, 500);
    }
  });
}
