// Fix: Declare chrome as a global to fix TypeScript errors related to missing type definitions.
declare const chrome: any;

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { RoofrEvent, Region, BlockKey, Availability, FindStats, Block, CityTally, DailyTotals, Tab, PeopleListProps, DayCardProps, Settings, ParsedJob, Theme } from './types';
import { CONFIG, PEOPLE_DATA } from './config';
import { applyTheme } from './themes';

// --- HELPER FUNCTIONS ---

const toISO = (d: Date): string => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const startOfDay = (d: Date): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const localDayKey = (isoLocal: string): string => isoLocal.substring(0, 10);
const weekIsoDatesFromSunday = (sISO: string): string[] => {
    if (!sISO) return [];
    const [y, m, d] = sISO.split("-").map(Number);
    const base = new Date(y, m - 1, d);
    return Array.from({ length: 7 }, (_, i) => toISO(new Date(base.getFullYear(), base.getMonth(), base.getDate() + i)));
};

// --- API SERVICE (Chrome and Sheets) ---

const api = {
    async sendMessage<T,>(payload: object): Promise<T | null> {
        let tabId: number | undefined;
        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (!tab || !tab.id || !tab.url) {
                console.warn("Could not find active tab or tab URL.");
                return null;
            }

            if (tab.url.startsWith('chrome://') || tab.url.startsWith('about:')) {
                console.warn(`Cannot access restricted URL: ${tab.url}`);
                return null;
            }

            tabId = tab.id;
            return await chrome.tabs.sendMessage(tabId, payload);
        } catch (e: any) {
            if (e.message && e.message.includes('Receiving end does not exist')) {
                console.log("Content script not ready. Injecting and retrying...");
                if (!tabId) return null;
                try {
                    await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
                    await new Promise(resolve => setTimeout(resolve, 100));
                    return await chrome.tabs.sendMessage(tabId, payload);
                } catch (retryError) {
                    console.error("Failed to send message after injecting content script:", retryError);
                    return null;
                }
            }
            console.warn("Failed to send message to content script:", e);
            return null;
        }
    },
    async discoverWeeklyTabName(apiKey: string, sheetId: string, forDate: Date): Promise<string | null> {
        const dayOfWeek = forDate.getUTCDay();
        const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
        const monday = new Date(forDate);
        monday.setUTCDate(forDate.getUTCDate() + diffToMonday);

        const sunday = new Date(monday);
        sunday.setUTCDate(monday.getUTCDate() + 6);

        const fmt = (d: Date, pad: boolean) => {
             const m = d.getUTCMonth() + 1;
             const day = d.getUTCDate();
             return pad ? `${String(m).padStart(2, '0')}/${String(day).padStart(2, '0')}` : `${m}/${day}`;
        };
        
        const rangePadded = `${fmt(monday, true)}-${fmt(sunday, true)}`;
        const rangeSimple = `${fmt(monday, false)}-${fmt(sunday, false)}`;

        const metaUrl = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}?fields=sheets.properties.title&key=${encodeURIComponent(apiKey)}`;
        try {
            const res = await fetch(metaUrl);
            if (!res.ok) throw new Error(`API error ${res.status}`);
            const data = await res.json();
            const allSheets = data.sheets || [];
            
            for (const sheet of allSheets) {
                const title = (sheet?.properties?.title || "");
                if (title.includes(rangePadded) || title.includes(rangeSimple)) {
                    console.log(`Discovered tab "${title}" for date range ${rangePadded} or ${rangeSimple}`);
                    return title;
                }
            }
            console.warn(`No matching tab found for range: ${rangePadded} or ${rangeSimple}`);
            return null;
        } catch (e) {
            console.error(`Error during tab discovery:`, e);
            return null;
        }
    },
    async fetchSheetCapacities(apiKey: string, sheetId: string, ranges: any, tabName: string) {
        if (!apiKey || !sheetId || !tabName) return null;
        const qTab = `'${tabName.replace(/'/g, "''")}'`;
        let url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}/values:batchGet?key=${encodeURIComponent(apiKey)}`;
        [ranges.phxRange, ranges.southRange, ranges.northRange].forEach(r => {
            if (r) url += `&ranges=${encodeURIComponent(`${qTab}!${r}`)}`;
        });
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) {
            console.error("Google Sheets API Error:", await res.text());
            return null;
        }
        const data = await res.json();
        return {
            PHX: this.parseTotalsRange(data.valueRanges?.[0]?.values || []),
            SOUTH: this.parseTotalsRange(data.valueRanges?.[1]?.values || []),
            NORTH: this.parseTotalsRange(data.valueRanges?.[2]?.values || []),
        };
    },
    parseTotalsRange(values: string[][]): Availability | null {
        if (!Array.isArray(values) || !values.length) return null;
        let headerRow = values.findIndex(row => String(row?.[0] || "").trim().toUpperCase() === "APPOINTMENT BLOCKS");
        if (headerRow < 0) return null;
        
        const map: Availability = { B1: [], B2: [], B3: [], B4: [] };
        const blockKeys: BlockKey[] = ["B1", "B2", "B3", "B4"];

        for (let i = 0; i < 4; i++) {
            const row = values[headerRow + 1 + i] || [];
            for (let c = 1; c <= 7; c++) {
                const raw = row[c] ?? "";
                const n = parseInt(String(raw).replace(/[^0-9-]/g, ""), 10);
                map[blockKeys[i]].push(Number.isFinite(n) ? n : 0);
            }
        }
        return map;
    },
};

// --- UI COMPONENTS ---

const PeopleList: React.FC<PeopleListProps> = ({ title, names, onNameClick }) => (
    <div className="p-4 theme-card border rounded-2xl shadow-sm">
        <h3 className="text-lg font-bold mb-3 theme-text-primary">{title}</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
            {names.map(name => (
                <button
                    key={name}
                    onClick={() => onNameClick(name)}
                    className="w-full text-center p-2 theme-bg-tertiary theme-hover-bg theme-border border rounded-lg text-sm font-semibold theme-text-secondary transition-colors duration-150"
                >
                    {name}
                </button>
            ))}
        </div>
    </div>
);

const DayCard: React.FC<DayCardProps> = ({ dateStr, events, availability, region, addressCities, isRecommended, recommendedBlockKey, isToday, isPast }) => {
    const cardRef = useRef<HTMLDivElement>(null);
    const [isDayCollapsed, setDayCollapsed] = useState(true);
    const [areCitiesCollapsed, setCitiesCollapsed] = useState(true);

    useEffect(() => {
        setDayCollapsed(!isRecommended);
        if (isRecommended) {
            cardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }, [isRecommended]);

    const {
        totals,
        cityTally,
        uncategorizedEvents
    } = useMemo(() => {
        const dailyEvents = events.filter(ev => localDayKey(ev.start) === dateStr);
        const totals = CONFIG.computeDailyTotals(dateStr, dailyEvents, availability, region);
        const cityTally = CONFIG.buildCityTally(dateStr, dailyEvents);
        const uncategorizedEvents = dailyEvents.filter(ev => !CONFIG.getCityFromEvent(ev));
        return { totals, cityTally, uncategorizedEvents };
    }, [dateStr, events, availability, region]);

    const handleCityClick = (city: string) => {
        api.sendMessage({ type: "HIGHLIGHT_CITY", city });
        if (isDayCollapsed) setDayCollapsed(false);
    };

    const d = new Date(`${dateStr}T00:00:00`);
    const blocks = CONFIG.blockWindowForDate(d);

    const cityChips = Array.from(cityTally.entries())
        .sort((a, b) => b[1].total - a[1].total || a[0].localeCompare(b[0]));

    return (
        <div ref={cardRef} className={`day-card theme-card border rounded-2xl shadow-sm transition-all ${isToday ? 'ring-2 ring-offset-2' : ''} ${isPast ? 'p-3 mt-2 opacity-70 grayscale scale-[0.98]' : 'p-4 mt-3'}`} style={isToday ? { borderColor: 'var(--accent)' } : {}}>
            <div className="flex justify-between items-start gap-4">
                <div className="flex flex-col items-start gap-2">
                    <div className="flex items-center gap-3 flex-wrap">
                        <h2 className="text-lg font-extrabold theme-text-primary">
                            {d.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}
                        </h2>
                        {totals.dayOver > 0 && <span className="px-2 py-0.5 text-xs font-bold theme-error-bg rounded-full" style={{ color: 'var(--error)' }}>{totals.dayOver} over</span>}
                        {totals.netAvailable > 0 && <span className="px-2 py-0.5 text-xs font-bold theme-success-bg rounded-full" style={{ color: 'var(--success)' }}>{totals.netAvailable} available</span>}
                    </div>
                    <div className="flex items-center gap-4">
                        <button onClick={() => setDayCollapsed(c => !c)} className="text-xs font-semibold theme-text-muted hover:theme-accent-text">
                            {isDayCollapsed ? 'Expand Day ▸' : 'Collapse Day ▾'}
                        </button>
                        {cityChips.length > 0 && (
                            <button onClick={() => setCitiesCollapsed(c => !c)} className="text-xs font-semibold theme-text-muted hover:theme-accent-text">
                                {areCitiesCollapsed ? 'Show Cities ▸' : 'Hide Cities ▾'}
                            </button>
                        )}
                    </div>
                </div>
                <div className="text-right flex-shrink-0">
                    <div className="text-xs font-bold theme-text-muted">Capacity: {totals.capacity}</div>
                </div>
            </div>

            {cityChips.length > 0 && !isDayCollapsed && !areCitiesCollapsed && (
                <div className="mt-3">
                    <div className="flex flex-wrap gap-2">
                        {cityChips.map(([city, info]) => (
                            <button key={city} onClick={() => handleCityClick(city)} className={`flex items-center gap-2 px-2.5 py-1 text-xs font-bold rounded-full transition-all ${addressCities.includes(city) ? 'theme-warning-bg ring-2' : 'theme-bg-tertiary theme-text-secondary theme-hover-bg'}`} style={addressCities.includes(city) ? { color: 'var(--warning)', borderColor: 'var(--warning-border)' } : {}}>
                                {city}
                                <span className={`flex items-center justify-center w-4 h-4 text-[10px] rounded-full ${addressCities.includes(city) ? 'theme-warning-bg' : 'theme-border-light'}`} style={addressCities.includes(city) ? { backgroundColor: 'var(--warning-border)' } : { backgroundColor: 'var(--border-light)' }}>{info.total}</span>
                            </button>
                        ))}
                    </div>
                </div>
            )}
            
            {!isDayCollapsed && (
                <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
                    {blocks.map(block => {
                        const booked = totals.perBlockBooked[block.key] || 0;
                        const cap = CONFIG.getCapacity(region, d.getDay(), block.key, availability);
                        const remaining = cap !== null ? cap - booked : null;
                        const isOver = remaining !== null && remaining < 0;
                        const isRecommendedBlock = recommendedBlockKey === block.key;

                        return (
                            <div key={block.key} className={`block p-3 rounded-xl border transition-all ${isRecommendedBlock ? 'theme-warning-bg' : isOver ? 'theme-error-bg' : 'theme-bg-tertiary theme-border'}`}>
                                <div className="flex justify-between items-center text-sm">
                                    <span className="slot-label font-bold theme-text-primary">{block.label}</span>
                                    <span className="text-xs font-semibold theme-text-muted">Sheet: {cap ?? 'N/A'}</span>
                                </div>
                                <div className="mt-1 text-sm theme-text-secondary">
                                    {booked} booked.
                                    {remaining !== null && (
                                        <span className={`font-bold ml-1`} style={{ color: isOver ? 'var(--error)' : 'var(--success)' }}>
                                            {isOver ? `${Math.abs(remaining)} over` : `${remaining} remaining`}
                                        </span>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {!isDayCollapsed && uncategorizedEvents.length > 0 && (
                 <div className="mt-4 p-3 theme-error-bg rounded-xl">
                    <h4 className="font-bold text-sm" style={{ color: 'var(--error)' }}>Uncategorized ({uncategorizedEvents.length})</h4>
                    <ul className="mt-2 space-y-1 text-xs list-disc list-inside" style={{ color: 'var(--error)' }}>
                        {uncategorizedEvents.map((ev, i) => <li key={i}>{ev.title}</li>)}
                    </ul>
                </div>
            )}
        </div>
    );
};

const getTagColor = (tag: string): string => {
    const colors = [
        'bg-sky-100 text-sky-800 border-sky-200', 'bg-rose-100 text-rose-800 border-rose-200', 
        'bg-emerald-100 text-emerald-800 border-emerald-200', 'bg-violet-100 text-violet-800 border-violet-200',
        'bg-lime-100 text-lime-800 border-lime-200', 'bg-pink-100 text-pink-800 border-pink-200',
        'bg-cyan-100 text-cyan-800 border-cyan-200', 'bg-fuchsia-100 text-fuchsia-800 border-fuchsia-200',
    ];
    let hash = 0;
    if (tag.length === 0) return colors[0];
    for (let i = 0; i < tag.length; i++) {
        const char = tag.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32bit integer
    }
    const index = Math.abs(hash % colors.length);
    return colors[index];
};

const hashTagColors: { [key: number]: string } = {
    1: 'text-amber-500',
    2: 'text-amber-600',
    3: 'text-amber-700',
};

const JobItem: React.FC<{ job: ParsedJob }> = ({ job }) => {
    const hashTagClass = job.hashTags > 0 ? (hashTagColors[job.hashTags] || 'text-amber-800') : 'theme-text-muted';

    return (
        <div
            className="flex items-center p-2 theme-border border-b theme-hover-bg cursor-pointer"
            onClick={() => api.sendMessage({ type: 'HIGHLIGHT_EVENT', title: job.event.title, start: job.event.start })}
        >
            <div className="flex-grow flex flex-col gap-1.5 min-w-0">
                <div className="font-bold text-sm theme-text-primary truncate" title={job.address}>{job.address}</div>
                <div className="text-xs font-semibold theme-text-muted">{job.city}</div>
                
                <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs theme-text-secondary">
                    <span className="flex items-center gap-1.5" title="Priority">
                        <span className={`w-5 text-left font-mono font-extrabold text-sm ${hashTagClass}`}>{job.hashTags > 0 ? '#'.repeat(job.hashTags) : '–'}</span>
                    </span>
                    <span className="flex items-center gap-1.5" title="Roof Type">
                         <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="theme-text-muted"><path d="M2 15.5s2-1.5 4-1.5 4 1.5 4 1.5 2-1.5 4-1.5 4 1.5 4 1.5v4s-2-1.5-4-1.5-4 1.5-4-1.5-2-1.5-4-1.5-4 1.5-4 1.5zM2 8.5s2-1.5 4-1.5 4 1.5 4 1.5 2-1.5 4-1.5 4 1.5 4 1.5v4s-2-1.5-4-1.5-4 1.5-4-1.5-2-1.5-4-1.5-4 1.5-4 1.5z"/></svg>
                        <span>{job.roofType}</span>
                    </span>
                     <span className="flex items-center gap-1.5" title="Roof Age">
                        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="theme-text-muted"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                        <span>{job.roofAge !== 'Unknown' ? `${job.roofAge} yrs` : 'N/A'}</span>
                    </span>
                    <span className="flex items-center gap-1.5" title="Stories">
                        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="theme-text-muted"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
                        <span>{job.stories !== 'Unknown' ? `${job.stories}S` : 'N/A'}</span>
                    </span>
                </div>
                 {job.rawTags.length > 0 && (
                     <div className="flex flex-wrap gap-1 pt-1">
                        {job.rawTags.map(tag => (
                            <span key={tag} className={`px-1.5 py-0.5 text-[10px] font-bold rounded-full border ${getTagColor(tag)}`}>
                                {tag}
                            </span>
                        ))}
                    </div>
                )}
            </div>

            <div className="flex-shrink-0 ml-2 pl-2 border-l theme-border text-right flex flex-col justify-center w-[80px]">
                <div className="font-bold theme-text-primary">{job.day}</div>
                <div className="text-xs theme-text-muted">{job.time}</div>
            </div>
        </div>
    );
};


const JobSortingTab: React.FC<{ jobs: ParsedJob[] }> = ({ jobs }) => {
    const [filters, setFilters] = useState({
        hashTags: new Set<number>(),
        roofTypes: new Set<string>(),
        jobTypes: new Set<string>(),
        stories: new Set<string>(),
        cities: new Set<string>(),
        days: new Set<string>(),
        times: new Set<string>(),
    });

    const filterOptions = useMemo(() => {
        const options = {
            roofTypes: new Set<string>(),
            jobTypes: new Set<string>(),
            stories: new Set<string>(),
            cities: new Set<string>(),
            days: new Set<string>(),
            times: new Set<string>(),
        };
        jobs.forEach(job => {
            if (job.roofType !== 'Unknown') options.roofTypes.add(job.roofType);
            if (job.stories !== 'Unknown') options.stories.add(job.stories);
            if (job.city !== 'Unknown') options.cities.add(job.city);
            if (job.day) options.days.add(job.day);
            if (job.time) options.times.add(job.time);

            if (job.rawTags.length > 0) {
                job.rawTags.forEach(tag => options.jobTypes.add(tag));
            } else {
                options.jobTypes.add('Residential');
            }
        });
        return {
            roofTypes: [...options.roofTypes].sort(),
            jobTypes: ['Residential', ...[...options.jobTypes].filter(t => t !== 'Residential').sort()],
            stories: [...options.stories].sort(),
            cities: [...options.cities].sort(),
            days: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].filter(d => options.days.has(d)),
            times: ['7:30am-9am', '10am-12pm', '1pm-3pm', '4pm-6pm'].filter(t => options.times.has(t)),
        };
    }, [jobs]);

    const handleFilterChange = (filterType: keyof typeof filters, value: string | number) => {
        setFilters(prev => {
            const newSet = new Set(prev[filterType]);
            if (newSet.has(value as never)) {
                newSet.delete(value as never);
            } else {
                newSet.add(value as never);
            }
            return { ...prev, [filterType]: newSet };
        });
    };

    const filteredJobs = useMemo(() => {
        return jobs.filter(job => {
            if (filters.hashTags.size > 0 && !filters.hashTags.has(job.hashTags)) return false;
            if (filters.roofTypes.size > 0 && !filters.roofTypes.has(job.roofType)) return false;
            if (filters.stories.size > 0 && !filters.stories.has(job.stories)) return false;
            if (filters.cities.size > 0 && !filters.cities.has(job.city)) return false;
            if (filters.days.size > 0 && !filters.days.has(job.day)) return false;
            if (filters.times.size > 0 && !filters.times.has(job.time)) return false;
            if (filters.jobTypes.size > 0) {
                if (job.jobType === 'Residential') {
                    if (!filters.jobTypes.has('Residential')) return false;
                } else {
                    if (!job.rawTags.some(tag => filters.jobTypes.has(tag))) return false;
                }
            }
            return true;
        });
    }, [jobs, filters]);

    const renderCheckboxGroup = (title: string, options: string[], filterType: keyof typeof filters) => (
        <div className="p-2 border-b theme-border">
            <h4 className="font-bold text-xs theme-text-muted uppercase mb-2">{title}</h4>
            <div className="flex flex-wrap gap-2">
                {options.map(option => (
                    <label key={option} className="flex items-center gap-1.5 text-sm cursor-pointer theme-text-secondary">
                        <input type="checkbox" checked={filters[filterType].has(option as never)} onChange={() => handleFilterChange(filterType, option)} className="h-4 w-4 rounded border-gray-300 focus:ring-2" style={{ accentColor: 'var(--accent)' }} />
                        {option}
                    </label>
                ))}
            </div>
        </div>
    );

    return (
        <div className="flex flex-col h-[80vh]">
            <div className="flex-shrink-0 theme-card p-2 rounded-t-xl border-x border-t theme-border">
                <h3 className="font-bold text-lg mb-2 theme-text-primary">Job Filters ({filteredJobs.length} / {jobs.length})</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {renderCheckboxGroup("Roof Type", filterOptions.roofTypes, 'roofTypes')}
                    {renderCheckboxGroup("Job Type", filterOptions.jobTypes, 'jobTypes')}
                    {renderCheckboxGroup("City", filterOptions.cities, 'cities')}
                    {renderCheckboxGroup("Stories", filterOptions.stories, 'stories')}
                    {renderCheckboxGroup("Day", filterOptions.days, 'days')}
                    {renderCheckboxGroup("Time", filterOptions.times, 'times')}
                    <div className="p-2 border-b theme-border">
                      <h4 className="font-bold text-xs theme-text-muted uppercase mb-2">Tags</h4>
                      <div className="flex flex-wrap gap-2">
                          {[1, 2, 3].map(num => (
                              <label key={num} className="flex items-center gap-1.5 text-sm cursor-pointer theme-text-secondary">
                                  <input type="checkbox" checked={filters.hashTags.has(num)} onChange={() => handleFilterChange('hashTags', num)} className="h-4 w-4 rounded border-gray-300 focus:ring-2" style={{ accentColor: 'var(--accent)' }} />
                                  <span className="text-red-600 font-bold">{'#'.repeat(num)}+</span>
                              </label>
                          ))}
                      </div>
                    </div>
                </div>
            </div>
            <div className="flex-grow theme-card border theme-border rounded-b-xl overflow-y-auto">
                {filteredJobs.length > 0 ? (
                    filteredJobs.map(job => <JobItem key={job.id} job={job} />)
                ) : (
                    <div className="p-8 text-center theme-text-muted">No jobs match the current filters.</div>
                )}
            </div>
        </div>
    );
};


// --- MAIN APP COMPONENT ---

export default function App() {
    const [activeTab, setActiveTab] = useState<Tab>('Scanner');
    const [scanPerformed, setScanPerformed] = useState(false);
    const [settings, setSettings] = useState<Settings>({
        NEXT_SHEET_ID: "",
        AVAIL_RANGE_PHX: "B4:H200",
        AVAIL_RANGE_NORTH: "B4:H200",
        AVAIL_RANGE_SOUTH: "B4:H200",
        theme: "light",
    });
    const [isSettingsLoaded, setIsSettingsLoaded] = useState(false);
    const [allEvents, setAllEvents] = useState<RoofrEvent[]>([]);
    const [parsedJobs, setParsedJobs] = useState<ParsedJob[]>([]);
    const [availability, setAvailability] = useState<Record<Region, Availability | null>>({ PHX: null, NORTH: null, SOUTH: null, ALL: null });
    const [dataSundayISO, setDataSundayISO] = useState<string | null>(null);
    const [pageSundayISO, setPageSundayISO] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [findStats, setFindStats] = useState<FindStats>({ count: 0, index: 0 });
    const findInputRef = useRef<HTMLInputElement>(null);
    const [address, setAddress] = useState('');
    const [addressCities, setAddressCities] = useState<string[]>([]);
    const [currentRegion, setCurrentRegion] = useState<Region>('PHX');
    const [recommendedSlot, setRecommendedSlot] = useState<{ dateStr: string; blockKey: BlockKey } | null>(null);
    
    useEffect(() => {
        if (chrome.storage && chrome.storage.sync) {
            chrome.storage.sync.get(settings, (loadedSettings: Settings) => {
                setSettings(loadedSettings);
                setIsSettingsLoaded(true);
                // Apply theme on load
                const theme = loadedSettings.theme || 'light';
                applyTheme(theme as Theme);
            });
        }

        const handleMessage = (msg: any) => {
            if (msg.type === "ROOFR_WEEK_CHANGED" && msg.sundayISO) {
                setPageSundayISO(msg.sundayISO);
            }
        };

        if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
            chrome.runtime.onMessage.addListener(handleMessage);
        }

        return () => {
            if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
                chrome.runtime.onMessage.removeListener(handleMessage);
            }
        };

    }, []);

    const isOutOfSync = pageSundayISO && dataSundayISO && pageSundayISO !== dataSundayISO;
    const todayISO = useMemo(() => toISO(startOfDay(new Date())), []);
    const weekDays = useMemo(() => dataSundayISO ? weekIsoDatesFromSunday(dataSundayISO) : [], [dataSundayISO]);
    const filteredEvents = useMemo(() => allEvents.filter(e => CONFIG.passesRegion(e, currentRegion)), [allEvents, currentRegion]);
    const grandTotalBooked = useMemo(() => {
        if (!dataSundayISO) return 0;
        return weekDays.reduce((acc, dateStr) => {
            const dailyEvents = allEvents.filter(ev => localDayKey(ev.start) === dateStr);
            const totals = CONFIG.computeDailyTotals(dateStr, dailyEvents, availability, 'ALL');
            return acc + totals.booked;
        }, 0);
    }, [allEvents, weekDays, availability, dataSundayISO]);

    const fetchAvailabilityForWeek = useCallback(async (sundayISO: string) => {
        const apiKey = CONFIG.apiKey;
        const sheetId = settings.NEXT_SHEET_ID;
        if (!apiKey || !sheetId) return;

        const customRanges = {
            phxRange: settings.AVAIL_RANGE_PHX,
            southRange: settings.AVAIL_RANGE_SOUTH,
            northRange: settings.AVAIL_RANGE_NORTH,
        };
        const sunDate = new Date(`${sundayISO}T12:00:00Z`);
        const mondayDate = new Date(sunDate);
        mondayDate.setUTCDate(sunDate.getUTCDate() + 1);
        const primaryTabName = await api.discoverWeeklyTabName(apiKey, sheetId, mondayDate);
        const secondaryTabName = await api.discoverWeeklyTabName(apiKey, sheetId, sunDate);
        const [primaryData, secondaryData] = await Promise.all([
            primaryTabName ? api.fetchSheetCapacities(apiKey, sheetId, customRanges, primaryTabName) : Promise.resolve(null),
            secondaryTabName ? api.fetchSheetCapacities(apiKey, sheetId, customRanges, secondaryTabName) : Promise.resolve(null)
        ]);

        if (!primaryData && !secondaryData) {
            setAvailability({ PHX: null, NORTH: null, SOUTH: null, ALL: null });
            alert("Could not find a valid weekly tab in your Google Sheet for the selected week.");
            return;
        }

        const combined: Record<Region, Availability | null> = { PHX: null, NORTH: null, SOUTH: null, ALL: null };
        const regions: Region[] = ['PHX', 'NORTH', 'SOUTH'];
        for (const region of regions) {
            const pData = primaryData?.[region];
            const sData = secondaryData?.[region];
            if (!pData && !sData) continue;
            
            const newAvail: Availability = { B1: [], B2: [], B3: [], B4: [] };
            const blockKeys: BlockKey[] = ['B1', 'B2', 'B3', 'B4'];
            for (const key of blockKeys) {
                for (let i = 0; i < 6; i++) { newAvail[key][i] = pData?.[key]?.[i] ?? 0; }
                newAvail[key][6] = sData?.[key]?.[6] ?? 0;
            }
            combined[region] = newAvail;
        }
        combined.ALL = CONFIG.sumMaps(CONFIG.sumMaps(combined.PHX, combined.SOUTH), combined.NORTH);
        setAvailability(combined);
    }, [settings]);

    const handleScanPage = useCallback(async () => {
        if (!settings.NEXT_SHEET_ID) {
            alert("Configuration Needed: Please set your Google Sheet ID in the extension's options page.");
            return;
        }
        setIsLoading(true);
        setRecommendedSlot(null);
        setAddressCities([]);

        const roofrData = await api.sendMessage<{ ok: boolean; sundayISO?: string }>({ type: 'GET_VISIBLE_WEEK' });
        const sunday = roofrData?.sundayISO;

        if (!sunday) {
            const visibleDates = await api.sendMessage<{ok: boolean, datesISO: string[]}>({type: "GET_VISIBLE_DATES"});
            if (visibleDates && visibleDates.datesISO.length > 0) {
              const firstDate = new Date(visibleDates.datesISO[0] + "T12:00:00Z");
              const dayOfWeek = firstDate.getUTCDay();
              const sundayDate = new Date(firstDate);
              sundayDate.setUTCDate(firstDate.getUTCDate() - dayOfWeek);
              const sundayISO = `${sundayDate.getUTCFullYear()}-${String(sundayDate.getUTCMonth() + 1).padStart(2, '0')}-${String(sundayDate.getUTCDate()).padStart(2, '0')}`;
              setDataSundayISO(sundayISO);
              setPageSundayISO(sundayISO);

              const eventData = await api.sendMessage<{ events: RoofrEvent[] }>({ type: 'EXTRACT_ROOFR_EVENTS' });
              setAllEvents(