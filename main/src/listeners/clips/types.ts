/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Shared types and interfaces for clips listeners
 */

import {HapticData, VisualWaveform} from '../../hapticsSdk';
import {OathSettings} from '../../common/project';

export interface ExportPreviewMessage {
  clips: string[];
  gain: number;
  sampleRate: number;
}

export type ExportFormat =
  | 'ahap'
  | 'haptic'
  | 'wav'
  | 'android'
  | 'android-pwle';

export interface ExportMessage {
  clips: string[];
  formats: ExportFormat[];
  packageProject: boolean;
  flatten: boolean;
  gain?: number;
  sampleRate?: number;
}

export interface ImportHapticMessage {
  clipId: string;
  name: string;
  path: string; // Haptic file path
}

export interface ImportHapticPayload {
  clipId?: string;
  sessionId?: string;
  audio?: {hapticPath: string; name: string};
  svg?: VisualWaveform;
  haptic?: HapticData;
  settings?: OathSettings;
}

export interface AudioAnalysisMessage {
  silent: boolean;
  files: AudioAnalysisFile[];
}

export interface RetryAudioAnalysisMessage {
  clipId: string;
  settings: OathSettings;
}

export interface AudioAnalysisUpdateMessage {
  clipId: string;
  settings: OathSettings;
  group: 'amplitude' | 'frequency';
}

export interface AudioAnalysisFile {
  clipId: string;
  path: string; // Audio file path
  settings: OathSettings; // Analysis Settings
  name?: string; // Optional clip name, the filename is used if not provided
}

export interface StereoSplitMessage {
  clipId: string;
  channels: StereoSplitChannel[];
  settings: OathSettings;
}

export interface StereoSplitChannel {
  clipId: string;
  name: string;
}

export interface HapticUpdateMessage {
  clipId: string;
  haptic: HapticData; // Haptic file content
}

export interface CreateEmptyClipMessage {
  clipId: string;
  name: string;
}

export interface ExternalAuditioningMessage {
  clipId: string;
}
