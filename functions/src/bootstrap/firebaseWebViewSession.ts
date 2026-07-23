import { getAuth } from "firebase-admin/auth";
import * as functions from "firebase-functions/v1";

import {
  resolveFirebaseSignedInUser,
  SignedInUserResolutionError,
  type SignedInUserResolution,
} from "../adapters/firebase/access/firebaseSignedInUserResolver";
import { db, REGION } from "../config";

export interface WebViewSessionTokenResponse {
  readonly contractVersion: "webview-session-token.v1";
  readonly customToken: string;
  readonly nativeCustomToken: string;
  readonly principalUid?: string;
  readonly signedInUserResolution?: SignedInUserResolution;
}

type SessionTokenClaims = Readonly<Record<string, string | number | boolean>>;

function membershipClaims(
  resolution: SignedInUserResolution,
  client: "native" | "web",
): SessionTokenClaims {
  if (resolution.kind !== "membership-found") {
    return {
      hcaClient: client,
      hcaCaptureMembershipVersion: 1,
      hcaCaptureMember: false,
    };
  }
  return {
    hcaClient: client,
    hcaCaptureMembershipVersion: 1,
    hcaCaptureMember: true,
    hcaCaptureHouseholdId: resolution.membership.householdId,
    hcaCaptureMemberId: resolution.membership.memberId,
  };
}

export async function issueWebViewSessionToken(input: {
  readonly principalUid: string | undefined;
  readonly issue: (
    principalUid: string,
    claims: SessionTokenClaims,
  ) => Promise<string>;
  readonly resolveSignedInUser: (
    principalUid: string,
  ) => Promise<SignedInUserResolution>;
}): Promise<WebViewSessionTokenResponse> {
  if (input.principalUid === undefined || input.principalUid.trim() === "") {
    throw new functions.https.HttpsError(
      "unauthenticated",
      "Firebase Authentication is required",
    );
  }
  const principalUid = input.principalUid.trim();
  const resolution = await input.resolveSignedInUser(principalUid);
  const [customToken, nativeCustomToken] = await Promise.all([
    input.issue(principalUid, membershipClaims(resolution, "web")),
    input.issue(principalUid, membershipClaims(resolution, "native")),
  ]);
  return {
    contractVersion: "webview-session-token.v1",
    customToken,
    nativeCustomToken,
    principalUid,
    signedInUserResolution: resolution,
  };
}

export const createWebViewSessionToken = functions
  .region(REGION)
  .runWith({ enforceAppCheck: true })
  .https.onCall(async (_data, context): Promise<WebViewSessionTokenResponse> => {
    try {
      return await issueWebViewSessionToken({
        principalUid: context.auth?.uid,
        issue: (principalUid, claims) =>
          getAuth().createCustomToken(principalUid, claims),
        resolveSignedInUser: (principalUid) =>
          resolveFirebaseSignedInUser(db, principalUid),
      });
    } catch (error) {
      if (error instanceof functions.https.HttpsError) throw error;
      if (error instanceof SignedInUserResolutionError) {
        throw new functions.https.HttpsError("failed-precondition", error.code);
      }
      throw new functions.https.HttpsError(
        "unavailable",
        "SIGNED_IN_USER_RESOLUTION_FAILED",
      );
    }
  });
