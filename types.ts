export interface RoofrEvent {
  start: string; // ISO-like local date string e.g. "2025-11-03T08:00"
  end: string;   // ISO-like local date string
  title: string;
  notes?: string;
  address?: string;
}

export type Region = 'PHX' | 'NORTH' | 'SOUTH' | 'ALL';
export type Tab = 'Scanner' | 'People' | 'Job Sorting';

export type BlockKey = 'B1' | 'B2' | 'B3' | 'B4';

export interface Block {
    key: BlockKey;
    label: string;
    start: Date;
    end: Date;
}

export type Availability = Record<BlockKey, number[]>;

export interface FindStats {
    count: number;
    index: number;
}

export interface CityTally {
    total: number;
    perBlock: Record<BlockKey, number>;
}

export interface DailyTotals {
    booked: number;
    capacity: number;
    netAvailable: number;
    perBlockBooked: Record<BlockKey, number>;
    perBlockRemaining: Record<BlockKey, number | null>;
    dayOver: number;
}

export interface PeopleListProps {
    title: string;
    names: string[];
    onNameClick: (name: string) => void;
}

export interface DayCardProps {
    dateStr: string;
    events: RoofrEvent[];
    availability: Record<Region, Availability | null>;
    region: Region;
    addressCities: string[];
    isRecommended: boolean;
    recommendedBlockKey: BlockKey | null;
    isToday: boolean;
    isPast: boolean;
}

export type Theme = 'light' | 'dark' | 'ocean' | 'forest' | 'desert' | 'arctic' | 'savanna' | 'jungle';

export interface Settings {
    NEXT_SHEET_ID: string;
    AVAIL_RANGE_PHX: string;
    AVAIL_RANGE_NORTH: string;
    AVAIL_RANGE_SOUTH: string;
    theme?: Theme;
}

export interface ParsedJob {
    id: string;
    event: RoofrEvent;
    city: string;
    address: string;
    hashTags: number;
    jobType: string;
    rawTags: string[];
    roofType: string;
    roofAge: string;
    stories: string;
    sqft: string;
    day: string;
    time: string;
}