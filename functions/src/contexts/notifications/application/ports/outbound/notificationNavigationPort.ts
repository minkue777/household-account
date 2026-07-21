export interface NotificationNavigationPort {
  focus(input: { clientId: string; url: string }): Promise<void>;
  open(url: string): Promise<void>;
}
