
/**
 * ComfyUI Workflow Template Hinweise:
 * Das ComfyUI-Workflow-JSON kann folgende Platzhalter enthalten:
 * - "text": "PROMPT_PLACEHOLDER" (in CLIPTextEncode für den positiven Prompt)
 * - "lora_name": "CHARACTER_LORA_PLACEHOLDER" (in LoraLoader-Nodes)
 * - "ckpt_name": "CHECKPOINT_PLACEHOLDER" (in CheckpointLoaderSimple / CheckpointLoader / UNETLoader-Nodes)
 * 
 * Der Code ersetzt diese Strings vor dem Senden an ComfyUI automatisch mit den
 * generierten Prompts und ausgewählten Dateinamen.
 */

export function getDefaultWorkflow(): any {
  return {
    "3": {
      "inputs": {
        "seed": 8566258,
        "steps": 20,
        "cfg": 8,
        "sampler_name": "euler",
        "scheduler": "normal",
        "denoise": 1,
        "model": [
          "4",
          0
        ],
        "positive": [
          "6",
          0
        ],
        "negative": [
          "7",
          0
        ],
        "latent_image": [
          "5",
          0
        ]
      },
      "class_type": "KSampler"
    },
    "4": {
      "inputs": {
        "ckpt_name": "CHECKPOINT_PLACEHOLDER"
      },
      "class_type": "CheckpointLoaderSimple"
    },
    "5": {
      "inputs": {
        "width": 1024,
        "height": 576,
        "batch_size": 1
      },
      "class_type": "EmptyLatentImage"
    },
    "6": {
      "inputs": {
        "text": "PROMPT_PLACEHOLDER",
        "clip": [
          "4",
          1
        ]
      },
      "class_type": "CLIPTextEncode"
    },
    "7": {
      "inputs": {
        "text": "bad eyes, bad anatomy, text, watermark, blurry, low quality",
        "clip": [
          "4",
          1
        ]
      },
      "class_type": "CLIPTextEncode"
    },
    "8": {
      "inputs": {
        "samples": [
          "3",
          0
        ],
        "vae": [
          "4",
          2
        ]
      },
      "class_type": "VAEDecode"
    },
    "9": {
      "inputs": {
        "filename_prefix": "VN_Creator",
        "images": [
          "8",
          0
        ]
      },
      "class_type": "SaveImage"
    }
  };
}

/**
 * Ruft verfügbare LoRAs von der ComfyUI-API ab.
 * Versucht GET /models/loras sowie Fallback über GET /object_info/LoraLoader.
 * Gibt ein Array von Modellnamen (ohne .safetensors-Endung) zurück.
 */
export async function getAvailableLoras(comfyUrl = 'http://127.0.0.1:8188'): Promise<string[]> {
  const normalizedUrl = (comfyUrl || 'http://127.0.0.1:8188').replace(/\/$/, "");
  try {
    const res = await fetch(`${normalizedUrl}/models/loras`);
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data)) {
        return data.map(item => {
          const str = typeof item === 'string' ? item : (item?.name || String(item));
          return str.replace(/\\/g, '/').replace(/\.(safetensors|ckpt|pt)$/i, '');
        }).filter(Boolean);
      }
    }
    // Fallback über /object_info
    const objRes = await fetch(`${normalizedUrl}/object_info/LoraLoader`);
    if (objRes.ok) {
      const objData = await objRes.json();
      const list = objData?.LoraLoader?.input?.required?.lora_name?.[0];
      if (Array.isArray(list)) {
        return list.map(item => {
          const str = typeof item === 'string' ? item : (item?.name || String(item));
          return str.replace(/\\/g, '/').replace(/\.(safetensors|ckpt|pt)$/i, '');
        }).filter(Boolean);
      }
    }
  } catch (err) {
    console.warn("ComfyUI LoRA-Liste konnte nicht abgerufen werden:", err);
  }
  return [];
}

/**
 * Ruft verfügbare Checkpoints und Diffusion-Modelle von der ComfyUI-API ab.
 * Fragt GET /models/checkpoints und GET /models/diffusion_models ab und führt beide Listen zusammen.
 * Fehler bei einem Endpunkt werden ignoriert, sodass die funktionierende Liste dennoch geladen wird.
 * Gibt ein Array von Modellnamen (ohne .safetensors-Endung) zurück.
 */
export async function getAvailableCheckpoints(comfyUrl = 'http://127.0.0.1:8188'): Promise<string[]> {
  const normalizedUrl = (comfyUrl || 'http://127.0.0.1:8188').replace(/\/$/, "");

  const fetchCheckpoints = async (): Promise<string[]> => {
    try {
      const res = await fetch(`${normalizedUrl}/models/checkpoints`);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) {
          return data.map(item => {
            const str = typeof item === 'string' ? item : (item?.name || String(item));
            return str.replace(/\\/g, '/').replace(/\.(safetensors|ckpt|pt)$/i, '');
          }).filter(Boolean);
        }
      }
      // Fallback über /object_info/CheckpointLoaderSimple
      const objRes = await fetch(`${normalizedUrl}/object_info/CheckpointLoaderSimple`);
      if (objRes.ok) {
        const objData = await objRes.json();
        const list = objData?.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0];
        if (Array.isArray(list)) {
          return list.map(item => {
            const str = typeof item === 'string' ? item : (item?.name || String(item));
            return str.replace(/\\/g, '/').replace(/\.(safetensors|ckpt|pt)$/i, '');
          }).filter(Boolean);
        }
      }
    } catch (err) {
      console.warn("ComfyUI Checkpoints konnten nicht abgerufen werden:", err);
    }
    return [];
  };

  const fetchDiffusionModels = async (): Promise<string[]> => {
    try {
      const res = await fetch(`${normalizedUrl}/models/diffusion_models`);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) {
          return data.map(item => {
            const str = typeof item === 'string' ? item : (item?.name || String(item));
            return str.replace(/\\/g, '/').replace(/\.(safetensors|ckpt|pt)$/i, '');
          }).filter(Boolean);
        }
      }
      // Fallback über /object_info/UNETLoader
      const objRes = await fetch(`${normalizedUrl}/object_info/UNETLoader`);
      if (objRes.ok) {
        const objData = await objRes.json();
        const list = objData?.UNETLoader?.input?.required?.unet_name?.[0];
        if (Array.isArray(list)) {
          return list.map(item => {
            const str = typeof item === 'string' ? item : (item?.name || String(item));
            return str.replace(/\\/g, '/').replace(/\.(safetensors|ckpt|pt)$/i, '');
          }).filter(Boolean);
        }
      }
    } catch (err) {
      console.warn("ComfyUI Diffusion Models konnten nicht abgerufen werden:", err);
    }
    return [];
  };

  try {
    const [ckpts, diffusionModels] = await Promise.all([
      fetchCheckpoints(),
      fetchDiffusionModels()
    ]);

    // Checkpoints zuerst, dann Diffusion-Modelle, duplikatfrei
    const merged = Array.from(new Set([...ckpts, ...diffusionModels]));
    return merged;
  } catch (err) {
    console.warn("ComfyUI Modell-Listen Fehler:", err);
    return [];
  }
}

export function prepareComfyWorkflow(
  workflowStr: string,
  positivePrompt: string,
  width = 1024,
  height = 576,
  loraTrigger?: string,
  loraFileName?: string,
  checkpointFileName?: string
): any {
  try {
    let rawStr = workflowStr || JSON.stringify(getDefaultWorkflow());

    // Ersetze alle Backslashes (\) durch Slashes (/), um ungültige JSON-Escape-Fehler unter Windows zu verhindern
    const cleanLora = (loraFileName?.trim() || '').replace(/\\/g, "/");
    const loraFullFile = cleanLora 
      ? (cleanLora.endsWith('.safetensors') || cleanLora.endsWith('.ckpt') || cleanLora.endsWith('.pt') ? cleanLora : `${cleanLora}.safetensors`)
      : '';

    const cleanCkpt = (checkpointFileName?.trim() || '').replace(/\\/g, "/");
    const ckptFullFile = cleanCkpt 
      ? (cleanCkpt.endsWith('.safetensors') || cleanCkpt.endsWith('.ckpt') || cleanCkpt.endsWith('.pt') ? cleanCkpt : `${cleanCkpt}.safetensors`)
      : '';

    // 1. Text-basierte Ersetzung von Platzhaltern
    if (loraFullFile) {
      rawStr = rawStr.replace(/CHARACTER_LORA_PLACEHOLDER/g, loraFullFile);
    }
    if (ckptFullFile) {
      rawStr = rawStr.replace(/CHECKPOINT_PLACEHOLDER/g, ckptFullFile);
    }

    const hasPromptPlaceholder = /PROMPT_PLACEHOLDER|POSITIVE_PROMPT_PLACEHOLDER/.test(rawStr);
    if (positivePrompt) {
      console.log("[ComfyUI] Finaler Prompt für Generierung:", positivePrompt);
      const stringifiedPrompt = JSON.stringify(positivePrompt);
      // Wenn "PROMPT_PLACEHOLDER" als ganzer JSON-Stringwert steht:
      rawStr = rawStr.replace(/"PROMPT_PLACEHOLDER"/g, stringifiedPrompt);
      rawStr = rawStr.replace(/"POSITIVE_PROMPT_PLACEHOLDER"/g, stringifiedPrompt);
      // Falls PROMPT_PLACEHOLDER ohne äußere Anführungszeichen oder in Teilstrings vorkommt:
      const innerEscaped = stringifiedPrompt.slice(1, -1);
      rawStr = rawStr.replace(/PROMPT_PLACEHOLDER/g, innerEscaped);
      rawStr = rawStr.replace(/POSITIVE_PROMPT_PLACEHOLDER/g, innerEscaped);
    }

    const workflow = JSON.parse(rawStr);
    let foundPositive = hasPromptPlaceholder;

    // 2. Dynamische Checkpoint / UNET-Aktualisierung (nur wenn explizit gewählt)
    if (ckptFullFile) {
      for (const [, node] of Object.entries(workflow) as [string, any][]) {
        if (node.class_type === "CheckpointLoaderSimple" || node.class_type === "CheckpointLoader" || node.inputs?.ckpt_name) {
          if (node.inputs) {
            node.inputs.ckpt_name = ckptFullFile;
          }
        }
        if (node.class_type === "UNETLoader" || node.inputs?.unet_name) {
          if (node.inputs) {
            node.inputs.unet_name = ckptFullFile;
          }
        }
      }
    }

    // 3. Dynamische LoRA-Behandlung
    if (loraFullFile) {
      // Wenn eine LoRA gewählt wurde: Knoten mit Dateinamen befüllen
      for (const [, node] of Object.entries(workflow) as [string, any][]) {
        if (node.class_type === "LoraLoader" || node.class_type?.includes("LoraLoader")) {
          node.inputs = node.inputs || {};
          node.inputs.lora_name = loraFullFile;
          if (node.inputs.strength_model === undefined || node.inputs.strength_model === 0) {
            node.inputs.strength_model = 1.0;
          }
          if (node.inputs.strength_clip === undefined || node.inputs.strength_clip === 0) {
            node.inputs.strength_clip = 1.0;
          }
        }
      }
    } else {
      // Wenn KEINE LoRA gewählt wurde: Alle LoraLoader-Knoten entfernen und Verbindungen durchreichen
      const loraNodeIds = Object.keys(workflow).filter(id => {
        const n = workflow[id];
        return n && (n.class_type === "LoraLoader" || n.class_type?.includes("LoraLoader"));
      });

      for (const loraId of loraNodeIds) {
        const loraNode = workflow[loraId];
        if (!loraNode) continue;
        const sourceModel = loraNode.inputs?.model;
        const sourceClip = loraNode.inputs?.clip;

        // Alle Referenzen [loraId, 0] und [loraId, 1] in anderen Knoten durch Quell-Verbindungen ersetzen
        for (const [otherId, otherNode] of Object.entries(workflow) as [string, any][]) {
          if (otherId === loraId || !otherNode || !otherNode.inputs) continue;
          for (const [inputKey, inputValue] of Object.entries(otherNode.inputs)) {
            if (Array.isArray(inputValue) && inputValue.length === 2) {
              const [targetNodeId, targetIndex] = inputValue;
              if (String(targetNodeId) === String(loraId)) {
                if (targetIndex === 0 && sourceModel !== undefined) {
                  otherNode.inputs[inputKey] = sourceModel;
                } else if (targetIndex === 1 && sourceClip !== undefined) {
                  otherNode.inputs[inputKey] = sourceClip;
                }
              }
            }
          }
        }

        // LoraLoader-Knoten aus dem Workflow löschen
        delete workflow[loraId];
      }
    }

    // 4. Prompts, Dimensionen und Seed setzen
    for (const [, node] of Object.entries(workflow) as [string, any][]) {
      // Find CLIPTextEncode nodes
      if (node.class_type === "CLIPTextEncode") {
        const currentText = node.inputs?.text || "";
        // If it looks like negative keywords, skip it as positive candidate
        const isNegativeKeywords = /negative|bad|blurry|ugly|deformed|text|watermark/i.test(currentText);
        if (!isNegativeKeywords && !foundPositive) {
          node.inputs = node.inputs || {};
          node.inputs.text = positivePrompt;
          foundPositive = true;
        }
      }

      // Optionally update width/height in EmptyLatentImage
      if (node.class_type === "EmptyLatentImage") {
        if (node.inputs) {
          node.inputs.width = width;
          node.inputs.height = height;
        }
      }

      // Frische Zufalls-Seed für KSampler / KSamplerAdvanced setzen (2^53 sicherer JS-Integer-Bereich)
      if (
        node.class_type === "KSampler" ||
        node.class_type === "KSamplerAdvanced" ||
        node.class_type?.includes("KSampler") ||
        (node.inputs && (node.inputs.seed !== undefined || node.inputs.noise_seed !== undefined))
      ) {
        if (node.inputs) {
          const freshSeed = Math.floor(Math.random() * (2 ** 53));
          if (node.inputs.seed !== undefined || node.class_type?.includes("KSampler")) {
            node.inputs.seed = freshSeed;
          }
          if (node.inputs.noise_seed !== undefined) {
            node.inputs.noise_seed = freshSeed;
          }
        }
      }
    }

    // Fallback: If no positive prompt CLIPTextEncode was found by heuristic, set first found CLIPTextEncode
    if (!foundPositive) {
      for (const [, node] of Object.entries(workflow) as [string, any][]) {
        if (node.class_type === "CLIPTextEncode") {
          node.inputs = node.inputs || {};
          node.inputs.text = positivePrompt;
          break;
        }
      }
    }

    return workflow;
  } catch (e) {
    console.error("Fehler beim Verarbeiten des ComfyUI-Workflows:", e);
    return null;
  }
}

export async function generateComfyImage(
  comfyUrl: string,
  workflowJson: any,
  onStatusUpdate: (status: string) => void
): Promise<string> {
  const normalizedUrl = comfyUrl.replace(/\/$/, "");

  // 1. Verbindungsprüfung & Queue-Request
  onStatusUpdate("Sende Prompt an ComfyUI...");
  
  let promptId = "";
  try {
    const response = await fetch(`${normalizedUrl}/prompt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: workflowJson })
    });

    if (!response.ok) {
      const txt = await response.text();
      throw new Error(`ComfyUI Antwortfehler: ${response.status} - ${txt}`);
    }

    const resData = await response.json();
    promptId = resData.prompt_id;
    if (!promptId) {
      throw new Error("ComfyUI hat keine prompt_id zurückgegeben.");
    }
  } catch (err: any) {
    console.error("ComfyUI Connection/Queue Error:", err);
    throw new Error(
      `Verbindung zu ComfyUI unter ${normalizedUrl} fehlgeschlagen.\n\n` +
      `Mögliche Ursachen:\n` +
      `1. ComfyUI läuft nicht auf deinem PC.\n` +
      `2. Der Server blockiert die Anfrage (CORS). Stelle sicher, dass du ComfyUI mit dem Argument '--enable-cors-header' gestartet hast.\n` +
      `Details: ${err.message}`
    );
  }

  // 2. Polling für Fertigstellung
  onStatusUpdate("In Warteschlange eingereiht...");
  
  let attempts = 0;
  const maxAttempts = 180; // 3 Minuten max
  const pollInterval = 1000; // 1 Sekunde

  while (attempts < maxAttempts) {
    await new Promise(resolve => setTimeout(resolve, pollInterval));
    attempts++;

    try {
      // Prüfe History für diese promptId
      const historyRes = await fetch(`${normalizedUrl}/history/${promptId}`);
      if (historyRes.ok) {
        const historyData = await historyRes.json();
        
        // Wenn das Objekt mit promptId gefüllt ist, ist der Run fertig
        if (historyData && historyData[promptId]) {
          const runDetails = historyData[promptId];
          const outputs = runDetails.outputs;
          
          if (!outputs) {
            throw new Error("Generierung abgeschlossen, aber keine Ausgabedaten gefunden.");
          }

          // Finde den SaveImage oder PreviewImage Knoten mit Bildausgabe
          let imageInfo: { filename: string; type: string; subfolder?: string } | null = null;
          
          for (const nodeOutput of Object.values(outputs) as any[]) {
            if (nodeOutput.images && nodeOutput.images.length > 0) {
              imageInfo = nodeOutput.images[0];
              break;
            }
          }

          if (!imageInfo) {
            throw new Error("Kein Ausgabebild im fertigen Workflow gefunden.");
          }

          onStatusUpdate("Bild fertiggestellt! Lade Bilddaten...");
          
          // 3. Bild abrufen und in Base64 umwandeln
          const viewUrl = `${normalizedUrl}/view?filename=${encodeURIComponent(imageInfo.filename)}&type=${encodeURIComponent(imageInfo.type)}` + 
            (imageInfo.subfolder ? `&subfolder=${encodeURIComponent(imageInfo.subfolder)}` : "");
          
          const imgRes = await fetch(viewUrl);
          if (!imgRes.ok) {
            throw new Error("Konnte das generierte Bild nicht vom ComfyUI-Server laden.");
          }

          const blob = await imgRes.blob();
          return new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => {
              if (reader.result) {
                resolve(reader.result as string);
              } else {
                reject(new Error("Fehler beim Lesen der Bilddaten."));
              }
            };
            reader.onerror = () => reject(new Error("FileReader Fehler."));
            reader.readAsDataURL(blob);
          });
        }
      }
      
      // Wenn noch nicht fertig, zeige Fortschritt
      onStatusUpdate(`Generiere Bild... (${attempts}s)`);
    } catch (e: any) {
      console.warn("Fehler beim Abfragen des Status:", e);
      // Führe Polling fort bei temporären Netzwerkfehlen
    }
  }

  throw new Error("Zeitlimit bei der Bildgenerierung überschritten (3 Minuten).");
}
