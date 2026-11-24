/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import path from 'path';
import fs from 'fs';
import {has, isEmpty, isNil, isObject, merge} from 'lodash';

import Configs from './common/configs';
import MainApplication from './application';
import {PathManager} from './services';
import Project, {OathSettings} from './common/project';
import Logger from './common/logger';
import {loadJSONFile} from './common/utils';
import type {
  AmplitudeBreakpoint,
  FrequencyBreakpoint,
  VisualWaveform,
  HapticData,
  Acf,
  RenderSettings,
  WaveformRenderSettings,
  OfflineAnalysisSettings,
  PreprocessingSettings,
  Waveform,
  SplitAhap,
  MetaData,
  Envelopes,
  TimeAmplitude,
  PwleRenderSettings,
  PwleEnvelope,
} from './types/haptics_sdk_types';

export type {
  AmplitudeBreakpoint,
  FrequencyBreakpoint,
  VisualWaveform,
  HapticData,
  OfflineAnalysisSettings,
  PreprocessingSettings,
  MetaData,
  Envelopes,
  TimeAmplitude,
  PwleEnvelope,
};

interface AudioData {}

export interface HapticsSdkNapi {
  renderHapticDataToAudio(
    hapticData: HapticData,
    acf: Acf,
    renderSettings: RenderSettings,
  ): Uint8Array;
  decodeAudioData(data: Uint8Array, extension?: string): AudioData;
  preprocessAudioData(data: AudioData, settings: PreprocessingSettings): void;
  generateWaveformOverview(audioData: AudioData): VisualWaveform;
  runAudioToHapticsAnalysis(
    data: AudioData,
    settings: OfflineAnalysisSettings,
  ): HapticData;
  validateJsonString(json: string): void;
  renderHapticDataToWaveform(
    hapticData: HapticData,
    settings: WaveformRenderSettings,
  ): Waveform;
  defaultWaveformRenderSettings(): WaveformRenderSettings;
  renderHapticDataToPwle(
    hapticData: HapticData,
    settings: PwleRenderSettings,
  ): PwleEnvelope;
  defaultPwleRenderSettings(): PwleRenderSettings;
  hapticDataToSplitAhap(hapticData: HapticData): SplitAhap;
}

export interface ClipboardContent {
  amplitude: AmplitudeBreakpoint[];
  frequency: FrequencyBreakpoint[];
}

export interface OathResult {
  waveform: VisualWaveform;
  result: HapticData;
}

export type Actuator = 'l5' | 'l7' | 'meta_quest_pro' | 'android';
export type Renderer = 'questTouchPro' | 'wav' | 'raw' | 'android';

/**
 * Extract audio data from file
 * @param inputAudioFilePath The file path
 * @returns The `AudioData`
 */
function decodedAudioDataFor(inputAudioFilePath: string): AudioData {
  const audioFile = Project.instance.isCurrentAudio(inputAudioFilePath)
    ? Project.instance.getCurrentAudio()
    : fs.readFileSync(inputAudioFilePath);
  if (isNil(audioFile)) {
    throw new Error(
      `executeOath: Error loading audio file ${inputAudioFilePath}`,
    );
  }
  return MainApplication.HapticsSdkNapi.decodeAudioData(
    audioFile as Uint8Array,
  );
}

/**
 * Call the Haptics SDK decoder and return only the waveform
 * @param inputAudioFilePath - Input audio file path
 * @returns The waveform
 * @throws {Error} If the audio file cannot be loaded
 */
export function getWaveform(inputAudioFilePath: string): VisualWaveform {
  const decodedAudioData = decodedAudioDataFor(inputAudioFilePath);
  return MainApplication.HapticsSdkNapi.generateWaveformOverview(
    decodedAudioData,
  );
}

/**
 * Call the Haptics SDK DSP. Note that the frequency envelope is normalized in a separate preprocessing step.
 * @param inputAudioFilePath - Input audio file path
 * @param settings - The JSON analysis settings
 * @returns The Haptic data
 */
export function executeOath(
  inputAudioFilePath: string,
  settings: OathSettings,
): OathResult {
  const decodedAudioData = decodedAudioDataFor(inputAudioFilePath);
  MainApplication.HapticsSdkNapi.preprocessAudioData(
    decodedAudioData,
    settings.preprocessing,
  );
  const waveform =
    MainApplication.HapticsSdkNapi.generateWaveformOverview(decodedAudioData);
  const result = MainApplication.HapticsSdkNapi.runAudioToHapticsAnalysis(
    decodedAudioData,
    settings.offline,
  );
  MainApplication.HapticsSdkNapi.preprocessAudioData(decodedAudioData, {
    ...settings.preprocessing,
    normalize_audio: true,
  });
  const frequencyData =
    MainApplication.HapticsSdkNapi.runAudioToHapticsAnalysis(
      decodedAudioData,
      settings.offline,
    );
  result.signals.continuous.envelopes.frequency =
    frequencyData.signals.continuous.envelopes.frequency;

  return {waveform, result};
}

/**
 * Call the DSP and only return the amplitude envelope.
 * @param inputAudioFilePath The input audio file path
 * @param settings - The JSON analysis settings
 */
export function updateAmplitudeEnvelope(
  inputAudioFilePath: string,
  settings: OathSettings,
): AmplitudeBreakpoint[] {
  const decodedAudioData = decodedAudioDataFor(inputAudioFilePath);

  // Run the analysis without normalization for the amplitude envelope
  MainApplication.HapticsSdkNapi.preprocessAudioData(
    decodedAudioData,
    settings.preprocessing,
  );
  const result = MainApplication.HapticsSdkNapi.runAudioToHapticsAnalysis(
    decodedAudioData,
    settings.offline,
  );

  return result.signals.continuous.envelopes.amplitude;
}

/**
 * Call the DSP and only return the frequency envelope. The audio is normalized before the analysis.
 * @param inputAudioFilePath The input audio file path
 * @param settings - The JSON analysis settings
 */
export function updateFrequencyEnvelope(
  inputAudioFilePath: string,
  settings: OathSettings,
): FrequencyBreakpoint[] | undefined {
  const decodedAudioData = decodedAudioDataFor(inputAudioFilePath);

  // Run the analysis without normalization for the amplitude envelope
  MainApplication.HapticsSdkNapi.preprocessAudioData(decodedAudioData, {
    ...settings.preprocessing,
    normalize_audio: true,
  });
  const result = MainApplication.HapticsSdkNapi.runAudioToHapticsAnalysis(
    decodedAudioData,
    settings.offline,
  );

  return result.signals.continuous.envelopes.frequency;
}

/**
 * Call Haptics SDK NAPI Renderer
 * @param hapticData - The haptic data to render
 * @param actuator - The ACF file name
 * @param renderer - The render settings file name
 * @param acfOverride - Optional ACF override parameters to apply to the ACF file
 * @param settingsOverride - Optional settings override parameters to apply to the settings file
 */
export function executeRenderer(
  hapticData: HapticData,
  actuator: Actuator,
  renderer: Renderer,
  acfOverride?: Partial<Acf>,
  settingsOverride?: Partial<RenderSettings>,
): Uint8Array {
  const {actuators, renderers} = Configs.configs;
  const actuatorsPath =
    process.env.NODE_ENV === 'development'
      ? path.resolve(actuators.path)
      : path.join(PathManager.instance.getResourcesPath(), actuators.path);
  const renderersPath =
    process.env.NODE_ENV === 'development'
      ? path.resolve(renderers.path)
      : path.join(PathManager.instance.getResourcesPath(), renderers.path);
  const acfFilePath = path.join(actuatorsPath, `${actuator}.acf`);
  const rendererSettingsFilePath = path.join(
    renderersPath,
    `${renderer}.settings`,
  );
  const acf = loadJSONFile<Acf>(acfFilePath);
  if (acfOverride) {
    merge(acf, acfOverride);
  }
  const rendererSettings = loadJSONFile<RenderSettings>(
    rendererSettingsFilePath,
  );
  if (settingsOverride) {
    merge(rendererSettings, settingsOverride);
  }
  Logger.debug('acf', acf);
  Logger.debug('rendererSettings', rendererSettings);
  const renderedHaptic = MainApplication.HapticsSdkNapi.renderHapticDataToAudio(
    hapticData,
    acf,
    rendererSettings,
  );
  return renderedHaptic;
}

/**
 * Checks that the supplied JSON string is a valid haptic JSON string of
 * any version.
 *
 * If the JSON string is not valid, returns false.
 * @param {string} json
 */
export function validateJsonString(json: string): boolean {
  try {
    MainApplication.HapticsSdkNapi.validateJsonString(json);
  } catch (error) {
    const {message} = error as Error;
    Logger.error(message);
    return false;
  }
  return true;
}

/**
 * Checks if the clipboard content is a valid pastable content
 * @param content The clipboard content
 * @returns {boolean}
 */
export function isContentValid(content: ClipboardContent): boolean {
  if (!isObject(content)) {
    return false;
  }
  if (isNil(content.amplitude) || isNil(content.frequency)) {
    return false;
  }
  const {amplitude = [], frequency = []} = content;
  let valid = true;
  if (Array.isArray(amplitude)) {
    if (!isEmpty(amplitude)) {
      const [element] = amplitude;
      valid = valid && has(element, 'time') && has(element, 'amplitude');
    }
  } else {
    valid = false;
  }
  if (Array.isArray(frequency)) {
    if (!isEmpty(frequency)) {
      const [element] = frequency;
      valid = valid && has(element, 'time') && has(element, 'frequency');
    }
  } else {
    valid = false;
  }
  return valid;
}

/**
 * Get the amplitude and timing arrays from the haptic data
 * @param hapticData the haptic data
 * @param gain optional gain to apply to the amplitude array
 * @param sampleRate optional sample rate to use for the timing array
 */
export function getAmplitudeAndTimingArrays(
  hapticData: HapticData,
  gain?: number,
  sampleRate?: number,
): {
  amplitudes: number[];
  timings: number[];
} {
  const settings =
    MainApplication.HapticsSdkNapi.defaultWaveformRenderSettings();
  if (gain !== undefined) {
    settings.gain = gain;
  }
  if (sampleRate) {
    settings.sample_duration.nanos = Math.round(1_000_000_000 / sampleRate);
  }
  const renderedHaptic =
    MainApplication.HapticsSdkNapi.renderHapticDataToWaveform(
      hapticData,
      settings,
    );
  return {
    amplitudes: renderedHaptic.amplitudes,
    timings: renderedHaptic.timings_ms,
  };
}

export function hapticDataToSplitAhap(hapticData: HapticData): SplitAhap {
  return MainApplication.HapticsSdkNapi.hapticDataToSplitAhap(hapticData);
}

/**
 * Get the PWLE control points from the haptic data
 * @param hapticData the haptic data
 * @param gain optional gain to apply to the amplitude values
 */
export function getPwleControlPoints(
  hapticData: HapticData,
  gain?: number,
): PwleEnvelope {
  const settings = MainApplication.HapticsSdkNapi.defaultPwleRenderSettings();
  if (gain !== undefined) {
    settings.gain = gain;
  }
  return MainApplication.HapticsSdkNapi.renderHapticDataToPwle(
    hapticData,
    settings,
  );
}
