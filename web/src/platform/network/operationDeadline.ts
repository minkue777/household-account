export class OperationDeadlineExceededError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'OperationDeadlineExceededError';
  }
}

export async function withinDeadline<Value>(
  operation: Promise<Value>,
  timeoutMs: number,
  timeoutCode: string
): Promise<Value> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(
      () => reject(new OperationDeadlineExceededError(timeoutCode)),
      timeoutMs
    );
  });

  try {
    return await Promise.race([operation, deadline]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}
