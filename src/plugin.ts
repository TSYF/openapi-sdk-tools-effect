import {
  defineSdkPlugin,
  type SdkPlugin,
} from "@openapi-sdk-tools/core";
import type { Schema } from "effect";

import { effectMatchStrategy } from "./match.js";
import { effectSchemaDecoder } from "./schema.js";
import type { EffectMatchOptions, EffectSchemaOptions } from "./types.js";

/**
 * Configuration for {@link effectPlugin}.
 *
 * `TError` is inferred from `schema`, so a `match.resolve` callback receives
 * the decoded error type when both capabilities are enabled.
 */
export interface EffectPluginConfig<TError = unknown> {
  /** Schema used to decode raw SDK errors. Enables `errorDecoder`. */
  readonly schema?: Schema.ConstraintDecoder<TError>;
  /** Options forwarded to {@link effectSchemaDecoder}. */
  readonly schemaOptions?: EffectSchemaOptions;
  /**
   * Enables the `match` capability.
   *
   * `true` uses the default resolution order; an options object customises
   * the resolver and discriminator paths.
   */
  readonly match?: boolean | EffectMatchOptions<TError>;
}

/**
 * Creates a plugin contributing Effect Schema decoding and/or Effect Match
 * resolution.
 *
 * Only the requested capabilities are attached; no result backend is ever
 * provided. At least one of `schema` or `match` must be enabled.
 */
export function effectPlugin<TError>(
  config: EffectPluginConfig<TError> & {
    readonly schema: Schema.ConstraintDecoder<TError>;
  },
): SdkPlugin;
export function effectPlugin<TError = unknown>(
  config: EffectPluginConfig<TError> & {
    readonly match: true | EffectMatchOptions<TError>;
  },
): SdkPlugin;
export function effectPlugin(config: EffectPluginConfig): SdkPlugin;
export function effectPlugin(config: EffectPluginConfig): SdkPlugin {
  const { schema, schemaOptions, match } = config;
  const matchEnabled = match !== undefined && match !== false;

  if (schema === undefined && !matchEnabled) {
    throw new Error(
      "effectPlugin: at least one capability must be enabled; " +
        "provide a `schema`, a `match` configuration, or both.",
    );
  }

  return defineSdkPlugin({
    name: "effect",
    ...(schema !== undefined
      ? { errorDecoder: effectSchemaDecoder(schema, schemaOptions) }
      : {}),
    ...(matchEnabled
      ? { match: effectMatchStrategy(match === true ? {} : match) }
      : {}),
  });
}
