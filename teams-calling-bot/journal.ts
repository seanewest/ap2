import {
  closeSync,
  constants,
  fchmodSync,
  fsyncSync,
  fstatSync,
  lstatSync,
  openSync,
  writeSync,
} from "node:fs";
import { dirname } from "node:path";

export interface JournalSink {
  append(event: ReducedJournalEvent): void;
}

export type ReducedJournalEvent =
  | {
      phase: "opened";
      runMarker: string;
      requestDigest: string;
    }
  | { phase: "attempting"; state: "creating" }
  | {
      phase: "create-result";
      httpClass: string;
      state: "active" | "uncertain" | "refused";
      callIdDigest?: string;
    }
  | {
      phase: "callback";
      state: CallJournalState;
      notificationDigest: string;
      callIdDigest: string;
    }
  | { phase: "hangup-attempting"; callIdDigest: string }
  | {
      phase: "hangup-result";
      httpClass: string;
      state: "accepted" | "uncertain" | "refused";
    }
  | {
      phase: "hangup-observation";
      state: "active" | "terminal" | "missing" | "malformed";
    }
  | {
      phase: "complete";
      outcome: "ended" | "uncertain" | "refused";
      terminalCallback: boolean;
    };

export type CallJournalState =
  | "establishing"
  | "ringing"
  | "connected"
  | "terminating"
  | "terminated";

export class ExclusiveReducedJournal implements JournalSink {
  readonly #fd: number;
  #closed = false;

  private constructor(path: string) {
    const parent = lstatSync(dirname(path));
    if (!parent.isDirectory() || (parent.mode & 0o077) !== 0) {
      throw new Error("Journal directory must be owner-only.");
    }
    this.#fd = openSync(
      path,
      constants.O_CREAT |
        constants.O_EXCL |
        constants.O_WRONLY |
        constants.O_NOFOLLOW,
      0o600,
    );
    fchmodSync(this.#fd, 0o600);
    const file = fstatSync(this.#fd);
    if (!file.isFile() || (file.mode & 0o777) !== 0o600) {
      closeSync(this.#fd);
      throw new Error("Journal file must be a mode-0600 regular file.");
    }
  }

  static open(
    path: string,
    runMarker: string,
    requestDigest: string,
  ): ExclusiveReducedJournal {
    const journal = new ExclusiveReducedJournal(path);
    journal.append({ phase: "opened", runMarker, requestDigest });
    return journal;
  }

  append(event: ReducedJournalEvent): void {
    if (this.#closed) throw new Error("Journal is closed.");
    writeSync(
      this.#fd,
      `${JSON.stringify({ ...event, observedAt: new Date().toISOString() })}\n`,
      undefined,
      "utf8",
    );
    fsyncSync(this.#fd);
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    closeSync(this.#fd);
  }
}
