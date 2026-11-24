/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Export utility functions
 */
import fs from 'fs';
import path from 'path';
import {
  executeRenderer,
  getAmplitudeAndTimingArrays,
  getPwleControlPoints,
  hapticDataToSplitAhap,
  HapticData,
  MetaData,
} from '../../hapticsSdk';
import {PathManager} from '../../services';
import Project, {Clip} from '../project';
import Constants from '../constants';

export interface ExportOptions {
  formats: string[];
  gain?: number;
  sampleRate?: number;
}

/**
 * Prepares the metadata field before the export, by setting the path relative to the export location
 * @param clip the clip to export
 * @param projectFile the project file path, optional
 * @param exportPath the export path
 * @returns the `MetaData` field
 */
export const exportMetadataForClip = (
  clip: Clip,
  projectFile: string | undefined,
  exportPath: string,
): MetaData => {
  const {audioAsset} = clip;

  // Set haptic metadata source path relative to the export location
  const audioAssetPath =
    audioAsset && audioAsset.path && fs.existsSync(audioAsset.path)
      ? audioAsset.path
      : path.dirname(projectFile || PathManager.instance.getHomePath());
  const relativePath = path.relative(path.dirname(exportPath), audioAssetPath);
  return Project.instance.generateClipMetadata(clip, relativePath);
};

/**
 * Exports the haptic data to the specified formats
 * @param filename the filename of the clip
 * @param contentToExport the haptic content to export
 * @param options the export options (formats and gain + sample rate for the Android format)
 * @returns the written paths
 */
export const exportContentWithFormats = (
  filename: string,
  contentToExport: HapticData,
  options: ExportOptions,
): string[] => {
  const exportedPaths: string[] = [];
  for (const format of options.formats) {
    let filePath = '';
    switch (format) {
      case 'ahap': {
        filePath = `${filename}.continuous.ahap`;
        const {continuous, transients} = hapticDataToSplitAhap(contentToExport);
        fs.writeFileSync(filePath, continuous);
        if (transients) {
          fs.writeFileSync(`${filename}.transients.ahap`, transients);
          exportedPaths.push(`${filename}.transients.ahap`);
        }
        break;
      }
      case 'haptic':
        filePath = `${filename}.haptic`;
        fs.writeFileSync(filePath, JSON.stringify(contentToExport));
        break;
      case 'wav': {
        filePath = `${filename}${Constants.EXPORT.SUFFIX}.wav`;
        const renderedHaptic = executeRenderer(
          contentToExport,
          'meta_quest_pro',
          'wav',
        );
        fs.writeFileSync(filePath, renderedHaptic);
        break;
      }
      case 'android': {
        filePath = `${filename}.json`;
        const data = getAmplitudeAndTimingArrays(
          contentToExport,
          options.gain,
          options.sampleRate,
        );
        fs.writeFileSync(filePath, JSON.stringify(data));
        break;
      }
      case 'android-pwle': {
        filePath = `${filename}.pwle.json`;
        const pwleData = getPwleControlPoints(contentToExport, options.gain);
        fs.writeFileSync(filePath, JSON.stringify(pwleData));
        break;
      }
      default:
        break;
    }
    exportedPaths.push(filePath);
  }
  return exportedPaths;
};
