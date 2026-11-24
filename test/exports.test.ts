import { Schema } from "effect";
import { describe, expect, expectTypeOf, it } from "vitest";

import type {
  EffectClient,
  EffectMatchOptions,
  EffectPluginConfig,
  EffectSchemaDecoder,
  EffectSchemaOptions,
} from "../dist/index.js";

const built = await import("../dist/index.js");

const publicFunctions = [
  "effectSchemaPlugin",
  "effectSchemaDecoder",
  "effectMatchPlugin",
  "effectMatchStrategy",
  "effectPlugin",
  "toEffect",
  "effectClient",
] as const;

describe("built package exports", () => {
  it("exposes every public function at runtime", () => {
    for (const name of publicFunctions) {
      expect(typeof built[name]).toBe("function");
    }
  });

  it("does not require a result backend export", () => {
    const resultExports = Object.keys(built).filter((name) =>
      /result/i.test(name),
    );
    expect(resultExports).toEqual([]);

    expect(built.effectSchemaPlugin(Schema.String).result).toBeUndefined();
    expect(built.effectMatchPlugin().result).toBeUndefined();
    expect(built.effectPlugin({ match: true }).result).toBeUndefined();
  });

  it("exports the public types", () => {
    type PublicTypes = [
      EffectSchemaOptions,
      EffectMatchOptions,
      EffectSchemaDecoder<unknown>,
      EffectPluginConfig<unknown>,
      EffectClient<object>,
    ];

    expectTypeOf<PublicTypes>().toBeArray();
  });
});
