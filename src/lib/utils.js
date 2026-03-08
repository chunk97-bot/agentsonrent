/**
 * AgentRent - Utility Functions
 */

/**
 * Show toast notification
 * @param {string} type - 'success' | 'error' | 'info'
 * @param {string} message - Message to display
 */
export function showToast(type, message) {
    const container = document.getElementById('toast-container');

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    const icon = type === 'success' ? '✓' : type === 'error' ? '✕' : 'ℹ';
    toast.innerHTML = `<span>${icon}</span><span>${message}</span>`;

    container.appendChild(toast);

    // Auto remove after 4 seconds
    setTimeout(() => {
        toast.style.animation = 'slideIn 0.3s ease reverse';
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

/**
 * Format wallet address for display
 * @param {string} address - Full wallet address
 * @returns {string} - Shortened address (e.g., "So1a...xyz")
 */
export function formatAddress(address) {
    if (!address) return '';
    return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

/**
 * Format rating for display
 * @param {number} rating - Rating value (0-5)
 * @returns {string} - Formatted rating
 */
export function formatRating(rating) {
    return rating.toFixed(1);
}

/**
 * Format price with currency
 * @param {number} price - Price value
 * @param {string} currency - Currency code
 * @returns {string} - Formatted price
 */
export function formatPrice(price, currency = 'USDC') {
    return `${price} ${currency}`;
}

/**
 * Format time duration
 * @param {number} hours - Duration in hours
 * @returns {string} - Human readable duration
 */
export function formatDuration(hours) {
    if (hours < 1) {
        return `${Math.round(hours * 60)}m`;
    } else if (hours < 24) {
        return `${hours}h`;
    } else {
        const days = Math.floor(hours / 24);
        return `${days}d`;
    }
}

/**
 * Validate email address
 * @param {string} email - Email to validate
 * @returns {boolean}
 */
export function isValidEmail(email) {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(email);
}

/**
 * Debounce function calls
 * @param {Function} func - Function to debounce
 * @param {number} wait - Wait time in ms
 * @returns {Function}
 */
export function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

/**
 * Escape HTML to prevent XSS attacks
 * @param {string} str - String to escape
 * @returns {string} - Escaped string
 */
export function escapeHtml(str) {
    if (str == null) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

/**
 * Convert base58 signature to hex string
 * @param {Uint8Array} signature - Signature bytes
 * @returns {string} - Hex string
 */
export function signatureToHex(signature) {
    return Array.from(signature)
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
}

/**
 * Generate unique ID
 * @returns {string}
 */
export function generateId() {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Copy text to clipboard
 * @param {string} text - Text to copy
 */
export async function copyToClipboard(text) {
    try {
        await navigator.clipboard.writeText(text);
        showToast('success', 'Copied to clipboard');
    } catch {
        showToast('error', 'Failed to copy');
    }
}

/**
 * Format large numbers
 * @param {number} num - Number to format
 * @returns {string} - Formatted number (e.g., "1.2K", "3.5M")
 */
export function formatNumber(num) {
    if (num >= 1000000) {
        return (num / 1000000).toFixed(1) + 'M';
    } else if (num >= 1000) {
        return (num / 1000).toFixed(1) + 'K';
    }
    return num.toString();
}

/**
 * Calculate time ago
 * @param {Date|string} date - Date to compare
 * @returns {string} - Human readable time ago
 */
export function timeAgo(date) {
    const seconds = Math.floor((new Date() - new Date(date)) / 1000);

    const intervals = {
        year: 31536000,
        month: 2592000,
        week: 604800,
        day: 86400,
        hour: 3600,
        minute: 60
    };

    for (const [unit, secondsInUnit] of Object.entries(intervals)) {
        const interval = Math.floor(seconds / secondsInUnit);
        if (interval >= 1) {
            return `${interval} ${unit}${interval > 1 ? 's' : ''} ago`;
        }
    }

    return 'Just now';
}
