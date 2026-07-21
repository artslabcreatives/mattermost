import {ApiError, Booking, BookingDraft, RoomConfig} from './types';

const PLUGIN_ID = 'com.artslabcreatives.boardroom';

/**
 * Requests carry the user's existing Mattermost session cookie, which is what
 * lets the panel work without any login of its own.
 */
const base = () => `${(window as any).basename || ''}/plugins/${PLUGIN_ID}/api/v1`;

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const response = await fetch(base() + path, {
        ...options,
        credentials: 'include',
        headers: {
            'Content-Type': 'application/json',
            'X-Requested-With': 'XMLHttpRequest',
            ...options.headers,
        },
    });

    if (response.status === 204) {
        return undefined as T;
    }

    // An error body is JSON by contract, but a proxy or gateway can still
    // return HTML, so failing to parse must not mask the real status.
    let body: any = null;
    try {
        body = await response.json();
    } catch {
        body = null;
    }

    if (!response.ok) {
        const message = body?.message || `Something went wrong (${response.status}).`;
        throw new ApiError(message, response.status, body?.conflict);
    }
    return body as T;
}

export const fetchConfig = () => request<RoomConfig>('/config');

export const fetchBookings = (teamId: string, from: string, to: string) =>
    request<Booking[]>(`/bookings?team_id=${encodeURIComponent(teamId)}&from=${from}&to=${to}`);

export const createBooking = (draft: BookingDraft) =>
    request<Booking>('/bookings', {method: 'POST', body: JSON.stringify(draft)});

export const updateBooking = (id: string, draft: BookingDraft) =>
    request<Booking>(`/bookings/${id}`, {method: 'PUT', body: JSON.stringify(draft)});

export const deleteBooking = (id: string) =>
    request<void>(`/bookings/${id}`, {method: 'DELETE'});
