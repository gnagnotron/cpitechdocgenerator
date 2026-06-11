import type { ParsedIflw } from "../types.ts";
import { XMLParser } from "fast-xml-parser";

const localName = (name: string) => {
  const idx = name.indexOf(":");
  return idx >= 0 ? name.slice(idx + 1) : name;
};

const toArray = <T>(value: T | T[] | undefined): T[] => {
  if (value === undefined) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
};

const pickFirst = (attrs: Record<string, string>, keys: string[], fallback: string) => {
  for (const key of keys) {
    const direct = attrs[key];
    if (direct) {
      return direct;
    }

    const alt = attrs[`ifl:${key}`];
    if (alt) {
      return alt;
    }
  }
  return fallback;
};

const getText = (value: unknown): string => {
  if (value === undefined || value === null) {
    return "";
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value).trim();
  }
  if (Array.isArray(value)) {
    return getText(value[0]);
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if ("#text" in obj) {
      return getText(obj["#text"]);
    }
  }
  return "";
};

const extractPropertyMap = (node: Record<string, unknown>): Record<string, string> => {
  const result: Record<string, string> = {};

  const extensionKey = Object.keys(node).find((key) => localName(key) === "extensionElements");
  if (!extensionKey) {
    return result;
  }

  const extEntries = toArray(node[extensionKey]);
  for (const ext of extEntries) {
    if (!ext || typeof ext !== "object") {
      continue;
    }
    const extObj = ext as Record<string, unknown>;

    const propertyKey = Object.keys(extObj).find((key) => localName(key) === "property");
    if (!propertyKey) {
      continue;
    }

    for (const propertyItem of toArray(extObj[propertyKey])) {
      if (!propertyItem || typeof propertyItem !== "object") {
        continue;
      }

      const propertyObj = propertyItem as Record<string, unknown>;
      const keyNode = Object.keys(propertyObj).find((key) => localName(key) === "key");
      const valueNode = Object.keys(propertyObj).find((key) => localName(key) === "value");
      const key = keyNode ? getText(propertyObj[keyNode]) : "";
      const value = valueNode ? getText(propertyObj[valueNode]) : "";

      if (key) {
        result[key] = value;
      }
    }
  }

  return result;
};

const parseAttrs = (node: Record<string, unknown>) => {
  const attrs: Record<string, string> = {};
  for (const [key, value] of Object.entries(node)) {
    if (!key.startsWith("@_")) {
      continue;
    }
    const attrName = key.slice(2);
    attrs[attrName] = getText(value);
  }
  return attrs;
};

export const parseIflw = (xml: string, fileName?: string): ParsedIflw => {
  const parser = new XMLParser({
    ignoreAttributes: false,
    trimValues: true,
    attributeNamePrefix: "@_",
    parseTagValue: true,
  });

  const parsedXml = parser.parse(xml) as Record<string, unknown>;

  const flowElements: ParsedIflw["flowElements"] = [];

  const traverse = (tagName: string, node: unknown, parentProcessId?: string) => {
    if (!node || typeof node !== "object") {
      return;
    }

    if (Array.isArray(node)) {
      for (const item of node) {
        traverse(tagName, item, parentProcessId);
      }
      return;
    }

    const obj = node as Record<string, unknown>;
    const attrs = parseAttrs(obj);
    const properties = extractPropertyMap(obj);
    const tag = localName(tagName);
    const processId = tag === "process" ? attrs.id : parentProcessId;

    flowElements.push({
      id: attrs.id || attrs.guid || "",
      name: attrs.name || attrs.label || "",
      tag,
      processId,
      attributes: attrs,
      properties,
    });

    for (const [childKey, childValue] of Object.entries(obj)) {
      if (childKey.startsWith("@_") || childKey === "#text") {
        continue;
      }
      const children = toArray(childValue);
      for (const child of children) {
        if (child && typeof child === "object") {
          traverse(childKey, child, processId);
        }
      }
    }
  };

  for (const [rootKey, rootValue] of Object.entries(parsedXml)) {
    traverse(rootKey, rootValue);
  }

  const uniqueBy = <T>(items: T[], keyFn: (item: T) => string) => {
    const seen = new Set<string>();
    const output: T[] = [];
    for (const item of items) {
      const key = keyFn(item);
      if (!key || seen.has(key)) {
        continue;
      }
      seen.add(key);
      output.push(item);
    }
    return output;
  };

  const processElements = flowElements.filter((element) => element.tag === "process" && element.id);
  const participantElements = flowElements.filter((element) =>
    ["participant", "sender", "senderparticipant", "receiver", "receiverparticipant"].includes(element.tag),
  );

  const participants = uniqueBy(
    participantElements.map((element, idx) => ({
      id: element.id || `participant-${idx + 1}`,
      name: element.name || element.properties.system || "Participant",
      type:
        pickFirst(element.attributes, ["ifl:type", "type"], element.properties["ifl:type"] || "") ||
        (/sender/i.test(element.tag) ? "Sender" : /receiver/i.test(element.tag) ? "Receiver" : "unknown"),
    })),
    (participant) => participant.id,
  );

  const processes = uniqueBy(
    processElements.map((element, idx) => ({
      id: element.id || `process-${idx + 1}`,
      name: element.name || "Integration Process",
    })),
    (process) => process.id,
  );

  const stepTags = new Set([
    "step",
    "callActivity",
    "serviceTask",
    "scriptTask",
    "sendTask",
    "receiveTask",
    "manualTask",
    "userTask",
    "exclusiveGateway",
    "parallelGateway",
    "startEvent",
    "endEvent",
    "subProcess",
  ]);

  const steps = uniqueBy(
    flowElements
      .filter((element) => stepTags.has(element.tag))
      .map((element, idx) => ({
        id: element.id || `${element.tag}-${idx + 1}`,
        name: element.name || `${element.tag} ${idx + 1}`,
        type: element.tag,
      })),
    (step) => step.id,
  );

  const routes = uniqueBy(
    flowElements
      .filter((element) => element.tag === "sequenceFlow" || element.tag === "route")
      .map((element) => ({
        from: pickFirst(element.attributes, ["sourceRef", "source", "from"], "unknown"),
        to: pickFirst(element.attributes, ["targetRef", "target", "to"], "unknown"),
        condition: element.attributes.condition || element.attributes.expression,
      })),
    (route) => `${route.from}->${route.to}:${route.condition || ""}`,
  );

  const senderSystems = uniqueBy(
    participants
      .filter((participant) => /Sender/i.test(participant.type) || /Sender/i.test(participant.name))
      .map((participant) => participant.name),
    (name) => name,
  );

  const receiverSystems = uniqueBy(
    participants
      .filter((participant) => /Receiver/i.test(participant.type) || /Receiver/i.test(participant.name))
      .map((participant) => participant.name),
    (name) => name,
  );

  const channels = uniqueBy(
    participantElements.map((element, idx) => {
      const componentType =
        element.properties.ComponentType || element.properties.Name || pickFirst(element.attributes, ["ifl:type", "type"], "unknown");
      const direction =
        element.properties.direction ||
        (/sender/i.test(componentType) || /sender/i.test(element.tag) ? "Sender" : /receiver/i.test(componentType) || /receiver/i.test(element.tag) ? "Receiver" : "Unknown");

      return {
        id: element.id || `channel-${idx + 1}`,
        name: element.name || element.properties.system || componentType,
        role: element.tag,
        direction,
        componentType,
        system: element.properties.system,
        queueName: element.properties.QueueName_inbound,
        urlPath: element.properties.urlPath,
        endpoint: element.properties.Description,
        processRef: element.attributes.processRef,
        properties: element.properties,
      };
    }),
    (channel) => channel.id,
  );

  const allProperties = uniqueBy(
    flowElements.flatMap((element) =>
      Object.entries(element.properties).map(([key, value]) => ({ key, value })),
    ),
    (property) => `${property.key}:${property.value}`,
  );

  const rootElement = flowElements.find((element) => element.tag === "definitions") ?? flowElements[0];
  const fileBaseName = fileName ? fileName.split("/").pop()?.replace(/\.iflw$/i, "") : "";

  return {
    name:
      rootElement?.attributes.name ||
      fileBaseName ||
      "Non determinabile da zip",
    id: rootElement?.attributes.id || "Non determinabile da zip",
    version: rootElement?.attributes.version,
    properties: allProperties,
    channels,
    flowElements,
    participants,
    processes,
    senderSystems,
    receiverSystems,
    steps,
    routes,
  };
};
