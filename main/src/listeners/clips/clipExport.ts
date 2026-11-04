/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Export-related clip handlers
 */

import {dialog} from 'electron';
import {isEmpty, isNil} from 'lodash';
import {IpcInvokeChannel} from '../../../../shared';
import {createIPCHandler} from '../ipcHandlerUtils';
import path from 'path';
import fs from 'fs';
import {randomUUID} from 'crypto';
import rimraf from 'rimraf';
import {promisify} from 'util';
import AdmZip from 'adm-zip';
import {HapticData} from '../../hapticsSdk';

import Configs from '../../common/configs';
import Constants from '../../common/constants';
import MainApplication from '../../application';
import {PathManager} from '../../services';
import Project from '../../common/project';
import {verifyAudioAssetPath} from '../../common/project/assetSecurity';
import {executeRenderer, getAmplitudeAndTimingArrays} from '../../hapticsSdk';
// @oss-disable
import {
  exportContentWithFormats,
  exportMetadataForClip,
  sanitizedEnvelopes,
  sanitizeFilename,
  trimmedHapticData,
} from '../../common/utils';

import {
  ExportPreviewMessage,
  ExportMessage,
  ExternalAuditioningMessage,
} from './types';

/**
 * Get the preview data for the raw format
 */
export function rawExportPreview(): void {
  createIPCHandler<ExportPreviewMessage>(
    IpcInvokeChannel.RawExportPreview,
    (args, event) => {
      const {clips = []} = args;

      if (isEmpty(clips)) {
        event.sender.send('raw_export_preview', {
          action: 'raw_export_preview',
          status: 'error',
          message: 'No clips selected',
        });
        return {status: 'error', message: 'No clips selected'};
      }

      const window = MainApplication.instance.getMainWindow();
      if (isNil(window)) {
        return {status: 'error', message: 'No main window available'};
      }

      const clipCounts: {[key: string]: number} = {};
      const result: {[key: string]: {amplitudes: number[]; timings: number[]}} =
        {};
      for (const clipId of clips) {
        const groupName = Project.instance.getGroupByClipId(clipId);
        const clip = Project.instance.getClipById(clipId);
        if (clip && clip.haptic) {
          const {haptic, name} = clip;
          // Ensure that the clip has a valid haptic data
          let contentToExport = sanitizedEnvelopes(haptic);
          if (contentToExport) {
            const {amplitude, frequency = []} =
              contentToExport.signals.continuous.envelopes;

            // Envelopes should have at least the starting and ending points
            if (amplitude.length > 1 && frequency.length > 1) {
              if (clip.trimAt) {
                contentToExport = trimmedHapticData(
                  contentToExport,
                  clip.trimAt,
                );
              }
              let fullName = groupName ? `${groupName}_${name}` : name;
              // Keep track of the number of files with the same name and add a suffix if needed
              clipCounts[fullName] = (clipCounts[name] ?? 0) + 1;
              if (clipCounts[fullName] > 1) {
                fullName = `${fullName}_${clipCounts[fullName] - 1}`;
                clipCounts[fullName] += 1;
              }
              const data = getAmplitudeAndTimingArrays(
                contentToExport,
                args.gain,
                args.sampleRate,
              );
              result[fullName] = data;
            }
          }
        }
      }

      return {payload: result};
    },
  );
}

/**
 * Exports haptics files with the given formats. Can also package the project into a single zip file
 * containing the haptic files, the project file and the audio assets, if any.
 */
export function exportClips(): void {
  createIPCHandler<ExportMessage>(
    IpcInvokeChannel.ExportClips,
    async (args, event) => {
      const {
        clips = [],
        // @oss-disable
        flatten = false,
        packageProject = false,
      } = args;
      const {projectFile, tmpProjectFile} =
        Configs.instance.getCurrentProject();
      const projectName = Project.instance.getName();

      if (isEmpty(clips)) {
        event.sender.send('export_clips_response', {
          action: 'export_clips',
          status: 'error',
          message: 'No clips selected',
        });
        return {status: 'error', message: 'No clips selected'};
      }

      const window = MainApplication.instance.getMainWindow();
      if (isNil(window)) {
        return {status: 'error', message: 'No main window available'};
      }
      const {lastExportedPath} = Configs.instance.configs;
      const zipExt = '.zip';

      let exportPath = '';
      let zipPath: string | undefined = undefined;
      const defaultPath = projectFile
        ? path.dirname(projectFile)
        : PathManager.instance.getHomePath();

      // If the project is being packaged, the export path is the project file path,
      // otherwise we need to open a folder picker instead, and the export path will be a temporary folder
      if (packageProject) {
        zipPath = dialog.showSaveDialogSync(window, {
          title: 'Share project',
          defaultPath: path.join(
            lastExportedPath || defaultPath,
            `${Project.instance.isAuthoringTutorial() ? `${Constants.PROJECT.TUTORIAL_PREFIX} ` : ''}${projectName}${zipExt}`,
          ),
          properties: ['createDirectory'],
          buttonLabel: 'Save',
        });
        if (isNil(zipPath)) {
          return {status: 'canceled'};
        }

        if (!zipPath.endsWith(zipExt)) {
          zipPath += zipExt;
        }

        const tmpPath = path.dirname(tmpProjectFile);
        const tmpExportPath = path.join(tmpPath, 'exports');
        await promisify(rimraf)(tmpExportPath);
        fs.mkdirSync(tmpExportPath);
        exportPath = tmpExportPath;
      } else {
        const filePaths = dialog.showOpenDialogSync(window, {
          title: 'Export Haptic',
          defaultPath: lastExportedPath || defaultPath,
          properties: ['openDirectory', 'createDirectory'],
          buttonLabel: 'Save',
        });
        if (isNil(filePaths) || filePaths.length === 0) {
          return {status: 'canceled'};
        }
        exportPath = filePaths[0];
      }

      // Ensure that the export path is a directory
      exportPath = fs.lstatSync(exportPath).isDirectory()
        ? exportPath
        : path.dirname(exportPath);

      // Export the clips first
      const exportedFiles: string[] = [];
      const clipCounts: {[key: string]: number} = {};
      for (const clipId of clips) {
        const groupName = Project.instance.getGroupByClipId(clipId);

        // Append the group name to the export path only if flatten is false
        // Note: We sanitize the group name to ensure cross-platform compatibility,
        // as Windows NTFS does not support certain characters or trailing spaces in folder names
        const groupPath =
          !flatten && groupName
            ? path.join(exportPath, sanitizeFilename(groupName))
            : exportPath;
        if (!fs.existsSync(groupPath)) {
          fs.mkdirSync(groupPath);
        }

        const clip = Project.instance.getClipById(clipId);
        if (clip && clip.haptic) {
          const {haptic, name} = clip;
          // Sanitize the clip name for cross-platform compatibility
          const sanitizedName = sanitizeFilename(name);
          // Ensure that the clip has a valid haptic data
          let contentToExport = sanitizedEnvelopes(haptic);
          if (contentToExport) {
            if (clip.trimAt) {
              contentToExport = trimmedHapticData(contentToExport, clip.trimAt);
            }

            contentToExport.metadata = exportMetadataForClip(
              clip,
              projectFile,
              groupPath,
            );
            let filename = path.join(groupPath, sanitizedName);

            // Keep track of the number of files with the same name and add a suffix if needed
            clipCounts[filename] = (clipCounts[filename] ?? 0) + 1;
            if (clipCounts[filename] > 1) {
              filename = path.join(
                groupPath,
                `${sanitizedName} (${clipCounts[filename] - 1})`,
              );
              clipCounts[filename] =
                clipCounts[filename] !== undefined
                  ? clipCounts[filename] + 1
                  : 1;
            }

            const filePaths = exportContentWithFormats(
              filename,
              contentToExport,
              args,
            );
            exportedFiles.push(...filePaths);
          }
        }
      }

      if (packageProject && zipPath) {
        const zip = new AdmZip();

        const content = Project.instance.getExportableContent();

        // Filter clips to only include the ones that are being exported
        const clipIdsSet = new Set(clips);
        if (content.clips) {
          content.clips = content.clips.filter(clip =>
            clipIdsSet.has(clip.clipId),
          );

          // Replace audioAsset.path with just the basename for packaged clips
          for (const clip of content.clips) {
            if (clip.audioAsset && clip.audioAsset.path) {
              clip.audioAsset.path = path.basename(clip.audioAsset.path);
            }
          }
        }

        // Update groups: remove clip IDs that are not in the exported clips, and remove empty groups
        if (content.groups) {
          content.groups = content.groups
            .map(group => ({
              ...group,
              clips: group.clips.filter(clipId => clipIdsSet.has(clipId)),
            }))
            .filter(group => group.clips.length > 0);
        }

        zip.addFile(
          `${projectName}${Constants.PROJECT.EXTENSION}`,
          Buffer.from(JSON.stringify(content)),
        );

        // Package the assets (e.g. tutorial assets)
        if (projectFile) {
          const assetsDir = path.join(
            path.dirname(projectFile),
            Constants.PROJECT.TUTORIAL_ASSETS_FOLDER,
          );
          if (fs.existsSync(assetsDir)) {
            zip.addLocalFolder(
              assetsDir,
              Constants.PROJECT.TUTORIAL_ASSETS_FOLDER,
            );
          }
        }

        // Package the exported haptics
        for (const exportedFile of exportedFiles) {
          const relativePath = path.relative(exportPath, exportedFile);
          const dirPath = path.dirname(relativePath);
          zip.addLocalFile(exportedFile, dirPath === '.' ? '' : dirPath);
        }

        const clipsIndex: {[path: string]: number} = {};
        const clipsCount: {[name: string]: number} = {};
        const clipAssets: string[] = [];

        // Package the clip audio assets
        for (const clipId of clips) {
          const clip = Project.instance.getClipById(clipId);

          if (clip && clip.audioAsset && clip.audioAsset.path) {
            const filename = path.basename(clip.audioAsset.path);
            const extension = path.extname(clip.audioAsset.path);
            const basename = path.basename(clip.audioAsset.path, extension);

            if (!(clip.audioAsset.path in clipsIndex)) {
              clipsCount[filename] = clipsCount[filename] + 1 || 1;
              clipsIndex[clip.audioAsset.path] = clipsCount[filename];
            }

            let suffix =
              clipsIndex[clip.audioAsset.path] > 1
                ? `_${clipsIndex[clip.audioAsset.path] - 1}`
                : '';
            let localFileName = `${basename}${suffix}${extension}`;

            while (
              clipAssets.includes(localFileName) &&
              localFileName !== filename
            ) {
              clipsCount[filename] += 1;
              clipsIndex[clip.audioAsset.path] = clipsCount[filename];
              suffix =
                clipsIndex[clip.audioAsset.path] > 1
                  ? `_${clipsIndex[clip.audioAsset.path] - 1}`
                  : '';
              localFileName = `${basename}${suffix}${extension}`;
            }

            const assetPath = await verifyAudioAssetPath(clip.audioAsset.path);
            if (assetPath) {
              zip.addLocalFile(assetPath, '', localFileName);
            }

            clipAssets.push(localFileName);
          }
        }

        zip.writeZip(zipPath);

        await promisify(rimraf)(exportPath);

        Configs.instance.set('lastExportedPath', path.dirname(zipPath));

        // @oss-disable
      } else {
        Configs.instance.set('lastExportedPath', exportPath);
      }

      // @oss-disable
      // @oss-disable
        // @oss-disable
        // @oss-disable
          // @oss-disable
          // @oss-disable
        // @oss-disable
      // @oss-disable

      return {status: 'ok'};
    },
    {reloadMenu: true},
  );
}

/**
 * Prepare files for external auditioning
 */
export function prepareExternalAuditioning(): void {
  createIPCHandler<ExternalAuditioningMessage>(
    IpcInvokeChannel.ExternalAuditioning,
    async args => {
      const {clipId} = args;
      const clip = Project.instance.getClipById(clipId);
      if (!clip || !clip.haptic) {
        return {status: 'error', message: 'No clip selected'};
      }
      const contentToExport: HapticData = clip.haptic;
      const {tmpProjectFile} = Configs.instance.getCurrentProject();
      const tmpPath = path.dirname(tmpProjectFile);
      const mixesPath = path.join(tmpPath, 'ds');
      await promisify(rimraf)(mixesPath);
      fs.mkdirSync(mixesPath);
      const id = randomUUID();
      const hapticName = `${id}-haptic.wav`;
      const audioName = `${id}-audio.wav`;
      let hasAudio = false;
      const audioPath = clip.audioAsset?.path
        ? await verifyAudioAssetPath(clip.audioAsset.path)
        : undefined;
      if (audioPath) {
        fs.copyFileSync(audioPath, path.join(mixesPath, audioName));
        hasAudio = true;
      }
      const finalFilePath = path.join(mixesPath, hapticName);
      const renderedHaptic = executeRenderer(
        contentToExport,
        'meta_quest_pro',
        'wav',
      );
      fs.writeFileSync(finalFilePath, renderedHaptic);

      return {
        payload: {
          haptic: `./ds/${hapticName}`,
          audio: hasAudio ? `./ds/${audioName}` : undefined,
        },
      };
    },
  );
}

/**
 * Bind export-related IPC handlers
 */
export default function bindExportHandlers(): void {
  rawExportPreview();
  exportClips();
  prepareExternalAuditioning();
}
