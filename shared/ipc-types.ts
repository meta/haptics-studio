/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import {IpcInvokeChannel, IpcSendChannel} from './ipc-channels';

// ---------------------------------------------------------------------------
// Re-exported domain types (already shared between main & frontend)
// ---------------------------------------------------------------------------

import type {HapticData, VisualWaveform} from '../main/src/hapticsSdk';
import type {
  ClipGroup,
  ClipMarker,
  OathSettings,
} from '../main/src/common/project';
import type {ProjectMetadata} from '../main/src/common/configs';
import type {
  ActivityEssential,
  AnalyticsMessageParameters,
  TelemetryConsentState,
} from '../main/src/analytics';
import type {OpenPayload} from '../main/src/actions/project';

export type {
  HapticData,
  VisualWaveform,
  ClipGroup,
  ClipMarker,
  OathSettings,
  ProjectMetadata,
  ActivityEssential,
  AnalyticsMessageParameters,
  TelemetryConsentState,
  OpenPayload,
};

// ---------------------------------------------------------------------------
// Shared structural types (avoid importing Node-only modules)
// ---------------------------------------------------------------------------

/** Standard envelope returned by main in every `IPCMessage`. */
export interface IPCResponse<T = Record<string, unknown>> {
  action: string;
  status: 'ok' | 'error' | 'canceled' | 'invalid';
  payload?: T;
  message?: string;
  clipId?: string;
  reason?: string;
}

/** Audio asset descriptor returned by relocate / add-audio handlers. */
export interface AudioAssetInfo {
  path: string;
  name?: string;
  exists?: boolean;
  hapticPath?: string;
}

// ---------------------------------------------------------------------------
// Per-channel payload types
// ---------------------------------------------------------------------------

// -- App / globals ----------------------------------------------------------

export interface TermsAndConditionsRequest {
  termsAccepted: boolean;
}
export interface TermsAndConditionsResponse {
  termsAccepted: boolean;
}

export interface RecentProjectsResponse {
  projects: Array<ProjectMetadata & {error: string | undefined}>;
}

export interface SamplesResponse {
  samples: ProjectMetadata[];
}

export interface ToggleDefaultControlsRequest {
  enabled: boolean;
}

export type ToggleMenuItemsRequest = {[key: string]: boolean | undefined};

// -- Analytics / telemetry --------------------------------------------------

export interface FrontendAnalyticsMessageRequest {
  activity: string;
  message: Partial<AnalyticsMessageParameters>;
}

export interface FrontendErrorRaisedRequest {
  name: string;
  message: string;
  stack?: string;
}

export interface TelemetrySaveConsentStateRequest {
  consent: boolean;
}

// TelemetryConsentState is the response type for:
//   telemetry_consent_state
//   telemetry_save_consent_state
//   telemetry_set_consent_notification_shown

// -- Device -----------------------------------------------------------------

export interface DisconnectDeviceRequest {
  deviceId: string;
}

// -- Menu -------------------------------------------------------------------

export interface ToggleEmphasisRequest {
  checked?: boolean;
  enabled?: boolean;
}

export interface ToggleCopyRequest {
  enabled: boolean;
}

export interface CopyRequest {
  payload: {
    amplitude: unknown[];
    frequency: unknown[];
  };
}

// -- Files ------------------------------------------------------------------

export interface AddFilesRequest {
  properties?: Array<'openDirectory' | 'openFile'>;
}

export interface FileSelectedRequest {
  file: string;
}

// -- Project ----------------------------------------------------------------

export type OpenProjectRequest = Partial<ProjectMetadata>;
// Response is a full IPCMessage (custom response from loadProject)

export interface LoadProjectSuccessRequest {
  projectExists: boolean;
}

export interface RenameProjectRequest {
  name: string;
}

export type UpdateMetadataRequest = Omit<ProjectMetadata, 'name'>;

// -- Clips CRUD -------------------------------------------------------------

export interface SetCurrentClipRequest {
  clipId: string;
}

export interface UpdateClipNameRequest {
  clipId: string;
  name: string;
}

export interface UpdateNotesRequest {
  clipId: string;
  notes: string;
}

export interface UpdateMarkersRequest {
  clipId: string;
  markers: ClipMarker[];
}

export interface UpdateTrimRequest {
  clipId: string;
  trim: number | undefined;
}

export interface UpdatePlayheadRequest {
  clipId: string;
  playhead: number;
}

export interface DuplicateClipsRequest {
  clips: Array<{originalClipId: string; clipId: string; name: string}>;
}

export interface DeleteClipsRequest {
  clipIds: string[];
}

// -- Clips audio / haptic ---------------------------------------------------

export interface HapticUpdateRequest {
  clipId: string;
  haptic: HapticData;
}

export interface RelocateAssetRequest {
  clipId: string;
}
export interface RelocateAssetResponse {
  clipId: string;
  audioAsset: AudioAssetInfo;
}

export interface AddAudioToClipRequest {
  clipId: string;
}
export interface AddAudioToClipResponse {
  clipId: string;
  audioAsset: AudioAssetInfo;
  waveform: VisualWaveform;
}

export interface ExternalAuditioningRequest {
  clipId: string;
}

export interface ExternalAuditioningResponse {
  haptic: string;
  audio: string;
}

// -- Clips export -----------------------------------------------------------

export type ExportFormat =
  | 'ahap'
  | 'haptic'
  | 'wav'
  | 'android'
  | 'android-pwle';

export interface ExportClipsRequest {
  clips: string[];
  formats: ExportFormat[];
  packageProject: boolean;
  flatten: boolean;
  gain?: number;
  sampleRate?: number;
}

export interface RawExportPreviewRequest {
  clips: string[];
  gain: number;
  sampleRate: number;
}

export interface RawExportPreviewResponse {
  [key: string]: {
    amplitudes: number[];
    timings: number[];
  };
}

// -- Clips analysis / import (fire-and-forget) ------------------------------

export interface AudioAnalysisFile {
  clipId: string;
  path: string;
  settings: OathSettings;
  name?: string;
}

export interface AudioAnalysisRequest {
  silent: boolean;
  files: AudioAnalysisFile[];
}

export interface UpdateAudioAnalysisRequest {
  clipId: string;
  settings: OathSettings;
  group: 'amplitude' | 'frequency';
}

export interface ImportHapticsRequest {
  files: Array<{clipId: string; path: string}>;
}

export interface RetryAudioAnalysisRequest {
  clipId: string;
  settings: OathSettings;
}

export interface StereoSplitChannel {
  clipId: string;
  name: string;
}

export interface SplitStereoClipRequest {
  clipId: string;
  channels: StereoSplitChannel[];
  settings: OathSettings;
}

export interface CreateEmptyClipRequest {
  clipId: string;
  name: string;
}

export interface OpenSystemFolderAtRequest {
  path: string;
}

export interface RendererFatalErrorRequest {
  message: string;
}

export interface OpenExternalUrlRequest {
  url: string;
}

export interface WriteClipboardTextRequest {
  text: string;
}

// -- WebSocket

// -- WebSocket --------------------------------------------------------------

export interface WsSetPlayheadRequest {
  clipId: string;
  playhead: number;
}

// ---------------------------------------------------------------------------
// Channel → type map  (invoke channels)
// ---------------------------------------------------------------------------

/**
 * Maps each invoke channel to its { request, response } types.
 *
 * Usage:
 *   type Req = IpcInvokeMap[typeof IpcInvokeChannel.AddFiles]['request'];
 *   type Res = IpcInvokeMap[typeof IpcInvokeChannel.AddFiles]['response'];
 */
export interface IpcInvokeMap {
  // App / globals
  [IpcInvokeChannel.TermsAndConditions]: {
    request: TermsAndConditionsRequest;
    response: TermsAndConditionsResponse;
  };
  [IpcInvokeChannel.RecentProjects]: {
    request: void;
    response: RecentProjectsResponse;
  };
  [IpcInvokeChannel.Samples]: {
    request: void;
    response: SamplesResponse;
  };
  [IpcInvokeChannel.ToggleDefaultControls]: {
    request: ToggleDefaultControlsRequest;
    response: void;
  };
  [IpcInvokeChannel.ToggleMenuItems]: {
    request: ToggleMenuItemsRequest;
    response: void;
  };
  [IpcInvokeChannel.NewProject]: {
    request: void;
    response: void;
  };

  // Analytics / telemetry
  [IpcInvokeChannel.FrontendAnalyticsMessage]: {
    request: FrontendAnalyticsMessageRequest;
    response: void;
  };
  [IpcInvokeChannel.FrontendErrorRaised]: {
    request: FrontendErrorRaisedRequest;
    response: void;
  };
  [IpcInvokeChannel.TelemetryConsentState]: {
    request: void;
    response: TelemetryConsentState;
  };
  [IpcInvokeChannel.TelemetrySaveConsentState]: {
    request: TelemetrySaveConsentStateRequest;
    response: TelemetryConsentState;
  };
  [IpcInvokeChannel.TelemetrySetConsentNotificationShown]: {
    request: void;
    response: TelemetryConsentState;
  };

  // Device
  [IpcInvokeChannel.DevicesStatusRequest]: {
    request: void;
    response: void;
  };
  [IpcInvokeChannel.DisconnectDevice]: {
    request: DisconnectDeviceRequest;
    response: void;
  };
  [IpcInvokeChannel.WsAuthCodeRequest]: {
    request: void;
    response: void;
  };
  [IpcInvokeChannel.ToggleDevicePanel]: {
    request: {open: boolean};
    response: void;
  };
  [IpcInvokeChannel.StopAdvertising]: {
    request: void;
    response: void;
  };

  // Menu
  [IpcInvokeChannel.ToggleEmphasis]: {
    request: ToggleEmphasisRequest;
    response: void;
  };
  [IpcInvokeChannel.ToggleCopy]: {
    request: ToggleCopyRequest;
    response: void;
  };
  [IpcInvokeChannel.Copy]: {
    request: CopyRequest;
    response: void;
  };

  // Updater
  [IpcInvokeChannel.DownloadUpdate]: {
    request: void;
    response: void;
  };
  [IpcInvokeChannel.QuitAndInstall]: {
    request: void;
    response: void;
  };

  // Files
  [IpcInvokeChannel.AddFiles]: {
    request: AddFilesRequest;
    response: unknown; // custom response from addFiles action
  };
  [IpcInvokeChannel.FileSelected]: {
    request: FileSelectedRequest;
    response: void;
  };
  [IpcInvokeChannel.OpenProject]: {
    request: void;
    response: void;
  };

  // Project
  [IpcInvokeChannel.Open]: {
    request: OpenProjectRequest;
    response: OpenPayload;
  };
  [IpcInvokeChannel.LoadCurrentProject]: {
    request: void;
    response: OpenPayload;
  };
  [IpcInvokeChannel.CloseCurrentProject]: {
    request: void;
    response: void;
  };
  [IpcInvokeChannel.RenameProject]: {
    request: RenameProjectRequest;
    response: void;
  };
  [IpcInvokeChannel.UpdateMetadata]: {
    request: UpdateMetadataRequest;
    response: void;
  };
  [IpcInvokeChannel.UpdateGroups]: {
    request: ClipGroup[];
    response: void;
  };

  // Clips – CRUD
  [IpcInvokeChannel.SetCurrentClip]: {
    request: SetCurrentClipRequest;
    response: void;
  };
  [IpcInvokeChannel.UpdateClipName]: {
    request: UpdateClipNameRequest;
    response: void;
  };
  [IpcInvokeChannel.UpdateNotes]: {
    request: UpdateNotesRequest;
    response: void;
  };
  [IpcInvokeChannel.UpdateMarkers]: {
    request: UpdateMarkersRequest;
    response: unknown; // custom response
  };
  [IpcInvokeChannel.UpdateTrim]: {
    request: UpdateTrimRequest;
    response: void;
  };
  [IpcInvokeChannel.UpdatePlayhead]: {
    request: UpdatePlayheadRequest;
    response: unknown; // custom response
  };
  [IpcInvokeChannel.DuplicateClips]: {
    request: DuplicateClipsRequest;
    response: void;
  };
  [IpcInvokeChannel.DeleteClips]: {
    request: DeleteClipsRequest;
    response: void;
  };

  // Clips – audio / haptic
  [IpcInvokeChannel.HapticUpdate]: {
    request: HapticUpdateRequest;
    response: void;
  };
  [IpcInvokeChannel.RelocateAsset]: {
    request: RelocateAssetRequest;
    response: RelocateAssetResponse;
  };
  [IpcInvokeChannel.AddAudioToClip]: {
    request: AddAudioToClipRequest;
    response: AddAudioToClipResponse;
  };
  [IpcInvokeChannel.ExternalAuditioning]: {
    request: ExternalAuditioningRequest;
    response: ExternalAuditioningResponse; // audio preview data
  };

  // Clips – export
  [IpcInvokeChannel.ExportClips]: {
    request: ExportClipsRequest;
    response: unknown; // export result
  };
  [IpcInvokeChannel.RawExportPreview]: {
    request: RawExportPreviewRequest;
    response: RawExportPreviewResponse;
  };

  // WebSocket
  [IpcInvokeChannel.SetPlayhead]: {
    request: WsSetPlayheadRequest;
    response: void;
  };
}

// ---------------------------------------------------------------------------
// Channel → type map  (send channels — fire-and-forget, no response)
// ---------------------------------------------------------------------------

export interface IpcSendMap {
  [IpcSendChannel.QuitApplication]: void;
  [IpcSendChannel.RendererFatalError]: RendererFatalErrorRequest;
  [IpcSendChannel.OpenExternalUrl]: OpenExternalUrlRequest;
  [IpcSendChannel.WriteClipboardText]: WriteClipboardTextRequest;
  [IpcSendChannel.OpenExportFolder]: void;
  [IpcSendChannel.OpenSystemFolderAt]: OpenSystemFolderAtRequest;
  [IpcSendChannel.Paste]: void;
  [IpcSendChannel.LoadProjectSuccess]: LoadProjectSuccessRequest;
  [IpcSendChannel.AudioAnalysis]: AudioAnalysisRequest;
  [IpcSendChannel.UpdateAudioAnalysis]: UpdateAudioAnalysisRequest;
  [IpcSendChannel.ImportHaptics]: ImportHapticsRequest;
  [IpcSendChannel.RetryAudioAnalysis]: RetryAudioAnalysisRequest;
  [IpcSendChannel.SplitStereoClip]: SplitStereoClipRequest;
  [IpcSendChannel.CreateEmptyClip]: CreateEmptyClipRequest;
}
