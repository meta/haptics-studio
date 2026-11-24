/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/* eslint-disable react/no-danger */

import React, {useContext, useState, useRef, useEffect} from 'react';
import {useDispatch} from 'react-redux';

import {createAppStyle} from '../../styles/theme.style';
import {ZIndex} from '../../styles/zIndex';
import {sanitizeHtml} from '../../utils/sanitizeHtml';
import {AppContext} from '../../containers/App';

import CloseButton from './CloseButton';
import AndroidExport from './AndroidExport';
import {ExportFormat} from 'main/src/listeners/clips';
import Checkbox from './Checkbox';

const useStyles = createAppStyle(theme => ({
  container: {
    padding: theme.spacing.sm,
    position: 'relative',
    width: '100%',
  },
  header: {
    position: 'relative',
    height: '40px',
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: `0 ${theme.spacing.xs}`,
  },
  title: {
    color: theme.colors.text.primary,
    ...theme.typography.body,
    margin: 0,
    fontWeight: 600,
  },
  body: {
    backgroundColor: theme.colors.background.exportPopover,
    padding: theme.spacing.sm,
    display: 'flex',
    flexDirection: 'column',
    borderRadius: theme.sizes.borderRadius.dialog,
  },
  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing.xs,
  },
  sectionText: {
    ...theme.typography.small,
    fontWeight: 300,
    padding: `0 ${theme.spacing.xs}`,
  },
  sectionTitle: {
    color: theme.colors.text.primary,
    ...theme.typography.body,
    fontWeight: 600,
    marginTop: theme.spacing.xs,
    padding: `${theme.spacing.sm} ${theme.spacing.xs} 0 ${theme.spacing.xs}`,
    borderTop: `1px solid ${theme.colors.background.tag}`,
  },
  checkboxContainer: {
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing.sm,
  },
  checkboxRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '6px',
    borderRadius: theme.sizes.borderRadius.card,
    cursor: 'default',
    '&:hover': {
      backgroundColor: theme.colors.background.tag,
    },
  },
  detailButton: {
    width: '16px',
    height: '16px',
    borderRadius: '50%',
    backgroundColor: theme.colors.text.pressed,
    border: 'none',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    '&:hover': {
      opacity: 0.8,
    },
  },
  infoPanel: {
    position: 'absolute',
    right: `calc(100% + ${theme.spacing.sm})`,
    top: '50%',
    transform: 'translateY(-50%)',
    width: '240px',
    backgroundColor: theme.colors.background.exportPopover,
    borderRadius: theme.sizes.borderRadius.dialog,
    padding: theme.spacing.lg,
    zIndex: ZIndex.Toolbar,
  },
  infoPanelTitle: {
    marginBottom: theme.spacing.sm,
    ...theme.typography.body,
    fontWeight: 600,
  },
  infoPanelContent: {
    color: theme.colors.text.primary,
    fontSize: '13px',
    lineHeight: '1.5',
    '& a': {
      color: theme.colors.text.primary,
      textDecoration: 'underline',
    },
  },
  successContainer: {
    fontSize: '13px',
    fontWeight: 'normal',
    padding: '4px',
    display: 'flex',
    justifyContent: 'center',
    flexDirection: 'column',
    gap: theme.spacing.lg,
    '& div': {
      color: theme.colors.button.primary.main,
    },
  },
}));

/**
 * Dialog with the export options
 */
export default function ExportDialog(): JSX.Element {
  const classes = useStyles();
  const dispatch = useDispatch();
  const {actions, selectors, lang} = useContext(AppContext);

  const exportDialog = selectors.app.getExportDialog();
  const selectedClips = selectors.project.getSelectedClips();

  type Option = {
    value: ExportFormat;
    label: string;
  };
  const options: Option[] = [
    {value: 'haptic', label: '.haptic'},
    {value: 'ahap', label: '.ahap'},
    {value: 'wav', label: 'waveform'},
    {value: 'android', label: 'Android'},
    ...(localStorage.getItem('flags:pwle') === 'true'
      ? [{value: 'android-pwle' as const, label: 'Android PWLE'}]
      : []),
  ];

  const [showInfoPanel, setShowInfoPanel] = useState<string | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const infoPanelRef = useRef<HTMLDivElement | null>(null);

  // Info panel timer management
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  const handleDetailButtonHover = (formatValue: string) => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setShowInfoPanel(formatValue);
  };

  const handleDetailButtonLeave = () => {
    timerRef.current = setTimeout(() => {
      setShowInfoPanel(null);
    }, 2000);
  };

  const handleInfoPanelEnter = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const handleInfoPanelLeave = () => {
    setShowInfoPanel(null);
  };

  const onDismiss = () => {
    dispatch(actions.app.dismissExportDialog());
  };

  const toggleFormat = (formatValue: ExportFormat) => {
    if (exportDialog.formats.includes(formatValue)) {
      dispatch(
        actions.app.updateExportDialog({
          formats: exportDialog.formats.filter(f => f !== formatValue),
        }),
      );
    } else {
      dispatch(
        actions.app.updateExportDialog({
          formats: [...exportDialog.formats, formatValue],
        }),
      );
    }
  };

  const updatePackageProject = (packageProject: boolean) => {
    dispatch(
      actions.app.updateExportDialog({
        packageProject,
      }),
    );
  };

  const updateFlatten = (flatten: boolean) => {
    dispatch(
      actions.app.updateExportDialog({
        flatten,
      }),
    );
  };

  const getFormatTitle = (formatValue: string): string => {
    switch (formatValue) {
      case 'haptic':
        return lang('export.format-title-haptic');
      case 'ahap':
        return lang('export.format-title-ahap');
      case 'wav':
        return lang('export.format-title-wav');
      case 'android':
        return lang('export.format-title-android');
      case 'android-pwle':
        return lang('export.format-title-android-pwle');
      default:
        return '';
    }
  };

  const getFormatInfo = (formatValue: string): string => {
    switch (formatValue) {
      case 'haptic':
        return lang('export.format-hint-haptic');
      case 'ahap':
        return lang('export.format-hint-ahap');
      case 'wav':
        return lang('export.format-hint-wav');
      case 'android':
        return lang('export.format-hint-android');
      case 'android-pwle':
        return lang('export.format-hint-android-pwle');
      default:
        return '';
    }
  };

  return (
    <div className={classes.container}>
      <div className={classes.body}>
        <div className={classes.header}>
          <h5 className={classes.title}>{lang('export.title')}</h5>
          <CloseButton onClick={() => onDismiss()} aria-label="Close Export" />
        </div>

        {exportDialog.status === 'success' ? (
          <div className={classes.successContainer}>
            <div>{lang('export.success')}</div>
            <button
              type="button"
              className="hsbutton secondary"
              onClick={() => dispatch(actions.app.openExportFolder())}>
              <img
                src={require('../../images/folder.svg')}
                style={{width: '16px', height: '16px'}}
              />
              {lang('export.view-file', {
                smart_count: exportDialog.packageProject
                  ? 1
                  : selectedClips.length * exportDialog.formats.length,
              })}
            </button>
          </div>
        ) : (
          <>
            <div>
              {/* Export Formats Section */}
              <div className={classes.section}>
                <div className={classes.sectionText}>
                  {lang('export.format-selection')}
                </div>
                <div className={classes.checkboxContainer}>
                  {options.map(option => (
                    <div
                      key={option.value}
                      className={classes.checkboxRow}
                      onClick={() => toggleFormat(option.value)}>
                      <Checkbox
                        checked={exportDialog.formats.includes(option.value)}
                        onChange={() => toggleFormat(option.value)}>
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            width: '100%',
                          }}>
                          {option.label}
                          <button
                            type="button"
                            className={classes.detailButton}
                            onMouseEnter={() =>
                              handleDetailButtonHover(option.value)
                            }
                            onMouseLeave={handleDetailButtonLeave}
                            onClick={e => e.stopPropagation()}>
                            i
                          </button>
                        </div>
                      </Checkbox>
                    </div>
                  ))}
                </div>
              </div>

              {/* Package Section */}
              <div className={classes.section}>
                <div className={classes.sectionTitle}>
                  {lang('export.options-package')}
                </div>
                <div className={classes.sectionText}>
                  {lang('export.package-hint')}
                </div>
                <div className={classes.checkboxContainer}>
                  <div
                    className={classes.checkboxRow}
                    onClick={() =>
                      updatePackageProject(!exportDialog.packageProject)
                    }>
                    <Checkbox
                      checked={exportDialog.packageProject}
                      position="right"
                      onChange={() =>
                        updatePackageProject(!exportDialog.packageProject)
                      }>
                      {lang('export.options-package-project')}
                    </Checkbox>
                  </div>
                </div>
              </div>

              {/* More Options Section */}
              <div className={classes.section}>
                <div className={classes.sectionTitle}>
                  {lang('export.options-more')}
                </div>
                <div className={classes.checkboxContainer}>
                  <div
                    className={classes.checkboxRow}
                    onClick={() => updateFlatten(!exportDialog.flatten)}>
                    <Checkbox
                      checked={exportDialog.flatten}
                      position="right"
                      onChange={() => updateFlatten(!exportDialog.flatten)}>
                      {lang('export.options-flat')}
                    </Checkbox>
                  </div>
                </div>
              </div>
            </div>
          </>
        )}

        {/* Info Panel */}
        {showInfoPanel && (
          <div
            ref={infoPanelRef}
            className={classes.infoPanel}
            onMouseEnter={handleInfoPanelEnter}
            onMouseLeave={handleInfoPanelLeave}>
            <div className={classes.infoPanelTitle}>
              {getFormatTitle(showInfoPanel)}
            </div>
            <div
              className={classes.infoPanelContent}
              dangerouslySetInnerHTML={{
                __html: sanitizeHtml(getFormatInfo(showInfoPanel)),
              }}
            />
            {showInfoPanel === 'android' ? <AndroidExport /> : null}
          </div>
        )}
      </div>
    </div>
  );
}
