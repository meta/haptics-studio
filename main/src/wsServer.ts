/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import os from 'os';
import fs from 'fs';
import {Server, Socket} from 'socket.io';
import dgram from 'dgram';
import _, {isEmpty, isNil, pick} from 'lodash';
import {createServer, Server as HttpServer} from 'http';
import {v4 as uuidv4} from 'uuid';
import {hapticDataToSplitAhap} from './hapticsSdk';

import Logger from './common/logger';
import Constants from './common/constants';
import Project, {Clip} from './common/project';
import {verifyAudioAssetPath} from './common/project/assetSecurity';
import {setCurrentClip} from './actions/project';
import MainApplication from './application';
import Configs from './common/configs';
import {
  generateRandomDigits,
  getAppVersion,
  getFileMimeType,
  sanitizedEnvelopes,
} from './common/utils';
// @oss-disable
import {getAmplitudeAndTimingArrays} from './hapticsSdk';

const singletonEnforcer = Symbol('singletonEnforcer');

export interface DeviceInfo {
  deviceId: string;
  name: string;
  model: string;
  version: string;
  packagedVersion?: string;
  upgradeNeeded?: boolean;
  status?: string;
}

export interface SocketClientInfo {
  client: Socket;
  info: DeviceInfo;
}

export type ClientStatus = 'disconnected' | 'connecting' | 'active' | 'unknown';

export default class WSServer {
  private static singleton: WSServer;

  private io!: Server;

  private httpServer!: HttpServer;

  private udpClient!: dgram.Socket;

  private ioClients: {[deviceId: string]: SocketClientInfo} = {};

  private roomId: string;

  private authCode!: string | undefined;

  private authCodeExpriresAt!: number | undefined;

  private advertisingInterval!: ReturnType<typeof setInterval>;

  private authCodeTimeout!: ReturnType<typeof setTimeout>;

  private isStopping = false;

  /**
   * Starts the UDP advertising that allows Studio to be discvered by HMD
   * Starts the Webscoket server
   */
  public start(): void {
    this.isStopping = false;
    this.setupUdpAdvertising();
    this.setupWSServer();
  }

  /**
   * Stops the UDP advertising
   * Disconnects connected clients and stops the Websocket server.
   * Resolves once the server has fully closed.
   */
  public async stop(): Promise<void> {
    // Set before disconnecting clients: each client's disconnect handler calls
    // startUdpAdvertising(), which would otherwise re-create the advertising
    // interval we are tearing down here.
    this.isStopping = true;
    clearTimeout(this.authCodeTimeout);
    clearInterval(this.advertisingInterval);
    this.disconnectAllClients();
    await this.closeWSServer();
  }

  public getIoClient(id: string): Socket | undefined {
    return this.ioClients[id]?.client;
  }

  /**
   * Emit an event to a specific client (HMD)
   */
  public emit<T = Record<string, unknown>>(
    deviceId: string,
    event: string,
    payload?: T,
  ): void {
    const {client} = this.ioClients[deviceId];
    if (client && client.connected) {
      Logger.debug(`Emitting websocket event: ${event}`);
      client.emit(event, payload || {});
    }
  }

  /**
   * Emit an event to a specific room
   */
  public sendToRoom<T = Record<string, unknown>>(
    event: string,
    payload?: T,
    room?: string,
  ): void {
    if (this.io) {
      const roomToSend = room || this.roomId;
      Logger.debug(`Sending websocket event ${event} to room ${roomToSend}.`);
      this.io.to(roomToSend).emit(event, payload || {});
    }
  }

  /**
   * Sends a message with the current project info
   * */
  public sendCurrentProject(): void {
    const clips = Project.instance.getClips().map(clip => {
      const {name, clipId, lastUpdate, audioAsset} = clip;
      const mime = audioAsset ? getFileMimeType(audioAsset?.path) : '';
      return {name, clipId, lastUpdate, mime};
    });
    const payload = {
      id: Project.instance.getState().sessionId,
      clips,
      name: Project.instance.getName(),
      groups: Project.instance.getGroups(),
      currentClipId: Project.instance.getCurrentClip()?.clipId || '',
      lastUpdate: _.max(_.compact(clips.map(c => c.lastUpdate))),
    };
    this.sendToRoom('current_project', payload);
  }

  /**
   * Sends the current clip id
   * */
  public sendCurrentClip(): void {
    const payload = {
      currentClipId: Project.instance.getCurrentClip()?.clipId || '',
    };
    this.sendToRoom('current_clip', payload);
  }

  /**
   * Sends an update message when the clip changes
   */
  public sendClipUpdate(clipId?: string): void {
    const clip = clipId
      ? Project.instance.getClipById(clipId)
      : Project.instance.getCurrentClip();
    this.sendClip('clip_update', clip);
  }

  /**
   * Notifies the socket that the project was closed
   * */
  public sendProjectClose(): void {
    this.sendToRoom('project_close');
  }

  /**
   * Generates a new auth code and start the workflow to renew it periodically
   */
  public runAuthorizationWorkflow(): void {
    clearTimeout(this.authCodeTimeout);
    // Run authorizazion only if the pairing code is required
    if (Constants.WS.REQUIRE_PAIRING_CODE) {
      this.authCode = generateRandomDigits();
      this.authCodeExpriresAt = Date.now() + Constants.WS.AUTH_CODE_VALIDITY;
      this.sendAuthCode();
      Logger.debug('runAuthorizationWorkflow', this.authCode);
      this.authCodeTimeout = setTimeout(() => {
        this.runAuthorizationWorkflow();
      }, Constants.WS.AUTH_CODE_VALIDITY);
    }
  }

  public getDevicesInfo(): {[deviceId: string]: DeviceInfo} {
    const result: {[deviceId: string]: DeviceInfo} = {};
    // eslint-disable-next-line no-restricted-syntax
    for (const deviceId of Object.keys(this.ioClients)) {
      result[deviceId] = this.getDeviceInfo(deviceId);
    }

    Logger.debug('getDevicesInfo', result);
    return result;
  }

  public getDeviceInfo(deviceId: string): DeviceInfo {
    const {info} = this.ioClients[deviceId];

    const deviceInfo = {
      ...info,
      status: this.getClientStatus(deviceId),
    };
    return deviceInfo;
  }

  public disconnectClient(deviceId: string): void {
    const {client} = this.ioClients[deviceId];
    client?.disconnect();
  }

  /**
   * Gracefully disconnects every connected client
   */
  public disconnectAllClients(): void {
    // eslint-disable-next-line no-restricted-syntax
    for (const deviceId of Object.keys(this.ioClients)) {
      this.ioClients[deviceId]?.client?.disconnect();
    }
  }

  public getRoomId(): string {
    return this.roomId;
  }

  public startUdpAdvertising(): void {
    if (this.isStopping) {
      return;
    }
    clearInterval(this.advertisingInterval);
    this.advertisingInterval = setInterval(() => {
      this.broadcastMessage();
    }, Constants.UDP.ADVERTISING_TIMEOUT);
  }

  public stopUdpAdvertising(): void {
    Logger.debug('Stopped UDP broadcasting');
    clearInterval(this.advertisingInterval);
  }

  constructor(enforcer: symbol) {
    if (enforcer !== singletonEnforcer) {
      throw new Error('Cannot construct singleton');
    }
    // Set up unique room ID
    this.roomId = uuidv4();
  }

  static get instance(): WSServer {
    if (!WSServer.singleton) {
      WSServer.singleton = new WSServer(singletonEnforcer);
    }
    return WSServer.singleton;
  }

  private getClientStatus(deviceId: string): ClientStatus {
    const {client} = this.ioClients[deviceId];

    if (isNil(client)) {
      return 'disconnected';
    }

    if (client.connected) {
      return Configs.instance.isDeviceKnown(deviceId) ? 'active' : 'connecting';
    }

    return 'unknown';
  }

  private stopAuthorizationWorkflow() {
    Logger.debug('Stopping Authorization handler');
    clearTimeout(this.authCodeTimeout);
    this.authCode = undefined;
    this.authCodeExpriresAt = undefined;
  }

  private sendAuthCode() {
    MainApplication.instance.sendToUI('ws_auth_code', {
      authCode: this.authCode,
      expiresAt: this.authCodeExpriresAt,
    });
  }

  private setupUdpAdvertising(): void {
    try {
      this.udpClient = dgram.createSocket({
        type: 'udp4',
        reuseAddr: true,
      });
      this.udpClient.bind(Constants.UDP.ADVERTISING_PORT);

      this.udpClient.on('error', e => {
        Logger.error(e.message);
      });

      this.udpClient.on('listening', () => {
        Logger.debug('UDP communication started');
        this.udpClient.setBroadcast(true);
        this.udpClient.setMulticastTTL(128);
        this.startUdpAdvertising();
      });
    } catch (error) {
      const err = error as Error;
      const message = 'Error setupping UDP communication';
      Logger.error(message);
      MainApplication.instance.sendToUI('error', {status: 'error', message});
      Logger.logError(err);
    }
  }

  private broadcastMessage(): void {
    const options = {hostname: os.hostname(), port: Constants.WS.PORT};
    const message = JSON.stringify(options);
    this.udpClient?.send(
      message,
      0,
      message.length,
      Constants.UDP.ADVERTISING_PORT,
      Constants.UDP.BROADCAST_ADDRESS,
    );
    Logger.silly('Broadcasted UDP message..');
  }

  private closeWSServer(): Promise<void> {
    return new Promise<void>(resolve => {
      if (!this.io) {
        resolve();
        return;
      }
      // io.close() disconnects all clients and closes the underlying HTTP
      // server. The callback fires once every connection is closed, ensuring
      // pending frames are flushed before we resolve.
      this.io.close(() => {
        resolve();
      });
    });
  }

  private setupWSServer(): void {
    try {
      this.httpServer = createServer();
      this.io = new Server(this.httpServer, {
        path: Constants.WS.PATH,
        pingInterval: 5000,
        maxHttpBufferSize: Constants.WS.MAX_HTTP_BUFFER_SIZE,
      });
      this.io.on('connection', (client: Socket) => {
        const {handshake} = client;
        const {query} = handshake;
        const {deviceId = ''} = query as unknown as DeviceInfo;
        const pingSocket = query.ping && query.ping === 'True';

        Logger.debug('queryParams', query);
        Logger.debug(
          `Client connected with socket id ${client.id} and deviceId ${deviceId}`,
        );

        // when a device connects, stop the advertising only if the device panel is closed
        if (!pingSocket || !MainApplication.instance.getDevicePanelOpen()) {
          this.stopUdpAdvertising();
        }

        if (isEmpty(deviceId)) {
          Logger.warn('Missing device identifier in socket connection');
          client.disconnect();
          return;
        }

        // Ping request from the HMD to check if the usb connection is live, can be disconnected with away
        if (pingSocket) {
          client.disconnect();
          return;
        }

        client.on('error', (e: Error) => {
          Logger.error(e.message);
        });
        client.on('disconnect', () => {
          Logger.debug(`Client with id ${client.id} disconnected`);
          // remove the client from the room
          client?.leave(this.roomId);
          client?.removeAllListeners();
          this.startUdpAdvertising();
          delete this.ioClients[deviceId];
          // Send devices connetion status to the UI
          MainApplication.instance.sendToUI(
            'devices_status',
            this.getDevicesInfo(),
          );
        });

        const info = pick(query as unknown as DeviceInfo, [
          'model',
          'name',
          'deviceId',
          'version',
        ]);
        this.ioClients[deviceId] = {client, info};

        // if the device is already known, just setup the messages callbacks
        // or if the pairing code is not required, just grant access
        if (
          Configs.instance.isDeviceKnown(deviceId) ||
          !Constants.WS.REQUIRE_PAIRING_CODE
        ) {
          this.bindCallbacks(deviceId);

          this.emit(deviceId, 'auth_granted');
        } else {
          // if the device is unknown, generate a random code
          // then show that code on studio desktop and send a request to the HMD to open a prompt to insert the code
          this.bindAuthCallbacks(deviceId);

          // if the auth code has been already generated from the onboarding flow, do not generate a new one
          if (isEmpty(this.authCode)) {
            this.runAuthorizationWorkflow();
          } else {
            this.sendAuthCode();
          }
          this.emit(deviceId, 'auth_required');
          MainApplication.instance.sendToUI('device_auth_request', {deviceId});
        }

        // Send devices connetion status to the UI
        MainApplication.instance.sendToUI(
          'devices_status',
          this.getDevicesInfo(),
        );
      });
      this.io.on('error', (e: Error) => {
        Logger.error(e.message);
      });
      this.httpServer.on('error', (e: NodeJS.ErrnoException) => {
        if (e.code === 'EADDRINUSE') {
          Logger.error('Error starting WebSocket server: ', e.message);
          const message = `Error starting WebSocket server. Please make sure you don't have any other applications \
            running on port ${Constants.WS.PORT} and restart the application.`;
          MainApplication.instance.sendToUI('error', {
            status: 'error',
            message,
          });
        } else {
          Logger.logError(e);
        }
      });
      this.httpServer.listen(Constants.WS.PORT);
    } catch (error) {
      Logger.logError(error as Error);
    }
  }

  private bindAuthCallbacks(deviceId: string): void {
    const {client} = this.ioClients[deviceId];

    if (isNil(client)) {
      Logger.warn('Missing websocket client');
      return;
    }

    client.on('auth_request', (args: {authCode: string}) => {
      const {authCode = ''} = args;
      let status = 'error';
      if (authCode === this.authCode && deviceId) {
        status = 'ok';

        // Stop the authorization workflow
        this.stopAuthorizationWorkflow();

        // bind the default messages callbacks
        this.bindCallbacks(deviceId);

        // Send devices connetion status to the UI
        MainApplication.instance.sendToUI(
          'devices_status',
          this.getDevicesInfo(),
        );
      }
      this.emit(deviceId, 'auth_request', {status});
    });
  }

  private bindCallbacks(deviceId: string): void {
    const {client} = this.ioClients[deviceId];

    if (isNil(client)) {
      Logger.warn('Missing websocket client');
      return;
    }
    // @oss-disable
    // @oss-disable
      // @oss-disable
    // @oss-disable

    // Add the current device id to the list of known devices
    Configs.instance.addDeviceToKnownList(deviceId);

    // Add the client to the room
    void client.join(this.roomId);

    client.on('metadata', () => {
      this.sendToRoom('metadata', {
        version: getAppVersion(),
      });
    });

    // Clips callbacks

    client.on('get_clip', (args: {clipId: string}) => {
      const {clipId = ''} = args;
      const clip = Project.instance.getClipById(clipId);
      this.sendClip('get_clip', clip);
    });

    client.on('get_current_clip', () => {
      const clip = Project.instance.getCurrentClip();
      this.sendClip('get_current_clip', clip);
    });

    client.on('set_current_clip', (args: {clipId: string}) => {
      const {clipId = ''} = args;
      Logger.debug('set_current_clip', clipId);
      setCurrentClip(clipId);
      MainApplication.instance.sendToUI('set_current_clip', {clipId});
    });

    // Project callbacks

    client.on('current_project', () => {
      this.sendCurrentProject();
    });

    // Assets callbacks

    client.on('get_audio', async (args: {clipId: string; binary?: boolean}) => {
      const {clipId = '', binary} = args;
      const clip = Project.instance.getClipById(clipId);
      const assetPath = clip?.audioAsset?.path;
      const audioPath = assetPath
        ? await verifyAudioAssetPath(assetPath)
        : undefined;
      if (clip && audioPath) {
        if (binary) {
          const audio = await fs.promises.readFile(audioPath);
          this.sendToRoom('get_audio_binary', {audio, clipId: clip?.clipId});
        } else {
          // Legacy support for older companion app versions
          const audioBuffer = await fs.promises.readFile(audioPath);
          const audio = `data:${getFileMimeType(audioPath)};base64,${audioBuffer.toString('base64')}`;
          this.sendToRoom('get_audio', {audio, clipId: clip?.clipId});
        }
      } else {
        this.sendToRoom(binary ? 'get_audio_binary' : 'get_audio', {
          audio: null,
          clipId,
        });
      }
    });

    client.on('get_ahap', (args: {clipId: string}) => {
      const {clipId = ''} = args;
      const clip = Project.instance.getClipById(clipId);
      if (clip) {
        const {haptic} = clip;
        if (haptic) {
          const data = sanitizedEnvelopes(haptic);
          if (data) {
            const ahap = hapticDataToSplitAhap(data);
            this.sendToRoom('get_ahap', {ahap, clipId});
          }
        }
      }
    });

    client.on(
      'get_android',
      (args: {clipId: string; gain?: number; sampleRate?: number}) => {
        const {clipId = '', gain, sampleRate} = args;
        const clip = Project.instance.getClipById(clipId);
        if (clip) {
          const {haptic} = clip;
          if (haptic) {
            const data = sanitizedEnvelopes(haptic);
            if (data) {
              const androidData = getAmplitudeAndTimingArrays(
                data,
                gain,
                sampleRate,
              );
              this.sendToRoom('get_android', {clipId, data: androidData});
            }
          }
        }
      },
    );
  }

  private sendClip(action: string, clip?: Clip) {
    let payload = {};
    if (clip && clip.haptic) {
      const {
        clipId,
        settings,
        name,
        audioAsset,
        waveform,
        markers = [],
        lastUpdate = Date.now(),
        playhead = 0,
      } = clip;
      const audioFileExists =
        audioAsset && audioAsset.path ? fs.existsSync(audioAsset.path) : false;
      const data = sanitizedEnvelopes(clip.haptic);
      if (data) {
        payload = {
          audio: {path: audioAsset?.path, name, exists: audioFileExists},
          clipId,
          haptic: JSON.stringify(data),
          settings,
          svg: waveform,
          markers,
          lastUpdate,
          name,
          playhead,
        };
      }
    }
    this.sendToRoom(action, payload);
  }
}
