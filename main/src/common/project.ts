/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import {promisify} from 'util';
import fs from 'fs';
import fse from 'fs-extra';
import path from 'path';
import {cloneDeep, omit, isNil} from 'lodash';
import {MetaData} from '../hapticsSdk';
import {v4 as uuidv4} from 'uuid';

import Configs, {ProjectMetadata} from './configs';
import {
  getAppVersion,
  isSampleProject,
  loadJSONFile,
  now,
  saveJSONFile,
  semVerFromObject,
} from './utils';
import Logger from './logger';
import {build} from '../../../package.json';
import Constants from './constants';

// Import from extracted modules
import {
  AssetFile,
  OathSettings,
  ClipMarker,
  Clip,
  ClipGroup,
  ProjectState,
  ClipInfo,
  ProjectVersion,
  ProjectContent,
  ExportableContent,
  // Clip operations
  getClips as getClipsFromContent,
  getCurrentClip as getCurrentClipFromContent,
  getClipById as getClipByIdFromContent,
  addOrUpdateClip as addOrUpdateClipToContent,
  deleteClip as deleteClipFromContent,
  updateClip as updateClipInContent,
  duplicateClip as duplicateClipInContent,
  // Asset path utilities
  getDefaultProjectPath as getDefaultProjectPathUtil,
  setAbsoluteAssetsPaths,
  setRelativeAssetsPath,
  // Project sanitizer
  isProjectVersionCompatible,
  needsSettingsRemapping,
  parseSettings,
  sanitizeProject,
} from './project/index';

// Re-export types for backward compatibility
export type {
  AssetFile,
  OathSettings,
  ClipMarker,
  Clip,
  ClipGroup,
  ProjectState,
  ClipInfo,
  ProjectVersion,
  ProjectContent,
  ExportableContent,
};

const singletonEnforcer = Symbol('singletonEnforcer');

export default class Project {
  public static getProjectError = (
    project: ProjectMetadata,
  ): string | undefined => {
    if (!project.projectFile || !fs.existsSync(project.projectFile)) {
      return 'Missing project file';
    }
    return undefined;
  };

  public static projectExists = (project: ProjectMetadata): boolean => {
    return (
      project.projectFile !== undefined && fs.existsSync(project.projectFile)
    );
  };

  public static isTmpProject = (projectFile: string): boolean => {
    const {app} = Configs.configs;
    return projectFile.startsWith(app.tmpPath);
  };

  public static isSampleProject = (): boolean => {
    return isSampleProject(Project.instance.getProjectFile());
  };

  /**
   * Check if the settings needs to be remapped
   * @param settings - The current settings
   * @returns { boolean }
   */
  public static needsSettingsRemapping = (settings: OathSettings): boolean => {
    return needsSettingsRemapping(settings);
  };

  /**
   * Remap the settings for the Haptics SDK OATH
   * @param settings - The current settings
   * @returns { OathSettings }
   */
  public static parseSettings = (
    settings: Record<string, unknown>,
  ): OathSettings => {
    return parseSettings(settings);
  };

  public isTutorial(): boolean {
    return this.content?.isTutorial ?? false;
  }

  public isAuthoringTutorial(): boolean {
    return this.content?.isAuthoringTutorial ?? false;
  }

  public hasContent(): boolean {
    return this.content !== undefined;
  }

  public getGroups(): ClipGroup[] {
    return this.content?.groups ?? [];
  }

  public getExportableContent(): ExportableContent {
    return cloneDeep(
      omit(Project.instance.content, [
        'updatedAt',
        'isTutorial',
        'isAuthoringTutorial',
      ]) as ExportableContent,
    );
  }

  public setTutorialMetadata = (
    isTutorial: boolean,
    isAuthoringTutorial: boolean,
  ): void => {
    if (this.content === undefined) return;
    this.content.isTutorial = isTutorial;
    this.content.isAuthoringTutorial = isAuthoringTutorial;
  };

  private lastWriteAt: number | undefined;

  /**
   * The full path to the temporary project file
   */
  private tmpProjectFile!: string | undefined;

  private content: ProjectContent | undefined;

  private writeTimeout!: NodeJS.Timeout;

  private static singleton: Project;

  private static WRITE_TIMEOUT = 500;

  private currentAudioFile!: Buffer | undefined;

  private currentAudioFilePath!: string | undefined;

  /**
   * Represents an instance of the application configurations handler
   * @constructor
   * */
  constructor(enforcer: symbol) {
    if (enforcer !== singletonEnforcer) {
      throw new Error('Cannot construct singleton');
    }
    if (process.env.NODE_ENV !== 'test') {
      this.projectFileWriteHandler();
    }
  }

  /**
   * Returns the current instance
   * @return { Project } - Current Project instance
   * */
  static get instance(): Project {
    if (!Project.singleton) {
      Project.singleton = new Project(singletonEnforcer);
    }
    return Project.singleton;
  }

  /**
   * Loads content into the project.
   * @param content - The project content to load
   */
  public loadContent = (content: ProjectContent | undefined): void => {
    this.content = content;
  };

  /**
   * Create a new session id
   * @returns the session id
   */
  public createSession = (): string => {
    return uuidv4();
  };

  /**
   * Checks if an audio file path is the current audio cached
   * always returns false when ENABLE_RELOAD_AUDIO_ON_ANALYSIS is true
   * @param { filePath } string - The audio file path
   * @returns { boolean } true if the file is the current audio loaded
   */
  public isCurrentAudio = (filePath: string): boolean => {
    const {ENABLE_RELOAD_AUDIO_ON_ANALYSIS} = Constants;
    return (
      !ENABLE_RELOAD_AUDIO_ON_ANALYSIS && this.currentAudioFilePath === filePath
    );
  };

  /**
   * Returns the current audio as a Buffer
   * @returns { Buffer } the current audio cached
   */
  public getCurrentAudio = (): Buffer | undefined => {
    return this.currentAudioFile;
  };

  /**
   * Loads an audio file as current audio used for analysis
   */
  public loadCurrentAudio = (filePath: string): void => {
    if (!fs.existsSync(filePath)) {
      Logger.warn(`Cannot load audio file: ${filePath}`);
      this.clearCurrentAudio();
      return;
    }
    if (!this.isCurrentAudio(filePath)) {
      this.currentAudioFilePath = filePath;
      this.currentAudioFile = fs.readFileSync(filePath);
      Logger.debug('Loaded new audio file in cache', this.currentAudioFilePath);
    }
  };

  public clearCurrentAudio = (): void => {
    this.currentAudioFilePath = undefined;
    this.currentAudioFile = undefined;
    Logger.debug('Audio file cache cleared');
  };

  public getProjectFile = (): string => {
    return this.tmpProjectFile as string;
  };

  /**
   * Generates clip metadata
   * @param { Clip } clip - The clip object
   * @return { MetaData } - Clip metadata
   */
  public generateClipMetadata = (
    clip: Clip,
    sourcePath: string | undefined = undefined,
  ): MetaData => {
    const {audioAsset} = clip;
    // Get product name from package.json (Haptics Studio)
    const {productName} = build;
    let source = 'Custom Editor';
    if (sourcePath) {
      source = sourcePath;
    } else if (audioAsset) {
      source = audioAsset.path || '';
    }
    return {
      editor: `${productName} ${getAppVersion()}`,
      source,
      project: clip.name,
      tags: [],
      description: '',
    };
  };

  /**
   * Loads a project file in memory and prepare the tmp project file
   * @param {string} fileToLoad - Path to the project file
   */
  public load = async (fileToLoad: string): Promise<void> => {
    const {app} = Configs.configs;
    const exists = promisify(fs.exists);
    const mkdtemp = promisify(fs.mkdtemp);
    const copyFile = promisify(fs.copyFile);
    const chmod = promisify(fs.chmod);

    if (!(await exists(fileToLoad))) return;

    this.content = loadJSONFile<ProjectContent>(fileToLoad);

    if (!this.isProjectVersionCompatible()) {
      throw new Error(
        `This project was saved with Haptics Studio version ${semVerFromObject(this.content.version).version}, please update Haptics Studio and try again.`,
      );
    }

    // Sanitize the project. Skip sanitation if the project is a sample or tutorial
    let sanitizerUpdatedContent = false;
    if (!isSampleProject(fileToLoad)) {
      sanitizerUpdatedContent = await this.sanitizeProject();
    }

    // Force the project name to be consistent with the project file name
    const projectName = path.basename(fileToLoad, path.extname(fileToLoad));
    if (projectName !== Constants.DEFAULT_PROJECT_NAME) {
      this.content.metadata.name = projectName;
    }

    if (!Project.isTmpProject(fileToLoad)) {
      const tmpProjectDir = await mkdtemp(path.join(app.tmpPath, projectName));
      const tmpProjectFile = path.join(
        tmpProjectDir,
        `${projectName}${app.projectFile.extension}`,
      );
      this.tmpProjectFile = tmpProjectFile;

      Project.setAbsoluteAssetsPaths(this.content, fileToLoad);

      // Copy the project file to the tmp folder
      await copyFile(fileToLoad, this.tmpProjectFile);

      // Set the correct file permissions in case the original file has different permissions
      // This way we can save the tmp file even if the user doesn't have permission to write in the original file
      await chmod(this.tmpProjectFile, 0o644);

      // Check if there are assets that need to be copied to the tmp folder
      const assetsDir = path.join(
        path.dirname(fileToLoad),
        Constants.PROJECT.TUTORIAL_ASSETS_FOLDER,
      );
      if (await exists(assetsDir)) {
        // Copy the tutorial assets to the tmp folder
        fse.copySync(
          assetsDir,
          path.join(tmpProjectDir, Constants.PROJECT.TUTORIAL_ASSETS_FOLDER),
        );
      }

      this.setContentUpdatedAt();

      // If the sanitizer changed the project, and the project is already persisted, save it
      if (sanitizerUpdatedContent) {
        await Project.instance.save(fileToLoad);
      }
    } else {
      this.tmpProjectFile = fileToLoad;

      // We are opening a temp file (app closed with a project open). If the sanitizer changed the project, and the project is already persisted, save the original copy
      // Skip if the file is dirty, we don't want to persist unwanted changes
      if (
        !Configs.configs.currentProject.dirty &&
        Configs.configs.currentProject.projectFile &&
        sanitizerUpdatedContent
      ) {
        if (await exists(Configs.configs.currentProject.projectFile)) {
          await Project.instance.save(
            Configs.configs.currentProject.projectFile,
          );
        }
      }
    }
  };

  /**
   * Copy the tmpProjectFile content to a specific destination
   * @param {string} destination - Path to save the project content
   * @return { boolean } - Returns true on success
   */
  public save = async (destination: string): Promise<boolean> => {
    const write = promisify(fs.writeFile);
    if (!isNil(this.content)) {
      // Force the content to be written immediately to the tmp file
      this.persistToDisk();

      // Update the app version
      this.content.version = Configs.instance.getAppVersion();

      const contentToSave = cloneDeep(
        omit(this.content, ['isTutorial', 'isAuthoringTutorial']),
      );

      // Copy the tmp file to the new destination
      if (this.tmpProjectFile) {
        await write(destination, JSON.stringify({}));
        Project.setRelativeAssetsPath(
          contentToSave,
          destination,
          this.tmpProjectFile,
        );
        await write(destination, JSON.stringify(contentToSave));
        return true;
      }
    }
    return false;
  };

  /**
   * Unloads the current project from memory
   */
  public close = (): void => {
    this.tmpProjectFile = undefined;
    this.content = undefined;
    this.lastWriteAt = undefined;
  };

  /**
   * Creates a new project file with some default data
   * @param {string} name - Project name
   * @return { ProjectContent } - Returns project file content
   */
  public create = (name: string): ProjectContent => {
    const {app} = Configs.configs;
    const defaultContent: ProjectContent = {
      version: Configs.instance.getAppVersion(),
      metadata: {name},
      state: {sessionId: uuidv4(), clipId: ''},
      clips: [],
      groups: [],
    };
    this.content = defaultContent;
    const tmpProjectDir = fs.mkdtempSync(path.join(app.tmpPath, name));
    this.tmpProjectFile = path.join(
      tmpProjectDir,
      `${name}${app.projectFile.extension}`,
    );
    // Create the file
    fs.writeFileSync(this.tmpProjectFile, JSON.stringify(defaultContent));
    return this.content;
  };

  /**
   * Updates the current project name
   * @param {string} projectName - The Project name
   * @return { boolean } - Returns true on success
   */
  public updateName = (projectName: string): void => {
    if (!isNil(this.content)) {
      const {metadata} = this.content;
      metadata.name = projectName;
      this.setContentUpdatedAt();
    }
  };

  /**
   * Updates the current project metadata
   * @param {Omit<ProjectMetadata, 'name'>} metadata - the updated project metadata
   * @return { boolean } - Returns true on success
   */
  public updateMetadata = (metadata: Omit<ProjectMetadata, 'name'>): void => {
    if (!isNil(this.content)) {
      this.content.metadata = {...this.content.metadata, ...metadata};
      this.setContentUpdatedAt();
    }
  };

  /**
   * Get the current project name
   * @return { string } - Returns the project name
   */
  public getName = (): string => {
    if (!isNil(this.content)) {
      const {metadata} = this.content;
      return metadata.name;
    }
    return '';
  };

  /**
   * Get the current metadata
   * @return { ProjectMetadata } - Returns the project metadata
   */
  public getMetadata = (): ProjectMetadata => {
    if (!isNil(this.content)) {
      const {metadata} = this.content;
      return metadata;
    }
    return {name: ''};
  };

  /**
   * Updates the project state with the current clipId and sessionId
   * @param {string} clipId - The clip ID
   * @param {string} sessionId - The Session ID
   */
  public updateState = (clipId: string, sessionId: string): void => {
    if (!isNil(this.content)) {
      const {state} = this.content;
      state.clipId = clipId;
      state.sessionId = sessionId;
      this.setContentUpdatedAt();
    }
  };

  /**
   * Updates the project groups hierarchy
   * @param {ClipGroup[]} groups - The groups hierarchy
   * @return { boolean } - Returns true on success
   */
  public updateGroups = (groups: ClipGroup[]): void => {
    if (!isNil(this.content)) {
      this.content.groups = groups;
      this.setContentUpdatedAt();
    }
  };

  /**
   * Get the group for a specific clip id
   * @param {string} clipId - The clip id
   * @return { string | undefined } - Returns the group name
   */
  public getGroupByClipId = (clipId: string): string | undefined => {
    let groupName;
    if (!isNil(this.content)) {
      const {groups} = this.content;
      const group = groups.find(g => g.clips.includes(clipId));
      groupName = group && group.isFolder ? group.name : undefined;
    }
    return groupName;
  };

  /**
   * Returns the project state with the current clipId and sessionId
   * @param {string} clipId - The clip ID
   * @param {string} sessionId - The Session ID
   * @return { boolean } - Returns true on success
   */
  public getState = (): ProjectState => {
    if (!isNil(this.content)) {
      return this.content.state;
    }
    return {} as ProjectState;
  };

  /**
   * Get all project clips
   * @return { Clip[] } - Returns all project's clips
   */
  public getClips = (): Clip[] => {
    return getClipsFromContent(this.content);
  };

  /**
   * Returns the clip identified by the state object
   * @return { Clip } - Returns the current clip, undefined if not found
   */
  public getCurrentClip = (): Clip | undefined => {
    return getCurrentClipFromContent(this.content);
  };

  /**
   * Returns the clip identified by the id
   * @param {string} id - The clip id
   * @return { Clip } - Returns the clip, undefined if not found
   */
  public getClipById = (id: string): Clip | undefined => {
    return getClipByIdFromContent(this.content, id);
  };

  /**
   * Adds a clip to the project file, if the clip already exists it updates the default variation
   * @param clipInfo - The clip to add
   */
  public addOrUpdateClip = (clipInfo: ClipInfo): void => {
    if (
      addOrUpdateClipToContent(
        this.content,
        clipInfo,
        this.generateClipMetadata,
      )
    ) {
      this.setContentUpdatedAt();
    }
  };

  /**
   * Remove a clip from the project
   * @param {string} clipId - The clip id to remove
   */
  public deleteClip = (clipId: string): void => {
    if (deleteClipFromContent(this.content, clipId)) {
      this.setContentUpdatedAt();
    }
  };

  /**
   * Update the clip content
   * @param {string} clipId - The clip id to remove
   * @param {Clip} content - The clip content
   */
  public updateClip = (clipId: string, clipContent: Clip): void => {
    if (updateClipInContent(this.content, clipId, clipContent)) {
      this.setContentUpdatedAt();
    }
  };

  /**
   * Removes the audio asset path from the given clips and persists the change
   * @param {string[]} clipIds - The clip ids
   */
  public clearAudioAssetPaths = (clipIds: string[]): void => {
    const ids = new Set(clipIds);
    const clips = this.getClips().filter(
      clip => ids.has(clip.clipId) && clip.audioAsset,
    );
    if (clips.length === 0) return;
    for (const clip of clips) {
      clip.audioAsset = {...clip.audioAsset, path: undefined};
    }
    this.setContentUpdatedAt();
    this.persistToDisk();
  };

  /**
   * Duplicate a clip
   * @param {string} originalClipId - The orignial clip id
   * @param {string} clipId - The new clip id
   * @param {string} name - The new clip name
   */
  public duplicateClip = (
    originalClipId: string,
    clipId: string,
    name: string,
  ): void => {
    if (duplicateClipInContent(this.content, originalClipId, clipId, name)) {
      this.setContentUpdatedAt();
    }
  };

  /**
   * Returns the default path to save the project
   * If the current clip audio path is saved as an absolute path, the project path will be the same folder as the audio file
   * If the current clip audio path is saved as a relative path, it means that it has been already saved so the default project path will be the same as the project file
   * @return { string } - The audio file pat
   */
  public getDefaultProjectPath = (projectFile: string): string => {
    return getDefaultProjectPathUtil(projectFile, this.getCurrentClip());
  };

  /**
   * Update the assets paths of each clip to be absolute. If a path is relative, it will be composed with the project file path
   * @param content the project file content that will be updated
   * @param projectFilePath the path to the project file
   */
  public static setAbsoluteAssetsPaths = (
    content: ProjectContent,
    projectFilePath: string,
  ): void => {
    setAbsoluteAssetsPaths(content, projectFilePath);
  };

  /**
   * Sets the current clip audio and video file path, relative to the project file path
   * @param { string } projectFile - The project file
   * @param { string } previousProjectFile - The previous project file, for Save action the parameters are the same
   * but for Save As action are different
   */
  public static setRelativeAssetsPath = (
    content: Partial<ProjectContent>,
    projectFile: string,
    previousProjectFile: string,
  ): boolean => {
    return setRelativeAssetsPath(content, projectFile, previousProjectFile);
  };

  public getUpdatedAt = (): number | undefined => {
    return this.content?.updatedAt;
  };

  public getVersion = (): ProjectVersion | undefined => {
    return this.content?.version;
  };

  private persistToDisk = (force = false) => {
    const {updatedAt = undefined} = this.content || {};
    if ((!isNil(this.content) && this.needsToBeSaved(updatedAt)) || force) {
      // Cloning contents to avoid inconsistency
      if (this.tmpProjectFile) {
        // create empty project if doesn't exist
        if (!fs.existsSync(this.tmpProjectFile)) {
          fs.writeFileSync(this.tmpProjectFile, JSON.stringify({}));
        }
        const content = cloneDeep(this.content);
        saveJSONFile(this.tmpProjectFile, omit(content, ['updatedAt']));
        this.lastWriteAt = updatedAt;
        Logger.silly(
          `Content changed on ${this.tmpProjectFile}, saved to disk.`,
        );
        Logger.silly('Persisted content to disk', content);
      }
    } else {
      Logger.silly(
        `Nothing to save on tmpProjectFile ${this.tmpProjectFile || ''}`,
      );
    }
  };

  private projectFileWriteHandler = () => {
    this.writeTimeout = setTimeout(() => {
      clearTimeout(this.writeTimeout);
      this.persistToDisk();
      this.projectFileWriteHandler();
    }, Project.WRITE_TIMEOUT);
  };

  private needsToBeSaved = (updatedAt: number | undefined) => {
    return !isNil(updatedAt) && updatedAt !== this.lastWriteAt;
  };

  private isProjectVersionCompatible = (): boolean => {
    return isProjectVersionCompatible(this.content);
  };

  /**
   * Update the project file with the latest format
   * @return { boolean } - Returns true if the content was updated
   */
  private sanitizeProject = async (): Promise<boolean> => {
    return sanitizeProject(this.content);
  };

  private setContentUpdatedAt = () => {
    if (!isNil(this.content)) {
      this.content.updatedAt = now('nano');
    }
  };
}
