import type { CanonicalModel, ParsedZipArtifacts } from "./types.ts";
import { callAIWithFallback, getAIConfigurationStatus } from "./ai-enhancer.ts";

const buildEnrichmentPrompt = (parsed: ParsedZipArtifacts, model: CanonicalModel) => {
  const steps = model.stepERouting.data.slice(0, 15);
  const processes = model.processi.data.slice(0, 10);
  const inputs = model.ingressi.data.slice(0, 10);
  const outputs = model.output.data.slice(0, 10);

  return `
Analizza il flusso di integrazione SAP e interpreta logicamente i dati estratti.

**Dati grezzi estratti:**
- Artifact: ${model.artifact.data.name}
- Input: ${inputs.join(", ") || "non determinato"}
- Processi: ${processes.join(", ") || "non determinato"}
- Output: ${outputs.join(", ") || "non determinato"}

**Step e routing (ordine di estrazione):**
${steps.map((s, i) => `${i + 1}. ${s.step} → ${s.route}`).join("\n")}

**Compiti:**
1. Identifica swimlane o processi separati (es. step che appartengono a flussi paralleli o alternativi).
2. Riordina logicamente gli step per flusso principale prima, poi alternativi.
3. Per ogni gruppo logico, suggerisci un nome/categoria (es. "Validazione", "Elaborazione", "Output").
4. Individua relazioni implicite (es. dipendenze, condizioni, precondizioni).
5. Se ci sono step con nome generico (es. "Non determinabile"), prova a dedurre il ruolo dal contesto.

**Formato risposta (JSON):**
{
  "processes": [
    { "name": "Main Process", "steps": [{"original": "...", "refined": "...", "index": 0}, ...], "description": "..." },
    { "name": "Alternative Flow", "steps": [...], "description": "..." }
  ],
  "relationships": [
    { "from": "...", "to": "...", "type": "sequence|parallel|conditional" }
  ],
  "observations": ["Osservazione 1", "Osservazione 2"]
}

Sii conciso, pratico, basati SOLO sui dati forniti. Non inventare.
`;
};

export async function enrichCanonicalModelWithAI(
  parsed: ParsedZipArtifacts,
  model: CanonicalModel,
): Promise<CanonicalModel | null> {
  const status = getAIConfigurationStatus();
  if (!status.configured) {
    return null;
  }

  const prompt = buildEnrichmentPrompt(parsed, model);
  const aiResult = await callAIWithFallback(prompt);

  if (!aiResult) {
    return null;
  }

  let parsed_response: any;
  try {
    const jsonMatch = aiResult.match(/\{[\s\S]*\}/);
    parsed_response = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
  } catch {
    return null;
  }

  if (!parsed_response?.processes || !Array.isArray(parsed_response.processes)) {
    return null;
  }

  // Ricostruisci stepERouting in ordine logico
  const enrichedSteps: Array<{ step: string; route: string }> = [];
  for (const proc of parsed_response.processes) {
    if (Array.isArray(proc.steps)) {
      for (const s of proc.steps) {
        if (s.refined) {
          const originalStep = model.stepERouting.data[s.index];
          enrichedSteps.push({
            step: s.refined,
            route: s.route || originalStep?.route || "→",
          });
        }
      }
    }
  }

  if (enrichedSteps.length === 0) {
    return null;
  }

  const enrichedModel: CanonicalModel = {
    ...model,
    stepERouting: {
      provenance: "ai-generated",
      confidence: 0.85,
      data: enrichedSteps,
    },
  };

  return enrichedModel;
}
