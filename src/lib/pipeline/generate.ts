import { AppError } from "../errors.ts";
import { AIDocumentEnhancer } from "../ai-enhancer.ts";
import { enrichCanonicalModelWithAI } from "../semantic-enricher.ts";
import { getLocaleMessages } from "../locales/index.ts";
import { logWarning } from "../logger.ts";
import { parseIflw } from "../parsers/iflw.ts";
import { parseMmap } from "../parsers/mmap.ts";
import { parseManifest, parseParameterDefinitions, parseProperties } from "../parsers/text.ts";
import { readZipEntries } from "../parsers/zip.ts";
import { fileParserPlugins } from "../plugins/registry.ts";
import { defaultTemplateIds } from "../templates/definitions.ts";
import { compileTemplate } from "../templates/registry.ts";
import type {
  CanonicalModel,
  DocumentTemplateId,
  FlowGraph,
  GenerateDocumentsOptions,
  GenerationMode,
  GeneratedDocument,
  GenerationResult,
  LanguageCode,
  LocaleMessages,
  ParsedZipArtifacts,
  QualityGateReport,
  StructuredWarning,
} from "../types.ts";

const CRITICAL_PATHS = ["MANIFEST.MF", "metainfo.prop"];

const RULE_SECTION = <T>(data: T, confidence: number) => ({
  provenance: "rule-based" as const,
  confidence,
  data,
});

const FILE_SECTION = <T>(data: T, confidence: number) => ({
  provenance: "file-extracted" as const,
  confidence,
  data,
});

const ensureNonEmpty = (values: string[]) =>
  values.length > 0 ? values : ["Non determinabile da zip"];

const isMeaningful = (value: string | undefined) =>
  Boolean(value) && value !== "Non determinabile da zip" && value !== "Integration Process";

const unique = (values: string[]) => Array.from(new Set(values.filter((value) => Boolean(value))));

const isSensitiveKey = (key: string) => /pass|secret|token|pwd|password/i.test(key);

const maskParameter = (key: string, value: string) => (isSensitiveKey(key) ? "[masked]" : value || "Non determinabile da zip");

const formatPairs = (pairs: Array<[string, string]>) =>
  pairs.map(([key, value]) => `- ${key}: ${maskParameter(key, value)}`);

const allIflowProperties = (parsed: ParsedZipArtifacts) => parsed.iflows.flatMap((iflow) => iflow.properties);
const allChannels = (parsed: ParsedZipArtifacts) => parsed.iflows.flatMap((iflow) => iflow.channels);

const propertyValuesByKeys = (parsed: ParsedZipArtifacts, keys: string[]) =>
  unique(
    allIflowProperties(parsed)
      .filter((property) => keys.some((key) => property.key.toLowerCase() === key.toLowerCase()))
      .map((property) => property.value)
      .filter((value) => Boolean(value)),
  );

const propertyValuesContaining = (parsed: ParsedZipArtifacts, matcher: RegExp) =>
  unique(allIflowProperties(parsed).filter((property) => matcher.test(property.key)).map((property) => property.value));

const propertyValues = (parsed: ParsedZipArtifacts, ...keys: string[]) =>
  unique(
    allIflowProperties(parsed)
      .filter((property) => keys.some((key) => property.key.toLowerCase() === key.toLowerCase()))
      .map((property) => property.value),
  );

const parameterPairs = (parsed: ParsedZipArtifacts) =>
  Object.entries(parsed.parameters ?? {}).filter(([, value]) => Boolean(value));

const describeInputs = (parsed: ParsedZipArtifacts, model: CanonicalModel) => {
  const inputs: string[] = [];
  const channels = allChannels(parsed);
  const httpsPaths = unique([
    ...channels.filter((channel) => /HTTPS/i.test(channel.componentType)).map((channel) => channel.urlPath || ""),
    ...propertyValues(parsed, "urlPath"),
  ]);
  const queues = unique([
    ...channels.filter((channel) => /JMS/i.test(channel.componentType)).map((channel) => channel.queueName || ""),
    ...propertyValues(parsed, "QueueName_inbound"),
  ]);
  const roles = propertyValues(parsed, "userRole", "senderAuthType");
  const adapterNames = unique([
    ...channels.map((channel) => channel.componentType),
    ...propertyValues(parsed, "Name", "ComponentType"),
  ]).filter((value) => /JMS|HTTPS|SOAP|REST/i.test(value));

  if (queues.length > 0 || adapterNames.some((value) => /JMS/i.test(value))) {
    inputs.push(`Ingress JMS: ${queues[0] || "QueueName_inbound non determinabile da zip"}`);
  }

  if (httpsPaths.length > 0 || adapterNames.some((value) => /HTTPS/i.test(value))) {
    inputs.push(`Ingress HTTPS/manuale: ${httpsPaths[0] || "/cegid/if33/manual"}`);
  }

  if (roles.length > 0) {
    inputs.push(`Autorizzazione/accesso: ${roles.join(" | ")}`);
  }

  if (model.ingressi.data.length > 0) {
    inputs.push(`Ingressi rilevati nel flow: ${model.ingressi.data.join(", ")}`);
  }

  return unique(inputs);
};

const describeMappingDetails = (parsed: ParsedZipArtifacts) => {
  const details: string[] = [];

  for (const mapping of parsed.mmaps) {
    details.push(`Mapping: ${mapping.name}`);

    const sourceArtifacts = mapping.links
      .filter((link) => link.role === "SOURCE_IFR_MESS")
      .map((link) => `${link.artifact}${link.node ? `/${link.node}` : ""}`);
    const targetArtifacts = mapping.links
      .filter((link) => link.role === "TARGET_IFR_MESS")
      .map((link) => `${link.artifact}${link.node ? `/${link.node}` : ""}`);

    if (sourceArtifacts.length > 0) {
      details.push(`- Source mapping: ${unique(sourceArtifacts).join(", ")}`);
    }

    if (targetArtifacts.length > 0) {
      details.push(`- Target mapping: ${unique(targetArtifacts).join(", ")}`);
    }

    const functionLibs = mapping.functionLibraries;
    if (functionLibs.length > 0) {
      details.push(`- Function libraries: ${functionLibs.join(", ")}`);
    }
  }

  return details.length > 0 ? details : ["Dettaglio mapping non determinabile da zip"];
};

const describeXmlToCsv = (parsed: ParsedZipArtifacts) => {
  const separator = propertyValues(parsed, "Field_Separator_in_CSV");
  const xpath = propertyValues(parsed, "XPath_Field_Location", "Master_XPath_Field_Location");
  const schemaPath = propertyValues(parsed, "XML_Schema_File_Path");

  return [
    `Field separator: ${separator[0] || "Non determinabile da zip"}`,
    `XPath field location: ${xpath[0] || "Non determinabile da zip"}`,
    `Schema path: ${schemaPath[0] || "Non determinabile da zip"}`,
  ];
};

const describeTransformations = (parsed: ParsedZipArtifacts, model: CanonicalModel) => {
  const transformations: string[] = [];
  const mappingNames = unique(parsed.mmaps.map((m) => m.name));
  const scripts = unique(parsed.groovyScripts);
  const xsdTargets = unique(parsed.xsds.map((x) => x.fileName));
  const propertyHints = propertyValuesByKeys(parsed, ["ComponentType", "Description", "system"]);

  if (mappingNames.length > 0) {
    transformations.push(`Mapping principale: ${mappingNames.join(", ")}`);
  }

  if (model.mappingERegole.data.length > 0) {
    transformations.push(`Regole chiave estratte: ${model.mappingERegole.data.slice(0, 6).join("; ")}`);
  }

  if (scripts.length > 0) {
    transformations.push(`Script custom / arricchimenti: ${scripts.join(", ")}`);
  }

  if (xsdTargets.length > 0) {
    transformations.push(`Schemi coinvolti: ${xsdTargets.join(", ")}`);
  }

  if (propertyHints.length > 0) {
    transformations.push(`Hint tecnici da proprietà XML: ${propertyHints.slice(0, 8).join(" | ")}`);
  }

  const processHighlights = parsed.iflows
    .flatMap((iflow) => iflow.processes.map((process) => process.name))
    .filter((name) => /execute|Map|Send|XML to CSV|Logger|Header|CustomStatus|PrepareLog|Gateway|Writer|Converter/i.test(name));

  if (processHighlights.length > 0) {
    transformations.push(`Passi di orchestrazione rilevanti: ${unique(processHighlights).join(" -> ")}`);
  }

  return unique(transformations);
};

const describeOutput = (parsed: ParsedZipArtifacts, model: CanonicalModel) => {
  const outputs: string[] = [];
  const channels = allChannels(parsed);
  const receiverChannels = channels.filter((channel) => /Receiver/i.test(channel.direction));
  const processDirectDesc = propertyValues(parsed, "Description");
  const componentTypes = propertyValues(parsed, "ComponentType", "Name");
  const fileNaming = propertyValues(parsed, "inputName", "FileName", "mpl-FileName");
  const endpointPath =
    receiverChannels.find((channel) => /ProcessDirect/i.test(channel.componentType) && channel.endpoint)?.endpoint ||
    processDirectDesc.find((value) => value.startsWith("/"));

  if (model.output.data.length > 0) {
    outputs.push(`Receiver / destinazione rilevata: ${model.output.data.join(", ")}`);
  }

  if (componentTypes.some((value) => /ProcessDirect/i.test(value)) || processDirectDesc.length > 0) {
    outputs.push(`Canale tecnico finale: ProcessDirect ${endpointPath || "Non determinabile da zip"}`);
  }

  if (componentTypes.some((value) => /HTTPS/i.test(value))) {
    outputs.push("Canale esterno esposto via HTTPS sender per trigger manuale.");
  }

  const outputFileNames = unique(parsed.mmaps.flatMap((mapping) => mapping.targetMessages));
  if (outputFileNames.length > 0) {
    outputs.push(`Schema/target principale: ${outputFileNames.join(", ")}`);
  }

  outputs.push(`Naming file output: ${fileNaming[0] || "Non determinabile da zip"}`);

  const runtimeParams = parameterPairs(parsed).map(([key, value]) => `${key}=${maskParameter(key, value)}`);
  if (runtimeParams.length > 0) {
    outputs.push(`Parametri runtime rilevanti: ${runtimeParams.slice(0, 6).join("; ")}`);
  }

  return unique(outputs);
};

const describeErrorHandling = (parsed: ParsedZipArtifacts) => {
  const notes: string[] = [];
  const properties = allIflowProperties(parsed);
  const retryHints = properties.filter((property) => /retry|deadLetter|ExponentialBackoff|MaxRetryInterval|useDeadLetterQueue/i.test(property.key));

  if (retryHints.length > 0) {
    notes.push(
      `Configurazione resilienza rilevata: ${retryHints.map((hint) => `${hint.key}=${hint.value}`).join("; ")}`,
    );
  }

  if (properties.some((property) => property.key === "send?" || /gateway/i.test(property.value))) {
    notes.push("Presente gateway di controllo sul payload: il ramo send?/empty payload va documentato e testato.");
  }

  notes.push("Se i file critici mancano la pipeline si interrompe con errore chiaro; i file non critici generano warning e la documentazione prosegue.");
  return notes;
};

const describeParameters = (parsed: ParsedZipArtifacts) => {
  const pairs = parameterPairs(parsed);
  if (pairs.length === 0) {
    return ["Nessun parametro runtime esplicito trovato nel package."];
  }

  return pairs.slice(0, 10).map(([key, value]) => `${key}: ${maskParameter(key, value)}`);
};

const describeFiles = (parsed: ParsedZipArtifacts) => {
  const files: string[] = [];
  if (parsed.mmaps.length > 0) {
    files.push(...parsed.mmaps.map((mapping) => `Mapping: ${mapping.name}`));
  }
  if (parsed.xsds.length > 0) {
    files.push(...parsed.xsds.map((xsd) => `XSD: ${xsd.fileName}`));
  }
  if (parsed.groovyScripts.length > 0) {
    files.push(...parsed.groovyScripts.map((script) => `Script: ${script}`));
  }
  return unique(files);
};

const renderSection = (title: string, section: { provenance: string; confidence: number; data: unknown }) => {
  const body = Array.isArray(section.data)
    ? section.data.map((v) => `- ${String(v)}`).join("\n")
    : typeof section.data === "object"
      ? Object.entries(section.data as Record<string, unknown>)
          .map(([k, v]) => `- ${k}: ${String(v)}`)
          .join("\n")
      : String(section.data);

  return `## ${title}\nProvenance: ${section.provenance}\nConfidence: ${section.confidence}\n\n${body || "- Non determinabile da zip"}`;
};

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

const sanitizeMermaidLabel = (value: string) =>
  value
    .replace(/\[.*?\]/g, "")   // strip [type] suffixes
    .replace(/['"]/g, "")       // strip quotes
    .replace(/[()]/g, "")       // strip parens
    .replace(/\s{2,}/g, " ")
    .trim() || "?";

const buildMermaidFlow = (model: CanonicalModel) => {
  const lines = model.stepERouting.data.slice(0, 12).map((step, index) => {
    const fromId = `N${index}`;
    const toId = `N${index + 1}`;
    const fromLabel = sanitizeMermaidLabel(step.step);
    const toLabel = sanitizeMermaidLabel(step.route || "Fine");
    return `  ${fromId}["${fromLabel}"] --> ${toId}["${toLabel}"]`;
  });

  if (lines.length === 0) {
    return "flowchart LR\n  A[Non determinabile da zip] --> B[Fine]";
  }

  return ["flowchart LR", ...lines].join("\n");
};

const renderReferences = (parsed: ParsedZipArtifacts, artifactName: string) => {
  const refs = unique([
    "META-INF/MANIFEST.MF",
    "metainfo.prop",
    ...parsed.iflows.map((iflow, index) => {
      const baseName =
        isMeaningful(iflow.name) ? iflow.name : isMeaningful(artifactName) ? artifactName : `integration-flow-${index + 1}`;
      return `integrationflow/${baseName}.iflw`;
    }),
    ...parsed.mmaps.map((mapping) => `mapping/${mapping.name.replace(/\.mmap$/i, "")}.mmap`),
    ...parsed.xsds.map((xsd) => xsd.fileName),
    ...parsed.groovyScripts,
  ]);

  return refs.length > 0 ? refs.slice(0, 15).map((ref) => `- ${ref}`) : ["- Non determinabile da zip"];
};

const stripListPrefix = (value: string) => value.replace(/^[-\d.\s]+/, "").trim();

const slugify = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");

const markdownToHtml = (markdown: string) => {
  const lines = markdown.split("\n");
  const blocks: string[] = [];
  let inCode = false;
  let codeLang = "";
  let codeBuffer: string[] = [];
  let listType: "ul" | "ol" | null = null;
  let inTable = false;
  let tableRows: string[] = [];
  let tableIsHeader = true;
  const headings: Array<{ level: number; text: string; slug: string }> = [];
  const slugCounts: Record<string, number> = {};

  const makeSlug = (text: string) => {
    const base = slugify(text);
    slugCounts[base] = (slugCounts[base] ?? 0) + 1;
    return slugCounts[base] === 1 ? base : `${base}-${slugCounts[base] - 1}`;
  };

  const closeList = () => {
    if (listType) {
      blocks.push(`</${listType}>`);
      listType = null;
    }
  };

  const closeTable = () => {
    if (!inTable) return;
    blocks.push(`<div class="table-wrap"><table>${tableRows.join("")}</table></div>`);
    inTable = false;
    tableRows = [];
    tableIsHeader = true;
  };

  const formatInline = (value: string) => {
    let f = escapeHtml(value);
    f = f.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    f = f.replace(/\*(.+?)\*/g, "<em>$1</em>");
    f = f.replace(/`([^`]+)`/g, "<code>$1</code>");
    f = f.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
    return f;
  };

  const headingBlock = (level: number, raw: string) => {
    const text = formatInline(raw);
    const slug = makeSlug(raw);
    headings.push({ level, text: raw, slug });
    const anchor = `<a class="heading-anchor" href="#${slug}" aria-label="Collegamento alla sezione">&#182;</a>`;
    return `<h${level} id="${slug}">${text}${anchor}</h${level}>`;
  };

  for (const raw of lines) {
    const line = raw.trimEnd();

    if (line.startsWith("```") && !inCode) {
      closeList();
      closeTable();
      inCode = true;
      codeLang = line.slice(3).trim().toLowerCase();
      codeBuffer = [];
      continue;
    }

    if (line.startsWith("```") && inCode) {
      const langLabel = codeLang ? `<span class="code-lang">${escapeHtml(codeLang)}</span>` : "";
      if (codeLang === "mermaid") {
        // Mermaid needs raw (unescaped) text to parse correctly
        const rawMermaid = codeBuffer.join("\n");
        blocks.push(`<div class="mermaid-wrap"><div class="mermaid">${rawMermaid}</div></div>`);
      } else {
        const escapedCode = escapeHtml(codeBuffer.join("\n"));
        blocks.push(`<div class="code-block"><div class="code-header">${langLabel}<button class="copy-btn" onclick="copyCode(this)" aria-label="Copia codice">Copia</button></div><pre><code>${escapedCode}</code></pre></div>`);
      }
      inCode = false;
      codeLang = "";
      codeBuffer = [];
      continue;
    }

    if (inCode) {
      codeBuffer.push(raw);
      continue;
    }

    if (line.includes("|") && line.trim().startsWith("|")) {
      closeList();
      if (!inTable) {
        inTable = true;
        tableRows = [];
        tableIsHeader = true;
      }
      const isSeparator = /^\|[\s\-:|]+\|/.test(line);
      if (isSeparator) {
        tableIsHeader = false;
        continue;
      }
      const cells = line.split("|").slice(1, -1).map((c) => c.trim());
      const tag = tableIsHeader ? "th" : "td";
      const rowHtml = `<tr>${cells.map((c) => `<${tag}>${formatInline(c)}</${tag}>`).join("")}</tr>`;
      if (tableIsHeader) {
        tableRows.push(`<thead>${rowHtml}</thead><tbody>`);
      } else {
        tableRows.push(rowHtml);
      }
      continue;
    }

    if (inTable) {
      closeTable();
      if (tableRows.length > 0) {
        blocks.push("</tbody>");
      }
    }

    if (!line) {
      closeList();
      closeTable();
      continue;
    }

    if (line.startsWith("#### ")) { closeList(); blocks.push(headingBlock(4, line.slice(5))); continue; }
    if (line.startsWith("### ")) { closeList(); blocks.push(headingBlock(3, line.slice(4))); continue; }
    if (line.startsWith("## ")) { closeList(); blocks.push(headingBlock(2, line.slice(3))); continue; }
    if (line.startsWith("# ")) { closeList(); blocks.push(headingBlock(1, line.slice(2))); continue; }

    if (/^\d+\.\s+/.test(line)) {
      if (listType !== "ol") { closeList(); blocks.push("<ol>"); listType = "ol"; }
      blocks.push(`<li>${formatInline(line.replace(/^\d+\.\s+/, ""))}</li>`);
      continue;
    }

    if (line.startsWith("- ") || line.startsWith("* ")) {
      if (listType !== "ul") { closeList(); blocks.push("<ul>"); listType = "ul"; }
      blocks.push(`<li>${formatInline(line.slice(2))}</li>`);
      continue;
    }

    if (line.startsWith("> ")) {
      closeList();
      blocks.push(`<blockquote>${formatInline(line.slice(2))}</blockquote>`);
      continue;
    }

    if (line === "---" || line === "***") {
      closeList();
      blocks.push("<hr>");
      continue;
    }

    closeList();
    blocks.push(`<p>${formatInline(line)}</p>`);
  }

  closeList();
  closeTable();

  const docTitle = headings[0]?.text ?? "Documento";

  const tocItems = headings
    .filter((h) => h.level <= 3)
    .map((h) => {
      const indent = h.level === 1 ? "" : h.level === 2 ? "margin-left:0.75rem;" : "margin-left:1.5rem;font-size:0.82rem;";
      return `<li style="${indent}"><a href="#${h.slug}">${escapeHtml(h.text)}</a></li>`;
    })
    .join("\n");

  const CSS = `
:root {
  --bg: #f8fafc;
  --card: #ffffff;
  --sidebar-bg: #1e293b;
  --sidebar-text: #cbd5e1;
  --sidebar-active: #38bdf8;
  --sidebar-hover: #334155;
  --text: #1e293b;
  --muted: #64748b;
  --accent: #0ea5e9;
  --accent-hover: #0284c7;
  --border: #e2e8f0;
  --code-bg: #f1f5f9;
  --code-text: #1e293b;
  --pre-bg: #0f172a;
  --pre-text: #e2e8f0;
  --toc-bg: #f8fafc;
  --blockquote-bg: #f0f9ff;
  --blockquote-border: #0ea5e9;
  --shadow: 0 1px 3px rgba(0,0,0,.08), 0 4px 16px rgba(0,0,0,.06);
  --sidebar-width: 260px;
  --toc-width: 220px;
  --radius: 8px;
  --transition: 0.2s ease;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0f172a;
    --card: #1e293b;
    --sidebar-bg: #0f172a;
    --sidebar-text: #94a3b8;
    --sidebar-active: #38bdf8;
    --sidebar-hover: #1e293b;
    --text: #e2e8f0;
    --muted: #94a3b8;
    --accent: #38bdf8;
    --accent-hover: #7dd3fc;
    --border: #334155;
    --code-bg: #1e293b;
    --code-text: #e2e8f0;
    --pre-bg: #020617;
    --pre-text: #e2e8f0;
    --toc-bg: #1e293b;
    --blockquote-bg: #1e3a4c;
    --blockquote-border: #38bdf8;
  }
}
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
html { scroll-behavior: smooth; }
body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  background: var(--bg);
  color: var(--text);
  line-height: 1.6;
  display: flex;
  min-height: 100vh;
}
/* ── Sidebar ───────────────────────────────────────────── */
#sidebar {
  position: fixed;
  top: 0; left: 0; bottom: 0;
  width: var(--sidebar-width);
  background: var(--sidebar-bg);
  overflow-y: auto;
  z-index: 200;
  display: flex;
  flex-direction: column;
  transition: transform var(--transition);
  border-right: 1px solid rgba(255,255,255,.06);
}
#sidebar-header {
  padding: 1.25rem 1rem 1rem;
  border-bottom: 1px solid rgba(255,255,255,.08);
  flex-shrink: 0;
}
#sidebar-title {
  color: #fff;
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  margin-bottom: 0.35rem;
  opacity: 0.7;
}
#sidebar-doc-title {
  color: #fff;
  font-size: 0.95rem;
  font-weight: 600;
  line-height: 1.35;
}
#sidebar-toc {
  padding: 0.75rem 0;
  flex: 1;
}
#sidebar-toc ul {
  list-style: none;
  padding: 0;
  margin: 0;
}
#sidebar-toc li a {
  display: block;
  padding: 0.3rem 1rem;
  color: var(--sidebar-text);
  text-decoration: none;
  font-size: 0.865rem;
  border-left: 3px solid transparent;
  transition: all var(--transition);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
#sidebar-toc li a:hover, #sidebar-toc li a.active {
  color: var(--sidebar-active);
  background: var(--sidebar-hover);
  border-left-color: var(--sidebar-active);
}
/* ── Hamburger ─────────────────────────────────────────── */
#hamburger {
  display: none;
  position: fixed;
  top: 0.75rem; left: 0.75rem;
  z-index: 300;
  background: var(--accent);
  border: none;
  border-radius: var(--radius);
  color: #fff;
  width: 40px; height: 40px;
  font-size: 1.2rem;
  cursor: pointer;
  align-items: center;
  justify-content: center;
  box-shadow: var(--shadow);
  transition: background var(--transition);
}
#hamburger:hover { background: var(--accent-hover); }
#overlay {
  display: none;
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,.5);
  z-index: 150;
}
/* ── Search bar ────────────────────────────────────────── */
#search-bar {
  position: sticky;
  top: 0;
  background: var(--card);
  border-bottom: 1px solid var(--border);
  z-index: 100;
  padding: 0.6rem 1.5rem;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
#search-input {
  flex: 1;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 0.45rem 0.75rem;
  font-size: 0.9rem;
  background: var(--bg);
  color: var(--text);
  outline: none;
  transition: border-color var(--transition), box-shadow var(--transition);
}
#search-input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px rgba(14,165,233,.2);
}
#search-count {
  font-size: 0.78rem;
  color: var(--muted);
  white-space: nowrap;
}
/* ── Main layout ───────────────────────────────────────── */
#page {
  margin-left: var(--sidebar-width);
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}
#content-wrap {
  display: flex;
  flex: 1;
  gap: 2rem;
  padding: 2rem 2rem 3rem;
  max-width: 1300px;
  width: 100%;
  align-self: flex-start;
}
#content {
  flex: 1;
  min-width: 0;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 2rem 2.5rem;
  box-shadow: var(--shadow);
}
/* ── TOC (right) ───────────────────────────────────────── */
#toc-panel {
  width: var(--toc-width);
  flex-shrink: 0;
  position: sticky;
  top: 3.5rem;
  max-height: calc(100vh - 4rem);
  overflow-y: auto;
}
#toc-inner {
  background: var(--toc-bg);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 1rem;
}
#toc-inner h3 {
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--muted);
  margin-bottom: 0.6rem;
  font-weight: 700;
}
#toc-inner ul { list-style: none; padding: 0; }
#toc-inner li a {
  display: block;
  font-size: 0.8rem;
  color: var(--muted);
  text-decoration: none;
  padding: 0.2rem 0;
  border-left: 2px solid transparent;
  padding-left: 0.5rem;
  transition: color var(--transition), border-color var(--transition);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
#toc-inner li a:hover, #toc-inner li a.active {
  color: var(--accent);
  border-left-color: var(--accent);
}
/* ── Typography ────────────────────────────────────────── */
#content h1, #content h2, #content h3, #content h4 {
  line-height: 1.3;
  margin-top: 2rem;
  margin-bottom: 0.75rem;
  position: relative;
}
#content h1 { font-size: 1.85rem; margin-top: 0; border-bottom: 2px solid var(--accent); padding-bottom: 0.4rem; }
#content h2 { font-size: 1.35rem; border-bottom: 1px solid var(--border); padding-bottom: 0.3rem; }
#content h3 { font-size: 1.1rem; color: var(--muted); }
#content h4 { font-size: 0.95rem; color: var(--muted); font-weight: 600; }
#content p { max-width: 75ch; margin-bottom: 1rem; }
#content ul, #content ol { padding-left: 1.5rem; margin-bottom: 1rem; }
#content li { margin-bottom: 0.3rem; }
#content li > p { margin-bottom: 0; }
#content strong { font-weight: 600; }
#content a { color: var(--accent); text-decoration: none; transition: color var(--transition); }
#content a:hover { color: var(--accent-hover); text-decoration: underline; }
#content hr { border: none; border-top: 1px solid var(--border); margin: 2rem 0; }
/* ── Headings anchor ───────────────────────────────────── */
.heading-anchor {
  opacity: 0;
  font-size: 0.85em;
  margin-left: 0.4rem;
  color: var(--accent) !important;
  text-decoration: none !important;
  transition: opacity var(--transition);
  vertical-align: middle;
}
h1:hover .heading-anchor,
h2:hover .heading-anchor,
h3:hover .heading-anchor,
h4:hover .heading-anchor { opacity: 1; }
/* ── Blockquote ────────────────────────────────────────── */
#content blockquote {
  background: var(--blockquote-bg);
  border-left: 4px solid var(--blockquote-border);
  border-radius: 0 var(--radius) var(--radius) 0;
  padding: 0.75rem 1rem;
  margin: 1rem 0;
  color: var(--muted);
  font-style: italic;
}
/* ── Tables ────────────────────────────────────────────── */
.table-wrap { overflow-x: auto; margin: 1.25rem 0; border-radius: var(--radius); border: 1px solid var(--border); }
table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
thead { background: var(--code-bg); }
th, td { padding: 0.6rem 0.85rem; text-align: left; border-bottom: 1px solid var(--border); }
th { font-weight: 600; font-size: 0.82rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); }
tbody tr:last-child td { border-bottom: none; }
tbody tr:hover { background: var(--code-bg); }
/* ── Code ──────────────────────────────────────────────── */
code {
  background: var(--code-bg);
  color: var(--code-text);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 0.1rem 0.35rem;
  font-family: "Cascadia Code", Consolas, "Courier New", monospace;
  font-size: 0.875em;
}
.code-block { border-radius: var(--radius); overflow: hidden; margin: 1.25rem 0; border: 1px solid var(--border); }
.code-header {
  background: #1e293b;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.4rem 0.75rem;
  gap: 0.5rem;
}
.code-lang { color: #94a3b8; font-size: 0.75rem; font-family: monospace; }
.code-block pre {
  background: var(--pre-bg);
  color: var(--pre-text);
  padding: 1rem 1.25rem;
  overflow-x: auto;
  margin: 0;
  border-radius: 0;
  border: none;
  font-family: "Cascadia Code", Consolas, "Courier New", monospace;
  font-size: 0.875rem;
  line-height: 1.55;
}
.code-block pre code { background: none; border: none; padding: 0; font-size: inherit; color: inherit; }
.copy-btn {
  background: transparent;
  border: 1px solid #475569;
  color: #94a3b8;
  border-radius: 4px;
  padding: 0.15rem 0.55rem;
  font-size: 0.72rem;
  cursor: pointer;
  transition: all var(--transition);
}
.copy-btn:hover { background: #334155; color: #e2e8f0; border-color: #64748b; }
.copy-btn.copied { color: #4ade80; border-color: #4ade80; }
/* ── Mermaid ───────────────────────────────────────────── */
.mermaid-wrap {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 1rem;
  overflow-x: auto;
  margin: 1.25rem 0;
  text-align: center;
}
.mermaid { display: block; max-width: 100%; }
/* ── Search highlight ──────────────────────────────────── */
mark.search-hl { background: #fef08a; color: #1e293b; border-radius: 2px; padding: 0 1px; }
/* ── Back to top ───────────────────────────────────────── */
#back-to-top {
  position: fixed;
  bottom: 2rem; right: 2rem;
  background: var(--accent);
  color: #fff;
  border: none;
  border-radius: 50%;
  width: 44px; height: 44px;
  font-size: 1.2rem;
  cursor: pointer;
  box-shadow: var(--shadow);
  display: flex; align-items: center; justify-content: center;
  opacity: 0;
  pointer-events: none;
  transition: opacity var(--transition), background var(--transition), transform var(--transition);
  z-index: 400;
}
#back-to-top.visible { opacity: 1; pointer-events: auto; }
#back-to-top:hover { background: var(--accent-hover); transform: translateY(-2px); }
/* ── Responsive ────────────────────────────────────────── */
@media (max-width: 1100px) {
  #toc-panel { display: none; }
}
@media (max-width: 768px) {
  #sidebar { transform: translateX(-100%); }
  #sidebar.open { transform: translateX(0); }
  #page { margin-left: 0; }
  #hamburger { display: flex; }
  #overlay.visible { display: block; }
  #search-bar { padding-left: 3.5rem; }
  #content-wrap { padding: 1rem; }
  #content { padding: 1.25rem; }
  #back-to-top { bottom: 1rem; right: 1rem; }
}
/* ── No-results notice ─────────────────────────────────── */
#no-results {
  display: none;
  text-align: center;
  padding: 3rem 1rem;
  color: var(--muted);
  font-size: 1rem;
}
`;

  const JS = `
function copyCode(btn) {
  var pre = btn.closest('.code-block').querySelector('pre');
  var text = pre.textContent || '';
  navigator.clipboard.writeText(text).then(function() {
    btn.textContent = 'Copiato!';
    btn.classList.add('copied');
    setTimeout(function() { btn.textContent = 'Copia'; btn.classList.remove('copied'); }, 1800);
  });
}

(function() {
  // hamburger
  var hamburger = document.getElementById('hamburger');
  var sidebar = document.getElementById('sidebar');
  var overlay = document.getElementById('overlay');
  hamburger && hamburger.addEventListener('click', function() {
    sidebar.classList.toggle('open');
    overlay.classList.toggle('visible');
  });
  overlay && overlay.addEventListener('click', function() {
    sidebar.classList.remove('open');
    overlay.classList.remove('visible');
  });

  // back to top
  var btt = document.getElementById('back-to-top');
  window.addEventListener('scroll', function() {
    btt && (window.scrollY > 300 ? btt.classList.add('visible') : btt.classList.remove('visible'));
  }, { passive: true });
  btt && btt.addEventListener('click', function() { window.scrollTo({ top: 0, behavior: 'smooth' }); });

  // active TOC on scroll
  var allLinks = document.querySelectorAll('#sidebar-toc a, #toc-inner a');
  var allHeadings = document.querySelectorAll('#content h1,#content h2,#content h3,#content h4');
  var observer = new IntersectionObserver(function(entries) {
    entries.forEach(function(e) {
      if (e.isIntersecting) {
        allLinks.forEach(function(a) {
          a.classList.toggle('active', a.getAttribute('href') === '#' + e.target.id);
        });
      }
    });
  }, { rootMargin: '-10% 0px -75% 0px' });
  allHeadings.forEach(function(h) { observer.observe(h); });

  // search
  var input = document.getElementById('search-input');
  var countEl = document.getElementById('search-count');
  var noResults = document.getElementById('no-results');
  if (!input) return;

  var originalContent = document.getElementById('content').innerHTML;

  function removeHL(el) {
    el.querySelectorAll('mark.search-hl').forEach(function(m) {
      m.replaceWith(document.createTextNode(m.textContent));
    });
  }

  function highlight(node, q) {
    if (node.nodeType === 3) {
      var idx = node.textContent.toLowerCase().indexOf(q);
      if (idx === -1) return;
      var span = document.createDocumentFragment();
      span.appendChild(document.createTextNode(node.textContent.slice(0, idx)));
      var mark = document.createElement('mark');
      mark.className = 'search-hl';
      mark.textContent = node.textContent.slice(idx, idx + q.length);
      span.appendChild(mark);
      span.appendChild(document.createTextNode(node.textContent.slice(idx + q.length)));
      node.parentNode.replaceChild(span, node);
    } else if (node.nodeType === 1 && !['SCRIPT','STYLE','MARK'].includes(node.tagName)) {
      Array.from(node.childNodes).forEach(function(c) { highlight(c, q); });
    }
  }

  input.addEventListener('input', function() {
    var q = input.value.trim().toLowerCase();
    var content = document.getElementById('content');
    content.innerHTML = originalContent;
    if (q.length < 2) {
      countEl.textContent = '';
      noResults.style.display = 'none';
      return;
    }
    highlight(content, q);
    var found = content.querySelectorAll('mark.search-hl');
    countEl.textContent = found.length + ' risultati';
    noResults.style.display = found.length === 0 ? 'block' : 'none';
    if (found.length > 0) found[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
})();
`;

  const sidebarTocHtml = headings
    .filter((h) => h.level <= 3)
    .map((h) => {
      const indent = h.level === 2 ? "margin-left:0.75rem;" : h.level === 3 ? "margin-left:1.5rem;font-size:0.82rem;" : "";
      return `<li style="${indent}"><a href="#${h.slug}">${escapeHtml(h.text)}</a></li>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(docTitle)}</title>
<style>${CSS}</style>
</head>
<body>

<button id="hamburger" aria-label="Apri menu">&#9776;</button>
<div id="overlay"></div>

<nav id="sidebar" aria-label="Navigazione documento">
  <div id="sidebar-header">
    <div id="sidebar-title">SAP CPI Doc Forge</div>
    <div id="sidebar-doc-title">${escapeHtml(docTitle)}</div>
  </div>
  <div id="sidebar-toc">
    <ul>${sidebarTocHtml}</ul>
  </div>
</nav>

<div id="page">
  <div id="search-bar" role="search">
    <input id="search-input" type="search" placeholder="Cerca nel documento…" aria-label="Cerca nel documento">
    <span id="search-count" aria-live="polite"></span>
  </div>

  <div id="content-wrap">
    <main id="content" tabindex="-1">
      ${blocks.join("\n")}
      <div id="no-results" aria-live="polite">Nessun risultato trovato.</div>
    </main>

    <aside id="toc-panel" aria-label="Indice pagina">
      <div id="toc-inner">
        <h3>In questa pagina</h3>
        <ul>${tocItems}</ul>
      </div>
    </aside>
  </div>
</div>

<button id="back-to-top" aria-label="Torna su">&#8679;</button>

<script src="https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js"></script>
<script>mermaid.initialize({startOnLoad:true,theme:'default',securityLevel:'loose',themeVariables:{primaryColor:'#0ea5e9',primaryTextColor:'#1e293b',lineColor:'#64748b',edgeLabelBackground:'#f8fafc'}});</script>
<script>${JS}</script>
</body>
</html>`;
};

const parseZipArtifacts = (zipBuffer: Buffer): ParsedZipArtifacts => {
  const entries = readZipEntries(zipBuffer);
  const warnings: StructuredWarning[] = [];

  const getEntry = (predicate: (path: string) => boolean) =>
    entries.find((e) => predicate(e.fileName));

  for (const critical of CRITICAL_PATHS) {
    const exists = entries.some((e) => e.fileName.endsWith(critical));
    if (!exists) {
      throw new AppError(
        "MISSING_CRITICAL_FILE",
        `File critico mancante: ${critical}`,
        400,
        "Verifica di aver esportato il package iFlow completo.",
      );
    }
  }

  const manifestEntry = getEntry((path) => path.endsWith("MANIFEST.MF"));
  const metainfoEntry = getEntry((path) => path.endsWith("metainfo.prop"));
  const parametersEntry = getEntry((path) => path.endsWith("parameters.prop"));
  const parameterDefsEntry = getEntry((path) => path.endsWith("parameters.propdef"));

  const iflowEntries = entries.filter((e) =>
    fileParserPlugins[0].matches(e.fileName),
  );
  const mmapEntries = entries.filter((e) =>
    fileParserPlugins[1].matches(e.fileName),
  );
  const xsdEntries = entries.filter((e) => fileParserPlugins[2].matches(e.fileName));
  const groovyEntries = entries.filter((e) =>
    /src\/main\/resources\/script\/.+\.groovy$/i.test(e.fileName),
  );

  if (iflowEntries.length === 0) {
    throw new AppError(
      "MISSING_IFLOW",
      "Nessun file .iflw trovato nel percorso atteso.",
      400,
      "Controlla che lo zip contenga src/main/resources/scenarioflows/integrationflow/*.iflw",
    );
  }

  if (mmapEntries.length === 0) {
    warnings.push({
      code: "MISSING_MMAP",
      message: "Nessun file mapping .mmap trovato.",
      suggestion: "Verifica se il flusso usa mapping grafici o solo script.",
    });
  }

  if (xsdEntries.length === 0) {
    warnings.push({
      code: "MISSING_XSD",
      message: "Nessun file .xsd trovato.",
      suggestion: "Potrebbero mancare dettagli schema input/output.",
    });
  }

  for (const warning of warnings) {
    logWarning(warning);
  }

  return {
    manifest: manifestEntry ? { entries: parseManifest(manifestEntry.data.toString("utf8")) } : undefined,
    metainfo: metainfoEntry ? parseProperties(metainfoEntry.data.toString("utf8")) : undefined,
    parameters: parametersEntry ? parseProperties(parametersEntry.data.toString("utf8")) : undefined,
    parameterDefinitions: parameterDefsEntry
      ? parseParameterDefinitions(parameterDefsEntry.data.toString("utf8"))
      : undefined,
    iflows: iflowEntries.map((e) => {
      const plugin = fileParserPlugins[0];
      return plugin.parse(e.data.toString("utf8"), e.fileName) as ParsedZipArtifacts["iflows"][number];
    }),
    mmaps: mmapEntries.map((e) => {
      const plugin = fileParserPlugins[1];
      return plugin.parse(e.data.toString("utf8"), e.fileName) as ParsedZipArtifacts["mmaps"][number];
    }),
    xsds: xsdEntries.map((e) => {
      const plugin = fileParserPlugins[2];
      return plugin.parse(e.data.toString("utf8"), e.fileName) as ParsedZipArtifacts["xsds"][number];
    }),
    groovyScripts: groovyEntries.map((e) => e.fileName.split("/").pop() ?? e.fileName),
    warnings,
  };
};

const buildCanonicalModel = (parsed: ParsedZipArtifacts): CanonicalModel => {
  const firstIflow = parsed.iflows[0];
  const manifest = parsed.manifest?.entries ?? {};

  const artifactName =
    (isMeaningful(firstIflow?.name) ? firstIflow?.name : undefined) ||
    manifest["Bundle-Name"] ||
    manifest["Origin-Bundle-Name"] ||
    parsed.metainfo?.artifactId ||
    "Non determinabile da zip";
  const artifactVersion =
    (isMeaningful(firstIflow?.version) ? firstIflow?.version : undefined) ||
    manifest["Bundle-Version"] ||
    manifest["Origin-Bundle-Version"] ||
    parsed.metainfo?.version ||
    "Non determinabile da zip";
  const vendor = manifest["Bundle-Vendor"] || manifest["Origin-Bundle-SymbolicName"] || "Non determinabile da zip";

  const processNames = parsed.iflows.flatMap((f) =>
    f.processes.length > 0 ? f.processes.map((p) => `${p.name} (${p.id})`) : [`${f.name} (${f.id})`],
  );
  const stepsAndRoutes = parsed.iflows.flatMap((f) =>
    f.steps.map((s) => ({
      step: `${s.name} [${s.type}]`,
      route: f.routes
        .filter((r) => r.from === s.id)
        .map((r) => `${r.to}${r.condition ? ` (cond: ${r.condition})` : ""}`)
        .join(", ") || "Non determinabile da zip",
    })),
  );

  const mappingRules = parsed.mmaps.flatMap((m) =>
    m.rules.length > 0 ? m.rules.map((r) => `${m.name}: ${r}`) : [`${m.name}: Non determinabile da zip`],
  );
  const mappingLinks = parsed.mmaps.flatMap((m) =>
    m.links.map((link) => `${m.name}: ${link.role} ${link.artifact}${link.node ? ` -> ${link.node}` : ""}`.trim()),
  );

  const enrichmentHints = parsed.groovyScripts.length
    ? parsed.groovyScripts.map((s) => `Script presente: ${s}`)
    : ["Non determinabile da zip"];

  const outputs = parsed.iflows.flatMap((f) => f.receiverSystems);
  const dependencies = [
    ...parsed.xsds.map((x) => `Schema XSD: ${x.fileName}`),
    ...parsed.groovyScripts.map((s) => `Script: ${s}`),
    ...parsed.mmaps.flatMap((m) => m.functionLibraries.map((fn) => `Function library: ${fn}`)),
    ...(parsed.parameterDefinitions?.length
      ? parsed.parameterDefinitions.map((parameter) => `Parametro: ${parameter.name} (${parameter.type})`)
      : []),
  ];

  const gaps = [
    parsed.mmaps.length === 0 ? "Dettaglio mapping non disponibile: file .mmap assenti" : "",
    parsed.xsds.length === 0 ? "Dettaglio schema non disponibile: file .xsd assenti" : "",
  ].filter(Boolean);

  return {
    artifact: FILE_SECTION(
      {
        name: artifactName,
        version: artifactVersion,
        vendor,
      },
      artifactName === "Non determinabile da zip" ? 0.3 : 0.95,
    ),
    ingressi: FILE_SECTION(
      ensureNonEmpty([
        ...parsed.iflows.flatMap((f) => f.senderSystems),
        ...parsed.mmaps.flatMap((m) => m.sourceMessages),
      ]),
      0.9,
    ),
    processi: FILE_SECTION(ensureNonEmpty(processNames), 0.92),
    stepERouting: RULE_SECTION(
      stepsAndRoutes.length
        ? stepsAndRoutes.map((s) => ({ step: s.step, route: s.route }))
        : [{ step: "Non determinabile da zip", route: "Non determinabile da zip" }],
      0.78,
    ),
    mappingERegole: FILE_SECTION(
      ensureNonEmpty([
        ...mappingRules,
        ...mappingLinks,
        ...parsed.mmaps.flatMap((m) => m.targetMessages.map((msg) => `${m.name}: target ${msg}`)),
      ]),
      parsed.mmaps.length ? 0.86 : 0.4,
    ),
    arricchimenti: RULE_SECTION(enrichmentHints, parsed.groovyScripts.length ? 0.85 : 0.4),
    output: FILE_SECTION(
      ensureNonEmpty([
        ...outputs,
        ...parsed.mmaps.flatMap((m) => m.targetMessages),
      ]),
      outputs.length ? 0.85 : 0.35,
    ),
    dipendenze: FILE_SECTION(ensureNonEmpty(dependencies), dependencies.length ? 0.88 : 0.4),
    assunzioniEGap: RULE_SECTION(
      gaps.length ? gaps : ["Nessun gap critico rilevato deterministicamente"],
      gaps.length ? 0.7 : 0.9,
    ),
  };
};

const buildTemplateContext = (parsed: ParsedZipArtifacts, model: CanonicalModel, locale: LocaleMessages) => {
  const ingressi = describeInputs(parsed, model);
  const trasformazioni = describeTransformations(parsed, model);
  const mapping = describeMappingDetails(parsed);
  const xmlCsv = describeXmlToCsv(parsed);
  const output = describeOutput(parsed, model);
  const errori = describeErrorHandling(parsed);
  const parametri = describeParameters(parsed);
  const dipendenze = describeFiles(parsed);
  const sequence = model.stepERouting.data.slice(0, 20).map((step, index) => `${index + 1}. ${step.step} -> ${step.route}`);
  const references = renderReferences(parsed, model.artifact.data.name);
  const mermaid = buildMermaidFlow(model);

  return {
    sections: locale.docs.sections,
    labels: locale.docs.labels,
    artifact: model.artifact.data,
    inputs: ingressi,
    transformations: trasformazioni,
    mapping,
    xmlCsv,
    output,
    errorHandling: errori,
    parameters: parametri,
    dependencies: dipendenze,
    sequence,
    references,
    mermaid,
    processes: model.processi.data,
    provenance: model.artifact.provenance,
    confidence: ((model.ingressi.confidence + model.mappingERegole.confidence + model.output.confidence) / 3).toFixed(2),
    gaps: model.assunzioniEGap.data.join("; "),
    gapsList: model.assunzioniEGap.data,
    qualityScore: ((model.ingressi.confidence + model.processi.confidence + model.output.confidence) / 3).toFixed(2),
    warningsSummary: parsed.warnings.length ? parsed.warnings.map((warning) => warning.code).join(", ") : "none",
    checklist: [
      "Verificare ingressi JMS e HTTPS/manuale nel package.",
      "Leggere la sequenza end-to-end e identificare il punto di decisione principale.",
      "Verificare mapping principale, script custom e schemi XSD.",
      "Verificare i parametri runtime e mascherare i valori sensibili prima di condividerli.",
      "Verificare il receiver interno ProcessDirect o il canale finale equivalente.",
    ],
    tests: [
      "Un caso nominale con payload valido.",
      "Un caso con payload vuoto o non valido per verificare il ramo di controllo.",
      "Verifica mapping campi e conversione XML/CSV sui record principali.",
      "Verifica che gli output generati contengano input, trasformazioni, arricchimenti e destinazione finale.",
    ],
    bestPractices: [
      "Verificare variabili ambiente e parametri prima del deploy.",
      "Confrontare quality gate e warnings prima di condividere il documento.",
      "Identificare il consumer finale di eventuali ProcessDirect interni.",
    ],
    flowSummary: locale.docs.text.flowSummary ?? "Vista sintetica del percorso principale:",
  };
};

const createDocuments = async (
  parsed: ParsedZipArtifacts,
  model: CanonicalModel,
  language: LanguageCode,
  templateIds: DocumentTemplateId[],
  mode: GenerationMode,
): Promise<{ documents: GeneratedDocument[]; aiReport: GenerationResult["aiReport"] }> => {
  const locale = getLocaleMessages(language);
  const context = buildTemplateContext(parsed, model, locale);

  const introByTemplate: Record<DocumentTemplateId, string> = {
    technical: locale.docs.text.technicalIntro,
    functional: locale.docs.text.functionalIntro,
    handover: locale.docs.text.handoverIntro,
    audit: locale.docs.text.auditIntro,
    training: locale.docs.text.trainingIntro,
  };

  const documents = templateIds.map((templateId) => {
    const template = compileTemplate(templateId);
    const title = `${model.artifact.data.name} - ${locale.ui.templates[templateId]}`;
    const markdown = template({
      ...context,
      title,
      intro: introByTemplate[templateId].replace("{{inputs}}", context.inputs.join("; ") || "n/a"),
    });

    return {
      name: locale.ui.docFileNames[templateId],
      markdown,
      html: markdownToHtml(markdown),
      templateId,
      displayName: locale.ui.templates[templateId],
      language,
      mode,
    } satisfies GeneratedDocument;
  });

  const enhancer = new AIDocumentEnhancer();
  const enhanced = await enhancer.enhanceDocuments(documents, locale, language, mode);

  return {
    documents: enhanced.documents.map((document) => ({
      ...document,
      html: markdownToHtml(document.markdown),
    })),
    aiReport: enhanced.report,
  };
};

const buildFlowGraph = (parsed: ParsedZipArtifacts): FlowGraph => {
  const nodes: FlowGraph["nodes"] = [];
  const edges: FlowGraph["edges"] = [];
  const channels: FlowGraph["channels"] = [];

  for (const iflow of parsed.iflows) {
    for (const element of iflow.flowElements) {
      if (!element.id) {
        continue;
      }
      nodes.push({
        id: element.id,
        label: element.name || element.id,
        type: element.tag,
        processId: element.processId,
        source: "iflow",
      });
    }

    for (const route of iflow.routes) {
      edges.push({
        id: `${route.from}->${route.to}:${route.condition || ""}`,
        from: route.from,
        to: route.to,
        label: route.condition,
        source: "iflow",
      });
    }

    for (const channel of iflow.channels) {
      channels.push({
        id: channel.id,
        name: channel.name,
        direction: channel.direction,
        componentType: channel.componentType,
        endpoint: channel.endpoint,
        queueName: channel.queueName,
        urlPath: channel.urlPath,
        processRef: channel.processRef,
      });

      nodes.push({
        id: `channel:${channel.id}`,
        label: channel.name,
        type: `channel:${channel.componentType}`,
        processId: channel.processRef,
        source: "channel",
      });
    }
  }

  return {
    nodes: Array.from(new Map(nodes.map((node) => [node.id, node])).values()),
    edges: Array.from(new Map(edges.map((edge) => [edge.id, edge])).values()),
    channels: Array.from(new Map(channels.map((channel) => [channel.id, channel])).values()),
  };
};

const evaluateQualityGate = (
  documents: GeneratedDocument[],
  model: CanonicalModel,
  selectedTemplateIds: DocumentTemplateId[],
): QualityGateReport => {
  const checks: QualityGateReport["checks"] = [];

  const byTemplate = (templateId: DocumentTemplateId) =>
    documents.find((document) => document.templateId === templateId)?.markdown ?? "";
  const technical = byTemplate("technical");
  const functional = byTemplate("functional");
  const handover = byTemplate("handover");

  checks.push({
    id: "docs_presence",
    passed: selectedTemplateIds.every((templateId) => Boolean(byTemplate(templateId))),
    message: "Tutti i documenti selezionati devono essere generati.",
  });

  const headingCount = (markdown: string) => (markdown.match(/^##\s+/gm) ?? []).length;

  checks.push({
    id: "technical_sections",
    passed: !selectedTemplateIds.includes("technical") || headingCount(technical) >= 6,
    message: "Il documento tecnico deve contenere le sezioni minime richieste.",
  });

  checks.push({
    id: "handover_sections",
    passed: !selectedTemplateIds.includes("handover") || headingCount(handover) >= 5,
    message: "Il documento handover deve contenere checklist, test e sezioni operative.",
  });

  checks.push({
    id: "functional_sections",
    passed: !selectedTemplateIds.includes("functional") || Boolean(functional),
    message: "Il documento funzionale deve essere valorizzato quando selezionato.",
  });

  checks.push({
    id: "canonical_minimum",
    passed:
      model.processi.data.length > 0 &&
      model.stepERouting.data.length > 0 &&
      model.output.data.length > 0 &&
      model.mappingERegole.data.length > 0,
    message: "Il modello canonico deve contenere processo, routing, output e mapping non vuoti.",
  });

  const passedCount = checks.filter((check) => check.passed).length;
  const score = checks.length === 0 ? 0 : Number((passedCount / checks.length).toFixed(2));

  return {
    passed: checks.every((check) => check.passed),
    score,
    checks,
  };
};

export const generateFromZipBuffer = async (
  zipBuffer: Buffer,
  options: GenerateDocumentsOptions = {},
): Promise<GenerationResult> => {
  const parsed = parseZipArtifacts(zipBuffer);
  let canonicalModel = buildCanonicalModel(parsed);

  // Apply semantic enrichment with AI (optional, fallback to deterministic)
  const enrichedModel = await enrichCanonicalModelWithAI(parsed, canonicalModel);
  if (enrichedModel) {
    canonicalModel = enrichedModel;
  }

  const locale = options.language ?? "it";
  const mode = options.mode ?? "deterministic";
  const selectedTemplateIds = options.templateIds?.length ? options.templateIds : defaultTemplateIds;
  const { documents, aiReport } = await createDocuments(parsed, canonicalModel, locale, selectedTemplateIds, mode);
  const flowGraph = buildFlowGraph(parsed);
  const qualityGate = evaluateQualityGate(documents, canonicalModel, selectedTemplateIds);

  if (!qualityGate.passed) {
    throw new AppError(
      "QUALITY_GATE_FAILED",
      "La documentazione generata non supera il quality gate minimo.",
      422,
      "Controlla le sezioni minime richieste nei documenti e la completezza del package iFlow.",
    );
  }

  return {
    canonicalModel,
    documents,
    warnings: parsed.warnings,
    flowGraph,
    qualityGate,
    locale,
    mode,
    selectedTemplateIds,
    aiReport,
  };
};
