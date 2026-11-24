import { describe, expect, it } from "vitest";
import {
  defaultResultBackend,
  mapError,
  SdkKernel,
  SdkResultAsync,
  type ErrorMatchContext,
  type HttpRequestError,
  type SdkPlugin,
} from "@openapi-sdk-tools/core";
import { Schema } from "effect";
import {
  effectSchemaDecoder,
  effectSchemaPlugin,
  type EffectSchemaDecoder,
} from "../src/schema.js";

const ApiError = Schema.Struct({
  code: Schema.String,
  message: Schema.String,
});

interface ApiErrorPayload {
  readonly code: string;
  readonly message: string;
  readonly status?: number;
}

/** Typed identity used as the client-level error mapper. */
const identity = (error: unknown): ApiErrorPayload =>
  error as ApiErrorPayload;

function notFound(): HttpRequestError {
  return {
    status: 404,
    body: { code: "NOT_FOUND", message: "missing" },
    message: "Not Found",
  };
}

/** HTTP error whose body does not satisfy {@link ApiError}. */
function invalidNotFound(): HttpRequestError {
  return {
    status: 404,
    body: { unexpected: true },
    message: "Not Found",
  };
}

/** The real generated-SDK path: backend → mapError(decoder, mapper) → match. */
function sdkResult(plugin: SdkPlugin, raw: unknown) {
  return new SdkResultAsync(
    defaultResultBackend.fromPromise<unknown, ApiErrorPayload>(
      Promise.reject(raw),
      (error) => mapError(plugin.errorDecoder, identity, error),
    ),
    new SdkKernel([plugin]),
    { declaredCodes: ["NOT_FOUND"] as const },
  );
}

/** Explicit decoder variant of {@link sdkResult}, for failure-policy tests. */
function sdkResultWithDecoder(
  decoder: EffectSchemaDecoder<ApiErrorPayload>,
  raw: unknown,
) {
  return new SdkResultAsync(
    defaultResultBackend.fromPromise<unknown, ApiErrorPayload>(
      Promise.reject(raw),
      (error) => mapError(decoder, identity, error),
    ),
    new SdkKernel(),
    { declaredCodes: ["NOT_FOUND"] as const },
  );
}

describe("effectSchemaPlugin", () => {
  it("exposes only the errorDecoder capability", () => {
    const plugin = effectSchemaPlugin(ApiError);

    expect(plugin.name).toBe("effect-schema");
    expect(plugin.result).toBeUndefined();
    expect(plugin.match).toBeUndefined();
    expect(plugin.errorDecoder?.name).toBe("effect-schema");
    expect(typeof plugin.errorDecoder?.decode).toBe("function");
  });
});

describe("effectSchemaDecoder", () => {
  it("decodes a non-HTTP error as-is, without attaching a status", () => {
    const raw = { code: "NOT_FOUND", message: "missing" };
    const decoded = effectSchemaDecoder(ApiError).decode(raw);

    expect(decoded).toEqual(raw);
    expect(decoded).not.toBe(raw);
    expect("status" in decoded).toBe(false);
  });

  it("decodes raw.body for an HttpRequestError and attaches status non-enumerably", () => {
    const raw = notFound();
    const decoded = effectSchemaDecoder(ApiError).decode(raw);

    expect(decoded).toEqual({ code: "NOT_FOUND", message: "missing" });
    expect(decoded.status).toBe(404);

    const descriptor = Object.getOwnPropertyDescriptor(decoded, "status");
    expect(descriptor).toMatchObject({
      value: 404,
      enumerable: false,
      configurable: true,
      writable: true,
    });
    expect(Object.keys(decoded)).toEqual(["code", "message"]);
  });

  it("source raw decodes the whole raw error and leaves its status enumerable", () => {
    const Envelope = Schema.Struct({
      status: Schema.Number,
      body: ApiError,
      message: Schema.String,
    });
    const raw = notFound();
    const decoded = effectSchemaDecoder(Envelope, { source: "raw" }).decode(
      raw,
    );

    expect(decoded).toEqual({
      status: 404,
      body: { code: "NOT_FOUND", message: "missing" },
      message: "Not Found",
    });
    expect(decoded).not.toBe(raw);
    // The schema's own status field stays enumerable; no body status was attached.
    expect(Object.getOwnPropertyDescriptor(decoded, "status")?.enumerable).toBe(
      true,
    );
  });

  it("source body decodes raw.body explicitly", () => {
    const decoded = effectSchemaDecoder(ApiError, { source: "body" }).decode(
      notFound(),
    );

    expect(decoded).toEqual({ code: "NOT_FOUND", message: "missing" });
    expect(decoded.status).toBe(404);
  });

  it("preserveStatus false does not attach a status", () => {
    const decoded = effectSchemaDecoder(ApiError, {
      preserveStatus: false,
    }).decode(notFound());

    expect(decoded).toEqual({ code: "NOT_FOUND", message: "missing" });
    expect("status" in decoded).toBe(false);
  });

  it("returns the selected input unchanged when decoding fails (onFailure raw)", () => {
    const raw: HttpRequestError = {
      status: 404,
      body: { code: "NOT_FOUND" },
      message: "Not Found",
    };

    expect(effectSchemaDecoder(ApiError).decode(raw)).toBe(raw.body);
    expect(
      effectSchemaDecoder(ApiError, { onFailure: "raw" }).decode(raw),
    ).toBe(raw.body);
  });

  it("returns the SchemaError as the decoded value (onFailure error)", () => {
    const raw = invalidNotFound();
    const decoded = effectSchemaDecoder(ApiError, {
      onFailure: "error",
    }).decode(raw);

    // No throw: the failure surfaces as the decoded error value.
    expect(Schema.isSchemaError(decoded)).toBe(true);
    expect(decoded).not.toBe(raw.body);
  });

  it("does not wrap or replace a decoded class instance", () => {
    class ApiErrorInstance {
      readonly code = "NOT_FOUND";
      readonly message = "missing";
    }

    const body = new ApiErrorInstance();
    const decoded = effectSchemaDecoder(
      Schema.instanceOf(ApiErrorInstance),
    ).decode({ status: 404, body, message: "Not Found" });

    expect(decoded).toBe(body);
    expect(decoded).toBeInstanceOf(ApiErrorInstance);
    expect((decoded as ApiErrorInstance & { status?: number }).status).toBe(404);
  });

  it("never throws on the success path when the decoded value is frozen", () => {
    const body = Object.freeze({ code: "NOT_FOUND", message: "missing" });
    const decoded = effectSchemaDecoder(Schema.Unknown).decode({
      status: 404,
      body,
      message: "Not Found",
    });

    expect(decoded).toBe(body);
    expect("status" in body).toBe(false);
  });
});

describe("error decoding through the SDK result path", () => {
  it("matches a decoded HTTP error on code with message and status (US-1)", async () => {
    const plugin = effectSchemaPlugin(ApiError);
    let context: ErrorMatchContext<ApiErrorPayload> | undefined;

    const matched = await sdkResult(plugin, notFound()).match(
      () => "ok",
      {
        NOT_FOUND: (ctx) => {
          context = ctx;
          return "not-found";
        },
        _: () => "wildcard",
      },
    );

    expect(matched).toBe("not-found");
    expect(context?.metadata.source).toBe("discriminator");
    expect(context?.error.code).toBe("NOT_FOUND");
    expect(context?.error.message).toBe("missing");
    expect(context?.error.status).toBe(404);
    // status must not leak into payload equality checks
    expect(Object.keys(context!.error)).toEqual(["code", "message"]);
  });

  it("matches a decoded non-HTTP error without a status", async () => {
    const plugin = effectSchemaPlugin(ApiError);
    const matched = await sdkResult(plugin, {
      code: "NOT_FOUND",
      message: "missing",
    }).match(
      () => "ok",
      {
        NOT_FOUND: ({ error }) => error,
        _: () => "wildcard",
      },
    );

    expect(matched).toEqual({ code: "NOT_FOUND", message: "missing" });
    expect("status" in matched).toBe(false);
  });

  it("onFailure raw resolves .match() with the raw body in the wildcard (US-2)", async () => {
    const raw = invalidNotFound();
    const decoder = effectSchemaDecoder(ApiError, { onFailure: "raw" });
    let context: ErrorMatchContext<ApiErrorPayload> | undefined;

    const matched = await sdkResultWithDecoder(decoder, raw).match(
      () => "ok",
      {
        NOT_FOUND: () => "not-found",
        _: (ctx) => {
          context = ctx;
          return "wildcard";
        },
      },
    );

    expect(matched).toBe("wildcard");
    expect(context?.metadata.source).toBe("wildcard");
    expect(context?.error).toBe(raw.body);
    expect(Schema.isSchemaError(context?.error)).toBe(false);
  });

  it("onFailure throw rejects .match() with the SchemaError (US-2)", async () => {
    const decoder = effectSchemaDecoder(ApiError, { onFailure: "throw" });

    const failure = await sdkResultWithDecoder(decoder, invalidNotFound())
      .match(
        () => "ok",
        {
          NOT_FOUND: () => "not-found",
          _: () => "wildcard",
        },
      )
      .then(
        () => undefined,
        (error: unknown) => error,
      );

    expect(Schema.isSchemaError(failure)).toBe(true);
    expect(failure).toBeInstanceOf(Schema.SchemaError);
  });
});
