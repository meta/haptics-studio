/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/unbound-method */
import fs from 'fs';
import path from 'path';
import faker from 'faker';
import rimraf from 'rimraf';
import lodash from 'lodash';
import {promisify} from 'util';
import {BrowserWindow} from 'electron';
import AdmZip from 'adm-zip';

import {dialog, ipcRenderer} from '../mocks/electron';
import mockedSettings from '../mocks/settings';
import {generateMockContent} from '../mocks/project';

import * as Actions from '../../src/actions/project';
import Project, {ProjectState} from '../../src/common/project';
import {IPCMessage} from '../../src/listeners';
import Configs, {CurrentProject} from '../../src/common/configs';
import MainApplication from '../../src/application';
import {PathManager} from '../../src/services';
import Constants from '../../src/common/constants';
import mockedSvg from '../mocks/svg';
import WSServer from '../../src/wsServer';
// @oss-disable

describe('actions', () => {
  const action = 'testAction';
  const projectMock = generateMockContent();

  beforeEach(() => {
    jest
      .spyOn(MainApplication.instance, 'reloadMenuItems')
      .mockImplementation();
    Project.instance.loadContent(
      lodash.cloneDeep(projectMock.defautProjectContent),
    );
    fs.mkdirSync(projectMock.projectDir);
    fs.mkdirSync(projectMock.tmpDir);
  });

  afterEach(async () => {
    Project.instance.close();
    const rm = promisify(rimraf);
    await rm(projectMock.projectDir);
    await rm(projectMock.tmpDir);
  });

  describe('loadProject', () => {
    let response: IPCMessage;

    describe('with missing project file', () => {
      beforeEach(async () => {
        Project.instance.loadContent(undefined);
        response = await Actions.loadProject(action, '/path/to/wrong/file');
      });

      it('should return error message', () => {
        const {status, message} = response;
        expect(response.action).toEqual(action);
        expect(status).toEqual('error');
        expect(message).toEqual(
          'Project file not found in /path/to/wrong/file',
        );
      });
    });

    describe('with existing project file', () => {
      beforeEach(() => {
        jest.spyOn(Project.instance, 'load').mockReturnValue(Promise.resolve());
        jest.spyOn(Configs.instance, 'setCurrentProject').mockReturnValue();
        jest.spyOn(Configs.instance, 'addRecentProject').mockReturnValue();
        jest
          .spyOn(Project.instance, 'getCurrentClip')
          .mockReturnValue(projectMock.clip);
      });

      afterEach(async () => {
        // clear project file
        const rm = promisify(rimraf);
        await rm(projectMock.projectDir);
      });

      // @oss-disable
      // @oss-disable
        // @oss-disable
          // @oss-disable
            // @oss-disable
          // @oss-disable
          // @oss-disable
            // @oss-disable
            // @oss-disable
          // @oss-disable
            // @oss-disable
            // @oss-disable
          // @oss-disable
            // @oss-disable
            // @oss-disable
          // @oss-disable
        // @oss-disable
        // @oss-disable
          // @oss-disable
            // @oss-disable
            // @oss-disable
              // @oss-disable
              // @oss-disable
            // @oss-disable
          // @oss-disable
        // @oss-disable
      // @oss-disable

      describe('when the project file exists', () => {
        beforeEach(async () => {
          fs.writeFileSync(projectMock.audioFilePath, '');
          jest.spyOn(Project, 'isTmpProject').mockReturnValue(false);
          jest.spyOn(PathManager.instance, 'setPath').mockImplementation();
          response = await Actions.loadProject(action, projectMock.projectFile);
        });

        it('should return IPC Message', () => {
          const {status, payload} = response;
          expect(response.action).toEqual(action);

          expect(status).toEqual('ok');
          expect(payload).toHaveProperty('clips');
          expect(payload).toHaveProperty('name');
          expect(payload).toHaveProperty('groups');
        });

        it('should call setCurrentProject once', () => {
          expect(Configs.instance.setCurrentProject).toHaveBeenCalledTimes(1);
          expect(Configs.instance.setCurrentProject).toHaveBeenCalledWith({
            projectFile: projectMock.projectFile,
            name: Project.instance.getName(),
            dirty: false,
            tmpProjectFile: Project.instance.getProjectFile(),
          });
        });

        it('should call addRecentProject once', () => {
          expect(Configs.instance.addRecentProject).toHaveBeenCalledTimes(1);
          expect(Configs.instance.addRecentProject).toHaveBeenCalledWith({
            projectFile: projectMock.projectFile,
            name: Project.instance.getName(),
          });
        });

        it('should not set the project dir as new application home', () => {
          expect(PathManager.instance.setPath).toHaveBeenCalledTimes(0);
        });
      });

      describe('when there is already a saved project file', () => {
        beforeEach(async () => {
          fs.writeFileSync(projectMock.audioFilePath, '');
          fs.writeFileSync(projectMock.projectFile, '{}');
          jest.spyOn(Project, 'isTmpProject').mockReturnValue(false);
          jest.spyOn(Configs.instance, 'getCurrentProject').mockReturnValue({
            projectFile: projectMock.projectFile,
            name: Project.instance.getName(),
            dirty: false,
            tmpProjectFile: Project.instance.getProjectFile(),
          });
          jest.spyOn(PathManager.instance, 'setPath').mockImplementation();
          response = await Actions.loadProject(action, projectMock.projectFile);
        });

        it('should not set the project dir as new application home', () => {
          expect(PathManager.instance.setPath).toHaveBeenCalledTimes(1);
          expect(PathManager.instance.setPath).toHaveBeenCalledWith(
            'home',
            path.dirname(projectMock.projectFile),
          );
        });
      });

      describe('dirty project', () => {
        beforeEach(async () => {
          jest.spyOn(Project, 'isTmpProject').mockReturnValue(true);
          response = await Actions.loadProject(
            action,
            projectMock.projectFile,
            true,
          );
        });

        it('should not call addRecentProject', () => {
          expect(Configs.instance.addRecentProject).toHaveBeenCalledTimes(0);
        });
      });

      describe('with audio assets', () => {
        const sampleAudio = path.join(__dirname, '..', 'samples', 'audio.wav');
        const externalDir = path.join(projectMock.tmpPath, 'external');
        const insideAudio = path.join(projectMock.projectDir, 'inside.wav');
        const externalAudio = path.join(externalDir, 'outside.wav');
        const secret = path.join(externalDir, 'id_rsa');
        const clipIds = {
          inside: faker.datatype.uuid(),
          external: faker.datatype.uuid(),
          secret: faker.datatype.uuid(),
        };

        const loadWithAssets = async (
          assets: Partial<Record<keyof typeof clipIds, string>>,
        ) => {
          const content = lodash.cloneDeep(projectMock.defautProjectContent);
          content.clips = Object.entries(assets).map(([key, assetPath]) => ({
            ...lodash.cloneDeep(projectMock.clip),
            clipId: clipIds[key as keyof typeof clipIds],
            audioAsset: {path: assetPath},
          }));
          Project.instance.loadContent(content);
          response = await Actions.loadProject(action, projectMock.projectFile);
        };

        const audioPathOf = (clipId: string) =>
          Project.instance.getClipById(clipId)?.audioAsset?.path;

        beforeEach(() => {
          fs.mkdirSync(externalDir, {recursive: true});
          fs.copyFileSync(sampleAudio, insideAudio);
          fs.copyFileSync(sampleAudio, externalAudio);
          fs.writeFileSync(secret, 'secret');
          jest.spyOn(Project, 'isTmpProject').mockReturnValue(false);
          jest
            .spyOn(Configs.instance, 'getCurrentProject')
            .mockReturnValue({} as unknown as CurrentProject);
          jest
            .spyOn(Configs.instance, 'isTrustedRecentProject')
            .mockReturnValue(false);
          jest.spyOn(Configs.instance, 'trustRecentProject').mockReturnValue();
          jest
            .spyOn(PathManager.instance, 'getResourcesPath')
            .mockReturnValue(path.join(projectMock.tmpPath, 'resources'));
          jest
            .spyOn(MainApplication.instance, 'getMainWindow')
            .mockReturnValue({} as unknown as BrowserWindow);
          jest.spyOn(dialog, 'showMessageBoxSync').mockReturnValue(1);
        });

        afterEach(async () => {
          await promisify(rimraf)(externalDir);
        });

        it('should keep audio inside the project folder without asking', async () => {
          await loadWithAssets({inside: insideAudio});
          expect(dialog.showMessageBoxSync).not.toHaveBeenCalled();
          expect(audioPathOf(clipIds.inside)).toEqual(insideAudio);
        });

        it('should drop non-audio assets without asking', async () => {
          await loadWithAssets({inside: insideAudio, secret});
          expect(dialog.showMessageBoxSync).not.toHaveBeenCalled();
          expect(audioPathOf(clipIds.secret)).toBeUndefined();
          expect(audioPathOf(clipIds.inside)).toEqual(insideAudio);
        });

        it('should drop external audio when the user does not allow it', async () => {
          await loadWithAssets({inside: insideAudio, external: externalAudio});
          expect(dialog.showMessageBoxSync).toHaveBeenCalledTimes(1);
          expect(audioPathOf(clipIds.external)).toBeUndefined();
          expect(audioPathOf(clipIds.inside)).toEqual(insideAudio);
          expect(response).toMatchObject({status: 'ok'});
          const payload = response.payload as unknown as Actions.OpenPayload;
          const externalClip = payload.clips.find(
            c => c.clipId === clipIds.external,
          );
          expect(externalClip?.audio?.exists).toBe(false);
        });

        it('should keep external audio when the user allows it', async () => {
          jest.spyOn(dialog, 'showMessageBoxSync').mockReturnValue(0);
          await loadWithAssets({external: externalAudio});
          expect(dialog.showMessageBoxSync).toHaveBeenCalledTimes(1);
          expect(audioPathOf(clipIds.external)).toEqual(externalAudio);
        });

        it('should treat a symlink escaping the project folder as external', async () => {
          const link = path.join(projectMock.projectDir, 'link.wav');
          fs.symlinkSync(externalAudio, link);
          await loadWithAssets({external: link});
          expect(dialog.showMessageBoxSync).toHaveBeenCalledTimes(1);
          expect(audioPathOf(clipIds.external)).toBeUndefined();
        });

        it('should drop an audio-named symlink to a non-audio file', async () => {
          const link = path.join(projectMock.projectDir, 'secret.wav');
          fs.symlinkSync(secret, link);
          await loadWithAssets({secret: link});
          expect(dialog.showMessageBoxSync).not.toHaveBeenCalled();
          expect(audioPathOf(clipIds.secret)).toBeUndefined();
        });

        it('should not trust the project when the user does not allow external audio', async () => {
          await loadWithAssets({external: externalAudio});
          expect(Configs.instance.trustRecentProject).not.toHaveBeenCalled();
        });

        it('should trust the project when the user allows external audio', async () => {
          jest.spyOn(dialog, 'showMessageBoxSync').mockReturnValue(0);
          await loadWithAssets({external: externalAudio});
          expect(Configs.instance.trustRecentProject).toHaveBeenCalledWith(
            projectMock.projectFile,
          );
        });

        it('should keep external audio of a trusted recent project without asking', async () => {
          jest
            .spyOn(Configs.instance, 'isTrustedRecentProject')
            .mockReturnValue(true);
          await loadWithAssets({external: externalAudio, secret});
          expect(dialog.showMessageBoxSync).not.toHaveBeenCalled();
          expect(audioPathOf(clipIds.external)).toEqual(externalAudio);
          expect(audioPathOf(clipIds.secret)).toBeUndefined();
        });

        it('should not ask again when reopening the temporary project', async () => {
          jest.spyOn(Project, 'isTmpProject').mockReturnValue(true);
          await loadWithAssets({external: externalAudio});
          expect(dialog.showMessageBoxSync).not.toHaveBeenCalled();
        });
      });
    });
  });

  describe('saveProject', () => {
    const testAction = 'save';

    let response: IPCMessage;

    describe('with missing content', () => {
      beforeEach(async () => {
        Project.instance.loadContent(undefined);
        response = await Actions.saveProject(testAction);
      });
      it('should return error message', () => {
        const {status} = response;
        expect(status).toEqual('error');
        expect(response.action).toEqual(testAction);
      });
    });

    describe('with non existing destination', () => {
      beforeEach(async () => {
        jest.spyOn(fs, 'existsSync').mockReturnValue(false);
        jest.spyOn(dialog, 'showOpenDialogSync').mockReturnValue([]);
        jest.spyOn(Configs.instance, 'getCurrentProject').mockReturnValue({
          tmpProjectFile: projectMock.tmpProjectFile,
          projectFile: projectMock.projectFile,
          name: projectMock.name,
          dirty: true,
        });
        jest
          .spyOn(MainApplication.instance, 'getMainWindow')
          .mockReturnValue({} as unknown as BrowserWindow);
        response = await Actions.saveProject(testAction);
      });
      afterAll(() => {
        jest.restoreAllMocks();
      });
      it('should show the save dialog', () => {
        expect(dialog.showSaveDialogSync).toHaveBeenCalledTimes(1);
      });
    });

    describe('with missing destination', () => {
      beforeEach(async () => {
        jest
          .spyOn(Configs.instance, 'getCurrentProject')
          .mockReturnValue({} as unknown as CurrentProject);
        jest.spyOn(dialog, 'showOpenDialogSync').mockReturnValue([]);
        response = await Actions.saveProject(testAction);
      });
      it('should return error message', () => {
        const {status} = response;
        expect(status).toEqual('error');
        expect(response.action).toEqual(testAction);
      });
    });

    describe('with force destination flag', () => {
      const newProjectName = path.basename(
        projectMock.projectFile,
        path.extname(projectMock.projectFile),
      );
      beforeEach(async () => {
        jest.spyOn(Project.instance, 'updateName').mockImplementation();
        jest.spyOn(Project.instance, 'save').mockImplementation();
        jest.spyOn(Configs.instance, 'setCurrentProject').mockImplementation();
        jest.spyOn(Configs.instance, 'addRecentProject').mockImplementation();
        jest.spyOn(Configs.instance, 'getCurrentProject').mockReturnValue({
          tmpProjectFile: projectMock.tmpProjectFile,
          projectFile: projectMock.projectFile,
          name: projectMock.name,
          dirty: true,
        });
        jest
          .spyOn(dialog, 'showSaveDialogSync')
          .mockReturnValue(projectMock.projectFile);
        jest
          .spyOn(MainApplication.instance, 'getMainWindow')
          .mockReturnValue({} as unknown as BrowserWindow);
        response = await Actions.saveProject(testAction, true);
      });

      it('should return ok message', () => {
        const {status} = response;
        expect(status).toEqual('ok');
        expect(response.action).toEqual(testAction);
      });

      it('should call save dialog', () => {
        expect(dialog.showSaveDialogSync).toHaveBeenCalledTimes(1);
      });

      it('should update project name', () => {
        expect(Project.instance.updateName).toHaveBeenCalledTimes(1);
      });

      it('should call project save once', () => {
        expect(Project.instance.save).toHaveBeenCalledTimes(1);
      });

      it('should call setCurrentProject once', () => {
        expect(Configs.instance.setCurrentProject).toHaveBeenCalledTimes(1);
        expect(Configs.instance.setCurrentProject).toHaveBeenCalledWith({
          projectFile: projectMock.projectFile,
          name: newProjectName,
          dirty: false,
          tmpProjectFile: Project.instance.getProjectFile(),
        });
      });

      it('should call addRecentProject once', () => {
        expect(Configs.instance.addRecentProject).toHaveBeenCalledTimes(1);
        expect(Configs.instance.addRecentProject).toHaveBeenCalledWith({
          projectFile: projectMock.projectFile,
          name: newProjectName,
        });
      });

      it('should call reloadMenuItems once', () => {
        expect(MainApplication.instance.reloadMenuItems).toHaveBeenCalledTimes(
          1,
        );
      });
    });

    describe('with notifySocket flag', () => {
      beforeEach(async () => {
        jest.spyOn(Project.instance, 'updateName').mockImplementation();
        jest.spyOn(Project.instance, 'save').mockImplementation();
        jest.spyOn(Configs.instance, 'setCurrentProject').mockImplementation();
        jest.spyOn(Configs.instance, 'addRecentProject').mockImplementation();
        jest.spyOn(Configs.instance, 'getCurrentProject').mockReturnValue({
          tmpProjectFile: projectMock.tmpProjectFile,
          projectFile: projectMock.projectFile,
          name: projectMock.name,
          dirty: true,
        });
        jest
          .spyOn(dialog, 'showSaveDialogSync')
          .mockReturnValue(projectMock.projectFile);
        jest.spyOn(WSServer.instance, 'sendCurrentProject').mockReturnValue();
        jest
          .spyOn(MainApplication.instance, 'getMainWindow')
          .mockReturnValue({} as unknown as BrowserWindow);
        response = await Actions.saveProject(testAction, false, false);
      });

      it('should not call sendCurrentProject', () => {
        expect(WSServer.instance.sendCurrentProject).toHaveBeenCalledTimes(0);
      });
    });

    describe('with default name', () => {
      const newProjectName = path.basename(
        projectMock.projectFile,
        path.extname(projectMock.projectFile),
      );
      beforeEach(async () => {
        jest
          .spyOn(Project.instance, 'getName')
          .mockReturnValue(Constants.DEFAULT_PROJECT_NAME);
        jest.spyOn(Project.instance, 'updateName').mockImplementation();
        jest.spyOn(Project.instance, 'save').mockImplementation();
        jest.spyOn(Configs.instance, 'setCurrentProject').mockImplementation();
        jest.spyOn(Configs.instance, 'addRecentProject').mockImplementation();
        jest.spyOn(Configs.instance, 'getCurrentProject').mockReturnValue({
          tmpProjectFile: projectMock.tmpProjectFile,
          projectFile: projectMock.projectFile,
          name: projectMock.name,
          dirty: true,
        });
        jest
          .spyOn(dialog, 'showSaveDialogSync')
          .mockReturnValue(projectMock.projectFile);
        jest
          .spyOn(MainApplication.instance, 'getMainWindow')
          .mockReturnValue({} as unknown as BrowserWindow);
        response = await Actions.saveProject(testAction, true);
      });

      it('should update project name', () => {
        expect(Project.instance.updateName).toHaveBeenCalledTimes(1);
        expect(Project.instance.updateName).toHaveBeenCalledWith(
          newProjectName,
        );
      });
    });

    describe('when the selected name collides with an existing project', () => {
      const existingProjectFile = path.join(
        projectMock.projectDir,
        `collision${Constants.PROJECT.EXTENSION}`,
      );
      // The user types the name without the project extension
      const selectedFile = path.join(projectMock.projectDir, 'collision');

      beforeEach(() => {
        jest
          .spyOn(Project.instance, 'getName')
          .mockReturnValue(projectMock.name);
        jest.spyOn(Project.instance, 'updateName').mockImplementation();
        jest.spyOn(Project.instance, 'save').mockImplementation();
        jest.spyOn(Configs.instance, 'setCurrentProject').mockImplementation();
        jest.spyOn(Configs.instance, 'addRecentProject').mockImplementation();
        jest
          .spyOn(Configs.instance, 'removeRecentProject')
          .mockImplementation();
        jest.spyOn(Configs.instance, 'getCurrentProject').mockReturnValue({
          tmpProjectFile: projectMock.tmpProjectFile,
          projectFile: projectMock.projectFile,
          name: projectMock.name,
          dirty: true,
        });
        jest.spyOn(dialog, 'showSaveDialogSync').mockReturnValue(selectedFile);
        jest
          .spyOn(MainApplication.instance, 'getMainWindow')
          .mockReturnValue({} as unknown as BrowserWindow);
        fs.writeFileSync(existingProjectFile, '{}');
      });

      describe('and the overwrite is confirmed', () => {
        beforeEach(async () => {
          jest.spyOn(dialog, 'showMessageBoxSync').mockReturnValue(0);
          response = await Actions.saveProject(testAction, true);
        });

        it('should ask for confirmation', () => {
          expect(dialog.showMessageBoxSync).toHaveBeenCalledTimes(1);
        });

        it('should save the project', () => {
          expect(response.status).toEqual('ok');
          expect(Project.instance.save).toHaveBeenCalledWith(
            existingProjectFile,
          );
        });
      });

      describe('and the overwrite is rejected', () => {
        beforeEach(async () => {
          jest.spyOn(dialog, 'showMessageBoxSync').mockReturnValue(1);
          response = await Actions.saveProject(testAction, true);
        });

        it('should ask for confirmation', () => {
          expect(dialog.showMessageBoxSync).toHaveBeenCalledTimes(1);
        });

        it('should return canceled status message', () => {
          expect(response.status).toEqual('canceled');
          expect(response.action).toEqual(testAction);
        });

        it('should not overwrite the existing project', () => {
          expect(Project.instance.save).not.toHaveBeenCalled();
          expect(fs.readFileSync(existingProjectFile, 'utf8')).toEqual('{}');
        });

        it('should not rename the current project', () => {
          expect(Project.instance.updateName).not.toHaveBeenCalled();
        });
      });
    });

    describe('when the selected name already has the project extension', () => {
      beforeEach(async () => {
        jest
          .spyOn(Project.instance, 'getName')
          .mockReturnValue(projectMock.name);
        jest.spyOn(Project.instance, 'updateName').mockImplementation();
        jest.spyOn(Project.instance, 'save').mockImplementation();
        jest.spyOn(Configs.instance, 'setCurrentProject').mockImplementation();
        jest.spyOn(Configs.instance, 'addRecentProject').mockImplementation();
        jest.spyOn(Configs.instance, 'getCurrentProject').mockReturnValue({
          tmpProjectFile: projectMock.tmpProjectFile,
          projectFile: projectMock.projectFile,
          name: projectMock.name,
          dirty: true,
        });
        jest
          .spyOn(dialog, 'showSaveDialogSync')
          .mockReturnValue(projectMock.projectFile);
        jest
          .spyOn(MainApplication.instance, 'getMainWindow')
          .mockReturnValue({} as unknown as BrowserWindow);
        fs.writeFileSync(projectMock.projectFile, '{}');
        response = await Actions.saveProject(testAction, true);
      });

      it('should rely on the native overwrite confirmation', () => {
        expect(dialog.showMessageBoxSync).not.toHaveBeenCalled();
        expect(response.status).toEqual('ok');
      });
    });

    describe('with destination file without write permissions', () => {
      beforeEach(async () => {
        Project.instance.create(projectMock.name);
        jest
          .spyOn(dialog, 'showSaveDialogSync')
          .mockReturnValue(projectMock.projectFile);
        fs.writeFileSync(projectMock.projectFile, '{}');
        fs.chmodSync(projectMock.projectFile, 0o444);
        response = await Actions.saveProject(testAction);
      });

      it('should return an error message', () => {
        const {status} = response;
        expect(status).toEqual('error');
        expect(response.action).toEqual(testAction);
      });
    });

    describe('when saving a sample project to a new destination', () => {
      const samplesDir = path.join(projectMock.tmpPath, 'samples');
      const sampleAudioName = 'sample-audio.wav';
      const sampleAudioPath = path.join(samplesDir, sampleAudioName);
      const copiedAudioPath = path.join(
        projectMock.projectDir,
        sampleAudioName,
      );

      beforeEach(async () => {
        fs.mkdirSync(samplesDir, {recursive: true});
        fs.writeFileSync(sampleAudioPath, 'sample-audio');

        const sampleClip = {
          ...projectMock.clip,
          audioAsset: {path: sampleAudioPath},
        };
        Project.instance.loadContent({
          ...lodash.cloneDeep(projectMock.defautProjectContent),
          clips: [sampleClip],
          state: {clipId: sampleClip.clipId, sessionId: projectMock.sessionId},
        });

        jest
          .spyOn(PathManager.instance, 'getResourcesPath')
          .mockReturnValue(samplesDir);
        jest
          .spyOn(PathManager.instance, 'getSamplesPath')
          .mockReturnValue(samplesDir);
        jest
          .spyOn(Project.instance, 'getName')
          .mockReturnValue(projectMock.name);
        jest.spyOn(Project.instance, 'save').mockResolvedValue(true);
        jest.spyOn(Configs.instance, 'setCurrentProject').mockImplementation();
        jest.spyOn(Configs.instance, 'addRecentProject').mockImplementation();
        jest.spyOn(Configs.instance, 'getCurrentProject').mockReturnValue({
          tmpProjectFile: projectMock.tmpProjectFile,
          name: projectMock.name,
          dirty: true,
        } as unknown as CurrentProject);
        jest.spyOn(WSServer.instance, 'sendCurrentProject').mockReturnValue();
        jest
          .spyOn(dialog, 'showSaveDialogSync')
          .mockReturnValue(projectMock.projectFile);
        jest
          .spyOn(MainApplication.instance, 'getMainWindow')
          .mockReturnValue({} as unknown as BrowserWindow);

        response = await Actions.saveProject(testAction, true);
      });

      afterEach(async () => {
        const rm = promisify(rimraf);
        await rm(samplesDir);
      });

      it('should return ok message', () => {
        expect(response.status).toEqual('ok');
        expect(response.action).toEqual(testAction);
      });

      it('should copy the sample audio next to the destination', () => {
        expect(fs.existsSync(copiedAudioPath)).toBeTruthy();
      });

      it('should relink the clip audio to the copied asset', () => {
        const [clip] = Project.instance.getClips();
        expect(clip.audioAsset?.path).toEqual(copiedAudioPath);
        expect(clip.audioAsset?.path?.startsWith(samplesDir)).toBeFalsy();
      });
    });
  });

  describe('cloneProject', () => {
    const testAction = 'save_as';
    let response: IPCMessage;

    beforeEach(() => {
      jest.spyOn(MainApplication.instance, 'getMainWindow').mockReturnValue({
        webContents: {send: jest.fn()},
      } as unknown as BrowserWindow);
      fs.writeFileSync(projectMock.audioFilePath, '');
    });

    describe('with missing current project', () => {
      beforeEach(async () => {
        jest
          .spyOn(Configs.instance, 'getCurrentProject')
          .mockReturnValue({} as unknown as CurrentProject);
        response = await Actions.cloneProject(testAction);
      });
      it('should return error message', () => {
        const {status} = response;
        expect(status).toEqual('error');
        expect(response.action).toEqual(testAction);
      });
    });

    describe('with missing current haptic', () => {
      beforeEach(async () => {
        jest.spyOn(Configs.instance, 'getCurrentProject').mockReturnValue({
          projectFile: projectMock.projectFile,
        } as unknown as CurrentProject);
        jest
          .spyOn(Project.instance, 'getState')
          .mockReturnValue({} as ProjectState);
        response = await Actions.cloneProject(testAction);
      });
      it('should return error message', () => {
        const {status} = response;
        expect(status).toEqual('error');
        expect(response.action).toEqual(testAction);
      });
    });

    describe('with missing current session', () => {
      beforeEach(async () => {
        jest.spyOn(Configs.instance, 'getCurrentProject').mockReturnValue({
          projectFile: projectMock.projectFile,
        } as unknown as CurrentProject);
        jest
          .spyOn(Project.instance, 'getState')
          .mockReturnValue({clipId: projectMock.clipId} as ProjectState);
        response = await Actions.cloneProject(testAction);
      });
      it('should return error message', () => {
        const {status} = response;
        expect(status).toEqual('error');
        expect(response.action).toEqual(testAction);
      });
    });

    describe('when save is canceled', () => {
      beforeEach(async () => {
        jest
          .spyOn(Project.instance, 'getName')
          .mockReturnValue(projectMock.name);
        jest.spyOn(Configs.instance, 'getCurrentProject').mockReturnValue({
          projectFile: projectMock.projectFile,
        } as unknown as CurrentProject);
        jest.spyOn(Project.instance, 'getState').mockReturnValue({
          clipId: projectMock.clipId,
          sessionId: projectMock.sessionId,
        });
        jest.spyOn(Project.instance, 'load').mockReturnValue(Promise.resolve());
        jest.spyOn(dialog, 'showSaveDialogSync').mockReturnValue(undefined);
        response = await Actions.cloneProject(testAction);
      });
      it('should return canceled status message', () => {
        const {status} = response;
        expect(status).toEqual('canceled');
        expect(response.action).toEqual(testAction);
      });
    });

    describe('when the haptic is cloned', () => {
      const clonedProjectFile = path.join(
        projectMock.projectDir,
        `test${Constants.PROJECT.EXTENSION}`,
      );

      beforeEach(async () => {
        jest
          .spyOn(Project.instance, 'getName')
          .mockReturnValue(projectMock.name);
        jest.spyOn(Project.instance, 'getState').mockReturnValue({
          clipId: projectMock.clipId,
          sessionId: projectMock.sessionId,
        });
        jest
          .spyOn(Project.instance, 'getCurrentClip')
          .mockReturnValue(projectMock.clip);
        jest.spyOn(Project, 'setRelativeAssetsPath').mockReturnValue(true);
        jest.spyOn(Project.instance, 'updateState').mockImplementation();
        jest
          .spyOn(Configs.instance, 'getCurrentProject')
          .mockReturnValue({} as CurrentProject);
        jest
          .spyOn(Configs.instance, 'clearCurrentProject')
          .mockImplementation();
        jest
          .spyOn(dialog, 'showSaveDialogSync')
          .mockReturnValue(clonedProjectFile);
        fs.writeFileSync(
          projectMock.projectFile,
          JSON.stringify(projectMock.defautProjectContent),
        );
        response = await Actions.cloneProject(testAction);
      });

      it('should return ok message', () => {
        const {status} = response;
        expect(status).toEqual('ok');
        expect(response.action).toEqual('open');
      });

      it('should create the new project file', () => {
        expect(fs.existsSync(clonedProjectFile)).toBeTruthy();
      });
    });

    describe('when the selected name collides with an existing project', () => {
      const existingProjectFile = path.join(
        projectMock.projectDir,
        `collision${Constants.PROJECT.EXTENSION}`,
      );
      // The user types the name without the project extension
      const selectedFile = path.join(projectMock.projectDir, 'collision');
      const existingContent = JSON.stringify({existing: true});

      beforeEach(() => {
        jest
          .spyOn(Project.instance, 'getName')
          .mockReturnValue(projectMock.name);
        jest.spyOn(Project.instance, 'getState').mockReturnValue({
          clipId: projectMock.clipId,
          sessionId: projectMock.sessionId,
        });
        jest
          .spyOn(Project.instance, 'getCurrentClip')
          .mockReturnValue(projectMock.clip);
        jest.spyOn(Project, 'setRelativeAssetsPath').mockReturnValue(true);
        jest.spyOn(Project.instance, 'updateState').mockImplementation();
        jest
          .spyOn(Configs.instance, 'getCurrentProject')
          .mockReturnValue({} as CurrentProject);
        jest
          .spyOn(Configs.instance, 'clearCurrentProject')
          .mockImplementation();
        jest.spyOn(dialog, 'showSaveDialogSync').mockReturnValue(selectedFile);
        jest
          .spyOn(MainApplication.instance, 'getMainWindow')
          .mockReturnValue({} as unknown as BrowserWindow);
        fs.writeFileSync(
          projectMock.projectFile,
          JSON.stringify(projectMock.defautProjectContent),
        );
        fs.writeFileSync(existingProjectFile, existingContent);
      });

      describe('and the overwrite is rejected', () => {
        beforeEach(async () => {
          jest.spyOn(dialog, 'showMessageBoxSync').mockReturnValue(1);
          response = await Actions.cloneProject(testAction);
        });

        it('should ask for confirmation', () => {
          expect(dialog.showMessageBoxSync).toHaveBeenCalledTimes(1);
        });

        it('should return canceled status message', () => {
          expect(response.status).toEqual('canceled');
          expect(response.action).toEqual(testAction);
        });

        it('should leave the existing project untouched', () => {
          expect(fs.readFileSync(existingProjectFile, 'utf8')).toEqual(
            existingContent,
          );
        });
      });

      describe('and the overwrite is confirmed', () => {
        beforeEach(async () => {
          jest.spyOn(dialog, 'showMessageBoxSync').mockReturnValue(0);
          response = await Actions.cloneProject(testAction);
        });

        it('should ask for confirmation', () => {
          expect(dialog.showMessageBoxSync).toHaveBeenCalledTimes(1);
        });

        it('should replace the existing project', () => {
          expect(fs.readFileSync(existingProjectFile, 'utf8')).not.toEqual(
            existingContent,
          );
        });
      });
    });

    describe('when the selected name already has the project extension', () => {
      const clonedProjectFile = path.join(
        projectMock.projectDir,
        `existing${Constants.PROJECT.EXTENSION}`,
      );

      beforeEach(async () => {
        jest
          .spyOn(Project.instance, 'getName')
          .mockReturnValue(projectMock.name);
        jest.spyOn(Project.instance, 'getState').mockReturnValue({
          clipId: projectMock.clipId,
          sessionId: projectMock.sessionId,
        });
        jest
          .spyOn(Project.instance, 'getCurrentClip')
          .mockReturnValue(projectMock.clip);
        jest.spyOn(Project, 'setRelativeAssetsPath').mockReturnValue(true);
        jest.spyOn(Project.instance, 'updateState').mockImplementation();
        jest
          .spyOn(Configs.instance, 'getCurrentProject')
          .mockReturnValue({} as CurrentProject);
        jest
          .spyOn(Configs.instance, 'clearCurrentProject')
          .mockImplementation();
        jest
          .spyOn(dialog, 'showSaveDialogSync')
          .mockReturnValue(clonedProjectFile);
        jest
          .spyOn(MainApplication.instance, 'getMainWindow')
          .mockReturnValue({} as unknown as BrowserWindow);
        fs.writeFileSync(
          projectMock.projectFile,
          JSON.stringify(projectMock.defautProjectContent),
        );
        fs.writeFileSync(clonedProjectFile, '{}');
        response = await Actions.cloneProject(testAction);
      });

      it('should rely on the native overwrite confirmation', () => {
        expect(dialog.showMessageBoxSync).not.toHaveBeenCalled();
        expect(response.status).toEqual('ok');
      });
    });
  });

  describe('exportClips', () => {
    const testAction = 'export_clips';
    const exportDir = path.join(projectMock.tmpPath, 'export');

    beforeAll(() => {
      // setup clips listeners
      const clipsListeners = require('../../src/listeners/clips').default;
      clipsListeners();
    });

    describe('basic export without packaging', () => {
      let response: IPCMessage;

      beforeEach(async () => {
        jest
          .spyOn(Project.instance, 'getName')
          .mockReturnValue(projectMock.name);
        jest.spyOn(Configs.instance, 'getCurrentProject').mockReturnValue({
          name: projectMock.name,
          dirty: true,
          tmpProjectFile: projectMock.tmpProjectFile,
          projectFile: projectMock.projectFile,
        });
        jest
          .spyOn(MainApplication.instance, 'getMainWindow')
          .mockReturnValue({} as unknown as BrowserWindow);
        jest.spyOn(dialog, 'showOpenDialogSync').mockReturnValue([exportDir]);

        const audio1Path = path.join(projectMock.tmpDir, 'audio.wav');
        fs.mkdirSync(path.dirname(audio1Path), {recursive: true});
        fs.writeFileSync(audio1Path, '');

        const clipsToExport = [
          {
            clipId: faker.datatype.uuid(),
            name: faker.commerce.product(),
            settings: mockedSettings,
            haptic: projectMock.clip.haptic,
            audioAsset: {path: audio1Path, filename: 'audio'},
            waveform: mockedSvg,
          },
        ];
        const content = {
          version: {major: 1, minor: 0, patch: 0},
          metadata: {name: projectMock.name},
          state: {sessionId: projectMock.sessionId, clipId: projectMock.clipId},
          clips: clipsToExport,
          groups: [],
        };
        Project.instance.loadContent(lodash.cloneDeep(content));

        fs.mkdirSync(exportDir, {recursive: true});

        // Trigger the export using ipcRenderer
        const exportMessage = {
          clips: [clipsToExport[0].clipId],
          formats: ['haptic' as const],
          packageProject: false,
          flatten: false,
        };

        response = (await ipcRenderer.invoke(
          testAction,
          exportMessage,
        )) as IPCMessage;
      });

      afterEach(async () => {
        const rm = promisify(rimraf);
        await rm(exportDir);
      });

      it('should export haptic files to the selected directory', () => {
        const files = fs.readdirSync(exportDir);
        expect(files.length).toBeGreaterThan(0);
        expect(files.some(f => f.endsWith('.haptic'))).toBeTruthy();
      });

      it('should return ok status', () => {
        expect(response.status).toEqual('ok');
        expect(response.action).toEqual(testAction);
      });
    });

    describe('export with project packaging', () => {
      let zipPath: string;
      let response: IPCMessage;
      const fakeAudioPath = path.join(projectMock.tmpDir, 'fake.wav');
      const secretPath = path.join(projectMock.tmpDir, 'id_rsa');

      beforeEach(async () => {
        zipPath = path.join(exportDir, `${projectMock.name}.zip`);

        jest
          .spyOn(Project.instance, 'getName')
          .mockReturnValue(projectMock.name);
        jest.spyOn(Configs.instance, 'set').mockImplementation();
        // @oss-disable
          // @oss-disable
          // @oss-disable
        jest.spyOn(Configs.instance, 'getCurrentProject').mockReturnValue({
          name: projectMock.name,
          dirty: true,
          tmpProjectFile: projectMock.tmpProjectFile,
          projectFile: projectMock.projectFile,
        });
        jest
          .spyOn(MainApplication.instance, 'getMainWindow')
          .mockReturnValue({} as unknown as BrowserWindow);
        jest.spyOn(dialog, 'showSaveDialogSync').mockReturnValue(zipPath);

        const audio1Path = path.join(projectMock.tmpDir, 'audio.wav');
        const audio2Path = path.join(projectMock.tmpDir, 'audio1', 'audio.wav');
        const audio3Path = path.join(
          projectMock.tmpDir,
          'audio3',
          'audio_1.wav',
        );

        fs.mkdirSync(path.dirname(audio1Path), {recursive: true});
        fs.mkdirSync(path.dirname(audio2Path), {recursive: true});
        fs.mkdirSync(path.dirname(audio3Path), {recursive: true});
        const sampleAudio = path.join(__dirname, '..', 'samples', 'audio.wav');
        fs.copyFileSync(sampleAudio, audio1Path);
        fs.copyFileSync(sampleAudio, audio2Path);
        fs.copyFileSync(sampleAudio, audio3Path);
        fs.writeFileSync(fakeAudioPath, 'not audio');
        fs.writeFileSync(secretPath, 'secret');

        const clipsToExport = [
          {
            clipId: faker.datatype.uuid(),
            name: faker.commerce.product(),
            settings: mockedSettings,
            haptic: projectMock.clip.haptic,
            audioAsset: {path: audio1Path, filename: 'audio'},
            waveform: mockedSvg,
          },
          {
            clipId: faker.datatype.uuid(),
            name: faker.commerce.product(),
            settings: mockedSettings,
            haptic: projectMock.clip.haptic,
            audioAsset: {path: audio2Path, filename: 'audio'},
            waveform: mockedSvg,
          },
          {
            clipId: faker.datatype.uuid(),
            name: faker.commerce.product(),
            settings: mockedSettings,
            haptic: projectMock.clip.haptic,
            audioAsset: {path: audio3Path, filename: 'audio'},
            waveform: mockedSvg,
          },
          {
            clipId: faker.datatype.uuid(),
            name: faker.commerce.product(),
            settings: mockedSettings,
            haptic: projectMock.clip.haptic,
            audioAsset: {path: fakeAudioPath, filename: 'audio'},
            waveform: mockedSvg,
          },
          {
            clipId: faker.datatype.uuid(),
            name: faker.commerce.product(),
            settings: mockedSettings,
            haptic: projectMock.clip.haptic,
            audioAsset: {path: secretPath, filename: 'audio'},
            waveform: mockedSvg,
          },
        ];

        const content = {
          version: {major: 1, minor: 0, patch: 0},
          metadata: {name: projectMock.name},
          state: {sessionId: projectMock.sessionId, clipId: projectMock.clipId},
          clips: clipsToExport,
          groups: [
            {
              clips: [clipsToExport[0].clipId, clipsToExport[2].clipId],
              isFolder: true,
              name: 'folder1',
              id: faker.datatype.uuid(),
            },
            {
              clips: [clipsToExport[1].clipId],
              isFolder: true,
              name: 'folder2',
              id: faker.datatype.uuid(),
            },
          ],
        };
        Project.instance.loadContent(lodash.cloneDeep(content));

        fs.mkdirSync(exportDir, {recursive: true});

        // Trigger the export with packaging
        const exportMessage = {
          clips: clipsToExport.map(c => c.clipId),
          formats: ['haptic' as const],
          packageProject: true,
          flatten: false,
        };

        response = (await ipcRenderer.invoke(
          testAction,
          exportMessage,
        )) as IPCMessage;

        // Only extract if the zip was created successfully
        if (fs.existsSync(zipPath)) {
          const zip = new AdmZip(zipPath);
          zip.extractAllTo(exportDir);
        }
      });

      afterEach(async () => {
        const rm = promisify(rimraf);
        await rm(exportDir);
      });

      it('should create a zip file', () => {
        expect(fs.existsSync(zipPath)).toBeTruthy();
      });

      it('should not package assets that are not audio files', () => {
        expect(fs.existsSync(path.join(exportDir, 'fake.wav'))).toBeFalsy();
        expect(fs.existsSync(path.join(exportDir, 'id_rsa'))).toBeFalsy();
      });

      it('should contain the project file in the package', () => {
        expect(
          fs.existsSync(
            path.join(
              exportDir,
              `${projectMock.name}${Constants.PROJECT.EXTENSION}`,
            ),
          ),
        ).toBeTruthy();
      });

      it('should contain audio assets in the package', () => {
        const files = fs.readdirSync(exportDir);
        const audioFiles = files.filter(f => f.endsWith('.wav'));
        // Just check that at least one audio file exists
        expect(audioFiles.length).toBeGreaterThan(0);
      });

      it('should package the project successfully', () => {
        // Verify zip was created and contains the project file
        expect(fs.existsSync(zipPath)).toBeTruthy();
        expect(
          fs.existsSync(
            path.join(
              exportDir,
              `${projectMock.name}${Constants.PROJECT.EXTENSION}`,
            ),
          ),
        ).toBeTruthy();
      });

      it('should return ok status', () => {
        expect(response.status).toEqual('ok');
        expect(response.action).toEqual(testAction);
      });
    });
  });
});
