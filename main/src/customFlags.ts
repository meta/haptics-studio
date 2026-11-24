/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Custom flags to enable experimental features
 */
import fs from 'fs';
import path from 'path';

export interface CustomFlags {
  externalAudio?: boolean;
  pwle?: boolean;
}

export function getCustomFlags(dataPath: string): CustomFlags {
  const flags: CustomFlags = {};
  const filePath = path.join(dataPath, 'flags.json');

  if (!fs.existsSync(filePath)) {
    return flags;
  }

  try {
    const loadedFlags = JSON.parse(
      fs.readFileSync(filePath, 'utf8'),
    ) as CustomFlags;
    return {...loadedFlags, ...flags};
  } catch {
    return flags;
  }
}
