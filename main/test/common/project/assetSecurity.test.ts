/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';

import {Clip} from '../../../src/common/project';
import {
  classifyAudioAssets,
  resolveAudioAssetPath,
  verifyAudioAssetPath,
} from '../../../src/common/project/assetSecurity';

describe('assetSecurity', () => {
  const sampleAudio = path.join(__dirname, '..', '..', 'samples', 'audio.wav');
  let root: string;
  let projectDir: string;
  let outsideDir: string;
  let projectFile: string;
  let insideAudio: string;
  let outsideAudio: string;
  let secret: string;
  let fakeAudio: string;

  const clip = (clipId: string, assetPath?: string) =>
    ({clipId, audioAsset: {path: assetPath}}) as Clip;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'asset-security-'));
    projectDir = path.join(root, 'project');
    outsideDir = path.join(root, 'outside');
    projectFile = path.join(projectDir, 'project.hasp');
    insideAudio = path.join(projectDir, 'inside.wav');
    outsideAudio = path.join(outsideDir, 'outside.wav');
    secret = path.join(outsideDir, 'id_rsa');
    fakeAudio = path.join(outsideDir, 'fake.wav');

    fs.mkdirSync(projectDir, {recursive: true});
    fs.mkdirSync(outsideDir, {recursive: true});
    fs.copyFileSync(sampleAudio, insideAudio);
    fs.copyFileSync(sampleAudio, outsideAudio);
    fs.writeFileSync(secret, 'secret');
    fs.writeFileSync(fakeAudio, 'not audio');
  });

  afterEach(() => {
    fs.rmSync(root, {recursive: true, force: true});
  });

  describe('resolveAudioAssetPath', () => {
    it('returns the canonical path of an audio file', () => {
      expect(resolveAudioAssetPath(insideAudio)).toEqual(
        fs.realpathSync(insideAudio),
      );
    });

    it('rejects a file without an audio extension', () => {
      expect(resolveAudioAssetPath(secret)).toBeUndefined();
    });

    it('rejects an audio-named symlink to a non-audio file', () => {
      const link = path.join(projectDir, 'link.wav');
      fs.symlinkSync(secret, link);
      expect(resolveAudioAssetPath(link)).toBeUndefined();
    });

    it('rejects a directory', () => {
      const dir = path.join(projectDir, 'folder.wav');
      fs.mkdirSync(dir);
      expect(resolveAudioAssetPath(dir)).toBeUndefined();
    });

    it('rejects a missing file', () => {
      expect(
        resolveAudioAssetPath(path.join(projectDir, 'missing.wav')),
      ).toBeUndefined();
    });
  });

  describe('verifyAudioAssetPath', () => {
    it('accepts real audio content', async () => {
      expect(await verifyAudioAssetPath(outsideAudio)).toEqual(
        fs.realpathSync(outsideAudio),
      );
    });

    it('rejects a non-audio file with an audio extension', async () => {
      expect(await verifyAudioAssetPath(fakeAudio)).toBeUndefined();
    });
  });

  describe('classifyAudioAssets', () => {
    it('ignores clips without audio and missing files', () => {
      const result = classifyAudioAssets(
        [clip('none'), clip('missing', path.join(outsideDir, 'missing.wav'))],
        projectFile,
      );
      expect(result).toEqual({nonAudio: [], external: []});
    });

    it('accepts audio inside the project folder', () => {
      const result = classifyAudioAssets(
        [clip('inside', insideAudio)],
        projectFile,
      );
      expect(result).toEqual({nonAudio: [], external: []});
    });

    it('flags non-audio paths, even when missing', () => {
      const result = classifyAudioAssets(
        [
          clip('secret', secret),
          clip('missing', path.join(outsideDir, 'missing.key')),
        ],
        projectFile,
      );
      expect(result.nonAudio).toEqual(['secret', 'missing']);
    });

    it('flags audio outside the project folder, including traversal', () => {
      const traversal = path.join(projectDir, '..', 'outside', 'outside.wav');
      const result = classifyAudioAssets(
        [clip('absolute', outsideAudio), clip('traversal', traversal)],
        projectFile,
      );
      expect(result.external).toEqual([
        {clipId: 'absolute', path: outsideAudio},
        {clipId: 'traversal', path: traversal},
      ]);
    });

    it('flags a symlink inside the project folder that escapes it', () => {
      const link = path.join(projectDir, 'link.wav');
      fs.symlinkSync(outsideAudio, link);
      const result = classifyAudioAssets([clip('link', link)], projectFile);
      expect(result.external).toEqual([{clipId: 'link', path: link}]);
    });
  });
});
