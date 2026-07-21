import { createAndroidHostAccessApplication } from "../reference/android-host/application/androidHostAccessApplication";
import type {
  AndroidHostAccessInputPort,
  AndroidPermissionState,
} from "../reference/android-host/application/ports/in/androidHostAccessInputPort";

export type HostAccessPermissionState = AndroidPermissionState;
export interface HostAccessFixtureSubject extends AndroidHostAccessInputPort {}

export function createHostAccessFixtureSubject(): HostAccessFixtureSubject {
  return createAndroidHostAccessApplication();
}
