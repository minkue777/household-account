export type WireDtoRoundTripResult =
  | {
      readonly kind: "Decoded";
      readonly kotlinType: "BridgeRequestV1" | "QuickEditSnapshotV1";
      readonly reencodedJson: string;
    }
  | {
      readonly kind: "Rejected";
      readonly code: "VERSION_UNSUPPORTED" | "SCHEMA_INVALID";
    };

export interface WireDtoConformanceInputPort {
  decodeInGeneratedKotlinAndReencode(json: string): WireDtoRoundTripResult;
}
