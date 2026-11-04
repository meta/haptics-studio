/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/unbound-method */
import faker from 'faker';
import _ from 'lodash';
import fs from 'fs';
import path from 'path';

import {io, Socket} from 'socket.io-client';
import mockDataModel from './mocks/datamodel';
import mockSettings from './mocks/settings';
import mockSvg from './mocks/svg';

import Constants from '../src/common/constants';
import WSServer from '../src/wsServer';
import Project, {Clip, ClipGroup, ProjectContent} from '../src/common/project';
import * as Utils from '../src/common/utils';
import Configs from '../src/common/configs';
import MainApplication from '../src/application';

describe('Websocket Server', () => {
  let socket: Socket;
  const samplesPath = path.join(path.resolve(__dirname), 'samples');
  const name = faker.commerce.productName();
  const groupName = faker.commerce.productName();
  const projectName = faker.commerce.productName();
  const groupId = faker.datatype.uuid();
  const sessionId = faker.datatype.uuid();
  const clipId = faker.datatype.uuid();
  const noAudioClipId = faker.datatype.uuid();
  const deviceId = faker.datatype.uuid();
  const authCode = '1234';

  const clip: Clip = {
    clipId,
    name,
    audioAsset: {
      path: path.join(samplesPath, 'audio.wav'),
    },
    haptic: mockDataModel,
    waveform: mockSvg,
    settings: mockSettings,
    lastUpdate: Date.now(),
  };
  const noAudioClip: Clip = {
    clipId: noAudioClipId,
    name,
    audioAsset: undefined,
    haptic: mockDataModel,
    waveform: mockSvg,
    settings: mockSettings,
    lastUpdate: Date.now(),
  };
  const groups: ClipGroup[] = [
    {
      id: groupId,
      clips: [clipId, noAudioClipId],
      name: groupName,
      isFolder: false,
    },
  ];
  const projectFileContent: ProjectContent = {
    version: {major: 1, minor: 0, patch: 0},
    state: {sessionId, clipId},
    metadata: {name: projectName},
    clips: [clip, noAudioClip],
    groups,
  };

  beforeAll(done => {
    // start ws server
    WSServer.instance.start();
    done();
  });

  afterAll(done => {
    // stop ws server
    setTimeout(() => {
      WSServer.instance.stop();
      done();
    }, 2000);
  });

  beforeEach(() => {
    jest.spyOn(Utils, 'generateRandomDigits').mockReturnValue(authCode);
    jest.spyOn(MainApplication.instance, 'sendToUI').mockReturnValue();

    Project.instance.loadContent(_.cloneDeep(projectFileContent));
  });

  afterEach(done => {
    socket.disconnect();
    done();
  });

  describe('for unknown devices', () => {
    beforeEach(done => {
      // fake client connection
      socket = io(`${Constants.WS.PROTOCOL}://localhost:${Constants.WS.PORT}`, {
        path: Constants.WS.PATH,
        query: {
          deviceId,
        },
      });
      socket.on('connect', done);
      socket.connect();
    });

    describe('on connect', () => {
      it('should set the socket client', () => {
        expect(WSServer.instance.getIoClient(deviceId)).not.toBe(undefined);
      });

      it.skip('should emit auth_required event', done => {
        socket.on('auth_required', () => {
          done();
        });
      });

      it('should send the auth code to the UI', () => {
        expect(MainApplication.instance.sendToUI).toHaveBeenCalledWith(
          'ws_auth_code',
          {
            authCode,
            expiresAt: expect.any(Number),
          },
        );
      });

      it('should add device to known on auth_request', done => {
        socket.on('auth_request', () => {
          expect(Configs.instance.isDeviceKnown(deviceId)).toEqual(true);
          done();
        });
        socket.emit('auth_request', {authCode});
      });

      describe('with wrong auth code', () => {
        it('should not add device to known on auth_request', done => {
          socket.on('auth_request', () => {
            expect(Configs.instance.isDeviceKnown(deviceId)).toEqual(false);
            done();
          });
          socket.emit('auth_request', {authCode: 'wrong'});
        });
      });

      it('client status should be connecting', () => {
        const deviceInfo = WSServer.instance.getDeviceInfo(deviceId);
        expect(deviceInfo.status).toEqual('connecting');
      });
    });
  });

  describe('for known devices', () => {
    beforeEach(done => {
      jest.spyOn(Configs.instance, 'isDeviceKnown').mockReturnValue(true);

      // fake client connection
      socket = io(`${Constants.WS.PROTOCOL}://localhost:${Constants.WS.PORT}`, {
        path: Constants.WS.PATH,
        query: {
          deviceId,
        },
      });
      socket.on('connect', done);
      socket.connect();
    });

    describe('on connect', () => {
      it('should set the socket client', () => {
        expect(WSServer.instance.getIoClient(deviceId)).not.toBe(undefined);
      });

      it.skip('should emit auth_granted', done => {
        socket.on('auth_granted', () => {
          done();
        });
      });

      it('client status should be active', () => {
        const deviceInfo = WSServer.instance.getDeviceInfo(deviceId);
        expect(deviceInfo.status).toEqual('active');
      });

      it('the client should be joined to the application room', () => {
        const client = WSServer.instance.getIoClient(deviceId);
        expect(client?.rooms).toContain(WSServer.instance.getRoomId());
      });
    });

    describe('on disconnect', () => {
      beforeEach(() => {
        WSServer.instance.disconnectClient(deviceId);
      });

      it('should clear the scoket client', () => {
        expect(WSServer.instance.getIoClient(deviceId)).toBe(undefined);
      });
    });

    describe('on get clip', () => {
      it('should send the requested clip', done => {
        socket.on('get_clip', (res: Clip) => {
          expect(res.clipId).toEqual(clipId);
          done();
        });
        socket.emit('get_clip', {clipId});
      });
    });

    describe('on get audio', () => {
      it('should send the requested audio asset', done => {
        socket.on('get_audio', (res: {audio: string; clipId: string}) => {
          expect(res).toMatchObject({
            clipId,
            audio: expect.any(String),
          });
          done();
        });
        socket.emit('get_audio', {clipId});
      });
    });

    describe('on current project', () => {
      it('should send the current project info', done => {
        socket.on('current_project', res => {
          expect(res).toMatchObject({
            id: sessionId,
            clips: expect.arrayContaining([
              {
                name: clip.name,
                clipId: clip.clipId,
                lastUpdate: clip.lastUpdate,
                mime: 'audio/wav',
              },
            ]),
            name: projectName,
            groups,
            currentClipId: clipId,
            lastUpdate: expect.any(Number),
          });
          done();
        });
        socket.emit('current_project');
      });
    });

    describe('on sendClipUpdate', () => {
      it('should send the updated clip', done => {
        socket.on('clip_update', res => {
          const keys = Object.keys(res);
          expect(keys).toEqual(
            expect.arrayContaining([
              'audio',
              'clipId',
              'haptic',
              'settings',
              'svg',
              'markers',
            ]),
          );
          done();
        });
        WSServer.instance.sendClipUpdate(clipId);
      });
    });

    describe('get devices info', () => {
      it('should return informations about the connected devices', () => {
        const info = WSServer.instance.getDevicesInfo();
        expect(info).toMatchObject({
          [deviceId]: {
            deviceId,
            status: 'active',
          },
        });
      });
    });

    describe('on get ahap', () => {
      it('should send the ahap files', done => {
        socket.on('get_ahap', (res: {clipId: string}) => {
          expect(res).toMatchObject({
            clipId,
            ahap: {
              continuous: expect.any(String),
              transients: expect.any(String),
            },
          });
          done();
        });
        socket.emit('get_ahap', {clipId});
      });
    });

    describe('on get android', () => {
      it('should send the amplitudes and timings arrays', done => {
        socket.on('get_android', (res: {clipId: string}) => {
          expect(res).toMatchObject({
            clipId,
            data: {
              amplitudes: expect.any(Array),
              timings: expect.any(Array),
            },
          });
          done();
        });
        socket.emit('get_android', {clipId});
      });
    });

    describe('on get_audio', () => {
      it('should send the audio as a byte array when the binary parameter is true', done => {
        socket.on(
          'get_audio_binary',
          (res: {audio: Buffer; clipId: string}) => {
            expect(res).toMatchObject({
              clipId,
              audio: expect.any(Buffer),
            });
            done();
          },
        );
        socket.emit('get_audio', {clipId, binary: true});
      });

      it('should send the audio as a base64 data URI for legacy support', done => {
        socket.on('get_audio', (res: {audio: string; clipId: string}) => {
          const [metadata, encodedAudio] = res.audio.split(',');
          expect(res.clipId).toBe(clipId);
          expect(metadata).toBe('data:audio/wav;base64');
          expect(Buffer.from(encodedAudio, 'base64')).toEqual(
            fs.readFileSync(clip.audioAsset?.path ?? ''),
          );
          done();
        });
        socket.emit('get_audio', {clipId});
      });

      it('should send an null audio property if there is no audio in the clip', done => {
        socket.on(
          'get_audio_binary',
          (res: {audio: Buffer | null; clipId: string}) => {
            expect(res).toMatchObject({
              clipId: noAudioClipId,
              audio: null,
            });
            done();
          },
        );
        socket.emit('get_audio', {clipId: noAudioClipId, binary: true});
      });

      it.each([
        ['a non-audio file', 'id_rsa'],
        ['a non-audio file with an audio extension', 'fake.wav'],
      ])('should not send %s', async (_label, fileName) => {
        const filePath = path.join(samplesPath, '..', 'tmp', fileName);
        fs.mkdirSync(path.dirname(filePath), {recursive: true});
        fs.writeFileSync(filePath, 'secret');
        Project.instance.loadContent({
          ...projectFileContent,
          clips: [{...clip, audioAsset: {path: filePath}}],
        });
        const res = await new Promise<{audio: Buffer | null; clipId: string}>(
          resolve => {
            socket.on('get_audio_binary', resolve);
            socket.emit('get_audio', {clipId, binary: true});
          },
        );
        fs.rmSync(filePath, {force: true});
        expect(res).toMatchObject({clipId, audio: null});
      });
    });

    describe('on metadata', () => {
      it('should return the app version', done => {
        jest.spyOn(Utils, 'getAppVersion').mockReturnValue('1.2.3');
        socket.on('metadata', (res: {version: string}) => {
          expect(res).toMatchObject({
            version: '1.2.3',
          });
          done();
        });
        socket.emit('metadata');
      });
    });
  });
});
