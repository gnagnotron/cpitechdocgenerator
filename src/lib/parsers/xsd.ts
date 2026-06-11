import type { ParsedXsd } from "../types.ts";
import { extractAttributes, extractTags } from "./text.ts";

export const parseXsd = (xml: string, fileName: string): ParsedXsd => {
  const elementTags = extractTags(xml, "xsd:element").concat(extractTags(xml, "element"));
  const complexTypeTags = extractTags(xml, "xsd:complexType").concat(
    extractTags(xml, "complexType"),
  );

  const elements = elementTags
    .map((tag) => extractAttributes(tag).name)
    .filter((v): v is string => Boolean(v));

  const complexTypes = complexTypeTags
    .map((tag) => extractAttributes(tag).name)
    .filter((v): v is string => Boolean(v));

  return {
    fileName,
    elements: Array.from(new Set(elements)),
    complexTypes: Array.from(new Set(complexTypes)),
  };
};
