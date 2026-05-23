# How the Roofr Calendar Scraper Works

## Overview
The Chrome extension extracts calendar event data from Roofr's calendar interface by reading the DOM (Document Object Model) and parsing event information from HTML elements.

## Architecture Components

### 1. Content Script (content.js)
- **Injected into:** Roofr calendar pages (`*://roofr.com/*`)
- **Purpose:** Reads and interacts with the calendar DOM
- **Key responsibility:** Extract event data from HTML elements

### 2. Popup Script (popup.js)
- **Runs in:** Extension side panel UI
- **Purpose:** Orchestrates scanning, formats data, displays results
- **Key responsibility:** Send commands to content script, process results

### 3. Communication Flow
```
popup.js → Chrome Message API → content.js
         ↓
    Read Roofr DOM
         ↓
    Extract events
         ↓
popup.js ← Event data ← content.js
         ↓
    Format & Display
```

---

## How Event Extraction Works

### Step 1: Find Event Elements

**Location:** `content.js` - `getAllEventNodes()` function (line 1427)

```javascript
function getAllEventNodes() {
  return Array.from(document.querySelectorAll(".rbc-event"));
}
```

**What it does:**
- Roofr uses React Big Calendar library
- All calendar events have the CSS class `.rbc-event`
- This function finds ALL event elements on the currently visible calendar view
- Returns an array of DOM elements

**Important:** This only finds events that are currently rendered in the DOM. Hidden weeks/days won't be captured.

---

### Step 2: Extract Event Title

**Location:** `content.js` - `getTitle()` function (line 1296)

```javascript
function getTitle(el) {
  const t = el.querySelector(".rbc-event-content");
  return t ? t.textContent.trim() : "";
}
```

**What it does:**
- Looks for child element with class `.rbc-event-content`
- Extracts the text content (the event title/description)
- Examples:
  - "PHOENIX - 1234 Main St - Roof Age 15yr"
  - "CHANDLER - 5678 Oak Ave - Tile 1s 2,690"

---

### Step 3: Extract Date from Element

**Location:** `content.js` - `parseDateFromClass()` function (line 1265)

```javascript
function parseDateFromClass(cls) {
  const m = cls.match(/-(\d{2})-(\d{2})-(\d{4})--/);
  if (!m) return null;
  return new Date(+m[3], +m[2] - 1, +m[1]);
}
```

**What it does:**
- React Big Calendar adds date information to element class names
- Pattern: `-DD-MM-YYYY--` (e.g., `-23-01-2026--`)
- Extracts: day, month, year from the class string
- Returns a JavaScript Date object

**Example:**
```html
<div class="rbc-event ... -23-01-2026-- ...">
  <!-- Event content -->
</div>
```
→ Extracts: January 23, 2026

---

### Step 4: Extract Time Range

**Location:** `content.js` - `extractTimes()` function (line 1277)

```javascript
function extractTimes(el) {
  const title = el.getAttribute("title") || "";
  const labelEl = el.querySelector(".rbc-event-label");
  const label = labelEl ? labelEl.textContent.trim() : "";
  const src = title || label;
  const tr = parseTimeRange(src);
  // ... time parsing logic
}
```

**What it does:**

1. **Looks in two places for time information:**
   - Element's `title` attribute
   - `.rbc-event-label` element's text content

2. **Searches for time range pattern:**
   ```javascript
   const m = str.match(/(\d{1,2}(?::\d{2})?\s*[AP]M)\s*[–-]\s*(\d{1,2}(?::\d{2})?\s*[AP]M)/i);
   ```
   - Matches: "9:00 AM - 10:30 AM" or "9 AM - 10 AM"
   - Handles various dash types (hyphen, en-dash, em-dash)

3. **Converts 12-hour to 24-hour format:**
   ```javascript
   function parseTime12h(s) {
     const m = s.match(/(\d{1,2})(?::(\d{2}))?\s*([AP]M)/i);
     let h = +m[1], min = m[2] ? +m[2] : 0;
     if (h === 12) h = 0;
     if (m[3].toUpperCase() === "PM") h += 12;
     return { h, min };
   }
   ```

4. **For events WITHOUT times (all-day events):**
   - Sets start: 00:00 (midnight)
   - Sets end: 23:59 (11:59 PM)
   - Marks `isAllDay: true`

**Examples:**

| Event Type | Time in DOM | Extracted Result |
|------------|-------------|------------------|
| Timed appointment | "9:00 AM - 10:30 AM" | start: 9:00, end: 10:30, isAllDay: false |
| All-day dropoff | No time text | start: 00:00, end: 23:59, isAllDay: true |
| Production job | "1:00 PM - 4:00 PM" | start: 13:00, end: 16:00, isAllDay: false |

---

### Step 5: Combine into Event Objects

**Location:** `content.js` - Message handler for `EXTRACT_ROOFR_EVENTS` (line 1771)

```javascript
if (msg.type === "EXTRACT_ROOFR_EVENTS") {
  const nodes = getAllEventNodes();
  const events = nodes.map(el => {
    const { start, end, isAllDay } = extractTimes(el);
    return { start, end, title: getTitle(el), isAllDay: isAllDay || false };
  }).filter(e => e.start && e.end);
  sendResponse({ ok: true, events });
  return true;
}
```

**What it does:**
- Maps each DOM element to an event object
- Filters out events with invalid dates (no start or end)
- Returns array of events with structure:
  ```javascript
  {
    start: "2026-01-23T09:00:00",  // ISO 8601 local time
    end: "2026-01-23T10:30:00",
    title: "PHOENIX - 1234 Main St - Roof Age 15yr",
    isAllDay: false
  }
  ```

---

## Event Type Filtering

### Sales Events (Default)

**Location:** `content.js` - `selectSalesEventType()` function (line 3813)

**How it works:**
1. Searches for text "Sales" in the calendar sidebar
2. Walks up DOM tree (up to 5 parent levels)
3. Looks for checkbox input
4. Clicks checkbox if unchecked
5. Returns success/failure status

**DOM Structure it looks for:**
```html
<div class="cursor-pointer">
  <input type="checkbox" checked />
  <span>Sales</span>
  <div class="color-badge"></div>
</div>
```

### Production Events (New Feature)

**Location:** `content.js` - `selectProductionEventTypes()` function (line 4079)

**What it does:**
1. **Unchecks "Sales"** using `uncheckEventType('Sales')`
2. **Checks three production types:**
   - "Dropoffs and pickups"
   - "Production"
   - "Post-production"
3. Waits 500ms for calendar to re-render
4. Extracts events with production filters active

---

## All-Day Event Detection

### In Content Script (content.js)

**Detection method:**
- If no time range found in event label/title → `isAllDay: true`
- Sets start: `00:00:00`, end: `23:59:59`

### In Popup Script (popup.js)

**Location:** `isAllDayEvent()` function (line 2005)

**Multiple detection methods:**
1. **Explicit flag:** `event.isAllDay === true`
2. **Duration check:** >= 23 hours
3. **Time check:** 00:00 to 23:59 or 00:00 to 00:00
4. **Null check:** Missing start or end

---

## Why All-Day Events Can Be Tricky

### Roofr's Calendar Structure

React Big Calendar has two main sections:
1. **All-day row** at the top of each day
2. **Time grid** below with hourly slots

**Potential issues:**
- All-day events might be in separate container (`.rbc-allday-cell`)
- They might not have `.rbc-event` class
- They might have different attribute structure

### Current Implementation

**What we do:**
- Look for ALL `.rbc-event` elements
- Check if they have time ranges in their labels
- If no time → mark as all-day
- Set to midnight-to-midnight span

**Why dropoffs might not appear:**
- If Roofr renders them in a different DOM structure
- If they don't have `.rbc-event` class
- If the date isn't in the class name pattern we expect

---

## Debugging Tips

### To see what events are found:

1. Open Chrome DevTools (F12)
2. Go to Console tab
3. Run in console:
   ```javascript
   document.querySelectorAll('.rbc-event').length
   ```
   This shows total event count

4. Inspect an event element:
   ```javascript
   let el = document.querySelector('.rbc-event');
   console.log('Title attr:', el.getAttribute('title'));
   console.log('Class:', el.className);
   console.log('Label:', el.querySelector('.rbc-event-label')?.textContent);
   ```

### To check all-day events specifically:

1. In console:
   ```javascript
   let allDayEvents = Array.from(document.querySelectorAll('.rbc-event'))
     .filter(el => {
       let label = el.querySelector('.rbc-event-label')?.textContent || '';
       return !label.match(/\d{1,2}:\d{2}\s*[AP]M/);
     });
   console.log('All-day events found:', allDayEvents.length);
   allDayEvents.forEach(el => console.log(el.textContent));
   ```

### To check for events in all-day container:

```javascript
document.querySelectorAll('.rbc-allday-cell .rbc-event')
```

---

## Production Week Copy Flow

```
User clicks "Copy Production Week" button
    ↓
1. Send SELECT_PRODUCTION_EVENT_TYPES message
    ↓
   content.js: Uncheck "Sales"
   content.js: Check "Dropoffs and pickups"
   content.js: Check "Production"
   content.js: Check "Post-production"
    ↓
2. Wait 500ms (let calendar re-render)
    ↓
3. Send EXTRACT_ROOFR_EVENTS message
    ↓
   content.js: Find all .rbc-event elements
   content.js: Extract times, titles, dates
   content.js: Return events array
    ↓
4. Format in popup.js
   - Group by day
   - Separate all-day vs timed events
   - Sort timed events chronologically
   - Format: "8:00am - 12:00pm - Title"
    ↓
5. Copy to clipboard
    ↓
6. Show "Copied!" feedback
```

---

## Known Limitations

1. **Only scans visible calendar range**
   - If calendar shows Jan 19-25, only those dates are scanned
   - Need to navigate to other weeks manually

2. **Requires event filter selection**
   - Must have correct event types checked
   - Hidden event types won't be extracted

3. **Depends on Roofr's DOM structure**
   - If Roofr updates their UI, selectors may break
   - Uses React Big Calendar classes (`.rbc-*`)

4. **All-day event edge cases**
   - If rendered outside `.rbc-event` elements
   - If date not in class name
   - If in different container structure

---

## Future Improvements

1. **Better all-day event detection:**
   - Check `.rbc-allday-cell` container
   - Look for events in header row
   - Parse from different DOM structures

2. **Multi-week scanning:**
   - Auto-navigate through weeks
   - Aggregate events from multiple views

3. **Event type auto-detection:**
   - Parse event type from title/tags
   - Don't rely solely on filter selection

4. **Roofr API integration:**
   - Direct API calls instead of DOM scraping
   - More reliable, faster, complete data
