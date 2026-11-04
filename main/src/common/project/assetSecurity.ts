/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Asset Security - Validation of clip audio asset paths coming from project files
 */

import fs from 'fs';
import path from 'path';
import Constants from '../constants';
import {getMediaMetadata} from '../utils/media';
import {Clip} from './types';

export interface ExternalAudioAsset {
  clipId: string;
  path: string;
}

export function isWithinRoot(filePath: string, root: string): boolean {
  const relativePath = path.relative(root, filePath);
  return (
    relativePath === '' ||
    (relativePath !== '..' &&
      !relativePath.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relativePath))
  );
}

export function getCanonicalPath(filePath: string): string | undefined {
  try {
    return fs.realpathSync(filePath);
  } catch {
    return undefined;
  }
}

export function hasSupportedAudioExtension(filePath: string): boolean {
  return Constants.PROJECT.SUPPORTED_AUDIO_EXTENSIONS.includes(
    path.extname(filePath).toLowerCase(),
  );
}

function isRegularFile(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

/**
 * Returns the canonical path of an existing regular file whose declared and
 * resolved names both carry a supported audio extension.
 */
export function resolveAudioAssetPath(filePath: string): string | undefined {
  if (!hasSupportedAudioExtension(filePath)) {
    return undefined;
  }
  const canonicalPath = getCanonicalPath(filePath);
  if (
    !canonicalPath ||
    !hasSupportedAudioExtension(canonicalPath) ||
    !isRegularFile(canonicalPath)
  ) {
    return undefined;
  }
  return canonicalPath;
}

/**
 * Like resolveAudioAssetPath, and additionally requires the file content to
 * parse as audio.
 */
export async function verifyAudioAssetPath(
  filePath: string,
): Promise<string | undefined> {
  const canonicalPath = resolveAudioAssetPath(filePath);
  if (!canonicalPath) {
    return undefined;
  }
  try {
    const {duration} = await getMediaMetadata(canonicalPath);
    return duration > 0 ? canonicalPath : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Splits the clips audio assets of a freshly opened project into assets that
 * must be dropped (not audio) and existing audio assets located outside the
 * project folder. Missing files are left to the relocate flow.
 */
export function classifyAudioAssets(
  clips: Clip[],
  projectFile: string,
): {nonAudio: string[]; external: ExternalAudioAsset[]} {
  const projectDir = getCanonicalPath(path.dirname(projectFile));
  const nonAudio: string[] = [];
  const external: ExternalAudioAsset[] = [];

  for (const clip of clips) {
    const assetPath = clip.audioAsset?.path;
    if (!assetPath) continue;

    if (!hasSupportedAudioExtension(assetPath)) {
      nonAudio.push(clip.clipId);
      continue;
    }

    const canonicalPath = getCanonicalPath(assetPath);
    if (!canonicalPath) continue;

    if (!resolveAudioAssetPath(assetPath)) {
      nonAudio.push(clip.clipId);
    } else if (!projectDir || !isWithinRoot(canonicalPath, projectDir)) {
      external.push({clipId: clip.clipId, path: assetPath});
    }
  }

  return {nonAudio, external};
}
