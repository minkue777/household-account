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
  readonly principalUid?: string;
  readonly signedInUserResolution?: SignedInUserResolution;
}

export async function issueWebViewSessionToken(input: {
  readonly principalUid: string | undefined;
  readonly issue: (principalUid: string) => Promise<string>;
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
  const [customToken, resolution] = await Promise.all([
    input.issue(principalUid),
    input.resolveSignedInUser(principalUid),
  ]);
  return {
    contractVersion: "webview-session-token.v1",
    customToken,
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
        issue: (principalUid) => getAuth().createCustomToken(principalUid),
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
