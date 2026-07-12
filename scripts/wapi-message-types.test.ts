import assert from "node:assert/strict";
import test from "node:test";
import { toWapiWirePayload } from "../src/lib/whatsapp/wapi-message-types.ts";

test("omits pollMaxOptions for single-choice polls", () => {
  assert.deepEqual(
    toWapiWirePayload("poll", {
      message: "Pergunta",
      poll: ["A", "B"],
      pollMaxOptions: 1,
    }),
    { message: "Pergunta", poll: ["A", "B"] },
  );
});

test("keeps pollMaxOptions for multiple-choice polls", () => {
  assert.deepEqual(
    toWapiWirePayload("poll", {
      message: "Pergunta",
      poll: ["A", "B", "C"],
      pollMaxOptions: 2,
    }),
    {
      message: "Pergunta",
      poll: ["A", "B", "C"],
      pollMaxOptions: 2,
    },
  );
});

test("does not mutate the stored payload", () => {
  const payload = {
    message: "Pergunta",
    poll: ["A", "B"],
    pollMaxOptions: 1,
  };
  toWapiWirePayload("poll", payload);
  assert.equal(payload.pollMaxOptions, 1);
});
