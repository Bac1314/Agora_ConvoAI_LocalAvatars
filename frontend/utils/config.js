const CONFIG = {
    API_BASE_URL: window.location.origin,
    DEFAULT_USER_NAME: 'User',
    // Authentication credentials for API access
    AUTH_USERNAME: window.APP_AUTH_USERNAME || '',
    AUTH_PASSWORD: window.APP_AUTH_PASSWORD || '',

    // VRM Avatar Configuration
    VRM_MODEL_URL: '/assets/avatars/Milk.vrm',
    VRM_CDN: {
        THREE: 'https://cdn.jsdelivr.net/npm/three@0.168.0/build/three.module.js',
        THREE_ADDONS: 'https://cdn.jsdelivr.net/npm/three@0.168.0/examples/jsm/',
        THREE_VRM: 'https://cdn.jsdelivr.net/npm/@pixiv/three-vrm@3.2.0/lib/three-vrm.module.js',
    },
    AVAILABLE_AVATARS: [
        { name: 'Milk', file: '/assets/avatars/Milk.vrm' },
        { name: 'Butter', file: '/assets/avatars/Butter.vrm' },
        { name: 'Camome', file: '/assets/avatars/CamomeCamome.vrm' },
        { name: 'Coolbanana', file: '/assets/avatars/Coolbanana.vrm' },
        { name: 'Coolbee', file: '/assets/avatars/Coolbee.vrm' },
        { name: 'Hotdog', file: '/assets/avatars/Hotdog.vrm' },
        { name: 'Juanita', file: '/assets/avatars/Juanita.vrm' },
        { name: 'Mr Squirrel', file: '/assets/avatars/Mrsquirrel.vrm' },
    ],
};

const API = {
    async request(endpoint, options = {}) {
        const url = `${CONFIG.API_BASE_URL}/api${endpoint}`;
        const headers = {
            'Content-Type': 'application/json',
            ...options.headers
        };

        const authUsername = CONFIG.AUTH_USERNAME || '';
        const authPassword = CONFIG.AUTH_PASSWORD || '';

        if (authUsername && authPassword) {
            const credentials = btoa(`${authUsername}:${authPassword}`);
            headers['Authorization'] = `Basic ${credentials}`;
        }

        const config = {
            headers,
            ...options
        };

        try {
            const response = await fetch(url, config);
            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || `HTTP ${response.status}`);
            }

            return data;
        } catch (error) {
            console.error(`API request failed: ${endpoint}`, error);
            throw error;
        }
    },

    agora: {
        getChannelInfo: (channel, uid) =>
            API.request(`/agora/channel-info?channel=${channel}&uid=${uid}`),

        startConversation: (data) =>
            API.request('/agora/start', {
                method: 'POST',
                body: JSON.stringify(data)
            }),

        stopConversation: (agentId) =>
            API.request(`/agora/stop/${agentId}`, {
                method: 'DELETE'
            })
    },
};

const STORAGE = {
    get: (key, defaultValue = null) => {
        try {
            const value = localStorage.getItem(key);
            return value ? JSON.parse(value) : defaultValue;
        } catch {
            return defaultValue;
        }
    },

    set: (key, value) => {
        try {
            localStorage.setItem(key, JSON.stringify(value));
        } catch (error) {
            console.warn('Failed to save to localStorage:', error);
        }
    },

    remove: (key) => {
        try {
            localStorage.removeItem(key);
        } catch (error) {
            console.warn('Failed to remove from localStorage:', error);
        }
    }
};

const UTILS = {
    generateChannelName: () => `channeName-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,

    formatTime: (date = new Date()) => {
        return date.toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit'
        });
    },

    showToast: (message, type = 'info') => {
        console.log(`[${type.toUpperCase()}] ${message}`);
    }
};
