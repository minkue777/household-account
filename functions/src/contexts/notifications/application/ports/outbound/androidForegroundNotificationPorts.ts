export interface AndroidSystemNotificationPort {
  display(input: {
    notificationId: number;
    title: string;
    body: string;
    channelId: "expense_notifications";
    channelName: "지출 알림";
    importance: "default";
    contentActivity: "MainActivity";
  }): Promise<void>;
}

export interface AndroidNotificationIdPort {
  next(): number;
}
