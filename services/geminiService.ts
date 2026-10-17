
import { Type, Schema } from "@google/genai";
import { Scene, Character, ChatMessage, AIResponse, WorldInfo, Chapter, StoryLogEntry, SceneCharacterConfig, Faction, WorldLocation, AssetItem } from "../types";

export const EMOTION_ENUM = ['idle', 'happy', 'angry', 'thoughtful', 'shy', 'sad', 'shocked', 'worried', 'lustful'] as const;

function buildResponseSchema(activeCharacterIds: string[]): Schema {
  // 'narrator' and 'system' always allowed for narration and system messages
  const allowedCharacterIds = Array.from(new Set([...activeCharacterIds, 'narrator', 'system']));
  
  return {
    type: Type.OBJECT,
    properties: {
      characterResponses: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            characterId: {
              type: Type.STRING,
              enum: allowedCharacterIds,
              description: "ID of the speaking character. Must be one of the active characters in the scene, or 'narrator' for descriptive narration.",
            },
            emotion: {
              type: Type.STRING,
              enum: [...EMOTION_ENUM],
              description: "Emotion of the character during this line. Use 'idle' for normal/neutral state.",
            },
            text: { type: Type.STRING, description: "The dialogue line or narration." },
          },
          required: ["characterId", "text"],
        },
        description: "List of responses from characters in the scene. Can be empty if only narrator speaks or no one speaks.",
      },
      relationshipUpdates: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            characterId: {
              type: Type.STRING,
              enum: allowedCharacterIds,
              description: "ID of the character whose relationship changed.",
            },
            change: { type: Type.NUMBER, description: "Numeric change (e.g., +5, -10)." },
            reason: { type: Type.STRING, description: "Short reason for the change (e.g., 'Player was rude')." }
          },
          required: ["characterId", "change", "reason"]
        },
        description: "Optional list of relationship changes triggered by player's last action."
      },
      sceneGoalReached: {
        type: Type.BOOLEAN,
        description: "Set to TRUE if the player has achieved, fulfilled, or completed the scene's goal/win condition. Set to FALSE if the goal is not yet achieved or if there is no goal.",
      },
      sceneTransitionReason: {
        type: Type.STRING,
        description: "Brief explanation if the scene goal is reached or scene is ending.",
      },
    },
    required: ["characterResponses", "sceneGoalReached"],
  };
}

// Schema for Scene Summarization
const SUMMARY_SCHEMA: Schema = {
    type: Type.OBJECT,
    properties: {
        summary: { type: Type.STRING, description: "A concise summary (3-5 sentences) of the events, key decisions, and outcome of the scene." },
        importance: { 
            type: Type.STRING, 
            enum: ['critical', 'major', 'minor'],
            description: "Importance level: 'critical' for irreversible key events/twists/milestones, 'major' for relationship changes/key player choices/important revelations, 'minor' for atmospheric/casual scenes."
        },
        tags: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: "1-4 tags selected ONLY from: 'conflict', 'romance', 'revelation', 'promise', 'betrayal', 'alliance', 'discovery', 'loss', 'humor', 'milestone'."
        },
        referencedCharacterIds: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: "IDs of present characters mentioned by name or playing a central role in the summary."
        }
    },
    required: ["summary", "importance", "tags", "referencedCharacterIds"]
};

// Schema for Lore Teaser Generation
const TEASER_SCHEMA: Schema = {
    type: Type.OBJECT,
    properties: {
        teaser: { 
            type: Type.STRING, 
            description: "Ein prägnanter Satz (max. 200 Zeichen), der den Lore-Eintrag zusammenfasst." 
        }
    },
    required: ["teaser"]
};

// Schema for Lore Relevance Router
const LORE_ROUTER_SCHEMA: Schema = {
    type: Type.OBJECT,
    properties: {
        selectedIds: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: "Liste der IDs aller relevanten Fraktionen und Lore-Orte für diese Szene."
        }
    },
    required: ["selectedIds"]
};

function buildSceneGenSchema(allCharacterIds: string[]): Schema {
  return {
    type: Type.OBJECT,
    properties: {
      name: { type: Type.STRING, description: "Creative name for the scene." },
      locationName: { type: Type.STRING, description: "Where this takes place (e.g. 'The Rusty Tavern')." },
      description: { type: Type.STRING, description: "Visible description for the player." },
      goal: { type: Type.STRING, description: "Objective for the player (or empty if it's a chill scene)." },
      aiInstructions: { type: Type.STRING, description: "Hidden instructions for the AI on how to play the characters." },
      sensoryDetails: { type: Type.STRING, description: "Smells, sounds, lighting." },
      environmentDetails: { type: Type.STRING, description: "Physical layout description." },
      suggestedBackgroundSrc: { type: Type.STRING, description: "ID of the background asset selected from the AVAILABLE ASSETS IN LIBRARY (or empty if none matches)." },
      characters: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            characterId: { 
              type: Type.STRING, 
              enum: allCharacterIds,
              description: "Must be one of the provided Character IDs." 
            },
            roleInScene: { type: Type.STRING, description: "What is this character doing here?" }
          },
          required: ["characterId", "roleInScene"]
        }
      }
    },
    required: ["name", "locationName", "description", "goal", "aiInstructions", "characters"]
  };
}

function extractJson(rawText: string): string {
  if (!rawText) return "";

  // 1. Remove <think>...</think> reasoning blocks (e.g. from Ollama DeepSeek/Qwen models)
  let cleaned = rawText.replace(/<think>[\s\S]*?<\/think>/gi, "");

  // 2. Extract content from markdown codeblock if present (```json ... ``` or ``` ... ```)
  const codeBlockMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (codeBlockMatch) {
    cleaned = codeBlockMatch[1];
  }

  // 3. Remove everything before first '{' or '[' and after last '}' or ']'
  const firstObj = cleaned.indexOf('{');
  const firstArr = cleaned.indexOf('[');
  let first = -1;
  if (firstObj !== -1 && firstArr !== -1) {
    first = Math.min(firstObj, firstArr);
  } else {
    first = firstObj !== -1 ? firstObj : firstArr;
  }

  const lastObj = cleaned.lastIndexOf('}');
  const lastArr = cleaned.lastIndexOf(']');
  let last = -1;
  if (lastObj !== -1 && lastArr !== -1) {
    last = Math.max(lastObj, lastArr);
  } else {
    last = lastObj !== -1 ? lastObj : lastArr;
  }

  if (first !== -1 && last !== -1 && last >= first) {
    cleaned = cleaned.slice(first, last + 1);
  }

  // 4. Remove line comments starting with //
  cleaned = cleaned.replace(/^\s*\/\/.*$/gm, "");

  // 5. Remove trailing commas before } or ]
  let prev = "";
  while (prev !== cleaned) {
    prev = cleaned;
    cleaned = cleaned.replace(/,(\s*[\}\]])/g, "$1");
  }

  return cleaned.trim();
}

function toOllamaJsonSchema(schema: any): any {
  if (!schema || typeof schema !== 'object') return {};

  const result: any = {};

  if (schema.type) {
    result.type = String(schema.type).toLowerCase();
  }

  if (schema.description) {
    result.description = schema.description;
  }

  if (Array.isArray(schema.enum)) {
    result.enum = schema.enum;
  }

  if (schema.properties && typeof schema.properties === 'object') {
    result.properties = {};
    for (const [key, prop] of Object.entries(schema.properties)) {
      result.properties[key] = toOllamaJsonSchema(prop);
    }
  }

  if (Array.isArray(schema.required)) {
    result.required = schema.required;
  }

  if (schema.items) {
    result.items = toOllamaJsonSchema(schema.items);
  }

  return result;
}

function validateAndSanitizeGameTurnResponse(
  rawJson: any,
  activeCharacterIds: string[]
): AIResponse | null {
  if (!rawJson || typeof rawJson !== 'object') return null;
  if (!Array.isArray(rawJson.characterResponses)) return null;

  const allowedSet = new Set([...activeCharacterIds, 'narrator', 'system']);
  const validEmotions = new Set<string>(EMOTION_ENUM as readonly string[]);

  const validResponses: any[] = [];

  for (const item of rawJson.characterResponses) {
    if (!item || typeof item !== 'object') continue;
    if (typeof item.characterId !== 'string' || !allowedSet.has(item.characterId)) continue;
    if (typeof item.text !== 'string' || !item.text.trim()) continue;

    const emotion = (typeof item.emotion === 'string' && validEmotions.has(item.emotion))
      ? item.emotion
      : 'idle';

    validResponses.push({
      ...item,
      emotion
    });
  }

  if (validResponses.length === 0) return null;

  const rawGoalReached = rawJson.sceneGoalReached ?? rawJson.goalReached ?? rawJson.isGoalReached ?? rawJson.sceneGoalAchieved;
  const isGoalReached = rawGoalReached === true || rawGoalReached === 'true' || rawGoalReached === 1 || rawGoalReached === '1';

  return {
    ...rawJson,
    characterResponses: validResponses,
    sceneGoalReached: isGoalReached,
    sceneTransitionReason: typeof rawJson.sceneTransitionReason === 'string' ? rawJson.sceneTransitionReason : (typeof rawJson.goalReason === 'string' ? rawJson.goalReason : undefined)
  };
}

async function callLLM(
    worldInfo: WorldInfo | undefined,
    prompt: string,
    schema: Schema,
    defaultGeminiModel: string,
    useStrictFormat: boolean = false
) {
    const isOllama = worldInfo?.llmProvider === 'ollama';
    const isOpenai = worldInfo?.llmProvider === 'openai';

    const fetchResponse = async (currentPrompt: string) => {
        if (isOpenai) {
            const baseUrl = (worldInfo?.openaiBaseUrl || 'https://openrouter.ai/api/v1').replace(/\/$/, '');
            const apiKey = worldInfo?.openaiApiKey?.trim() || '';
            const model = worldInfo?.openaiModel?.trim() || 'nous-hermes/llama-3.1-70b';

            if (!apiKey) {
                throw new Error("OpenAI/Router API-Key fehlt. Bitte konfiguriere deinen API-Key in den Model-Einstellungen im Editor.");
            }

            const promptWithSchema = currentPrompt + '\n\nCRITICAL: You must output strictly valid JSON matching this schema:\n' + JSON.stringify(schema, null, 2);

            const res = await fetch(`${baseUrl}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`
                },
                body: JSON.stringify({
                    model: model,
                    messages: [
                        { role: 'system', content: 'You are a helpful assistant. Respond strictly in JSON format.' },
                        { role: 'user', content: promptWithSchema }
                    ],
                    response_format: { type: 'json_object' },
                    temperature: 0.8
                })
            });

            if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                const errDetail = errData.error?.message || errData.message || res.statusText;
                if (res.status === 401) {
                    throw new Error(`Ungültiger API-Key (401 Unauthorized): ${errDetail}. Bitte überprüfe deinen OpenAI/Router API-Key.`);
                }
                if (res.status === 403) {
                    throw new Error(`Zugriff verweigert (403 Forbidden): ${errDetail}. Bitte überprüfe die Berechtigungen deines API-Keys.`);
                }
                throw new Error(`OpenAI/Router API-Fehler (${res.status}): ${errDetail}`);
            }

            const data = await res.json();
            const choice = data.choices?.[0];
            const content = choice?.message?.content || "";

            const promptTokens = data.usage?.prompt_tokens || 0;
            const completionTokens = data.usage?.completion_tokens || 0;
            const totalTokens = data.usage?.total_tokens || (promptTokens + completionTokens);

            const tokenStats = {
                promptTokens,
                completionTokens,
                totalTokens
            };

            return { rawText: content, tokenStats };
        } else if (isOllama) {
            const url = (worldInfo?.ollamaUrl || 'http://localhost:11434').replace(/\/$/, '');
            const model = worldInfo?.llmModel || 'llama3';

            const promptNotice = `\n\nCRITICAL: You must output strictly valid JSON matching this schema.\nRespond ONLY with the JSON object, without explanations and without markdown codeblocks:\n\n${JSON.stringify(schema, null, 2)}`;

            const ollamaPrompt = currentPrompt + promptNotice;

            // Bei Ollama immer das konkrete JSON-Schema verwenden (Structured Outputs).
            const ollamaFormat = toOllamaJsonSchema(schema);

            const options: Record<string, unknown> = {
                temperature: worldInfo?.ollamaTemperature ?? 0.7,
                repeat_penalty: worldInfo?.ollamaRepeatPenalty ?? 1.1,
                num_predict: 2048
            };

            // num_ctx nur mitsenden, wenn in der App explizit gesetzt.
            // Andernfalls gilt die Einstellung der Ollama-App.
            if (worldInfo?.ollamaNumCtx) {
                options.num_ctx = worldInfo.ollamaNumCtx;
            }

            const res = await fetch(`${url}/api/generate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model,
                    prompt: ollamaPrompt,
                    stream: false,
                    think: false, // WICHTIG: Top-Level, nicht in options!
                    format: ollamaFormat,
                    options
                })
            });

            if (!res.ok) {
                const errorText = await res.text().catch(() => '');
                throw new Error(`Ollama Error ${res.status}: ${errorText || res.statusText}`);
            }

            const data = await res.json();

            const rawText = typeof data.response === 'string' ? data.response.trim() : '';

            if (!data.done) {
                console.warn("[Ollama] Unfinished response:", {
                    done_reason: data.done_reason,
                    responseLength: rawText.length
                });
            }

            if (!rawText) {
                console.error("[Ollama] Empty response. Thinking-Feld-Länge:",
                    typeof data.thinking === 'string' ? data.thinking.length : 0,
                    "done_reason:", data.done_reason);
                throw new Error("Ollama returned an empty response (output may have gone to the thinking field).");
            }

            const tokenStats = {
                promptTokens: data.prompt_eval_count || 0,
                completionTokens: data.eval_count || 0,
                totalTokens: (data.prompt_eval_count || 0) + (data.eval_count || 0)
            };

            return { rawText, tokenStats };
        } else {
            const response = await fetch("/api/gemini/generate", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ prompt: currentPrompt, schema, defaultGeminiModel, worldInfo })
            });
            
            if (!response.ok) {
                const errData = await response.json().catch(() => ({}));
                throw new Error(errData.error || `Server Error: ${response.statusText}`);
            }
            
            const data = await response.json();
            return { parsedJson: data.json, tokenStats: data.tokenStats };
        }
    };

    // --- PARSE ATTEMPT 1 ---
    let responseData;
    try {
        responseData = await fetchResponse(prompt);
    } catch (networkErr: any) {
        // Direct network or HTTP error from server/Ollama -> rethrow immediately
        throw networkErr;
    }

    let firstRawText = "";
    let firstErrorMsg = "";

    try {
        if (responseData.parsedJson !== undefined) {
            if (typeof responseData.parsedJson === 'object' && responseData.parsedJson !== null) {
                return { json: responseData.parsedJson, tokenStats: responseData.tokenStats };
            }
            firstRawText = typeof responseData.parsedJson === 'string' ? responseData.parsedJson : JSON.stringify(responseData.parsedJson);
        } else {
            firstRawText = responseData.rawText || "";
        }

        const cleanedText = extractJson(firstRawText);
        const parsedObj = JSON.parse(cleanedText);
        return { json: parsedObj, tokenStats: responseData.tokenStats };
    } catch (err: any) {
        firstErrorMsg = err?.message || String(err);
        console.warn("callLLM: Parse Attempt 1 failed:", firstErrorMsg);
    }

    // --- RETRY (EXACTLY ONE RETRY ON PARSE FAILURE) ---
    const retryPrompt = `${prompt}

---
PREVIOUS INVALID RESPONSE:
${firstRawText}

PARSING ERROR:
${firstErrorMsg}

Your previous response was not valid JSON. Respond ONLY with the corrected JSON object, without explanations, without markdown.`;

    try {
        const retryResponseData = await fetchResponse(retryPrompt);
        let retryRawText = "";
        if (retryResponseData.parsedJson !== undefined) {
            if (typeof retryResponseData.parsedJson === 'object' && retryResponseData.parsedJson !== null) {
                return { json: retryResponseData.parsedJson, tokenStats: retryResponseData.tokenStats };
            }
            retryRawText = typeof retryResponseData.parsedJson === 'string' ? retryResponseData.parsedJson : JSON.stringify(retryResponseData.parsedJson);
        } else {
            retryRawText = retryResponseData.rawText || "";
        }

        const cleanedRetryText = extractJson(retryRawText);
        const parsedRetryObj = JSON.parse(cleanedRetryText);
        return { json: parsedRetryObj, tokenStats: retryResponseData.tokenStats };
    } catch (retryErr: any) {
        console.error("callLLM: Retry attempt failed:", retryErr);
        throw new Error(`Failed to parse valid JSON from LLM after retry: ${retryErr?.message || retryErr}`);
    }
}

export interface SceneSummaryResult {
    summary: string;
    importance: 'critical' | 'major' | 'minor';
    tags: string[];
    referencedCharacterIds: string[];
}

export const generateSceneSummary = async (
    scene: Scene,
    characters: Character[],
    history: ChatMessage[],
    worldInfo?: WorldInfo
): Promise<SceneSummaryResult> => {
    // Identify characters by ID & name for the prompt
    const sceneCharsWithIds = scene.characters
        .map(sc => {
            const char = characters.find(c => c.id === sc.characterId);
            return char ? `[ID: ${char.id}] ${char.name}` : null;
        })
        .filter(Boolean)
        .join(", ");

    const chatLog = history.map(msg => {
        const senderName = msg.sender === 'user' ? 'Player' : 
                           msg.sender === 'system' ? 'System' : 
                           characters.find(c => c.id === msg.characterId)?.name || 'Unknown';
        return `${senderName}: ${msg.text}`;
    }).join('\n');

    const prompt = `
        Task: Summarize the following Visual Novel scene for a persistent Story Log.
        Scene Name: ${scene.name}
        Location: ${scene.locationName || 'Unknown'}
        Characters Present: ${sceneCharsWithIds}

        Conversation History:
        ${chatLog}

        Instructions:
        - Write a concise summary (3-5 sentences) in past tense focusing on what happened, key information revealed, and major player decisions.
        - Determine 'importance':
          * 'critical' ONLY for: irreversible events (death, betrayal, major revelation, quest completion, broken/given promise).
          * 'major' for: relationship changes, key player decisions, new relevant information.
          * 'minor' for: atmospheric or casual scenes without lasting consequences.
          * When in doubt, prefer one tier higher rather than lower.
        - Select 1-4 'tags' strictly from this fixed vocabulary: 'conflict', 'romance', 'revelation', 'promise', 'betrayal', 'alliance', 'discovery', 'loss', 'humor', 'milestone'. Do NOT invent any other tags.
        - Select 'referencedCharacterIds': Choose from the IDs of the present characters ([ID: ...]) those who are mentioned by name in the summary or whose actions are central.
    `;

    try {
        const { json } = await callLLM(worldInfo, prompt, SUMMARY_SCHEMA, "gemini-3.6-flash", true);

        const validImportance = (['critical', 'major', 'minor'].includes(json?.importance)) ? json.importance : 'major';
        
        const allowedTags = new Set(['conflict', 'romance', 'revelation', 'promise', 'betrayal', 'alliance', 'discovery', 'loss', 'humor', 'milestone']);
        const validTags = Array.isArray(json?.tags)
            ? json.tags.filter((t: any) => typeof t === 'string' && allowedTags.has(t))
            : [];
            
        const sceneCharIds = new Set(scene.characters.map(sc => sc.characterId));
        const validRefIds = Array.isArray(json?.referencedCharacterIds)
            ? json.referencedCharacterIds.filter((id: any) => typeof id === 'string' && sceneCharIds.has(id))
            : [];

        return {
            summary: typeof json?.summary === 'string' && json.summary.trim() ? json.summary : "No summary available.",
            importance: validImportance,
            tags: validTags,
            referencedCharacterIds: validRefIds
        };
    } catch (e) {
        console.error("Summary Generation Failed", e);
        return {
            summary: "Summary generation failed.",
            importance: 'major',
            tags: [],
            referencedCharacterIds: []
        };
    }
};

export const generateAutoScene = async (
    allCharacters: Character[],
    storyLog: StoryLogEntry[],
    worldInfo: WorldInfo,
    customPrompt?: string,
    assets?: AssetItem[]
): Promise<Partial<Scene> & { suggestedBackgroundSrc?: string }> => {
    const charList = allCharacters.map(c => `ID: ${c.id} | Name: ${c.name} | Role: ${c.defaultDescription}`).join('\n');
    
    const recentEvents = storyLog.slice(-5).map(e => `[${e.sceneName}] ${e.summary}`).join('\n');

    const bgAssetList = (assets || [])
      .filter(a => a.category === 'scene_bg')
      .map(a => `[Asset ID: ${a.fileUrl || a.id}] Name: "${a.name}" | Environment: ${a.locationMeta?.environment || 'indoor'} | Tags: ${a.locationMeta?.tags?.join(', ') || 'none'}`)
      .join('\n');

    const prompt = `
        Task: Create a NEW scene for a Visual Novel RPG.
        
        WORLD SETTING:
        ${worldInfo.description}
        
        AVAILABLE CHARACTERS:
        ${charList}

        AVAILABLE SCENE BACKGROUND ASSETS IN LIBRARY:
        ${bgAssetList || "No background assets in library."}
        
        RECENT STORY EVENTS (Context):
        ${recentEvents || "The story is just beginning."}
        
        ${customPrompt ? `\nUSER'S CUSTOM REQUEST/PROMPT FOR THIS SCENE:\n${customPrompt}\n` : ""}

        INSTRUCTIONS:
        1. Design a scene that logically follows the recent events OR creates a "Quality of Life" bonding moment / side quest.
        2. DO NOT invent new characters. Use ONLY the IDs provided in the list above.
        3. Pick 1-3 characters to include.
        4. Define a clear location, description, and goal.
        5. If a background asset from the AVAILABLE SCENE BACKGROUND ASSETS IN LIBRARY matches the scene location/setting, set "suggestedBackgroundSrc" to its exact Asset ID.
        6. Provide hidden AI instructions on how the characters should behave in this specific context.
        7. The output must be valid JSON matching the schema.
        ${customPrompt ? '8. **VERY IMPORTANT**: You MUST honor the USER\'S CUSTOM REQUEST specified above when designing this scene.' : ''}
    `;

    try {
        const allCharacterIds = allCharacters.map(c => c.id);
        const sceneGenSchema = buildSceneGenSchema(allCharacterIds);

        const { json } = await callLLM(worldInfo, prompt, sceneGenSchema, "gemini-3.6-flash", true);
        return json;
    } catch (e) {
        console.error("Scene Generation Failed", e);
        throw e;
    }
};

export const generateLoreTeaser = async (
    name: string,
    description: string,
    worldInfo?: WorldInfo
): Promise<string> => {
    const prompt = `Fasse den folgenden Lore-Eintrag in EINEM Satz zusammen (max. 200 Zeichen). Der Satz soll die Kernidentität und Relevanz für Rollenspiel-Szenen erfassen.

NAME: ${name}
BESCHREIBUNG: ${description}

Antworte NUR mit dem JSON-Objekt im vorgegebenen Format.`;

    try {
        const { json } = await callLLM(worldInfo, prompt, TEASER_SCHEMA, "gemini-3.6-flash", true);
        const teaser = typeof json?.teaser === 'string' ? json.teaser.trim() : '';
        return teaser.length > 250 ? teaser.slice(0, 200) + '...' : teaser;
    } catch (err) {
        console.error("generateLoreTeaser failed:", err);
        throw err;
    }
};

export interface LoreRouterInput {
    sceneName: string;
    sceneDescription: string;
    sceneGoal?: string;
    sceneAiInstructions?: string;
    activeCharacters: { name: string; defaultDescription?: string }[];
    allFactions: Faction[];
    allLocations: WorldLocation[];
    worldInfo?: WorldInfo;
}

export const selectRelevantLore = async (
    input: LoreRouterInput
): Promise<string[]> => {
    const {
        sceneName,
        sceneDescription,
        sceneGoal,
        sceneAiInstructions,
        activeCharacters,
        allFactions,
        allLocations,
        worldInfo,
    } = input;

    const validFactionMap = new Map(allFactions.map(f => [f.id, f]));
    const validLocationMap = new Map(allLocations.map(l => [l.id, l]));

    const factionEntries = allFactions.map(f => {
        const snippet = f.teaser && f.teaser.trim().length > 0 
            ? f.teaser.trim() 
            : (f.description || '').slice(0, 200).trim();
        return `- [ID: "${f.id}"] ${f.name} (Fraktion): ${snippet}`;
    });

    const locationEntries = allLocations.map(l => {
        const snippet = l.teaser && l.teaser.trim().length > 0 
            ? l.teaser.trim() 
            : (l.description || '').slice(0, 200).trim();
        return `- [ID: "${l.id}"] ${l.name} (Ort): ${snippet}`;
    });

    const allEntriesText = [...factionEntries, ...locationEntries].join('\n');
    if (!allEntriesText.trim()) {
        return [];
    }

    const charDetails = activeCharacters
        .map(c => `- ${c.name}: ${c.defaultDescription || 'Keine Beschreibung'}`)
        .join('\n');

    const prompt = `Wähle alle Lore-Einträge, die für das Rollenspiel in dieser Szene relevant sein könnten. Berücksichtige Synonyme, indirekte Bezüge und historische Hintergründe der anwesenden Charaktere. Im Zweifel nimm einen Eintrag auf. Antworte NUR mit dem JSON.

SZENE:
- Name: ${sceneName}
- Beschreibung: ${sceneDescription || 'Keine Angabe'}
${sceneGoal ? `- Ziel: ${sceneGoal}` : ''}
${sceneAiInstructions ? `- Anweisungen: ${sceneAiInstructions}` : ''}

ANWESENDE CHARAKTERE:
${charDetails || 'Keine spezifischen Charaktere'}

VERFÜGBARE LORE-EINTRÄGE (Wähle passende IDs aus dieser Liste):
${allEntriesText}

Gib die Liste der ausgewählten IDs in "selectedIds" zurück.`;

    try {
        const { json } = await callLLM(worldInfo, prompt, LORE_ROUTER_SCHEMA, "gemini-3.6-flash", true);
        const rawIds = Array.isArray(json?.selectedIds) ? json.selectedIds : [];
        
        // Filter and sanitize: keep ONLY IDs that exist in allFactions or allLocations
        const validIds = rawIds.filter((id: any) => 
            typeof id === 'string' && (validFactionMap.has(id) || validLocationMap.has(id))
        );

        return validIds;
    } catch (err) {
        console.error("selectRelevantLore failed:", err);
        throw err;
    }
};


const SEMANTIC_SYNONYMS: Record<string, string[]> = {
  "garde": ["wache", "wächter", "soldat", "militär", "truppe", "ritter", "krieger", "garrison", "guard", "soldier", "guards", "watch", "watchman"],
  "gilde": ["bündnis", "fraktion", "clique", "orden", "sekte", "bund", "guild", "faction", "alliance"],
  "schenke": ["taverne", "kneipe", "gasthaus", "herberge", "inn", "tavern", "bar", "pub"],
  "tempel": ["schrein", "kirche", "kathedrale", "altar", "heiligtum", "temple", "shrine", "church"],
  "burg": ["schloss", "festung", "palast", "turm", "ruine", "castle", "fortress", "palace"],
  "wald": ["forst", "gehölz", "dschungel", "hain", "forest", "woods", "grove"],
  "markt": ["basar", "handelsplatz", "stand", "laden", "geschäft", "market", "bazaar", "shop"],
  "hafen": ["dock", "kai", "werft", "marina", "port", "harbor", "docks"],
  "akademie": ["schule", "universität", "bibliothek", "archiv", "academy", "school", "library"],
  "könig": ["kaiser", "fürst", "herzog", "graf", "monarch", "herrscher", "thron", "royal", "king", "queen", "empire"],
  "dieb": ["schurke", "bande", "mafia", "schmuggler", "räuber", "thief", "rogue", "bandit", "smuggler", "diebe"]
};

const STOP_WORDS = new Set([
  "aber", "alle", "allem", "allen", "aller", "alles", "als", "also", "am", "an", "and", "auch", "auf", "aus", "bei", "bin", "bis", "bist", "da", "damit", "dann", "das", "dass", "dein", "deine", "dem", "den", "denn", "der", "des", "dessen", "dich", "die", "dies", "diese", "dieser", "dieses", "doch", "dort", "du", "durch", "ein", "eine", "einem", "einen", "einer", "eines", "einige", "einigen", "einiger", "einiges", "einmal", "er", "es", "euch", "euer", "eure", "für", "gegen", "gewesen", "habe", "haben", "hat", "hatte", "ihm", "ihn", "ihr", "ihre", "ihrem", "ihren", "ihrer", "ihres", "im", "in", "ist", "ja", "jede", "jedem", "jeden", "jeder", "jedes", "jene", "jenem", "jenen", "jener", "jenes", "jetzt", "kann", "können", "man", "mit", "nach", "nein", "nicht", "nur", "oder", "seid", "seine", "seinen", "seinem", "seiner", "seines", "selbst", "sich", "sie", "sind", "so", "solche", "solchem", "solchen", "solcher", "solches", "soll", "sollen", "und", "uns", "unser", "unsere", "unserem", "unseren", "unseres", "unter", "vom", "von", "vor", "was", "weg", "weil", "weiter", "welche", "welchem", "welchen", "welcher", "welches", "wenn", "wer", "werde", "werden", "wie", "wieder", "will", "wir", "wird", "wirst", "wo", "wollen", "wollten", "wurde", "wurden", "zu", "zum", "zur", "zusammen"
]);

function calculateLoreScore(
  name: string,
  description: string,
  matchText: string,
  matchWords: string[]
): number {
  let score = 0;
  const nameLower = name.toLowerCase();
  const descLower = description.toLowerCase();

  // 1. Exakter Substring-Match des vollständigen Namens
  if (matchText.includes(nameLower)) {
    score += 25;
  }

  // Kernwörter des Eintrags extrahieren
  const entryNameWords = nameLower
    .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?\"]/g, " ")
    .split(/\s+/)
    .filter(w => w.length > 3 && !STOP_WORDS.has(w));

  // 2. Wortweises Matching & Synonyme
  for (const entryWord of entryNameWords) {
    // Exakter Wortmatch (oder Teilwortmatch wie "wache" in "königliche wache")
    if (matchWords.includes(entryWord) || matchWords.some(mw => mw.includes(entryWord))) {
      score += 12;
      continue;
    }

    // Semantischer Match über Synonyme
    for (const [key, synonyms] of Object.entries(SEMANTIC_SYNONYMS)) {
      const isKey = entryWord.includes(key) || key.includes(entryWord);
      const inSynonyms = synonyms.some(s => entryWord.includes(s) || s.includes(entryWord));

      if (isKey || inSynonyms) {
        // Prüfen, ob eines der anderen Synonyme oder der Key im Text vorkommt
        const matchFound = matchWords.some(w => 
          w === key || 
          w.includes(key) ||
          synonyms.some(s => w === s || w.includes(s))
        );
        if (matchFound) {
          score += 10;
          break; // Ein Synonymmatch reicht für dieses Wort
        }
      }
    }
  }

  // 3. Beschreibungswortweises Matching (mit geringerer Gewichtung)
  const entryDescWords = descLower
    .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?\"]/g, " ")
    .split(/\s+/)
    .filter(w => w.length > 4 && !STOP_WORDS.has(w));

  let descMatches = 0;
  for (const descWord of entryDescWords) {
    if (matchWords.includes(descWord) || matchWords.some(mw => mw.includes(descWord))) {
      descMatches++;
    }
  }
  score += Math.min(descMatches, 5); // Bis zu 5 Punkte max für Beschreibung

  return score;
}

export const generateImagePromptContext = async (
  history: ChatMessage[],
  scene: Scene,
  activeCharacters: Character[],
  worldInfo?: WorldInfo,
): Promise<string> => {
  const recentHistory = history.slice(-5).map(msg => `${msg.sender}: ${msg.text}`).join('\n');
  const primaryChar = activeCharacters[0]?.name || "Character";
  const charDetails = activeCharacters.map(c => c.name).join(', ');

  const prompt = `
Du bist ein Experte für Image Generation Prompts im Danbooru-Tag-Stil (ComfyUI / Stable Diffusion / Anime Visual Novels).
Erstelle eine kommagetrennte Liste englischer Danbooru-Tags für ein Event CG Bild der aktuellen Szene.

AKTUELLE SZENE:
Name: ${scene.name}
Ort/Umgebung: ${scene.locationName || ''}
Beschreibung: ${scene.description || ''}
Details: ${scene.sensoryDetails || ''} ${scene.environmentDetails || ''}

HAUPTCHARAKTER IM FOKUS:
${primaryChar} (Anwesende: ${charDetails})

KÜRZLICHER CHATVERLAUF:
${recentHistory}

STRIKTE REGELN FÜR DEN PROMPT:
1. DANBOORU TAG STIL: Gib NUR eine kommagetrennte Liste englischer Tags zurück (z.B. "1girl, solo, bedroom, sitting on bed, looking at viewer, view from front, night, surprised expression, blushing, soft indoor lighting").
2. NUR EINE PERSON IM FOKUS: Beschreibe IMMER genau 1 Person (Tag "1girl" oder "1boy", "solo"). Wenn mehrere Charaktere anwesend sind, wähle den wichtigsten/fokussierten Hauptcharakter. ZIELE NICHT darauf ab, mehrere Personen darzustellen!
3. ZWINGENDE UMGEBUNG/SETTING: Beschreibe die Umgebung und den Raum/Ort detailliert (z.B. "tavern, wooden bar, tavern interior, warm lighting" oder "bedroom, bed, window, night").
4. ZWINGENDE VIEWER-POSITION: Beschreibe die Perspektive/Position des Betrachters (z.B. "looking at viewer", "from viewer's perspective", "view from front", "close-up", "cowboy shot").
5. ZWINGENDE BLICKRICHTUNG: Beschreibe exakt, wohin der Charakter schaut (z.B. "looking at viewer", "looking away", "looking down", "looking to the side").

Antworte AUSSCHLIESSLICH mit den kommagetrennten Tags, ohne Erklärungen, ohne Anführungszeichen, ohne Markdown-Formatierungen.
`;

  try {
    const isOllama = worldInfo?.llmProvider === 'ollama';
    const isOpenai = worldInfo?.llmProvider === 'openai';
    if (isOpenai) {
        const baseUrl = (worldInfo?.openaiBaseUrl || 'https://openrouter.ai/api/v1').replace(/\/$/, '');
        const apiKey = worldInfo?.openaiApiKey?.trim() || '';
        const model = worldInfo?.openaiModel?.trim() || 'nous-hermes/llama-3.1-70b';
        if (!apiKey) return "";

        const res = await fetch(`${baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: model,
                messages: [
                    { role: 'user', content: prompt }
                ],
                temperature: 0.8
            })
        });
        if (!res.ok) throw new Error("OpenAI API Error");
        const data = await res.json();
        return (data.choices?.[0]?.message?.content || "").trim();
    } else if (isOllama) {
        const url = (worldInfo?.ollamaUrl || 'http://localhost:11434').replace(/\/$/, '');
        const model = worldInfo?.llmModel || 'llama3';
        
        const res = await fetch(`${url}/api/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: model,
                prompt: prompt,
                stream: false,
                think: false,
                options: {
                    num_ctx: worldInfo?.ollamaNumCtx || 8192,
                    temperature: worldInfo?.ollamaTemperature ?? 0.8,
                    repeat_penalty: worldInfo?.ollamaRepeatPenalty ?? 1.1
                }
            })
        });
        if (!res.ok) throw new Error("Ollama Error");
        const data = await res.json();
        return data.response.trim();
    } else {
        const response = await fetch("/api/gemini/generateText", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ prompt, defaultGeminiModel: "gemini-3.6-flash", worldInfo })
        });
        if (!response.ok) throw new Error("Gemini API Error");
        const data = await response.json();
        return data.text.trim();
    }
  } catch (err) {
    console.error("Error generating image prompt context:", err);
    return "";
  }
};

export const generateGameTurn = async (
  currentInput: string,
  history: ChatMessage[],
  scene: Scene,
  allCharacters: Character[],
  worldInfo?: WorldInfo,
  chapter?: Chapter,
  storyLog: StoryLogEntry[] = [], // New Parameter
  prefetchedLoreIds?: string[]
): Promise<AIResponse> => {
  // 1. Construct the Context
  const activeChars = scene.characters.map(sc => {
    const baseChar = allCharacters.find(c => c.id === sc.characterId);
    if (!baseChar) return null;

    // --- Format Relationship Logic if enabled ---
    let relContext = '';
    if (baseChar.relationship && baseChar.relationship.enabled) {
        const rc = baseChar.relationship;
        // Sort thresholds descending to find the current active one
        const activeThreshold = [...rc.thresholds]
            .sort((a,b) => b.valueStart - a.valueStart)
            .find(t => rc.currentValue >= t.valueStart);

        const roadmapLine = (activeThreshold && activeThreshold.roadmapNotes && activeThreshold.roadmapNotes.trim().length > 0)
            ? `\n        - Roadmap (erzählerischer Leitfaden, aktuelle Stufe): ${activeThreshold.roadmapNotes.trim()}`
            : '';

        const keyMomentsBlock = rc.keyMoments && rc.keyMoments.length > 0
            ? `\n        **KEY MOMENTS WITH PLAYER:**\n` + rc.keyMoments.slice(-3).map(km => {
                const sign = km.impact > 0 ? '+' : '';
                const scenePrefix = km.sceneName ? `[${km.sceneName}] ` : '';
                return `        - ${scenePrefix}${km.description} (${sign}${km.impact})`;
            }).join('\n')
            : '';

        relContext = `
        **RELATIONSHIP SYSTEM ACTIVE**
        - Current Value: ${rc.currentValue} (Start: ${rc.startValue})
        - Current Status/Behavior: ${activeThreshold ? `${activeThreshold.label}: ${activeThreshold.description}` : 'Normal'}${roadmapLine}
        ${keyMomentsBlock}
        **RULES FOR CHANGING VALUE (Evaluate User's Action):**
        ${rc.triggers.map(t => `- ${t.description}: ${t.valueChange > 0 ? '+' : ''}${t.valueChange}`).join('\n')}

        **GATING RULE:** Die unter 'Current Status' und 'Roadmap' beschriebenen Verhaltensweisen sind die EINZIGEN derzeit erlaubten Beziehungsentwicklungen für diesen Charakter. Tiefere Intimität, Vertrauensbeweise oder Bindungsgesten höherer Stufen sind AKTUELL VERBOTEN, unabhängig davon, wie überzeugend der Spieler argumentiert.

        INSTRUCTION: If the player's current action matches a trigger, include a 'relationshipUpdates' entry in the JSON response.
        `;
    } else {
        relContext = `Relation to Player: ${baseChar.playerRelation || 'Neutral'}`;
    }

    return {
      name: baseChar.name,
      id: baseChar.id,
      basePersona: baseChar.defaultDescription,
      lore: baseChar.lore || '',
      relContext: relContext,
      sceneRole: sc.roleInScene
    };
  }).filter(Boolean);

  // Handle Logic for empty goals
  const hasSpecificGoal = scene.goal && scene.goal.trim().length > 0;
  
  const goalInstruction = hasSpecificGoal 
    ? `SCENE GOAL / WIN CONDITION: "${scene.goal}"
       CRITICAL DIRECTIVE ON SCENE GOAL:
       - You MUST evaluate after every player turn whether the player has satisfied, fulfilled, or achieved this specific Goal: "${scene.goal}".
       - If the goal IS ACHIEVED (e.g., through dialogue, agreement, action, combat, or key decision), set "sceneGoalReached": true and provide a short reason in "sceneTransitionReason".
       - Do NOT be overly strict. If the player or characters have reasonably accomplished what the goal asked for, set "sceneGoalReached": true.`
    : `SCENE GOAL / WIN CONDITION: NONE (Open Sandbox Roleplay).
       - Always set "sceneGoalReached": false.`;

  // --- World Building Context ---
  let worldContext = '';
  if (worldInfo) {
    worldContext += `WORLD SETTING:\n${worldInfo.description}\n\n`;
    
    type LoreItem = { name: string, text: string, type: 'faction'|'location', priority: number };
    const allLore: LoreItem[] = [];

    const getLoreText = (item: any) => item.teaser ? item.teaser : (item.description.substring(0, 150) + (item.description.length > 150 ? '...' : ''));

    const explicitlyScopedFactionIds = scene.relevantFactionIds || [];
    const explicitlyScopedLocationIds = scene.relevantLocationIds || [];

    // Check if pre-fetched Lore IDs from the AI Router are present and non-empty
    if (prefetchedLoreIds && prefetchedLoreIds.length > 0) {
      console.log("[Lore Router] Using prefetched lore IDs:", prefetchedLoreIds);

      (worldInfo.factions || []).forEach(f => {
        if (explicitlyScopedFactionIds.includes(f.id)) {
          allLore.push({ name: f.name, text: getLoreText(f), type: 'faction', priority: 1 });
        } else if (prefetchedLoreIds.includes(f.id)) {
          allLore.push({ name: f.name, text: getLoreText(f), type: 'faction', priority: 2 });
        }
      });

      (worldInfo.loreLocations || []).forEach(l => {
        if (explicitlyScopedLocationIds.includes(l.id)) {
          allLore.push({ name: l.name, text: getLoreText(l), type: 'location', priority: 1 });
        } else if (prefetchedLoreIds.includes(l.id)) {
          allLore.push({ name: l.name, text: getLoreText(l), type: 'location', priority: 2 });
        }
      });
    } else {
      // Fallback: Keyword-Scoring Engine
      console.log("[Lore Router] Fallback: Keyword-Scoring verwendet");
      const recentHistoryText = history.slice(-5).map(msg => msg.text).join(' ');
      const contextStringToSearch = `${currentInput} ${scene.name} ${scene.locationName || ''} ${scene.description} ${recentHistoryText}`;
      const cleanedContextWords = contextStringToSearch
        .toLowerCase()
        .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?\"]/g, " ")
        .split(/\s+/)
        .filter(w => w.length > 3);

      const hasExplicitFactions = explicitlyScopedFactionIds.length > 0;
      if (worldInfo.factions && worldInfo.factions.length > 0) {
        if (hasExplicitFactions) {
          worldInfo.factions.forEach(f => {
            if (explicitlyScopedFactionIds.includes(f.id)) {
              allLore.push({ name: f.name, text: getLoreText(f), type: 'faction', priority: 1 });
            } else {
              const score = calculateLoreScore(f.name, f.description, contextStringToSearch.toLowerCase(), cleanedContextWords);
              if (score >= 10) allLore.push({ name: f.name, text: getLoreText(f), type: 'faction', priority: 3 });
            }
          });
        } else {
          worldInfo.factions.forEach(f => {
            const score = calculateLoreScore(f.name, f.description, contextStringToSearch.toLowerCase(), cleanedContextWords);
            if (score >= 10) allLore.push({ name: f.name, text: getLoreText(f), type: 'faction', priority: 3 });
          });
        }
      }
      
      const hasExplicitLocations = explicitlyScopedLocationIds.length > 0;
      if (worldInfo.loreLocations && worldInfo.loreLocations.length > 0) {
        if (hasExplicitLocations) {
          worldInfo.loreLocations.forEach(l => {
            if (explicitlyScopedLocationIds.includes(l.id)) {
              allLore.push({ name: l.name, text: getLoreText(l), type: 'location', priority: 1 });
            } else {
              const score = calculateLoreScore(l.name, l.description, contextStringToSearch.toLowerCase(), cleanedContextWords);
              if (score >= 10) allLore.push({ name: l.name, text: getLoreText(l), type: 'location', priority: 3 });
            }
          });
        } else {
          worldInfo.loreLocations.forEach(l => {
            const score = calculateLoreScore(l.name, l.description, contextStringToSearch.toLowerCase(), cleanedContextWords);
            if (score >= 10) allLore.push({ name: l.name, text: getLoreText(l), type: 'location', priority: 3 });
          });
        }
      }
    }

    // Sort and limit to 5
    allLore.sort((a, b) => a.priority - b.priority);
    const finalLore = allLore.slice(0, 5);

    if (finalLore.length > 0) {
      worldContext += `RELEVANT LORE (for this scene only):\n${finalLore.map(l => `- ${l.name}: ${l.text}`).join('\n')}\n\n`;
    }

    // DEBUG Logging
    const tokenEstimate = Math.ceil(worldContext.length / 4);
    const logDetails = finalLore.map(l => {
      const source = l.priority === 1 ? 'manuell' : (l.priority === 2 ? 'KI' : 'Keyword');
      return `${l.name} (${source})`;
    }).join(', ');
    
    console.log(`[Lore Router] Geladene Lore: ${finalLore.length} Einträge (${logDetails}). Geschätzte Tokens im worldContext: ${tokenEstimate}`);
    if (tokenEstimate > 2000) {
      console.warn(`[Lore Router] WARNUNG: worldContext ist sehr groß (${tokenEstimate} Tokens)! Möglicherweise Halluzinationen.`);
    }
  }

  const systemDirectivesBlock = worldInfo?.systemInstruction
    ? `SYSTEM DIRECTIVES (Must Follow):\n${worldInfo.systemInstruction}\n\n`
    : '';

  const chapterContext = chapter 
    ? `CURRENT CHAPTER: ${chapter.name}
       CHAPTER CONTEXT: ${chapter.description}`
    : '';

  // --- STORY HISTORY CONTEXT ---
  let historyContext = '';
  if (storyLog && storyLog.length > 0) {
      const recentLog = storyLog.slice(-3);
      const remainingLog = storyLog.slice(0, -3);

      const activeCharacterIds = scene.characters.map(c => c.characterId);
      const sceneLocationLower = (scene.locationName || '').toLowerCase();
      
      const sceneTextMatch = `${scene.goal || ''} ${scene.description || ''}`.toLowerCase();
      const tagMapping: Record<string, string[]> = {
        'conflict': ['conflict', 'konflikt', 'streit', 'kampf'],
        'romance': ['romance', 'romantik', 'liebe', 'flirt'],
        'discovery': ['discovery', 'entdeckung', 'geheimnis', 'fund'],
        'danger': ['danger', 'gefahr', 'bedrohung', 'falle'],
        'important': ['important', 'wichtig', 'entscheidend'],
        'choice': ['choice', 'entscheidung', 'wahl']
      };

      const isTagMatch = (tags: string[]) => {
        if (!tags) return false;
        for (const tag of tags) {
           const t = tag.toLowerCase();
           const synonyms = tagMapping[t] || [t];
           for (const syn of synonyms) {
               if (sceneTextMatch.includes(syn)) return true;
           }
        }
        return false;
      };

      let relevantOlderLogs = remainingLog.filter(entry => {
         const imp = entry.importance || 'major';
         if (imp === 'critical') return true;
         if (imp === 'minor') return false;
         
         if (entry.referencedCharacterIds?.some(id => activeCharacterIds.includes(id))) return true;
         const entryLoc = (entry.locationName || '').toLowerCase();
         if (entryLoc && sceneLocationLower && (entryLoc.includes(sceneLocationLower) || sceneLocationLower.includes(entryLoc))) return true;
         if (isTagMatch(entry.tags || [])) return true;

         return false;
      });

      if (relevantOlderLogs.length < 2 && storyLog.length > 5) {
          const needed = 2 - relevantOlderLogs.length;
          const fallbackCandidates = remainingLog
              .filter(entry => !relevantOlderLogs.includes(entry) && (entry.importance === 'critical' || entry.importance === 'major' || !entry.importance))
              .reverse();
          
          const fallbacks = fallbackCandidates.slice(0, needed);
          relevantOlderLogs.push(...fallbacks);
      }

      if (relevantOlderLogs.length > 8) {
          const criticals = relevantOlderLogs.filter(e => e.importance === 'critical').reverse();
          const majors = relevantOlderLogs.filter(e => e.importance !== 'critical').reverse();
          relevantOlderLogs = [...criticals, ...majors].slice(0, 8);
      }

      relevantOlderLogs.sort((a, b) => storyLog.indexOf(a) - storyLog.indexOf(b));

      console.log(`[Story Budget] Log Count: ${storyLog.length} -> Sent: Recent(${recentLog.length}) + Relevant(${relevantOlderLogs.length}) | Fallback used: ${relevantOlderLogs.length < 2 && storyLog.length > 5 ? 'Yes' : 'No'}`);

      historyContext = `PREVIOUS STORY EVENTS:\n\n`;
      if (relevantOlderLogs.length > 0) {
        historyContext += `RELEVANT PAST EVENTS (filtered for this scene):\n`;
        historyContext += relevantOlderLogs.map(entry => `- [${entry.sceneName} @ ${entry.locationName}] ${entry.summary}`).join('\n') + `\n\n`;
      }
      
      historyContext += `RECENT EVENTS (always included):\n`;
      historyContext += recentLog.map(entry => `- [${entry.sceneName} @ ${entry.locationName}] ${entry.summary}`).join('\n') + `\n\n`;

      historyContext += `INSTRUCTION: Use this history to maintain consistency. Refer to past events if relevant.\n\n`;
  }

  const aiHiddenInstructions = scene.aiInstructions 
    ? `HIDDEN GAME MASTER INSTRUCTIONS (Do not reveal to player): 
       ${scene.aiInstructions}` 
    : '';

  const aiSensoryDetails = scene.sensoryDetails
    ? `SENSORY DETAILS (Atmosphere, Smells, Sounds):
       ${scene.sensoryDetails}`
    : '';

  const aiEnvironmentLayout = scene.environmentDetails
    ? `INTERNAL ENVIRONMENT & LAYOUT (Room structure, visible objects, architecture):
       ${scene.environmentDetails}`
    : '';

  const systemPrompt = `
    You are the Game Master and Engine for a Visual Novel.
    
    ${systemDirectivesBlock}
    ${worldContext}
    ${chapterContext}
    ${historyContext}

    CURRENT SCENARIO CONFIGURATION:
    - Scene Name: ${scene.name}
    - Location: ${scene.locationName || 'Unknown Location'}
    - Visible Description (Player Context): ${scene.description}
    
    ${aiHiddenInstructions}
    ${aiSensoryDetails}
    ${aiEnvironmentLayout}

    ${goalInstruction}
    
    ACTIVE CHARACTERS IN SCENE:
    ${activeChars.map(c => `- ID: ${c?.id}, Name: ${c?.name}
       Persona/Behavior: ${c?.basePersona}
       Lore/History: ${c?.lore}
       RELATIONSHIP CONTEXT:
       ${c?.relContext}
       CURRENT SCENE ROLE: ${c?.sceneRole}`).join('\n')}
    
    INSTRUCTIONS:
    1. Respond strictly in valid JSON format matching the schema.
    2. CHECK RELATIONSHIP TRIGGERS: If the relationship system is active for a character, evaluate the player's action against the triggers and output 'relationshipUpdates' in the JSON response when applicable.
    3. EVALUATE SCENE GOAL / WIN CONDITION: Check if the Scene Goal has been accomplished or satisfied by the player and set "sceneGoalReached": true (with "sceneTransitionReason") accordingly.
    4. GROUND TRUTH: The CURRENT SITUATION block at the end of this prompt is the ground truth. If any information conflicts, the CURRENT SITUATION block wins.
    5. Present characters should get a turn to speak or react when appropriate; do not silently ignore present characters for multiple turns.
    6. NO DOUBLE QUOTES IN TEXT: Do not use double quotation marks (") inside "text" fields. Format direct speech using German quotation marks » « or single quotes.
  `;

  // 2. Format History for Gemini
  const recentHistory = history.slice(-10).map(msg => 
    `${msg.sender === 'user' ? 'Player' : (allCharacters.find(c => c.id === msg.characterId)?.name || 'Narrator')}: ${msg.text}`
  ).join('\n');

  const locationSummary = scene.description 
    ? (scene.description.length > 300 ? scene.description.substring(0, 300) + '...' : scene.description)
    : 'No description provided';
  const charactersPresentText = activeChars.map(c => `${c?.name} (${c?.sceneRole || 'Participant'})`).join(', ');
  const sceneGoalText = (scene.goal && scene.goal.trim().length > 0) ? scene.goal : 'Open roleplay, no fixed goal';

  const currentSituationBlock = `CURRENT SITUATION (most important – always respect this):
    - Location: ${scene.locationName || 'Unknown Location'} – ${locationSummary}
    - Characters present: ${charactersPresentText || 'None'}
    - Scene goal: ${sceneGoalText}`;

  const fullPrompt = `
    ${systemPrompt}

    RECENT CHAT HISTORY:
    ${recentHistory}

    ${currentSituationBlock}

    CURRENT PLAYER INPUT:
    "${currentInput}"
  `;

  console.log("[generateGameTurn] Prompt:", fullPrompt);

  try {
    const activeCharacterIds = activeChars.map(c => c!.id);
    const responseSchema = buildResponseSchema(activeCharacterIds);

    const { json, tokenStats } = await callLLM(worldInfo, fullPrompt, responseSchema, "gemini-3.6-flash", false);
    
    let validated = validateAndSanitizeGameTurnResponse(json, activeCharacterIds);

    if (!validated) {
      console.warn("generateGameTurn: Empty or hallucinated characterResponses. Executing 1 re-prompt...");
      const rePromptText = `${fullPrompt}\n\nYour previous response contained no visible dialogue. Respond with at least one characterResponse with non-empty text.`;
      
      const retryResult = await callLLM(worldInfo, rePromptText, responseSchema, "gemini-3.6-flash", false);
      validated = validateAndSanitizeGameTurnResponse(retryResult.json, activeCharacterIds);

      if (validated) {
        const combinedStats = {
          promptTokens: (tokenStats?.promptTokens || 0) + (retryResult.tokenStats?.promptTokens || 0),
          completionTokens: (tokenStats?.completionTokens || 0) + (retryResult.tokenStats?.completionTokens || 0),
          totalTokens: (tokenStats?.totalTokens || 0) + (retryResult.tokenStats?.totalTokens || 0)
        };
        return { ...validated, tokenStats: combinedStats } as AIResponse;
      }
    } else {
      return { ...validated, tokenStats } as AIResponse;
    }

    throw new Error("Empty characterResponses after re-prompt.");

  } catch (error) {
    console.error("Gemini Error:", error);
    // Fallback in case of error to prevent crash
    return {
      characterResponses: [{ characterId: "system", text: "An error occurred communicating with the AI engine." }],
      sceneGoalReached: false
    };
  }
};
