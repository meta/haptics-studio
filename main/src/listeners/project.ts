/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import {dialog} from 'electron';
import fs from 'fs';
import path from 'path';
import {isEmpty, isEqual, cloneDeep} from 'lodash';
import {IpcInvokeChannel, IpcSendChannel} from '../../../shared';
import {createIPCHandler, createIPCListener} from './ipcHandlerUtils';

import {
  closeProject,
  loadProject,
  saveProject,
  newProject as newProjectAction,
} from '../actions/project';
import MainApplication from '../application';
import Configs, {CurrentProject, ProjectMetadata} from '../common/configs';
import Project, {ClipGroup} from '../common/project';
import {getProjectToOpen} from '../common/utils';
import {IPCMessage} from './index';
import WSServer from '../wsServer';
// @oss-disable

/**
 * Loads projects files and sends them back to the UI
 */
function openProject(): void {
  createIPCHandler<ProjectMetadata>(IpcInvokeChannel.Open, async args => {
    const message: IPCMessage = await loadProject('open', args.projectFile);
    return {customResponse: message};
  });
}

/**
 * Loads the current project from JSON settings and sends them back to the UI
 * Sent once when the application starts
 * If empty sends an empty payload
 * If the project has not been saved, loads the tmpDir. Otherwise it loads the project dir
 */
function loadCurrentProject(): void {
  createIPCHandler<void>(IpcInvokeChannel.LoadCurrentProject, async () => {
    const {selectedProjectFile = ''} = MainApplication.instance;

    if (selectedProjectFile || Configs.instance.hasCurrentProject()) {
      // If a project is opened from file, use it first
      // If the project opened from file is the same as the current project, open the current project instead of the file version
      // If the project has not been saved (dirty == true) load tmpProjectFile
      const {projectToOpen, isDirty} = getProjectToOpen(selectedProjectFile);
      if (projectToOpen !== selectedProjectFile) {
        // clear the selected project from finder
        MainApplication.instance.selectedProjectFile = undefined;
      }

      if (projectToOpen && fs.existsSync(projectToOpen)) {
        // If selectedProjectFile is present the project is not dirty
        let message: IPCMessage = await loadProject(
          'load_current_project',
          projectToOpen,
          isDirty,
        );

        // Clear the selected project from finder
        MainApplication.instance.selectedProjectFile = undefined;

        // When we are opening a project from finder and saving the dirty current project is canceled, reopen the dirty project
        if (selectedProjectFile && message.status === 'canceled') {
          const {dirty} = Configs.instance.getCurrentProject();
          const currentProjectFile = Configs.instance.getCurrentProjectFile();
          message = await loadProject(
            'load_current_project',
            currentProjectFile,
            dirty,
          );
        }
        return {customResponse: message};
      }
      // If the current project is not found, clear the application state
      Configs.instance.clearCurrentProject();

      MainApplication.instance.reloadMenuItems();
    }
    return {};
  });
}

/**
 * Closes the current project
 */
function closeCurrentProject(): void {
  createIPCHandler<void>(IpcInvokeChannel.CloseCurrentProject, async () => {
    const response = await closeProject('close_current_project');
    if (response.status !== 'canceled') {
      MainApplication.instance.sendToUI('close', {});
    }
  });
}

/**
 * Update media groups hierarchy
 */
function updateGroups(): void {
  createIPCHandler<ClipGroup[]>(IpcInvokeChannel.UpdateGroups, args => {
    const groups = Project.instance.getGroups();
    if (!isEqual(groups, args)) {
      Project.instance.updateGroups(args);
      if (Configs.instance.hasCurrentProject()) {
        Configs.instance.setCurrentProject({
          ...Configs.instance.getCurrentProject(),
          dirty: true,
        });
        WSServer.instance.sendCurrentProject();
      }
      MainApplication.instance.reloadMenuItems();
    }
  });
}

/**
 * Feedback on load project
 */
function loadProjectSuccess(): void {
  createIPCListener<{projectExists: boolean}>(
    IpcSendChannel.LoadProjectSuccess,
    args => {
      if (args.projectExists === false) {
        const clips = Project.instance.getClips();
        for (const clip of clips) {
          MainApplication.instance.sendToUI('current_analysis', {
            action: 'current_analysis',
            status: 'ok',
            payload: {clipId: clip.clipId},
          });
        }
      }
    },
  );
}

/**
 * Renames the current project
 * Rename the project files name to be consistent with the project name
 * Also updates the recent projects structure
 */
function renameProject(): void {
  createIPCHandler<{name: string}>(
    IpcInvokeChannel.RenameProject,
    async args => {
      const {name} = args;
      const projectFileExt = Configs.configs.app.projectFile.extension;
      const currentProject = Configs.instance.getCurrentProject();
      const currentProjectFileExists =
        currentProject.projectFile && fs.existsSync(currentProject.projectFile);
      const newProjectFile = currentProject.projectFile
        ? path.join(
            path.dirname(currentProject.projectFile),
            `${name}${projectFileExt}`,
          )
        : undefined;
      const newProjectFileExists =
        newProjectFile && fs.existsSync(newProjectFile);
      const originalProjectName = Project.instance.getName();

      Project.instance.updateName(name);

      // if the current project has not yet been saved
      // trigger the save action to save the current project
      if (!currentProjectFileExists) {
        const message = await saveProject('save', true);
        if (message.status === 'canceled') {
          // restore original project name
          Project.instance.updateName(originalProjectName);
          return {customResponse: message};
        }
      } else {
        // Check if already exists a project with the same name in the destination folder
        if (newProjectFileExists) {
          // res: 0 == 'Yes', 1 == 'No', 2 == 'Cancel'
          let res = 2;
          const mainWindow = MainApplication.instance.getMainWindow();
          if (mainWindow) {
            res = dialog.showMessageBoxSync(mainWindow, {
              type: 'question',
              title: '',
              message: `A project with name ${name} already exists in the folder ${path.dirname(currentProject.projectFile || '')}. Do you want to replace it?`,
              buttons: ['Yes', 'No', 'Cancel'],
              cancelId: 2,
            });
          }
          if (res !== 0) {
            // restore original project name
            Project.instance.updateName(originalProjectName);
            return {status: 'canceled'};
          }
        }

        const renamedProject: CurrentProject = cloneDeep(currentProject);
        renamedProject.name = name;

        // Rename the tmp project file
        if (
          currentProject.tmpProjectFile &&
          fs.existsSync(currentProject.tmpProjectFile)
        ) {
          const tmpProjectFile = path.join(
            path.dirname(currentProject.tmpProjectFile),
            `${name}${projectFileExt}`,
          );
          fs.renameSync(currentProject.tmpProjectFile, tmpProjectFile);
          renamedProject.tmpProjectFile = tmpProjectFile;
        }

        // Rename the project file
        const wasTrusted =
          !isEmpty(currentProject.projectFile) &&
          Configs.instance.isTrustedRecentProject(
            currentProject.projectFile as string,
          );
        if (
          currentProject.projectFile &&
          currentProjectFileExists &&
          newProjectFile
        ) {
          fs.renameSync(currentProject.projectFile, newProjectFile);
          // update the project file time
          const time = new Date();
          fs.utimesSync(newProjectFile, time, time);
          renamedProject.projectFile = newProjectFile;
        }
        // set the new project info
        Configs.instance.setCurrentProject({
          ...currentProject,
          ...renamedProject,
        });

        // update the recent projects structure
        const projectToBeReplaced = {
          projectFile: currentProject.projectFile || '',
          name: currentProject.name,
        };
        const projectToReplace = {
          projectFile: renamedProject.projectFile || '',
          name: renamedProject.name,
        };
        Configs.instance.replaceRecentProject(
          projectToBeReplaced,
          projectToReplace,
        );
        if (wasTrusted && renamedProject.projectFile) {
          Configs.instance.trustRecentProject(renamedProject.projectFile);
        }

        // Reload the menu items
        MainApplication.instance.reloadMenuItems();

        // Send Current Project to the HMD
        WSServer.instance.sendCurrentProject();
      }
      return {};
    },
  );
}

/**
 * Update the project metadata
 */
function updateMetadata(): void {
  createIPCHandler<Omit<ProjectMetadata, 'name'>>(
    IpcInvokeChannel.UpdateMetadata,
    args => {
      if (Project.instance.hasContent()) {
        Project.instance.updateMetadata(args);
      }
    },
    {markDirty: true, reloadMenu: true},
  );
}

/**
 * Creates a new empty project
 */
function newProject(): void {
  createIPCHandler<void>(IpcInvokeChannel.NewProject, async (_args, event) => {
    const message: IPCMessage = await newProjectAction('new_project');
    if (message.status !== 'canceled') {
      // @oss-disable
      // @oss-disable
        // @oss-disable
      // @oss-disable
      event.sender.send('open', message);
    }
  });
}

/**
 * Bind IPC messages
 */
export default function (): void {
  openProject();
  loadCurrentProject();
  closeCurrentProject();
  updateGroups();
  loadProjectSuccess();
  renameProject();
  updateMetadata();
  newProject();
}
