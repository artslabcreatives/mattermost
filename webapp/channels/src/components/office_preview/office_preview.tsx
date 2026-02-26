// Copyright (c) 2015-present Aura, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

/**
 * OfficePreview renders a Microsoft Office Online viewer inside an iframe.
 *
 * Requirements:
 *   - The Mattermost server must have public links enabled
 *     (ServiceSettings.EnablePublicLinks == true) so that a publicly
 *     accessible URL can be passed to view.officeapps.live.com.
 *
 * Supported formats: .doc, .docx, .xls, .xlsx, .ppt, .pptx
 */

import React, { useState, useEffect } from 'react';
import { useIntl } from 'react-intl';

import type { FileInfo } from '@mattermost/types/files';

import { Client4 } from 'mattermost-redux/client';

import './office_preview.scss';

type Props = {
	fileInfo: FileInfo;

	/**
	 * Whether the system admin has enabled public links.  When false the
	 * viewer cannot be shown and a download prompt is displayed instead.
	 */
	enablePublicLink: boolean;
};

const OFFICE_ONLINE_EMBED = 'https://view.officeapps.live.com/op/embed.aspx';

export default function OfficePreview({ fileInfo, enablePublicLink }: Props) {
	const { formatMessage } = useIntl();
	const [publicLink, setPublicLink] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (!enablePublicLink) {
			return;
		}

		Client4.getFilePublicLink(fileInfo.id).then(({ link }) => {
			setPublicLink(link);
		}).catch(() => {
			setError(
				formatMessage({
					id: 'office_preview.link_error',
					defaultMessage: 'Could not generate a public link for this file.',
				}),
			);
		});
	}, [fileInfo.id, enablePublicLink]);

	if (!enablePublicLink) {
		return (
			<div className='office-preview office-preview--unavailable'>
				<p>
					{formatMessage({
						id: 'office_preview.not_enabled',
						defaultMessage:
							'Office document preview requires public links to be enabled. Ask your system admin to enable them, or download the file to view it.',
					})}
				</p>
			</div>
		);
	}

	if (error) {
		return (
			<div className='office-preview office-preview--unavailable'>
				<p>{error}</p>
			</div>
		);
	}

	if (!publicLink) {
		return (
			<div className='office-preview office-preview--loading'>
				<p>
					{formatMessage({
						id: 'office_preview.loading',
						defaultMessage: 'Loading preview…',
					})}
				</p>
			</div>
		);
	}

	const embedUrl = `${OFFICE_ONLINE_EMBED}?src=${encodeURIComponent(publicLink)}`;

	return (
		<div className='office-preview'>
			<iframe
				src={embedUrl}
				title={fileInfo.name}
				className='office-preview__frame'
				frameBorder='0'
				allowFullScreen={true}
				sandbox='allow-scripts allow-same-origin allow-forms allow-popups'
			/>
		</div>
	);
}
