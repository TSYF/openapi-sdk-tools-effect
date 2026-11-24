import { SdkKernel } from "@openapi-sdk-tools/core";
import { Schema } from "effect";
import { describe, expect, expectTypeOf, it } from "vitest";

import { effectPlugin } from "../src/plugin.js";

const ApiError = Schema.Struct({
  code: Schema.String,
  message: Schema.String,
});

type ApiErrorPayload = Schema.Schema.Type<typeof ApiError>;

describe("effectPlugin", () => {
  it("attaches only the errorDecoder when given a schema", () => {
    const plugin = effectPlugin({ schema: ApiError });
    const kernel = new SdkKernel([plugin]);

    expect(plugin.name).toBe("effect");
    expect(plugin.result).toBeUndefined();
    expect(plugin.match).toBeUndefined();
    expect(plugin.errorDecoder?.name).toBe("effect-schema");

    expect(kernel.errorDecoder?.name).toBe("effect-schema");
    expect(kernel.match.name).toBe("default");
    expect(kernel.result.name).toBe("default");
  });

  it("attaches only the Effect match strategy when match is enabled", () => {
    const plugin = effectPlugin({ match: true });
    const kernel = new SdkKernel([plugin]);

    expect(plugin.name).toBe("effect");
    expect(plugin.result).toBeUndefined();
    expect(plugin.errorDecoder).toBeUndefined();
    expect(plugin.match?.name).toBe("effect-match");

    expect(kernel.errorDecoder).toBeUndefined();
    expect(kernel.match.name).toBe("effect-match");
  });

  it("attaches both capabilities when schema and match are provided", () => {
    const plugin = effectPlugin({ schema: ApiError, match: true });
    const kernel = new SdkKernel([plugin]);

    expect(plugin.result).toBeUndefined();
    expect(kernel.errorDecoder?.name).toBe("effect-schema");
    expect(kernel.match.name).toBe("effect-match");
  });

  it("accepts match options and attaches the Effect strategy", () => {
    const plugin = effectPlugin({
      match: { discriminantKeys: [["kind"]] },
    });
    const kernel = new SdkKernel([plugin]);

    expect(plugin.errorDecoder).toBeUndefined();
    expect(kernel.match.name).toBe("effect-match");
  });

  it("forwards schema options to the error decoder", () => {
    const plugin = effectPlugin({
      schema: ApiError,
      schemaOptions: { onFailure: "error" },
    });

    const decoded = plugin.errorDecoder?.decode({ unexpected: true });

    expect(Schema.isSchemaError(decoded)).toBe(true);
  });

  it("throws a configuration error for an empty config", () => {
    expect(() => effectPlugin({})).toThrow(/at least one capability/i);
  });

  it("throws a configuration error when match is disabled without a schema", () => {
    expect(() => effectPlugin({ match: false })).toThrow(
      /at least one capability/i,
    );
  });

  it("never exposes a result backend", () => {
    const plugins = [
      effectPlugin({ schema: ApiError }),
      effectPlugin({ match: true }),
      effectPlugin({ schema: ApiError, match: true }),
    ];

    for (const plugin of plugins) {
      expect(plugin.result).toBeUndefined();
    }
  });

  it("types match.resolve with the schema output", () => {
    effectPlugin({
      schema: ApiError,
      match: {
        resolve: (error) => {
          expectTypeOf(error).toEqualTypeOf<ApiErrorPayload>();
          return error.code;
        },
      },
    });
  });
});
