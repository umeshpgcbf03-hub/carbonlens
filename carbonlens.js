  // ========================================
    // SECTION 1: CONSTANTS & EMISSION FACTORS
    // ========================================

    /** @type {Object.<string, number>} Emission factors (kg CO2e per unit) */
    const EF = Object.freeze({
        car: 0.21, bus: 0.089, train: 0.041, motorcycle: 0.113,
        flightShort: 0.256, flightLong: 0.195, walk: 0, bicycle: 0,
        electricityIndia: 0.82, electricityUS: 0.42, electricityUK: 0.23,
        electricityGlobal: 0.475, naturalGas: 2.0, lpg: 3.0,
        acPerHour: 1.23, heaterPerHour: 1.64,
        beefMeal: 6.61, chickenMeal: 1.58, fishMeal: 1.12,
        porkMeal: 2.34, vegMeal: 0.73, veganMeal: 0.39,
        clothingItem: 20, shoesPair: 14, smartphone: 70,
        laptop: 350, onlineDelivery: 1.8, electronicsOther: 150,
      });
  
      /** @type {Object.<string, number>} Benchmark values (tonnes CO2e per year) */
      const BENCHMARKS = Object.freeze({
        globalAvg: 4.7, indiaAvg: 1.9, usAvg: 15.5, ukAvg: 5.2, parisTarget: 2.0,
      });
  
      /** @type {Object.<string, number>} Relatable equivalents for contextualizing emissions */
      const EQUIVALENTS = Object.freeze({
        treeAbsorbMonthly: 1.8, phoneChargesPerKg: 100, drivingKmPerKg: 4.76,
      });
  
      /** @type {string[]} Supported activity categories */
      const CATEGORIES = ['transport', 'energy', 'food', 'consumption'];
  
      /** @type {Object.<string, string>} Human-readable category labels */
      const CATEGORY_LABELS = { transport: 'Transport', energy: 'Home Energy', food: 'Food & Diet', consumption: 'Consumption' };
  
      /** @type {Object.<string, string>} Category colors for charts and UI */
      const CATEGORY_COLORS = { transport: '#2D6A4F', energy: '#DDA15E', food: '#E07A5F', consumption: '#52B788' };
  
      /** @type {string[]} Full month names */
      const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  
      /** @type {Object.<string, number>} Application constants */
      const CONSTANTS = Object.freeze({
        storageWriteDelayMs: 180,
        chartDebounceMs: 180,
        virtualActivityLimit: 50,
        virtualActivityInitial: 30,
        undoLimit: 5,
      });
  
      /** @type {Object.<string, number>} Grid-specific electricity factors */
      const ELECTRICITY_FACTORS = Object.freeze({
        india: EF.electricityIndia,
        us: EF.electricityUS,
        uk: EF.electricityUK,
        global: EF.electricityGlobal,
      });
  
      // ========================================
      // SECTION 2: STATE MANAGEMENT
      // ========================================
  
      /** @const {string} localStorage key for application state */
      const STORAGE_KEY = 'carbonlens_data';
  
      /** @type {number|null} Debounce timer for state persistence */
      let _saveTimer = null;
  
      /** @type {Object|null} Pending state to be written to storage */
      let _pendingSaveState = null;
  
      /**
       * Returns the default application state object.
       * @returns {Object} Default state
       */
      function getDefaultState() {
        return {
          version: 1, profile: null, activities: [], recurringHabits: [],
          recommendationsCommitted: [], goals: null, badges: [],
          streak: { current: 0, best: 0, lastLogDate: null },
          educationRead: [],
          preferences: { theme: 'light', units: 'metric', electricityRegion: 'india', notifications: false },
          undoStack: [],
          reportPeriod: { month: new Date().getMonth(), year: new Date().getFullYear() },
          currentSection: 'dashboard', activityLogCategory: 'transport', insightsPeriod: 'monthly',
        };
      }
  
      /**
       * Loads application state from localStorage with safe parsing and fallback.
       * @returns {Object} Parsed state merged with defaults
       */
      function loadState() {
        try {
          const raw = localStorage.getItem(STORAGE_KEY);
          if (!raw) return getDefaultState();
          const parsed = JSON.parse(raw);
          const defaults = getDefaultState();
          return { ...defaults, ...parsed, preferences: { ...defaults.preferences, ...(parsed.preferences || {}) } };
        } catch (e) { console.warn('Failed to load state:', e); return getDefaultState(); }
      }
  
      /**
       * Flushes any pending state to localStorage immediately.
       * Used before page unload or critical operations.
       */
      function flushState() {
        if (!_pendingSaveState) return;
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(_pendingSaveState)); _pendingSaveState = null; }
        catch (e) { console.warn('Failed to save state:', e); showToast('Could not save - storage may be full.', 'warning'); }
      }
  
      /**
       * Schedules state persistence with debounce.
       * @param {Object} state - The state object to save
       */
      function saveState(state) {
        _pendingSaveState = state;
        if (_saveTimer) clearTimeout(_saveTimer);
        _saveTimer = setTimeout(flushState, CONSTANTS.storageWriteDelayMs);
      }
  
      /** @type {Object} Global application state */
      let APP = loadState();
  
      /** @type {Array|null} Cached recommendation results */
      let _cachedRecommendations = null;
  
      /** @type {number} Timestamp of last recommendation cache */
      let _cacheTimestamp = 0;
  
      /** @const {number} Recommendation cache TTL in milliseconds */
      const CACHE_TTL = 3000;
  
      /**
       * Invalidates all runtime caches.
       */
      function invalidateCache() { _cachedRecommendations = null; _cacheTimestamp = 0; invalidateChartCache(); }
  
      // ========================================
      // SECTION 3: UTILITY FUNCTIONS
      // ========================================
  
      /**
       * Generates a short unique identifier string.
       * @returns {string} Unique ID
       */
      function uid() { return Date.now().toString(36) + Math.random().toString(36).substr(2, 9); }
  
      /**
       * Formats a number with locale-aware separators.
       * @param {number|null|undefined} n - Number to format
       * @param {number} [decimals=0] - Decimal places
       * @returns {string} Formatted number string
       */
      function formatNum(n, decimals = 0) {
        if (n === null || n === undefined || isNaN(n)) return '0';
        return Number(n).toLocaleString('en-IN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
      }
  
      /**
       * Formats a timestamp into a human-readable date string.
       * @param {number} ts - Unix timestamp in milliseconds
       * @returns {string} Formatted date
       */
      function formatDate(ts) { return new Date(ts).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }); }
  
      /**
       * Checks if two dates fall within the same calendar month.
       * @param {Date} d1
       * @param {Date} d2
       * @returns {boolean}
       */
      function isSameMonth(d1, d2) { return d1.getMonth() === d2.getMonth() && d1.getFullYear() === d2.getFullYear(); }
  
      /**
       * Sanitizes a string for safe HTML insertion by escaping HTML entities.
       * @param {string} str - Raw string
       * @returns {string} Escaped string safe for innerHTML
       */
      function sanitize(str) { const d = document.createElement('div'); d.textContent = String(str); return d.innerHTML; }
  
      /**
       * Clamps a numeric value between min and max.
       * @param {number} n
       * @param {number} min
       * @param {number} max
       * @returns {number}
       */
      function clamp(n, min, max) { return Math.max(min, Math.min(max, Number(n) || 0)); }
  
      /**
       * Returns the currently selected electricity emission factor.
       * @returns {number}
       */
      function getElectricityFactor() { return ELECTRICITY_FACTORS[APP.preferences?.electricityRegion || 'india'] || EF.electricityIndia; }
  
      /**
       * Simple event bus for decoupled component communication.
       * @type {Object}
       */
      const EventBus = {
        events: {},
        on(name, handler) { (this.events[name] ||= []).push(handler); },
        emit(name, payload) { (this.events[name] || []).forEach(handler => { try { handler(payload); } catch (e) { console.warn('Event handler failed:', e); } }); },
      };
  
      /**
       * Triggers a file download with the given content.
       * @param {string} filename
       * @param {string} content
       * @param {string} type - MIME type
       */
      function downloadFile(filename, content, type) {
        const blob = new Blob([content], { type });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url; link.download = filename; document.body.appendChild(link); link.click(); link.remove();
        URL.revokeObjectURL(url);
      }
  
      /**
       * Escapes a value for CSV output per RFC 4180.
       * @param {string|number|null|undefined} value
       * @returns {string}
       */
      function csvEscape(value) {
        const text = String(value ?? '');
        return /[",\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
      }
  
      /**
       * Parses CSV text into an array of rows (each row is an array of strings).
       * Handles quoted fields and escaped quotes.
       * @param {string} text - Raw CSV text
       * @returns {Array<Array<string>>} Parsed rows
       */
      function parseCSV(text) {
        const rows = [[]];
        let value = '', quoted = false;
        for (let i = 0; i < text.length; i++) {
          const ch = text[i], next = text[i + 1];
          if (ch === '"' && quoted && next === '"') { value += '"'; i++; }
          else if (ch === '"') quoted = !quoted;
          else if (ch === ',' && !quoted) { rows[rows.length - 1].push(value); value = ''; }
          else if ((ch === '\n' || ch === '\r') && !quoted) {
            if (ch === '\r' && next === '\n') i++;
            rows[rows.length - 1].push(value); value = ''; rows.push([]);
          } else value += ch;
        }
        rows[rows.length - 1].push(value);
        return rows.filter(row => row.some(cell => cell.trim() !== ''));
      }
  
      /**
       * Records an undoable action.
       * @param {string} type - Action type
       * @param {Object} payload - Action payload
       */
      function rememberUndo(type, payload) {
        APP.undoStack = APP.undoStack || [];
        APP.undoStack.push({ type, payload, timestamp: Date.now() });
        APP.undoStack = APP.undoStack.slice(-CONSTANTS.undoLimit);
      }
  
      /**
       * Reverts the most recent undoable action.
       */
      function undoLastAction() {
        const action = APP.undoStack?.pop();
        if (!action) { showToast('Nothing to undo.', 'warning'); return; }
        if (action.type === 'deleteActivity') APP.activities.push(action.payload);
        if (action.type === 'addActivity') APP.activities = APP.activities.filter(a => a.id !== action.payload.id);
        if (action.type === 'bulkImport') APP.activities = APP.activities.filter(a => !action.payload.ids.includes(a.id));
        saveState(APP); invalidateCache(); showToast('Last action undone.', 'success');
        if (APP.currentSection === 'dashboard') renderDashboard();
        if (APP.currentSection === 'log-activity') renderLogActivity();
        if (APP.currentSection === 'reports') renderReports();
      }
  
      /**
       * Applies the current theme preference to the document.
       */
      function applyThemePreference() {
        document.documentElement.classList.toggle('dark-mode', APP.preferences?.theme === 'dark');
        const theme = APP.preferences?.theme === 'dark' ? '#151722' : '#2D6A4F';
        document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme);
      }
  
      /**
       * Sets the theme preference.
       * @param {string} theme - 'light' or 'dark'
       */
      function setThemePreference(theme) {
        APP.preferences.theme = theme === 'dark' ? 'dark' : 'light';
        applyThemePreference(); saveState(APP); showToast('Theme preference saved.', 'success');
      }
  
      /**
       * Toggles between light and dark mode.
       */
      function toggleDarkMode() {
        setThemePreference(APP.preferences?.theme === 'dark' ? 'light' : 'dark');
      }
  
      /**
       * Updates a single preference key.
       * @param {string} key
       * @param {*} value
       */
      function updatePreference(key, value) {
        APP.preferences = { ...getDefaultState().preferences, ...(APP.preferences || {}), [key]: value };
        saveState(APP); showToast('Preference saved.', 'success');
      }
  
      /**
       * Opens the settings modal and populates current values.
       */
      function openSettings() {
        const modal = document.getElementById('settings-modal');
        if (!modal) return;
        document.getElementById('setting-theme').value = APP.preferences?.theme || 'light';
        document.getElementById('setting-units').value = APP.preferences?.units || 'metric';
        document.getElementById('setting-grid').value = APP.preferences?.electricityRegion || 'india';
        document.getElementById('setting-notifications').checked = !!APP.preferences?.notifications;
        modal.classList.remove('hidden');
        setTimeout(() => document.getElementById('setting-theme')?.focus(), 0);
      }
  
      /**
       * Closes the settings modal.
       */
      function closeSettings() { document.getElementById('settings-modal')?.classList.add('hidden'); }
  
      /**
       * Exports activities as a CSV file.
       */
      function exportActivitiesCSV() {
        if (!APP.activities.length) { showToast('No activities to export.', 'warning'); return; }
        const header = ['Date', 'Timestamp', 'Category', 'Action', 'Label', 'CO2e (kg)', 'Quantity', 'Unit'];
        const rows = APP.activities.map(a => [new Date(a.timestamp).toISOString().slice(0, 10), a.timestamp, a.category, a.action, a.label, a.co2eKg, a.quantity ?? '', a.unit ?? '']);
        const csv = [header, ...rows].map(row => row.map(csvEscape).join(',')).join('\n');
        downloadFile(`carbonlens_activities_${new Date().toISOString().slice(0, 10)}.csv`, csv, 'text/csv');
        showToast('Activities exported as CSV.', 'success');
      }
  
      /**
       * Exports activities as a JSON file.
       */
      function exportActivitiesJSON() {
        downloadFile(`carbonlens_activities_${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(APP.activities, null, 2), 'application/json');
        showToast('Activities exported as JSON.', 'success');
      }
  
      /**
       * Downloads a full backup of application state.
       */
      function backupData() {
        flushState();
        downloadFile(`carbonlens_backup_${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(APP, null, 2), 'application/json');
        showToast('Backup downloaded.', 'success');
      }
  
      /**
       * Imports activities from a CSV file with validation.
       * @param {Event} event - File input change event
       */
      function importActivitiesCSV(event) {
        const file = event.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
          const rows = parseCSV(String(reader.result || ''));
          const header = rows.shift()?.map(h => h.trim().toLowerCase()) || [];
          const idx = name => header.findIndex(h => h.includes(name));
          const imported = rows.map(row => {
            const timestampCell = row[idx('timestamp')];
            const dateCell = row[idx('date')];
            const timestamp = Number(timestampCell) || (dateCell ? new Date(dateCell).getTime() : Date.now());
            const category = row[idx('category')] || 'consumption';
            const co2eKg = Math.max(0, parseFloat(row[idx('co2e')]) || 0);
            if (!CATEGORIES.includes(category) || !isFinite(timestamp)) return null;
            return { id: uid(), timestamp, category, action: row[idx('action')] || 'imported', label: row[idx('label')] || 'Imported activity', co2eKg, quantity: parseFloat(row[idx('quantity')]) || 1, unit: row[idx('unit')] || 'unit' };
          }).filter(Boolean);
          if (!imported.length) { showToast('No valid CSV activities found.', 'warning'); return; }
          APP.activities.push(...imported); rememberUndo('bulkImport', { ids: imported.map(a => a.id) });
          saveState(APP); invalidateCache(); showToast(`Imported ${imported.length} activities.`, 'success');
          if (APP.currentSection === 'log-activity') renderLogActivity();
          if (APP.currentSection === 'dashboard') renderDashboard();
        };
        reader.readAsText(file);
        event.target.value = '';
      }
  
      /**
       * Displays a toast notification.
       * @param {string} message
       * @param {string} [type='success'] - 'success' or 'warning'
       */
      function showToast(message, type = 'success') {
        const c = document.getElementById('toast-container');
        const t = document.createElement('div');
        t.className = 'toast ' + type; t.textContent = message; t.setAttribute('role', 'alert');
        c.appendChild(t);
        setTimeout(() => { if (t.parentNode) t.remove(); }, 3100);
      }
  
      /**
       * Sends a browser notification if permission is granted.
       * @param {string} title
       * @param {string} body
       */
      function notifyMilestone(title, body) {
        if (!APP.preferences?.notifications || !('Notification' in window)) return;
        if (Notification.permission === 'granted') new Notification(title, { body });
        else if (Notification.permission !== 'denied') Notification.requestPermission().then(permission => {
          if (permission === 'granted') new Notification(title, { body });
        });
      }
  
      // ========================================
      // SECTION 4: EMISSION CALCULATOR
      // ========================================
  
      /**
       * Calculates transport emissions.
       * @param {string} action - Transport mode key
       * @param {number} km - Distance in kilometers
       * @returns {number} CO2e in kg
       */
      function calcTransport(action, km) { return parseFloat((Math.max(0, Number(km) || 0) * (EF[action] || 0)).toFixed(3)); }
  
      /**
       * Calculates energy emissions.
       * @param {string} action - Energy action key
       * @param {number} quantity - Quantity (hours or kWh)
       * @returns {number} CO2e in kg
       */
      function calcEnergy(action, quantity) {
        const q = Math.max(0, Number(quantity) || 0);
        if (action === 'ac') return parseFloat((q * EF.acPerHour).toFixed(3));
        if (action === 'heater') return parseFloat((q * EF.heaterPerHour).toFixed(3));
        if (action === 'electricity') return parseFloat((q * getElectricityFactor()).toFixed(3));
        if (action === 'natural_gas') return parseFloat((q * EF.naturalGas).toFixed(3));
        return 0;
      }
  
      /**
       * Calculates food emissions per meal.
       * @param {string} action - Food action key
       * @returns {number} CO2e in kg
       */
      function calcFood(action) { return EF[action] || 0; }
  
      /**
       * Calculates consumption emissions.
       * @param {string} action - Consumption action key
       * @param {number} quantity - Quantity
       * @returns {number} CO2e in kg
       */
      function calcConsumption(action, quantity) { return parseFloat((Math.max(1, Number(quantity) || 1) * (EF[action] || EF.onlineDelivery)).toFixed(3)); }
  
      /**
       * Computes a user's baseline footprint from onboarding answers.
       * @param {Object} answers - Onboarding answers object
       * @returns {Object} Baseline breakdown
       */
      function computeBaseline(answers) {
        const transport = answers.transport || {}, energy = answers.energy || {};
        const diet = answers.diet || {}, consumption = answers.consumption || {};
  
        let transportKg = 0;
        const commuteKm = (transport.commuteKm || 15) * 2;
        const mode = transport.mode || 'car';
        if (mode === 'flight' || mode === 'mixed_flight') {
          const freq = transport.flyFrequency || 'rarely';
          if (freq === 'monthly') transportKg = 2000 * EF.flightLong;
          else if (freq === '2-4_per_year') transportKg = (2000 * EF.flightLong * 3) / 12;
          else transportKg = commuteKm * 22 * EF.car;
        } else { transportKg = commuteKm * 22 * (EF[mode] || 0); }
  
        let energyKg = (energy.electricityBillKwh || 200) * EF.electricityIndia;
        const acUsage = energy.acUsage || 'sometimes';
        if (acUsage === 'daily') energyKg += 4 * 30 * EF.acPerHour;
        else if (acUsage === 'sometimes') energyKg += 2 * 15 * EF.acPerHour;
        if (energy.hasGas) energyKg += 30 * EF.naturalGas;
  
        let dietKg = 0;
        const totalMeals = 3 * 30;
        const dietType = diet.type || 'regular';
        const beefPerWeek = diet.beefPerWeek || 3;
        const baseMealMap = { regular: 'chickenMeal', 'meat-heavy': 'beefMeal', pescatarian: 'fishMeal', vegetarian: 'vegMeal', vegan: 'veganMeal' };
        const beefMeals = beefPerWeek * 4;
        dietKg = (beefMeals * EF.beefMeal) + ((totalMeals - beefMeals) * (EF[baseMealMap[dietType]] || EF.chickenMeal));
  
        let consumptionKg = 0;
        const clothingMap = { monthly: 4, quarterly: 1.3, '2_year': 0.5, rarely: 0.2 };
        consumptionKg += (clothingMap[consumption.clothingFreq] || 1) * EF.clothingItem;
        const electronicsMap = { yearly: 1 / 12, '2_years': 1 / 24, rarely: 1 / 48 };
        consumptionKg += (electronicsMap[consumption.electronicsFreq] || 1 / 24) * EF.electronicsOther;
        const deliveryMap = { daily: 30, '2-3_weekly': 10, weekly: 4, '2-3_monthly': 0.75, rarely: 0.25 };
        consumptionKg += (deliveryMap[consumption.deliveryFreq] || 4) * EF.onlineDelivery;
  
        const totalKg = transportKg + energyKg + dietKg + consumptionKg;
        return {
          transportKg: parseFloat(transportKg.toFixed(1)), energyKg: parseFloat(energyKg.toFixed(1)),
          dietKg: parseFloat(dietKg.toFixed(1)), consumptionKg: parseFloat(consumptionKg.toFixed(1)),
          totalKg: parseFloat(totalKg.toFixed(1)), totalAnnual: parseFloat((totalKg * 12 / 1000).toFixed(2)),
        };
      }
  
      // ========================================
      // SECTION 5: DATA AGGREGATION
      // ========================================
  
      /**
       * Aggregates activities by category with optional period filtering.
       * @param {Array<Object>} activities - Activity records
       * @param {string|null} [period=null] - 'thisMonth' or 'thisWeek'
       * @returns {Object} Aggregated totals
       */
      function aggregateActivities(activities, period = null) {
        const result = { transport: 0, energy: 0, food: 0, consumption: 0, total: 0, count: 0 };
        const now = new Date();
        for (let i = 0; i < activities.length; i++) {
          const a = activities[i];
          if (period) {
            const d = new Date(a.timestamp);
            if (period === 'thisMonth' && !isSameMonth(d, now)) continue;
            if (period === 'thisWeek' && d < new Date(now.getTime() - 7 * 86400000)) continue;
          }
          const cat = a.category === 'food' ? 'food' : a.category;
          if (result.hasOwnProperty(cat)) { result[cat] += a.co2eKg; result.total += a.co2eKg; result.count++; }
        }
        return result;
      }
  
      /**
       * Aggregates activities by week for trend charts.
       * @param {Array<Object>} activities
       * @param {number} [numWeeks=12]
       * @returns {Array<Object>} Weekly totals
       */
      function aggregateByWeek(activities, numWeeks = 12) {
        const now = new Date(), weeks = [];
        for (let w = numWeeks - 1; w >= 0; w--) {
          const ws = new Date(now.getTime() - (w + 1) * 7 * 86400000);
          const we = new Date(now.getTime() - w * 7 * 86400000);
          let total = 0;
          for (let i = 0; i < activities.length; i++) {
            const d = new Date(activities[i].timestamp);
            if (d >= ws && d < we) total += activities[i].co2eKg;
          }
          weeks.push({ label: 'W' + (numWeeks - w), value: parseFloat(total.toFixed(1)) });
        }
        return weeks;
      }
  
      /**
       * Aggregates activities by month for trend charts.
       * @param {Array<Object>} activities
       * @param {number} [numMonths=6]
       * @returns {Array<Object>} Monthly totals
       */
      function aggregateByMonth(activities, numMonths = 6) {
        const now = new Date(), months = [];
        for (let m = numMonths - 1; m >= 0; m--) {
          const d = new Date(now.getFullYear(), now.getMonth() - m, 1);
          let total = 0;
          for (let i = 0; i < activities.length; i++) {
            const ad = new Date(activities[i].timestamp);
            if (ad.getMonth() === d.getMonth() && ad.getFullYear() === d.getFullYear()) total += activities[i].co2eKg;
          }
          months.push({ label: MONTH_NAMES[d.getMonth()].substr(0, 3), value: parseFloat(total.toFixed(1)) });
        }
        return months;
      }
  
      /**
       * Identifies the highest-emission category.
       * @param {Object} agg - Aggregated totals
       * @returns {Object} Category name and kg value
       */
      function getBiggestCategory(agg) {
        let max = 0, cat = 'transport';
        for (const c of CATEGORIES) { if ((agg[c] || 0) > max) { max = agg[c]; cat = c; } }
        return { category: cat, kg: max };
      }
  
      // ========================================
      // SECTION 6: CHART RENDERER (Canvas)
      // ========================================
  
      /** @type {Object.<string, number>} Active requestAnimationFrame IDs per canvas */
      const CHART_RAFS = {};
  
      /** @type {number} Global chart cache version counter */
      let CHART_CACHE_VERSION = 0;
  
      /**
       * Invalidates the chart cache to force redraws.
       */
      function invalidateChartCache() { CHART_CACHE_VERSION++; }
  
      /**
       * Schedules a chart draw on the next animation frame.
       * @param {HTMLCanvasElement} canvas
       * @param {string} key - Cache key
       * @param {Function} drawFn - Drawing function
       */
      function scheduleChartDraw(canvas, key, drawFn) {
        if (canvas.dataset.chartKey === key) return;
        canvas.dataset.chartKey = key;
        if (CHART_RAFS[canvas.id]) cancelAnimationFrame(CHART_RAFS[canvas.id]);
        CHART_RAFS[canvas.id] = requestAnimationFrame(() => {
          drawFn();
          delete CHART_RAFS[canvas.id];
        });
      }
  
      /**
       * Configures canvas dimensions and returns drawing context.
       * @param {HTMLCanvasElement} canvas
       * @param {number} height
       * @returns {Object} Drawing context and dimensions
       */
      function getCanvasMetrics(canvas, height) {
        const dpr = window.devicePixelRatio || 1;
        const width = Math.max(260, Math.round(canvas.parentElement.offsetWidth || canvas.offsetWidth || 260));
        canvas.width = width * dpr; canvas.height = height * dpr;
        canvas.style.width = width + 'px'; canvas.style.height = height + 'px';
        const ctx = canvas.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, width, height);
        return { ctx, w: width, h: height, dpr };
      }
  
      /**
       * Renders a donut chart.
       * @param {string} canvasId
       * @param {Array<Object>} data - Slice objects with label, value, color
       * @param {string} centerText - Text in the center
       */
      function drawDonutChart(canvasId, data, centerText) {
        const canvas = document.getElementById(canvasId);
        if (!canvas) return;
        const expectedWidth = Math.max(260, Math.round(canvas.parentElement.offsetWidth || canvas.offsetWidth || 260));
        const key = `donut:${CHART_CACHE_VERSION}:${expectedWidth}:${centerText}:${JSON.stringify(data)}`;
        scheduleChartDraw(canvas, key, () => {
          const { ctx, w, h } = getCanvasMetrics(canvas, 280);
          const cx = w / 2, cy = h / 2;
          const outerR = Math.min(w, h) / 2 - 20, innerR = outerR * 0.6;
          const total = data.reduce((s, d) => s + d.value, 0);
          if (total === 0) {
            ctx.beginPath(); ctx.arc(cx, cy, outerR, 0, Math.PI * 2); ctx.arc(cx, cy, innerR, 0, Math.PI * 2, true); ctx.fillStyle = '#EFEDE8'; ctx.fill();
            ctx.font = '600 14px -apple-system,sans-serif'; ctx.fillStyle = '#8B8B9E'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('No data yet', cx, cy);
            return;
          }
          let startAngle = -Math.PI / 2;
          data.forEach(item => {
            const slice = (item.value / total) * Math.PI * 2;
            ctx.beginPath(); ctx.arc(cx, cy, outerR, startAngle, startAngle + slice); ctx.arc(cx, cy, innerR, startAngle + slice, startAngle, true); ctx.closePath(); ctx.fillStyle = item.color; ctx.fill();
            startAngle += slice;
          });
          ctx.font = '800 1.5rem -apple-system,sans-serif'; ctx.fillStyle = '#1A1A2E'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(centerText, cx, cy - 8);
          ctx.font = '500 0.75rem -apple-system,sans-serif'; ctx.fillStyle = '#8B8B9E'; ctx.fillText('kg CO2e/month', cx, cy + 14);
          const legendY = h - 15, lw = data.length * 90, ls = (w - lw) / 2;
          ctx.font = '500 11px -apple-system,sans-serif';
          data.forEach((item, i) => { const x = ls + i * 90; ctx.fillStyle = item.color; ctx.fillRect(x, legendY - 6, 10, 10); ctx.fillStyle = '#4A4A68'; ctx.textAlign = 'left'; ctx.fillText(item.label, x + 14, legendY + 3); });
        });
      }
  
      /**
       * Renders a line chart.
       * @param {string} canvasId
       * @param {Array<Object>} data - Point objects with label and value
       * @param {string} color - Line color
       */
      function drawLineChart(canvasId, data, color) {
        const canvas = document.getElementById(canvasId);
        if (!canvas) return;
        const expectedWidth = Math.max(260, Math.round(canvas.parentElement.offsetWidth || canvas.offsetWidth || 260));
        const key = `line:${CHART_CACHE_VERSION}:${expectedWidth}:${color}:${JSON.stringify(data)}`;
        scheduleChartDraw(canvas, key, () => {
          const { ctx, w, h } = getCanvasMetrics(canvas, 260);
          const pad = { top: 20, right: 20, bottom: 40, left: 50 };
          const cw = w - pad.left - pad.right, ch = h - pad.top - pad.bottom;
          const maxVal = Math.max(...data.map(d => d.value), 1);
          ctx.font = '400 11px -apple-system,sans-serif'; ctx.fillStyle = '#8B8B9E'; ctx.textAlign = 'right';
          for (let i = 0; i <= 5; i++) {
            const y = pad.top + ch - (ch * i / 5);
            ctx.fillText((maxVal * i / 5).toFixed(0), pad.left - 8, y + 4);
            ctx.strokeStyle = '#E0DDD7'; ctx.lineWidth = 0.5; ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(w - pad.right, y); ctx.stroke();
          }
          ctx.textAlign = 'center';
          const xs = cw / Math.max(data.length - 1, 1);
          data.forEach((d, i) => { ctx.fillStyle = '#8B8B9E'; ctx.fillText(d.label, pad.left + i * xs, h - pad.bottom + 20); });
          // Fill
          ctx.beginPath();
          data.forEach((d, i) => { const x = pad.left + i * xs, y = pad.top + ch - (d.value / maxVal * ch); i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); });
          ctx.lineTo(pad.left + (data.length - 1) * xs, pad.top + ch); ctx.lineTo(pad.left, pad.top + ch); ctx.closePath();
          const grad = ctx.createLinearGradient(0, pad.top, 0, pad.top + ch); grad.addColorStop(0, color + '30'); grad.addColorStop(1, color + '05'); ctx.fillStyle = grad; ctx.fill();
          // Line
          ctx.beginPath();
          data.forEach((d, i) => { const x = pad.left + i * xs, y = pad.top + ch - (d.value / maxVal * ch); i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); });
          ctx.strokeStyle = color; ctx.lineWidth = 2.5; ctx.lineJoin = 'round'; ctx.stroke();
          // Dots
          data.forEach((d, i) => {
            const x = pad.left + i * xs, y = pad.top + ch - (d.value / maxVal * ch);
            ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill();
            ctx.beginPath(); ctx.arc(x, y, 2, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill();
          });
        });
      }
  
      /**
       * Renders a horizontal bar chart.
       * @param {string} canvasId
       * @param {Array<Object>} data - Bar objects with label, value, color, valueText
       */
      function drawBarChart(canvasId, data) {
        const canvas = document.getElementById(canvasId);
        if (!canvas) return;
        const expectedWidth = Math.max(260, Math.round(canvas.parentElement.offsetWidth || canvas.offsetWidth || 260));
        const key = `bar:${CHART_CACHE_VERSION}:${expectedWidth}:${JSON.stringify(data)}`;
        scheduleChartDraw(canvas, key, () => {
          const { ctx, w, h } = getCanvasMetrics(canvas, 220);
          const pad = { top: 10, right: 20, bottom: 50, left: 100 };
          const cw = w - pad.left - pad.right, barH = 28, gap = 12;
          const maxVal = Math.max(...data.map(d => d.value), 0.1);
          data.forEach((item, i) => {
            const y = pad.top + i * (barH + gap);
            ctx.font = '600 12px -apple-system,sans-serif'; ctx.fillStyle = '#4A4A68'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(item.label, 0, y + barH / 2);
            ctx.fillStyle = '#EFEDE8'; ctx.beginPath(); ctx.roundRect(pad.left, y, cw, barH, 6); ctx.fill();
            const fillW = Math.max((item.value / maxVal) * cw, item.value > 0 ? 24 : 0);
            ctx.fillStyle = item.color; ctx.beginPath(); ctx.roundRect(pad.left, y, fillW, barH, 6); ctx.fill();
            ctx.font = '700 11px -apple-system,sans-serif'; ctx.fillStyle = fillW > 60 ? '#fff' : '#4A4A68';
            ctx.textAlign = fillW > 60 ? 'right' : 'left';
            ctx.fillText(item.valueText || item.value.toFixed(1) + ' t', fillW > 60 ? pad.left + fillW - 8 : pad.left + fillW + 8, y + barH / 2);
          });
        });
      }
  
      // ========================================
      // SECTION 7: RECOMMENDATION ENGINE
      // ========================================
  
      /**
       * Generates personalized recommendations based on aggregated data.
       * Results are cached for CACHE_TTL milliseconds.
       * @returns {Array<Object>} Sorted recommendations
       */
      function generateRecommendations() {
        if (_cachedRecommendations && Date.now() - _cacheTimestamp < CACHE_TTL) return _cachedRecommendations;
        const recs = [];
        const agg = aggregateActivities(APP.activities, 'thisMonth');
        const baseline = APP.profile?.baseline;
        // Use max of logged data or baseline so recommendations work even with few logged activities
        const tKg = Math.max(agg.transport, baseline ? baseline.transportKg : 0);
        const eKg = Math.max(agg.energy, baseline ? baseline.energyKg : 0);
        const fKg = Math.max(agg.food, baseline ? baseline.dietKg : 0);
        const cKg = Math.max(agg.consumption, baseline ? baseline.consumptionKg : 0);
        const total = tKg + eKg + fKg + cKg;
        const tPct = total > 0 ? Math.round(tKg / total * 100) : 0;
        const ePct = total > 0 ? Math.round(eKg / total * 100) : 0;
        const fPct = total > 0 ? Math.round(fKg / total * 100) : 0;
  
        if (tKg > 20) recs.push({ id: 'bus_3days', category: 'transport', effort: 'easy', title: 'Switch 3 days/week to bus or train', description: 'Replacing car trips with public transit 3 days a week significantly cuts transport emissions.', savingsKg: parseFloat((tKg * 0.4 * (1 - EF.bus / EF.car)).toFixed(1)), reason: `Transport is ${tPct}% of your footprint — reducing car trips has the highest impact.` });
        if (tKg > 10) recs.push({ id: 'walk_short', category: 'transport', effort: 'easy', title: 'Walk or cycle for trips under 3 km', description: 'Short car trips have high per-km emissions due to cold starts. Walking is zero-emission.', savingsKg: parseFloat((15 * 22 * EF.car * 0.15).toFixed(1)), reason: 'Short car trips add up to significant monthly emissions.' });
        if (APP.activities.some(a => a.category === 'transport' && (a.action === 'flightShort' || a.action === 'flightLong'))) recs.push({ id: 'reduce_flights', category: 'transport', effort: 'hard', title: 'Replace one short-haul flight with train', description: 'A single short-haul return trip can exceed your monthly ground transport footprint.', savingsKg: parseFloat((2000 * EF.flightShort - 2000 * EF.train).toFixed(1)), reason: 'Your flight activity is a major contributor.' });
        if (eKg > 30) recs.push({ id: 'ac_reduce_1hr', category: 'energy', effort: 'medium', title: 'Reduce AC usage by 1 hour per day', description: 'One less hour daily adds up to meaningful monthly savings, especially with India\'s carbon-intensive grid.', savingsKg: parseFloat((EF.acPerHour * 30).toFixed(1)), reason: `Energy is ${ePct}% of your footprint. AC is typically the largest load.` });
        if (eKg > 15) recs.push({ id: 'led_lights', category: 'energy', effort: 'easy', title: 'Switch all bulbs to LED', description: 'LEDs use 75% less energy. A full household switch saves ~150 kWh/year.', savingsKg: parseFloat((12.5 * EF.electricityIndia).toFixed(1)), reason: 'Lighting efficiency is a low-effort, high-compliance change.' });
        if (eKg > 20) recs.push({ id: 'unplug_standby', category: 'energy', effort: 'easy', title: 'Unplug devices on standby or use smart strips', description: 'Standup power draws 5-10% of household electricity.', savingsKg: parseFloat((eKg * 0.07).toFixed(1)), reason: 'Standby power waste accounts for 5-10% of home energy.' });
        if (fKg > 40) recs.push({ id: 'less_beef', category: 'food', effort: 'medium', title: 'Replace 2 beef meals/week with chicken or plant-based', description: 'Beef produces 4x more emissions per meal than chicken and 17x more than vegan.', savingsKg: parseFloat((2 * 4 * (EF.beefMeal - EF.chickenMeal)).toFixed(1)), reason: `Food is ${fPct}% of your footprint. Beef is the single highest-impact food.` });
        if (fKg > 20) recs.push({ id: 'one_vegan_day', category: 'food', effort: 'easy', title: 'Try one fully plant-based day per week', description: 'A vegan day saves ~2-3 kg CO2e compared to a typical meat-inclusive day.', savingsKg: parseFloat(((EF.chickenMeal - EF.veganMeal) * 3).toFixed(1)), reason: 'Plant-based meals have the lowest carbon footprint.' });
        if (fKg > 15) recs.push({ id: 'reduce_food_waste', category: 'food', effort: 'easy', title: 'Reduce food waste by planning meals', description: '30% of food produced is wasted. Wasted food wastes all its embedded emissions too.', savingsKg: parseFloat((fKg * 0.15).toFixed(1)), reason: 'Food waste represents embedded carbon from production.' });
        if (cKg > 15) recs.push({ id: 'secondhand_clothes', category: 'consumption', effort: 'medium', title: 'Buy second-hand for 50% of clothing', description: 'Manufacturing is the carbon-intensive part. Second-hand has near-zero additional emissions.', savingsKg: parseFloat((EF.clothingItem * 0.5 * 1.5).toFixed(1)), reason: 'Manufacturing clothing is extremely carbon-intensive.' });
        if (cKg > 5) recs.push({ id: 'batch_deliveries', category: 'consumption', effort: 'easy', title: 'Batch online orders into weekly deliveries', description: 'Consolidating orders reduces delivery emissions by 60-70%.', savingsKg: parseFloat((EF.onlineDelivery * 10 * 0.6).toFixed(1)), reason: 'Individual delivery trips multiply shopping transport emissions.' });
        if (cKg > 10) recs.push({ id: 'extend_electronics', category: 'consumption', effort: 'medium', title: 'Extend electronics lifespan by 1-2 years', description: 'Manufacturing dominates electronics emissions. Each extra year avoids embedded emissions.', savingsKg: parseFloat((EF.electronicsOther / 36).toFixed(1)), reason: 'Manufacturing phase dominates — longer use = fewer replacements.' });
  
        const ep = { easy: 0, medium: 0.1, hard: 0.25 };
        recs.sort((a, b) => (b.savingsKg * (1 - ep[b.effort])) - (a.savingsKg * (1 - ep[a.effort])));
        const seen = new Set();
        _cachedRecommendations = recs.filter(r => { if (seen.has(r.id)) return false; seen.add(r.id); return true; });
        _cacheTimestamp = Date.now();
        return _cachedRecommendations;
      }
  
      // ========================================
      // SECTION 8: GOALS & GAMIFICATION
      // ========================================
  
      /** @type {Array<Object>} Badge definitions */
      const BADGE_DEFS = [
        { id: 'first-step', name: 'First Step', icon: '\u{1F6E1}', criteria: 'Complete onboarding' },
        { id: 'first-log', name: 'Logger', icon: '\u{270D}', criteria: 'Log first activity' },
        { id: 'week-one', name: 'Week Warrior', icon: '\u{1F31F}', criteria: '7-day logging streak' },
        { id: 'month-one', name: 'Monthly Maven', icon: '\u{1F4C5}', criteria: '30-day logging streak' },
        { id: 'transport-hero', name: 'Route Master', icon: '\u{1F697}', criteria: 'Log 20+ transport activities' },
        { id: 'green-eater', name: 'Green Plate', icon: '\u{1F96C}', criteria: 'Log 10+ plant-based meals' },
        { id: 'energy-saver', name: 'Power Saver', icon: '\u{1F50B}', criteria: 'Commit to 3+ energy recs' },
        { id: 'half-way', name: 'Halfway There', icon: '\u{1F3AF}', criteria: '50% of reduction target' },
        { id: 'goal-crusher', name: 'Goal Crusher', icon: '\u{1F3C6}', criteria: 'Achieve full target' },
        { id: 'streak-30', name: 'On Fire', icon: '\u{1F525}', criteria: '30-day best streak' },
        { id: 'low-carbon', name: 'Low Carbon Life', icon: '\u{1F30D}', criteria: 'Monthly total < 100 kg' },
        { id: 'educator', name: 'Learner', icon: '\u{1F4DA}', criteria: 'Read all 5 education sections' },
      ];
  
      /**
       * Updates the daily logging streak.
       */
      function updateStreak() {
        const today = new Date().toDateString();
        const loggedToday = APP.activities.some(a => new Date(a.timestamp).toDateString() === today);
        if (loggedToday && APP.streak.lastLogDate !== today) {
          const yesterday = new Date(Date.now() - 86400000).toDateString();
          APP.streak.current = APP.streak.lastLogDate === yesterday ? APP.streak.current + 1 : 1;
          APP.streak.lastLogDate = today;
          if (APP.streak.current > APP.streak.best) APP.streak.best = APP.streak.current;
          saveState(APP);
        } else if (!loggedToday && APP.streak.lastLogDate !== today) {
          const yesterday = new Date(Date.now() - 86400000).toDateString();
          if (APP.streak.lastLogDate !== yesterday && APP.streak.lastLogDate !== null) { APP.streak.current = 0; saveState(APP); }
        }
      }
  
      /**
       * Checks and unlocks any newly earned badges.
       * @returns {Array<string>} IDs of newly unlocked badges
       */
      function checkBadges() {
        const newly = [];
        function unlock(id) { if (!APP.badges.includes(id)) { APP.badges.push(id); newly.push(id); } }
        if (APP.profile) unlock('first-step');
        if (APP.activities.length >= 1) unlock('first-log');
        if (APP.streak.current >= 7) unlock('week-one');
        if (APP.streak.current >= 30) unlock('month-one');
        if (APP.streak.best >= 30) unlock('streak-30');
        if (APP.activities.filter(a => a.category === 'transport').length >= 20) unlock('transport-hero');
        if (APP.activities.filter(a => a.category === 'food' && (a.action === 'vegMeal' || a.action === 'veganMeal')).length >= 10) unlock('green-eater');
        if (APP.recommendationsCommitted.filter(c => generateRecommendations().find(r => r.id === c.recId)?.category === 'energy').length >= 3) unlock('energy-saver');
        if (APP.goals) { const r = calculateReductionPercent(); if (r >= 50) unlock('half-way'); if (r >= APP.goals.targetReductionPercent) unlock('goal-crusher'); }
        if (aggregateActivities(APP.activities, 'thisMonth').total > 0 && aggregateActivities(APP.activities, 'thisMonth').total < 100) unlock('low-carbon');
        if (APP.educationRead.length >= 5) unlock('educator');
        if (newly.length > 0) { saveState(APP); newly.forEach(id => { const b = BADGE_DEFS.find(x => x.id === id); if (b) { showToast(`Badge unlocked: ${b.icon} ${b.name}!`, 'success'); notifyMilestone('CarbonLens badge unlocked', b.name); } }); }
        return newly;
      }
  
      /**
       * Calculates current reduction percentage against baseline.
       * @returns {number} Percentage (0-100+)
       */
      function calculateReductionPercent() {
        if (!APP.profile?.baseline || !APP.goals) return 0;
        const base = APP.profile.baseline.totalKg;
        if (base <= 0) return 0;
        return Math.max(0, parseFloat(((base - aggregateActivities(APP.activities, 'thisMonth').total) / base * 100).toFixed(1)));
      }
  
      // ========================================
      // SECTION 9: EDUCATION CONTENT
      // ========================================
  
      /** @type {Array<Object>} Education accordion sections */
      const EDUCATION_SECTIONS = [
        { id: 'understanding', title: 'Understanding Carbon Footprint', content: `<p>A carbon footprint measures total greenhouse gas emissions caused by a person, expressed as CO2 equivalent (CO2e). This standardizes different gases like methane and nitrous oxide into one comparable metric based on their global warming potential.</p><p>Your personal footprint covers three "scopes": Scope 1 (direct emissions from things you burn), Scope 2 (indirect emissions from purchased energy), and Scope 3 (everything else — food, products, services, waste). Scope 3 typically makes up 60-70%.</p><p>The global average is approximately 4.7 tonnes CO2e per person per year, but distribution is highly unequal. The Paris Agreement requires per-person footprints to drop to roughly 2 tonnes per year by 2030 in wealthy nations.</p><p>Understanding your footprint is not about blame — it is about awareness. Once you know where emissions come from, you can make informed choices that genuinely reduce impact.</p>` },
        { id: 'transport', title: 'Transport & Travel', content: `<p>Transport is typically the largest single category for people who commute by car or fly regularly. A short-haul round trip (2,000 km) produces about 512 kg CO2e — more than many people's entire monthly footprint from all other activities. Aircraft burn fuel at high altitudes where contrails amplify warming.</p><p>For ground transport, emission differences are substantial: car 0.21 kg/km, bus 0.089 kg, train 0.041 kg, walking/biking zero. Even EVs have indirect emissions from grid electricity — less than petrol cars but not zero, especially in coal-heavy grids like India.</p><p>The most impactful changes: reduce flying, switch to public transit, carpool, and combine errands into single trips to avoid cold-start penalties on short car trips.</p>` },
        { id: 'energy', title: 'Home Energy', content: `<p>Home energy emissions depend heavily on your electricity grid. India averages 0.82 kg CO2e/kWh (coal-heavy), UK 0.23 kg/kWh (renewables+nuclear), US 0.42 kg/kWh (mixed). AC is the largest single load — a 1.5-ton AC running 4 hours daily uses about 4.5 kWh/day, translating to 3.7 kg CO2e/day or 110+ kg/month.</p><p>Reducing AC usage by one hour daily saves approximately 37 kg CO2e/month. Setting thermostats to 24-26 degrees, using fans first, and closing curtains during hot hours reduce cooling needs significantly.</p><p>LED bulbs use 75% less energy than incandescent. Pressure cookers save significant cooking energy. Unplugging standby devices saves 5-10% of household electricity.</p>` },
        { id: 'food', title: 'Food & Diet', content: `<p>Food production is responsible for roughly 26% of global emissions. Beef: 6.61 kg CO2e per meal. Chicken: 1.58 kg. Vegetarian: 0.73 kg. Vegan: 0.39 kg. This 17:1 ratio between beef and vegan meals makes dietary changes one of the most impactful individual actions.</p><p>Emissions come from land use change, methane from cattle (28x more potent than CO2), feed production, processing, and transport. Food miles account for only ~6% of food emissions — what you eat matters far more than where it comes from.</p><p>Food waste represents ~30% of production. When wasted food decomposes in landfills, it produces methane. Planning meals and using leftovers prevents both waste and embedded emissions.</p>` },
        { id: 'consumption', title: 'Consumption & Stuff', content: `<p>New clothing: ~20 kg CO2e per item (growing fibers, processing, dyeing, sewing, shipping). Fashion accounts for ~10% of global emissions. Second-hand has near-zero additional emissions.</p><p>Electronics have especially high embedded emissions from semiconductor manufacturing: smartphone ~70 kg CO2e, laptop ~350 kg CO2e. Using devices 1-2 years longer avoids significant emissions from replacements.</p><p>Online delivery averages ~1.8 kg CO2e per order. Batching orders and choosing slower shipping reduces delivery emissions by 50-70%. The circular economy — reduce, reuse, repair, recycle — is the most sustainable pattern.</p>` },
      ];
  
      /** @type {Array<Object>} Myth-busting cards */
      const MYTHS = [
        { myth: '"Recycling solves the waste problem"', fact: 'Recycling is the last step in "reduce, reuse, recycle." Manufacturing new products still generates emissions regardless of recycling. Reducing consumption and reusing items prevents emissions at source.' },
        { myth: '"Individual actions don\'t matter"', fact: 'If the top 10% of emitters reduced footprints to the global average, global emissions would drop ~30%. Consumer choices drive corporate decisions and build cultural momentum for systemic change.' },
        { myth: '"EVs produce zero emissions"', fact: 'EVs eliminate tailpipe emissions but still have indirect grid emissions and manufacturing footprint. In India, they produce ~30-50% less than petrol cars over their lifetime.' },
        { myth: '"Plant-based diets lack nutrition"', fact: 'Well-planned plant-based diets meet all nutritional needs across all life stages per major health organizations. The environmental benefit: up to 73% reduction in food emissions.' },
        { myth: '"Carbon offsets cancel out my emissions"', fact: 'Offsets can help but should not replace direct reduction. Questions about additionality and permanence remain. The best approach: reduce first, offset what you cannot eliminate.' },
      ];
  
      // ========================================
      // SECTION 10: ONBOARDING
      // ========================================
  
      /** @type {number} Current onboarding step index */
      let onboardingStep = 0;
  
      /** @type {Object} Answers collected during onboarding */
      let onboardingAnswers = {};
  
      /** @type {Array<Object>} Onboarding step definitions */
      const ONBOARDING_STEPS = [
        {
          title: 'Welcome to CarbonLens', subtitle: "Let's understand your footprint in about 2 minutes. No wrong answers — just honest estimates.", render(c) {
            c.innerHTML = `<div class="form-group" style="text-align:center;margin-top:1rem"><label for="onboard-name" style="display:block">What should we call you? <span style="color:var(--text-muted);font-weight:400">(optional)</span></label><input type="text" id="onboard-name" class="form-input" placeholder="Your name" style="max-width:280px;margin:0.5rem auto 0;display:block" maxlength="40" aria-describedby="name-hint"><p id="name-hint" class="form-hint" style="text-align:center">Used only to personalize your experience.</p></div><div class="form-group" style="margin-top:1.5rem"><label style="display:block">Which country do you live in?</label><div class="option-grid" style="margin-top:0.5rem"><button class="option-card selected" data-value="india" onclick="selectOption(this,'country')"><span class="option-label">India</span></button><button class="option-card" data-value="us" onclick="selectOption(this,'country')"><span class="option-label">United States</span></button><button class="option-card" data-value="uk" onclick="selectOption(this,'country')"><span class="option-label">United Kingdom</span></button><button class="option-card" data-value="other" onclick="selectOption(this,'country')"><span class="option-label">Other</span></button></div></div>`;
            onboardingAnswers.country = 'india';
          }
        },
        {
          title: 'Transport', subtitle: 'How do you usually get around?', render(c) {
            c.innerHTML = `<div class="form-group"><label>Primary commute mode</label><div class="option-grid"><button class="option-card" data-value="car" onclick="selectOption(this,'transport.mode')"><span class="option-icon">\u{1F697}</span><span class="option-label">Car</span></button><button class="option-card" data-value="bus" onclick="selectOption(this,'transport.mode')"><span class="option-icon">\u{1F68C}</span><span class="option-label">Bus</span></button><button class="option-card" data-value="train" onclick="selectOption(this,'transport.mode')"><span class="option-icon">\u{1F689}</span><span class="option-label">Train/Metro</span></button><button class="option-card" data-value="motorcycle" onclick="selectOption(this,'transport.mode')"><span class="option-icon">\u{1F3CD}</span><span class="option-label">Motorcycle</span></button><button class="option-card" data-value="bicycle" onclick="selectOption(this,'transport.mode')"><span class="option-icon">\u{1F6B2}</span><span class="option-label">Bicycle</span></button><button class="option-card" data-value="walk" onclick="selectOption(this,'transport.mode')"><span class="option-icon">\u{1F6B6}</span><span class="option-label">Walk</span></button></div></div><div class="form-group"><label for="commute-km">One-way commute distance (km)</label><input type="number" id="commute-km" class="form-input" value="15" min="0" max="200" oninput="onboardingAnswers.transport.commuteKm=this.value"></div><div class="form-group"><label>How often do you fly?</label><div class="option-grid"><button class="option-card" data-value="never" onclick="selectOption(this,'transport.flyFrequency')"><span class="option-label">Never</span></button><button class="option-card" data-value="rarely" onclick="selectOption(this,'transport.flyFrequency')"><span class="option-label">Rarely</span></button><button class="option-card" data-value="2-4_per_year" onclick="selectOption(this,'transport.flyFrequency')"><span class="option-label">2-4/year</span></button><button class="option-card" data-value="monthly" onclick="selectOption(this,'transport.flyFrequency')"><span class="option-label">Monthly+</span></button></div></div>`;
          }
        },
        {
          title: 'Home Energy', subtitle: "Estimate your home energy use.", render(c) {
            c.innerHTML = `<div class="form-group"><label for="elec-kwh">Monthly electricity (kWh)</label><input type="number" id="elec-kwh" class="form-input" value="200" min="0" max="5000" oninput="onboardingAnswers.energy.electricityBillKwh=this.value"><p class="form-hint">Check your bill. India households average 150-300 kWh/month.</p></div><div class="form-group"><label>AC usage frequency?</label><div class="option-grid"><button class="option-card" data-value="rarely" onclick="selectOption(this,'energy.acUsage')"><span class="option-label">Rarely</span></button><button class="option-card" data-value="sometimes" onclick="selectOption(this,'energy.acUsage')"><span class="option-label">Sometimes</span></button><button class="option-card" data-value="daily" onclick="selectOption(this,'energy.acUsage')"><span class="option-label">Daily (multi-hrs)</span></button></div></div><div class="form-group"><label>Gas for cooking/heating?</label><div class="option-grid"><button class="option-card" data-value="yes" onclick="selectOption(this,'energy.hasGas');onboardingAnswers.energy.hasGas=true"><span class="option-label">Yes</span></button><button class="option-card" data-value="no" onclick="selectOption(this,'energy.hasGas');onboardingAnswers.energy.hasGas=false"><span class="option-label">No</span></button></div></div>`;
          }
        },
        {
          title: 'Food & Diet', subtitle: 'What do you eat on a typical day?', render(c) {
            c.innerHTML = `<div class="form-group"><label>What best describes your diet?</label><div class="option-grid"><button class="option-card" data-value="meat-heavy" onclick="selectOption(this,'diet.type')"><span class="option-label">Meat-heavy</span></button><button class="option-card" data-value="regular" onclick="selectOption(this,'diet.type')"><span class="option-label">Regular</span></button><button class="option-card" data-value="pescatarian" onclick="selectOption(this,'diet.type')"><span class="option-label">Pescatarian</span></button><button class="option-card" data-value="vegetarian" onclick="selectOption(this,'diet.type')"><span class="option-label">Vegetarian</span></button><button class="option-card" data-value="vegan" onclick="selectOption(this,'diet.type')"><span class="option-label">Vegan</span></button></div></div><div class="form-group"><label for="beef-week">Beef meals per week</label><input type="number" id="beef-week" class="form-input" value="3" min="0" max="21" oninput="onboardingAnswers.diet.beefPerWeek=this.value"><p class="form-hint">Beef: ~6.6 kg CO2e per meal — the highest-impact common food.</p></div>`;
          }
        },
        {
          title: 'Consumption Habits', subtitle: 'How often do you buy new things?', render(c) {
            c.innerHTML = `<div class="form-group"><label>How often do you buy new clothing?</label><div class="option-grid"><button class="option-card" data-value="monthly" onclick="selectOption(this,'consumption.clothingFreq')"><span class="option-label">Monthly</span></button><button class="option-card" data-value="quarterly" onclick="selectOption(this,'consumption.clothingFreq')"><span class="option-label">Quarterly</span></button><button class="option-card" data-value="2_year" onclick="selectOption(this,'consumption.clothingFreq')"><span class="option-label">2x/year</span></button><button class="option-card" data-value="rarely" onclick="selectOption(this,'consumption.clothingFreq')"><span class="option-label">Rarely</span></button></div></div><div class="form-group"><label>How often new electronics?</label><div class="option-grid"><button class="option-card" data-value="yearly" onclick="selectOption(this,'consumption.electronicsFreq')"><span class="option-label">Yearly</span></button><button class="option-card" data-value="2_years" onclick="selectOption(this,'consumption.electronicsFreq')"><span class="option-label">Every 2 yrs</span></button><button class="option-card" data-value="rarely" onclick="selectOption(this,'consumption.electronicsFreq')"><span class="option-label">Rarely</span></button></div></div><div class="form-group"><label>Online delivery frequency?</label><div class="option-grid"><button class="option-card" data-value="daily" onclick="selectOption(this,'consumption.deliveryFreq')"><span class="option-label">Daily</span></button><button class="option-card" data-value="2-3_weekly" onclick="selectOption(this,'consumption.deliveryFreq')"><span class="option-label">2-3x/week</span></button><button class="option-card" data-value="weekly" onclick="selectOption(this,'consumption.deliveryFreq')"><span class="option-label">Weekly</span></button><button class="option-card" data-value="2-3_monthly" onclick="selectOption(this,'consumption.deliveryFreq')"><span class="option-label">2-3x/month</span></button><button class="option-card" data-value="rarely" onclick="selectOption(this,'consumption.deliveryFreq')"><span class="option-label">Rarely</span></button></div></div>`;
          }
        },
        {
          title: 'Your Estimated Footprint', subtitle: "Here's what your daily habits add up to.", render(c) {
            const b = computeBaseline(onboardingAnswers);
            const a = b.totalAnnual, max = Math.max(a, BENCHMARKS.usAvg, BENCHMARKS.globalAvg) * 1.1;
            const comp = a < BENCHMARKS.indiaAvg ? 'below the India average — great job!' : a < BENCHMARKS.globalAvg ? 'below global average. Small changes could bring you closer to the Paris target.' : a < BENCHMARKS.usAvg ? 'around global average. You have room for reduction in your top categories.' : 'above average — but awareness is the first step.';
            c.innerHTML = `<div style="text-align:center;margin:1rem 0"><div style="font-size:2.5rem;font-weight:900;color:var(--accent-green)">${formatNum(a, 1)}</div><div style="font-size:1rem;color:var(--text-muted)">tonnes CO2e per year</div><div style="font-size:0.875rem;color:var(--text-secondary);margin-top:0.5rem">${formatNum(b.totalKg, 0)} kg/month</div></div><div class="comparison-bar-group"><div class="comparison-item"><div class="comparison-label"><span>You</span><span>${formatNum(a, 1)} t/yr</span></div><div class="comparison-bar"><div class="comparison-fill ${a > BENCHMARKS.globalAvg ? 'over' : 'you'}" style="width:0%" data-width="${Math.min(100, a / max * 100)}%"></div></div></div><div class="comparison-item"><div class="comparison-label"><span>Global Avg</span><span>${BENCHMARKS.globalAvg} t/yr</span></div><div class="comparison-bar"><div class="comparison-fill global" style="width:0%" data-width="${BENCHMARKS.globalAvg / max * 100}%"></div></div></div><div class="comparison-item"><div class="comparison-label"><span>India Avg</span><span>${BENCHMARKS.indiaAvg} t/yr</span></div><div class="comparison-bar"><div class="comparison-fill india" style="width:0%" data-width="${BENCHMARKS.indiaAvg / max * 100}%"></div></div></div><div class="comparison-item"><div class="comparison-label"><span>Paris Target</span><span>${BENCHMARKS.parisTarget} t/yr</span></div><div class="comparison-bar"><div class="comparison-fill paris" style="width:0%" data-width="${BENCHMARKS.parisTarget / max * 100}%"></div></div></div></div><div style="background:var(--accent-green-very-pale);border-radius:var(--radius);padding:1rem;margin-top:1rem;font-size:0.9375rem;color:var(--text-secondary);line-height:1.6">${comp}</div>`;
            setTimeout(() => c.querySelectorAll('[data-width]').forEach(el => el.style.width = el.dataset.width), 100);
          }
        }
      ];
  
      /**
       * Handles option selection in onboarding option grids.
       * @param {HTMLElement} el - Selected element
       * @param {string} path - Dot-notation path for the answer value
       */
      function selectOption(el, path) {
        el.parentElement.querySelectorAll('.option-card').forEach(c => c.classList.remove('selected'));
        el.classList.add('selected');
        const v = el.dataset.value, p = path.split('.');
        if (p.length === 1) onboardingAnswers[p[0]] = v;
        else { if (!onboardingAnswers[p[0]]) onboardingAnswers[p[0]] = {}; onboardingAnswers[p[0]][p[1]] = v; }
      }
  
      /**
       * Renders the current onboarding step UI.
       */
      function renderOnboarding() {
        const overlay = document.getElementById('onboarding-overlay');
        const stepsC = document.getElementById('onboarding-steps');
        const ind = document.getElementById('step-indicator');
        overlay.classList.remove('hidden');
        ind.textContent = '';
        ONBOARDING_STEPS.forEach((_, i) => { const d = document.createElement('span'); d.className = 'step-dot' + (i === onboardingStep ? ' active' : i < onboardingStep ? ' done' : ''); ind.appendChild(d); });
        const step = ONBOARDING_STEPS[onboardingStep];
        stepsC.innerHTML = `<div class="onboarding-header"><h2>${step.title}</h2><p>${step.subtitle}</p></div><div class="onboarding-step active" id="current-step-content"></div><div class="onboarding-actions">${onboardingStep > 0 ? '<button class="btn btn-secondary" onclick="prevOnboardingStep()">Back</button>' : '<span></span>'}${onboardingStep < ONBOARDING_STEPS.length - 1 ? '<button class="btn btn-primary" onclick="nextOnboardingStep()">Continue</button>' : '<button class="btn btn-primary btn-lg" onclick="completeOnboarding()">Start Tracking</button>'}</div>`;
        step.render(document.getElementById('current-step-content'));
      }
  
      /**
       * Advances to the next onboarding step.
       */
      function nextOnboardingStep() { if (onboardingStep < ONBOARDING_STEPS.length - 1) { onboardingStep++; renderOnboarding(); } }
  
      /**
       * Returns to the previous onboarding step.
       */
      function prevOnboardingStep() { if (onboardingStep > 0) { onboardingStep--; renderOnboarding(); } }
  
      /**
       * Completes onboarding and saves the profile.
       */
      function completeOnboarding() {
        const name = document.getElementById('onboard-name')?.value?.trim() || '';
        APP.profile = { name, country: onboardingAnswers.country || 'india', onboardingAnswers: { ...onboardingAnswers }, baseline: computeBaseline(onboardingAnswers) };
        saveState(APP);
        document.getElementById('onboarding-overlay').classList.add('hidden');
        checkBadges(); invalidateCache(); renderDashboard();
        showToast('Welcome to CarbonLens! Your baseline is set.', 'success');
      }
  
      // ========================================
      // SECTION 11: UI RENDERING
      // ========================================
  
      /**
       * Navigates to a section and triggers its renderer.
       * @param {string} section - Section ID
       */
      function navigateTo(section) {
        APP.currentSection = section; saveState(APP);
        document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
        document.querySelectorAll('.nav-tab').forEach(t => { t.classList.remove('active'); t.setAttribute('aria-selected', 'false'); });
        const el = document.getElementById(section);
        const tab = document.querySelector(`.nav-tab[data-section="${section}"]`);
        if (el) el.classList.add('active');
        if (tab) { tab.classList.add('active'); tab.setAttribute('aria-selected', 'true'); }
        const renderers = { dashboard: renderDashboard, 'log-activity': renderLogActivity, insights: renderInsights, recommendations: renderRecommendations, goals: renderGoals, education: renderEducation, reports: renderReports };
        if (renderers[section]) renderers[section]();
      }
  
      /**
       * Renders the Dashboard section.
       */
      function renderDashboard() {
        const c = document.getElementById('dashboard-content');
        if (!APP.profile) { c.innerHTML = '<div class="empty-state"><div class="empty-icon">\u{1F30D}</div><h3>Welcome to CarbonLens</h3><p>Let us set up your carbon footprint baseline. It takes about 2 minutes.</p><button class="btn btn-primary" onclick="renderOnboarding()" style="margin-top:1rem">Start Onboarding</button></div>'; return; }
        const name = APP.profile.name ? `, ${sanitize(APP.profile.name)}` : '';
        const b = APP.profile.baseline, ma = aggregateActivities(APP.activities, 'thisMonth');
        const total = ma.total > 0 ? ma.total : b.totalKg;
        const annual = parseFloat((total * 12 / 1000).toFixed(2));
        const qbs = [
          { action: 'car', cat: 'transport', label: 'Car trip', detail: '15 km', q: 15 },
          { action: 'bus', cat: 'transport', label: 'Bus ride', detail: '10 km', q: 10 },
          { action: 'train', cat: 'transport', label: 'Train', detail: '20 km', q: 20 },
          { action: 'ac', cat: 'energy', label: 'Used AC', detail: '1 hour', q: 1 },
          { action: 'beefMeal', cat: 'food', label: 'Beef meal', detail: '6.6 kg', q: 1 },
          { action: 'vegMeal', cat: 'food', label: 'Veg meal', detail: '0.73 kg', q: 1 },
          { action: 'onlineDelivery', cat: 'consumption', label: 'Online order', detail: '1.8 kg', q: 1 },
        ];
        const recent = APP.activities.slice(-5).reverse();
        c.innerHTML = `
      <div class="dashboard-hero"><h1>Welcome back${name}</h1><p class="hero-subtitle">Your estimated carbon footprint this month</p><div class="hero-total">${formatNum(total, 0)} <span class="hero-unit">kg CO2e</span></div><p class="hero-comparison">${annual} tonnes/year — ${annual <= BENCHMARKS.indiaAvg ? 'below India average' : annual <= BENCHMARKS.globalAvg ? 'near global average' : 'above global average'}</p></div>
      <div class="grid-3" style="margin-bottom:1.5rem"><div class="stat-card"><div class="stat-value">${formatNum(ma.transport || b.transportKg, 0)}</div><div class="stat-label">Transport (kg)</div></div><div class="stat-card"><div class="stat-value" style="color:var(--accent-gold)">${formatNum(ma.energy || b.energyKg, 0)}</div><div class="stat-label">Energy (kg)</div></div><div class="stat-card"><div class="stat-value warm">${formatNum(ma.food || b.dietKg, 0)}</div><div class="stat-label">Food (kg)</div></div></div>
      <div class="card" style="margin-bottom:1rem"><div class="card-header"><div class="card-title">Quick Log</div><a href="#" class="btn btn-sm btn-outline" onclick="event.preventDefault();navigateTo('log-activity')">Full Logger</a></div><div class="quick-log-strip" role="group" aria-label="Quick log">${qbs.map(b => `<button class="btn-quick" onclick="quickLogActivity('${b.cat}','${b.action}','${b.label}',${b.q})" aria-label="Log ${b.label}"><span class="quick-label">${b.label}</span><span class="quick-detail">${b.detail}</span></button>`).join('')}</div></div>
      <div class="card" style="margin-bottom:1rem"><div class="card-header"><div class="card-title">Category Breakdown</div></div><div class="chart-container"><canvas id="dash-donut" role="img" aria-label="Category chart"></canvas><div class="chart-accessible" id="dash-donut-alt"></div></div></div>
      <div class="card" style="margin-bottom:1rem"><div class="card-header"><div class="card-title">Recent Activities</div></div>${recent.length > 0 ? recent.map(a => renderActivityItem(a)).join('') : '<div class="empty-state"><p>No activities yet. Use Quick Log or the Log tab.</p></div>'}</div>
      <div class="tip-card"><strong>Did you know?</strong> ${getRandomTip()}</div>`;
        const dd = CATEGORIES.map(cat => ({ label: CATEGORY_LABELS[cat], value: cat === 'food' ? (ma.food || b.dietKg) : (ma[cat] || b[cat + 'Kg'] || 0), color: CATEGORY_COLORS[cat] }));
        drawDonutChart('dash-donut', dd, formatNum(total, 0));
        const alt = document.getElementById('dash-donut-alt');
        if (alt) alt.textContent = dd.map(d => `${d.label}: ${d.value} kg`).join(', ');
      }
  
      /**
       * Renders a single activity item HTML.
       * @param {Object} a - Activity record
       * @returns {string} HTML string
       */
      function renderActivityItem(a) {
        return `<div class="activity-item"><div class="activity-info"><div class="activity-label">${sanitize(a.label)}</div><div class="activity-meta">${CATEGORY_LABELS[a.category] || a.category} \u{00B7} ${formatDate(a.timestamp)}</div></div><div class="activity-co2">+${formatNum(a.co2eKg, 1)} kg</div><div class="activity-actions"><button class="btn btn-sm btn-secondary btn-icon" data-delete-activity="${a.id}" aria-label="Delete activity">\u{2715}</button></div></div>`;
      }
  
      /**
       * Renders a list of activities with virtualization support.
       * @param {Array<Object>} activities
       * @param {string} emptyText
       * @returns {string} HTML string
       */
      function renderActivityList(activities, emptyText) {
        if (!activities.length) return `<div class="empty-state"><p>${sanitize(emptyText)}</p></div>`;
        const initial = activities.slice(0, CONSTANTS.virtualActivityInitial);
        const more = activities.length - initial.length;
        return `${initial.map(a => renderActivityItem(a)).join('')}${more > 0 ? `<button class="btn btn-sm btn-secondary" style="margin-top:0.75rem" onclick="expandActivityList('${APP.activityLogCategory || 'transport'}')">Show ${more} more</button>` : ''}`;
      }
  
      /**
       * Expands a virtualized activity list to show all items.
       * @param {string} category
       */
      function expandActivityList(category) {
        const list = document.querySelector('.activity-list');
        if (!list) return;
        const items = APP.activities.filter(a => a.category === category).slice().reverse();
        list.innerHTML = items.map(a => renderActivityItem(a)).join('');
        list.classList.toggle('virtualized', items.length > CONSTANTS.virtualActivityLimit);
      }
  
      /**
       * Returns a random sustainability tip.
       * @returns {string}
       */
      function getRandomTip() {
        const t = ['Switching from beef to chicken for 2 meals/week saves ~40 kg CO2e/month — like driving 200 fewer km.', 'A single short-haul return flight produces more CO2e than most people\'s entire monthly ground transport.', 'AC at 24\u00B0 instead of 18\u00B0 uses ~30% less electricity while keeping you comfortable.', 'Manufacturing one smartphone produces ~70 kg CO2e — equal to charging it 7,000 times.', 'Second-hand clothing has near-zero additional carbon footprint.', 'Walking or cycling under 3 km avoids cold-start emissions from cars.', 'A plant-based meal produces ~17x less CO2e than a beef meal.', 'Unplugging standby devices saves 5-10% of household electricity.'];
        return t[Math.floor(Math.random() * t.length)];
      }
  
      /* LOG ACTIVITY */
  
      /**
       * Renders the Log Activity section.
       */
      function renderLogActivity() {
        const c = document.getElementById('log-content'), cat = APP.activityLogCategory || 'transport';
        const qa = {
          transport: [{ action: 'car', label: 'Drove car', dq: 15, unit: 'km' }, { action: 'bus', label: 'Took bus', dq: 10, unit: 'km' }, { action: 'train', label: 'Train/Metro', dq: 20, unit: 'km' }, { action: 'motorcycle', label: 'Motorcycle', dq: 10, unit: 'km' }, { action: 'bicycle', label: 'Bicycle', dq: 5, unit: 'km' }, { action: 'walk', label: 'Walked', dq: 3, unit: 'km' }],
          energy: [{ action: 'ac', label: 'Used AC', dq: 2, unit: 'hours' }, { action: 'heater', label: 'Heater', dq: 3, unit: 'hours' }, { action: 'electricity', label: 'Electricity', dq: 10, unit: 'kWh' }, { action: 'natural_gas', label: 'Gas cooking', dq: 1, unit: 'hours' }],
          food: [{ action: 'beefMeal', label: 'Beef meal', dq: 1, unit: 'meal' }, { action: 'chickenMeal', label: 'Chicken', dq: 1, unit: 'meal' }, { action: 'fishMeal', label: 'Fish', dq: 1, unit: 'meal' }, { action: 'porkMeal', label: 'Pork', dq: 1, unit: 'meal' }, { action: 'vegMeal', label: 'Vegetarian', dq: 1, unit: 'meal' }, { action: 'veganMeal', label: 'Vegan', dq: 1, unit: 'meal' }],
          consumption: [{ action: 'clothingItem', label: 'Bought clothing', dq: 1, unit: 'item' }, { action: 'shoesPair', label: 'Shoes', dq: 1, unit: 'pair' }, { action: 'smartphone', label: 'New phone', dq: 1, unit: 'item' }, { action: 'onlineDelivery', label: 'Online order', dq: 1, unit: 'order' }, { action: 'electronicsOther', label: 'Electronics', dq: 1, unit: 'item' }],
        };
        const habits = APP.recurringHabits.filter(h => h.category === cat);
        const recent = APP.activities.filter(a => a.category === cat).slice().reverse();
        c.innerHTML = `<div class="card" style="margin-bottom:1rem"><div class="card-header"><div class="card-title">Log Activity</div><button class="btn btn-sm btn-secondary" onclick="undoLastAction()" ${APP.undoStack?.length ? '' : 'disabled style="opacity:0.5"'}>Undo</button></div><div class="category-tabs" role="tablist" aria-label="Activity categories">${CATEGORIES.map(cc => `<button class="category-tab ${cc === cat ? 'active' : ''}" role="tab" data-category="${cc}" aria-selected="${cc === cat}" tabindex="${cc === cat ? '0' : '-1'}" onclick="switchLogCategory('${cc}')">${CATEGORY_LABELS[cc]}</button>`).join('')}</div><div class="grid-4" role="group">${(qa[cat] || []).map(a => `<button class="btn-quick" onclick="logQuickActivity('${cat}','${a.action}','${a.label}',${a.dq},'${a.unit}')" aria-label="Log ${a.label}"><span class="quick-label">${a.label}</span><span class="quick-detail">Default: ${a.dq} ${a.unit}</span></button>`).join('')}</div><div style="margin-top:1rem;display:flex;gap:0.5rem;flex-wrap:wrap"><button class="btn btn-sm btn-secondary" onclick="openCustomLogModal('${cat}')">Custom Entry</button><button class="btn btn-sm btn-outline" onclick="addHabitTemplate('${cat}')">Habit Template</button></div></div>${habits.length > 0 ? `<div class="card" style="margin-bottom:1rem"><div class="card-header"><div class="card-title">Recurring Habits</div></div>${habits.map(h => `<div class="habit-item"><div><div style="font-weight:600">${sanitize(h.label)}</div><div style="font-size:0.8125rem;color:var(--text-muted)">${h.quantity} ${h.unit} \u{00B7} ${h.recurrenceInterval}</div></div><div style="display:flex;align-items:center;gap:0.75rem"><span class="badge badge-green">${formatNum(h.co2eKg, 1)} kg</span><button class="toggle ${h.enabled !== false ? 'on' : ''}" onclick="toggleHabit('${h.id}')" aria-label="Toggle"></button><button class="btn btn-sm btn-secondary" onclick="deleteHabit('${h.id}')">\u{2715}</button></div></div>`).join('')}</div>` : ''}<div class="card"><div class="card-header"><div class="card-title">Recent ${CATEGORY_LABELS[cat]}</div><span class="badge badge-muted">${recent.length} total</span></div><div class="activity-list ${recent.length > CONSTANTS.virtualActivityLimit ? 'virtualized' : ''}" role="status">${renderActivityList(recent, `No ${CATEGORY_LABELS[cat].toLowerCase()} activities yet.`)}</div></div>`;
      }
  
      /**
       * Switches the active log category.
       * @param {string} cat
       */
      function switchLogCategory(cat) { APP.activityLogCategory = cat; saveState(APP); renderLogActivity(); }
  
      /**
       * Logs an activity with the given parameters.
       * @param {string} category
       * @param {string} action
       * @param {string} label
       * @param {number} quantity
       * @param {string} unit
       */
      function logQuickActivity(category, action, label, quantity, unit) {
        const co2e = calculateCO2e(category, action, quantity);
        const activity = { id: uid(), timestamp: Date.now(), category, action, label, co2eKg: co2e, quantity, unit };
        APP.activities.push(activity); rememberUndo('addActivity', activity);
        updateStreak(); checkBadges(); saveState(APP); invalidateCache();
        showToast(`Logged: ${label} (+${formatNum(co2e, 1)} kg CO2e)`, 'success');
        if (APP.currentSection === 'dashboard') renderDashboard();
        if (APP.currentSection === 'log-activity') renderLogActivity();
      }
  
      /**
       * Quick-log wrapper that infers the unit from the action.
       * @param {string} cat
       * @param {string} action
       * @param {string} label
       * @param {number} q
       */
      function quickLogActivity(cat, action, label, q) {
        const um = { car: 'km', bus: 'km', train: 'km', motorcycle: 'km', bicycle: 'km', walk: 'km', ac: 'hours', heater: 'hours', beefMeal: 'meal', vegMeal: 'meal', onlineDelivery: 'order' };
        logQuickActivity(cat, action, label, q, um[action] || 'unit');
      }
  
      /**
       * Calculates CO2e for a given category, action, and quantity.
       * @param {string} category
       * @param {string} action
       * @param {number} quantity
       * @returns {number}
       */
      function calculateCO2e(category, action, quantity) {
        if (category === 'transport') return calcTransport(action, quantity);
        if (category === 'energy') return calcEnergy(action, quantity);
        if (category === 'food') return calcFood(action) * Math.max(1, quantity);
        if (category === 'consumption') return calcConsumption(action, quantity);
        return 0;
      }
  
      /**
       * Deletes an activity by ID.
       * @param {string} id
       */
      function deleteActivity(id) {
        const deleted = APP.activities.find(a => a.id === id);
        APP.activities = APP.activities.filter(a => a.id !== id);
        if (deleted) rememberUndo('deleteActivity', deleted);
        saveState(APP); invalidateCache();
        showToast('Activity deleted.', 'success');
        if (APP.currentSection === 'dashboard') renderDashboard();
        if (APP.currentSection === 'log-activity') renderLogActivity();
      }
  
      /**
       * Opens the custom activity modal for the given category.
       * @param {string} category
       */
      function openCustomLogModal(category) {
        const m = document.getElementById('custom-activity-modal');
        document.getElementById('modal-title').textContent = `Custom ${CATEGORY_LABELS[category]}`;
        document.getElementById('modal-form').innerHTML = `
      <div class="form-group"><label for="cl">Description</label><input type="text" id="cl" class="form-input" placeholder="e.g., Drove to office" maxlength="100"><div class="form-error" id="cl-err">Please enter a description.</div></div>
      <div class="form-row"><div class="form-group"><label for="cq">Quantity</label><input type="number" id="cq" class="form-input" min="0" step="any" value="1"><div class="form-error" id="cq-err">Enter a valid number.</div></div><div class="form-group"><label for="cu">Unit</label><select id="cu" class="form-select">${category === 'transport' ? '<option>km</option>' : category === 'energy' ? '<option>hours</option><option>kWh</option>' : category === 'food' ? '<option>meals</option>' : '<option>items</option><option>orders</option>'}</select></div></div>
      <div class="form-group"><label for="cco2">CO2e (kg) <span style="color:var(--text-muted);font-weight:400">optional</span></label><input type="number" id="cco2" class="form-input" placeholder="Auto-calculated" min="0" step="any"></div>
      <div class="form-group"><label style="display:flex;align-items:center;gap:0.5rem;cursor:pointer"><input type="checkbox" id="crec">Set as recurring habit</label></div>
      <div id="rec-opts" style="display:none"><div class="form-group"><label for="crecv">Repeat every</label><select id="crecv" class="form-select"><option value="daily">Day</option><option value="weekly">Week</option><option value="monthly">Month</option></select></div></div>
      <div style="display:flex;gap:0.75rem;justify-content:flex-end;margin-top:1rem"><button class="btn btn-secondary" onclick="closeCustomModal()">Cancel</button><button class="btn btn-primary" onclick="submitCustom('${category}')">Log Activity</button></div>`;
        m.classList.remove('hidden');
        setTimeout(() => { const chk = document.getElementById('crec'); if (chk) chk.onchange = () => { document.getElementById('rec-opts').style.display = chk.checked ? 'block' : 'none' }; }, 0);
      }
  
      /**
       * Closes the custom activity modal.
       */
      function closeCustomModal() { document.getElementById('custom-activity-modal').classList.add('hidden'); }
  
      /**
       * Submits a custom activity from the modal form.
       * @param {string} category
       */
      function submitCustom(category) {
        const label = document.getElementById('cl').value.trim(), qty = parseFloat(document.getElementById('cq').value), unit = document.getElementById('cu').value;
        const customCO2 = parseFloat(document.getElementById('cco2').value) || null;
        const isRec = document.getElementById('crec')?.checked || false, recv = document.getElementById('crecv')?.value || 'daily';
        let ok = true;
        if (!label) { document.getElementById('cl-err').classList.add('visible'); ok = false; } else { document.getElementById('cl-err').classList.remove('visible'); }
        if (isNaN(qty) || qty < 0) { document.getElementById('cq-err').classList.add('visible'); ok = false; } else { document.getElementById('cq-err').classList.remove('visible'); }
        if (!ok) return;
        const co2e = customCO2 !== null ? customCO2 : calculateCO2e(category, 'custom', qty);
        const activity = { id: uid(), timestamp: Date.now(), category, action: 'custom', label, co2eKg: co2e, quantity: qty, unit };
        APP.activities.push(activity); rememberUndo('addActivity', activity);
        if (isRec) APP.recurringHabits.push({ id: uid(), category, action: 'custom', label, co2eKg: co2e, quantity: qty, unit, recurrenceInterval: recv, enabled: true });
        updateStreak(); checkBadges(); saveState(APP); invalidateCache(); closeCustomModal();
        showToast(`Logged: ${label} (+${formatNum(co2e, 1)} kg)${isRec ? ' — recurring!' : ''}`, 'success');
        if (APP.currentSection === 'log-activity') renderLogActivity();
        if (APP.currentSection === 'dashboard') renderDashboard();
      }
  
      /**
       * Toggles a recurring habit on/off.
       * @param {string} id
       */
      function toggleHabit(id) { const h = APP.recurringHabits.find(x => x.id === id); if (h) { h.enabled = !h.enabled; saveState(APP); renderLogActivity(); } }
  
      /**
       * Deletes a recurring habit.
       * @param {string} id
       */
      function deleteHabit(id) { APP.recurringHabits = APP.recurringHabits.filter(x => x.id !== id); saveState(APP); renderLogActivity(); showToast('Habit removed.', 'success'); }
  
      /**
       * Adds a default habit template for the given category.
       * @param {string} category
       */
      function addHabitTemplate(category) {
        const templates = {
          transport: { action: 'bus', label: 'Weekday bus commute', quantity: 10, unit: 'km', recurrenceInterval: 'daily' },
          energy: { action: 'ac', label: 'Evening AC use', quantity: 2, unit: 'hours', recurrenceInterval: 'daily' },
          food: { action: 'vegMeal', label: 'Vegetarian lunch', quantity: 1, unit: 'meal', recurrenceInterval: 'daily' },
          consumption: { action: 'onlineDelivery', label: 'Weekly online delivery', quantity: 1, unit: 'order', recurrenceInterval: 'weekly' },
        };
        const t = templates[category];
        if (!t) return;
        const co2e = calculateCO2e(category, t.action, t.quantity);
        APP.recurringHabits.push({ id: uid(), category, ...t, co2eKg: co2e, enabled: true });
        saveState(APP); renderLogActivity(); showToast('Habit template added.', 'success');
      }
  
      /* INSIGHTS */
  
      /**
       * Renders the Insights section.
       */
      function renderInsights() {
        const c = document.getElementById('insights-content');
        if (!APP.profile) { c.innerHTML = '<div class="empty-state"><h3>Complete onboarding first</h3></div>'; return; }
        const b = APP.profile.baseline, ma = aggregateActivities(APP.activities, 'thisMonth'), has = APP.activities.length > 0;
        const t = ma.transport || b.transportKg, e = ma.energy || b.energyKg, f = ma.food || b.dietKg, cn = ma.consumption || b.consumptionKg;
        const total = has ? ma.total : b.totalKg;
        const big = getBiggestCategory({ transport: t, energy: e, food: f, consumption: cn });
        const recs = generateRecommendations(), qw = recs[0] || null;
        const trees = Math.ceil(total / EQUIVALENTS.treeAbsorbMonthly), km = Math.round(total * EQUIVALENTS.drivingKmPerKg), ch = Math.round(total * EQUIVALENTS.phoneChargesPerKg);
        const bigReasons = { transport: 'Commute and travel choices have the largest impact. Consider public transit or active transport.', energy: 'Home energy — especially cooling — is your largest category. Small efficiency improvements add up.', food: 'Food choices, especially meat, contribute the most. Even partial plant-based shifts create meaningful reductions.', consumption: 'Purchasing habits have the largest impact. Buying less, second-hand, and extending lifespans are most effective.' };
        c.innerHTML = `<h2 style="font-size:1.25rem;font-weight:800;margin-bottom:1rem">Your Insights</h2>
      <div class="grid-2" style="margin-bottom:1rem"><div class="card"><div class="card-header"><div class="card-title">Category Breakdown</div></div><div class="chart-container"><canvas id="ins-donut" role="img" aria-label="Insights category breakdown chart"></canvas><div class="chart-accessible" id="ins-donut-alt"></div></div></div><div><div class="insight-highlight" style="margin-bottom:0.75rem"><h3><span aria-hidden="true">\u{26A0}</span> Biggest Contributor</h3><p><strong>${CATEGORY_LABELS[big.category]}</strong> — ${total > 0 ? Math.round(big.kg / total * 100) : 0}% (${formatNum(big.kg, 0)} kg). ${bigReasons[big.category]}</p></div>${qw ? `<div class="insight-win"><h3><span aria-hidden="true">\u{2B50}</span> Best Quick Win</h3><p><strong>${qw.title}</strong> — saves ~<strong>${formatNum(qw.savingsKg, 1)} kg/month</strong>. Effort: ${qw.effort}.</p><a href="#" class="btn btn-sm btn-outline" onclick="event.preventDefault();navigateTo('recommendations')" style="margin-top:0.5rem">All Recommendations</a></div>` : ''}</div></div>
      <div class="card" style="margin-bottom:1rem"><div class="card-header"><div class="card-title">Trend</div><div style="display:flex;gap:0.5rem"><button class="btn btn-sm ${APP.insightsPeriod === 'weekly' ? 'btn-primary' : 'btn-secondary'}" onclick="APP.insightsPeriod='weekly';saveState(APP);renderInsights()">Weekly</button><button class="btn btn-sm ${APP.insightsPeriod === 'monthly' ? 'btn-primary' : 'btn-secondary'}" onclick="APP.insightsPeriod='monthly';saveState(APP);renderInsights()">Monthly</button></div></div><div class="chart-container"><canvas id="ins-line" role="img" aria-label="Carbon footprint trend chart"></canvas><div class="chart-accessible" id="ins-line-alt"></div></div></div>
      <div class="card" style="margin-bottom:1rem"><div class="card-header"><div class="card-title">How You Compare</div></div><div class="chart-container"><canvas id="ins-bar" role="img" aria-label="Footprint benchmark comparison chart"></canvas><div class="chart-accessible" id="ins-bar-alt"></div></div></div>
      <div class="card"><div class="card-header"><div class="card-title">What Does This Mean?</div></div><div class="equivalents-grid"><div class="equivalent-item"><div class="equivalent-value">${formatNum(trees, 0)}</div><div class="equivalent-label">Trees/month to absorb</div></div><div class="equivalent-item"><div class="equivalent-value">${formatNum(km, 0)}</div><div class="equivalent-label">Equivalent km driven</div></div><div class="equivalent-item"><div class="equivalent-value">${formatNum(ch, 0)}</div><div class="equivalent-label">Phone charges equiv.</div></div></div></div>`;
        const dd = [{ label: 'Transport', value: t, color: CATEGORY_COLORS.transport }, { label: 'Energy', value: e, color: CATEGORY_COLORS.energy }, { label: 'Food', value: f, color: CATEGORY_COLORS.food }, { label: 'Consumption', value: cn, color: CATEGORY_COLORS.consumption }];
        drawDonutChart('ins-donut', dd, formatNum(total, 0));
        document.getElementById('ins-donut-alt').textContent = dd.map(d => `${d.label}: ${formatNum(d.value, 0)} kg`).join(', ');
        const trend = APP.insightsPeriod === 'weekly' ? aggregateByWeek(APP.activities, 12) : aggregateByMonth(APP.activities, 6);
        drawLineChart('ins-line', trend, '#2D6A4F');
        document.getElementById('ins-line-alt').textContent = trend.map(d => `${d.label}: ${d.value} kg`).join('. ');
        const ann = parseFloat((total * 12 / 1000).toFixed(2));
        drawBarChart('ins-bar', [{ label: 'You', value: ann, color: '#2D6A4F', valueText: ann.toFixed(1) + ' t/yr' }, { label: 'India Avg', value: BENCHMARKS.indiaAvg, color: '#F2CC8F', valueText: BENCHMARKS.indiaAvg + ' t/yr' }, { label: 'Global Avg', value: BENCHMARKS.globalAvg, color: '#DDA15E', valueText: BENCHMARKS.globalAvg + ' t/yr' }, { label: 'Paris Target', value: BENCHMARKS.parisTarget, color: '#52B788', valueText: BENCHMARKS.parisTarget + ' t/yr' }]);
        document.getElementById('ins-bar-alt').textContent = `You: ${ann}t. India: ${BENCHMARKS.indiaAvg}t. Global: ${BENCHMARKS.globalAvg}t. Paris: ${BENCHMARKS.parisTarget}t.`;
      }
  
      /* RECOMMENDATIONS */
  
      /**
       * Renders the Recommendations section.
       */
      function renderRecommendations() {
        const c = document.getElementById('recommendations-content'), recs = generateRecommendations();
        if (!APP.profile) { c.innerHTML = '<div class="empty-state"><h3>Complete onboarding first</h3></div>'; return; }
        const agg = aggregateActivities(APP.activities, 'thisMonth'), b = APP.profile.baseline, total = agg.total > 0 ? agg.total : b.totalKg;
        const big = getBiggestCategory(agg);
        c.innerHTML = `<div style="margin-bottom:1rem"><h2 style="font-size:1.25rem;font-weight:800">Personalized Recommendations</h2><p style="color:var(--text-secondary);font-size:0.9375rem">Generated from your actual data — not generic tips.</p></div><div class="tip-card" style="margin-bottom:1rem"><strong>Your profile:</strong> ${formatNum(total, 0)} kg/month. ${big.category === 'transport' ? 'Transport dominates — focus there.' : big.category === 'food' ? 'Food is your biggest lever — dietary changes are effective.' : big.category === 'energy' ? 'Energy efficiency improvements pay off fast.' : 'Consumption habits lead — buying less matters most.'}</div>${recs.length > 0 ? recs.map(r => { const ic = APP.recommendationsCommitted.some(x => x.recId === r.id); return `<div class="rec-card" style="margin-bottom:0.75rem"><div class="rec-header"><div><div class="rec-title">${sanitize(r.title)}</div><span class="badge badge-${r.effort === 'easy' ? 'green' : r.effort === 'medium' ? 'gold' : 'warm'}" style="margin-top:0.375rem">${r.effort}</span></div><span class="badge badge-green">${CATEGORY_LABELS[r.category]}</span></div><p class="rec-desc">${sanitize(r.description)}</p><div class="rec-savings">\u{2B07} ~${formatNum(r.savingsKg, 1)} kg CO2e/month</div><p class="rec-reason">Your data: ${sanitize(r.reason)}</p><div class="rec-footer">${ic ? '<span class="rec-committed">\u{2705} Committed!</span>' : `<button class="btn btn-sm btn-primary" onclick="commitRecommendation('${r.id}')">Commit</button>`}</div></div>`; }).join('') : '<div class="empty-state"><p>No recommendations yet. Log activities to get personalized suggestions.</p></div>'}`;
      }
  
      /**
       * Commits to a recommendation.
       * @param {string} id
       */
      function commitRecommendation(id) {
        if (!APP.recommendationsCommitted.some(c => c.recId === id)) { APP.recommendationsCommitted.push({ recId: id, committedDate: Date.now(), followUps: [] }); saveState(APP); checkBadges(); showToast('Recommendation committed!', 'success'); renderRecommendations(); }
      }
  
      /* GOALS */
  
      /**
       * Renders the Goals section.
       */
      function renderGoals() {
        const c = document.getElementById('goals-content');
        if (!APP.profile) { c.innerHTML = '<div class="empty-state"><h3>Complete onboarding first</h3></div>'; return; }
        const s = APP.streak, r = APP.goals ? calculateReductionPercent() : 0;
        c.innerHTML = `<h2 style="font-size:1.25rem;font-weight:800;margin-bottom:1rem">Goals & Progress</h2>
      <div class="grid-2" style="margin-bottom:1rem"><div class="streak-card"><div class="streak-number">${s.current}</div><div class="streak-label">Day Streak</div><div style="font-size:0.8125rem;color:var(--text-muted);margin-top:0.5rem">Best: ${s.best}</div></div><div class="stat-card"><div class="stat-value">${APP.activities.length}</div><div class="stat-label">Activities Logged</div></div></div>
      <div class="card" style="margin-bottom:1rem"><div class="card-header"><div class="card-title">Reduction Goal</div></div>${APP.goals ? `<div style="margin-bottom:1rem"><div style="display:flex;justify-content:space-between;font-size:0.875rem;margin-bottom:0.5rem"><span>Current: ${formatNum(r, 1)}%</span><span>Target: ${APP.goals.targetReductionPercent}%</span></div><div class="progress-track"><div class="progress-fill" style="width:${Math.min(100, r / APP.goals.targetReductionPercent * 100)}%"></div></div><p style="font-size:0.8125rem;color:var(--text-muted);margin-top:0.5rem">${r >= APP.goals.targetReductionPercent ? 'Target achieved!' : `${formatNum(APP.goals.targetReductionPercent - r, 1)}% to go. Keep it up!`}</p></div><div style="display:flex;gap:0.5rem"><button class="btn btn-sm btn-secondary" onclick="editGoal()">Adjust</button><button class="btn btn-sm btn-secondary" onclick="APP.goals=null;saveState(APP);renderGoals()">Remove</button></div>` : `<div class="form-group"><label>Reduce footprint by</label><div class="form-row"><div><input type="number" id="gp" class="form-input" min="1" max="80" value="15"><span style="font-size:0.875rem;color:var(--text-muted)">%</span></div><div><select id="gm" class="form-select"><option value="3">3 months</option><option value="6" selected>6 months</option><option value="12">12 months</option></select></div></div></div><button class="btn btn-primary" onclick="setGoal()">Set Goal</button>`}</div>
      <div class="card"><div class="card-header"><div class="card-title">Badges</div><span class="badge badge-muted">${APP.badges.length}/${BADGE_DEFS.length}</span></div><div class="badge-grid">${BADGE_DEFS.map(b => `<div class="badge-card ${APP.badges.includes(b.id) ? 'unlocked' : ''}" title="${sanitize(b.criteria)}"><div class="badge-icon">${b.icon}</div><div class="badge-name">${b.name}</div><div class="badge-criteria">${APP.badges.includes(b.id) ? 'Unlocked!' : b.criteria}</div></div>`).join('')}</div></div>`;
      }
  
      /**
       * Sets a reduction goal from form values.
       */
      function setGoal() {
        const p = parseInt(document.getElementById('gp').value) || 15, m = parseInt(document.getElementById('gm').value) || 6;
        if (p < 1 || p > 80) { showToast('Enter 1-80%.', 'warning'); return; }
        APP.goals = { targetReductionPercent: p, targetMonths: m, startDate: Date.now(), currentReductionPercent: 0 };
        saveState(APP); checkBadges(); renderGoals(); showToast(`Goal: ${p}% reduction in ${m} months.`, 'success');
      }
  
      /**
       * Edits the current reduction goal.
       */
      function editGoal() {
        if (!APP.goals) return;
        const n = prompt('New reduction target (1-80):', APP.goals.targetReductionPercent);
        if (n !== null) { const p = parseInt(n); if (p >= 1 && p <= 80) { APP.goals.targetReductionPercent = p; saveState(APP); renderGoals(); showToast('Goal updated!', 'success'); } else showToast('Enter 1-80%.', 'warning'); }
      }
  
      /* EDUCATION */
  
      /**
       * Renders the Education section.
       */
      function renderEducation() {
        const c = document.getElementById('education-content');
        c.innerHTML = `<h2 style="font-size:1.25rem;font-weight:800;margin-bottom:1rem">Learn & Understand</h2><p style="color:var(--text-secondary);margin-bottom:1.25rem">Understanding the "why" behind emissions helps you make better choices.</p>
      <div style="margin-bottom:1.5rem">${EDUCATION_SECTIONS.map(s => `<div class="accordion-item" id="edu-${s.id}"><button class="accordion-trigger ${APP.educationRead.includes(s.id) ? 'open' : ''}" onclick="toggleAccordion('edu-${s.id}')" aria-expanded="${APP.educationRead.includes(s.id)}" aria-controls="edu-${s.id}-body"><span>${s.title}</span><svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg></button><div class="accordion-body ${APP.educationRead.includes(s.id) ? 'open' : ''}" id="edu-${s.id}-body"><div class="accordion-content">${APP.educationRead.includes(s.id) ? s.content : ''}</div></div></div>`).join('')}</div>
      <h3 style="font-size:1.1rem;font-weight:700;margin-bottom:0.75rem">Myth Busting</h3><p style="color:var(--text-secondary);font-size:0.9375rem;margin-bottom:1rem">Common misconceptions — and what evidence actually says.</p>${MYTHS.map(m => `<div class="myth-card"><div class="myth-title">${sanitize(m.myth)}</div><div class="myth-fact">${sanitize(m.fact)}</div></div>`).join('')}`;
      }
  
      /**
       * Toggles an accordion item open/closed.
       * @param {string} id
       */
      function toggleAccordion(id) {
        const item = document.getElementById(id), trigger = item.querySelector('.accordion-trigger'), body = item.querySelector('.accordion-body');
        const open = body.classList.contains('open');
        const sid = id.replace('edu-', '');
        const section = EDUCATION_SECTIONS.find(s => s.id === sid);
        const content = item.querySelector('.accordion-content');
        if (!open && section && content && !content.innerHTML.trim()) content.innerHTML = section.content;
        body.classList.toggle('open'); trigger.classList.toggle('open'); trigger.setAttribute('aria-expanded', !open);
        if (!open && !APP.educationRead.includes(sid)) { APP.educationRead.push(sid); saveState(APP); checkBadges(); }
      }
  
      /* REPORTS */
  
      /**
       * Renders the Reports section.
       */
      function renderReports() {
        const c = document.getElementById('reports-content');
        if (!APP.profile) { c.innerHTML = '<div class="empty-state"><h3>Complete onboarding first</h3></div>'; return; }
        const rp = APP.reportPeriod, mn = MONTH_NAMES[rp.month], now = new Date();
        const pa = APP.activities.filter(a => { const d = new Date(a.timestamp); return d.getMonth() === rp.month && d.getFullYear() === rp.year; });
        const pag = aggregateActivities(pa), b = APP.profile.baseline, tw = pag.total > 0 ? pag.total : b.totalKg;
        const pm = rp.month === 0 ? 11 : rp.month - 1, py = rp.month === 0 ? rp.year - 1 : rp.year;
        const prev = APP.activities.filter(a => { const d = new Date(a.timestamp); return d.getMonth() === pm && d.getFullYear() === py; });
        const pvg = aggregateActivities(prev);
        const chgBase = b.totalKg > 0 ? ((tw - b.totalKg) / b.totalKg * 100) : 0;
        const chgPrev = pvg.total > 0 ? ((tw - pvg.total) / pvg.total * 100) : 0;
        const st = generateShareText(rp, tw, chgBase, pag, b);
        c.innerHTML = `<div class="report-header"><h2 style="font-size:1.25rem;font-weight:800">Carbon Report</h2><div class="report-period-nav"><button class="btn btn-sm btn-secondary" onclick="shiftReportPeriod(-1)">&larr;</button><span style="font-weight:700;min-width:140px;text-align:center">${mn} ${rp.year}</span><button class="btn btn-sm btn-secondary" onclick="shiftReportPeriod(1)" ${rp.month >= now.getMonth() && rp.year >= now.getFullYear() ? 'disabled style="opacity:0.4"' : ''}>&rarr;</button></div></div>
      <div class="report-summary-card"><div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:1rem"><div><div style="font-size:2rem;font-weight:900">${formatNum(tw, 0)} kg</div><div style="opacity:0.8">CO2e — ${mn} ${rp.year}</div></div><div style="text-align:right"><div style="font-size:1.25rem;font-weight:700">${chgBase > 0 ? '+' : ''}${formatNum(chgBase, 1)}%</div><div style="opacity:0.7;font-size:0.875rem">vs baseline</div></div></div>${pvg.total > 0 ? `<div style="margin-top:1rem;padding-top:1rem;border-top:1px solid rgba(255,255,255,0.2);font-size:0.875rem;opacity:0.85">vs ${MONTH_NAMES[pm]} ${py}: ${chgPrev > 0 ? '+' : ''}${formatNum(chgPrev, 1)}%</div>` : ''}</div>
      <div class="grid-4" style="margin-bottom:1rem"><div class="stat-card"><div class="stat-value">${formatNum(pag.transport || b.transportKg, 0)}</div><div class="stat-label">Transport</div></div><div class="stat-card"><div class="stat-value" style="color:var(--accent-gold)">${formatNum(pag.energy || b.energyKg, 0)}</div><div class="stat-label">Energy</div></div><div class="stat-card"><div class="stat-value warm">${formatNum(pag.food || b.dietKg, 0)}</div><div class="stat-label">Food</div></div><div class="stat-card"><div class="stat-value" style="color:var(--accent-green-light)">${formatNum(pag.consumption || b.consumptionKg, 0)}</div><div class="stat-label">Consumption</div></div></div>
      <div class="card" style="margin-bottom:1rem"><div class="card-header"><div class="card-title">Monthly Trend</div></div><div class="chart-container"><canvas id="rpt-line" role="img" aria-label="Monthly carbon trend chart"></canvas></div></div>
      <div class="card" style="margin-bottom:1rem"><div class="card-header"><div class="card-title">Summary</div></div><div style="font-size:0.9375rem;color:var(--text-secondary);line-height:1.7"><p><strong>Activities:</strong> ${pa.length} | <strong>Committed recs:</strong> ${APP.recommendationsCommitted.length} | <strong>Badges:</strong> ${APP.badges.length} | <strong>Streak:</strong> ${APP.streak.current} days</p>${chgBase < 0 ? `<p style="color:var(--accent-green);font-weight:600;margin-top:0.5rem">${formatNum(Math.abs(chgBase), 1)}% below baseline — great progress!</p>` : chgBase > 0 ? `<p style="color:var(--accent-warm);margin-top:0.5rem">${formatNum(chgBase, 1)}% above baseline. Check Tips for ways to reduce.</p>` : '<p>At baseline level. Small daily changes shift this over time.</p>'}</div></div>
      <div class="card"><div class="card-header"><div class="card-title">Share</div></div><div class="report-export-area"><textarea id="rpt-text" readonly aria-label="Shareable text">${st}</textarea><div style="margin-top:0.5rem;display:flex;gap:0.5rem;flex-wrap:wrap"><button class="btn btn-sm btn-primary" onclick="copyReport()">Copy to Clipboard</button><button class="btn btn-sm btn-secondary" onclick="exportReportJSON()">Export Report JSON</button><button class="btn btn-sm btn-secondary" onclick="exportActivitiesCSV()">Export Activities CSV</button></div></div></div>`;
        drawLineChart('rpt-line', aggregateByMonth(APP.activities, 6), '#2D6A4F');
      }
  
      /**
       * Shifts the report period by a number of months.
       * @param {number} d - Direction (-1 or 1)
       */
      function shiftReportPeriod(d) {
        let m = APP.reportPeriod.month + d, y = APP.reportPeriod.year;
        if (m < 0) { m = 11; y--; } if (m > 11) { m = 0; y++; }
        const now = new Date(); if (y > now.getFullYear() || (y === now.getFullYear() && m > now.getMonth())) return;
        APP.reportPeriod = { month: m, year: y }; saveState(APP); renderReports();
      }
  
      /**
       * Generates shareable report text.
       * @param {Object} rp - Report period
       * @param {number} total
       * @param {number} chg
       * @param {Object} agg
       * @param {Object} b - Baseline
       * @returns {string}
       */
      function generateShareText(rp, total, chg, agg, b) {
        return `Carbon Footprint Report — ${MONTH_NAMES[rp.month]} ${rp.year}\nTotal: ${formatNum(total, 0)} kg CO2e (${parseFloat((total * 12 / 1000).toFixed(2))} t/yr)\nvs baseline: ${chg > 0 ? '+' : ''}${formatNum(chg, 1)}%\nTransport: ${formatNum(agg.transport || b.transportKg, 0)}kg | Energy: ${formatNum(agg.energy || b.energyKg, 0)}kg | Food: ${formatNum(agg.food || b.dietKg, 0)}kg | Consumption: ${formatNum(agg.consumption || b.consumptionKg, 0)}kg\nGenerated by CarbonLens`;
      }
  
      /**
       * Copies the report text to the clipboard.
       */
      function copyReport() {
        const ta = document.getElementById('rpt-text');
        if (ta) { ta.select(); navigator.clipboard.writeText(ta.value).then(() => showToast('Copied!', 'success')).catch(() => { document.execCommand('copy'); showToast('Copied!', 'success'); }); }
      }
  
      /**
       * Exports the current report as JSON.
       */
      function exportReportJSON() {
        if (!APP.profile) { showToast('Complete onboarding first.', 'warning'); return; }
        const rp = APP.reportPeriod;
        const activities = APP.activities.filter(a => { const d = new Date(a.timestamp); return d.getMonth() === rp.month && d.getFullYear() === rp.year; });
        const summary = aggregateActivities(activities);
        downloadFile(`carbonlens_report_${rp.year}_${String(rp.month + 1).padStart(2, '0')}.json`, JSON.stringify({ period: rp, summary, activities, generatedAt: new Date().toISOString() }, null, 2), 'application/json');
        showToast('Report exported as JSON.', 'success');
      }
  
      // ========================================
      // SECTION 12: SELF-TEST SUITE
      // ========================================
  
      /**
       * Toggles the self-test panel visibility.
       */
      function toggleSelfTest() { const p = document.getElementById('self-test-panel'); p.classList.toggle('visible'); if (p.classList.contains('visible')) runSelfTests(); }
  
      /**
       * Toggles the problem alignment note in the footer.
       */
      function toggleAlignment() { const n = document.getElementById('alignment-note'); const show = n.style.display === 'none'; n.style.display = show ? 'block' : 'none'; n.previousElementSibling.setAttribute('aria-expanded', show); }
  
      /**
       * Runs the comprehensive self-test suite.
       * @returns {Object} Test results { passed, failed }
       */
      function runSelfTests() {
        const r = document.getElementById('self-test-results'); r.textContent = '';
        let passed = 0, failed = 0;
  
        /**
         * Asserts a condition and logs the result.
         * @param {string} n - Test name
         * @param {boolean} ok - Condition
         */
        function assert(n, ok) { const pass = !!ok; r.innerHTML += `<div class="test-result"><span class="${pass ? 'test-pass' : 'test-fail'}">${pass ? '\u{2705}' : '\u{274C}'}</span> ${sanitize(n)}</div>`; if (pass) passed++; else failed++; }
  
        // Emission factor constants
        assert('EF.car = 0.21', EF.car === 0.21);
        assert('EF.bus = 0.089', EF.bus === 0.089);
        assert('EF.beefMeal = 6.61', EF.beefMeal === 6.61);
        assert('EF.veganMeal = 0.39', EF.veganMeal === 0.39);
        assert('EF.walk = 0', EF.walk === 0);
        assert('EF.electricityIndia = 0.82', EF.electricityIndia === 0.82);
  
        // Transport calculations
        assert('calcTransport(car,30) = 6.3', Math.abs(calcTransport('car', 30) - 6.3) < 0.01);
        assert('calcTransport(bus,10) = 0.89', Math.abs(calcTransport('bus', 10) - 0.89) < 0.01);
        assert('calcTransport(walk,5) = 0', calcTransport('walk', 5) === 0);
        assert('calcTransport(car,0) = 0', calcTransport('car', 0) === 0);
        assert('calcTransport(car,-5) = 0', calcTransport('car', -5) === 0);
  
        // Energy calculations
        assert('calcEnergy(ac,1) = 1.23', Math.abs(calcEnergy('ac', 1) - 1.23) < 0.01);
        assert('calcEnergy(electricity,100) = 82', Math.abs(calcEnergy('electricity', 100) - 82) < 0.001);
  
        // Food and consumption
        assert('calcFood(beefMeal) = 6.61', calcFood('beefMeal') === 6.61);
        assert('calcConsumption(clothing,1) = 20', calcConsumption('clothingItem', 1) === 20);
        assert('calcConsumption(clothing,0) = 20 (min 1)', calcConsumption('clothingItem', 0) === 20);
  
        // Storage integrity
        try { localStorage.setItem('_cl_t', 'ok'); assert('localStorage write', true); assert('localStorage read', localStorage.getItem('_cl_t') === 'ok'); localStorage.removeItem('_cl_t'); } catch (e) { assert('localStorage write', false); assert('localStorage read', false); }
  
        // State management
        assert('loadState is object', typeof loadState() === 'object');
        assert('Default activities is array', Array.isArray(loadState().activities));
  
        // Aggregation
        const ta = [{ id: '1', timestamp: Date.now(), category: 'transport', action: 'car', label: 't', co2eKg: 10 }, { id: '2', timestamp: Date.now(), category: 'food', action: 'beefMeal', label: 't', co2eKg: 6.61 }];
        const ag = aggregateActivities(ta);
        assert('Aggregation transport=10', Math.abs(ag.transport - 10) < 0.001);
        assert('Aggregation total=16.61', Math.abs(ag.total - 16.61) < 0.001);
        assert('Empty aggregation total=0', aggregateActivities([]).total === 0);
  
        // Baseline computation
        const bl = computeBaseline({ transport: { mode: 'car', commuteKm: 15, flyFrequency: 'never' }, energy: { electricityBillKwh: 200, acUsage: 'sometimes', hasGas: false }, diet: { type: 'regular', beefPerWeek: 3 }, consumption: { clothingFreq: 'quarterly', electronicsFreq: '2_years', deliveryFreq: 'weekly' } });
        assert('Baseline total > 0', bl.totalKg > 0);
  
        // Recommendations
        const recs = generateRecommendations();
        assert('Recs generated', recs.length > 0);
        if (recs.length >= 2) { const ep = { easy: 0, medium: 0.1, hard: 0.25 }; assert('Recs ranked', recs[0].savingsKg * (1 - ep[recs[0].effort]) >= recs[1].savingsKg * (1 - ep[recs[1].effort])); }
  
        // Security / utilities
        assert('Sanitize strips HTML', sanitize('<scr' + 'ipt>x</scr' + 'ipt>') !== '<scr' + 'ipt>x</scr' + 'ipt>');
        assert('formatNum(1234) works', formatNum(1234) === '1,234');
        assert('formatNum(null)=0', formatNum(null) === '0');
  
        // Data integrity
        assert('Badges defined', BADGE_DEFS.length >= 12);
        assert('Education sections=5', EDUCATION_SECTIONS.length === 5);
        assert('Myths >=5', MYTHS.length >= 5);
        assert('Constants include undo limit', CONSTANTS.undoLimit === 5);
        assert('CSV escaping quotes', csvEscape('a"b') === '"a""b"');
        assert('CSV parser reads rows', parseCSV('a,b\n1,2').length === 2);
        assert('Electricity factors available', ELECTRICITY_FACTORS.india === EF.electricityIndia);
  
        // Cache behavior
        const oldChartVersion = CHART_CACHE_VERSION; invalidateChartCache();
        assert('Chart cache invalidates', CHART_CACHE_VERSION === oldChartVersion + 1);
  
        // Accessibility
        assert('Skip link exists', !!document.querySelector('.skip-link'));
        assert('Settings modal exists', !!document.getElementById('settings-modal'));
        assert('Dashboard canvas has aria-label when rendered', !document.getElementById('dash-donut') || !!document.getElementById('dash-donut').getAttribute('aria-label'));
        assert('Category tab keyboard metadata present', !document.querySelector('.category-tab') || !!document.querySelector('.category-tab').dataset.category);
  
        // State shape
        assert('Undo stack is array', Array.isArray(APP.undoStack));
        assert('Preferences object exists', !!APP.preferences && typeof APP.preferences.theme === 'string');
  
        // Summary
        r.innerHTML += `<div style="margin-top:1rem;padding:0.75rem;border-radius:8px;font-weight:700;text-align:center;background:${failed === 0 ? 'var(--accent-green-pale)' : '#FFE5E0'};color:${failed === 0 ? 'var(--accent-green)' : 'var(--accent-warm)'}">${passed} passed, ${failed} failed of ${passed + failed}</div>`;
        return { passed, failed };
      }
  
      // ========================================
      // SECTION 13: INIT
      // ========================================
  
      document.addEventListener('click', e => {
        const deleteButton = e.target.closest('[data-delete-activity]');
        if (deleteButton) deleteActivity(deleteButton.dataset.deleteActivity);
      });
  
      document.addEventListener('keydown', e => {
        if (e.ctrlKey && e.shiftKey && e.key === 'T') { e.preventDefault(); toggleSelfTest(); }
        if (e.key === 'Escape') {
          closeCustomModal(); closeSettings();
          const p = document.getElementById('self-test-panel');
          if (p.classList.contains('visible')) p.classList.remove('visible');
        }
  
        const activeTab = document.activeElement?.classList?.contains('category-tab') ? document.activeElement : null;
        if (activeTab && (e.key === 'ArrowRight' || e.key === 'ArrowLeft' || e.key === 'Home' || e.key === 'End')) {
          const tabs = Array.from(document.querySelectorAll('.category-tab'));
          const index = tabs.indexOf(activeTab);
          let nextIndex = index;
          if (e.key === 'ArrowRight') nextIndex = (index + 1) % tabs.length;
          if (e.key === 'ArrowLeft') nextIndex = (index - 1 + tabs.length) % tabs.length;
          if (e.key === 'Home') nextIndex = 0;
          if (e.key === 'End') nextIndex = tabs.length - 1;
          e.preventDefault(); tabs[nextIndex].focus(); switchLogCategory(tabs[nextIndex].dataset.category);
        }
  
        const accordion = document.activeElement?.classList?.contains('accordion-trigger') ? document.activeElement : null;
        if (accordion && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          accordion.click();
        }
      });
  
      /**
       * Processes recurring habits and auto-logs them if due.
       */
      function processRecurringHabits() {
        const today = new Date().toDateString();
        APP.recurringHabits.forEach(h => {
          if (h.enabled === false) return;
          const lr = h.lastRunDate ? new Date(h.lastRunDate).toDateString() : null;
          if (lr === today) return;
          let run = false;
          if (!lr) run = true;
          else if (h.recurrenceInterval === 'daily') run = true;
          else if (h.recurrenceInterval === 'weekly') run = Math.floor((Date.now() - new Date(h.lastRunDate).getTime()) / 86400000) >= 7;
          else if (h.recurrenceInterval === 'monthly') { const ld = new Date(h.lastRunDate); run = ld.getMonth() !== new Date().getMonth(); }
          if (run) { APP.activities.push({ id: uid(), timestamp: Date.now(), category: h.category, action: h.action, label: h.label + ' (recurring)', co2eKg: h.co2eKg, quantity: h.quantity, unit: h.unit }); h.lastRunDate = Date.now(); updateStreak(); }
        });
        saveState(APP);
      }
  
      /**
       * Initializes the application.
       */
      function init() {
        APP.preferences = { ...getDefaultState().preferences, ...(APP.preferences || {}) };
        applyThemePreference();
        processRecurringHabits(); updateStreak(); checkBadges();
        if (!APP.profile) renderDashboard();
        else navigateTo(APP.currentSection);
      }
  
      init();
  
      let resizeTimer;
      window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
          invalidateChartCache();
          requestAnimationFrame(() => {
            const s = APP.currentSection;
            if (s === 'dashboard') renderDashboard();
            else if (s === 'insights') renderInsights();
            else if (s === 'reports') renderReports();
          });
        }, CONSTANTS.chartDebounceMs);
      });
      window.addEventListener('beforeunload', flushState);