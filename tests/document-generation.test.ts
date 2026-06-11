import test from "node:test";
import assert from "node:assert/strict";
import { createZipBuffer } from "../src/lib/parsers/zip.ts";
import { generateFromZipBuffer } from "../src/lib/pipeline/generate.ts";

test("generation pipeline returns three documents and canonical model", async () => {
  const zip = createZipBuffer([
    {
      fileName: "META-INF/MANIFEST.MF",
      content: "Bundle-Name: Demo\nBundle-Version: 1.0.0\nBundle-Vendor: SAP",
    },
    {
      fileName: "metainfo.prop",
      content: "artifactId=demo-iflow\nversion=1.0.0",
    },
    {
      fileName: "src/main/resources/scenarioflows/integrationflow/demo.iflw",
      content:
        '<integrationflow id="id-1" name="DemoFlow"><sender name="S4" /><receiver name="CRM" /><step id="a" name="Start" type="start" /><route from="a" to="b" /></integrationflow>',
    },
    {
      fileName: "src/main/resources/mapping/demo.mmap",
      content:
        '<mapping name="DemoMap"><sourceMessage name="in" /><targetMessage name="out" /><rule name="r1" /></mapping>',
    },
  ]);

  const result = await generateFromZipBuffer(zip);
  assert.equal(result.documents.length, 3);
  assert.equal(result.canonicalModel.artifact.data.name, "DemoFlow");
  assert.equal(result.documents[0].name, "documento-tecnico");
  assert.match(result.documents[0].markdown, /Provenance:/);
});

test("generation pipeline supports locale template and mode options", async () => {
  const zip = createZipBuffer([
    {
      fileName: "META-INF/MANIFEST.MF",
      content: "Bundle-Name: Demo\nBundle-Version: 1.0.0\nBundle-Vendor: SAP",
    },
    {
      fileName: "metainfo.prop",
      content: "artifactId=demo-iflow\nversion=1.0.0",
    },
    {
      fileName: "src/main/resources/scenarioflows/integrationflow/demo.iflw",
      content:
        '<integrationflow id="id-1" name="DemoFlow"><sender name="S4" /><receiver name="CRM" /><step id="a" name="Start" type="start" /><route from="a" to="b" /></integrationflow>',
    },
    {
      fileName: "src/main/resources/mapping/demo.mmap",
      content:
        '<mapping name="DemoMap"><sourceMessage name="in" /><targetMessage name="out" /><rule name="r1" /></mapping>',
    },
  ]);

  const result = await generateFromZipBuffer(zip, {
    language: "en",
    templateIds: ["technical", "audit"],
    mode: "ai-enhanced",
  });

  assert.equal(result.documents.length, 2);
  assert.equal(result.locale, "en");
  assert.equal(result.selectedTemplateIds.length, 2);
  assert.ok(result.documents[0].name.includes("technical"));
  assert.equal(result.documents[0].templateId, "technical");
  assert.equal(result.mode, "ai-enhanced");
});
