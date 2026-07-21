import {Booking, RoomConfig} from '../types';

export const MINUTES_IN_DAY = 24 * 60;

/** "2026-07-17" for a local date, avoiding the UTC shift of toISOString(). */
export function toDateString(date: Date): string {
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${date.getFullYear()}-${month}-${day}`;
}

export function todayString(): string {
    return toDateString(new Date());
}

/** Parses "2026-07-17" as a local date. `new Date(str)` would treat it as UTC. */
export function fromDateString(value: string): Date {
    const [year, month, day] = value.split('-').map(Number);
    return new Date(year, month - 1, day);
}

export function addDays(value: string, days: number): string {
    const date = fromDateString(value);
    date.setDate(date.getDate() + days);
    return toDateString(date);
}

export function formatMinute(minute: number): string {
    const hours = Math.floor(minute / 60);
    const mins = minute % 60;
    return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

export function formatRange(start: number, end: number): string {
    return `${formatMinute(start)} – ${formatMinute(end)}`;
}

export function formatDuration(minutes: number): string {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    if (hours && mins) {
        return `${hours}h ${mins}m`;
    }
    return hours ? `${hours}h` : `${mins}m`;
}

export function formatDateHeading(value: string): string {
    return fromDateString(value).toLocaleDateString(undefined, {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
    });
}

/** "Today"/"Tomorrow" where it helps, otherwise a short date. */
export function formatDateShort(value: string): string {
    if (value === todayString()) {
        return 'Today';
    }
    if (value === addDays(todayString(), 1)) {
        return 'Tomorrow';
    }
    return fromDateString(value).toLocaleDateString(undefined, {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
    });
}

export function isPastDate(value: string): boolean {
    return value < todayString();
}

export function isPastBooking(booking: Booking): boolean {
    const today = todayString();
    if (booking.date < today) {
        return true;
    }
    if (booking.date === today) {
        const now = new Date();
        const currentMinute = (now.getHours() * 60) + now.getMinutes();
        return currentMinute >= booking.end_minute;
    }
    return false;
}

/** Every selectable start time within the room's opening hours. */
export function slotOptions(config: RoomConfig): number[] {
    const slots: number[] = [];
    const end = config.closing_hour * 60;
    for (let m = config.opening_hour * 60; m < end; m += config.slot_minutes) {
        slots.push(m);
    }
    return slots;
}

/** Valid end times for a booking starting at `start`. */
export function endOptions(config: RoomConfig, start: number): number[] {
    const slots: number[] = [];
    const end = config.closing_hour * 60;
    for (let m = start + config.slot_minutes; m <= end; m += config.slot_minutes) {
        slots.push(m);
    }
    return slots;
}

/**
 * The first booking colliding with the given slot, ignoring `ignoreId` so an
 * edit doesn't clash with itself. Mirrors the server's rule: touching
 * intervals are fine.
 */
export function findConflict(
    bookings: Booking[],
    date: string,
    start: number,
    end: number,
    ignoreId?: string,
): Booking | undefined {
    return bookings.find((b) =>
        b.id !== ignoreId &&
        b.date === date &&
        start < b.end_minute &&
        end > b.start_minute);
}

/** Start times that are already fully spoken for, used to grey out the picker. */
export function takenStarts(bookings: Booking[], config: RoomConfig, date: string, ignoreId?: string): Set<number> {
    const taken = new Set<number>();
    for (const start of slotOptions(config)) {
        const slotEnd = start + config.slot_minutes;
        if (findConflict(bookings, date, start, slotEnd, ignoreId)) {
            taken.add(start);
        }
    }
    return taken;
}
