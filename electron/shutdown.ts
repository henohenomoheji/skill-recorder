interface ShutdownActions {
  confirm: () => Promise<boolean>;
  drain: () => Promise<void>;
  cleanup: () => Promise<void>;
  exit: () => void;
  report: (error: unknown) => void;
  cleanupTimeoutMs?: number;
}

/** Finish recording writes before exiting; background workers must not keep a dead UI alive. */
export class ShutdownCoordinator {
  private pending: Promise<void> | null = null;
  private draining = false;

  constructor(private readonly actions: ShutdownActions) {}

  get requested(): boolean { return this.draining; }

  request(): Promise<void> {
    if (this.pending) return this.pending;
    this.pending = Promise.resolve().then(async () => {
      if (!(await this.actions.confirm())) return;
      this.draining = true;
      try {
        await this.actions.drain();
      } catch (error) {
        this.draining = false;
        this.actions.report(error);
        return;
      }
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          Promise.resolve().then(() => this.actions.cleanup()),
          new Promise<never>((_resolve, reject) => {
            timer = setTimeout(() => reject(new Error("Background cleanup timed out after recording data was drained.")), this.actions.cleanupTimeoutMs ?? 5000);
          }),
        ]);
      } catch (error) {
        this.actions.report(error);
      } finally {
        if (timer) clearTimeout(timer);
        this.actions.exit();
      }
    }).finally(() => { this.pending = null; });
    return this.pending;
  }
}
