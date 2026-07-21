export interface AndroidQuickEditPort {
  open(transactionId: string): void;
}

export interface AndroidCaptureCompletionPort {
  broadcast(transactionId: string): void;
}
