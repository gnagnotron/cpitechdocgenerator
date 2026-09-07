import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { generateFromZipBuffer } from "../src/lib/pipeline/generate.ts";

const zipDir = join(process.cwd(), "tests", "zipreali");

const cases = [
  "FUN006_7_8_9.zip",
  "FUN010NEW - Orders Notifications.zip",
  "IF33_ListinoPrezzi_SAP_to_Cegid.zip",
];

for (const fileName of cases) {
  test(`real zip generation succeeds for ${fileName}`, async () => {
    const buffer = await readFile(join(zipDir, fileName));
    const result = await generateFromZipBuffer(buffer);

    assert.equal(result.documents.length, 1);
    assert.notEqual(result.canonicalModel.artifact.data.name, "Non determinabile da zip");
    assert.ok(result.canonicalModel.processi.data.length > 0);
    assert.ok(result.canonicalModel.stepERouting.data.length > 0);
    assert.ok(result.documents[0].markdown.includes("Provenance"));
    assert.equal(result.documents[0].templateId, "technical");
    assert.ok(result.documents[0].markdown.includes("Documento Tecnico"));
  });
}
