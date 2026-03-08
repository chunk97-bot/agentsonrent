/**
 * AgentRent - Main Application
 * Production version - Uses real API, no mock data
 */

import { WalletAdapter } from './wallet.js';
import { ApiClient } from './api-client.js';
import { showToast, formatAddress, formatRating, escapeHtml } from './utils.js';

// Initialize
const wallet = new WalletAdapter();
const api = new ApiClient();

// State
let currentWallet = null;
let agents = [];
let currentCategory = '';
let searchQuery = '';
let isLoading = false;

// Platform Stats (fetched from API)
let platformStats = {
    agentCount: 0,
    totalFeesEarned: 0,
    jobsCompleted: 0,
    waitlistCount: 0
};

// DOM Ready
document.addEventListener('DOMContentLoaded', () => {
    initWallet();
    initWaitlist();
    loadAgents();
    loadPlatformStats();
    initSearch();
    initModal();
    
    // Listen for wallet events
    wallet.on('disconnect', () => {
        currentWallet = null;
        updateWalletUI(null);
        showToast('info', 'Wallet disconnected');
    });

    wallet.on('accountChanged', (address) => {
        currentWallet = address;
        updateWalletUI(address);
        showToast('info', `Account changed: ${formatAddress(address)}`);
    });
});

// ============================================
// Wallet Integration
// ============================================

function initWallet() {
    const connectBtn = document.getElementById('connect-wallet');

    connectBtn.addEventListener('click', () => {
        if (currentWallet) {
            disconnectWallet();
        } else {
            document.getElementById('wallet-modal').classList.remove('hidden');
        }
    });

    // Wallet option buttons
    document.querySelectorAll('.wallet-option').forEach(btn => {
        btn.addEventListener('click', async () => {
            const walletType = btn.dataset.wallet;
            await connectWallet(walletType);
        });
    });

    // Check for existing connection
    checkExistingConnection();
}

async function connectWallet(walletType) {
    const btn = document.querySelector(`[data-wallet="${walletType}"]`);
    const originalContent = btn.innerHTML;
    
    try {
        // Show loading state
        btn.innerHTML = '<span class="spinner"></span> Connecting...';
        btn.disabled = true;

        const address = await wallet.connect(walletType);
        
        if (address) {
            currentWallet = address;
            updateWalletUI(address);
            closeWalletModal();
            showToast('success', `Connected: ${formatAddress(address)}`);
            
            // Check SOL balance
            try {
                const { hasEnough, balance } = await wallet.checkSufficientBalance(0.01);
                if (!hasEnough) {
                    showToast('warning', `Low SOL balance (${balance.toFixed(4)} SOL). You need at least 0.01 SOL for transaction fees.`);
                }
            } catch (e) {
                console.warn('Balance check failed:', e);
            }
        }
    } catch (error) {
        showToast('error', error.message || 'Failed to connect wallet');
    } finally {
        btn.innerHTML = originalContent;
        btn.disabled = false;
    }
}

async function disconnectWallet() {
    await wallet.disconnect();
    currentWallet = null;
    document.getElementById('connect-wallet').textContent = 'Connect Wallet';
    showToast('success', 'Wallet disconnected');
}

function updateWalletUI(address) {
    const connectBtn = document.getElementById('connect-wallet');
    if (address) {
        connectBtn.textContent = formatAddress(address);
        connectBtn.classList.add('connected');
    } else {
        connectBtn.textContent = 'Connect Wallet';
        connectBtn.classList.remove('connected');
    }
}

async function checkExistingConnection() {
    try {
        const address = await wallet.checkConnection();
        if (address) {
            currentWallet = address;
            updateWalletUI(address);
        }
    } catch (e) {
        console.warn('Auto-reconnect failed:', e);
    }
}

// ============================================
// Platform Stats
// ============================================

async function loadPlatformStats() {
    try {
        const response = await api.getStats();
        if (response) {
            platformStats = response;
            updateStatsUI();
        }
    } catch (error) {
        console.warn('Failed to load stats:', error);
        // Show zeros if API fails
        updateStatsUI();
    }
}

function updateStatsUI() {
    const agentCountEl = document.getElementById('agent-count');
    const feesEarnedEl = document.getElementById('fees-earned');
    const jobsCompletedEl = document.getElementById('jobs-completed');
    const waitlistNumberEl = document.getElementById('waitlist-number');

    if (agentCountEl) agentCountEl.textContent = platformStats.agentCount || 0;
    if (feesEarnedEl) feesEarnedEl.textContent = `$${(platformStats.totalFeesEarned || 0).toLocaleString()}`;
    if (jobsCompletedEl) jobsCompletedEl.textContent = (platformStats.jobsCompleted || 0).toLocaleString();
    if (waitlistNumberEl) waitlistNumberEl.textContent = (platformStats.waitlistCount || 0).toLocaleString();
}

// ============================================
// Waitlist Form
// ============================================

function initWaitlist() {
    const form = document.getElementById('waitlist-form');
    const emailInput = document.getElementById('waitlist-email');

    if (!form) return;

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = emailInput.value.trim();

        if (!email) return;

        const submitBtn = form.querySelector('button[type="submit"]');
        const originalText = submitBtn.textContent;
        
        try {
            submitBtn.disabled = true;
            submitBtn.textContent = 'Joining...';

            await api.joinWaitlist(email);
            showToast('success', 'You\'re on the waitlist! 🎉');
            emailInput.value = '';

            // Refresh stats to get new waitlist count
            await loadPlatformStats();
        } catch (error) {
            showToast('error', error.message || 'Failed to join waitlist');
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = originalText;
        }
    });
}

// ============================================
// Agent Grid
// ============================================

async function loadAgents() {
    const grid = document.getElementById('agents-grid');
    
    // Show loading state
    grid.innerHTML = `
        <div class="agent-card loading">
            <div class="skeleton skeleton-avatar"></div>
            <div class="skeleton skeleton-text"></div>
            <div class="skeleton skeleton-text short"></div>
        </div>
        <div class="agent-card loading">
            <div class="skeleton skeleton-avatar"></div>
            <div class="skeleton skeleton-text"></div>
            <div class="skeleton skeleton-text short"></div>
        </div>
        <div class="agent-card loading">
            <div class="skeleton skeleton-avatar"></div>
            <div class="skeleton skeleton-text"></div>
            <div class="skeleton skeleton-text short"></div>
        </div>
    `;
    
    isLoading = true;

    try {
        const response = await api.getAgents();
        agents = response.agents ? Object.values(response.agents) : [];
        renderAgents(agents);
    } catch (error) {
        console.error('Failed to load agents:', error);
        grid.innerHTML = `
            <div class="no-results">
                <p>Failed to load agents. <button class="btn btn-secondary" onclick="location.reload()">Retry</button></p>
            </div>
        `;
    } finally {
        isLoading = false;
    }
}

function renderAgents(agentList) {
    const grid = document.getElementById('agents-grid');

    if (!agentList || agentList.length === 0) {
        grid.innerHTML = `
            <div class="no-results">
                <div class="empty-state">
                    <span class="empty-icon">🤖</span>
                    <h3>No Agents Yet</h3>
                    <p>Be the first to list your AI agent and start earning!</p>
                    <a href="#list-agent" class="btn btn-primary">Launch Your Agent</a>
                </div>
            </div>
        `;
        return;
    }

    grid.innerHTML = agentList.map(agent => createAgentCard(agent)).join('');

    // Add click handlers
    grid.querySelectorAll('.btn-rent').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const agentId = e.target.dataset.agentId;
            handleRentClick(agentId);
        });
    });
}

function createAgentCard(agent) {
    const name = escapeHtml(agent.name || agent.profile?.name || 'Unnamed Agent');
    const description = escapeHtml(agent.description || agent.profile?.description || 'AI Agent');
    const avatar = agent.avatar || agent.profile?.avatar || '🤖';
    const category = agent.category || agent.profile?.category || 'other';
    const rating = agent.rating || 0;
    const reviewCount = agent.reviewCount || 0;
    const jobsCompleted = agent.jobsCompleted || 0;
    const isOnline = agent.isOnline !== false;
    const services = agent.services || [];

    const servicesHtml = services.slice(0, 2).map(service => `
        <div class="service-tag">
            <span>${escapeHtml(service.name)}</span>
            <span class="service-price">${service.price} ${service.currency || 'USDC'}</span>
        </div>
    `).join('');

    const statusDot = isOnline
        ? '<span class="status-dot online">●</span>'
        : '<span class="status-dot offline">●</span>';

    return `
        <div class="agent-card" data-agent-id="${escapeHtml(agent.id)}">
            <div class="agent-header">
                <div class="agent-avatar">${avatar}</div>
                <div>
                    <div class="agent-name">${name}</div>
                    <div class="agent-rating">
                        <span class="star">★</span>
                        <span>${rating.toFixed(1)}</span>
                        <span class="review-count">(${reviewCount.toLocaleString()})</span>
                    </div>
                </div>
                <span class="category-badge">${escapeHtml(category)}</span>
            </div>
            <p class="agent-description">${description}</p>
            <div class="agent-services">
                ${servicesHtml}
                ${services.length > 2 ? `<span class="more-services">+${services.length - 2} more</span>` : ''}
            </div>
            <div class="agent-footer">
                <div class="agent-meta">
                    ${statusDot} ${isOnline ? 'Online' : 'Offline'} · ${jobsCompleted} jobs
                </div>
                <button class="btn btn-primary btn-rent" data-agent-id="${escapeHtml(agent.id)}">
                    Rent
                </button>
            </div>
        </div>
    `;
}

async function handleRentClick(agentId) {
    if (!currentWallet) {
        document.getElementById('wallet-modal').classList.remove('hidden');
        showToast('info', 'Connect wallet to rent agents');
        return;
    }

    // Check balance before proceeding
    try {
        const { hasEnough, balance } = await wallet.checkSufficientBalance(0.01);
        if (!hasEnough) {
            showToast('error', `Insufficient SOL balance (${balance.toFixed(4)} SOL). You need at least 0.01 SOL for transaction fees.`);
            return;
        }
    } catch (e) {
        console.warn('Balance check failed:', e);
    }

    // Navigate to agent detail page or show modal
    const agent = agents.find(a => a.id === agentId);
    if (agent) {
        // For now, show a toast. In production, navigate to agent page
        showToast('info', `Opening ${agent.name || 'Agent'}... (Feature coming soon)`);
        // window.location.href = `/agent/${agentId}`;
    }
}

// ============================================
// Search & Filter
// ============================================

function initSearch() {
    const searchInput = document.getElementById('agent-search');
    const categorySelect = document.getElementById('category-filter');

    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            searchQuery = e.target.value.toLowerCase();
            filterAgents();
        });
    }

    if (categorySelect) {
        categorySelect.addEventListener('change', (e) => {
            currentCategory = e.target.value;
            filterAgents();
        });
    }
}

function filterAgents() {
    let filtered = agents;

    if (currentCategory) {
        filtered = filtered.filter(a => 
            (a.category || a.profile?.category) === currentCategory
        );
    }

    if (searchQuery) {
        filtered = filtered.filter(a => {
            const name = (a.name || a.profile?.name || '').toLowerCase();
            const desc = (a.description || a.profile?.description || '').toLowerCase();
            const services = a.services || [];
            
            return name.includes(searchQuery) ||
                   desc.includes(searchQuery) ||
                   services.some(s => s.name.toLowerCase().includes(searchQuery));
        });
    }

    renderAgents(filtered);
}

// ============================================
// Modal
// ============================================

function initModal() {
    const modal = document.getElementById('wallet-modal');
    const closeBtn = document.getElementById('close-wallet-modal');

    if (!modal || !closeBtn) return;

    closeBtn.addEventListener('click', closeWalletModal);

    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            closeWalletModal();
        }
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeWalletModal();
        }
    });
}

function closeWalletModal() {
    const modal = document.getElementById('wallet-modal');
    if (modal) {
        modal.classList.add('hidden');
    }
}

// ============================================
// Load More
// ============================================

const loadMoreBtn = document.getElementById('load-more-agents');
if (loadMoreBtn) {
    loadMoreBtn.addEventListener('click', async () => {
        if (isLoading) return;
        
        // In production, implement pagination
        showToast('info', 'All agents loaded');
    });
}

console.log('🤖 AgentRent Production v1.0');
