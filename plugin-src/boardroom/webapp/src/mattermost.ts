import {UserProfile} from './types';

/**
 * Thin access to the host server's own API and Redux state. The plugin renders
 * inside the webapp's store Provider, so the standard entity shape is
 * available to useSelector.
 */

const apiBase = () => `${(window as any).basename || ''}/api/v4`;

async function coreRequest<T>(path: string): Promise<T> {
    const response = await fetch(apiBase() + path, {
        credentials: 'include',
        headers: {'X-Requested-With': 'XMLHttpRequest'},
    });
    if (!response.ok) {
        throw new Error(`Failed to load users (${response.status}).`);
    }
    return response.json();
}

export const currentUserId = (state: any): string => state.entities.users.currentUserId;
export const currentTeamId = (state: any): string => state.entities.teams.currentTeamId;

export function userById(state: any, userId: string): UserProfile | undefined {
    return state.entities.users.profiles?.[userId];
}

/** A person's display name, falling back through the fields Mattermost may not have. */
export function displayName(user?: UserProfile): string {
    if (!user) {
        return 'Unknown user';
    }
    const full = `${user.first_name || ''} ${user.last_name || ''}`.trim();
    return full || user.nickname || user.username;
}

export function avatarUrl(userId: string): string {
    return `${apiBase()}/users/${userId}/image?_=0`;
}

/**
 * Active, human members of a team. Deactivated accounts and bots are filtered
 * out so they can't be booked into a meeting.
 */
export async function fetchTeamMembers(teamId: string): Promise<UserProfile[]> {
    const users = await coreRequest<UserProfile[]>(
        `/users?in_team=${encodeURIComponent(teamId)}&active=true&per_page=200`,
    );
    return users.filter((u) => !u.is_bot && u.delete_at === 0);
}

export async function fetchProfilesByIds(userIds: string[]): Promise<UserProfile[]> {
    if (userIds.length === 0) {
        return [];
    }
    const response = await fetch(`${apiBase()}/users/ids`, {
        method: 'POST',
        credentials: 'include',
        headers: {
            'Content-Type': 'application/json',
            'X-Requested-With': 'XMLHttpRequest',
        },
        body: JSON.stringify(userIds),
    });
    if (!response.ok) {
        return [];
    }
    return response.json();
}
