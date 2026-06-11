import { readFileSync } from "node:fs";
import { join } from "node:path";
import Handlebars from "handlebars";
import type { DocumentTemplateId } from "../types.ts";

const templateFileNames: Record<DocumentTemplateId, string> = {
  technical: "technical.hbs",
  functional: "functional.hbs",
  handover: "handover.hbs",
  audit: "audit.hbs",
  training: "training.hbs",
};

const loadTemplateSource = (templateId: DocumentTemplateId) =>
  readFileSync(join(process.cwd(), "templates", templateFileNames[templateId]), "utf8");

export const compileTemplate = (templateId: DocumentTemplateId) => Handlebars.compile(loadTemplateSource(templateId));

export const getTemplateSource = (templateId: DocumentTemplateId) => loadTemplateSource(templateId);
