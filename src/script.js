const CACHE_NAME = "data-cache-v1";

// Primary sources (GitHub)
const GITHUB = "https://raw.githubusercontent.com/jinix6/ItemID/main/";
const GITHUB_BACKUP = "https://raw.githubusercontent.com/ShahGCreator/icon/main/PNG/";

// Additional fallback sources (like the Flask API uses)
const FALLBACK_SOURCES = {
  cdn: [
    GITHUB + "assets/cdn.json",
    GITHUB_BACKUP + "cdn.json",
    "https://ff-item.netlify.app/cdn.json",
    "https://raw.githubusercontent.com/0xme/ff-resources/main/cdn.json"
  ],
  pngs: [
    GITHUB + "assets/pngs.json",
    "https://raw.githubusercontent.com/0xme/ff-resources/refs/heads/main/pngs/300x300/list.json",
    "https://ff-item.netlify.app/pngs.json",
    "https://raw.githubusercontent.com/ShahGCreator/icon/main/PNG/list.json"
  ],
  itemData: [
    GITHUB + "assets/itemData.json",
    "https://ff-item.netlify.app/data.msgpack.gz", // Note: this needs msgpack decoding
    "https://raw.githubusercontent.com/ShahGCreator/icon/main/itemData.json",
    "https://raw.githubusercontent.com/0xme/ff-resources/main/itemData.json"
  ]
};

// ─── Smart Fetch with Retries ────────────────────────────────────────────────

async function smartFetch(url, cacheName, retries = 3, delay = 1000) {
  // Try cache first
  const cache = await caches.open(cacheName);
  const cachedResponse = await cache.match(url);
  
  if (cachedResponse) {
    try {
      const data = await cachedResponse.arrayBuffer();
      return data;
    } catch (e) {
      // If cached data is corrupted, remove it and fetch fresh
      await cache.delete(url);
    }
  }

  // Fetch with retries
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const response = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0" },
        timeout: 15000
      });
      
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      
      const data = await response.arrayBuffer();
      
      // Cache the successful response
      try {
        const cache = await caches.open(cacheName);
        await cache.put(url, new Response(data, {
          headers: { 'Cache-Control': 'public, max-age=86400' }
        }));
      } catch (e) {
        console.warn('Cache write failed:', e);
      }
      
      return data;
    } catch (err) {
      console.warn(`Attempt ${attempt + 1}/${retries} failed for ${url}:`, err);
      if (attempt < retries - 1) {
        await new Promise(resolve => setTimeout(resolve, delay * (attempt + 1)));
      } else {
        throw err;
      }
    }
  }
}

// ─── Fetch with Multiple Fallback Sources ────────────────────────────────

async function fetchJSONWithFallback(sources, isMsgPack = false) {
  const errors = [];
  
  for (const source of sources) {
    try {
      let data;
      
      if (isMsgPack && source.endsWith('.msgpack.gz')) {
        // Handle msgpack.gz like the Flask API does
        const response = await fetch(source);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        
        const compressed = await response.arrayBuffer();
        const decompressed = pako.ungzip(new Uint8Array(compressed));
        const parsed = msgpack.decode(decompressed);
        
        // Convert array to object keyed by itemID (like Flask API)
        if (Array.isArray(parsed)) {
          const map = {};
          parsed.forEach(item => {
            if (item.itemID || item.id) {
              map[String(item.itemID || item.id)] = item;
            }
          });
          return map;
        }
        return parsed;
      } else {
        // Regular JSON fetch
        data = await smartFetch(source, CACHE_NAME);
        const text = new TextDecoder().decode(data);
        return JSON.parse(text);
      }
    } catch (err) {
      errors.push(`[${source}] ${err.message}`);
      console.warn(`Fallback failed for: ${source}`, err);
      // Continue to next source
    }
  }
  
  throw new Error(`All sources failed. Errors: ${errors.join('; ')}`);
}

// ─── Data Processing Helpers ──────────────────────────────────────────────

function processCDNData(data) {
  // Handle different data formats
  if (Array.isArray(data)) {
    // If it's an array of objects, merge them
    return data.reduce((map, obj) => Object.assign(map, obj), {});
  } else if (typeof data === 'object') {
    // If it's already a key-value object
    return data;
  }
  return {};
}

function processItemData(data) {
  // Ensure item data is in a consistent format
  if (Array.isArray(data)) {
    const map = {};
    data.forEach(item => {
      const id = String(item.itemID || item.id || '');
      if (id) map[id] = item;
    });
    return map;
  } else if (typeof data === 'object') {
    return data;
  }
  return {};
}

// ─── Main Data Loading ────────────────────────────────────────────────────

async function loadAllData() {
  try {
    // Load CDN data
    const cdnData = await fetchJSONWithFallback(FALLBACK_SOURCES.cdn)
      .catch(() => ({}));
    const cdn_img_json = processCDNData(cdnData);
    
    // Load PNGs list
    const pngsData = await fetchJSONWithFallback(FALLBACK_SOURCES.pngs)
      .catch(() => ({}));
    const pngs_json_list = Array.isArray(pngsData) ? pngsData : 
                           Object.values(pngsData).flat() || [];
    
    // Load Item Data (with msgpack support)
    const itemDataRaw = await fetchJSONWithFallback(FALLBACK_SOURCES.itemData, true)
      .catch(() => ({}));
    const itemData = processItemData(itemDataRaw);
    
    return { cdn_img_json, pngs_json_list, itemData };
  } catch (error) {
    console.error("Error fetching data:", error);
    throw error;
  }
}

// ─── Usage ─────────────────────────────────────────────────────────────────

// Load all data with retry mechanism
async function initializeApp() {
  const loadingIndicator = document.querySelector('.loading-indicator');
  if (loadingIndicator) {
    loadingIndicator.textContent = 'Loading data from multiple sources...';
  }
  
  let retryCount = 0;
  const maxRetries = 3;
  
  while (retryCount < maxRetries) {
    try {
      const data = await loadAllData();
      
      // Assign to global variables
      window.cdn_img_json = data.cdn_img_json;
      window.pngs_json_list = data.pngs_json_list;
      window.itemData = data.itemData;
      
      if (loadingIndicator) {
        loadingIndicator.textContent = 'Data loaded successfully!';
        setTimeout(() => {
          loadingIndicator.style.display = 'none';
        }, 1000);
      }
      
      // Call your display function
      if (typeof handleDisplayBasedOnURL === 'function') {
        handleDisplayBasedOnURL();
      }
      
      return data;
      
    } catch (error) {
      retryCount++;
      console.error(`Attempt ${retryCount} failed:`, error);
      
      if (retryCount < maxRetries) {
        const delay = 2000 * retryCount;
        console.log(`Retrying in ${delay/1000}s...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        // All retries failed
        if (loadingIndicator) {
          loadingIndicator.textContent = '⚠️ Failed to load data. Please refresh or check console for details.';
        }
        throw error;
      }
    }
  }
}

// ─── Start the Application ──────────────────────────────────────────────────

// If you need to include msgpack and pako libraries:
// Add these script tags to your HTML:
// <script src="https://cdn.jsdelivr.net/npm/pako@2.1.0/dist/pako.min.js"></script>
// <script src="https://cdn.jsdelivr.net/npm/@msgpack/msgpack@3.0.0/dist/msgpack.min.js"></script>

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeApp);
} else {
  initializeApp();
}