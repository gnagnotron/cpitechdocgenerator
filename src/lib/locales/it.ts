import type { LocaleMessages } from "../types.ts";

export const itLocale: LocaleMessages = {
  code: "it",
  ui: {
    appName: "SAP CPI Doc Forge",
    headline: "iFlow ZIP to Documentation",
    subtitle:
      "Carica un export ZIP di SAP Integration Flow e genera il documento tecnico dai dati estratti dal package.",
    tabs: {
      upload: "Upload",
      template: "Template",
      history: "Cronologia",
      preview: "Preview",
    },
    labels: {
      language: "Lingua",
      mode: "Modalita",
      deterministic: "Deterministic",
      aiEnhanced: "AI-Enhanced",
      estimatedTime: "Tempo stimato",
      generate: "Genera documentazione",
      generating: "Generazione in corso...",
      uploadHint: "Trascina piu ZIP iFlow oppure selezionali insieme dal computer",
      noFile: "Nessun file selezionato",
      recentUploads: "Upload recenti",
      templates: "Template da generare",
      shareLink: "Link pubblico",
      recovery: "Ripristina sessione",
      previewMarkdown: "Markdown",
      previewHtml: "HTML",
      downloadAll: "Download All (.zip)",
      aiUnavailable: "AI non configurata: fallback deterministico automatico.",
    },
    phases: [
      "Upload zip",
      "Validazione struttura iFlow",
      "Parsing deterministico",
      "Generazione documenti",
      "Packaging output",
    ],
    templates: {
      technical: "Documento Tecnico",
      functional: "Documento Funzionale",
      handover: "Documento Handover",
      audit: "Documento Audit",
      training: "Documento Training",
    },
    docFileNames: {
      technical: "documento-tecnico",
      functional: "documento-funzionale",
      handover: "documento-handover",
      audit: "documento-audit",
      training: "documento-training",
    },
    languages: {
      it: "Italiano",
      en: "English",
      fr: "Francais",
      de: "Deutsch",
    },
  },
  docs: {
    sections: {
      objective: "Obiettivo del flusso e architettura logica",
      inputs: "Ingressi del flusso",
      endToEnd: "Flusso end-to-end",
      transformations: "Trasformazioni e arricchimenti",
      mapping: "Mapping dettagliato verso target",
      xmlCsv: "Conversione XML -> CSV",
      output: "Output finale e naming file",
      dependencies: "Dipendenze",
      errorHandling: "Gestione errori e comportamento",
      reliability: "Provenance e affidabilita",
      files: "Mappa file utili",
      checklist: "Checklist operativa",
      tests: "Test minimi consigliati",
      openPoints: "Open points e gap",
      businessGoal: "Obiettivo business",
      references: "Riferimenti per approfondimento",
      audit: "Audit trail e controlli",
      training: "Guida rapida per training",
    },
    labels: {
      artifact: "Artifact",
      version: "Versione",
      vendor: "Vendor / bundle",
      input: "Input",
      parameter: "Parametro",
      process: "Processo",
      provenance: "Provenance",
      confidence: "Confidence",
      gap: "Gap residui",
    },
    text: {
      technicalIntro:
        "Questo Integration Flow riceve input dai canali {{inputs}} e produce output verso i receiver configurati nel package. La logica e estratta in modo deterministico dal contenuto dello zip, ma raccontata in forma operativa per facilitare il passaggio di consegne.",
      functionalIntro:
        "Il flusso trasferisce dati dal sistema sorgente al target traducendo il payload in un formato utilizzabile a valle. L'obiettivo non e solo tecnico: garantire coerenza del dato e prevedibilita del comportamento operativo.",
      handoverIntro:
        "Questa guida e pensata per chi prende in carico il flusso senza averlo sviluppato. Le informazioni sono ordinate per passare rapidamente da comprensione a operativita.",
      auditIntro:
        "Questa vista audit sintetizza cio che e stato estratto deterministicamente dal package, evidenziando punti di controllo, rischi e coverage documentale.",
      trainingIntro:
        "Questo documento training riassume il minimo indispensabile per presentare il flusso a un nuovo collega o a un team di supporto applicativo.",
      aiNarrativePrompt:
        "Riscrivi in italiano professionale e concreto, senza inventare dettagli non presenti nei dati forniti.",
      aiBestPracticesPrompt:
        "Genera best practice operative concise, verificabili e aderenti al contenuto tecnico fornito.",
      aiTestCasesPrompt:
        "Genera test case pratici derivati dalle regole di mapping e dai rami del flusso, senza aggiungere sistemi non presenti.",
    },
  },
};
