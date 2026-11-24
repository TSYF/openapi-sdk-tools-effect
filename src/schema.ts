import {
  defineSdkPlugin,
  isHttpRequestError,
  type ErrorDecoder,
  type SdkPlugin,
} from "@openapi-sdk-tools/core";
import { Result, Schema } from "effect";
import type { EffectSchemaOptions } from "./types.js";

/**
 * Error decoder backed by an Effect Schema.
 *
 * Decoding is synchronous: {@link ErrorDecoder.decode} cannot await, so only
 * synchronous schemas are supported.
 */
export interface EffectSchemaDecoder<T> extends ErrorDecoder {
  decode(raw: unknown): T;
}

type FailurePolicy = NonNullable<EffectSchemaOptions["onFailure"]>;

interface SelectedInput {
  /** Value passed to the schema. */
  readonly input: unknown;
  /** HTTP status when the input was taken from an HttpRequestError body. */
  readonly status?: number;
}

/**
 * Picks the value to decode.
 *
 * `"auto"` and `"body"` take `raw.body` when `raw` is an HttpRequestError;
 * everything else, including `"raw"`, decodes the value as-is.
 */
function selectInput(
  raw: unknown,
  source: NonNullable<EffectSchemaOptions["source"]>,
): SelectedInput {
  if (source === "raw") return { input: raw };
  if (isHttpRequestError(raw)) {
    return { input: raw.body, status: raw.status };
  }
  return { input: raw };
}

/**
 * Attaches the HTTP status to a decoded object without changing its shape.
 *
 * The property is non-enumerable so `toEqual`/JSON comparisons and generated
 * payload types are unaffected. Frozen or sealed values are returned unchanged.
 */
function attachStatus(
  value: unknown,
  status: number | undefined,
  preserveStatus: boolean,
): unknown {
  if (
    !preserveStatus ||
    status === undefined ||
    value === null ||
    typeof value !== "object"
  ) {
    return value;
  }

  try {
    Object.defineProperty(value, "status", {
      value: status,
      enumerable: false,
      configurable: true,
      writable: true,
    });
  } catch {
    // Frozen/sealed decoded values keep their own shape.
  }

  return value;
}

/**
 * Applies the configured failure policy.
 *
 * - `"raw"` returns the selected input unchanged.
 * - `"error"` returns the {@link Schema.SchemaError} as the decoded value.
 * - `"throw"` throws it; inside `ErrorDecoder.decode` this rejects the SDK
 *   result promise, since decoding runs in the result backend's `mapError`.
 */
function handleDecodeFailure(
  input: unknown,
  failure: Schema.SchemaError,
  policy: FailurePolicy = "raw",
): unknown {
  switch (policy) {
    case "raw":
      return input;
    case "error":
      return failure;
    case "throw":
      throw failure;
  }
}

/**
 * Creates an {@link ErrorDecoder} that decodes raw SDK errors with an Effect
 * Schema.
 *
 * On success the decoded value is returned, with the HTTP status attached
 * non-enumerably when the input came from an HttpRequestError and the decoded
 * value is an object. On failure `options.onFailure` decides whether the
 * selected input, the SchemaError, or a thrown SchemaError is produced.
 */
export function effectSchemaDecoder<T>(
  schema: Schema.ConstraintDecoder<T>,
  options: EffectSchemaOptions = {},
): EffectSchemaDecoder<T> {
  const source = options.source ?? "auto";
  const preserveStatus = options.preserveStatus !== false;
  const decodeUnknown = Schema.decodeUnknownResult(schema);

  return {
    name: "effect-schema",
    decode(raw: unknown): T {
      const selected = selectInput(raw, source);
      const parsed: Result.Result<T, Schema.SchemaError> = decodeUnknown(
        selected.input,
        options.parseOptions,
      );

      if (Result.isSuccess(parsed)) {
        return attachStatus(
          parsed.success,
          selected.status,
          preserveStatus,
        ) as T;
      }

      return handleDecodeFailure(
        selected.input,
        parsed.failure,
        options.onFailure,
      ) as T;
    },
  };
}

/**
 * Creates an SDK plugin whose only capability is schema-based error decoding.
 */
export function effectSchemaPlugin<T>(
  schema: Schema.ConstraintDecoder<T>,
  options?: EffectSchemaOptions,
): SdkPlugin {
  return defineSdkPlugin({
    name: "effect-schema",
    errorDecoder: effectSchemaDecoder(schema, options),
  });
}
