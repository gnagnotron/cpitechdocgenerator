import { AppError } from "../errors.ts";
import { logWarning } from "../logger.ts";
import { parseIflw } from "../parsers/iflw.ts";
import { parseMmap } from "../parsers/mmap.ts";
import { parseManifest, parseParameterDefinitions, parseProperties } from "../parsers/text.ts";
import { readZipEntries } from "../parsers/zip.ts";
import { fileParserPlugins } from "../plugins/registry.ts";
import type {
  CanonicalModel,
  FlowGraph,
  GeneratedDocument,
  GenerationResult,
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

const buildMermaidFlow = (model: CanonicalModel) => {
  const lines = model.stepERouting.data.slice(0, 12).map((step, index) => {
    const fromId = `N${index}`;
    const toId = `N${index + 1}`;
    const fromLabel = step.step.replace(/\|/g, " ");
    const toLabel = (step.route || "Fine").replace(/\|/g, " ");
    return `  ${fromId}[${fromLabel}] --> ${toId}[${toLabel}]`;
  });

  if (lines.length === 0) {
    return "flowchart LR\n  A[Non determinabile da zip] --> B[Fine]";
  }

  return ["flowchart LR", ...lines].join("\n");
};

const renderReferences = (parsed: ParsedZipArtifacts) => {
  const refs = unique([
    "META-INF/MANIFEST.MF",
    "metainfo.prop",
    ...parsed.iflows.map((iflow) => `integrationflow/${iflow.name || iflow.id}.iflw`),
    ...parsed.mmaps.map((mapping) => `mapping/${mapping.name}.mmap`),
    ...parsed.xsds.map((xsd) => xsd.fileName),
    ...parsed.groovyScripts,
  ]);

  return refs.length > 0 ? refs.slice(0, 15).map((ref) => `- ${ref}`) : ["- Non determinabile da zip"];
};

const markdownToHtml = (markdown: string) => {
  const lines = markdown.split("\n");
  const blocks: string[] = [];
  let inCode = false;
  let codeLang = "";
  let codeBuffer: string[] = [];
  let listType: "ul" | "ol" | null = null;

  const closeList = () => {
    if (listType) {
      blocks.push(`</${listType}>`);
      listType = null;
    }
  };

  const formatInline = (value: string) => {
    let formatted = escapeHtml(value);
    formatted = formatted.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    formatted = formatted.replace(/`([^`]+)`/g, "<code>$1</code>");
    return formatted;
  };

  for (const raw of lines) {
    const line = raw.trimEnd();

    if (line.startsWith("```") && !inCode) {
      closeList();
      inCode = true;
      codeLang = line.slice(3).trim().toLowerCase();
      codeBuffer = [];
      continue;
    }

    if (line.startsWith("```") && inCode) {
      const escapedCode = escapeHtml(codeBuffer.join("\n"));
      if (codeLang === "mermaid") {
        blocks.push(`<pre class=\"mermaid\">${escapedCode}</pre>`);
      } else {
        blocks.push(`<pre><code>${escapedCode}</code></pre>`);
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

    if (!line) {
      closeList();
      continue;
    }

    if (line.startsWith("### ")) {
      closeList();
      blocks.push(`<h3>${formatInline(line.slice(4))}</h3>`);
      continue;
    }
    if (line.startsWith("## ")) {
      closeList();
      blocks.push(`<h2>${formatInline(line.slice(3))}</h2>`);
      continue;
    }
    if (line.startsWith("# ")) {
      closeList();
      blocks.push(`<h1>${formatInline(line.slice(2))}</h1>`);
      continue;
    }

    if (/^\d+\.\s+/.test(line)) {
      if (listType !== "ol") {
        closeList();
        blocks.push("<ol>");
        listType = "ol";
      }
      blocks.push(`<li>${formatInline(line.replace(/^\d+\.\s+/, ""))}</li>`);
      continue;
    }

    if (line.startsWith("- ")) {
      if (listType !== "ul") {
        closeList();
        blocks.push("<ul>");
        listType = "ul";
      }
      blocks.push(`<li>${formatInline(line.slice(2))}</li>`);
      continue;
    }

    closeList();
    blocks.push(`<p>${formatInline(line)}</p>`);
  }

  closeList();

  return `<!doctype html><html lang=\"it\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>Documento</title><style>:root{--bg:#f7f8fb;--card:#fff;--text:#1f2937;--muted:#4b5563;--accent:#0b5fff;--border:#e5e7eb;--code-bg:#f3f4f6;}*{box-sizing:border-box;}body{margin:0;font-family:Segoe UI,Tahoma,Geneva,Verdana,sans-serif;color:var(--text);background:linear-gradient(180deg,#eef2ff 0%,var(--bg) 35%,var(--bg) 100%);line-height:1.65;}.container{max-width:980px;margin:32px auto;padding:0 20px;}article{background:var(--card);border:1px solid var(--border);border-radius:14px;padding:28px;box-shadow:0 6px 18px rgba(15,23,42,.06);}h1,h2,h3{line-height:1.25;margin-top:1.3em;margin-bottom:.5em;}h1{margin-top:0;font-size:1.9rem;}h2{font-size:1.35rem;border-bottom:1px solid var(--border);padding-bottom:.25rem;}h3{font-size:1.08rem;}p,li{color:var(--text);}ul,ol{padding-left:1.25rem;}code{background:var(--code-bg);border:1px solid var(--border);border-radius:6px;padding:.1rem .35rem;font-family:Consolas,Courier New,monospace;font-size:.92em;}pre{background:#111827;color:#f9fafb;border-radius:10px;padding:14px;overflow-x:auto;}a{color:var(--accent);text-decoration:none;}a:hover{text-decoration:underline;}</style></head><body><div class=\"container\"><article>${blocks.join("\n")}</article></div></body></html>`;
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

const createDocuments = (parsed: ParsedZipArtifacts, model: CanonicalModel): GeneratedDocument[] => {
  const ingressi = describeInputs(parsed, model);
  const trasformazioni = describeTransformations(parsed, model);
  const mapping = describeMappingDetails(parsed);
  const xmlCsv = describeXmlToCsv(parsed);
  const output = describeOutput(parsed, model);
  const errori = describeErrorHandling(parsed);
  const parametri = describeParameters(parsed);
  const dipendenze = describeFiles(parsed);
  const sequence = model.stepERouting.data.slice(0, 20).map((step, index) => `${index + 1}. ${step.step} -> ${step.route}`);
  const references = renderReferences(parsed);
  const mermaid = buildMermaidFlow(model);

  const technicalMd = [
    `# ${model.artifact.data.name} - Documento Tecnico`,
    "## 1) Obiettivo del flusso e architettura logica",
    `Questo Integration Flow riceve input dai canali ${ingressi.join("; ")} e produce output verso i receiver configurati nel package. La logica è estratta in modo deterministico dal contenuto dello zip, ma raccontata in forma operativa per facilitare il passaggio di consegne.`,
    `Artifact: ${model.artifact.data.name}`,
    `Versione: ${model.artifact.data.version}`,
    `Vendor / bundle: ${model.artifact.data.vendor}`,
    "### Processi principali",
    ...model.processi.data.map((process) => `- Processo: ${process}`),
    "## 2) Ingressi del flusso",
    "Questa sezione descrive cosa entra davvero nel flusso e come può essere attivato in runtime.",
    ...ingressi.map((input) => `- Input: ${input}`),
    "## 3) Flusso end-to-end",
    "Vista sintetica del percorso principale:",
    "```mermaid",
    mermaid,
    "```",
    "Sequenza operativa dettagliata:",
    ...sequence,
    "## 4) Trasformazioni e arricchimenti",
    "Qui sono elencati mapping, script e passaggi che alterano il payload o arricchiscono il contesto.",
    ...trasformazioni.map((item) => `- ${item}`),
    "## 5) Mapping dettagliato verso target",
    ...mapping.map((item) => `- ${item}`),
    "## 6) Conversione XML -> CSV",
    ...xmlCsv.map((item) => `- ${item}`),
    "## 7) Output finale e naming file",
    ...output.map((item) => `- ${item}`),
    "## 8) Dipendenze",
    ...dipendenze.map((item) => `- ${item}`),
    ...parametri.map((item) => `- Parametro: ${item}`),
    "## 9) Gestione errori e comportamento",
    ...errori.map((item) => `- ${item}`),
    "## 10) Provenance e affidabilità",
    `- Provenance: ${model.artifact.provenance}`,
    `- Provenance complessiva: ${model.processi.provenance}`,
    `- Confidence media delle sezioni chiave: ${((model.ingressi.confidence + model.mappingERegole.confidence + model.output.confidence) / 3).toFixed(2)}`,
    `- Gap residui: ${model.assunzioniEGap.data.join("; ")}`,
    "## 11) Mappa file utili",
    ...references,
  ].join("\n");

  const functionalMd = [
    `# ${model.artifact.data.name} - Documento Funzionale`,
    "## 1. Obiettivo business",
    `Il flusso trasferisce dati dal sistema sorgente al target traducendo il payload in un formato utilizzabile a valle. L'obiettivo non è solo tecnico: garantire coerenza del dato e prevedibilità del comportamento operativo.`,
    "## 2. Ingressi funzionali",
    ...ingressi.map((input) => `- ${input}`),
    "## 3. Comportamento funzionale",
    "Dal punto di vista business, il flusso valida la presenza del contenuto utile e decide se proseguire o chiudere il processo.",
    ...model.processi.data.map((process) => `- ${process}`),
    "Passi principali (lettura rapida):",
    ...sequence.slice(0, 12),
    "## 4. Trasformazioni e arricchimenti",
    ...trasformazioni.map((item) => `- ${item}`),
    "## 5. Mapping verso target (vista funzionale)",
    ...mapping.map((item) => `- ${item}`),
    "## 6. Conversione XML -> CSV (vista funzionale)",
    ...xmlCsv.map((item) => `- ${item}`),
    "## 7. Output funzionale",
    ...output.map((item) => `- ${item}`),
    "## 7. Cosa deve sapere chi prende in carico il flusso",
    "- Le dipendenze esterne e i parametri runtime sono documentati e possono cambiare in base all'ambiente.",
    "- La presenza di controlli su payload vuoto impatta i volumi realmente inoltrati.",
    "- Se manca un file critico il flusso viene considerato non documentabile e la pipeline si ferma con errore esplicito.",
    "- Le sezioni incerte riportano sempre 'Non determinabile da zip'.",
    "## 8. Affidabilità e completezza",
    `- Provenance: ${model.artifact.provenance}`,
    `- Provenance funzionale: ${model.artifact.provenance}`,
    `- Confidence media: ${((model.ingressi.confidence + model.arricchimenti.confidence + model.output.confidence) / 3).toFixed(2)}`,
    "## 9. Riferimenti per approfondimento",
    ...references,
  ].join("\n");

  const handoverMd = [
    `# ${model.artifact.data.name} - Documento Handover / Onboarding`,
    "## 1) Obiettivo del flusso e architettura logica",
    "Questa guida e pensata per chi prende in carico il flusso senza averlo sviluppato. Le informazioni sono ordinate per passare rapidamente da comprensione a operativita.",
    `Artifact: ${model.artifact.data.name}`,
    `Versione: ${model.artifact.data.version}`,
    ...model.processi.data.map((process) => `- Processo: ${process}`),
    "## 2) Ingressi (es. JMS + HTTPS manuale)",
    ...ingressi.map((input) => `- ${input}`),
    "## 3) Trasformazioni e arricchimenti",
    ...trasformazioni.map((item) => `- ${item}`),
    "## 4) Mapping dettagliato dei campi verso target",
    ...mapping.map((item) => `- ${item}`),
    "## 5) Conversione XML -> CSV",
    ...xmlCsv.map((item) => `- ${item}`),
    "## 6) Output finale e naming file",
    ...output.map((item) => `- ${item}`),
    "## 7) Dipendenze (script, ProcessDirect, mapping)",
    ...dipendenze.map((item) => `- ${item}`),
    ...parametri.map((item) => `- ${item}`),
    "## 8) Checklist operativa",
    "- Verificare ingressi JMS e HTTPS/manuale nel package.",
    "- Leggere la sequenza end-to-end e identificare il punto di decisione principale (gateway/condition).",
    "- Verificare mapping principale, script custom e schemi XSD.",
    "- Verificare i parametri runtime e mascherare i valori sensibili prima di condividerli.",
    "- Verificare il receiver interno ProcessDirect o il canale finale equivalente.",
    "## 9) Sequenza operativa da leggere in iFlow",
    "```mermaid",
    mermaid,
    "```",
    ...sequence,
    "## 10) Open points e gap",
    ...model.assunzioniEGap.data.map((gap) => `- ${gap}`),
    "## 11) Test minimi consigliati",
    "- Un caso nominale con payload valido.",
    "- Un caso con payload vuoto o non valido per verificare il ramo di controllo.",
    "- Verifica mapping campi e conversione XML/CSV sui record principali.",
    "- Verifica che gli output generati contengano input, trasformazioni, arricchimenti e destinazione finale.",
    "## 12) Provenance e affidabilità",
    `- Provenance: ${model.artifact.provenance}`,
    "## 13) Mappa file utili",
    ...references,
  ].join("\n");

  const docs: Array<{ name: string; markdown: string }> = [
    { name: "documento-tecnico", markdown: technicalMd },
    { name: "documento-funzionale", markdown: functionalMd },
    { name: "documento-handover", markdown: handoverMd },
  ];

  return docs.map((d) => ({
    name: d.name,
    markdown: d.markdown,
    html: markdownToHtml(d.markdown),
  }));
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

const evaluateQualityGate = (documents: GeneratedDocument[], model: CanonicalModel): QualityGateReport => {
  const checks: QualityGateReport["checks"] = [];

  const byName = (name: string) => documents.find((document) => document.name === name)?.markdown ?? "";
  const technical = byName("documento-tecnico");
  const functional = byName("documento-funzionale");
  const handover = byName("documento-handover");

  checks.push({
    id: "docs_presence",
    passed: Boolean(technical && functional && handover),
    message: "Tutti e 3 i documenti devono essere generati.",
  });

  const requiredTechnical = [
    "Obiettivo del flusso",
    "Ingressi del flusso",
    "Trasformazioni e arricchimenti",
    "Mapping dettagliato",
    "Conversione XML -> CSV",
    "Output finale e naming file",
  ];
  checks.push({
    id: "technical_sections",
    passed: requiredTechnical.every((section) => technical.includes(section)),
    message: "Il documento tecnico deve contenere le sezioni minime richieste.",
  });

  const requiredHandover = [
    "Checklist operativa",
    "Test minimi consigliati",
    "Ingressi (es. JMS + HTTPS manuale)",
    "Output finale e naming file",
  ];
  checks.push({
    id: "handover_sections",
    passed: requiredHandover.every((section) => handover.includes(section)),
    message: "Il documento handover deve contenere checklist, test e sezioni operative.",
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

export const generateFromZipBuffer = (zipBuffer: Buffer): GenerationResult => {
  const parsed = parseZipArtifacts(zipBuffer);
  const canonicalModel = buildCanonicalModel(parsed);
  const documents = createDocuments(parsed, canonicalModel);
  const flowGraph = buildFlowGraph(parsed);
  const qualityGate = evaluateQualityGate(documents, canonicalModel);

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
  };
};
