// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React from 'react';
import type {MessageDescriptor} from 'react-intl';
import {FormattedMessage, defineMessage, defineMessages} from 'react-intl';

import type {AdminConfig} from '@mattermost/types/config';

import {typesensePurgeIndexes, typesenseTest} from 'actions/admin_actions.jsx';

import ExternalLink from 'components/external_link';

import {DocLinks} from 'utils/constants';

import BooleanSetting from './boolean_setting';
import OLDAdminSettings from './old_admin_settings';
import type {BaseProps, BaseState} from './old_admin_settings';
import RequestButton from './request_button/request_button';
import SettingsGroup from './settings_group';
import TextSetting from './text_setting';

interface State extends BaseState {
    connectionUrl: string;
    apiKey: string;
    enableIndexing: boolean;
    enableSearching: boolean;
    enableAutocomplete: boolean;
    configTested: boolean;
    canSave: boolean;
    canPurgeAndIndex: boolean;
    requestTimeoutSeconds: number;
    liveIndexingBatchSize: number;
    batchSize: number;
}

type Props = BaseProps & {
    config: AdminConfig;
};

export const messages = defineMessages({
    title: {id: 'admin.typesense.title', defaultMessage: 'Typesense'},
    enableIndexingTitle: {id: 'admin.typesense.enableIndexingTitle', defaultMessage: 'Enable Typesense Indexing:'},
    enableIndexingDescription: {id: 'admin.typesense.enableIndexingDescription', defaultMessage: 'When true, indexing of new posts occurs automatically. Search queries will use database search until "Enable Typesense for search queries" is enabled.'},
    connectionUrlTitle: {id: 'admin.typesense.connectionUrlTitle', defaultMessage: 'Server Connection Address:'},
    connectionUrlDescription: {id: 'admin.typesense.connectionUrlDescription', defaultMessage: 'The address of the Typesense server (e.g., http://localhost:8108).'},
    apiKeyTitle: {id: 'admin.typesense.apiKeyTitle', defaultMessage: 'API Key:'},
    apiKeyDescription: {id: 'admin.typesense.apiKeyDescription', defaultMessage: 'The API key to authenticate to the Typesense server.'},
    requestTimeoutTitle: {id: 'admin.typesense.requestTimeoutTitle', defaultMessage: 'Request Timeout (seconds):'},
    requestTimeoutDescription: {id: 'admin.typesense.requestTimeoutDescription', defaultMessage: 'Timeout in seconds for Typesense requests.'},
    liveIndexingBatchSizeTitle: {id: 'admin.typesense.liveIndexingBatchSizeTitle', defaultMessage: 'Live Indexing Batch Size:'},
    liveIndexingBatchSizeDescription: {id: 'admin.typesense.liveIndexingBatchSizeDescription', defaultMessage: 'Number of documents to index in a single batch during live indexing.'},
    batchSizeTitle: {id: 'admin.typesense.batchSizeTitle', defaultMessage: 'Bulk Indexing Batch Size:'},
    batchSizeDescription: {id: 'admin.typesense.batchSizeDescription', defaultMessage: 'Number of documents to index in a single batch during bulk indexing operations.'},
    testHelpText: {id: 'admin.typesense.testHelpText', defaultMessage: 'Tests if the Mattermost server can connect to the Typesense server specified. Testing the connection only saves the configuration if the test is successful.'},
    typesense_test_button: {id: 'admin.typesense.typesense_test_button', defaultMessage: 'Test Connection'},
    purgeIndexesHelpText: {id: 'admin.typesense.purgeIndexesHelpText', defaultMessage: 'Purging will entirely remove the indexes on the Typesense server. Search results may be incomplete until a bulk index of the existing database is rebuilt.'},
    purgeIndexesButton: {id: 'admin.typesense.purgeIndexesButton', defaultMessage: 'Purge Indexes'},
    label: {id: 'admin.typesense.purgeIndexesButton.label', defaultMessage: 'Purge Indexes:'},
    enableSearchingTitle: {id: 'admin.typesense.enableSearchingTitle', defaultMessage: 'Enable Typesense for search queries:'},
    enableSearchingDescription: {id: 'admin.typesense.enableSearchingDescription', defaultMessage: 'Requires a successful connection to the Typesense server. When true, Typesense will be used for all search queries using the latest index. Search results may be incomplete until a bulk index of the existing post database is finished. When false, database search is used.'},
    enableAutocompleteTitle: {id: 'admin.typesense.enableAutocompleteTitle', defaultMessage: 'Enable Typesense for autocomplete queries:'},
    enableAutocompleteDescription: {id: 'admin.typesense.enableAutocompleteDescription', defaultMessage: 'Requires a successful connection to the Typesense server. When true, Typesense will be used for all autocomplete queries. When false, database autocomplete is used.'},
});

export const searchableStrings: Array<string|MessageDescriptor|[MessageDescriptor, {[key: string]: any}]> = [
    messages.title,
    messages.enableIndexingTitle,
    messages.enableIndexingDescription,
    messages.connectionUrlTitle,
    messages.connectionUrlDescription,
    messages.apiKeyTitle,
    messages.apiKeyDescription,
    messages.requestTimeoutTitle,
    messages.requestTimeoutDescription,
    messages.liveIndexingBatchSizeTitle,
    messages.liveIndexingBatchSizeDescription,
    messages.batchSizeTitle,
    messages.batchSizeDescription,
    messages.testHelpText,
    messages.typesense_test_button,
    messages.purgeIndexesHelpText,
    messages.purgeIndexesButton,
    messages.label,
    messages.enableSearchingTitle,
    messages.enableSearchingDescription,
    messages.enableAutocompleteTitle,
    messages.enableAutocompleteDescription,
];

export default class TypesenseSettings extends OLDAdminSettings<Props, State> {
    getConfigFromState = (config: AdminConfig) => {
        config.TypesenseSettings.ConnectionURL = this.state.connectionUrl;
        config.TypesenseSettings.APIKey = this.state.apiKey;
        config.TypesenseSettings.EnableIndexing = this.state.enableIndexing;
        config.TypesenseSettings.EnableSearching = this.state.enableSearching;
        config.TypesenseSettings.EnableAutocomplete = this.state.enableAutocomplete;
        config.TypesenseSettings.RequestTimeoutSeconds = this.state.requestTimeoutSeconds;
        config.TypesenseSettings.LiveIndexingBatchSize = this.state.liveIndexingBatchSize;
        config.TypesenseSettings.BatchSize = this.state.batchSize;

        return config;
    };

    getStateFromConfig(config: AdminConfig) {
        return {
            connectionUrl: config.TypesenseSettings.ConnectionURL,
            apiKey: config.TypesenseSettings.APIKey,
            enableIndexing: config.TypesenseSettings.EnableIndexing,
            enableSearching: config.TypesenseSettings.EnableSearching,
            enableAutocomplete: config.TypesenseSettings.EnableAutocomplete,
            requestTimeoutSeconds: config.TypesenseSettings.RequestTimeoutSeconds,
            liveIndexingBatchSize: config.TypesenseSettings.LiveIndexingBatchSize,
            batchSize: config.TypesenseSettings.BatchSize,
            configTested: true,
            canSave: true,
            canPurgeAndIndex: config.TypesenseSettings.EnableIndexing,
        };
    }

    handleSettingChanged = (id: string, value: boolean | string | number) => {
        if (id === 'enableIndexing') {
            if (value === false) {
                this.setState({
                    enableSearching: false,
                    enableAutocomplete: false,
                });
            } else {
                this.setState({
                    canSave: false,
                    configTested: false,
                });
            }
        }

        if (id === 'connectionUrl' || id === 'apiKey' || id === 'requestTimeoutSeconds' || id === 'liveIndexingBatchSize' || id === 'batchSize') {
            this.setState({
                configTested: false,
                canSave: false,
            });
        }

        if (id !== 'enableSearching' && id !== 'enableAutocomplete') {
            this.setState({
                canPurgeAndIndex: false,
            });
        }

        this.handleChange(id, value);
    };

    handleSaved = () => {
        this.setState({
            canPurgeAndIndex: this.state.enableIndexing,
        });
    };

    canSave = () => {
        return this.state.canSave;
    };

    doTestConfig = (success: () => void, error: (error: {message: string; detailed_message?: string}) => void): void => {
        const config = JSON.parse(JSON.stringify(this.props.config));
        this.getConfigFromState(config);

        typesenseTest(
            config,
            () => {
                this.setState({
                    configTested: true,
                    canSave: true,
                });
                success();
            },
            (err: {message: string; detailed_message?: string}) => {
                this.setState({
                    configTested: false,
                    canSave: false,
                });
                error(err);
            },
        );
    };

    renderTitle() {
        return (
            <FormattedMessage {...messages.title}/>
        );
    }

    renderSettings = () => {
        return (
            <SettingsGroup>
                <BooleanSetting
                    id='enableIndexing'
                    label={
                        <FormattedMessage {...messages.enableIndexingTitle}/>
                    }
                    helpText={
                        <FormattedMessage {...messages.enableIndexingDescription}/>
                    }
                    value={this.state.enableIndexing}
                    onChange={this.handleSettingChanged}
                    setByEnv={this.isSetByEnv('TypesenseSettings.EnableIndexing')}
                    disabled={this.props.isDisabled}
                />
                <TextSetting
                    id='connectionUrl'
                    label={
                        <FormattedMessage {...messages.connectionUrlTitle}/>
                    }
                    placeholder={defineMessage({id: 'admin.typesense.connectionUrlExample', defaultMessage: 'http://localhost:8108'})}
                    helpText={
                        <FormattedMessage {...messages.connectionUrlDescription}/>
                    }
                    value={this.state.connectionUrl}
                    onChange={this.handleSettingChanged}
                    setByEnv={this.isSetByEnv('TypesenseSettings.ConnectionURL')}
                    disabled={this.props.isDisabled}
                />
                <TextSetting
                    id='apiKey'
                    label={
                        <FormattedMessage {...messages.apiKeyTitle}/>
                    }
                    placeholder={defineMessage({id: 'admin.typesense.apiKeyExample', defaultMessage: 'xyz'})}
                    helpText={
                        <FormattedMessage {...messages.apiKeyDescription}/>
                    }
                    value={this.state.apiKey}
                    onChange={this.handleSettingChanged}
                    setByEnv={this.isSetByEnv('TypesenseSettings.APIKey')}
                    disabled={this.props.isDisabled}
                    type='password'
                />
                <TextSetting
                    id='requestTimeoutSeconds'
                    label={
                        <FormattedMessage {...messages.requestTimeoutTitle}/>
                    }
                    placeholder={defineMessage({id: 'admin.typesense.requestTimeoutExample', defaultMessage: '30'})}
                    helpText={
                        <FormattedMessage {...messages.requestTimeoutDescription}/>
                    }
                    value={this.state.requestTimeoutSeconds}
                    onChange={this.handleSettingChanged}
                    setByEnv={this.isSetByEnv('TypesenseSettings.RequestTimeoutSeconds')}
                    disabled={this.props.isDisabled}
                    type='number'
                />
                <TextSetting
                    id='liveIndexingBatchSize'
                    label={
                        <FormattedMessage {...messages.liveIndexingBatchSizeTitle}/>
                    }
                    placeholder={defineMessage({id: 'admin.typesense.liveIndexingBatchSizeExample', defaultMessage: '10'})}
                    helpText={
                        <FormattedMessage {...messages.liveIndexingBatchSizeDescription}/>
                    }
                    value={this.state.liveIndexingBatchSize}
                    onChange={this.handleSettingChanged}
                    setByEnv={this.isSetByEnv('TypesenseSettings.LiveIndexingBatchSize')}
                    disabled={this.props.isDisabled}
                    type='number'
                />
                <TextSetting
                    id='batchSize'
                    label={
                        <FormattedMessage {...messages.batchSizeTitle}/>
                    }
                    placeholder={defineMessage({id: 'admin.typesense.batchSizeExample', defaultMessage: '10000'})}
                    helpText={
                        <FormattedMessage {...messages.batchSizeDescription}/>
                    }
                    value={this.state.batchSize}
                    onChange={this.handleSettingChanged}
                    setByEnv={this.isSetByEnv('TypesenseSettings.BatchSize')}
                    disabled={this.props.isDisabled}
                    type='number'
                />
                <RequestButton
                    requestAction={this.doTestConfig}
                    helpText={
                        <FormattedMessage {...messages.testHelpText}/>
                    }
                    buttonText={
                        <FormattedMessage {...messages.typesense_test_button}/>
                    }
                    disabled={this.props.isDisabled}
                    saveNeeded={!this.state.configTested}
                    showSuccessMessage={false}
                />
                <BooleanSetting
                    id='enableSearching'
                    label={
                        <FormattedMessage {...messages.enableSearchingTitle}/>
                    }
                    helpText={
                        <FormattedMessage {...messages.enableSearchingDescription}/>
                    }
                    value={this.state.enableSearching}
                    onChange={this.handleSettingChanged}
                    disabled={this.props.isDisabled || !this.state.enableIndexing}
                    setByEnv={this.isSetByEnv('TypesenseSettings.EnableSearching')}
                />
                <BooleanSetting
                    id='enableAutocomplete'
                    label={
                        <FormattedMessage {...messages.enableAutocompleteTitle}/>
                    }
                    helpText={
                        <FormattedMessage {...messages.enableAutocompleteDescription}/>
                    }
                    value={this.state.enableAutocomplete}
                    onChange={this.handleSettingChanged}
                    disabled={this.props.isDisabled || !this.state.enableIndexing}
                    setByEnv={this.isSetByEnv('TypesenseSettings.EnableAutocomplete')}
                />
                <div>
                    <label>
                        <FormattedMessage {...messages.label}/>
                    </label>
                    <div className='help-text'>
                        <FormattedMessage {...messages.purgeIndexesHelpText}/>
                    </div>
                    <RequestButton
                        requestAction={
                            (success: () => void, error: (err: {message: string}) => void) => {
                                typesensePurgeIndexes(success, error, undefined);
                            }
                        }
                        helpText={null}
                        buttonText={
                            <FormattedMessage {...messages.purgeIndexesButton}/>
                        }
                        disabled={this.props.isDisabled || !this.state.canPurgeAndIndex}
                        showSuccessMessage={true}
                        errorMessage={{
                            id: 'admin.typesense.purgeFail',
                            defaultMessage: 'Purging unsuccessful: {error}',
                        }}
                        successMessage={{
                            id: 'admin.typesense.purgeSuccess',
                            defaultMessage: 'Indexes purged successfully.',
                        }}
                    />
                </div>
            </SettingsGroup>
        );
    };
}
