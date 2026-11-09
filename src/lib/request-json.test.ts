import { describe, expect, it } from "vitest";
import { readJsonObject } from "./request-json";

const req = (body: string | null) =>
  new Request("https://example.invalid/x", { method: "POST", ...(body === null ? {} : { body }) });

describe("readJsonObject", () => {
  it("returns a JSON object body", async () => {
    expect(await readJsonObject(req('{"title":"x","n":1}'))).toEqual({ title: "x", n: 1 });
    expect(await readJsonObject(req("{}"))).toEqual({});
  });

  it("is null for malformed JSON, an empty body or a non-object", async () => {
    for (const body of ["{", "not json", "", null, "[]", "[1]", "null", "3", '"text"', "true"]) {
      expect(await readJsonObject(req(body))).toBeNull();
    }
  });
});
