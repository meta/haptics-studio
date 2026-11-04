/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import fs from 'fs';
import path from 'path';
import {pathToFileURL} from 'url';

import {net, protocol} from '../mocks/electron';
import Configs from '../../src/common/configs';
import Project, {Clip} from '../../src/common/project';
import ProtocolHandler from '../../src/services/ProtocolHandler';
import {PathManager} from '../../src/services';

type MediaHandler = (request: {url: string}) => Response | Promise<Response>;

describe('ProtocolHandler', () => {
  const root = path.join(path.resolve(__dirname), 'media');
  const tmpDir = path.join(root, 'tmp');
  const tmpProjectFile = path.join(tmpDir, 'project.hasp');
  const assetsPath = path.join(root, 'assets');
  const samplesPath = path.join(root, 'samples');
  const resourcesPath = path.join(root, 'resources');
  let handler: MediaHandler;

  beforeEach(() => {
    fs.mkdirSync(path.join(tmpDir, 'assets'), {recursive: true});
    [assetsPath, samplesPath, resourcesPath].forEach(dir =>
      fs.mkdirSync(dir, {recursive: true}),
    );
    jest.spyOn(Configs.instance, 'getCurrentProject').mockReturnValue({
      tmpProjectFile,
      name: 'project',
      dirty: false,
    });
    jest
      .spyOn(PathManager.instance, 'getAssetsPath')
      .mockReturnValue(assetsPath);
    jest
      .spyOn(PathManager.instance, 'getSamplesPath')
      .mockReturnValue(samplesPath);
    jest
      .spyOn(PathManager.instance, 'getResourcesPath')
      .mockReturnValue(resourcesPath);
    jest.spyOn(Project.instance, 'getClips').mockReturnValue([]);
    net.fetch.mockResolvedValue(new Response('media'));

    ProtocolHandler.register();
    handler = protocol.handle.mock.calls[0][1] as MediaHandler;
  });

  afterEach(() => {
    fs.rmSync(root, {recursive: true, force: true});
    ['user-audio.wav', 'user-image.png', 'outside.png', 'outside.wav'].forEach(
      fileName =>
        fs.rmSync(path.join(path.dirname(root), fileName), {force: true}),
    );
  });

  it.each(['evil.html', 'payload.js'])(
    'rejects unsupported media type %s before filesystem access',
    async fileName => {
      const existsSpy = jest.spyOn(fs, 'existsSync');
      existsSpy.mockClear();

      const response = await handler({url: `media://assets/${fileName}`});

      expect(response.status).toBe(200);
      expect(existsSpy).not.toHaveBeenCalled();
      expect(net.fetch).not.toHaveBeenCalled();
      existsSpy.mockRestore();
    },
  );

  it('rejects traversal outside the temporary project directory', async () => {
    fs.writeFileSync(path.join(root, 'outside.png'), 'outside');

    await handler({url: 'media://../outside.png'});

    expect(net.fetch).not.toHaveBeenCalled();
  });

  it('rejects an absolute path outside all known roots', async () => {
    const outsidePath = path.join(path.dirname(root), 'outside.wav');
    fs.writeFileSync(outsidePath, 'outside');

    await handler({url: `media://${outsidePath}`});

    expect(net.fetch).not.toHaveBeenCalled();
  });

  it('rejects a symlink that escapes the temporary project directory', async () => {
    const outsidePath = path.join(path.dirname(root), 'outside.png');
    const symlinkPath = path.join(tmpDir, 'assets', 'linked.png');
    fs.writeFileSync(outsidePath, 'outside');
    fs.symlinkSync(outsidePath, symlinkPath);

    await handler({url: 'media://assets/linked.png'});

    expect(net.fetch).not.toHaveBeenCalled();
  });

  it('rejects a non-audio file stored in an audio asset path', async () => {
    const imagePath = path.join(path.dirname(root), 'user-image.png');
    fs.writeFileSync(imagePath, 'image');
    jest
      .spyOn(Project.instance, 'getClips')
      .mockReturnValue([{audioAsset: {path: imagePath}} as Clip]);

    await handler({url: `media://${imagePath}`});

    expect(net.fetch).not.toHaveBeenCalled();
  });

  it('rejects an audio-named symlink to a non-audio file', async () => {
    const secretPath = path.join(path.dirname(root), 'outside.png');
    const linkPath = path.join(path.dirname(root), 'user-audio.wav');
    fs.writeFileSync(secretPath, 'secret');
    fs.symlinkSync(secretPath, linkPath);
    jest
      .spyOn(Project.instance, 'getClips')
      .mockReturnValue([{audioAsset: {path: linkPath}} as Clip]);

    await handler({url: `media://${linkPath}`});

    expect(net.fetch).not.toHaveBeenCalled();
  });

  it('rejects a referenced directory with an audio extension', async () => {
    const dirPath = path.join(path.dirname(root), 'user-audio.wav');
    fs.mkdirSync(dirPath);
    jest
      .spyOn(Project.instance, 'getClips')
      .mockReturnValue([{audioAsset: {path: dirPath}} as Clip]);

    try {
      await handler({url: `media://${dirPath}`});
    } finally {
      fs.rmSync(dirPath, {recursive: true, force: true});
    }

    expect(net.fetch).not.toHaveBeenCalled();
  });

  it('serves referenced user audio outside all known roots', async () => {
    const audioPath = path.join(path.dirname(root), 'user-audio.wav');
    fs.writeFileSync(audioPath, 'audio');
    jest
      .spyOn(Project.instance, 'getClips')
      .mockReturnValue([{audioAsset: {path: audioPath}} as Clip]);

    await handler({url: `media://${audioPath}`});

    expect(net.fetch).toHaveBeenCalledWith(pathToFileURL(audioPath).href);
  });

  it.each(['image.png', 'video.mp4', 'icon.svg', 'audio.wav'])(
    'serves supported project media %s',
    async fileName => {
      const expectedPath = path.join(tmpDir, 'assets', fileName);
      fs.writeFileSync(expectedPath, 'media');

      await handler({url: `media://assets/${fileName}`});

      expect(net.fetch).toHaveBeenCalledWith(pathToFileURL(expectedPath).href);
    },
  );
});
