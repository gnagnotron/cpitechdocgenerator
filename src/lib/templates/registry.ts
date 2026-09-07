import { readFileSync } from "node:fs";
import { join } from "node:path";
import Handlebars from "handlebars";
const templateFileNames = {
  technical: "technical.hbs",
} as const;

const loadTemplateSource = (templateId: keyof typeof templateFileNames) =>
  readFileSync(join(process.cwd(), "templates", templateFileNames[templateId]), "utf8");

export const compileTemplate = (templateId: keyof typeof templateFileNames) => Handlebars.compile(loadTemplateSource(templateId));

export const getTemplateSource = (templateId: keyof typeof templateFileNames) => loadTemplateSource(templateId);
