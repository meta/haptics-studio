/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * ProtocolHandler - Registers and handles the media:// protocol
 *
 * Resolves media:// URLs to local file paths by checking:
 * 1. Absolute paths
 * 2. Project-relative paths
 * 3. Assets folder
 * 4. Samples folder (fallback)
 */

import path from 'path';
import {pathToFileURL} from 'url';
import {net, protocol} from 'electron';

import Logger from '../common/logger';
import Configs from '../common/configs';
import Constants from '../common/constants';
import Project from '../common/project';
import {
  getCanonicalPath,
  isWithinRoot,
  resolveAudioAssetPath,
} from '../common/project/assetSecurity';
import {isOnWindows} from '../common/utils';
import PathManager from './PathManager';

function normalizeForComparison(filePath: string): string {
  const normalizedPath = path.normalize(filePath);
  return isOnWindows() ? normalizedPath.toLowerCase() : normalizedPath;
}

function getContainedCanonicalPath(
  filePath: string,
  root: string,
): string | undefined {
  const canonicalRoot = getCanonicalPath(root);
  const canonicalFilePath = getCanonicalPath(path.resolve(root, filePath));
  if (
    canonicalRoot &&
    canonicalFilePath &&
    isWithinRoot(canonicalFilePath, canonicalRoot)
  ) {
    return canonicalFilePath;
  }
  return undefined;
}

function isReferencedAudioAsset(filePath: string): boolean {
  const canonicalPath = resolveAudioAssetPath(filePath);
  if (!canonicalPath) {
    return false;
  }
  const comparablePath = normalizeForComparison(canonicalPath);
  return Project.instance.getClips().some(clip => {
    const audioPath = clip.audioAsset?.path;
    const canonicalAudioPath = audioPath && getCanonicalPath(audioPath);
    return (
      canonicalAudioPath !== undefined &&
      normalizeForComparison(canonicalAudioPath) === comparablePath
    );
  });
}

function fetchContainedFile(
  filePath: string,
  root: string,
): ReturnType<typeof net.fetch> | undefined {
  const canonicalFilePath = getContainedCanonicalPath(filePath, root);
  if (canonicalFilePath) {
    return net.fetch(pathToFileURL(canonicalFilePath).href);
  }
  return undefined;
}

export default class ProtocolHandler {
  /**
   * Registers the media:// protocol handler.
   * Must be called after app.whenReady().
   */
  static register(): void {
    protocol.handle('media', request => {
      let filePath = request.url.replace(/(media:\/\/)/, '');

      // Decode URI components (including %3A back to :)
      try {
        filePath = decodeURIComponent(filePath);
      } catch {
        // If decoding fails, use the original path
      }

      // On Windows, normalize the path by converting forward slashes to backslashes
      // This is needed because we send URLs with forward slashes to avoid CSS escape issues
      if (isOnWindows()) {
        filePath = filePath.replace(/\//g, '\\');
      }

      const supportedExtensions = [
        ...Constants.PROJECT.SUPPORTED_AUDIO_EXTENSIONS,
        ...Constants.PROJECT.SUPPORTED_IMAGE_EXTENSIONS,
        ...Constants.PROJECT.SUPPORTED_VIDEO_EXTENSIONS,
      ];
      if (!supportedExtensions.includes(path.extname(filePath).toLowerCase())) {
        Logger.warn(`Unsupported media type at path: ${filePath}`);
        return new Response();
      }

      const {tmpProjectFile} = Configs.instance.getCurrentProject();
      const tmpProjectDir = tmpProjectFile
        ? path.dirname(tmpProjectFile)
        : undefined;
      const knownRoots = [
        tmpProjectDir,
        PathManager.instance.getAssetsPath(),
        PathManager.instance.getSamplesPath(),
        PathManager.instance.getResourcesPath(),
      ].filter((root): root is string => root !== undefined);

      // Absolute user audio is allowed only when the current project references it.
      if (path.isAbsolute(filePath)) {
        const canonicalFilePath = getCanonicalPath(filePath);
        const isAllowed =
          canonicalFilePath !== undefined &&
          (knownRoots.some(root => {
            const canonicalRoot = getCanonicalPath(root);
            return (
              canonicalRoot !== undefined &&
              isWithinRoot(canonicalFilePath, canonicalRoot)
            );
          }) ||
            isReferencedAudioAsset(filePath));
        if (isAllowed && canonicalFilePath) {
          return net.fetch(pathToFileURL(canonicalFilePath).href);
        }
        Logger.warn(`Disallowed or missing absolute media path: ${filePath}`);
        return new Response();
      }

      if (tmpProjectDir) {
        const projectFile = fetchContainedFile(filePath, tmpProjectDir);
        if (projectFile) {
          return projectFile;
        }
      }

      const assetsFile = fetchContainedFile(
        filePath,
        PathManager.instance.getAssetsPath(),
      );
      if (assetsFile) {
        return assetsFile;
      }

      const samplesFile = fetchContainedFile(
        filePath,
        PathManager.instance.getSamplesPath(),
      );
      if (samplesFile) {
        return samplesFile;
      }

      Logger.warn(`Missing media at path: ${filePath}`);
      return new Response();
    });
  }
}
