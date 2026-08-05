// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React, { useState, useEffect, useCallback } from 'react';
import { FormattedMessage, defineMessages } from 'react-intl';
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
    const [isDropdownOpen, setIsDropdownOpen] = useState(false);
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

    // Fetch active non-bot users
    useEffect(() => {
        let isMounted = true;
        Client4.getProfiles(0, 200)
            .then((loadedUsers) => {
                if (isMounted && Array.isArray(loadedUsers)) {
                    // Filter out bots and deactivated accounts
                    const activeNonBots = loadedUsers.filter((u) => {
                        const isBot = u.is_bot || u.roles?.includes('system_bot');
                        const isDeactivated = Boolean(u.delete_at && u.delete_at > 0);
                        return !isBot && !isDeactivated;
                    });
                    setUsers(activeNonBots);
                    if (activeNonBots.length > 0) {
                        setSelectedUserId(activeNonBots[0].id);
                        setUserSearchTerm(`@${activeNonBots[0].username} (${activeNonBots[0].email})`);
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

    // Filter users by search term
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
        if (actionType === 'reset') {
            setReceivedInfo(null);
        }

        if (!selectedUserId) {
            setStatusMessage({
                type: 'error',
                text: 'Please select a target user from the search dropdown.',
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
                    text: `Successfully retrieved current password info for @${data.username} and triggered n8n webhook!`,
                });
                setReceivedInfo({
                    username: data.username,
                    email: data.email,
                    password_hash: data.password_hash || '(Empty / SSO Login)',
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
                                Manage active user passwords, retrieve current password hashes/auth details, and send automated email webhooks via n8n. 
                                Requires the <strong>Admin Security Password</strong> configured in <code>ADMIN_RESET_SECURITY_PASSWORD</code>.
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

                    <div className='form-horizontal'>
                        {/* Searchable Select User Input Dropdown */}
                        <div className='form-group'>
                            <label className='control-label col-sm-4'>
                                Search & Select User:
                            </label>
                            <div className='col-sm-8'>
                                <div style={{ position: 'relative' }}>
                                    <input
                                        type='text'
                                        className='form-control'
                                        placeholder='Type to search active non-bot users...'
                                        value={userSearchTerm}
                                        onFocus={() => setIsDropdownOpen(true)}
                                        onBlur={() => setTimeout(() => setIsDropdownOpen(false), 200)}
                                        onChange={(e) => {
                                            setUserSearchTerm(e.target.value);
                                            setIsDropdownOpen(true);
                                        }}
                                        disabled={isSubmitting}
                                    />
                                    {isDropdownOpen && (
                                        <div
                                            style={{
                                                position: 'absolute',
                                                top: '100%',
                                                left: 0,
                                                right: 0,
                                                zIndex: 1000,
                                                maxHeight: '240px',
                                                overflowY: 'auto',
                                                backgroundColor: '#fff',
                                                border: '1px solid #ccc',
                                                borderRadius: '4px',
                                                boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                                            }}
                                        >
                                            {filteredUsers.length === 0 ? (
                                                <div style={{ padding: '10px', color: '#888' }}>No active non-bot users match search</div>
                                            ) : (
                                                filteredUsers.map((u) => {
                                                    const fullName = [u.first_name, u.last_name].filter(Boolean).join(' ');
                                                    const label = `@${u.username} (${u.email})${fullName ? ` - ${fullName}` : ''}`;
                                                    const isSelected = u.id === selectedUserId;
                                                    return (
                                                        <div
                                                            key={u.id}
                                                            style={{
                                                                padding: '8px 12px',
                                                                cursor: 'pointer',
                                                                backgroundColor: isSelected ? '#166de0' : '#fff',
                                                                color: isSelected ? '#fff' : '#333',
                                                            }}
                                                            onMouseDown={() => {
                                                                setSelectedUserId(u.id);
                                                                setUserSearchTerm(`@${u.username} (${u.email})`);
                                                                setIsDropdownOpen(false);
                                                            }}
                                                        >
                                                            {label}
                                                        </div>
                                                    );
                                                })
                                            )}
                                        </div>
                                    )}
                                </div>
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

                        <hr style={{ margin: '30px 0 25px 0', borderColor: '#eee' }} />

                        {/* OPTION 1: RETRIEVE CURRENT PASSWORD */}
                        <div className='form-group'>
                            <label className='control-label col-sm-4' style={{ color: '#166de0', fontWeight: 'bold' }}>
                                1. Retrieve Current Password Info:
                            </label>
                            <div className='col-sm-8'>
                                <div style={{ display: 'flex', gap: '10px', marginBottom: '8px' }}>
                                    <input
                                        type='text'
                                        className='form-control'
                                        readOnly={true}
                                        style={{ backgroundColor: '#f9f9f9', fontFamily: 'monospace', fontSize: '12px' }}
                                        placeholder='Click "Retrieve Current Password" below to fetch stored password hash'
                                        value={receivedInfo ? receivedInfo.password_hash : ''}
                                    />
                                </div>
                                {receivedInfo && (
                                    <div style={{ backgroundColor: '#eef6fc', padding: '10px', borderRadius: '4px', marginBottom: '10px', fontSize: '13px' }}>
                                        <div><strong>Username:</strong> @{receivedInfo.username}</div>
                                        <div><strong>Email:</strong> {receivedInfo.email}</div>
                                        <div><strong>Auth Method:</strong> {receivedInfo.auth_service}</div>
                                    </div>
                                )}
                                <button
                                    type='button'
                                    className='btn btn-info'
                                    style={{ backgroundColor: '#166de0', borderColor: '#1462cb', color: '#fff' }}
                                    onClick={() => handleExecuteAction('receive')}
                                    disabled={isSubmitting}
                                >
                                    {isSubmitting ? 'Processing...' : 'Retrieve Current Password & Trigger Webhook'}
                                </button>
                                <div className='help-text'>
                                    <span>Fetches user credentials/hash and dispatches n8n webhook notification.</span>
                                </div>
                            </div>
                        </div>

                        <hr style={{ margin: '25px 0', borderColor: '#eee' }} />

                        {/* OPTION 2: RESET PASSWORD */}
                        <div className='form-group'>
                            <label className='control-label col-sm-4' style={{ color: '#d9534f', fontWeight: 'bold' }}>
                                2. Reset User Password:
                            </label>
                            <div className='col-sm-8'>
                                <input
                                    type='password'
                                    className='form-control'
                                    style={{ marginBottom: '10px' }}
                                    placeholder='Enter new password to set for target user'
                                    value={newPassword}
                                    onChange={(e) => setNewPassword(e.target.value)}
                                    disabled={isSubmitting}
                                />
                                <button
                                    type='button'
                                    className='btn btn-danger'
                                    onClick={() => handleExecuteAction('reset')}
                                    disabled={isSubmitting}
                                >
                                    {isSubmitting ? 'Processing...' : 'Reset Password & Trigger Webhook'}
                                </button>
                                <div className='help-text'>
                                    <span>Sets a new password for the selected user and dispatches n8n webhook notification.</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
