import type { MatchContext } from "@openapi-sdk-tools/core";
import type { SchemaAST } from "effect";

/** Options for decoding SDK errors through an Effect Schema. */
export interface EffectSchemaOptions {
  /** Which part of the raw error to decode. Defaults to `"auto"`. */
  source?: "auto" | "raw" | "body";
  /** What to return when decoding fails. Defaults to `"raw"`. */
  onFailure?: "raw" | "error" | "throw";
  /** Attach the HTTP status to decoded object values. Defaults to `true`. */
  preserveStatus?: boolean;
  /** Options forwarded to `Schema.decodeUnknownResult`. */
  parseOptions?: SchemaAST.ParseOptions;
}

/** Options for resolving SDK error discriminants with Effect Match. */
export interface EffectMatchOptions<TError = unknown> {
  /** Custom resolver run before the default discriminant paths. */
  resolve?: (error: TError, context: MatchContext) => string | undefined;
  /** Extra paths probed for a discriminant after `_tag`. */
  discriminantKeys?: readonly (readonly string[])[];
}
