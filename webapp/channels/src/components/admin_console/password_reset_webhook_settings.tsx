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
    const [resetResult, setResetResult] = useState<{
        username: string;
        email: string;
        password: string;
        auth_service: string;
    } | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [copied, setCopied] = useState(false);

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

    // Helper to generate a 32-character strong random password suggestion
    const handleGeneratePasswordSuggestion = useCallback(() => {
        const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*';
        let generated = '';
        for (let i = 0; i < 32; i++) {
            generated += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        setNewPassword(generated);
    }, []);

    // Copy helper
    const handleCopyPassword = useCallback((textToCopy: string) => {
        if (!textToCopy) {
            return;
        }
        navigator.clipboard.writeText(textToCopy).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2500);
        });
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

    const handleResetPassword = useCallback(async () => {
        setStatusMessage(null);
        setResetResult(null);

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

        if (!newPassword) {
            setStatusMessage({
                type: 'error',
                text: 'Please enter a new password for resetting.',
            });
            return;
        }

        if (newPassword.length < 32) {
            setStatusMessage({
                type: 'error',
                text: 'Your password must contain at least 32 characters.',
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
                    action: 'reset',
                    admin_security_password: adminSecurityPassword,
                    new_password: newPassword,
                }),
            });

            const data = await response.json().catch(() => ({}));

            if (!response.ok) {
                throw new Error(data.message || 'Failed to process request. Please check your Admin Security Password.');
            }

            setStatusMessage({
                type: 'success',
                text: `Password for user @${data.username} was successfully reset and n8n webhook triggered!`,
            });

            setResetResult({
                username: data.username,
                email: data.email,
                password: data.password,
                auth_service: data.auth_service || 'Email / Password',
            });
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
                                Reset active user passwords, generate 32-character passwords to copy & share, and trigger automated n8n email webhooks.
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
                                Admin Security Password:
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
                            </div>
                        </div>

                        <hr style={{ margin: '25px 0', borderColor: '#eee' }} />

                        {/* RESET USER PASSWORD */}
                        <div className='form-group'>
                            <label className='control-label col-sm-4' style={{ color: '#d9534f', fontWeight: 'bold' }}>
                                Reset User Password (32 Chars Required):
                            </label>
                            <div className='col-sm-8'>
                                <div style={{ display: 'flex', gap: '10px', marginBottom: '10px' }}>
                                    <input
                                        type='text'
                                        className='form-control'
                                        placeholder='Enter 32-character new password or click Generate 32-Char Password'
                                        value={newPassword}
                                        onChange={(e) => setNewPassword(e.target.value)}
                                        disabled={isSubmitting}
                                    />
                                    <button
                                        type='button'
                                        className='btn btn-default'
                                        onClick={handleGeneratePasswordSuggestion}
                                        disabled={isSubmitting}
                                        style={{ minWidth: '200px', backgroundColor: '#f0ad4e', borderColor: '#eea236', color: '#fff', fontWeight: 'bold' }}
                                    >
                                        ⚡ Generate 32-Char Password
                                    </button>
                                    {newPassword && (
                                        <button
                                            type='button'
                                            className='btn btn-default'
                                            onClick={() => handleCopyPassword(newPassword)}
                                            style={{ minWidth: '80px', backgroundColor: copied ? '#5cb85c' : '#fff', color: copied ? '#fff' : '#333' }}
                                        >
                                            {copied ? '✓ Copied!' : '📋 Copy'}
                                        </button>
                                    )}
                                </div>
                                <button
                                    type='button'
                                    className='btn btn-danger'
                                    onClick={handleResetPassword}
                                    disabled={isSubmitting}
                                >
                                    {isSubmitting ? 'Processing...' : 'Reset Password & Trigger Webhook'}
                                </button>
                                <div className='help-text'>
                                    <span>Sets a 32-character new password for the selected user and dispatches n8n webhook notification.</span>
                                </div>

                                {resetResult && (
                                    <div style={{ backgroundColor: '#eef6fc', padding: '12px', borderRadius: '4px', marginTop: '15px', fontSize: '13px' }}>
                                        <div><strong>Username:</strong> @{resetResult.username}</div>
                                        <div><strong>Email:</strong> {resetResult.email}</div>
                                        <div><strong>New Password:</strong> <code style={{ fontSize: '12px', wordBreak: 'break-all' }}>{resetResult.password}</code></div>
                                        <button
                                            type='button'
                                            className='btn btn-default btn-sm'
                                            onClick={() => handleCopyPassword(resetResult.password)}
                                            style={{ marginTop: '8px', backgroundColor: copied ? '#5cb85c' : '#fff', color: copied ? '#fff' : '#333' }}
                                        >
                                            {copied ? '✓ Password Copied!' : '📋 Copy Reset Password'}
                                        </button>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
