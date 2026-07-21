import { getAuth } from "firebase-admin/auth";
import * as functions from "firebase-functions/v1";

import { REGION } from "../config";

export interface WebViewSessionTokenResponse {
  readonly contractVersion: "webview-session-token.v1";
  readonly customToken: string;
}

export async function issueWebViewSessionToken(input: {
  readonly principalUid: string | undefined;
  readonly issue: (principalUid: string) => Promise<string>;
}): Promise<WebViewSessionTokenResponse> {
  if (input.principalUid === undefined || input.principalUid.trim() === "") {
    throw new functions.https.HttpsError(
      "unauthenticated",
      "Firebase Authentication is required",
    );
  }
  return {
    contractVersion: "webview-session-token.v1",
    customToken: await input.issue(input.principalUid.trim()),
  };
}

export const createWebViewSessionToken = functions
  .region(REGION)
  .runWith({ enforceAppCheck: true })
  .https.onCall(async (_data, context): Promise<WebViewSessionTokenResponse> =>
    issueWebViewSessionToken({
      principalUid: context.auth?.uid,
      issue: (principalUid) => getAuth().createCustomToken(principalUid),
    }),
  );
