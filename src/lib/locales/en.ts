import type { LocaleMessages } from "../types.ts";

export const enLocale: LocaleMessages = {
  code: "en",
  ui: {
    appName: "SAP CPI Doc Forge",
    headline: "iFlow ZIP to Documentation",
    subtitle:
      "Upload a SAP Integration Flow ZIP export and generate the technical document from package-extracted data.",
    tabs: {
      upload: "Upload",
      template: "Templates",
      history: "History",
      preview: "Preview",
    },
    labels: {
      language: "Language",
      mode: "Mode",
      deterministic: "Deterministic",
      aiEnhanced: "AI-Enhanced",
      estimatedTime: "Estimated time",
      generate: "Generate documentation",
      generating: "Generating...",
      uploadHint: "Drag and drop multiple iFlow ZIPs or select them together",
      noFile: "No file selected",
      recentUploads: "Recent uploads",
      templates: "Templates to generate",
      shareLink: "Public link",
      recovery: "Restore session",
      previewMarkdown: "Markdown",
      previewHtml: "HTML",
      downloadAll: "Download All (.zip)",
      aiUnavailable: "AI is not configured: automatic deterministic fallback will be used.",
    },
    phases: [
      "ZIP upload",
      "iFlow validation",
      "Deterministic parsing",
      "Document generation",
      "Output packaging",
    ],
    templates: {
      technical: "Technical document",
      functional: "Functional document",
      handover: "Handover document",
      audit: "Audit document",
      training: "Training document",
    },
    docFileNames: {
      technical: "technical-document",
      functional: "functional-document",
      handover: "handover-document",
      audit: "audit-document",
      training: "training-document",
    },
    languages: {
      it: "Italian",
      en: "English",
      fr: "French",
      de: "German",
    },
  },
  docs: {
    sections: {
      objective: "Flow objective and logical architecture",
      inputs: "Flow inputs",
      endToEnd: "End-to-end flow",
      transformations: "Transformations and enrichments",
      mapping: "Detailed target mapping",
      xmlCsv: "XML to CSV conversion",
      output: "Final output and file naming",
      dependencies: "Dependencies",
      errorHandling: "Error handling and behavior",
      reliability: "Provenance and reliability",
      files: "Useful file map",
      checklist: "Operational checklist",
      tests: "Recommended minimum tests",
      openPoints: "Open points and gaps",
      businessGoal: "Business goal",
      references: "References for further analysis",
      audit: "Audit trail and controls",
      training: "Quick training guide",
    },
    labels: {
      artifact: "Artifact",
      version: "Version",
      vendor: "Vendor / bundle",
      input: "Input",
      parameter: "Parameter",
      process: "Process",
      provenance: "Provenance",
      confidence: "Confidence",
      gap: "Residual gaps",
    },
    text: {
      technicalIntro:
        "This Integration Flow receives input from the channels {{inputs}} and produces output towards the receivers configured in the package. The logic is extracted deterministically from the ZIP but presented in an operational form for faster handover.",
      functionalIntro:
        "The flow transfers data from the source system to the target system by translating the payload into a downstream-usable format. The goal is not only technical: it is to guarantee data consistency and predictable runtime behavior.",
      handoverIntro:
        "This guide is intended for people taking ownership of the flow without having developed it. The information is ordered to move quickly from understanding to operations.",
      auditIntro:
        "This audit view summarizes what has been deterministically extracted from the package, highlighting control points, risks and documentation coverage.",
      trainingIntro:
        "This training document summarizes the minimum knowledge required to introduce the flow to a new teammate or support team.",
      aiNarrativePrompt:
        "Rewrite in concise professional English, without inventing details that are not present in the provided data.",
      aiBestPracticesPrompt:
        "Generate concise operational best practices that remain verifiable against the provided technical context.",
      aiTestCasesPrompt:
        "Generate practical test cases from mapping rules and flow branches, without introducing systems that are not present.",
    },
  },
};
