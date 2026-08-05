// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React, { useState, useEffect, useCallback } from 'react';
import { FormattedMessage, defineMessage, defineMessages } from 'react-intl';
import { Client4 } from 'mattermost-redux/client';
import type { UserProfile } from '@mattermost/types/users';

import AdminHeader from 'components/widgets/admin_console/admin_header';

export const searchableStrings = [
    'Password Reset & Webhook',
    'Admin Security Password',
    'Reset User Password',
    'Receive Current Password',
    'n8n Email Webhook',
];

export const messages = defineMessages({
    title: {
        id: 'admin.password_reset_webhook.title',
        defaultMessage: 'User Password Reset & n8n Webhook Notification',
    },
});

export default function PasswordResetWebhookSettings() {
    const [users, setUsers] = useState<UserProfile[]>([]);
    const [userSearchTerm, setUserSearchTerm] = useState('');
    const [selectedUserId, setSelectedUserId] = useState('');
    const [adminSecurityPassword, setAdminSecurityPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
    const [receivedInfo, setReceivedInfo] = useState<{
        username: string;
        email: string;
        password_hash: string;
        auth_service: string;
        action: string;
    } | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);

    // Fetch initial list of users for the select box
    useEffect(() => {
        let isMounted = true;
        Client4.getUsers(0, 200)
            .then((loadedUsers) => {
                if (isMounted && Array.isArray(loadedUsers)) {
                    setUsers(loadedUsers);
                    if (loadedUsers.length > 0) {
                        setSelectedUserId(loadedUsers[0].id);
                    }
                }
            })
            .catch((err) => {
                // eslint-disable-next-line no-console
                console.error('Failed to load system users', err);
            });
        return () => {
            isMounted = false;
        };
    }, []);

    // Filtered users list based on search input
    const filteredUsers = users.filter((u) => {
        const term = userSearchTerm.toLowerCase().trim();
        if (!term) {
            return true;
        }
        const usernameMatch = u.username?.toLowerCase().includes(term);
        const emailMatch = u.email?.toLowerCase().includes(term);
        const firstNameMatch = u.first_name?.toLowerCase().includes(term);
        const lastNameMatch = u.last_name?.toLowerCase().includes(term);
        return usernameMatch || emailMatch || firstNameMatch || lastNameMatch;
    });

    const handleExecuteAction = useCallback(async (actionType: 'reset' | 'receive') => {
        setStatusMessage(null);
        setReceivedInfo(null);

        if (!selectedUserId) {
            setStatusMessage({
                type: 'error',
                text: 'Please select a target user from the dropdown.',
            });
            return;
        }

        if (!adminSecurityPassword) {
            setStatusMessage({
                type: 'error',
                text: 'Please enter the Admin Security Password.',
            });
            return;
        }

        if (actionType === 'reset' && !newPassword) {
            setStatusMessage({
                type: 'error',
                text: 'Please enter a new password for resetting.',
            });
            return;
        }

        setIsSubmitting(true);

        try {
            const response = await fetch(`${Client4.getUserRoute(selectedUserId)}/admin_reset_password_webhook`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRF-Token': Client4.csrf,
                },
                body: JSON.stringify({
                    action: actionType,
                    admin_security_password: adminSecurityPassword,
                    new_password: actionType === 'reset' ? newPassword : '',
                }),
            });

            const data = await response.json().catch(() => ({}));

            if (!response.ok) {
                throw new Error(data.message || 'Failed to process request. Please check your Admin Security Password.');
            }

            if (actionType === 'reset') {
                setStatusMessage({
                    type: 'success',
                    text: `Password for user @${data.username} was successfully reset and n8n webhook notification triggered!`,
                });
                setNewPassword('');
            } else {
                setStatusMessage({
                    type: 'success',
                    text: `Successfully retrieved current password information for @${data.username} and triggered n8n webhook!`,
                });
                setReceivedInfo({
                    username: data.username,
                    email: data.email,
                    password_hash: data.password_hash || '(Empty / SSO)',
                    auth_service: data.auth_service || 'Email / Password',
                    action: data.action,
                });
            }
        } catch (err: any) {
            setStatusMessage({
                type: 'error',
                text: err.message || 'An error occurred while communicating with the server.',
            });
        } finally {
            setIsSubmitting(false);
        }
    }, [selectedUserId, adminSecurityPassword, newPassword]);

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
                    <div className='banner info' style={{ marginBottom: '20px' }}>
                        <div className='banner__content'>
                            <span>
                                Update user credentials or receive current password information and dispatch an email notification via an n8n webhook. 
                                Requires the <strong>Admin Security Password</strong> set in <code>ADMIN_RESET_SECURITY_PASSWORD</code>.
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

                    {receivedInfo && (
                        <div className='banner info' style={{ marginBottom: '20px', backgroundColor: '#eef6fc', borderLeft: '4px solid #166de0' }}>
                            <div className='banner__content' style={{ color: '#111' }}>
                                <h4 style={{ margin: '0 0 10px 0', fontSize: '15px', fontWeight: 'bold' }}>
                                    Current Password Information Retrieved
                                </h4>
                                <table className='table table-bordered' style={{ backgroundColor: '#fff', marginBottom: 0 }}>
                                    <tbody>
                                        <tr>
                                            <td style={{ fontWeight: 'bold', width: '180px' }}>Username:</td>
                                            <td>@{receivedInfo.username}</td>
                                        </tr>
                                        <tr>
                                            <td style={{ fontWeight: 'bold' }}>Email:</td>
                                            <td>{receivedInfo.email}</td>
                                        </tr>
                                        <tr>
                                            <td style={{ fontWeight: 'bold' }}>Auth Service:</td>
                                            <td>{receivedInfo.auth_service}</td>
                                        </tr>
                                        <tr>
                                            <td style={{ fontWeight: 'bold' }}>Stored Password Hash:</td>
                                            <td style={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>{receivedInfo.password_hash}</td>
                                        </tr>
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}

                    <div className='form-horizontal'>
                        {/* Searchable User Filter & Select Box */}
                        <div className='form-group'>
                            <label className='control-label col-sm-4'>
                                Search & Select User:
                            </label>
                            <div className='col-sm-8'>
                                <input
                                    type='text'
                                    className='form-control'
                                    style={{ marginBottom: '8px' }}
                                    placeholder='Type to filter users by username, name, or email...'
                                    value={userSearchTerm}
                                    onChange={(e) => setUserSearchTerm(e.target.value)}
                                    disabled={isSubmitting}
                                />
                                <select
                                    className='form-control'
                                    size={Math.min(6, Math.max(3, filteredUsers.length))}
                                    value={selectedUserId}
                                    onChange={(e) => setSelectedUserId(e.target.value)}
                                    disabled={isSubmitting}
                                >
                                    {filteredUsers.length === 0 ? (
                                        <option value='' disabled={true}>No matching users found</option>
                                    ) : (
                                        filteredUsers.map((u) => {
                                            const fullName = [u.first_name, u.last_name].filter(Boolean).join(' ');
                                            const label = `@${u.username} (${u.email})${fullName ? ` - ${fullName}` : ''}`;
                                            return (
                                                <option key={u.id} value={u.id}>
                                                    {label}
                                                </option>
                                            );
                                        })
                                    )}
                                </select>
                                <div className='help-text'>
                                    <span>Selected User ID: <code>{selectedUserId || 'None'}</code></span>
                                </div>
                            </div>
                        </div>

                        {/* Admin Security Password */}
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

                        {/* New User Password */}
                        <div className='form-group'>
                            <label className='control-label col-sm-4'>
                                New Password (for Reset):
                            </label>
                            <div className='col-sm-8'>
                                <input
                                    type='password'
                                    className='form-control'
                                    placeholder='Enter new password (required for Reset Password)'
                                    value={newPassword}
                                    onChange={(e) => setNewPassword(e.target.value)}
                                    disabled={isSubmitting}
                                />
                            </div>
                        </div>

                        {/* Buttons for Action */}
                        <div className='form-group' style={{ marginTop: '25px' }}>
                            <div className='col-sm-offset-4 col-sm-8' style={{ display: 'flex', gap: '12px' }}>
                                <button
                                    type='button'
                                    className='btn btn-primary'
                                    onClick={() => handleExecuteAction('reset')}
                                    disabled={isSubmitting}
                                >
                                    {isSubmitting ? 'Processing...' : 'Reset Password & Trigger Webhook'}
                                </button>
                                <button
                                    type='button'
                                    className='btn btn-default'
                                    style={{ backgroundColor: '#f5f5f5', borderColor: '#ccc' }}
                                    onClick={() => handleExecuteAction('receive')}
                                    disabled={isSubmitting}
                                >
                                    {isSubmitting ? 'Processing...' : 'Receive Current Password Info & Trigger Webhook'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
