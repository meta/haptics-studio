/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/* eslint-disable no-await-in-loop */
import {isEmpty, isEqual, isNil, omit} from 'lodash';
import {promisify} from 'util';
import fs from 'fs';
import path from 'path';
import {dialog} from 'electron';
import {HapticData, VisualWaveform} from '../hapticsSdk';

import Configs from '../common/configs';
import Project, {
  AssetFile,
  Clip,
  ClipGroup,
  ClipMarker,
  OathSettings,
} from '../common/project';
import {
  classifyAudioAssets,
  ExternalAudioAsset,
} from '../common/project/assetSecurity';
import {IPCMessage} from '../listeners';
import MainApplication from '../application';
import {PathManager} from '../services';
import Logger from '../common/logger';
import {
  countUntitledProjects,
  isBuiltInTutorial,
  isSampleProject,
  isCustomTutorial,
  isUntitledProject,
  saveJSONFile,
} from '../common/utils';
import Constants from '../common/constants';
import WSServer from '../wsServer';
import {isAnalysisInProgress} from '../common/analysisState';
// @oss-disable

export interface LoadPayload {
  sessionId: string;
  clipId: string;
  audio: {path: string; name: string} | undefined;
  svg: VisualWaveform;
  haptic: HapticData;
  audioFilePath: string;
  name?: string;
}

export interface OpenPayload {
  sessionId?: string;
  clips: ClipPayload[];
  groups: ClipGroup[];
  name: string;
  lastOpenedClipId?: string;
  projectExists: boolean;
  isSample: boolean;
  isTutorial: boolean;
  isAuthoringTutorial: boolean;
  description?: string;
  category?: string;
  slug?: string;
  version?: string;
}

export interface ClipPayload {
  name: string;
  audio?: AssetFile & {exists: boolean};
  svg?: VisualWaveform;
  haptic?: HapticData;
  settings?: OathSettings;
  sessionId?: string;
  clipId?: string;
  notes?: string;
  markers: ClipMarker[];
  lastUpdate: number;
  trimAt?: number;
}

/**
 * Returns a destination path inside `dir` for `filename` that does not collide
 * with an existing file, appending a numeric suffix when needed.
 * @param dir - The destination directory
 * @param filename - The desired file name
 * @returns A non-colliding absolute file path
 */
function getUniqueDestinationPath(dir: string, filename: string): string {
  const ext = path.extname(filename);
  const base = path.basename(filename, ext);
  let candidate = path.join(dir, filename);
  let counter = 1;
  while (fs.existsSync(candidate)) {
    candidate = path.join(dir, `${base}-${counter}${ext}`);
    counter += 1;
  }
  return candidate;
}

/**
 * When a project originates from a sample, its clip audio assets still point to the
 * read-only resources/samples folder. Copy those assets next to the destination
 * project file and relink the clips so the saved project is treated as a regular
 * custom project instead of staying linked to the sample folder.
 * @param destinationFile - The destination project file path
 */
async function copySampleAssetsToProject(
  destinationFile: string,
): Promise<void> {
  const copyFile = promisify(fs.copyFile);
  const resourcesPath = PathManager.instance.getResourcesPath();
  const samplesPath = PathManager.instance.getSamplesPath();
  const destinationDir = path.dirname(destinationFile);
  const clips = Project.instance.getClips();
  // Reuse the destination for assets that are referenced by multiple clips
  const copiedAssets = new Map<string, string>();

  for (let index = 0; index < clips.length; index += 1) {
    const clip = clips[index];
    const audioPath = clip.audioAsset?.path;
    const isSampleAsset =
      !isNil(audioPath) &&
      path.isAbsolute(audioPath) &&
      (audioPath.startsWith(resourcesPath) ||
        audioPath.startsWith(samplesPath));

    if (!isSampleAsset || !fs.existsSync(audioPath)) {
      continue;
    }

    let destinationAudioPath = copiedAssets.get(audioPath);
    if (isNil(destinationAudioPath)) {
      destinationAudioPath = getUniqueDestinationPath(
        destinationDir,
        path.basename(audioPath),
      );
      await copyFile(audioPath, destinationAudioPath);
      copiedAssets.set(audioPath, destinationAudioPath);
    }

    const updatedClip: Clip = {
      ...clip,
      audioAsset: {...clip.audioAsset, path: destinationAudioPath},
    };
    if (updatedClip.haptic?.metadata) {
      updatedClip.haptic = {
        ...updatedClip.haptic,
        metadata: {
          ...updatedClip.haptic.metadata,
          source: destinationAudioPath,
        },
      };
    }
    Project.instance.updateClip(clip.clipId, updatedClip);
  }
}

/**
 * Asks the user to confirm replacing an existing project file.
 * The native save panel only warns about overwriting the exact name typed by the
 * user, so when the project extension is appended afterwards the destination can
 * be replaced without any prompt. This confirmation covers that case.
 * @param projectFile - The destination project file
 * @returns True when the user confirms the overwrite
 */
function confirmProjectFileOverwrite(projectFile: string): boolean {
  const window = MainApplication.instance.getMainWindow();
  if (!window) {
    return false;
  }
  const projectName = path.basename(projectFile, path.extname(projectFile));
  // res: 0 == 'Yes', 1 == 'No'
  const res = dialog.showMessageBoxSync(window, {
    type: 'question',
    title: '',
    message: `A project with name ${projectName} already exists in the folder ${path.dirname(projectFile)}. Do you want to replace it?`,
    buttons: ['Yes', 'No'],
    defaultId: 1,
    cancelId: 1,
  });
  return res === 0;
}

const MAX_LISTED_EXTERNAL_ASSETS = 10;

/**
 * Asks the user whether a project may use audio files located outside its folder.
 * @param assets - The external audio assets
 * @returns True when the user allows them
 */
function confirmExternalAudioAssets(assets: ExternalAudioAsset[]): boolean {
  const window = MainApplication.instance.getMainWindow();
  if (!window) {
    return false;
  }
  const paths = [...new Set(assets.map(asset => asset.path))];
  const listed = paths.slice(0, MAX_LISTED_EXTERNAL_ASSETS);
  const remaining = paths.length - listed.length;
  const fileList = [
    ...listed,
    ...(remaining > 0 ? [`…and ${remaining} more`] : []),
  ].join('\n');
  // res: 0 == 'Allow', 1 == "Don't Allow"
  const res = dialog.showMessageBoxSync(window, {
    type: 'warning',
    title: '',
    message: 'This project uses audio files from outside its folder',
    detail: `${fileList}\n\nOnly allow if you trust where this project came from. Clips of files you don't allow are kept without audio.`,
    buttons: ['Allow', "Don't Allow"],
    defaultId: 1,
    cancelId: 1,
  });
  return res === 0;
}

/**
 * Drops non-audio asset references from a freshly opened project and asks the
 * user before keeping audio references that point outside the project folder,
 * unless the project is a trusted recent project.
 * @param projectFile - The opened project file
 * @returns True when the user declined the external audio references
 */
function validateAudioAssets(projectFile: string): boolean {
  const {nonAudio, external} = classifyAudioAssets(
    Project.instance.getClips(),
    projectFile,
  );
  const rejected = [...nonAudio];
  const declined =
    external.length > 0 &&
    !Configs.instance.isTrustedRecentProject(projectFile) &&
    !confirmExternalAudioAssets(external);
  if (declined) {
    rejected.push(...external.map(asset => asset.clipId));
  }
  Project.instance.clearAudioAssetPaths(rejected);
  return declined;
}

/**
 * Save current project assets to destination
 * @param action - The action name
 * @param forceDestination - Flag to force save destination dialog
 * @returns The IPC message to send back to the UI
 */
export async function saveProject(
  action: string,
  forceDestination = false,
  notifySocket = true,
): Promise<IPCMessage> {
  try {
    let projectName = Project.instance.getName();
    let {projectFile} = Configs.instance.getCurrentProject();

    if (!Project.instance.hasContent()) {
      return {action, status: 'error', message: 'Cannot find data to save'};
    }

    const projectFileExt = Configs.configs.app.projectFile.extension;
    const projectDir = projectFile ? path.dirname(projectFile) : null;
    const defaultPath =
      projectDir && fs.existsSync(projectDir)
        ? projectDir
        : PathManager.instance.getHomePath();
    const projectFileExists = !isNil(projectFile) && fs.existsSync(projectFile);

    // Set the default project name for untitled projects
    if (isUntitledProject(projectName)) {
      const clips = Project.instance.getClips();
      projectName =
        clips.length === 1
          ? clips[0].name
          : `${Constants.DEFAULT_PROJECT_NAME}-${countUntitledProjects(defaultPath) + 1}`;
    }

    // If the save dialog is forced or the destination dir is missing, open the save dialog
    if (forceDestination || !projectFileExists) {
      const window = MainApplication.instance.getMainWindow();
      if (window) {
        // If the project does not have a saved destination, default to the user home path
        projectFile = dialog.showSaveDialogSync(window, {
          defaultPath: path.join(
            defaultPath,
            `${projectName}${projectFileExt}`,
          ),
          title: 'Save project',
          properties: ['createDirectory', 'showOverwriteConfirmation'],
          buttonLabel: 'Save',
        });

        // If save is canceled, do nothing
        if (isNil(projectFile)) {
          return {action, status: 'canceled'};
        }
      }
    }

    // Return an error if the destination folder is missing
    if (isNil(projectFile)) {
      return {
        action,
        status: 'error',
        message: 'Error selecting destination file',
      };
    }

    // Update the project name based on the project file name
    projectName = path.basename(projectFile, path.extname(projectFile));

    // Ensure that the project file has the right extension
    const normalizedProjectFile =
      path.extname(projectFile) === projectFileExt
        ? projectFile
        : path.join(
            path.dirname(projectFile),
            `${projectName}${projectFileExt}`,
          );

    // The extension is appended after the save panel is dismissed, so the native
    // overwrite confirmation never applies to the resulting file. Ask for
    // confirmation before replacing an existing project.
    if (
      normalizedProjectFile !== projectFile &&
      fs.existsSync(normalizedProjectFile) &&
      !confirmProjectFileOverwrite(normalizedProjectFile)
    ) {
      return {action, status: 'canceled'};
    }

    if (normalizedProjectFile !== projectFile) {
      Configs.instance.removeRecentProject({projectFile, name: projectName});
      projectFile = normalizedProjectFile;
    }

    Project.instance.updateName(projectName);

    const isTutorial = isBuiltInTutorial(projectFile);
    const isAuthoringTutorial = isCustomTutorial(projectFile);

    if (Project.instance.hasContent()) {
      // Skip tutorials (assets are handled via the tutorial assets folder) and the
      // samples folder itself. For any other destination, relink clips whose audio
      // still lives in the read-only resources/samples folder by copying those assets
      // next to the destination, so a saved sample is no longer treated as a sample.
      if (!isSampleProject(projectFile)) {
        await copySampleAssetsToProject(projectFile);
      }
      // Force persisting the project content on destination
      await Project.instance.save(projectFile);
      // Set the project dir as the new home
      PathManager.instance.setPath('home', path.dirname(projectFile));

      // Save into the project file if the project is a tutorial
      Project.instance.setTutorialMetadata(isTutorial, isAuthoringTutorial);
    }

    // Set the current project dir, this removes tmpDir from the current project and sets the dirty flag to false
    Configs.instance.setCurrentProject({
      projectFile,
      name: projectName,
      dirty: false,
      tmpProjectFile: Project.instance.getProjectFile(),
    });
    Configs.instance.setCurrentProjectOrigin({
      tmpProjectFile: Project.instance.getProjectFile(),
      isSample: isSampleProject(projectFile),
      isTutorial,
      isAuthoringTutorial,
    });

    // Add the project to the recent list
    Configs.instance.addRecentProject({projectFile, name: projectName});
    Configs.instance.trustRecentProject(projectFile);

    // Send Current Project to the HMD
    if (notifySocket) {
      WSServer.instance.sendCurrentProject();
    }

    // Reload menu items
    MainApplication.instance.reloadMenuItems();

    // Send the project info to the UI
    MainApplication.instance.sendToUI('project_info', {
      action,
      status: 'ok',
      payload: {name: projectName, isTutorial, isAuthoringTutorial},
    });

    return Promise.resolve({action, status: 'ok', payload: {}});
  } catch (error) {
    const err = error as Error;
    Logger.logError(err);
    return Promise.resolve({
      action,
      status: 'error',
      message: (error as Error).message,
    });
  }
}

/**
 * Refuses to switch project while clips are still being imported, otherwise the in-flight
 * import writes its remaining clips into the project the user is opening
 * @param {string} action - The action name
 * @returns {IPCMessage | undefined} - The error to send back to the UI, undefined when no import is running
 */
function rejectDuringImport(action: string): IPCMessage | undefined {
  if (!isAnalysisInProgress()) {
    return undefined;
  }
  const message = 'Please wait for the clips import to complete.';
  Logger.warn(`Action ${action} rejected: ${message}`);
  MainApplication.instance.sendToUI('error', {
    action,
    status: 'error',
    message,
  });
  return {action, status: 'error', message};
}

/**
 * If the current project file is missing or moved, asks for save forcing the selection of the destination
 * @param {string} action - The action name
 * @param {string} projectFile - The project file
 * @returns {IPCMessage} - The IPC message to send back to the UI
 */
export async function checkForCurrentProject(
  action: string,
  projectFile: string,
): Promise<IPCMessage> {
  let message: IPCMessage = {action, status: 'ok', payload: {}};
  const window = MainApplication.instance.getMainWindow();
  if (projectFile && !fs.existsSync(projectFile) && window) {
    const res: number = dialog.showMessageBoxSync(window, {
      type: 'question',
      title: '',
      message: `Current project file ${projectFile} seems to be missing or moved. Do you want to save it?`,
      buttons: ['Yes', 'No', 'Cancel'],
      cancelId: 2,
    });
    switch (res) {
      // if save is confirmed, save the current project
      case 0: {
        message = await saveProject('save', true);
        break;
      }
      default:
        break;
    }
  }
  return message;
}

/**
 * Closes the current project
 * @param {string} action - The action name
 * @returns {IPCMessage} - The IPC message to send back to the UI
 */
export async function closeProject(action: string): Promise<IPCMessage> {
  const {dirty, projectFile, name} = Configs.instance.getCurrentProject();

  // If the project has been modified, ask to save. Note: The tutorial is not supposed to be saved
  if (dirty && !Project.instance.isTutorial()) {
    const mainWindow = MainApplication.instance.getMainWindow();
    if (mainWindow) {
      // res: 0 == 'Yes', 1 == 'No', 2 == 'Cancel'
      const res: number = dialog.showMessageBoxSync(mainWindow, {
        type: 'question',
        title: '',
        message: `Unsaved project found: ${name}. Do you want to save it?`,
        buttons: ['Yes', 'No', 'Cancel'],
        cancelId: 2,
      });
      switch (res) {
        // if save on close is confirmed, save the current project
        case 0: {
          const saveResponse = await saveProject('save', false, false);
          if (saveResponse.status === 'canceled') {
            return {action, status: 'canceled', payload: {}};
          }
          MainApplication.instance.sendToUI('save', saveResponse);
          break;
        }
        case 2:
          return {action, status: 'canceled', payload: {}};
        default:
          break;
      }
    }
  } else if (projectFile) {
    await checkForCurrentProject(action, projectFile);
  }

  // Clear current project
  Configs.instance.clearCurrentProject();

  // Clear current audio
  Project.instance.clearCurrentAudio();

  // Refresh recent projects in menu item
  MainApplication.instance.reloadMenuItems();

  // Notify the socket
  WSServer.instance.sendProjectClose();

  return {action, status: 'ok', payload: {}};
}

/**
 * Load all projects assets
 * @param {string} action - The action name
 * @param {string} projectFile - The project file to open
 * @param {boolean} dirty - flag that indicates if the current project is dirty
 * @param {boolean} loadFromDisk - flag that indicates if the project needs to be loaded from disk
 * @returns {IPCMessage} - The IPC message to send back to the UI
 */
export async function loadProject(
  action: string,
  projectFile?: string,
  dirty = false,
  loadFromDisk = true,
): Promise<IPCMessage> {
  try {
    const importRejection = rejectDuringImport(action);
    if (importRejection) {
      return importRejection;
    }

    if (!projectFile) {
      return {
        action,
        status: 'error',
        message: 'Project file missing',
      };
    }
    const exists = promisify(fs.exists);

    // if I'm not opening the current project
    const currentProject = Configs.instance.getCurrentProject();
    if (
      !isEmpty(currentProject) &&
      currentProject.tmpProjectFile !== projectFile &&
      currentProject.projectFile !== projectFile
    ) {
      // close the current project
      const response = await closeProject(action);
      if (response.status === 'canceled') {
        return response;
      }
    }

    if (loadFromDisk) {
      // load the new project
      await Project.instance.load(projectFile);
    }

    if (!Project.instance.hasContent()) {
      return {
        action,
        status: 'error',
        message: `Project file not found in ${projectFile}`,
      };
    }

    let declinedAudioAssets = false;
    if (
      loadFromDisk &&
      !Project.isTmpProject(projectFile) &&
      !isSampleProject(projectFile)
    ) {
      declinedAudioAssets = validateAudioAssets(projectFile);
    }

    let isSample = isSampleProject(projectFile);
    const isTutorial = isBuiltInTutorial(projectFile);
    const isAuthoringTutorial = isCustomTutorial(projectFile);
    let isDirty = dirty;

    const clips = Project.instance.getClips();
    const groups = Project.instance.getGroups();
    const state = Project.instance.getState();
    let {sessionId} = state;
    const payloadClips: ClipPayload[] = [];

    // Save into the project file if the project is a tutorial
    Project.instance.setTutorialMetadata(isTutorial, isAuthoringTutorial);

    // If the project is a sample or the sessionId is missing,
    // create a new session for the project
    if (isEmpty(sessionId)) {
      sessionId = Project.instance.createSession();
      Logger.debug(`New session created ${sessionId}`);
      Project.instance.updateState('', sessionId);
      isDirty = true;
    }

    // iterate all clips of the project file
    for (let index = 0; index < clips.length; index += 1) {
      const clip = clips[index];
      // Load audio, haptic, SVG and settings file for last clip
      const {
        waveform,
        audioAsset,
        settings,
        clipId,
        name,
        notes,
        markers = [],
        lastUpdate = Date.now(),
      } = clip;
      const audioFileExists =
        audioAsset && audioAsset.path ? await exists(audioAsset.path) : false;

      if (
        clip.audioAsset &&
        clip.audioAsset.path &&
        clip.audioAsset.path.startsWith(PathManager.instance.getResourcesPath())
      ) {
        isSample = true;
      }

      const svg = waveform;
      const payloadClip: ClipPayload = {
        name,
        audio: audioAsset
          ? {...audioAsset, exists: audioFileExists}
          : undefined,
        svg,
        haptic: clip.haptic,
        settings: settings || {},
        trimAt: clip.trimAt,
        clipId,
        sessionId,
        notes,
        markers,
        lastUpdate,
      };

      payloadClips.push(payloadClip);
    }

    Configs.instance.setCurrentProjectOrigin({
      tmpProjectFile: Project.instance.getProjectFile(),
      isSample,
      isTutorial,
      isAuthoringTutorial,
    });

    const projectName = Project.instance.getName();
    const {description, category, slug, version} =
      Project.instance.getMetadata();

    // if project file is a tmp file, it means that it's the current project
    // so it does not need to be added to recent projects or set as current
    if (!Project.isTmpProject(projectFile) && !isSample) {
      // set current project
      Configs.instance.setCurrentProject({
        projectFile,
        name: projectName,
        dirty: isDirty,
        tmpProjectFile: Project.instance.getProjectFile(),
      });

      // Add the project to the recent list
      Configs.instance.addRecentProject({projectFile, name: projectName});
      if (loadFromDisk && !declinedAudioAssets) {
        Configs.instance.trustRecentProject(projectFile);
      }
    }

    // when opening a sample project
    // mark it as dirty so the user knows that it needs to be saved
    if (isSample) {
      // set current project as dirty project with tmpProjectFile
      Configs.instance.setCurrentProject({
        tmpProjectFile: Project.instance.getProjectFile(),
        name: projectName,
        dirty: false,
      });
      // @oss-disable
      // @oss-disable
        // @oss-disable
      // @oss-disable
    }

    // Send Current Project to the HMD
    WSServer.instance.sendCurrentProject();

    // Reload menu items
    MainApplication.instance.reloadMenuItems();

    const lastOpenedClipId = !isSample
      ? Project.instance.getCurrentClip()?.clipId
      : undefined;

    // @oss-disable
    // @oss-disable
      // @oss-disable
      // @oss-disable
        // @oss-disable
        // @oss-disable
      // @oss-disable
    // @oss-disable
    if (
      !isTutorial &&
      currentProject.projectFile &&
      fs.existsSync(currentProject.projectFile)
    ) {
      // If the project is not a tutorial, set the project dir as the new home
      PathManager.instance.setPath(
        'home',
        path.dirname(currentProject.projectFile),
      );
    }

    return {
      action,
      status: 'ok',
      payload: {
        groups,
        clips: payloadClips,
        name: projectName,
        description,
        category,
        slug,
        version,
        sessionId,
        lastOpenedClipId,
        projectExists: true,
        isSample,
        isTutorial: Project.instance.isTutorial(),
        isAuthoringTutorial: Project.instance.isAuthoringTutorial(),
      },
    };
  } catch (error) {
    const err = error as Error;
    Logger.error(err.message, err.stack);
    return {action, status: 'error', message: (error as Error).message};
  }
}

/**
 * Clones the current haptic of the current project
 * @param {string} action - The action name
 * @returns {IPCMessage} - The IPC message to send back to the UI
 */
export async function cloneProject(action: string): Promise<IPCMessage> {
  const exists = promisify(fs.exists);
  const unlink = promisify(fs.unlink);

  let message: IPCMessage = {action, status: 'ok', payload: {}};
  // Get the current project before cloning the project
  const prevProject = Configs.instance.getCurrentProject();

  try {
    let projectName = Project.instance.getName();
    let {projectFile} = Configs.instance.getCurrentProject();

    if (!Project.instance.hasContent()) {
      return {action, status: 'error', message: 'Cannot find data to save'};
    }

    const projectFileExt = Configs.configs.app.projectFile.extension;
    const projectDir = projectFile ? path.dirname(projectFile) : null;
    const defaultPath =
      projectDir && fs.existsSync(projectDir)
        ? projectDir
        : PathManager.instance.getHomePath();
    const window = MainApplication.instance.getMainWindow();

    // Set default project name for untitled projects
    if (isUntitledProject(projectName)) {
      const clips = Project.instance.getClips();
      projectName =
        clips.length === 1
          ? clips[0].name
          : `${Constants.DEFAULT_PROJECT_NAME}-${countUntitledProjects(defaultPath) + 1}`;
    }

    if (window) {
      // If the project does not have a saved destination, default to the user home path
      projectFile = dialog.showSaveDialogSync(window, {
        defaultPath: path.join(defaultPath, `${projectName}${projectFileExt}`),
        title: 'Save project',
        properties: ['createDirectory', 'showOverwriteConfirmation'],
        buttonLabel: 'Save',
      });
    }

    // Return error if the destination folder is missing
    if (isNil(projectFile)) {
      return {action, status: 'canceled'};
    }

    // Ensure that the project file has the right extension
    // and get the project name from the file name
    const selectedProjectFile = projectFile;
    projectFile = projectFile.endsWith(projectFileExt)
      ? projectFile
      : `${projectFile}${projectFileExt}`;
    projectName = path.basename(projectFile, path.extname(projectFile));

    // The extension is appended after the save panel is dismissed, so the native
    // overwrite confirmation never applies to the resulting file. Ask for
    // confirmation before replacing an existing project.
    if (
      projectFile !== selectedProjectFile &&
      fs.existsSync(projectFile) &&
      !confirmProjectFileOverwrite(projectFile)
    ) {
      return {action, status: 'canceled'};
    }

    const clonedContent = Project.instance.getExportableContent();
    clonedContent.metadata = {...clonedContent.metadata, name: projectName};
    clonedContent.state = {
      ...clonedContent.state,
      sessionId: Project.instance.createSession(),
    };

    // Save the clone project
    saveJSONFile(projectFile, {});
    // Update cloned content with the relative assets paths
    Project.setRelativeAssetsPath(
      clonedContent,
      projectFile,
      Project.instance.getProjectFile(),
    );
    // Save the clone project
    saveJSONFile(projectFile, omit(clonedContent, ['updatedAt']));
    Configs.instance.addRecentProject({projectFile, name: projectName});
    Configs.instance.trustRecentProject(projectFile);

    // Set the project dir as new home
    PathManager.instance.setPath('home', path.dirname(projectFile));

    // Clear the current project and load the cloned one
    Configs.instance.clearCurrentProject();
    message = await loadProject('open', projectFile, false);
  } catch (error) {
    const err = error as Error;
    Logger.error(err.message, err.stack);
    message = {action, status: 'error', message: (error as Error).message};
    // If there is an error cloning the project, rollback to the previous project
    const currentProject = Configs.instance.getCurrentProject();
    /**
     * If the current project has changed, it means that the cloned project is now the current,
     * and we need to restore the project that was the current before the clone action
     */
    if (!isEqual(prevProject, Configs.instance.getCurrentProject())) {
      // Clear the project file created for the cloned haptic
      if (
        currentProject.projectFile &&
        (await exists(currentProject.projectFile))
      ) {
        await unlink(currentProject.projectFile);
        // Remove the cloned project from recent projects
        Configs.instance.removeRecentProject({
          projectFile: currentProject.projectFile,
          name: currentProject.name,
        });
      }
      // Restore the previous project as current
      Configs.instance.setCurrentProject(prevProject);

      // Send Current Project to the HMD
      WSServer.instance.sendCurrentProject();

      // Reload menu items
      MainApplication.instance.reloadMenuItems();
    }
  }
  return message;
}

export function setCurrentClip(clipId: string): void {
  const {sessionId} = Project.instance.getState();
  if (!Project.instance.hasContent()) {
    Project.instance.create(Constants.DEFAULT_PROJECT_NAME);
    // @oss-disable
    // @oss-disable
      // @oss-disable
    // @oss-disable
  }
  const clip = Project.instance.getClipById(clipId);
  if (clip && !isEmpty(clipId) && !isEmpty(sessionId)) {
    Project.instance.updateState(clipId, sessionId);
    if (clip.audioAsset && clip.audioAsset.path) {
      // Load the current audio clip in cache
      Project.instance.loadCurrentAudio(clip.audioAsset.path);
    }
  }
}

/**
 * Creates a new empty project
 * - Closes the current project first
 * - Creates a new empty project and sets it as current
 * - Opens the new project
 * @param action the 'new' action
 */
export async function newProject(action: string): Promise<IPCMessage> {
  const importRejection = rejectDuringImport(action);
  if (importRejection) {
    return importRejection;
  }

  // Close the current project
  const closeMessage = await closeProject(action);
  if (closeMessage.status !== 'ok') {
    return closeMessage;
  }

  // Create a new project file if there is no current project loaded
  if (!Project.instance.hasContent()) {
    Project.instance.create(Constants.DEFAULT_PROJECT_NAME);
    // @oss-disable
    // @oss-disable
      // @oss-disable
    // @oss-disable

    Configs.instance.setCurrentProject({
      tmpProjectFile: Project.instance.getProjectFile(),
      name: Project.instance.getName(),
      dirty: false,
    });
  }

  return loadProject('open', Project.instance.getProjectFile(), false);
}
