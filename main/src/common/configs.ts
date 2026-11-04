/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Singleton utility class that handles the application configurations loadedd from file
 * It loads configurations in memory, so they can be accessed from anywhere in the application
 * Configurations can be also merged and saved to disk for persistence
 */
import fs from 'fs';
import {
  merge as lodashMerge,
  pick,
  set as lodashSet,
  unset as lodashUnset,
  isEmpty,
  isNil,
} from 'lodash';
import path from 'path';
import rimraf from 'rimraf';
import arrayMove from 'array-move';
import {promisify} from 'util';
import osname from 'os-name';
import {SemVer} from 'semver';

import packageJson from '../../../package.json';
import {loadJSONFile, saveJSONFile} from './utils';
import {PathManager} from '../services';
import Project from './project';
import Constants from './constants';
import Logger from './logger';

const singletonEnforcer = Symbol('singletonEnforcer');

/**
 * Contains some useful information like platform and paths
 */
export interface AppConfig {
  name: string;
  description: string;
  version: string; // Current app version

  platform: string;
  arch: string;
  env: string;

  applicationPath: string;
  distPath: string;
  publicPath: string | undefined;
  tmpPath: string;
  dataPath: string;
  configPath: string;
  configFileName: string;
  configFilePath: string;
  exampleConfigFilePath: string;
  osName: string;
  osVersion: string;
  projectFile: {
    extension: string;
    version: AppVersion;
  };
}

export interface AppVersion {
  major: number;
  minor: number;
  patch: number;
}

/**
 * Contains project info used by the application at runtime to identify the project
 */
export interface ProjectMetadata {
  name: string;
  projectFile?: string;
  openedAt?: number;
  updatedAt?: number;
  clipsCount?: number;
  // mtime of the project file when it was last saved by Studio or allowed by the user
  trustedMtime?: number;

  // Fields reserved for samples and tutorials
  icon?: string;
  category?: string;
  description?: string;
  slug?: string;
  version?: string;
  order?: number;
  new?: boolean;
}

export interface SampleProject {
  [category: string]: ProjectMetadata[];
}

/**
 * Contains current project info used by the application at runtime to identify the project
 */
export interface CurrentProject {
  projectFile?: string;
  name: string;
  dirty: boolean;
  tmpProjectFile: string;
}

export interface CurrentProjectOrigin {
  tmpProjectFile: string;
  isSample: boolean;
  // Optional so configs persisted before these were tracked still load.
  isTutorial?: boolean;
  isAuthoringTutorial?: boolean;
}

export interface Config {
  version: string; // Configuration file version
  app: AppConfig;
  globals: {
    maxRecentProjects?: number;
    maxUploadSize?: number;
    apiTimeout?: number;
    maxAudioDuration?: number;
    ahapWarning?: boolean;
  };
  actuators: {
    path: string;
  };
  renderers: {
    path: string;
  };
  recentProjects: ProjectMetadata[];
  currentProject: CurrentProject;
  currentProjectOrigin?: CurrentProjectOrigin;
  knownDevices: string[];
  termsAccepted: boolean;
  deviceId: string;
  userId: string;
  lastExportedPath: string;
  $iterator(): Iterator<any>;
}
type PersistedKey = keyof Config;
const persistedKeys: PersistedKey[] = [
  'globals',
  'recentProjects',
  'currentProject',
  'currentProjectOrigin',
  'version',
  'knownDevices',
  'termsAccepted',
  'deviceId',
  'userId',
  'lastExportedPath',
];

export default class Configs {
  /**
   * Static
   * Return the samples projects list
   * @return { ProjectMetadata[] } - Samples list
   */
  public static getSamplesProjects(): ProjectMetadata[] {
    let samples: ProjectMetadata[] = [];
    const samplesPath = PathManager.instance.getSamplesPath();

    // Use the metadata file to load samples, if available
    const metadataFilePath = path.join(
      samplesPath,
      Constants.PROJECT.SAMPLES_METADATA_FILENAME,
    );

    try {
      const metadata = loadJSONFile<ProjectMetadata[]>(metadataFilePath);
      samples = metadata.map(sample => {
        const {projectFile, icon = 'icon.svg'} = sample;
        if (!projectFile) {
          return sample;
        }
        return {
          ...sample,
          projectFile: path.join(samplesPath, projectFile),
          icon: path.join(samplesPath, icon),
        };
      });
    } catch {
      Logger.error('Failed to load samples metadata file');
      return [];
    }

    return samples;
  }

  public configs: Config;

  private static singleton: Configs;

  /**
   * Represents an instance of the application configurations handler
   * @constructor
   * */
  constructor(enforcer: symbol) {
    if (enforcer !== singletonEnforcer) {
      throw new Error('Cannot construct singleton');
    }
    this.configs = {} as Config;
  }

  /**
   * Returns the current instance
   * @return { Configs } - Current Configs instance
   * */
  static get instance(): Configs {
    if (!Configs.singleton) {
      Configs.singleton = new Configs(singletonEnforcer);
    }
    return Configs.singleton;
  }

  /**
   * Get configs object
   */
  static get configs(): Config {
    return Configs.instance.configs;
  }

  /**
   * Load configurations in memory
   */
  public load(): Config {
    const app: AppConfig = {} as AppConfig;
    // Static configs
    app.platform = process.platform;
    app.arch = process.arch;
    app.env = process.env.NODE_ENV || 'production';

    app.applicationPath = PathManager.instance.getApplicationPath();
    app.distPath = PathManager.instance.getDistPath();
    app.publicPath = PathManager.instance.getPublicPath();
    app.dataPath = process.env.DATA_PATH || PathManager.instance.getDataPath();

    // Set the base application configuration
    const {name, description, version} = packageJson;
    app.name = name;
    app.description = description;
    app.version = version;

    const [osName, ...osVersion] = osname().split(' ');
    app.osName = osName;
    app.osVersion = osVersion.join(' ');

    // Paths
    app.configPath = path.join(app.dataPath, 'configs');
    app.configFileName = `configs.${app.env}.json`;
    app.configFilePath = path.join(app.configPath, app.configFileName);
    app.exampleConfigFilePath = path.join(
      app.distPath,
      'configs',
      app.configFileName,
    );
    if (!fs.existsSync(app.configPath)) {
      fs.mkdirSync(app.configPath, {recursive: true});
    }

    // Temporary projects path
    app.tmpPath = path.join(app.dataPath, 'tmp');
    if (!fs.existsSync(app.tmpPath)) {
      fs.mkdirSync(app.tmpPath, {recursive: true});
    }

    // Generate the config file, if missing
    if (!fs.existsSync(app.configFilePath)) {
      if (fs.existsSync(app.exampleConfigFilePath)) {
        fs.copyFileSync(app.exampleConfigFilePath, app.configFilePath);
      }
    }

    const semver = new SemVer(app.version);

    // Project file metadata
    app.projectFile = {
      extension: Constants.PROJECT.EXTENSION,
      version: {
        major: semver.major,
        minor: semver.minor,
        patch: semver.patch,
      },
    };

    // Load configurations from file
    // The user configs are external configs that are user dependent (like `recentProjects` or `currentProject`)
    const userConfigs = loadJSONFile<Partial<Config>>(app.configFilePath);
    // The env configs are constants that depend on the application environment.
    // They are not modified by the user, so they are not saved into an external file.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const envConfigs = require(`./constants.${app.env}`).default as Config;

    this.configs = {
      ...userConfigs,
      ...envConfigs,
      app,
    };

    return this.configs;
  }

  /**
   * Set a configuration element
   * @param {string} key - key to update in the config file
   * @param {string} value - new value
   * @param {boolean} save - if true, the configuration object is saved to disk
   */
  public set<T = Record<string, unknown>>(
    key: string,
    value: T,
    save: boolean = true,
  ): void {
    lodashSet(this.configs, key, value);
    if (save) {
      this.save();
    }
  }

  /**
   * Unset a configuration element
   * @param {string} key - key to unset in the config file
   * @param {boolean} save - if true, the configuration object is saved to disk
   */
  public unset(key: string, save: boolean = true): void {
    lodashUnset(this.configs, key);
    if (save) {
      this.save();
    }
  }

  /**
   * Merge a Configs object into the main configs object
   * @param {object} configs - New Configs object
   * @param {boolean} save - if true, the configuration object is saved to disk
   */
  public merge(configs: Partial<Config>, save: boolean = true): void {
    lodashMerge(this.configs, configs);
    if (save) {
      this.save();
    }
  }

  /**
   * Saves the current configurations object to disk
   */
  public save(): void {
    const {app} = this.configs;
    const {configFilePath} = app;
    let configFileContent = loadJSONFile<Partial<Config>>(configFilePath);
    configFileContent = pick(this.configs, persistedKeys);
    saveJSONFile(configFilePath, configFileContent);
  }

  /**
   * Add current project to the recent projects array
   * It removes the eldest one if max size is exceeded
   * If the project is already present in the recent projects list, moves the element to first position
   * @param {ProjectMetadata} project - Project to add
   */
  public addRecentProject(project: ProjectMetadata): void {
    let {recentProjects} = this.configs;
    const foundIndex = recentProjects.findIndex(p => {
      return p.projectFile === project.projectFile;
    });
    if (foundIndex < 0) {
      // Project not found, add to first position
      // Remove the eldest project from the array if max size is exceeded
      if (recentProjects.length >= Constants.MAX_RECENT_PROJECTS) {
        recentProjects.pop();
      }
      recentProjects.unshift({
        ...project,
        openedAt: Date.now(),
        clipsCount: Project.instance.getClips().length,
      });
    } else {
      // If the project is found in recent projects, move it to first position
      recentProjects = arrayMove(recentProjects, foundIndex, 0);
      // Update the project name, if changed
      if (
        !isEmpty(Project.instance.getName()) &&
        recentProjects[0].name !== Project.instance.getName()
      ) {
        recentProjects[0].name = Project.instance.getName();
      }
      recentProjects[0].openedAt = Date.now();
      recentProjects[0].clipsCount = Project.instance.getClips().length;
    }
    this.set('recentProjects', recentProjects);
  }

  /**
   * Marks a recent project as trusted at the current modification time of its file
   * @param {string} projectFile - The project file
   */
  public trustRecentProject(projectFile: string): void {
    const project = this.configs.recentProjects.find(
      p => p.projectFile === projectFile,
    );
    if (!project || !fs.existsSync(projectFile)) return;
    project.trustedMtime = fs.statSync(projectFile).mtimeMs;
    this.save();
  }

  /**
   * Checks if a project file is a trusted recent project that has not been modified since
   * @param {string} projectFile - The project file
   * @return {boolean} True if the project is trusted
   */
  public isTrustedRecentProject(projectFile: string): boolean {
    const project = this.configs.recentProjects.find(
      p => p.projectFile === projectFile,
    );
    const trustedMtime = project?.trustedMtime;
    if (isNil(trustedMtime) || !fs.existsSync(projectFile)) {
      return false;
    }
    return fs.statSync(projectFile).mtimeMs === trustedMtime;
  }

  /**
   * Remove a project from the recent projects array
   * @param {ProjectMetadata} project - Project to remove
   */
  public removeRecentProject(project: ProjectMetadata): void {
    const {recentProjects} = this.configs;
    const foundIndex = recentProjects.findIndex(p => {
      return p.projectFile === project.projectFile;
    });
    if (foundIndex >= 0) {
      recentProjects.splice(foundIndex, 1);
      this.save();
    }
  }

  /**
   * Replace a project in the recent projects array with a new one
   * @param {ProjectMetadata} oldProject Project to be replaced
   * @param {ProjectMetadata} newProject Project to replace
   */
  public replaceRecentProject(
    oldProject: ProjectMetadata,
    newProject: ProjectMetadata,
  ): void {
    if (isEmpty(oldProject.projectFile) || isEmpty(newProject.projectFile)) {
      return;
    }
    this.removeRecentProject(oldProject);
    this.addRecentProject(newProject);
  }

  /**
   * Set the current project
   * @param {CurrentProject} currentProject the current project
   */
  public setCurrentProject(currentProject: CurrentProject): void {
    this.set('currentProject', currentProject);
  }

  /**
   * Get the current project
   * @return {CurrentProject} the current project
   */
  public getCurrentProject(): CurrentProject {
    return this.configs.currentProject || {};
  }

  public setCurrentProjectOrigin(origin: CurrentProjectOrigin): void {
    this.set('currentProjectOrigin', origin);
  }

  public getCurrentProjectOrigin(): CurrentProjectOrigin | undefined {
    return this.configs.currentProjectOrigin;
  }

  /**
   * Get the current project file
   * @return {string} - Current project file
   */
  public getCurrentProjectFile(): string {
    return this.getCurrentProject().tmpProjectFile;
  }

  /**
   * Clear the current project
   */
  public clearCurrentProject(): void {
    const rmpDir = promisify(rimraf);
    const {tmpProjectFile} = this.configs.currentProject;
    if (tmpProjectFile && fs.existsSync(tmpProjectFile)) {
      const tmpProjectDir = path.dirname(tmpProjectFile);
      void rmpDir(tmpProjectDir);
    }
    this.unset('currentProjectOrigin', false);
    this.set('currentProject', {});
    Project.instance.close();
  }

  /**
   * Has current project
   */
  public hasCurrentProject(): boolean {
    return !isEmpty(this.configs.currentProject);
  }

  /**
   * Check if the current project needs to be saved
   * Return true if the project needs to be saved (dirty == true)
   */
  public isCurrentProjectDirty(): boolean {
    const {currentProject} = this.configs;
    return !isEmpty(currentProject) && currentProject.dirty;
  }

  /**
   * Get the current app version
   */
  public getAppVersion(): AppVersion {
    const {app} = this.configs;
    return app.projectFile.version;
  }

  /**
   * Get recent projects
   */
  public getRecentProjects(): ProjectMetadata[] {
    const {recentProjects} = this.configs;
    return recentProjects
      .filter(r => !isEmpty(r.projectFile))
      .map(r => {
        return {
          ...r,
          updatedAt: fs.existsSync(r.projectFile!)
            ? fs.statSync(r.projectFile!).mtime.getTime()
            : -1,
        };
      })
      .sort((a, b) => (b?.openedAt || 0) - (a?.openedAt || 0));
  }

  /**
   * Checks if an HMD device has been already identified
   * @return {boolean} True if the device is found
   */
  public isDeviceKnown(deviceId: string): boolean {
    const {knownDevices = []} = this.configs;
    return knownDevices.includes(deviceId);
  }

  /**
   * Add a device to the known devices list
   * @param {string} deviceId Device ID
   */
  public addDeviceToKnownList(deviceId: string): void {
    const {knownDevices = []} = this.configs;
    if (!this.isDeviceKnown(deviceId)) {
      this.set('knownDevices', [...knownDevices, deviceId]);
    }
  }
}
