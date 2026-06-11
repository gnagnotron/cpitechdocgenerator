import test from "node:test";
import assert from "node:assert/strict";
import { parseIflw } from "../src/lib/parsers/iflw.ts";

test("parseIflw extracts core metadata and routing", () => {
  const xml = `
    <integrationflow id="iflw-1" name="OrderFlow" version="1.0.0">
      <sender name="S4" />
      <receiver name="SFDC" />
      <step id="s1" name="Start" type="start" />
      <step id="s2" name="Map" type="mapping" />
      <route from="s1" to="s2" condition="always" />
    </integrationflow>
  `;

  const parsed = parseIflw(xml);
  assert.equal(parsed.name, "OrderFlow");
  assert.equal(parsed.id, "iflw-1");
  assert.deepEqual(parsed.senderSystems, ["S4"]);
  assert.deepEqual(parsed.receiverSystems, ["SFDC"]);
  assert.equal(parsed.steps.length, 2);
  assert.equal(parsed.routes[0].from, "s1");
});
