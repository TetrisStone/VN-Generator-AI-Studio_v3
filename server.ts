import "dotenv/config";
import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";

async function generateGeminiWithRetryAndFallback(
  ai: GoogleGenAI,
  {
    requestedModel,
    prompt,
    config,
  }: {
    requestedModel: string;
    prompt: string;
    config: any;
  }
) {
  // Candidate models sequence
  const modelCandidates: string[] = [];

  const cleanReqModel = (requestedModel || "").trim();
  if (cleanReqModel && cleanReqModel.startsWith("gemini-")) {
    modelCandidates.push(cleanReqModel);
  }

  // Standard fallback models in case requested model is unavailable (503) or rate limited (429)
  const defaultFallbacks = ["gemini-3.6-flash", "gemini-2.5-flash", "gemini-flash-latest"];
  for (const fb of defaultFallbacks) {
    if (!modelCandidates.includes(fb)) {
      modelCandidates.push(fb);
    }
  }

  let lastError: any = null;

  for (const modelCandidate of modelCandidates) {
    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`Gemini generateContent timeout for model ${modelCandidate}`)), 60000)
        );

        const resPromise = ai.models.generateContent({
          model: modelCandidate,
          contents: prompt,
          config,
        });

        const geminiRes = (await Promise.race([resPromise, timeoutPromise])) as any;
        return geminiRes;
      } catch (err: any) {
        lastError = err;
        const errMessage = String(err?.message || err || "");
        const errStatus = err?.status || err?.code || "";
        const isTransient =
          errMessage.includes("503") ||
          errMessage.includes("UNAVAILABLE") ||
          errMessage.includes("high demand") ||
          errMessage.includes("RESOURCE_EXHAUSTED") ||
          errMessage.includes("429") ||
          errMessage.includes("overloaded") ||
          errMessage.includes("timeout") ||
          errMessage.includes("fetch failed") ||
          errStatus === 503 ||
          errStatus === 429 ||
          errStatus === "UNAVAILABLE";

        console.warn(
          `[Gemini Server Proxy] Attempt ${attempt}/${maxAttempts} for model '${modelCandidate}' failed: ${errMessage}`
        );

        if (isTransient && attempt < maxAttempts) {
          // Wait before retry
          await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
        } else {
          // Move on to next fallback model
          break;
        }
      }
    }
  }

  throw lastError || new Error("Gemini API call failed after retries on all fallback models.");
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Middleware for body parsing
  app.use(express.json({ limit: "15mb" }) as any);

  // API endpoint for Gemini content generation
  app.post("/api/gemini/generate", async (req, res) => {
    try {
      const { prompt, schema, defaultGeminiModel, worldInfo } = req.body;

      // Access API key from server environment
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        return res.status(400).json({ 
          error: "GEMINI_API_KEY ist auf dem Server nicht konfiguriert. Bitte trage den API Key in die Umgebungsvariablen oder die .env-Datei auf dem Server ein." 
        });
      }

      // Initialize the official @google/genai SDK on the server side
      const ai = new GoogleGenAI({
        apiKey: apiKey,
        httpOptions: {
          headers: {
            "User-Agent": "aistudio-build",
          },
        },
      });

      let model = worldInfo?.llmModel || defaultGeminiModel || "gemini-3.6-flash";
      const provider = worldInfo?.llmProvider || "gemini";
      
      if (provider === "gemini" && (!model || !model.startsWith("gemini-"))) {
        console.warn(`Ungültiges Gemini-Modell "${model}" für Gemini-Provider erkannt. Fallback auf "gemini-3.6-flash" vorgenommen.`);
        model = "gemini-3.6-flash";
      }

      // Execute content generation with retry & model fallback logic
      const geminiRes = await generateGeminiWithRetryAndFallback(ai, {
        requestedModel: model,
        prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: schema,
          temperature: 1,
        },
      });

      // Extract usage token statistics
      const tokenStats = {
        promptTokens: geminiRes.usageMetadata?.promptTokenCount || 0,
        completionTokens: geminiRes.usageMetadata?.candidatesTokenCount || 0,
        totalTokens: geminiRes.usageMetadata?.totalTokenCount || 0,
      };

      res.json({
        json: JSON.parse(geminiRes.text || "{}"),
        tokenStats,
      });
    } catch (error: any) {
      console.error("Server-side Gemini proxy error:", error);
      res.status(500).json({ 
        error: error.message || "Fehler bei der Kommunikation mit der Gemini API auf dem Server." 
      });
    }
  });

  // API endpoint for Gemini text generation
  app.post("/api/gemini/generateText", async (req, res) => {
    try {
      const { prompt, defaultGeminiModel, worldInfo } = req.body;
      const apiKey = process.env.GEMINI_API_KEY;

      if (!apiKey) {
        return res.status(400).json({ error: "GEMINI_API_KEY ist auf dem Server nicht konfiguriert." });
      }

      const ai = new GoogleGenAI({ apiKey });
      let model = worldInfo?.llmModel || defaultGeminiModel || "gemini-3.6-flash";
      const provider = worldInfo?.llmProvider || "gemini";

      if (provider === "gemini" && (!model || !model.startsWith("gemini-"))) {
        model = "gemini-3.6-flash";
      }

      const geminiRes = await generateGeminiWithRetryAndFallback(ai, {
        requestedModel: model,
        prompt,
        config: {
          temperature: 0.7,
        },
      });

      res.json({ text: geminiRes.text || "" });
    } catch (error: any) {
      console.error("Server-side Gemini proxy error:", error);
      res.status(500).json({ error: error.message || "Fehler bei der Textgenerierung." });
    }
  });

  // Setup Vite or standard Static Assets Serving
  if (process.env.NODE_ENV !== "production") {
    console.log("Starting server in development mode with Vite middleware...");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares as any);
  } else {
    console.log("Serving static production assets from dist/ directory...");
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath) as any);
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer().catch((error) => {
  console.error("Failed to start server:", error);
});
