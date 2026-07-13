// Copyright (c) 2015-present Aura, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React, { useCallback, useState, useEffect, useMemo } from 'react';
import { useIntl } from 'react-intl';
import { useDispatch, useSelector } from 'react-redux';

import type { Channel, ChannelType } from '@mattermost/types/channels';
import type { ServerError } from '@mattermost/types/errors';

import { getChannel, patchChannel, updateChannelPrivacy } from 'mattermost-redux/actions/channels';
import { Client4 } from 'mattermost-redux/client';
import { General } from 'mattermost-redux/constants';
import Permissions from 'mattermost-redux/constants/permissions';
import { haveIChannelPermission } from 'mattermost-redux/selectors/entities/roles';

import {
	setShowPreviewOnChannelSettingsHeaderModal,
	setShowPreviewOnChannelSettingsPurposeModal,
} from 'actions/views/textbox';
import {
	showPreviewOnChannelSettingsHeaderModal,
	showPreviewOnChannelSettingsPurposeModal,
} from 'selectors/views/textbox';

import ConvertConfirmModal from 'components/admin_console/team_channel_settings/convert_confirm_modal';
import ChannelNameFormField from 'components/channel_name_form_field/channel_name_form_field';
import type { TextboxElement } from 'components/textbox';
import AdvancedTextbox from 'components/widgets/advanced_textbox/advanced_textbox';
import SaveChangesPanel, { type SaveChangesPanelState } from 'components/widgets/modals/components/save_changes_panel';
import PublicPrivateSelector from 'components/widgets/public-private-selector/public-private-selector';

import Constants from 'utils/constants';

import type { GlobalState } from 'types/store';

type ChannelSettingsInfoTabProps = {
	channel: Channel;
	onCancel?: () => void;
	setAreThereUnsavedChanges?: (unsaved: boolean) => void;
	showTabSwitchError?: boolean;
};

function ChannelSettingsInfoTab({
	channel,
	onCancel,
	setAreThereUnsavedChanges,
	showTabSwitchError,
}: ChannelSettingsInfoTabProps) {
	const { formatMessage } = useIntl();
	const dispatch = useDispatch();
	const shouldShowPreviewPurpose = useSelector(showPreviewOnChannelSettingsPurposeModal);
	const shouldShowPreviewHeader = useSelector(showPreviewOnChannelSettingsHeaderModal);

	// Permissions for transforming channel type
	const canConvertToPrivate = useSelector((state: GlobalState) =>
		haveIChannelPermission(state, channel.team_id, channel.id, Permissions.CONVERT_PUBLIC_CHANNEL_TO_PRIVATE),
	);
	const canConvertToPublic = useSelector((state: GlobalState) =>
		haveIChannelPermission(state, channel.team_id, channel.id, Permissions.CONVERT_PRIVATE_CHANNEL_TO_PUBLIC),
	);

	// Permissions for managing channel (name, header, purpose)
	const channelPropertiesPermission = channel.type === Constants.PRIVATE_CHANNEL ? Permissions.MANAGE_PRIVATE_CHANNEL_PROPERTIES : Permissions.MANAGE_PUBLIC_CHANNEL_PROPERTIES;
	const canManageChannelProperties = useSelector((state: GlobalState) =>
		haveIChannelPermission(state, channel.team_id, channel.id, channelPropertiesPermission),
	);

	// Constants
	const HEADER_MAX_LENGTH = 1024;

	// Internal state variables
	const [internalUrlError, setUrlError] = useState('');
	const [channelNameError, setChannelNameError] = useState('');
	const [characterLimitExceeded, setCharacterLimitExceeded] = useState(false);
	const [showConvertConfirmModal, setShowConvertConfirmModal] = useState(false);

	// Removed switchingTabsWithUnsaved state as we now use the showTabSwitchError prop directly

	// The fields we allow editing
	const [displayName, setDisplayName] = useState(channel?.display_name ?? '');
	const [channelUrl, setChannelURL] = useState(channel?.name ?? '');
	const [channelPurpose, setChannelPurpose] = useState(channel.purpose ?? '');
	const [channelHeader, setChannelHeader] = useState(channel?.header ?? '');
	const [channelType, setChannelType] = useState<ChannelType>(channel?.type as ChannelType ?? Constants.OPEN_CHANNEL as ChannelType);

	// UI Feedback: errors, states
	const [formError, setFormError] = useState('');

	// Picture/Icon state variables
	const [pictureFile, setPictureFile] = useState<File | null>(null);
	const [pictureUrl, setPictureUrl] = useState<string | null>(null);
	const [removePicture, setRemovePicture] = useState(false);
	const fileInputRef = React.useRef<HTMLInputElement>(null);

	const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
		if (e.target.files && e.target.files.length > 0) {
			const file = e.target.files[0];
			setPictureFile(file);
			setRemovePicture(false);
			const previewUrl = URL.createObjectURL(file);
			setPictureUrl(previewUrl);
			setFormError('');
		}
	}, []);

	const handleUploadClick = useCallback(() => {
		fileInputRef.current?.click();
	}, []);

	const handleRemoveClick = useCallback(() => {
		setPictureFile(null);
		setPictureUrl(null);
		setRemovePicture(true);
		setFormError('');
		if (fileInputRef.current) {
			fileInputRef.current.value = '';
		}
	}, []);

	useEffect(() => {
		return () => {
			if (pictureUrl && pictureUrl.startsWith('blob:')) {
				URL.revokeObjectURL(pictureUrl);
			}
		};
	}, [pictureUrl]);

	const currentIconUrl = useMemo(() => {
		if (pictureUrl) {
			return pictureUrl;
		}
		if (!removePicture && channel.last_picture_update && channel.last_picture_update > 0) {
			return Client4.getChannelIconUrl(channel.id, channel.last_picture_update);
		}
		return null;
	}, [pictureUrl, removePicture, channel.id, channel.last_picture_update]);

	const defaultAvatar = useMemo(() => {
		const firstLetter = (displayName || channel?.display_name || '?').charAt(0).toUpperCase();
		return (
			<div className='ChannelSettingsModal__defaultIcon'>
				{firstLetter}
			</div>
		);
	}, [displayName, channel?.display_name]);

	// SaveChangesPanel state
	const [saveChangesPanelState, setSaveChangesPanelState] = useState<SaveChangesPanelState>();

	// Handler for channel name validation errors
	const handleChannelNameError = useCallback((isError: boolean, errorMessage?: string) => {
		setChannelNameError(errorMessage || '');

		// If there's an error, update the error to show in the SaveChangesPanel
		if (isError && errorMessage) {
			setFormError(errorMessage);
		} else if (formError === channelNameError) {
			// Only clear error if it's the same as the channel name error
			setFormError('');
		}
	}, [channelNameError, formError, setFormError]);

	// Update parent component when changes occur
	useEffect(() => {
		// Calculate unsaved changes directly
		const unsavedChanges = channel ? (
			displayName.trim() !== channel.display_name ||
			channelUrl.trim() !== channel.name ||
			channelPurpose.trim() !== channel.purpose ||
			channelHeader.trim() !== channel.header ||
			channelType !== channel.type ||
			pictureFile !== null ||
			removePicture
		) : false;

		setAreThereUnsavedChanges?.(unsavedChanges);
	}, [channel, displayName, channelUrl, channelPurpose, channelHeader, channelType, pictureFile, removePicture, setAreThereUnsavedChanges]);

	const handleURLChange = useCallback((newURL: string) => {
		if (internalUrlError) {
			setFormError('');
			setSaveChangesPanelState(undefined);
			setUrlError('');
		}
		setChannelURL(newURL.trim());
	}, [internalUrlError]);

	const togglePurposePreview = useCallback(() => {
		dispatch(setShowPreviewOnChannelSettingsPurposeModal(!shouldShowPreviewPurpose));
	}, [dispatch, shouldShowPreviewPurpose]);

	const toggleHeaderPreview = useCallback(() => {
		dispatch(setShowPreviewOnChannelSettingsHeaderModal(!shouldShowPreviewHeader));
	}, [dispatch, shouldShowPreviewHeader]);

	const handleChannelTypeChange = (type: ChannelType) => {
		// Never allow conversion from private to public, regardless of permissions
		if (channel.type === Constants.PRIVATE_CHANNEL && type === Constants.OPEN_CHANNEL) {
			return;
		}

		// Check if user has permission to convert from public to private
		if (channel.type === Constants.OPEN_CHANNEL && type === Constants.PRIVATE_CHANNEL && !canConvertToPrivate) {
			return;
		}

		setChannelType(type);
		setFormError('');
	};

	const handleHeaderChange = useCallback((e: React.ChangeEvent<TextboxElement>) => {
		const newValue = e.target.value;

		// Update the header value
		setChannelHeader(newValue);

		// Check for character limit
		if (newValue.trim().length > HEADER_MAX_LENGTH) {
			setFormError(formatMessage({
				id: 'edit_channel_header_modal.error',
				defaultMessage: 'The text entered exceeds the character limit. The channel header is limited to {maxLength} characters.',
			}, {
				maxLength: HEADER_MAX_LENGTH,
			}));
		} else if (formError && !channelNameError) {
			// Only clear form error if there's no channel name error
			// This prevents clearing channel name errors when editing the header
			setFormError('');
		}
	}, [HEADER_MAX_LENGTH, formError, channelNameError, setFormError, formatMessage]);

	const handlePurposeChange = useCallback((e: React.ChangeEvent<TextboxElement>) => {
		const newValue = e.target.value;

		// Update the purpose value
		setChannelPurpose(newValue);

		// Check for character limit
		if (newValue.trim().length > Constants.MAX_CHANNELPURPOSE_LENGTH) {
			setFormError(formatMessage({
				id: 'channel_settings.error_purpose_length',
				defaultMessage: 'The text entered exceeds the character limit. The channel purpose is limited to {maxLength} characters.',
			}, {
				maxLength: Constants.MAX_CHANNELPURPOSE_LENGTH,
			}));
		} else if (formError && !channelNameError) {
			// Only clear server error if there's no channel name error
			// This prevents clearing channel name errors when editing the purpose
			setFormError('');
		}
	}, [formError, channelNameError, setFormError, formatMessage]);

	const handleServerError = (err: ServerError) => {
		const errorMsg = err.message || formatMessage({ id: 'channel_settings.unknown_error', defaultMessage: 'Something went wrong.' });
		setFormError(errorMsg);
		setSaveChangesPanelState('error');

		// Check if the error is related to a URL conflict
		if (err.message && (
			err.message.toLowerCase().includes('url') ||
			err.message.toLowerCase().includes('name') ||
			err.message.toLowerCase().includes('already exists')
		)) {
			setUrlError(errorMsg); // Set the URL error to show in the URL input
		}
	};

	// Validate & Save - using useCallback to ensure it has the latest state values
	const handleSave = useCallback(async (): Promise<boolean> => {
		if (!channel) {
			return false;
		}

		if (!displayName.trim()) {
			setFormError(formatMessage({
				id: 'channel_settings.error_display_name_required',
				defaultMessage: 'Channel name is required',
			}));
			return false;
		}

		// write the code to validate if the channel is changing from public to private
		if (channel.type === Constants.OPEN_CHANNEL && channelType === Constants.PRIVATE_CHANNEL) {
			const { error } = await dispatch(updateChannelPrivacy(channel.id, General.PRIVATE_CHANNEL));
			if (error) {
				handleServerError(error as ServerError);
				return false;
			}
		}

		// Handle icon upload/delete
		let iconChanged = false;
		if (pictureFile) {
			try {
				await Client4.uploadChannelIcon(channel.id, pictureFile);
				iconChanged = true;
			} catch (err: any) {
				handleServerError(err as ServerError);
				return false;
			}
		} else if (removePicture && channel.last_picture_update) {
			try {
				await Client4.deleteChannelIcon(channel.id);
				iconChanged = true;
			} catch (err: any) {
				handleServerError(err as ServerError);
				return false;
			}
		}

		// Build updated channel object
		const updated: Channel = {
			...channel,
			display_name: displayName.trim(),
			name: channelUrl.trim(),
			purpose: channelPurpose.trim(),
			header: channelHeader.trim(),
		};

		const { data, error } = await dispatch(patchChannel(channel.id, updated));
		if (error) {
			handleServerError(error as ServerError);
			return false;
		}

		if (iconChanged) {
			await dispatch(getChannel(channel.id));
		}

		// Reset picture state on successful save
		setPictureFile(null);
		setPictureUrl(null);
		setRemovePicture(false);

		// After every successful save, update local state to match the saved values
		// with this, we make sure that the unsavedChanges check will return false after saving
		setDisplayName(data?.display_name ?? updated.display_name);
		setChannelURL(data?.name ?? updated.name);
		setChannelPurpose(data?.purpose ?? updated.purpose);
		setChannelHeader(data?.header ?? updated.header);
		return true;
	}, [channel, displayName, channelUrl, channelPurpose, channelHeader, channelType, pictureFile, removePicture, setFormError, handleServerError]);

	// Handle save changes panel actions
	const handleSaveChanges = useCallback(async () => {
		// Check if privacy is changing from public to private
		const isPrivacyChanging = channel.type === Constants.OPEN_CHANNEL &&
			channelType === Constants.PRIVATE_CHANNEL;

		// If privacy is changing, show confirmation modal
		if (isPrivacyChanging) {
			setShowConvertConfirmModal(true);
			return;
		}

		// Otherwise proceed with normal save
		const success = await handleSave();
		if (!success) {
			setSaveChangesPanelState('error');
			return;
		}
		setSaveChangesPanelState('saved');
	}, [channel, channelType, handleSave]);

	const handleClose = useCallback(() => {
		setSaveChangesPanelState(undefined);
	}, []);

	const hideConvertConfirmModal = useCallback(() => {
		setShowConvertConfirmModal(false);
	}, []);

	const handleCancel = useCallback(() => {
		// First, hide the panel immediately to prevent further interactions
		setSaveChangesPanelState(undefined);

		// Then reset all form fields to their original values
		setDisplayName(channel?.display_name ?? '');
		setChannelURL(channel?.name ?? '');
		setChannelPurpose(channel?.purpose ?? '');
		setChannelHeader(channel?.header ?? '');
		setChannelType(channel?.type as ChannelType ?? Constants.OPEN_CHANNEL as ChannelType);

		// Reset picture/icon states
		setPictureFile(null);
		setPictureUrl(null);
		setRemovePicture(false);

		// Clear errors
		setUrlError('');
		setFormError('');
		setCharacterLimitExceeded(false);
		setChannelNameError('');

		// If parent provided an onCancel callback, call it
		if (onCancel) {
			onCancel();
		}
	}, [channel, onCancel, setFormError]);

	// Calculate if there are errors
	const hasErrors = Boolean(formError) ||
		characterLimitExceeded ||
		Boolean(channelNameError) ||
		Boolean(showTabSwitchError) ||
		Boolean(internalUrlError);

	// Memoize the calculation for whether to show the save changes panel
	const shouldShowPanel = useMemo(() => {
		const unsavedChanges = channel ? (
			displayName.trim() !== channel.display_name ||
			channelUrl.trim() !== channel.name ||
			channelPurpose.trim() !== channel.purpose ||
			channelHeader.trim() !== channel.header ||
			channelType !== channel.type ||
			pictureFile !== null ||
			removePicture
		) : false;

		return unsavedChanges || saveChangesPanelState === 'saved';
	}, [channel, displayName, channelUrl, channelPurpose, channelHeader, channelType, pictureFile, removePicture, saveChangesPanelState]);

	return (
		<div className='ChannelSettingsModal__infoTab'>
			{/* ConvertConfirmModal for channel privacy changes */}
			<ConvertConfirmModal
				show={showConvertConfirmModal}
				onCancel={hideConvertConfirmModal}
				onConfirm={async () => {
					hideConvertConfirmModal();
					const success = await handleSave();
					if (!success) {
						setSaveChangesPanelState('error');
						return;
					}
					setSaveChangesPanelState('saved');
				}}
				displayName={channel?.display_name || ''}
				toPublic={false} // Always false since we're only converting from public to private
			/>

			{/* Channel Name Section*/}
			<div
				className='ChannelSettingsModal__infoTabTitle'
			>
				{formatMessage({ id: 'channel_settings.channel_info_tab.name', defaultMessage: 'Channel Info' })}
			</div>

			{/* Channel Icon Section */}
			<div className='ChannelSettingsModal__iconSection'>
				<label className='Input_subheading'>
					{formatMessage({ id: 'channel_settings.icon.label', defaultMessage: 'Channel Icon' })}
				</label>
				<div className='ChannelSettingsModal__iconWrapper'>
					{currentIconUrl ? (
						<img
							className='ChannelSettingsModal__iconPreview'
							src={currentIconUrl}
							alt={displayName}
						/>
					) : (
						defaultAvatar
					)}
					{canManageChannelProperties && (
						<div className='ChannelSettingsModal__iconActions'>
							<button
								type='button'
								className='btn btn-tertiary btn-xs'
								onClick={handleUploadClick}
							>
								{formatMessage({ id: 'channel_settings.icon.upload', defaultMessage: 'Upload Image' })}
							</button>
							{currentIconUrl && (
								<button
									type='button'
									className='btn btn-danger-outline btn-xs'
									onClick={handleRemoveClick}
								>
									{formatMessage({ id: 'channel_settings.icon.remove', defaultMessage: 'Remove' })}
								</button>
							)}
							<input
								type='file'
								ref={fileInputRef}
								style={{ display: 'none' }}
								accept='image/*'
								onChange={handleFileChange}
							/>
						</div>
					)}
				</div>
			</div>
			<ChannelNameFormField
				value={displayName}
				name='channel-settings-name'
				placeholder={formatMessage({
					id: 'channel_settings_modal.name.placeholder',
					defaultMessage: 'Enter a name for your channel',
				})}
				onDisplayNameChange={(name) => {
					setDisplayName(name);
				}}
				onURLChange={handleURLChange}
				onErrorStateChange={handleChannelNameError}
				urlError={internalUrlError}
				currentUrl={channelUrl}
				readOnly={!canManageChannelProperties}
				isEditingExistingChannel={true}
			/>

			{/* Channel Type Section*/}
			<PublicPrivateSelector
				className='ChannelSettingsModal__typeSelector'
				selected={channelType}
				publicButtonProps={{
					title: formatMessage({ id: 'channel_modal.type.public.title', defaultMessage: 'Public Channel' }),
					description: formatMessage({ id: 'channel_modal.type.public.description', defaultMessage: 'Anyone can join' }),

					// Always disable public button if current channel is private, regardless of permissions
					disabled: channel.type === Constants.PRIVATE_CHANNEL || !canConvertToPublic,
				}}
				privateButtonProps={{
					title: formatMessage({ id: 'channel_modal.type.private.title', defaultMessage: 'Private Channel' }),
					description: formatMessage({ id: 'channel_modal.type.private.description', defaultMessage: 'Only invited members' }),
					disabled: !canConvertToPrivate,
				}}
				onChange={handleChannelTypeChange}
			/>

			{/* Purpose Section*/}
			<AdvancedTextbox
				id='channel_settings_purpose_textbox'
				value={channelPurpose}
				channelId={channel.id}
				onChange={handlePurposeChange}
				createMessage={formatMessage({
					id: 'channel_settings_modal.purpose.placeholder',
					defaultMessage: 'Enter a purpose for this channel (optional)',
				})}
				maxLength={Constants.MAX_CHANNELPURPOSE_LENGTH}
				preview={shouldShowPreviewPurpose}
				togglePreview={togglePurposePreview}
				useChannelMentions={false}
				onKeyPress={() => { }}
				descriptionMessage={formatMessage({
					id: 'channel_settings.purpose.description',
					defaultMessage: 'Describe how this channel should be used.',
				})}
				hasError={channelPurpose.length > Constants.MAX_CHANNELPURPOSE_LENGTH}
				errorMessage={channelPurpose.length > Constants.MAX_CHANNELPURPOSE_LENGTH ? formatMessage({
					id: 'channel_settings.error_purpose_length',
					defaultMessage: 'The text entered exceeds the character limit. The channel purpose is limited to {maxLength} characters.',
				}, {
					maxLength: Constants.MAX_CHANNELPURPOSE_LENGTH,
				}) : undefined
				}
				showCharacterCount={channelPurpose.length > Constants.MAX_CHANNELPURPOSE_LENGTH}
				readOnly={!canManageChannelProperties}
				name={formatMessage({ id: 'channel_settings.purpose.label', defaultMessage: 'Channel Purpose' })}
			/>

			{/* Channel Header Section*/}
			<AdvancedTextbox
				id='channel_settings_header_textbox'
				value={channelHeader}
				channelId={channel.id}
				onChange={handleHeaderChange}
				createMessage={formatMessage({
					id: 'channel_settings_modal.header.placeholder',
					defaultMessage: 'Enter a header for this channel',
				})}
				maxLength={HEADER_MAX_LENGTH}
				preview={shouldShowPreviewHeader}
				togglePreview={toggleHeaderPreview}
				useChannelMentions={false}
				onKeyPress={() => { }}
				descriptionMessage={formatMessage({
					id: 'channel_settings.purpose.header',
					defaultMessage: 'This is the text that will appear in the header of the channel beside the channel name. You can use markdown to include links by typing [Link Title](http://example.com).',
				})}
				hasError={channelHeader.length > HEADER_MAX_LENGTH}
				errorMessage={channelHeader.length > HEADER_MAX_LENGTH ? formatMessage({
					id: 'edit_channel_header_modal.error',
					defaultMessage: 'The text entered exceeds the character limit. The channel header is limited to {maxLength} characters.',
				}, {
					maxLength: HEADER_MAX_LENGTH,
				}) : undefined
				}
				showCharacterCount={channelHeader.length > HEADER_MAX_LENGTH}
				readOnly={!canManageChannelProperties}
				name={formatMessage({ id: 'channel_settings.header.label', defaultMessage: 'Channel Header' })}
			/>

			{/* SaveChangesPanel for unsaved changes */}
			{(canManageChannelProperties && shouldShowPanel) && (
				<SaveChangesPanel
					handleSubmit={handleSaveChanges}
					handleCancel={handleCancel}
					handleClose={handleClose}
					tabChangeError={hasErrors}
					state={hasErrors ? 'error' : saveChangesPanelState}
					{...(!showTabSwitchError && { // for swowTabShiwthError use the default message
						customErrorMessage: formatMessage({
							id: 'channel_settings.save_changes_panel.standard_error',
							defaultMessage: 'There are errors in the form above',
						}),
					})}
					cancelButtonText={formatMessage({
						id: 'channel_settings.save_changes_panel.reset',
						defaultMessage: 'Reset',
					})}
				/>
			)}
		</div>
	);
}

export default ChannelSettingsInfoTab;
