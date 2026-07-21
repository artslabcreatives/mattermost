export interface Booking {
    id: string;
    team_id: string;
    title: string;
    host_id: string;
    participant_ids: string[];
    date: string;
    start_minute: number;
    end_minute: number;
    notes: string;
    created_by: string;
    create_at: number;
    update_at: number;
    google_event_id?: string;

    /** 'synced' | 'failed' | 'off'. Absent on bookings made before sync existed. */
    sync_state?: string;
    sync_error?: string;
}

export interface RoomConfig {
    opening_hour: number;
    closing_hour: number;
    slot_minutes: number;
    room_name: string;
}

/** The fields a user actually fills in; the server owns everything else. */
export interface BookingDraft {
    team_id: string;
    title: string;
    host_id: string;
    participant_ids: string[];
    date: string;
    start_minute: number;
    end_minute: number;
    notes: string;
}

/**
 * A failed request. `conflict` is present only on a 409 and carries the
 * booking already holding the slot.
 */
export class ApiError extends Error {
    status: number;
    conflict?: Booking;

    constructor(message: string, status: number, conflict?: Booking) {
        super(message);
        this.name = 'ApiError';
        this.status = status;
        this.conflict = conflict;
    }
}

export interface UserProfile {
    id: string;
    username: string;
    first_name: string;
    last_name: string;
    nickname: string;
    delete_at: number;
    is_bot?: boolean;
}
