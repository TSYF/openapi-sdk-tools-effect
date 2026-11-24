import { isSdkResult, type SdkResultAsync } from "@openapi-sdk-tools/core";
import { Effect } from "effect";

type Outcome<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

/**
 * Converts any SdkResultAsync into an Effect that succeeds with its value or
 * fails with its typed error.
 *
 * Works with every result backend: the outcome is read through `.match()`
 * rather than through a backend-specific native result.
 */
export function toEffect<T, TCode extends string, E>(
  result: SdkResultAsync<T, TCode, E>,
): Effect.Effect<T, E> {
  return Effect.flatMap(
    Effect.promise(() =>
      result.match<Outcome<T, E>>(
        (value) => ({ ok: true, value }),
        (error) => ({ ok: false, error }),
      ),
    ),
    (outcome) =>
      outcome.ok ? Effect.succeed(outcome.value) : Effect.fail(outcome.error),
  );
}

type UnwrapSdkResult<R> = R extends SdkResultAsync<infer T, any, infer E>
  ? Effect.Effect<T, E>
  : R;

/**
 * Maps a generated client type to one whose methods return Effect programs
 * instead of the core SdkResultAsync facade.
 */
export type EffectClient<T> = {
  [K in keyof T]: T[K] extends (...args: infer A) => infer R
    ? (...args: A) => UnwrapSdkResult<R>
    : T[K] extends readonly unknown[]
      ? T[K]
      : T[K] extends object
        ? EffectClient<T[K]>
        : T[K];
};

/**
 * Wraps a generated client (including root clients with nested sub-clients)
 * so every SdkResultAsync return becomes an Effect program.
 *
 * @example
 * const client = effectClient(new TicketClient({ baseUrl }));
 * yield* client.ticket.getAll(); // Effect<GetTicketDto[], TicketGetAllErrors>
 */
export function effectClient<T extends object>(client: T): EffectClient<T> {
  return new Proxy(client, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);

      if (prop === "constructor" || isSdkResult(value)) {
        return value;
      }

      if (typeof value === "function") {
        return (...args: unknown[]) => {
          const result = value.apply(target, args);
          return isSdkResult(result) ? toEffect(result) : result;
        };
      }

      if (
        value !== null &&
        typeof value === "object" &&
        !Array.isArray(value)
      ) {
        return effectClient(value);
      }

      return value;
    },
  }) as EffectClient<T>;
}
