import {
  defaultResultBackend,
  SdkResultAsync,
} from "@openapi-sdk-tools/core";
import { Cause, Effect, Exit } from "effect";
import { describe, expect, expectTypeOf, it } from "vitest";
import { effectClient, toEffect } from "../src/effect.js";

type TestCode = "NOT_FOUND" | "BAD_REQUEST";

function ok<T, E = never>(value: T): SdkResultAsync<T, TestCode, E> {
  return new SdkResultAsync(
    defaultResultBackend.ok<T, E>(value),
  ) as SdkResultAsync<T, TestCode, E>;
}

function err<E>(error: E): SdkResultAsync<never, TestCode, E> {
  return new SdkResultAsync(
    defaultResultBackend.err<never, E>(error),
  ) as SdkResultAsync<never, TestCode, E>;
}

class FakeClient {
  readonly items = ["root-item"];

  readonly nested: {
    getOther(): SdkResultAsync<number, TestCode, string>;
    getInner: {
      getDeep(): SdkResultAsync<string, TestCode, Error>;
    };
  };

  readonly passthrough: { value: number };

  constructor(private readonly prefix: string) {
    this.nested = {
      getOther: () => ok(2),
      getInner: {
        getDeep: () => ok(`${prefix}-deep`),
      },
    };
    this.passthrough = { value: 7 };
  }

  getValue(): SdkResultAsync<string, TestCode, string> {
    return ok(`${this.prefix}-value`);
  }

  failValue(): SdkResultAsync<never, TestCode, string> {
    return err("boom");
  }

  plain(): string {
    return `${this.prefix}-plain`;
  }

  getList(): readonly string[] {
    return this.items;
  }
}

describe("toEffect", () => {
  it("succeeds with the SdkResultAsync value", async () => {
    const effect = toEffect(ok(3));

    expect(Effect.isEffect(effect)).toBe(true);
    expectTypeOf(effect).toEqualTypeOf<Effect.Effect<number, never>>();
    await expect(Effect.runPromise(effect)).resolves.toBe(3);
  });

  it("fails with the SdkResultAsync error", async () => {
    const effect = toEffect(err("boom"));

    expectTypeOf(effect).toEqualTypeOf<Effect.Effect<never, string>>();
    const exit = await Effect.runPromiseExit(effect);

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const reason = exit.cause.reasons[0];
      expect(reason !== undefined && Cause.isFailReason(reason)).toBe(true);
      if (reason !== undefined && Cause.isFailReason(reason)) {
        expect(reason.error).toBe("boom");
      }
    }
  });
});

describe("effectClient", () => {
  it("converts root methods to Effects", async () => {
    const client = effectClient(new FakeClient("api"));

    const effect = client.getValue();

    expect(Effect.isEffect(effect)).toBe(true);
    expectTypeOf(effect).toEqualTypeOf<Effect.Effect<string, string>>();
    await expect(Effect.runPromise(effect)).resolves.toBe("api-value");
  });

  it("converts nested client methods and recurses into deeper objects", async () => {
    const client = effectClient(new FakeClient("api"));

    const nested = client.nested.getOther();
    expect(Effect.isEffect(nested)).toBe(true);
    expectTypeOf(nested).toEqualTypeOf<Effect.Effect<number, string>>();
    await expect(Effect.runPromise(nested)).resolves.toBe(2);

    const deep = client.nested.getInner.getDeep();
    expect(Effect.isEffect(deep)).toBe(true);
    expectTypeOf(deep).toEqualTypeOf<Effect.Effect<string, Error>>();
    await expect(Effect.runPromise(deep)).resolves.toBe("api-deep");
  });

  it("converts failing methods to failing Effects", async () => {
    const client = effectClient(new FakeClient("api"));
    const exit = await Effect.runPromiseExit(client.failValue());

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const reason = exit.cause.reasons[0];
      expect(reason !== undefined && Cause.isFailReason(reason)).toBe(true);
      if (reason !== undefined && Cause.isFailReason(reason)) {
        expect(reason.error).toBe("boom");
      }
    }
  });

  it("binds methods to the original client", async () => {
    const client = effectClient(new FakeClient("bound"));

    expect(client.plain()).toBe("bound-plain");
    await expect(Effect.runPromise(client.getValue())).resolves.toBe(
      "bound-value",
    );
  });

  it("passes non-result methods through unchanged", () => {
    const original = new FakeClient("api");
    const client = effectClient(original);

    expect(client.plain()).toBe("api-plain");
    expect(Effect.isEffect(client.plain())).toBe(false);
    expectTypeOf(client.plain()).toEqualTypeOf<string>();
  });

  it("leaves arrays unchanged", () => {
    const original = new FakeClient("api");
    const client = effectClient(original);

    expect(client.items).toBe(original.items);
    expect(client.items).toEqual(["root-item"]);
    expect(client.getList()).toBe(original.items);
    expectTypeOf(client.items).toEqualTypeOf<string[]>();
    expectTypeOf(client.getList()).toEqualTypeOf<readonly string[]>();
  });

  it("passes constructor and plain nested objects through", () => {
    const client = effectClient(new FakeClient("api"));

    expect(client.constructor).toBe(FakeClient);
    expect(client.passthrough.value).toBe(7);
  });
});
