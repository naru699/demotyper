export interface SecretModeState {
  active: boolean;
}

export interface UndoFriendlyEditOptions {
  undoStopBefore: boolean;
  undoStopAfter: boolean;
}

export type SmartReplaceResult = 'applied' | 'inSync' | 'targetMissing' | 'outOfSync';

export interface TargetFileSnapshot {
  uri: string;
  savedAt: number;
  content: string;
}

export type TargetsMap = Record<string, TargetFileSnapshot>;
