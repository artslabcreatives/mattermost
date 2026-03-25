// Copyright (c) 2015-present Aura, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React, { useRef } from 'react';
import { FormattedMessage } from 'react-intl';
import { useSelector } from 'react-redux';

import { getMyTeams } from 'mattermost-redux/selectors/entities/teams';

import { getSearchTeam } from 'selectors/rhs';

import SelectTeam from 'components/new_search/select_team';
import type { SearchFilterType } from 'components/search/types';

import type { A11yFocusEventDetail } from 'utils/constants';
import Constants, { A11yCustomEventTypes, DataSearchTypes } from 'utils/constants';
import * as Keyboard from 'utils/keyboard';

import type { GlobalState } from 'types/store';
import type { SearchType } from 'types/store/rhs';

import FilesFilterMenu from './files_filter_menu';

const { KeyCodes } = Constants;

import './messages_or_files_selector.scss';

type Props = {
	selected: string;
	selectedFilter: SearchFilterType;
	messagesCounter: string;
	filesCounter: string;
	peopleCounter: string;
	isFileAttachmentsEnabled: boolean;
	crossTeamSearchEnabled: boolean;
	onChange: (value: SearchType) => void;
	onFilter: (filter: SearchFilterType) => void;
	onTeamChange: (teamId: string) => void;
};

type DataSearchLiteral = typeof DataSearchTypes[keyof typeof DataSearchTypes];

const TAB_ORDER: SearchType[] = [
	DataSearchTypes.ALL_SEARCH_TYPE as SearchType,
	DataSearchTypes.MESSAGES_SEARCH_TYPE as SearchType,
	DataSearchTypes.FILES_SEARCH_TYPE as SearchType,
	DataSearchTypes.PEOPLE_SEARCH_TYPE as SearchType,
];

export default function MessagesOrFilesSelector(props: Props): JSX.Element {
	const searchTeam = useSelector((state: GlobalState) => getSearchTeam(state));
	const myTeams = useSelector(getMyTeams);
	const hasMoreThanOneTeam = myTeams.length > 1;

	const allTabRef = useRef<HTMLButtonElement>(null);
	const messagesTabRef = useRef<HTMLButtonElement>(null);
	const filesTabRef = useRef<HTMLButtonElement>(null);
	const peopleTabRef = useRef<HTMLButtonElement>(null);

	const tabRefs: Record<string, React.RefObject<HTMLButtonElement>> = {
		[DataSearchTypes.ALL_SEARCH_TYPE]: allTabRef,
		[DataSearchTypes.MESSAGES_SEARCH_TYPE]: messagesTabRef,
		[DataSearchTypes.FILES_SEARCH_TYPE]: filesTabRef,
		[DataSearchTypes.PEOPLE_SEARCH_TYPE]: peopleTabRef,
	};

	const handleTabKeyDown = (
		e: React.KeyboardEvent<HTMLButtonElement>,
		currentTab: DataSearchLiteral,
	) => {
		if (Keyboard.isKeyPressed(e, KeyCodes.LEFT) || Keyboard.isKeyPressed(e, KeyCodes.RIGHT)) {
			e.preventDefault();
			e.stopPropagation();

			const currentIndex = TAB_ORDER.indexOf(currentTab as SearchType);
			let nextIndex: number;
			if (Keyboard.isKeyPressed(e, KeyCodes.RIGHT)) {
				// Skip Files tab if attachments not enabled
				let candidate = (currentIndex + 1) % TAB_ORDER.length;
				while (candidate !== currentIndex) {
					if (TAB_ORDER[candidate] === DataSearchTypes.FILES_SEARCH_TYPE && !props.isFileAttachmentsEnabled) {
						candidate = (candidate + 1) % TAB_ORDER.length;
					} else {
						break;
					}
				}
				nextIndex = candidate;
			} else {
				let candidate = (currentIndex - 1 + TAB_ORDER.length) % TAB_ORDER.length;
				while (candidate !== currentIndex) {
					if (TAB_ORDER[candidate] === DataSearchTypes.FILES_SEARCH_TYPE && !props.isFileAttachmentsEnabled) {
						candidate = (candidate - 1 + TAB_ORDER.length) % TAB_ORDER.length;
					} else {
						break;
					}
				}
				nextIndex = candidate;
			}

			const nextTab = TAB_ORDER[nextIndex];
			const nextTabRef = tabRefs[nextTab];
			props.onChange(nextTab);

			if (nextTabRef.current) {
				setTimeout(() => {
					document.dispatchEvent(
						new CustomEvent<A11yFocusEventDetail>(A11yCustomEventTypes.FOCUS, {
							detail: {
								target: nextTabRef.current,
								keyboardOnly: true,
							},
						}),
					);
				}, 0);
			}
			return;
		}

		if (Keyboard.isKeyPressed(e, KeyCodes.ENTER)) {
			props.onChange(currentTab as SearchType);
		}
	};

	const makeTabClass = (tabType: string) =>
		props.selected === tabType ? `active tab ${tabType}-tab` : `tab ${tabType}-tab`;

	return (
		<div className='MessagesOrFilesSelector'>
			<div
				className='buttons-container'
				role='tablist'
				aria-label='Search result type'
			>
				<button
					ref={allTabRef}
					role='tab'
					aria-selected={props.selected === DataSearchTypes.ALL_SEARCH_TYPE ? 'true' : 'false'}
					tabIndex={props.selected === DataSearchTypes.ALL_SEARCH_TYPE ? 0 : -1}
					aria-controls='allPanel'
					id='allTab'
					onClick={() => props.onChange(DataSearchTypes.ALL_SEARCH_TYPE as SearchType)}
					onKeyDown={(e) => handleTabKeyDown(e, DataSearchTypes.ALL_SEARCH_TYPE)}
					className={makeTabClass('all')}
				>
					<FormattedMessage
						id='search_bar.all_tab'
						defaultMessage='All'
					/>
				</button>
				<button
					ref={messagesTabRef}
					role='tab'
					aria-selected={props.selected === DataSearchTypes.MESSAGES_SEARCH_TYPE ? 'true' : 'false'}
					tabIndex={props.selected === DataSearchTypes.MESSAGES_SEARCH_TYPE ? 0 : -1}
					aria-controls='messagesPanel'
					id='messagesTab'
					onClick={() => props.onChange(DataSearchTypes.MESSAGES_SEARCH_TYPE as SearchType)}
					onKeyDown={(e) => handleTabKeyDown(e, DataSearchTypes.MESSAGES_SEARCH_TYPE)}
					className={makeTabClass('messages')}
				>
					<FormattedMessage
						id='search_bar.messages_tab'
						defaultMessage='Messages'
					/>
					<span className='counter'>{props.messagesCounter}</span>
				</button>
				{props.isFileAttachmentsEnabled && (
					<button
						ref={filesTabRef}
						role='tab'
						aria-selected={props.selected === DataSearchTypes.FILES_SEARCH_TYPE ? 'true' : 'false'}
						tabIndex={props.selected === DataSearchTypes.FILES_SEARCH_TYPE ? 0 : -1}
						aria-controls='filesPanel'
						id='filesTab'
						onClick={() => props.onChange(DataSearchTypes.FILES_SEARCH_TYPE as SearchType)}
						onKeyDown={(e) => handleTabKeyDown(e, DataSearchTypes.FILES_SEARCH_TYPE)}
						className={makeTabClass('files')}
					>
						<FormattedMessage
							id='search_bar.files_tab'
							defaultMessage='Files'
						/>
						<span className='counter'>{props.filesCounter}</span>
					</button>
				)}
				<button
					ref={peopleTabRef}
					role='tab'
					aria-selected={props.selected === DataSearchTypes.PEOPLE_SEARCH_TYPE ? 'true' : 'false'}
					tabIndex={props.selected === DataSearchTypes.PEOPLE_SEARCH_TYPE ? 0 : -1}
					aria-controls='peoplePanel'
					id='peopleTab'
					onClick={() => props.onChange(DataSearchTypes.PEOPLE_SEARCH_TYPE as SearchType)}
					onKeyDown={(e) => handleTabKeyDown(e, DataSearchTypes.PEOPLE_SEARCH_TYPE)}
					className={makeTabClass('people')}
				>
					<FormattedMessage
						id='search_bar.people_tab'
						defaultMessage='People'
					/>
					<span className='counter'>{props.peopleCounter}</span>
				</button>
			</div>
			{props.crossTeamSearchEnabled && hasMoreThanOneTeam && (
				<div className='team-selector-container'>
					<SelectTeam
						selectedTeamId={searchTeam}
						onTeamSelected={props.onTeamChange}
					/>
				</div>
			)}
			{props.selected === DataSearchTypes.FILES_SEARCH_TYPE && (
				<FilesFilterMenu
					selectedFilter={props.selectedFilter}
					onFilter={props.onFilter}
				/>
			)}
		</div>
	);
}

