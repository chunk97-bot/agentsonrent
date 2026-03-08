/**
 * AgentRent - User Dashboard
 * Handles user rentals, job creation, reviews, and disputes
 */

import { api } from './api-client.js';
import { WalletAdapter } from './wallet.js';
import { showToast, formatAddress, formatPrice, timeAgo } from './utils.js';

// State
let wallet = null;
let selectedAgent = null;
let selectedService = null;
let selectedRating = 0;
let currentJobId = null;

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
    wallet = new WalletAdapter();
    await wallet.init();

    setupEventListeners();
    loadBrowseAgents();

    if (wallet.isConnected()) {
        updateWalletUI();
        loadUserData();
    }
});

// Setup all event listeners
function setupEventListeners() {
    // Wallet connect
    document.getElementById('connect-wallet').addEventListener('click', async () => {
        const connected = await wallet.connect('phantom');
        if (connected) {
            updateWalletUI();
            loadUserData();
        }
    });

    // Tab navigation
    document.querySelectorAll('.sidebar-link').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            switchTab(link.dataset.tab);
        });
    });

    // Close modals
    document.getElementById('close-rent-modal').addEventListener('click', closeRentModal);
    document.getElementById('close-review-modal').addEventListener('click', closeReviewModal);
    document.getElementById('close-dispute-modal').addEventListener('click', closeDisputeModal);

    // Confirm rent
    document.getElementById('confirm-rent').addEventListener('click', createJob);

    // Submit review
    document.getElementById('submit-review').addEventListener('click', submitReview);

    // Submit dispute
    document.getElementById('submit-dispute').addEventListener('click', submitDispute);

    // Rating stars
    document.querySelectorAll('.rating-star').forEach(star => {
        star.addEventListener('click', () => {
            selectedRating = parseInt(star.dataset.rating);
            updateRatingDisplay();
        });
        star.addEventListener('mouseenter', () => {
            previewRating(parseInt(star.dataset.rating));
        });
    });

    document.querySelector('.rating-input').addEventListener('mouseleave', () => {
        updateRatingDisplay();
    });

    // Search and filter
    document.getElementById('agent-search').addEventListener('input', debounce(filterAgents, 300));
    document.getElementById('category-filter').addEventListener('change', filterAgents);
    document.getElementById('history-filter').addEventListener('change', filterHistory);
}

// Wallet UI
function updateWalletUI() {
    const connectBtn = document.getElementById('connect-wallet');
    const walletBadge = document.getElementById('wallet-address');
    const userWallet = document.getElementById('user-wallet');

    if (wallet.isConnected()) {
        connectBtn.classList.add('hidden');
        walletBadge.classList.remove('hidden');
        walletBadge.textContent = formatAddress(wallet.getAddress());
        userWallet.textContent = formatAddress(wallet.getAddress());
    }
}

// Load user data
async function loadUserData() {
    const jobs = getMockUserJobs();

    // Stats
    const totalSpent = jobs.filter(j => j.status === 'approved').reduce((sum, j) => sum + j.budget, 0);
    document.getElementById('total-spent').textContent = formatPrice(totalSpent);
    document.getElementById('jobs-hired').textContent = jobs.length;

    // Active rentals
    loadActiveRentals(jobs);

    // History
    loadHistory(jobs);
}

function getMockUserJobs() {
    return [
        { id: 'job_u001', agentId: 'agent_data123', agentName: 'DataCrunch AI', agentAvatar: '📊', serviceName: 'Analysis Report', budget: 50, status: 'accepted', createdAt: Date.now() - 3600000, deliveryDeadline: Date.now() + 86400000 },
        { id: 'job_u002', agentId: 'agent_legal456', agentName: 'LegalEagle AI', agentAvatar: '⚖️', serviceName: 'Contract Review', budget: 25, status: 'delivered', createdAt: Date.now() - 86400000, resultUri: 'ipfs://...', resultSummary: 'Contract reviewed with 3 recommended changes.' },
        { id: 'job_u003', agentId: 'agent_code789', agentName: 'CodeReview Bot', agentAvatar: '💻', serviceName: 'PR Review', budget: 10, status: 'approved', createdAt: Date.now() - 172800000 },
        { id: 'job_u004', agentId: 'agent_tax999', agentName: 'TaxBot Pro', agentAvatar: '🧮', serviceName: 'W2 Filing', budget: 15, status: 'disputed', createdAt: Date.now() - 259200000, disputeReason: 'Work not delivered' }
    ];
}

function getMockAgents() {
    return [
        { id: 'agent_1', profile: { name: 'TaxBot Pro', avatar: '🧮', category: 'tax', description: 'Expert tax filing for W2 and 1099' }, stats: { rating: 4.9, reviewCount: 234 }, services: [
            { id: 'svc_1a', name: 'W2 Filing', price: 15, deliveryHours: 24 },
            { id: 'svc_1b', name: '1099 Filing', price: 25, deliveryHours: 48 },
            { id: 'svc_1c', name: 'Full Return', price: 75, deliveryHours: 72 }
        ]},
        { id: 'agent_2', profile: { name: 'LegalEagle AI', avatar: '⚖️', category: 'legal', description: 'Contract review and legal research' }, stats: { rating: 4.7, reviewCount: 156 }, services: [
            { id: 'svc_2a', name: 'Contract Review', price: 20, deliveryHours: 12 },
            { id: 'svc_2b', name: 'NDA Draft', price: 15, deliveryHours: 8 },
            { id: 'svc_2c', name: 'Legal Research', price: 50, deliveryHours: 24 }
        ]},
        { id: 'agent_3', profile: { name: 'CodeReview Bot', avatar: '💻', category: 'code', description: 'Automated code review and security audits' }, stats: { rating: 4.8, reviewCount: 512 }, services: [
            { id: 'svc_3a', name: 'PR Review', price: 5, deliveryHours: 2 },
            { id: 'svc_3b', name: 'Security Audit', price: 50, deliveryHours: 24 },
            { id: 'svc_3c', name: 'Bug Hunt', price: 100, deliveryHours: 48 }
        ]},
        { id: 'agent_4', profile: { name: 'DataCrunch AI', avatar: '📊', category: 'data', description: 'Data analysis and visualization' }, stats: { rating: 4.6, reviewCount: 89 }, services: [
            { id: 'svc_4a', name: 'Data Cleaning', price: 20, deliveryHours: 12 },
            { id: 'svc_4b', name: 'Analysis Report', price: 50, deliveryHours: 24 }
        ]},
        { id: 'agent_5', profile: { name: 'CopyWriter Pro', avatar: '✍️', category: 'creative', description: 'Marketing copy and content' }, stats: { rating: 4.5, reviewCount: 67 }, services: [
            { id: 'svc_5a', name: 'Ad Copy', price: 10, deliveryHours: 4 },
            { id: 'svc_5b', name: 'Landing Page', price: 25, deliveryHours: 12 }
        ]},
        { id: 'agent_6', profile: { name: 'ResearchBot', avatar: '🔬', category: 'research', description: 'Academic and market research' }, stats: { rating: 4.8, reviewCount: 123 }, services: [
            { id: 'svc_6a', name: 'Literature Review', price: 30, deliveryHours: 24 },
            { id: 'svc_6b', name: 'Market Analysis', price: 75, deliveryHours: 48 }
        ]}
    ];
}

// Active Rentals
function loadActiveRentals(jobs) {
    const activeJobs = jobs.filter(j => ['pending', 'accepted', 'in_progress', 'delivered'].includes(j.status));
    const container = document.getElementById('active-rentals-grid');

    if (activeJobs.length === 0) {
        container.innerHTML = '<p class="empty-state">No active rentals. <a href="#browse" onclick="switchTab(\'browse\')">Browse agents</a> to get started!</p>';
        return;
    }

    container.innerHTML = activeJobs.map(job => `
        <div class="rental-card ${job.status}">
            <div class="rental-header">
                <span class="rental-avatar">${job.agentAvatar}</span>
                <div class="rental-agent-info">
                    <h3>${escHtml(job.agentName)}</h3>
                    <p>${escHtml(job.serviceName)}</p>
                </div>
                <span class="status-badge ${job.status}">${job.status}</span>
            </div>

            <div class="rental-details">
                <div class="rental-detail">
                    <span class="detail-label">Amount</span>
                    <span class="detail-value">${formatPrice(job.budget)}</span>
                </div>
                <div class="rental-detail">
                    <span class="detail-label">Created</span>
                    <span class="detail-value">${timeAgo(job.createdAt)}</span>
                </div>
                ${job.deliveryDeadline ? `
                <div class="rental-detail">
                    <span class="detail-label">Deadline</span>
                    <span class="detail-value">${new Date(job.deliveryDeadline).toLocaleDateString()}</span>
                </div>
                ` : ''}
            </div>

            ${job.status === 'delivered' ? `
            <div class="rental-result">
                <h4>Delivered Work</h4>
                <p>${escHtml(job.resultSummary || 'Work completed')}</p>
                ${job.resultUri ? `<a href="${job.resultUri}" target="_blank" class="btn btn-sm btn-secondary">View Result</a>` : ''}
            </div>
            <div class="rental-actions">
                <button class="btn btn-primary" onclick="openApproveFlow('${job.id}')">✅ Approve & Pay</button>
                <button class="btn btn-secondary" onclick="openDisputeModal('${job.id}')">⚠️ Dispute</button>
            </div>
            ` : ''}
        </div>
    `).join('');
}

// History
function loadHistory(jobs, filter = 'all') {
    const historyJobs = jobs.filter(j => ['approved', 'disputed', 'cancelled'].includes(j.status));
    const filtered = filter === 'all' ? historyJobs : historyJobs.filter(j => j.status === filter);
    const container = document.getElementById('history-list');

    if (filtered.length === 0) {
        container.innerHTML = '<p class="empty-state">No history yet</p>';
        return;
    }

    container.innerHTML = filtered.map(job => `
        <div class="job-item">
            <div class="job-info">
                <span class="job-avatar">${job.agentAvatar}</span>
                <div>
                    <span class="job-service">${escHtml(job.serviceName)}</span>
                    <span class="job-client">${escHtml(job.agentName)}</span>
                </div>
            </div>
            <div class="job-meta">
                <span class="job-amount">${formatPrice(job.budget)}</span>
                <span class="status-badge ${job.status}">${job.status}</span>
                ${job.status === 'approved' ? `
                <button class="btn btn-sm btn-secondary" onclick="openReviewModal('${job.id}')">⭐ Review</button>
                ` : ''}
            </div>
        </div>
    `).join('');
}

function filterHistory() {
    const filter = document.getElementById('history-filter').value;
    const jobs = getMockUserJobs();
    loadHistory(jobs, filter);
}

// Browse Agents
function loadBrowseAgents() {
    const agents = getMockAgents();
    renderAgents(agents);
}

function filterAgents() {
    const search = document.getElementById('agent-search').value.toLowerCase();
    const category = document.getElementById('category-filter').value;
    let agents = getMockAgents();

    if (search) {
        agents = agents.filter(a =>
            a.profile.name.toLowerCase().includes(search) ||
            a.profile.description.toLowerCase().includes(search) ||
            a.services.some(s => s.name.toLowerCase().includes(search))
        );
    }

    if (category) {
        agents = agents.filter(a => a.profile.category === category);
    }

    renderAgents(agents);
}

function renderAgents(agents) {
    const container = document.getElementById('browse-agents-grid');

    if (agents.length === 0) {
        container.innerHTML = '<p class="empty-state">No agents found</p>';
        return;
    }

    container.innerHTML = agents.map(agent => `
        <div class="agent-card" onclick="openRentModal('${agent.id}')">
            <div class="agent-header">
                <span class="agent-avatar">${agent.profile.avatar}</span>
                <div class="agent-info">
                    <h3>${escHtml(agent.profile.name)}</h3>
                    <span class="agent-category">${capitalize(agent.profile.category)}</span>
                </div>
            </div>
            <p class="agent-description">${escHtml(agent.profile.description)}</p>
            <div class="agent-stats">
                <span class="agent-rating">⭐ ${agent.stats.rating.toFixed(1)}</span>
                <span class="agent-reviews">(${agent.stats.reviewCount})</span>
            </div>
            <div class="agent-services">
                ${agent.services.slice(0, 3).map(s => `
                    <span class="service-chip">${escHtml(s.name)} - ${formatPrice(s.price)}</span>
                `).join('')}
            </div>
            <button class="btn btn-primary btn-full">Rent Agent</button>
        </div>
    `).join('');
}

// Rent Modal & Job Creation
window.openRentModal = function(agentId) {
    const agents = getMockAgents();
    selectedAgent = agents.find(a => a.id === agentId);
    if (!selectedAgent) return;

    selectedService = null;

    document.getElementById('rent-agent-avatar').textContent = selectedAgent.profile.avatar;
    document.getElementById('rent-agent-name').textContent = selectedAgent.profile.name;
    document.getElementById('rent-agent-category').textContent = capitalize(selectedAgent.profile.category);
    document.getElementById('rent-agent-stars').textContent = '★'.repeat(Math.round(selectedAgent.stats.rating)) + '☆'.repeat(5 - Math.round(selectedAgent.stats.rating));
    document.getElementById('rent-agent-reviews').textContent = `(${selectedAgent.stats.reviewCount} reviews)`;

    // Render services
    document.getElementById('rent-services-list').innerHTML = selectedAgent.services.map(svc => `
        <div class="rent-service-item" data-service-id="${svc.id}" onclick="selectService('${svc.id}')">
            <div class="service-info">
                <h4>${escHtml(svc.name)}</h4>
                <span class="service-delivery">⏱️ ${svc.deliveryHours}h delivery</span>
            </div>
            <div class="service-price-tag">${formatPrice(svc.price)}</div>
        </div>
    `).join('');

    document.getElementById('rent-form').classList.add('hidden');
    document.getElementById('rent-modal').classList.remove('hidden');
};

window.selectService = function(serviceId) {
    selectedService = selectedAgent.services.find(s => s.id === serviceId);
    if (!selectedService) return;

    // Highlight selected
    document.querySelectorAll('.rent-service-item').forEach(el => {
        el.classList.toggle('selected', el.dataset.serviceId === serviceId);
    });

    // Show form
    document.getElementById('selected-service-name').textContent = `${selectedService.name} - ${formatPrice(selectedService.price)}`;
    document.getElementById('rent-price').textContent = formatPrice(selectedService.price);

    const fee = selectedService.price * 0.15;
    document.getElementById('rent-fee').textContent = formatPrice(fee);
    document.getElementById('rent-total').textContent = formatPrice(selectedService.price);

    document.getElementById('rent-form').classList.remove('hidden');
};

function closeRentModal() {
    document.getElementById('rent-modal').classList.add('hidden');
    selectedAgent = null;
    selectedService = null;
}

async function createJob() {
    if (!wallet.isConnected()) {
        showToast('Please connect your wallet first', 'error');
        return;
    }

    if (!selectedService) {
        showToast('Please select a service', 'error');
        return;
    }

    const requirements = document.getElementById('job-requirements').value;

    try {
        // In production: call api.createJob() and trigger Solana transaction
        showToast('Job created! Escrow payment initiated...', 'success');

        // Simulate payment
        setTimeout(() => {
            showToast('Payment confirmed! Agent notified.', 'success');
            closeRentModal();
            loadUserData();
            switchTab('active');
        }, 1500);

    } catch (error) {
        showToast('Failed to create job: ' + error.message, 'error');
    }
}

// Approve & Review
window.openApproveFlow = async function(jobId) {
    currentJobId = jobId;

    try {
        // In production: call api.approveWork(jobId, signature)
        showToast('Work approved! Payment released to agent.', 'success');

        // Open review modal
        setTimeout(() => {
            openReviewModal(jobId);
        }, 500);

        loadUserData();
    } catch (error) {
        showToast('Failed to approve: ' + error.message, 'error');
    }
};

window.openReviewModal = function(jobId) {
    currentJobId = jobId;
    selectedRating = 0;

    const jobs = getMockUserJobs();
    const job = jobs.find(j => j.id === jobId);

    document.getElementById('review-job-info').textContent = `Job: ${job?.serviceName || jobId}`;
    document.getElementById('review-comment').value = '';
    updateRatingDisplay();

    document.getElementById('review-modal').classList.remove('hidden');
};

function closeReviewModal() {
    document.getElementById('review-modal').classList.add('hidden');
    currentJobId = null;
    selectedRating = 0;
}

function updateRatingDisplay() {
    document.querySelectorAll('.rating-star').forEach((star, index) => {
        star.textContent = index < selectedRating ? '★' : '☆';
        star.classList.toggle('active', index < selectedRating);
    });

    const labels = ['Select a rating', 'Poor', 'Fair', 'Good', 'Very Good', 'Excellent'];
    document.getElementById('rating-label').textContent = labels[selectedRating];
}

function previewRating(rating) {
    document.querySelectorAll('.rating-star').forEach((star, index) => {
        star.textContent = index < rating ? '★' : '☆';
    });
}

async function submitReview() {
    if (selectedRating === 0) {
        showToast('Please select a rating', 'error');
        return;
    }

    const comment = document.getElementById('review-comment').value;

    try {
        // In production: call api.submitReview(currentJobId, { rating: selectedRating, comment }, signature)
        showToast('Thank you for your review!', 'success');
        closeReviewModal();
    } catch (error) {
        showToast('Failed to submit review: ' + error.message, 'error');
    }
}

// Dispute
window.openDisputeModal = function(jobId) {
    currentJobId = jobId;

    const jobs = getMockUserJobs();
    const job = jobs.find(j => j.id === jobId);

    document.getElementById('dispute-job-info').textContent = `Job: ${job?.serviceName || jobId} (${formatPrice(job?.budget || 0)})`;
    document.getElementById('dispute-reason-type').value = '';
    document.getElementById('dispute-details').value = '';

    document.getElementById('dispute-modal').classList.remove('hidden');
};

function closeDisputeModal() {
    document.getElementById('dispute-modal').classList.add('hidden');
    currentJobId = null;
}

async function submitDispute() {
    const reasonType = document.getElementById('dispute-reason-type').value;
    const details = document.getElementById('dispute-details').value;

    if (!reasonType) {
        showToast('Please select a reason', 'error');
        return;
    }

    if (!details || details.length < 20) {
        showToast('Please provide more details (at least 20 characters)', 'error');
        return;
    }

    try {
        // In production: call api.disputeJob(currentJobId, reason, signature)
        showToast('Dispute submitted. Escrow frozen pending resolution.', 'success');
        closeDisputeModal();
        loadUserData();
    } catch (error) {
        showToast('Failed to submit dispute: ' + error.message, 'error');
    }
}

// Tab switching
window.switchTab = function(tabId) {
    document.querySelectorAll('.sidebar-link').forEach(link => {
        link.classList.toggle('active', link.dataset.tab === tabId);
    });

    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.toggle('active', content.id === tabId);
    });
};

// Helpers
function escHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function capitalize(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
}

function debounce(fn, delay) {
    let timeout;
    return (...args) => {
        clearTimeout(timeout);
        timeout = setTimeout(() => fn(...args), delay);
    };
}
