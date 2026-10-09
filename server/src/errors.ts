export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code);
  }
}
export function requireCondition(
  condition: unknown,
  code: string,
  status = 400,
): asserts condition {
  if (!condition) throw new AppError(status, code);
}
