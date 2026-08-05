// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React, { useState, useCallback } from 'react';
import { FormattedMessage, defineMessage, defineMessages } from 'react-intl';
import { Client4 } from 'mattermost-redux/client';

import AdminHeader from 'components/widgets/admin_console/admin_header';

export const searchableStrings = [
    'Password Reset & Webhook',
    'Admin Security Password',
    'Reset User Password',
    'n8n Email Webhook',
];

export const messages = defineMessages({
    title: {
        id: 'admin.password_reset_webhook.title',
        defaultMessage: 'User Password Reset & n8n Webhook Notification',
    },
});

export default function PasswordResetWebhookSettings() {
    const [userIdOrUsername, setUserIdOrUsername] = useState('');
    const [adminSecurityPassword, setAdminSecurityPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);

    const handleSubmit = useCallback(async (e: React.FormEvent) => {
        e.preventDefault();
        setStatusMessage(null);

        if (!userIdOrUsername.trim() || !adminSecurityPassword || !newPassword) {
            setStatusMessage({
                type: 'error',
                text: 'Please fill in all required fields (User ID / Username, Admin Security Password, and New Password).',
            });
            return;
        }

        setIsSubmitting(true);

        try {
            // Find target user if username or email was provided
            let targetUserId = userIdOrUsername.trim();
            if (targetUserId.includes('@')) {
                const user = await Client4.getUserByEmail(targetUserId);
                targetUserId = user.id;
            } else if (targetUserId.length !== 26) {
                const user = await Client4.getUserByUsername(targetUserId);
                targetUserId = user.id;
            }

            const response = await fetch(`${Client4.getUserRoute(targetUserId)}/admin_reset_password_webhook`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRF-Token': Client4.csrf,
                },
                body: JSON.stringify({
                    admin_security_password: adminSecurityPassword,
                    new_password: newPassword,
                }),
            });

            if (!response.ok) {
                const errData = await response.json().catch(() => ({}));
                throw new Error(errData.message || 'Failed to reset password. Please check your Admin Security Password.');
            }

            setStatusMessage({
                type: 'success',
                text: 'Password successfully reset and n8n webhook notification triggered!',
            });
            setNewPassword('');
        } catch (err: any) {
            setStatusMessage({
                type: 'error',
                text: err.message || 'An error occurred while resetting the password.',
            });
        } finally {
            setIsSubmitting(false);
        }
    }, [userIdOrUsername, adminSecurityPassword, newPassword]);

    return (
        <div className='wrapper--fixed'>
            <AdminHeader>
                <FormattedMessage
                    id='admin.password_reset_webhook.title'
                    defaultMessage='User Password Reset & n8n Webhook Notification'
                />
            </AdminHeader>
            <div className='admin-console__wrapper'>
                <div className='admin-console__content'>
                    <form className='form-horizontal' onSubmit={handleSubmit}>
                        <div className='banner info' style={{ marginBottom: '20px' }}>
                            <div className='banner__content'>
                                <span>
                                    This tool allows System Admins to update a user's password and dispatch an email notification via an n8n webhook. 
                                    You must enter the <strong>Admin Security Password</strong> configured in your environment (<code>ADMIN_RESET_SECURITY_PASSWORD</code>).
                                </span>
                            </div>
                        </div>

                        {statusMessage && (
                            <div className={`banner ${statusMessage.type === 'success' ? 'success' : 'error'}`} style={{ marginBottom: '20px' }}>
                                <div className='banner__content'>
                                    <span>{statusMessage.text}</span>
                                </div>
                            </div>
                        )}

                        <div className='form-group'>
                            <label className='control-label col-sm-4'>
                                Target User (Username, Email, or User ID):
                            </label>
                            <div className='col-sm-8'>
                                <input
                                    type='text'
                                    className='form-control'
                                    placeholder='e.g., john.doe or john@example.com'
                                    value={userIdOrUsername}
                                    onChange={(e) => setUserIdOrUsername(e.target.value)}
                                    disabled={isSubmitting}
                                    required={true}
                                />
                            </div>
                        </div>

                        <div className='form-group'>
                            <label className='control-label col-sm-4'>
                                Admin Security Password (from .env):
                            </label>
                            <div className='col-sm-8'>
                                <input
                                    type='password'
                                    className='form-control'
                                    placeholder='Enter ADMIN_RESET_SECURITY_PASSWORD'
                                    value={adminSecurityPassword}
                                    onChange={(e) => setAdminSecurityPassword(e.target.value)}
                                    disabled={isSubmitting}
                                    required={true}
                                />
                                <div className='help-text'>
                                    <span>Master security key set in server environment variables.</span>
                                </div>
                            </div>
                        </div>

                        <div className='form-group'>
                            <label className='control-label col-sm-4'>
                                New User Password:
                            </label>
                            <div className='col-sm-8'>
                                <input
                                    type='password'
                                    className='form-control'
                                    placeholder='Enter new password for target user'
                                    value={newPassword}
                                    onChange={(e) => setNewPassword(e.target.value)}
                                    disabled={isSubmitting}
                                    required={true}
                                />
                            </div>
                        </div>

                        <div className='form-group' style={{ marginTop: '20px' }}>
                            <div className='col-sm-offset-4 col-sm-8'>
                                <button
                                    type='submit'
                                    className='btn btn-primary'
                                    disabled={isSubmitting}
                                >
                                    {isSubmitting ? 'Resetting Password...' : 'Reset Password & Trigger Webhook'}
                                </button>
                            </div>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    );
}
