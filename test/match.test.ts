import { describe, expect, it, vi } from "vitest";
import {
  __SDK_UNDECLARED_ERROR__,
  defaultResultBackend,
  SdkKernel,
  SdkResultAsync,
  type ExhaustiveErrorHandler,
  type MatchContext,
  type MatchStrategy,
  type SdkPlugin,
} from "@openapi-sdk-tools/core";

import { effectMatchPlugin, effectMatchStrategy } from "../src/match.js";

type Code = "NOT_FOUND" | "VALIDATION_ERROR";

const DECLARED: readonly Code[] = ["NOT_FOUND", "VALIDATION_ERROR"];

function handlers<TError = unknown>(
  overrides: Partial<ExhaustiveErrorHandler<Code, TError, string>> = {},
): ExhaustiveErrorHandler<Code, TError, string> {
  return {
    NOT_FOUND: () => "not-found",
    VALIDATION_ERROR: () => "validation",
    _: () => "wildcard",
    ...overrides,
  };
}

function matchContext(
  overrides: Partial<MatchContext<Code, unknown>> = {},
): MatchContext<Code, unknown> {
  return {
    declaredCodes: DECLARED,
    discriminatorKey: ["code"],
    ...overrides,
  };
}

interface MatchOptions {
  handlers?: Partial<ExhaustiveErrorHandler<Code, unknown, string>>;
  declaredCodes?: readonly Code[];
  discriminatorKey?: string[];
}

function matchStrategy(
  strategy: MatchStrategy,
  error: unknown,
  options: MatchOptions = {},
): Promise<string> {
  return strategy.match(
    defaultResultBackend.err<never, unknown>(error),
    () => "ok",
    handlers(options.handlers),
    matchContext({
      declaredCodes: options.declaredCodes ?? DECLARED,
      discriminatorKey: options.discriminatorKey ?? ["code"],
    }),
  );
}

interface SdkOptions {
  plugin?: SdkPlugin;
  declaredCodes?: readonly Code[];
  discriminatorKey?: string[];
}

function sdkResult(
  error: unknown,
  options: SdkOptions = {},
): SdkResultAsync<never, Code, unknown> {
  return new SdkResultAsync(
    defaultResultBackend.err<never, unknown>(error),
    new SdkKernel([options.plugin ?? effectMatchPlugin()]),
    {
      discriminatorKey: options.discriminatorKey ?? ["code"],
      declaredCodes: options.declaredCodes ?? DECLARED,
    },
  );
}

describe("effectMatchStrategy", () => {
  it("passes successful values through without resolving", async () => {
    const resolve = vi.fn(() => "NOT_FOUND");

    const matched = await effectMatchStrategy({ resolve }).match(
      defaultResultBackend.ok<number, unknown>(21),
      (value) => value * 2,
      handlers(),
      matchContext(),
    );

    expect(matched).toBe(42);
    expect(resolve).not.toHaveBeenCalled();
  });

  it("dispatches resolver hits with discriminator metadata", async () => {
    const error = { code: "VALIDATION_ERROR", detail: "missing field" };
    const notFound = vi.fn(() => "not-found");
    const resolve = vi.fn(
      (_error: unknown, _context: MatchContext) => "NOT_FOUND",
    );

    const matched = await matchStrategy(
      effectMatchStrategy({ resolve }),
      error,
      { handlers: { NOT_FOUND: notFound } },
    );

    expect(matched).toBe("not-found");
    expect(resolve).toHaveBeenCalledWith(error, matchContext());
    expect(notFound).toHaveBeenCalledWith({
      error,
      metadata: {
        source: "discriminator",
        discriminatorKey: ["code"],
        discriminant: "NOT_FOUND",
      },
    });
  });

  it("types the resolver error as TError", async () => {
    interface ApiError {
      code?: string;
    }

    const error: ApiError = { code: "NOT_FOUND" };
    const strategy = effectMatchStrategy<ApiError>({
      resolve: (value) => value.code,
    });

    await expect(
      strategy.match(
        defaultResultBackend.err<never, ApiError>(error),
        () => "ok",
        handlers<ApiError>(),
        matchContext(),
      ),
    ).resolves.toBe("not-found");
  });

  it("continues after a resolver code that is not declared", async () => {
    const wildcard = vi.fn(() => "wildcard");

    const matched = await matchStrategy(
      effectMatchStrategy({ resolve: () => "GHOST" }),
      { code: "VALIDATION_ERROR" },
      { handlers: { _: wildcard } },
    );

    expect(matched).toBe("validation");
    expect(wildcard).not.toHaveBeenCalled();
  });

  it("falls through to _tag after an undeclared resolver code", async () => {
    const matched = await matchStrategy(
      effectMatchStrategy({ resolve: () => "GHOST" }),
      { _tag: "NOT_FOUND" },
    );

    expect(matched).toBe("not-found");
  });

  it("uses the client discriminator path before _tag", async () => {
    const matched = await matchStrategy(effectMatchStrategy(), {
      code: "VALIDATION_ERROR",
      _tag: "NOT_FOUND",
    });

    expect(matched).toBe("validation");
  });

  it("honours a custom client discriminator path", async () => {
    const matched = await matchStrategy(
      effectMatchStrategy(),
      { body: { kind: "NOT_FOUND" } },
      { discriminatorKey: ["body", "kind"] },
    );

    expect(matched).toBe("not-found");
  });

  it("matches a declared _tag when the client path misses", async () => {
    const error = { _tag: "NOT_FOUND" };
    const notFound = vi.fn(() => "not-found");

    const matched = await matchStrategy(effectMatchStrategy(), error, {
      handlers: { NOT_FOUND: notFound },
    });

    expect(matched).toBe("not-found");
    expect(notFound).toHaveBeenCalledWith({
      error,
      metadata: {
        source: "discriminator",
        discriminatorKey: ["code"],
        discriminant: "NOT_FOUND",
      },
    });
  });

  it("probes extra discriminantKeys after _tag", async () => {
    const strategy = effectMatchStrategy({
      discriminantKeys: [["body", "tag"], ["detail", "code"]],
    });

    await expect(
      matchStrategy(strategy, {
        _tag: "VALIDATION_ERROR",
        body: { tag: "NOT_FOUND" },
      }),
    ).resolves.toBe("validation");

    await expect(
      matchStrategy(strategy, { body: { tag: "NOT_FOUND" } }),
    ).resolves.toBe("not-found");

    await expect(
      matchStrategy(strategy, { detail: { code: "VALIDATION_ERROR" } }),
    ).resolves.toBe("validation");

    await expect(
      matchStrategy(strategy, {
        _tag: "SOMETHING_ELSE",
        body: { tag: "NOT_FOUND" },
      }),
    ).resolves.toBe("not-found");
  });

  it("maps the HTTP status to a declared code", async () => {
    const error = { status: 404 };
    const notFound = vi.fn(() => "not-found");

    const matched = await matchStrategy(effectMatchStrategy(), error, {
      handlers: { NOT_FOUND: notFound },
    });

    expect(matched).toBe("not-found");
    expect(notFound).toHaveBeenCalledWith({
      error,
      metadata: {
        source: "status",
        discriminatorKey: ["code"],
        status: 404,
      },
    });
  });

  it("scopes status matching to declared codes", async () => {
    const notFound = vi.fn(() => "not-found");

    const matched = await matchStrategy(
      effectMatchStrategy(),
      { status: 404 },
      {
        declaredCodes: ["VALIDATION_ERROR"],
        handlers: { NOT_FOUND: notFound, _: () => "wildcard" },
      },
    );

    expect(matched).toBe("wildcard");
    expect(notFound).not.toHaveBeenCalled();
  });

  it("prefers declared discriminators over the status fallback", async () => {
    const matched = await matchStrategy(effectMatchStrategy(), {
      code: "VALIDATION_ERROR",
      status: 404,
    });

    expect(matched).toBe("validation");
  });

  it("uses __SDK_UNDECLARED_ERROR__ when nothing matches", async () => {
    const error = { code: "SOMETHING_ELSE" };
    const undeclared = vi.fn(() => "undeclared");

    const matched = await matchStrategy(effectMatchStrategy(), error, {
      handlers: { [__SDK_UNDECLARED_ERROR__]: undeclared },
    });

    expect(matched).toBe("undeclared");
    expect(undeclared).toHaveBeenCalledWith({
      error,
      metadata: {
        source: "undeclared",
        discriminatorKey: ["code"],
        discriminant: "SOMETHING_ELSE",
      },
    });
  });

  it("falls back to the wildcard without an undeclared handler", async () => {
    const error = { status: 599 };
    const wildcard = vi.fn(() => "wildcard");

    const matched = await matchStrategy(effectMatchStrategy(), error, {
      handlers: { _: wildcard },
    });

    expect(matched).toBe("wildcard");
    expect(wildcard).toHaveBeenCalledWith({
      error,
      metadata: {
        source: "wildcard",
        discriminatorKey: ["code"],
        status: 599,
      },
    });
  });
});

describe("effectMatchPlugin", () => {
  it("exposes only the match capability", () => {
    const plugin = effectMatchPlugin();

    expect(plugin.name).toBe("effect-match");
    expect(plugin.match).toBeDefined();
    expect(plugin.match?.name).toBe("effect-match");
    expect(plugin.result).toBeUndefined();
    expect(plugin.errorDecoder).toBeUndefined();
  });
});

describe("effectMatchPlugin with SdkKernel", () => {
  it("dispatches resolver hits through SdkResultAsync", async () => {
    const error = { message: "missing resource" };
    const notFound = vi.fn(() => "not-found");
    const resolve = vi.fn(() => "NOT_FOUND");

    const result = sdkResult(error, { plugin: effectMatchPlugin({ resolve }) });

    await expect(
      result.match(() => "ok", handlers({ NOT_FOUND: notFound })),
    ).resolves.toBe("not-found");

    expect(notFound).toHaveBeenCalledWith({
      error,
      metadata: {
        source: "discriminator",
        discriminatorKey: ["code"],
        discriminant: "NOT_FOUND",
      },
    });
  });

  it("matches a declared _tag without a resolver", async () => {
    const result = sdkResult({ _tag: "VALIDATION_ERROR" });

    await expect(result.match(() => "ok", handlers())).resolves.toBe(
      "validation",
    );
  });

  it("passes the client discriminator context to the resolver", async () => {
    const error = { body: { kind: "SOMETHING_ELSE" } };
    const resolve = vi.fn(
      (_error: unknown, context: MatchContext) =>
        context.discriminatorKey.join(".") === "body.kind"
          ? "NOT_FOUND"
          : undefined,
    );

    const result = sdkResult(error, {
      plugin: effectMatchPlugin({ resolve }),
      discriminatorKey: ["body", "kind"],
    });

    await expect(result.match(() => "ok", handlers())).resolves.toBe(
      "not-found",
    );
    expect(resolve).toHaveBeenCalledWith(error, {
      declaredCodes: DECLARED,
      discriminatorKey: ["body", "kind"],
    });
  });

  it("scopes status fallback to the operation's declared codes", async () => {
    const result = sdkResult(
      { status: 404 },
      { declaredCodes: ["VALIDATION_ERROR"] },
    );

    await expect(result.match(() => "ok", handlers())).resolves.toBe(
      "wildcard",
    );
  });

  it("prefers the undeclared handler over the wildcard", async () => {
    const result = sdkResult({ message: "boom" });

    await expect(
      result.match(
        () => "ok",
        handlers({ [__SDK_UNDECLARED_ERROR__]: () => "undeclared" }),
      ),
    ).resolves.toBe("undeclared");
  });
});
