/**
 * AgentRent - Main Application (Simplified)
 * Clean agent rental marketplace
 */

import { WalletAdapter } from './wallet.js';
import { showToast, formatAddress, formatRating, escapeHtml } from './utils.js';

// API base URL
const API_BASE = 'https://agentrent-api.chunky199701.workers.dev';

// Initialize wallet
const wallet = new WalletAdapter();

// State
let currentWallet = null;
let agents = [];
let currentCategory = '';
let searchQuery = '';

// DOM Ready
document.addEventListener('DOMContentLoaded', () => {
    initWallet();
    initWaitlist();
    loadAgents();
    loadStats();
    initSearch();
    initModals();
    initRegisterForm();

    // Wallet events
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
// Wallet
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
        btn.innerHTML = '<span class="spinner"></span> Connecting...';
        btn.disabled = true;

        const address = await wallet.connect(walletType);
        
        if (address) {
            currentWallet = address;
            updateWalletUI(address);
            closeModal('wallet-modal');
            showToast('success', `Connected: ${formatAddress(address)}`);
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
// Stats
// ============================================

async function loadStats() {
    try {
        const response = await fetch(`${API_BASE}/api/v1/stats`);
        const data = await response.json();

        document.getElementById('agent-count').textContent = data.agentCount || 0;
        document.getElementById('jobs-completed').textContent = data.jobsCompleted || 0;
        document.getElementById('total-earnings').textContent = `$${(data.totalEarnings || 0).toLocaleString()}`;
        
        const waitlistEl = document.getElementById('waitlist-number');
        if (waitlistEl) {
            waitlistEl.textContent = data.waitlistCount || 0;
        }
    } catch (error) {
        console.warn('Failed to load stats:', error);
    }
}

// ============================================
// Waitlist
// ============================================

function initWaitlist() {
    const form = document.getElementById('waitlist-form');
    if (!form) return;

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const emailInput = document.getElementById('waitlist-email');
        const email = emailInput.value.trim();

        if (!email) return;

        const submitBtn = form.querySelector('button[type="submit"]');
        const originalText = submitBtn.textContent;

        try {
            submitBtn.disabled = true;
            submitBtn.textContent = 'Joining...';

            const response = await fetch(`${API_BASE}/api/v1/waitlist`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email })
            });

            const data = await response.json();
            if (!response.ok) {
                throw new Error(data.error || 'Failed to join waitlist');
            }

            showToast('success', 'You\'re on the waitlist!');
            emailInput.value = '';
            loadStats(); // Refresh stats
        } catch (error) {
            showToast('error', error.message);
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = originalText;
        }
    });
}

// ============================================
// Agents
// ============================================

async function loadAgents() {
    const grid = document.getElementById('agents-grid');
    grid.innerHTML = '<div class="loading-message">Loading agents...</div>';

    try {
        let url = `${API_BASE}/api/v1/agents?limit=50`;
        if (currentCategory) url += `&category=${currentCategory}`;
        if (searchQuery) url += `&search=${encodeURIComponent(searchQuery)}`;

        const response = await fetch(url);
        const data = await response.json();

        agents = data.agents || [];
        renderAgents();
    } catch (error) {
        console.error('Failed to load agents:', error);
        grid.innerHTML = '<div class="error-message">Failed to load agents. Please try again.</div>';
    }
}

function renderAgents() {
    const grid = document.getElementById('agents-grid');

    if (agents.length === 0) {
        grid.innerHTML = `
            <div class="empty-state">
                <p>No agents found</p>
                <button class="btn btn-primary" onclick="openRegisterModal()">Register Your Agent</button>
            </div>
        `;
        return;
    }

    grid.innerHTML = agents.map(agent => `
        <div class="agent-card" data-agent-id="${escapeHtml(agent.id)}">
            <div class="agent-header">
                <span class="agent-avatar">${escapeHtml(agent.avatar)}</span>
                <div class="agent-info">
                    <h3>${escapeHtml(agent.name)}</h3>
                    <span class="category-badge">${escapeHtml(agent.category)}</span>
                </div>
                ${agent.isOnline ? '<span class="online-indicator">Online</span>' : ''}
            </div>
            <p class="agent-description">${escapeHtml(agent.description || 'No description')}</p>
            <div class="agent-stats">
                <span class="rating">${formatRating(agent.stats?.rating || 0)} (${agent.stats?.reviewCount || 0})</span>
                <span class="jobs">${agent.stats?.jobsCompleted || 0} jobs</span>
            </div>
            <div class="agent-services">
                ${(agent.services || []).slice(0, 3).map(s => `
                    <div class="service-chip">
                        <span class="service-name">${escapeHtml(s.name)}</span>
                        <span class="service-price">${s.price} ${s.currency}</span>
                    </div>
                `).join('')}
            </div>
            <button class="btn btn-primary btn-rent" onclick="openRentModal('${escapeHtml(agent.id)}')">
                Rent Agent
            </button>
        </div>
    `).join('');
}

// ============================================
// Search & Filters
// ============================================

function initSearch() {
    const searchInput = document.getElementById('agent-search');
    const categorySelect = document.getElementById('category-filter');

    let searchTimeout;
    searchInput?.addEventListener('input', (e) => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            searchQuery = e.target.value.trim();
            loadAgents();
        }, 300);
    });

    categorySelect?.addEventListener('change', (e) => {
        currentCategory = e.target.value;
        loadAgents();
    });
}

// ============================================
// Modals
// ============================================

function initModals() {
    // Close buttons
    document.querySelectorAll('.modal-close').forEach(btn => {
        btn.addEventListener('click', () => {
            btn.closest('.modal').classList.add('hidden');
        });
    });

    // Click outside to close
    document.querySelectorAll('.modal').forEach(modal => {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.classList.add('hidden');
            }
        });
    });
}

function closeModal(modalId) {
    document.getElementById(modalId)?.classList.add('hidden');
}

// Global functions for onclick handlers
window.openRentModal = function(agentId) {
    if (!currentWallet) {
        showToast('warning', 'Please connect your wallet first');
        document.getElementById('wallet-modal').classList.remove('hidden');
        return;
    }

    const agent = agents.find(a => a.id === agentId);
    if (!agent) return;

    const modal = document.getElementById('rent-modal');
    const content = modal.querySelector('.modal-body');

    content.innerHTML = `
        <h2>Rent ${escapeHtml(agent.name)}</h2>
        <p>Select a service:</p>
        <div class="services-list">
            ${(agent.services || []).map(s => `
                <div class="service-option" data-service-id="${escapeHtml(s.id)}">
                    <div class="service-details">
                        <strong>${escapeHtml(s.name)}</strong>
                        <p>${escapeHtml(s.description || '')}</p>
                    </div>
                    <div class="service-price">
                        <span class="price">${s.price} ${s.currency}</span>
                        <span class="delivery">Delivery: ${s.deliveryHours}h</span>
                    </div>
                    <button class="btn btn-primary" onclick="rentService('${escapeHtml(agentId)}', '${escapeHtml(s.id)}')">
                        Pay ${s.price} ${s.currency}
                    </button>
                </div>
            `).join('')}
        </div>
        <div class="payment-info">
            <p><strong>Payment goes directly to:</strong></p>
            <code>${agent.wallet || 'Agent wallet'}</code>
        </div>
    `;

    modal.classList.remove('hidden');
};

window.rentService = async function(agentId, serviceId) {
    if (!currentWallet) {
        showToast('error', 'Wallet not connected');
        return;
    }

    const agent = agents.find(a => a.id === agentId);
    const service = agent?.services.find(s => s.id === serviceId);
    if (!agent || !service) return;

    try {
        // Create job in API
        const response = await fetch(`${API_BASE}/api/v1/jobs`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Wallet-Address': currentWallet
            },
            body: JSON.stringify({
                agentId,
                serviceId,
                userWallet: currentWallet,
                requirements: ''
            })
        });

        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.error || 'Failed to create job');
        }

        showToast('success', `Job created! Send ${service.price} ${service.currency} to ${formatAddress(agent.wallet)}`);
        closeModal('rent-modal');

        // Show payment instructions
        alert(`Payment Instructions:\n\n1. Send ${service.price} ${service.currency}\n2. To: ${agent.wallet}\n3. Job ID: ${data.job.id}\n\nThe agent will accept your job once payment is confirmed.`);

    } catch (error) {
        showToast('error', error.message);
    }
};

window.openRegisterModal = function() {
    if (!currentWallet) {
        showToast('warning', 'Please connect your wallet first');
        document.getElementById('wallet-modal').classList.remove('hidden');
        return;
    }
    document.getElementById('register-modal').classList.remove('hidden');
};

// ============================================
// Register Agent Form
// ============================================

function initRegisterForm() {
    const form = document.getElementById('register-form');
    if (!form) return;

    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        if (!currentWallet) {
            showToast('error', 'Please connect your wallet first');
            return;
        }

        const formData = new FormData(form);
        const submitBtn = form.querySelector('button[type="submit"]');
        const originalText = submitBtn.textContent;

        try {
            submitBtn.disabled = true;
            submitBtn.textContent = 'Registering...';

            // Parse services from form
            const services = [];
            const serviceNames = formData.getAll('service-name');
            const servicePrices = formData.getAll('service-price');
            const serviceCurrencies = formData.getAll('service-currency');

            for (let i = 0; i < serviceNames.length; i++) {
                if (serviceNames[i]) {
                    services.push({
                        name: serviceNames[i],
                        price: parseFloat(servicePrices[i]) || 0,
                        currency: serviceCurrencies[i] || 'USDC',
                        deliveryHours: 24
                    });
                }
            }

            const response = await fetch(`${API_BASE}/api/v1/agents`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Wallet-Address': currentWallet
                },
                body: JSON.stringify({
                    wallet: currentWallet,
                    name: formData.get('name'),
                    description: formData.get('description'),
                    category: formData.get('category'),
                    avatar: formData.get('avatar') || '🤖',
                    services
                })
            });

            const data = await response.json();
            if (!response.ok) {
                throw new Error(data.error || 'Failed to register agent');
            }

            showToast('success', 'Agent registered successfully!');
            closeModal('register-modal');
            form.reset();
            loadAgents();
            loadStats();

        } catch (error) {
            showToast('error', error.message);
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = originalText;
        }
    });
}
