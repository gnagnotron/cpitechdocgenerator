export type Provenance = "file-extracted" | "rule-based";

export interface CanonicalSection<T> {
  provenance: Provenance;
  confidence: number;
  data: T;
}

export interface StructuredWarning {
  code: string;
  message: string;
  path?: string;
  suggestion?: string;
}

export interface StructuredError {
  code: string;
  message: string;
  suggestion?: string;
}

export interface ParsedManifest {
  entries: Record<string, string>;
}

export interface ParsedIflw {
  name: string;
  id: string;
  version?: string;
  properties: Array<{ key: string; value: string }>;
  channels: Array<{
    id: string;
    name: string;
    role: string;
    direction: string;
    componentType: string;
    system?: string;
    queueName?: string;
    urlPath?: string;
    endpoint?: string;
    processRef?: string;
    properties: Record<string, string>;
  }>;
  flowElements: Array<{
    id: string;
    name: string;
    tag: string;
    processId?: string;
    attributes: Record<string, string>;
    properties: Record<string, string>;
  }>;
  participants: Array<{ id: string; name: string; type: string }>;
  processes: Array<{ id: string; name: string }>;
  senderSystems: string[];
  receiverSystems: string[];
  steps: Array<{ id: string; name: string; type: string }>;
  routes: Array<{ from: string; to: string; condition?: string }>;
}

export interface ParsedMmap {
  name: string;
  sourceMessages: string[];
  targetMessages: string[];
  rules: string[];
  functionLibraries: string[];
  links: Array<{
    role: string;
    typeId: string;
    artifact: string;
    path: string;
    node?: string;
    namespace?: string;
  }>;
}

export interface ParsedXsd {
  fileName: string;
  elements: string[];
  complexTypes: string[];
}

export interface ParsedZipArtifacts {
  manifest?: ParsedManifest;
  metainfo?: Record<string, string>;
  parameters?: Record<string, string>;
  parameterDefinitions?: Array<{ name: string; type: string; required: boolean }>;
  iflows: ParsedIflw[];
  mmaps: ParsedMmap[];
  xsds: ParsedXsd[];
  groovyScripts: string[];
  warnings: StructuredWarning[];
}

export interface CanonicalModel {
  artifact: CanonicalSection<{ name: string; version: string; vendor: string }>;
  ingressi: CanonicalSection<string[]>;
  processi: CanonicalSection<string[]>;
  stepERouting: CanonicalSection<Array<{ step: string; route: string }>>;
  mappingERegole: CanonicalSection<string[]>;
  arricchimenti: CanonicalSection<string[]>;
  output: CanonicalSection<string[]>;
  dipendenze: CanonicalSection<string[]>;
  assunzioniEGap: CanonicalSection<string[]>;
}

export interface GeneratedDocument {
  name: string;
  markdown: string;
  html: string;
  templateId?: DocumentTemplateId;
  displayName?: string;
  language?: LanguageCode;
  mode?: GenerationMode;
}

export type LanguageCode = "it" | "en" | "fr" | "de";

export type GenerationMode = "deterministic";

export type DocumentTemplateId =
  | "technical"
  | "functional"
  | "handover"
  | "audit"
  | "training";

export interface TemplateDefinition {
  id: DocumentTemplateId;
  outputName: string;
  defaultSelected: boolean;
  estimatedSeconds: number;
  requiredHeadings: string[];
}

export interface LocaleMessages {
  code: LanguageCode;
  ui: {
    appName: string;
    headline: string;
    subtitle: string;
    tabs: Record<string, string>;
    labels: Record<string, string>;
    phases: string[];
    templates: Record<DocumentTemplateId, string>;
    docFileNames: Record<DocumentTemplateId, string>;
    languages: Record<LanguageCode, string>;
  };
  docs: {
    sections: Record<string, string>;
    labels: Record<string, string>;
    text: Record<string, string>;
  };
}

export interface GeneratedSessionMeta {
  id: string;
  createdAt: string;
  fileName: string;
  language: LanguageCode;
  mode: GenerationMode;
  templateIds: DocumentTemplateId[];
  aiUsed: boolean;
  sharePath: string;
}

export interface SessionRecord extends GeneratedSessionMeta {
  warnings: StructuredWarning[];
  canonicalModel: CanonicalModel;
  flowGraph: FlowGraph;
  qualityGate: QualityGateReport;
  documents: GeneratedDocument[];
}

export interface GenerateDocumentsOptions {
  language?: LanguageCode;
  sessionId?: string;
  sourceFileName?: string;
}

export interface PublicGenerateRequest {
  zipBase64: string;
  language?: LanguageCode;
}

export interface FlowGraph {
  nodes: Array<{
    id: string;
    label: string;
    type: string;
    processId?: string;
    source: "iflow" | "channel";
  }>;
  edges: Array<{
    id: string;
    from: string;
    to: string;
    label?: string;
    source: "iflow";
  }>;
  channels: Array<{
    id: string;
    name: string;
    direction: string;
    componentType: string;
    endpoint?: string;
    queueName?: string;
    urlPath?: string;
    processRef?: string;
  }>;
}

export interface QualityGateReport {
  passed: boolean;
  score: number;
  checks: Array<{
    id: string;
    passed: boolean;
    message: string;
  }>;
}

export interface GenerationResult {
  canonicalModel: CanonicalModel;
  documents: GeneratedDocument[];
  warnings: StructuredWarning[];
  flowGraph: FlowGraph;
  qualityGate: QualityGateReport;
  locale: LanguageCode;
  mode: GenerationMode;
  selectedTemplateIds: DocumentTemplateId[];
}
