/** Process exit codes. Part of the public CLI contract (ADR 0001); change only with an ADR. */
export const ExitCode = {
  ok: 0,
  validation: 1,
  unsupported: 2,
  overwriteRefused: 3,
  evalGateFailed: 4,
  environment: 5,
} as const;
export type ExitCode = (typeof ExitCode)[keyof typeof ExitCode];

/** An expected failure with a user-facing message and a stable exit code. */
export class ArmatureError extends Error {
  constructor(
    message: string,
    readonly exitCode: ExitCode,
    readonly hint?: string,
  ) {
    super(message);
    this.name = "ArmatureError";
  }
}
