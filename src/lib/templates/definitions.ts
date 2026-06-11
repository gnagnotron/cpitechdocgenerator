import type { DocumentTemplateId, TemplateDefinition } from "../types.ts";

export const templateDefinitions: Record<DocumentTemplateId, TemplateDefinition> = {
  technical: {
    id: "technical",
    outputName: "technical",
    defaultSelected: true,
    estimatedSeconds: 8,
    aiEnhanceable: true,
    requiredHeadings: ["Obiettivo", "Ingressi", "Trasformazioni", "Output"],
  },
  functional: {
    id: "functional",
    outputName: "functional",
    defaultSelected: true,
    estimatedSeconds: 7,
    aiEnhanceable: true,
    requiredHeadings: ["business", "input", "output"],
  },
  handover: {
    id: "handover",
    outputName: "handover",
    defaultSelected: true,
    estimatedSeconds: 6,
    aiEnhanceable: true,
    requiredHeadings: ["Checklist", "Test", "Output"],
  },
  audit: {
    id: "audit",
    outputName: "audit",
    defaultSelected: false,
    estimatedSeconds: 5,
    aiEnhanceable: true,
    requiredHeadings: ["Audit", "Quality", "Warnings"],
  },
  training: {
    id: "training",
    outputName: "training",
    defaultSelected: false,
    estimatedSeconds: 5,
    aiEnhanceable: true,
    requiredHeadings: ["Training", "Checklist", "Tests"],
  },
};

export const defaultTemplateIds = Object.values(templateDefinitions)
  .filter((template) => template.defaultSelected)
  .map((template) => template.id);
