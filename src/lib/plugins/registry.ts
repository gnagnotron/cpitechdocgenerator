import type { ParsedIflw, ParsedMmap, ParsedXsd } from "../types.ts";
import { parseIflw } from "../parsers/iflw.ts";
import { parseMmap } from "../parsers/mmap.ts";
import { parseXsd } from "../parsers/xsd.ts";

export interface FileParserPlugin<T> {
  matches: (fileName: string) => boolean;
  parse: (content: string, fileName: string) => T;
}

export interface DocumentTemplatePlugin {
  name: string;
  render: (model: unknown) => string;
}

export const fileParserPlugins: Array<FileParserPlugin<ParsedIflw | ParsedMmap | ParsedXsd>> = [
  {
    matches: (fileName) => /src\/main\/resources\/scenarioflows\/integrationflow\/.+\.iflw$/i.test(fileName),
    parse: (content) => parseIflw(content),
  },
  {
    matches: (fileName) => /src\/main\/resources\/mapping\/.+\.mmap$/i.test(fileName),
    parse: (content, fileName) => parseMmap(content, fileName.split("/").pop() ?? fileName),
  },
  {
    matches: (fileName) => /src\/main\/resources\/xsd\/.+\.xsd$/i.test(fileName),
    parse: (content, fileName) => parseXsd(content, fileName.split("/").pop() ?? fileName),
  },
];

export const documentTemplatePlugins: DocumentTemplatePlugin[] = [];
