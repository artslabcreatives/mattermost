// Copyright (c) 2015-present Aura, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React from 'react';
import {defineMessage} from 'react-intl';

import {LicenseSkus} from 'utils/constants';

import GroupsSVG from './images/groups_svg';

import FeatureDiscovery from '../index';

const GitLabFeatureDiscovery: React.FC = () => {
    return (
        <FeatureDiscovery
            featureName='gitlab'
            minimumSKURequiredForFeature={LicenseSkus.Professional}
            title={defineMessage({
                id: 'admin.gitlab_feature_discovery.title',
                defaultMessage: 'Integrate GitLab SSO with OpenID Connect in Aura Professional',
            })}
            copy={defineMessage({
                id: 'admin.gitlab_feature_discovery.copy',
                defaultMessage: 'When you connect GitLab as your single sign-on provider, your team can access Aura without having to re-enter their GitLab credentials. Available only on Aura Professional and above.',
            })}
            learnMoreURL='https://docs.mattermost.com/administration-guide/onboard/sso-gitlab.html'
            featureDiscoveryImage={
                <GroupsSVG
                    width={276}
                    height={170}
                />
            }
        />
    );
};

export default GitLabFeatureDiscovery;
