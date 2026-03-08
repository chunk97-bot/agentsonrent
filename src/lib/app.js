/**
 * AgentRent - Main Application
 * Handles UI interactions, wallet connection, agent loading
 */

import { WalletAdapter } from './wallet.js';
import { ApiClient } from './api-client.js';
import { showToast, formatAddress, formatRating } from './utils.js';

// Initialize
const wallet = new WalletAdapter();
const api = new ApiClient();

// Sample agents data (will be replaced by API calls)
const SAMPLE_AGENTS = [
    {
        id: 'agent_001',
        name: 'TaxBot Pro',
        avatar: '🧮',
        wallet: 'So1ana...abc',
        description: 'Expert tax filing agent. 99.2% accuracy rate. Handles W2, 1099, and complex returns.',
        category: 'tax',
        rating: 4.9,
        reviewCount: 2341,
        jobsCompleted: 847,
        isOnline: true,
        services: [
            { name: 'W2 Filing', price: 15, currency: 'USDC', deliveryHours: 2 },
            { name: '1099 Processing', price: 25, currency: 'USDC', deliveryHours: 4 },
            { name: 'Full Tax Return', price: 75, currency: 'USDC', deliveryHours: 24 }
        ]
    },
    {
        id: 'agent_002',
        name: 'LegalEagle AI',
        avatar: '⚖️',
        wallet: 'So1ana...def',
        description: 'Contract review, NDA drafting, and legal research. Bar-certified guidance.',
        category: 'legal',
        rating: 4.7,
        reviewCount: 892,
        jobsCompleted: 423,
        isOnline: true,
        services: [
            { name: 'Contract Review', price: 20, currency: 'USDC', deliveryHours: 1 },
            { name: 'NDA Draft', price: 15, currency: 'USDC', deliveryHours: 0.5 },
            { name: 'Legal Research', price: 50, currency: 'USDC', deliveryHours: 4 }
        ]
    },
    {
        id: 'agent_003',
        name: 'CodeReview Bot',
        avatar: '💻',
        wallet: 'So1ana...ghi',
        description: 'Senior-level code review. Finds bugs, security issues, and suggests improvements.',
        category: 'code',
        rating: 4.8,
        reviewCount: 1567,
        jobsCompleted: 612,
        isOnline: false,
        services: [
            { name: 'PR Review', price: 5, currency: 'USDC', deliveryHours: 1 },
            { name: 'Security Audit', price: 50, currency: 'USDC', deliveryHours: 24 },
            { name: 'Bug Hunt', price: 100, currency: 'USDC', deliveryHours: 48 }
        ]
    },
    {
        id: 'agent_004',
        name: 'ResearchBot',
        avatar: '🔬',
        wallet: 'So1ana...jkl',
        description: 'Academic and market research. Literature reviews, data analysis, citations.',
        category: 'research',
        rating: 4.6,
        reviewCount: 678,
        jobsCompleted: 289,
        isOnline: true,
        services: [
            { name: 'Literature Review', price: 30, currency: 'USDC', deliveryHours: 8 },
            { name: 'Market Analysis', price: 75, currency: 'USDC', deliveryHours: 24 },
            { name: 'Data Summary', price: 15, currency: 'USDC', deliveryHours: 2 }
        ]
    },
    {
        id: 'agent_005',
        name: 'CopyWriter Pro',
        avatar: '✍️',
        wallet: 'So1ana...mno',
        description: 'Compelling copy for ads, landing pages, emails. Conversion-focused writing.',
        category: 'creative',
        rating: 4.5,
        reviewCount: 1234,
        jobsCompleted: 567,
        isOnline: true,
        services: [
            { name: 'Ad Copy', price: 10, currency: 'USDC', deliveryHours: 1 },
            { name: 'Landing Page', price: 25, currency: 'USDC', deliveryHours: 4 },
            { name: 'Email Sequence', price: 40, currency: 'USDC', deliveryHours: 8 }
        ]
    },
    {
        id: 'agent_006',
        name: 'DataCrunch AI',
        avatar: '📊',
        wallet: 'So1ana...pqr',
        description: 'Data cleaning, analysis, and visualization. Excel, SQL, Python pandas.',
        category: 'data',
        rating: 4.8,
        reviewCount: 456,
        jobsCompleted: 198,
        isOnline: true,
        services: [
            { name: 'Data Cleaning', price: 20, currency: 'USDC', deliveryHours: 2 },
            { name: 'Analysis Report', price: 50, currency: 'USDC', deliveryHours: 8 },
            { name: 'Dashboard', price: 100, currency: 'USDC', deliveryHours: 24 }
        ]
    }
];

// State
let currentWallet = null;
let currentCategory = '';
let searchQuery = '';

// DOM Ready
document.addEventListener('DOMContentLoaded', () => {
    initWallet();
    initWaitlist();
    initAgentGrid();
    initSearch();
    initModal();
});

// ============================================
// Wallet Integration
// ============================================

function initWallet() {
    const connectBtn = document.getElementById('connect-wallet');

    connectBtn.addEventListener('click', () => {
        if (currentWallet) {
            // Already connected - show disconnect option
            disconnectWallet();
        } else {
            // Show wallet modal
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
    try {
        const address = await wallet.connect(walletType);
        if (address) {
            currentWallet = address;
            updateWalletUI(address);
            closeWalletModal();
            showToast('success', `Connected: ${formatAddress(address)}`);
        }
    } catch (error) {
        showToast('error', error.message || 'Failed to connect wallet');
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
    connectBtn.textContent = formatAddress(address);
}

async function checkExistingConnection() {
    const address = await wallet.checkConnection();
    if (address) {
        currentWallet = address;
        updateWalletUI(address);
    }
}

// ============================================
// Waitlist Form
// ============================================

function initWaitlist() {
    const form = document.getElementById('waitlist-form');
    const emailInput = document.getElementById('waitlist-email');

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = emailInput.value.trim();

        if (!email) return;

        try {
            // In production, this would call the API
            // await api.joinWaitlist(email);

            // For now, simulate success
            showToast('success', 'You\'re on the waitlist! 🎉');
            emailInput.value = '';

            // Update counter
            const counter = document.getElementById('waitlist-number');
            const current = parseInt(counter.textContent.replace(',', ''));
            counter.textContent = (current + 1).toLocaleString();
        } catch (error) {
            showToast('error', 'Failed to join waitlist');
        }
    });
}

// ============================================
// Agent Grid
// ============================================

function initAgentGrid() {
    renderAgents(SAMPLE_AGENTS);

    // Load more button
    document.getElementById('load-more-agents').addEventListener('click', () => {
        showToast('info', 'All agents loaded');
    });
}

function renderAgents(agents) {
    const grid = document.getElementById('agents-grid');

    if (agents.length === 0) {
        grid.innerHTML = `
            <div class="no-results">
                <p>No agents found matching your criteria</p>
            </div>
        `;
        return;
    }

    grid.innerHTML = agents.map(agent => createAgentCard(agent)).join('');

    // Add click handlers to rent buttons
    grid.querySelectorAll('.btn-rent').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const agentId = e.target.dataset.agentId;
            handleRentClick(agentId);
        });
    });
}

function createAgentCard(agent) {
    const servicesHtml = agent.services.slice(0, 2).map(service => `
        <div class="service-tag">
            <span>${service.name}</span>
            <span class="service-price">${service.price} ${service.currency}</span>
        </div>
    `).join('');

    const statusDot = agent.isOnline
        ? '<span style="color: #00ff88;">●</span>'
        : '<span style="color: #6a6a7a;">●</span>';

    return `
        <div class="agent-card" data-agent-id="${agent.id}">
            <div class="agent-header">
                <div class="agent-avatar">${agent.avatar}</div>
                <div>
                    <div class="agent-name">${agent.name}</div>
                    <div class="agent-rating">
                        <span class="star">★</span>
                        <span>${agent.rating}</span>
                        <span>(${agent.reviewCount.toLocaleString()})</span>
                    </div>
                </div>
            </div>
            <p class="agent-description">${agent.description}</p>
            <div class="agent-services">
                ${servicesHtml}
                ${agent.services.length > 2 ? `<span class="more-services">+${agent.services.length - 2} more services</span>` : ''}
            </div>
            <div class="agent-footer">
                <div class="agent-meta">
                    ${statusDot} ${agent.isOnline ? 'Online' : 'Offline'} · ${agent.jobsCompleted} jobs
                </div>
                <button class="btn btn-primary btn-rent" data-agent-id="${agent.id}">
                    Rent
                </button>
            </div>
        </div>
    `;
}

function handleRentClick(agentId) {
    if (!currentWallet) {
        document.getElementById('wallet-modal').classList.remove('hidden');
        showToast('info', 'Connect wallet to rent agents');
        return;
    }

    const agent = SAMPLE_AGENTS.find(a => a.id === agentId);
    if (agent) {
        // In production, navigate to agent detail page
        showToast('info', `Opening ${agent.name}... (Coming soon)`);
    }
}

// ============================================
// Search & Filter
// ============================================

function initSearch() {
    const searchInput = document.getElementById('agent-search');
    const categorySelect = document.getElementById('category-filter');

    searchInput.addEventListener('input', (e) => {
        searchQuery = e.target.value.toLowerCase();
        filterAgents();
    });

    categorySelect.addEventListener('change', (e) => {
        currentCategory = e.target.value;
        filterAgents();
    });
}

function filterAgents() {
    let filtered = SAMPLE_AGENTS;

    if (currentCategory) {
        filtered = filtered.filter(a => a.category === currentCategory);
    }

    if (searchQuery) {
        filtered = filtered.filter(a =>
            a.name.toLowerCase().includes(searchQuery) ||
            a.description.toLowerCase().includes(searchQuery) ||
            a.services.some(s => s.name.toLowerCase().includes(searchQuery))
        );
    }

    renderAgents(filtered);
}

// ============================================
// Modal
// ============================================

function initModal() {
    const modal = document.getElementById('wallet-modal');
    const closeBtn = document.getElementById('close-wallet-modal');

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
    document.getElementById('wallet-modal').classList.add('hidden');
}

// Update agent count
document.getElementById('agent-count').textContent = SAMPLE_AGENTS.length;

console.log('🤖 AgentRent initialized');
