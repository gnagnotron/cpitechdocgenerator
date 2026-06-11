import type { ParsedMmap } from "../types.ts";
import { extractAttributes, extractTags, stripXmlNamespace } from "./text.ts";

export const parseMmap = (xml: string, fileName: string): ParsedMmap => {
  const normalized = stripXmlNamespace(xml);
  const rootMatch = normalized.match(/<xiObj\b[^>]*>/i) ?? normalized.match(/<mapping\b[^>]*>/i);
  const rootAttrs = rootMatch ? extractAttributes(rootMatch[0]) : {};

  const legacySourceTags = extractTags(normalized, "sourceMessage").concat(extractTags(normalized, "source"));
  const legacyTargetTags = extractTags(normalized, "targetMessage").concat(extractTags(normalized, "target"));
  const legacyRuleTags = extractTags(normalized, "rule").concat(
    extractTags(normalized, "mapping").filter((tag) => tag !== rootMatch?.[0]),
  );

  const lnkRoleBlocks = normalized.match(/<lnkRole[\s\S]*?<\/lnkRole>/gi) ?? [];
  const sourceMessages: string[] = [];
  const targetMessages: string[] = [];
  const functionLibraries: string[] = [];
  const links: ParsedMmap["links"] = [];

  for (const block of lnkRoleBlocks) {
    const roleMatch = block.match(/<lnkRole\b[^>]*role="([^"]+)"[^>]*>/i);
    const keyMatch = block.match(/<key\b[^>]*typeID="([^"]*)"[^>]*version="([^"]*)"[^>]*>/i);
    const elemValues = Array.from(block.matchAll(/<elem>([\s\S]*?)<\/elem>/gi)).map((m) => m[1].trim());
    const role = roleMatch?.[1] ?? "unknown";
    const typeId = keyMatch?.[1] ?? "";
    const artifact = elemValues[0] ?? "";
    const path = elemValues[1] ?? "";
    const node = elemValues[2] ?? undefined;
    const namespace = elemValues[3] ?? undefined;

    links.push({ role, typeId, artifact, path, node, namespace });

    if (role === "TARGET_IFR_MESS" && artifact) {
      targetMessages.push(namespace ? `${artifact} (${namespace})` : artifact);
      continue;
    }

    if (role === "SOURCE_IFR_MESS" && artifact) {
      sourceMessages.push(namespace ? `${artifact} (${namespace})` : artifact);
      continue;
    }

    if (role === "UsedFuncLib" && artifact) {
      functionLibraries.push(artifact);
    }
  }

  for (const tag of legacySourceTags) {
    const attrs = extractAttributes(tag);
    const value = attrs.name ?? attrs.id;
    if (value) {
      sourceMessages.push(value);
    }
  }

  for (const tag of legacyTargetTags) {
    const attrs = extractAttributes(tag);
    const value = attrs.name ?? attrs.id;
    if (value) {
      targetMessages.push(value);
    }
  }

  for (const tag of legacyRuleTags) {
    const attrs = extractAttributes(tag);
    const value = attrs.name ?? attrs.id ?? attrs.expression;
    if (value) {
      links.push({ role: "rule", typeId: "", artifact: value, path: "", node: undefined, namespace: undefined });
    }
  }

  const rules = links
    .map((link) => link.artifact || link.node || link.role)
    .concat(
      legacyRuleTags
        .map((tag) => {
          const attrs = extractAttributes(tag);
          return attrs.name ?? attrs.id ?? attrs.expression;
        })
        .filter((value): value is string => Boolean(value)),
    );

  return {
    name: rootAttrs.name ?? fileName,
    sourceMessages: Array.from(new Set(sourceMessages)),
    targetMessages: Array.from(new Set(targetMessages)),
    rules: Array.from(new Set(rules)),
    functionLibraries: Array.from(new Set(functionLibraries)),
    links,
  };
};
