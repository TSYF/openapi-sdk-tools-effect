import {
  STATUS_TO_CODE_MAP,
  __SDK_UNDECLARED_ERROR__,
  getDiscriminantFromPath,
  getStatusFromError,
} from "@openapi-sdk-tools/core";
import type {
  ErrorMatchContext,
  ExhaustiveErrorHandler,
  MatchContext,
  MatchStrategy,
  ResultLike,
  SdkPlugin,
} from "@openapi-sdk-tools/core";

import type { EffectMatchOptions } from "./types.js";

type ErrorHandlerMap<TError, A> = Record<
  string,
  ((ctx: ErrorMatchContext<TError>) => A) | undefined
>;

const TAG_PATH = ["_tag"];

/**
 * Match strategy driven by an Effect Match-style resolver.
 *
 * Resolution order:
 * 1. `options.resolve(error, context)`
 * 2. the client `discriminatorKey` path
 * 3. the `_tag` path
 * 4. each extra `options.discriminantKeys` path
 * 5. the HTTP status mapped through `STATUS_TO_CODE_MAP`, scoped to declared
 *    codes
 * 6. the `__SDK_UNDECLARED_ERROR__` handler
 * 7. the `_` wildcard
 *
 * Only codes declared for the operation may select a specific handler. A
 * resolver result that is not declared falls through to the remaining steps
 * instead of jumping straight to the wildcard.
 */
export function effectMatchStrategy<TError = unknown>(
  options: EffectMatchOptions<TError> = {},
): MatchStrategy {
  const resolve = options.resolve as unknown as
    | ((error: unknown, context: MatchContext) => string | undefined)
    | undefined;
  const discriminantKeys = options.discriminantKeys ?? [];

  return {
    name: "effect-match",
    match<T, TCode extends string, TMatchError, A>(
      result: ResultLike<T, TMatchError>,
      ok: (value: T) => A,
      handlers: ExhaustiveErrorHandler<TCode, TMatchError, A>,
      context: MatchContext<TCode, TMatchError>,
    ): Promise<A> {
      const handlerMap = handlers as unknown as ErrorHandlerMap<TMatchError, A>;
      const declaredCodes = context.declaredCodes as readonly string[];
      const discriminatorKey = context.discriminatorKey;

      const declaredHandler = (code: string | undefined) =>
        code !== undefined && declaredCodes.includes(code)
          ? handlerMap[code]
          : undefined;

      return result.match(ok, (error) => {
        let discriminant: string | undefined;

        const remember = (code: string | undefined): code is string => {
          if (code === undefined) return false;
          discriminant ??= code;
          return true;
        };

        // 1. Explicit resolver.
        const resolvedCode = resolve?.(error, context);
        if (remember(resolvedCode)) {
          const handler = declaredHandler(resolvedCode);
          if (handler) {
            return handler({
              error,
              metadata: {
                source: "discriminator",
                discriminatorKey,
                discriminant: resolvedCode,
              },
            });
          }
        }

        // 2. Client discriminator path.
        const clientCode = getDiscriminantFromPath(error, discriminatorKey);
        if (remember(clientCode)) {
          const handler = declaredHandler(clientCode);
          if (handler) {
            return handler({
              error,
              metadata: {
                source: "discriminator",
                discriminatorKey,
                discriminant: clientCode,
              },
            });
          }
        }

        // 3. `_tag`, the Effect convention.
        const tagCode = getDiscriminantFromPath(error, TAG_PATH);
        if (remember(tagCode)) {
          const handler = declaredHandler(tagCode);
          if (handler) {
            return handler({
              error,
              metadata: {
                source: "discriminator",
                discriminatorKey,
                discriminant: tagCode,
              },
            });
          }
        }

        // 4. Extra configured discriminator paths.
        for (const path of discriminantKeys) {
          const code = getDiscriminantFromPath(error, path as string[]);
          if (remember(code)) {
            const handler = declaredHandler(code);
            if (handler) {
              return handler({
                error,
                metadata: {
                  source: "discriminator",
                  discriminatorKey,
                  discriminant: code,
                },
              });
            }
          }
        }

        // 5. HTTP status, only for codes declared by the operation.
        const status = getStatusFromError(error);
        if (status !== undefined) {
          const statusCode = STATUS_TO_CODE_MAP[status];
          if (
            statusCode !== undefined &&
            declaredCodes.includes(statusCode) &&
            handlerMap[statusCode]
          ) {
            return handlerMap[statusCode]!({
              error,
              metadata: {
                source: "status",
                discriminatorKey,
                status,
              },
            });
          }
        }

        const fallbackMetadata = {
          discriminatorKey,
          ...(discriminant !== undefined ? { discriminant } : {}),
          ...(status !== undefined ? { status } : {}),
        };

        // 6. Undeclared-error handler.
        const undeclaredHandler = handlerMap[__SDK_UNDECLARED_ERROR__];
        if (undeclaredHandler) {
          return undeclaredHandler({
            error,
            metadata: { source: "undeclared", ...fallbackMetadata },
          });
        }

        // 7. Wildcard fallback.
        return handlerMap._!({
          error,
          metadata: { source: "wildcard", ...fallbackMetadata },
        });
      });
    },
  };
}

/** Plugin descriptor exposing the Effect Match strategy. */
export function effectMatchPlugin<TError = unknown>(
  options: EffectMatchOptions<TError> = {},
): SdkPlugin {
  return {
    name: "effect-match",
    match: effectMatchStrategy(options),
  };
}
