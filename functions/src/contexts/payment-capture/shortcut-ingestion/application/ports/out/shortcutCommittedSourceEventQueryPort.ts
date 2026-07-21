import type { ShortcutCommittedSourceEvent } from "../../../domain/model/shortcutCommittedSourceEvent";

export interface ShortcutCommittedSourceEventQueryPort {
  findById(eventId: string): ShortcutCommittedSourceEvent | undefined;
}
