import RHS from './components/rhs';

import manifest from '../../plugin.json';

// The subset of the host registry this plugin uses.
interface AppBarArgs {
    iconUrl: string;
    tooltipText: string;
    supportedProductIds: string[] | null;
    rhsComponent: unknown;
    rhsTitle: unknown;
}

interface PluginRegistry {
    registerAppBarComponent?: (args: AppBarArgs) => unknown;
    registerRightHandSidebarComponent: (component: unknown, title: unknown) => {showRHSPlugin: unknown; toggleRHSPlugin: unknown};
    registerChannelHeaderButtonAction: (icon: unknown, action: unknown, dropdownText: string, tooltipText: string) => unknown;
}

const TOOLTIP = 'Board Room';

const iconUrl = () => `${(window as any).basename || ''}/plugins/${manifest.id}/public/icon.svg`;

class BoardRoomPlugin {
    initialize(registry: PluginRegistry, store: any) {
        // The App Bar is the icon rail on the right in recent Mattermost
        // versions; it wires its own RHS toggle for us. If it's turned off,
        // fall back to a channel header button driving the same panel.
        if (registry.registerAppBarComponent) {
            registry.registerAppBarComponent({
                iconUrl: iconUrl(),
                tooltipText: TOOLTIP,
                supportedProductIds: null,
                rhsComponent: RHS,
                rhsTitle: TOOLTIP,
            });
            return;
        }

        const {toggleRHSPlugin} = registry.registerRightHandSidebarComponent(RHS, TOOLTIP);
        registry.registerChannelHeaderButtonAction(
            <img
                src={iconUrl()}
                width={16}
                height={16}
                alt=''
            />,
            () => store.dispatch(toggleRHSPlugin),
            TOOLTIP,
            TOOLTIP,
        );
    }
}

declare global {
    interface Window {
        registerPlugin(pluginId: string, plugin: BoardRoomPlugin): void;
    }
}

window.registerPlugin(manifest.id, new BoardRoomPlugin());
