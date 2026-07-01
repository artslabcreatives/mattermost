import React, {useState, useEffect} from 'react';
import {Client4} from 'mattermost-redux/client';

interface BackupConfig {
    client_id: string;
    client_secret?: string;
    folder_id: string;
    enabled: boolean;
    connected_email?: string;
}

interface BackupHistory {
    filename: string;
    size: number;
    timestamp: string;
    status: 'success' | 'failed' | 'running';
    error?: string;
}

export default function DatabaseBackupSettings() {
    const [config, setConfig] = useState<BackupConfig>({
        client_id: '',
        client_secret: '',
        folder_id: '',
        enabled: false,
    });
    const [history, setHistory] = useState<BackupHistory[]>([]);
    const [saving, setSaving] = useState(false);
    const [runningBackup, setRunningBackup] = useState(false);
    const [message, setMessage] = useState<{type: 'success' | 'error'; text: string} | null>(null);

    // Fetch config and history on mount
    const fetchData = async () => {
        try {
            const configResp = await fetch('/api/v4/database/backup/config');
            if (configResp.ok) {
                const data = await configResp.json();
                setConfig({
                    client_id: data.client_id || '',
                    client_secret: '', // Don't expose secret
                    folder_id: data.folder_id || '',
                    enabled: data.enabled || false,
                    connected_email: data.connected_email || '',
                });
            }

            const historyResp = await fetch('/api/v4/database/backup/history');
            if (historyResp.ok) {
                const data = await historyResp.json();
                setHistory(data || []);
                
                // If any backup is currently running, set state to running
                const isRunning = (data || []).some((h: BackupHistory) => h.status === 'running');
                setRunningBackup(isRunning);
            }
        } catch (err) {
            console.error('Failed to fetch backup data', err);
        }
    };

    useEffect(() => {
        fetchData();
        // Check for URL query params (e.g. OAuth callbacks)
        const params = new URLSearchParams(window.location.search);
        if (params.get('success') === 'connected') {
            setMessage({type: 'success', text: 'Successfully connected Google Drive account!'});
            // Clear URL query parameters
            window.history.replaceState({}, document.title, window.location.pathname);
        } else if (params.get('error')) {
            setMessage({type: 'error', text: `Failed to connect account: ${params.get('error')}`});
            window.history.replaceState({}, document.title, window.location.pathname);
        }
    }, []);

    // Polling if backup is running
    useEffect(() => {
        let interval: NodeJS.Timeout;
        if (runningBackup) {
            interval = setInterval(async () => {
                const historyResp = await fetch('/api/v4/database/backup/history');
                if (historyResp.ok) {
                    const data = await historyResp.json();
                    setHistory(data || []);
                    const isRunning = (data || []).some((h: BackupHistory) => h.status === 'running');
                    setRunningBackup(isRunning);
                }
            }, 3000);
        }
        return () => {
            if (interval) {
                clearInterval(interval);
            }
        };
    }, [runningBackup]);

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        setSaving(true);
        setMessage(null);

        try {
            const resp = await fetch('/api/v4/database/backup/config', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRF-Token': Client4.csrf,
                },
                body: JSON.stringify(config),
            });

            if (resp.ok) {
                setMessage({type: 'success', text: 'Backup settings saved successfully.'});
                fetchData();
            } else {
                setMessage({type: 'error', text: 'Failed to save settings.'});
            }
        } catch (err) {
            setMessage({type: 'error', text: 'Error saving settings.'});
        } finally {
            setSaving(false);
        }
    };

    const handleConnect = async () => {
        try {
            // Must save settings first so client id/secret are registered in DB
            const saveResp = await fetch('/api/v4/database/backup/config', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRF-Token': Client4.csrf,
                },
                body: JSON.stringify(config),
            });

            if (!saveResp.ok) {
                setMessage({type: 'error', text: 'Please save settings before connecting Google account.'});
                return;
            }

            const connectResp = await fetch('/api/v4/database/backup/google/connect', {
                method: 'POST',
                headers: {
                    'X-CSRF-Token': Client4.csrf,
                },
            });

            if (connectResp.ok) {
                const data = await connectResp.json();
                if (data.url) {
                    window.location.href = data.url;
                }
            } else {
                const errData = await connectResp.json();
                setMessage({type: 'error', text: errData.message || 'Failed to initiate Google OAuth.'});
            }
        } catch (err) {
            setMessage({type: 'error', text: 'Error initiating Google connection.'});
        }
    };

    const handleDisconnect = async () => {
        if (!confirm('Are you sure you want to disconnect Google Drive? Backups will no longer run.')) {
            return;
        }

        try {
            const resp = await fetch('/api/v4/database/backup/google/disconnect', {
                method: 'POST',
                headers: {
                    'X-CSRF-Token': Client4.csrf,
                },
            });

            if (resp.ok) {
                setMessage({type: 'success', text: 'Google Drive disconnected.'});
                fetchData();
            } else {
                setMessage({type: 'error', text: 'Failed to disconnect.'});
            }
        } catch (err) {
            setMessage({type: 'error', text: 'Error disconnecting.'});
        }
    };

    const handleRunBackup = async () => {
        setRunningBackup(true);
        setMessage(null);

        try {
            const resp = await fetch('/api/v4/database/backup/run', {
                method: 'POST',
                headers: {
                    'X-CSRF-Token': Client4.csrf,
                },
            });

            if (resp.ok) {
                setMessage({type: 'success', text: 'Database backup initiated in background.'});
                setTimeout(fetchData, 1000);
            } else {
                const errData = await resp.json();
                setMessage({type: 'error', text: errData.message || 'Failed to trigger backup.'});
                setRunningBackup(false);
            }
        } catch (err) {
            setMessage({type: 'error', text: 'Error triggering backup.'});
            setRunningBackup(false);
        }
    };

    const formatBytes = (bytes: number, decimals = 2) => {
        if (bytes === 0) {
            return '0 Bytes';
        }
        const k = 1024;
        const dm = decimals < 0 ? 0 : decimals;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
    };

    return (
        <div className='wrapper--fixed'>
            <div className='admin-console__wrapper'>
                <div className='admin-console__content'>
                    <div className='admin-console-header'>
                <h3>Database Backup to Google Drive</h3>
                <div className='admin-console-header-description'>
                    Configure automatic daily backups of your PostgreSQL database to Google Drive and execute manual backups.
                </div>
            </div>

            {message && (
                <div className={`alert alert-${message.type === 'success' ? 'success' : 'danger'}`}>
                    <i className={`fa ${message.type === 'success' ? 'fa-check-circle' : 'fa-exclamation-triangle'}`} style={{marginRight: '8px'}} />
                    {message.text}
                </div>
            )}

            <div className='card' style={{background: 'rgba(255, 255, 255, 0.05)', border: '1px solid rgba(255, 255, 255, 0.1)', borderRadius: '8px', padding: '20px', marginBottom: '24px'}}>
                <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
                    <div>
                        <h4 style={{margin: '0 0 5px 0', fontSize: '16px', fontWeight: 'bold'}}>Google Connection Status</h4>
                        {config.connected_email ? (
                            <span className='label label-success' style={{fontSize: '12px', padding: '5px 10px', borderRadius: '12px', background: '#2d8f2d'}}>
                                <i className='fa fa-google' style={{marginRight: '6px'}} />
                                Connected to {config.connected_email}
                            </span>
                        ) : (
                            <span className='label label-default' style={{fontSize: '12px', padding: '5px 10px', borderRadius: '12px', background: '#555'}}>
                                <i className='fa fa-google' style={{marginRight: '6px'}} />
                                Disconnected
                            </span>
                        )}
                    </div>
                    <div>
                        {config.connected_email ? (
                            <button
                                className='btn btn-danger'
                                type='button'
                                onClick={handleDisconnect}
                            >
                                <i className='fa fa-sign-out' style={{marginRight: '6px'}} />
                                Disconnect
                            </button>
                        ) : (
                            <button
                                className='btn btn-primary'
                                type='button'
                                onClick={handleConnect}
                                style={{background: '#4285F4', borderColor: '#4285F4'}}
                            >
                                <i className='fa fa-google' style={{marginRight: '6px'}} />
                                Connect Google Account
                            </button>
                        )}
                    </div>
                </div>
            </div>

            <form className='form-horizontal' onSubmit={handleSave}>
                <div className='form-group'>
                    <label className='control-label col-sm-4'>Google Client ID:</label>
                    <div className='col-sm-8'>
                        <input
                            type='text'
                            className='form-control'
                            value={config.client_id}
                            onChange={(e) => setConfig({...config, client_id: e.target.value})}
                            placeholder='Enter Google OAuth Client ID (optional if set in env)'
                        />
                    </div>
                </div>

                <div className='form-group'>
                    <label className='control-label col-sm-4'>Google Client Secret:</label>
                    <div className='col-sm-8'>
                        <input
                            type='password'
                            className='form-control'
                            value={config.client_secret || ''}
                            onChange={(e) => setConfig({...config, client_secret: e.target.value})}
                            placeholder={config.client_id ? '•••••••••••••••• (saved)' : 'Enter Google OAuth Client Secret (optional if set in env)'}
                        />
                    </div>
                </div>

                <div className='form-group'>
                    <label className='control-label col-sm-4'>Google Drive Folder ID:</label>
                    <div className='col-sm-8'>
                        <input
                            type='text'
                            className='form-control'
                            value={config.folder_id}
                            onChange={(e) => setConfig({...config, folder_id: e.target.value})}
                            placeholder='Enter target Google Drive folder ID'
                            required
                        />
                        <span className='help-block'>
                            Paste the ID of the Google Drive folder where backups should be uploaded (found in the folder URL).
                        </span>
                    </div>
                </div>

                <div className='form-group'>
                    <div className='col-sm-offset-4 col-sm-8'>
                        <div className='checkbox'>
                            <label>
                                <input
                                    type='checkbox'
                                    checked={config.enabled}
                                    onChange={(e) => setConfig({...config, enabled: e.target.checked})}
                                />
                                {'Enable Automated Daily Backup (at 12:00 AM)'}
                            </label>
                        </div>
                    </div>
                </div>

                <div style={{borderTop: '1px solid rgba(255, 255, 255, 0.1)', paddingTop: '20px', marginTop: '20px', display: 'flex', justifyContent: 'space-between'}}>
                    <button
                        className='btn btn-default'
                        type='button'
                        disabled={!config.connected_email || runningBackup}
                        onClick={handleRunBackup}
                    >
                        {runningBackup ? (
                            <span>
                                <i className='fa fa-spinner fa-spin' style={{marginRight: '6px'}} />
                                Backup Running...
                            </span>
                        ) : (
                            <span>
                                <i className='fa fa-play-circle' style={{marginRight: '6px'}} />
                                Run Backup Now
                            </span>
                        )}
                    </button>

                    <button
                        className='btn btn-primary'
                        type='submit'
                        disabled={saving}
                    >
                        {saving ? 'Saving...' : 'Save Settings'}
                    </button>
                </div>
            </form>

            <div style={{marginTop: '40px'}}>
                <h4 style={{fontSize: '16px', fontWeight: 'bold', borderBottom: '1px solid rgba(255, 255, 255, 0.1)', paddingBottom: '10px', marginBottom: '15px'}}>
                    Backup History
                </h4>
                {history.length === 0 ? (
                    <div className='well text-center' style={{background: 'rgba(255, 255, 255, 0.02)', border: '1px dashed rgba(255, 255, 255, 0.1)'}}>
                        No backup history found. Click "Run Backup Now" to create your first backup.
                    </div>
                ) : (
                    <table className='table' style={{color: 'inherit'}}>
                        <thead>
                            <tr>
                                <th>Filename</th>
                                <th>Timestamp</th>
                                <th>Size</th>
                                <th>Status</th>
                            </tr>
                        </thead>
                        <tbody>
                            {history.map((entry, index) => (
                                <tr key={index} style={{background: entry.status === 'running' ? 'rgba(66, 133, 244, 0.05)' : 'none'}}>
                                    <td style={{fontWeight: 'bold'}}>{entry.filename}</td>
                                    <td>{new Date(entry.timestamp).toLocaleString()}</td>
                                    <td>{entry.size ? formatBytes(entry.size) : '--'}</td>
                                    <td>
                                        {entry.status === 'success' && (
                                            <span className='label label-success' style={{background: '#2d8f2d'}}>Success</span>
                                        )}
                                        {entry.status === 'failed' && (
                                            <div>
                                                <span className='label label-danger' style={{background: '#d9534f', display: 'inline-block', marginBottom: '5px'}}>Failed</span>
                                                <div style={{fontSize: '11px', color: '#ff6666', maxWidth: '300px', wordBreak: 'break-all'}}>{entry.error}</div>
                                            </div>
                                        )}
                                        {entry.status === 'running' && (
                                            <span className='label label-info' style={{background: '#4285F4'}}>
                                                <i className='fa fa-spinner fa-spin' style={{marginRight: '6px'}} />
                                                Running
                                            </span>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
                    </div>
                </div>
            </div>
        </div>
    );
}

export const searchableStrings = [
    'Database Backup',
    'Configure database backup to Google Drive',
    'Google Drive Connection',
    'Google OAuth Settings',
    'Client ID',
    'Client Secret',
    'Folder ID',
    'Enable Automated Daily Backup',
    'Backup History',
];
