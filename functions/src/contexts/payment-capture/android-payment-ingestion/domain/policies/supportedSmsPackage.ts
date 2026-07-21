const SUPPORTED_SMS_PACKAGES = new Set([
  "com.google.android.apps.messaging",
  "com.samsung.android.messaging",
  "com.android.mms",
]);

export function isSupportedSmsPackage(packageName: string): boolean {
  return SUPPORTED_SMS_PACKAGES.has(packageName);
}
