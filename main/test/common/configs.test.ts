/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';

import Configs, {ProjectMetadata} from '../../src/common/configs';

describe('Configs trusted recent projects', () => {
  let dir: string;
  let projectFile: string;
  let previousRecents: ProjectMetadata[];

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'configs-trust-'));
    projectFile = path.join(dir, 'project.hasp');
    fs.writeFileSync(projectFile, '{}');
    jest.spyOn(Configs.instance, 'save').mockImplementation();
    previousRecents = Configs.configs.recentProjects;
    Configs.instance.set('recentProjects', [{name: 'project', projectFile}]);
  });

  afterEach(() => {
    Configs.instance.set('recentProjects', previousRecents);
    jest.restoreAllMocks();
    fs.rmSync(dir, {recursive: true, force: true});
  });

  it('does not trust a recent project by default', () => {
    expect(Configs.instance.isTrustedRecentProject(projectFile)).toBe(false);
  });

  it('trusts a recent project until its file is modified', () => {
    Configs.instance.trustRecentProject(projectFile);
    expect(Configs.instance.isTrustedRecentProject(projectFile)).toBe(true);

    const later = new Date(Date.now() + 60000);
    fs.utimesSync(projectFile, later, later);
    expect(Configs.instance.isTrustedRecentProject(projectFile)).toBe(false);
  });

  it('does not trust a project missing from the recent list', () => {
    const otherFile = path.join(dir, 'other.hasp');
    fs.writeFileSync(otherFile, '{}');
    Configs.instance.trustRecentProject(otherFile);
    expect(Configs.instance.isTrustedRecentProject(otherFile)).toBe(false);
  });
});
