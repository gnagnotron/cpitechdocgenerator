import test from "node:test";
import assert from "node:assert/strict";
import { parseMmap } from "../src/lib/parsers/mmap.ts";

test("parseMmap extracts source, target and rules", () => {
  const xml = `
    <mapping name="OrderMap">
      <sourceMessage name="OrderIn" />
      <targetMessage name="OrderOut" />
      <rule name="mapCustomer" />
    </mapping>
  `;

  const parsed = parseMmap(xml, "OrderMap.mmap");
  assert.equal(parsed.name, "OrderMap");
  assert.deepEqual(parsed.sourceMessages, ["OrderIn"]);
  assert.deepEqual(parsed.targetMessages, ["OrderOut"]);
  assert.deepEqual(parsed.rules, ["mapCustomer"]);
});
