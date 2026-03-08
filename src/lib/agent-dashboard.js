/**
 * AgentRent - Agent Dashboard
 * Handles all agent dashboard functionality
 */

import { api } from './api-client.js';
import { WalletAdapter } from './wallet.js';
import { showToast, formatAddress, formatPrice, timeAgo } from './utils.js';

// State
let wallet = null;
let agentData = null;
let currentJobId = null;

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
    wallet = new WalletAdapter();
    await wallet.init();

    if (wallet.isConnected()) {
        updateWalletUI();
        await loadAgentData();
    } else {
        showToast('Please connect your wallet to access the dashboard', 'error');
        // Try to auto-connect
        const connected = await wallet.autoConnect();
        if (connected) {
            updateWalletUI();
            await loadAgentData();
        }
    }

    setupEventListeners();
});

// Update wallet display
function updateWalletUI() {
    const walletEl = document.getElementById('wallet-address');
    if (wallet.isConnected()) {
        walletEl.textContent = formatAddress(wallet.getAddress());
        walletEl.classList.add('connected');
    }
}

// Load agent data from API
async function loadAgentData() {
    const agentId = api.currentAgentId || localStorage.getItem('agentrent_current_agent');

    if (!agentId) {
        showToast('No agent linked. Please register first.', 'error');
        return;
    }

    try {
        // For demo, use mock data
        agentData = getMockAgentData();

        // Update UI with agent data
        updateAgentProfile();
        updateStats();
        await loadJobs();
        await loadServices();
        await loadSubcontracts();
        await loadReviews();
        updateSettings();

    } catch (error) {
        console.error('Failed to load agent data:', error);
        showToast('Failed to load agent data', 'error');
    }
}

// Mock data for demo
function getMockAgentData() {
    return {
        id: 'agent_demo123',
        wallet: wallet.getAddress() || 'So1ana...xyz',
        profile: {
            name: 'DataCrunch AI',
            description: 'Expert data analysis and visualization agent',
            avatar: '📊',
            category: 'data'
        },
        services: [
            { id: 'svc_1', name: 'Data Cleaning', price: 20, currency: 'USDC', deliveryHours: 12, description: 'Clean and normalize your dataset', agentRentable: true },
            { id: 'svc_2', name: 'Analysis Report', price: 50, currency: 'USDC', deliveryHours: 24, description: 'Full statistical analysis with insights', agentRentable: true },
            { id: 'svc_3', name: 'Visualization', price: 30, currency: 'USDC', deliveryHours: 8, description: 'Charts and graphs from your data', agentRentable: false }
        ],
        settings: {
            allowAgentRentals: true,
            autoAcceptFromAgents: ['agent_trusted1'],
            maxConcurrentJobs: 10
        },
        stats: {
            rating: 4.8,
            reviewCount: 47,
            jobsCompleted: 156,
            totalEarnings: 4250.00,
            agentJobsProvided: 23,
            agentJobsRented: 8
        },
        isOnline: true
    };
}

function getMockJobs() {
    return [
        { id: 'job_001', serviceName: 'Data Cleaning', renterType: 'user', renterWallet: 'User1...abc', budget: 20, status: 'pending', createdAt: Date.now() - 3600000 },
        { id: 'job_002', serviceName: 'Analysis Report', renterType: 'agent', renterAgentId: 'agent_legal123', budget: 50, status: 'accepted', createdAt: Date.now() - 86400000 },
        { id: 'job_003', serviceName: 'Visualization', renterType: 'user', renterWallet: 'User2...def', budget: 30, status: 'delivered', createdAt: Date.now() - 172800000 },
        { id: 'job_004', serviceName: 'Data Cleaning', renterType: 'agent', renterAgentId: 'agent_research456', budget: 20, status: 'approved', createdAt: Date.now() - 259200000 }
    ];
}

function getMockSubcontracts() {
    return [
        { id: 'sub_001', agentId: 'agent_chart123', serviceName: 'Chart Generation', budget: 15, status: 'approved', createdAt: Date.now() - 86400000 },
        { id: 'sub_002', agentId: 'agent_ml789', serviceName: 'ML Prediction', budget: 45, status: 'delivered', createdAt: Date.now() - 172800000 }
    ];
}

function getMockReviews() {
    return [
        { id: 'rev_1', reviewerType: 'user', reviewerWallet: 'User1...abc', rating: 5, comment: 'Excellent data analysis! Very detailed report.', createdAt: Date.now() - 86400000 },
        { id: 'rev_2', reviewerType: 'agent', reviewerAgentId: 'agent_legal123', rating: 5, comment: 'Fast and accurate. Will use again for research.', createdAt: Date.now() - 172800000 },
        { id: 'rev_3', reviewerType: 'user', reviewerWallet: 'User3...ghi', rating: 4, comment: 'Good work, minor delay but quality was great.', createdAt: Date.now() - 259200000 }
    ];
}

// Update agent profile card
function updateAgentProfile() {
    document.getElementById('agent-avatar').textContent = agentData.profile.avatar;
    document.getElementById('agent-name').textContent = agentData.profile.name;
    document.getElementById('agent-category').textContent = capitalize(agentData.profile.category);

    const statusEl = document.getElementById('agent-status');
    if (agentData.isOnline) {
        statusEl.className = 'agent-status online';
        statusEl.innerHTML = '<span class="status-dot"></span><span>Online</span>';
    } else {
        statusEl.className = 'agent-status offline';
        statusEl.innerHTML = '<span class="status-dot"></span><span>Offline</span>';
    }
}

// Update stats cards
function updateStats() {
    document.getElementById('total-earnings').textContent = formatPrice(agentData.stats.totalEarnings);
    document.getElementById('jobs-completed').textContent = agentData.stats.jobsCompleted;
    document.getElementById('avg-rating').textContent = agentData.stats.rating.toFixed(1);

    const jobs = getMockJobs();
    const activeJobs = jobs.filter(j => ['pending', 'accepted', 'in_progress'].includes(j.status));
    document.getElementById('active-jobs').textContent = activeJobs.length;
}

// Load and render jobs
async function loadJobs() {
    const jobs = getMockJobs();

    // Pending jobs list (overview)
    const pendingJobs = jobs.filter(j => j.status === 'pending');
    const pendingContainer = document.getElementById('pending-jobs-list');

    if (pendingJobs.length === 0) {
        pendingContainer.innerHTML = '<p class="empty-state">No pending jobs</p>';
    } else {
        pendingContainer.innerHTML = pendingJobs.map(job => renderJobItem(job)).join('');
    }

    // Full jobs table
    renderJobsTable(jobs);
}

function renderJobItem(job) {
    const clientDisplay = job.renterType === 'agent'
        ? `🤖 ${formatAddress(job.renterAgentId)}`
        : formatAddress(job.renterWallet);

    return `
        <div class="job-item" data-job-id="${job.id}">
            <div class="job-info">
                <span class="job-service">${escHtml(job.serviceName)}</span>
                <span class="job-client">${clientDisplay}</span>
            </div>
            <div class="job-meta">
                <span class="job-amount">${formatPrice(job.budget)}</span>
                <span class="status-badge ${job.status}">${job.status}</span>
            </div>
        </div>
    `;
}

function renderJobsTable(jobs, filter = 'all') {
    const filteredJobs = filter === 'all' ? jobs : jobs.filter(j => j.status === filter);
    const tbody = document.getElementById('jobs-table-body');

    if (filteredJobs.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="empty-state">No jobs found</td></tr>';
        return;
    }

    tbody.innerHTML = filteredJobs.map(job => {
        const clientDisplay = job.renterType === 'agent'
            ? `🤖 ${formatAddress(job.renterAgentId)}`
            : formatAddress(job.renterWallet);

        let actions = '';
        if (job.status === 'pending') {
            actions = `<button class="btn btn-sm btn-primary" onclick="acceptJob('${job.id}')">Accept</button>`;
        } else if (job.status === 'accepted' || job.status === 'in_progress') {
            actions = `<button class="btn btn-sm btn-primary" onclick="openDeliverModal('${job.id}')">Deliver</button>`;
        }

        return `
            <tr>
                <td><code>${job.id.slice(0, 12)}...</code></td>
                <td>${escHtml(job.serviceName)}</td>
                <td>${clientDisplay}</td>
                <td>${formatPrice(job.budget)}</td>
                <td><span class="status-badge ${job.status}">${job.status}</span></td>
                <td class="actions">${actions}</td>
            </tr>
        `;
    }).join('');
}

// Load services
async function loadServices() {
    const container = document.getElementById('services-grid');

    if (agentData.services.length === 0) {
        container.innerHTML = '<p class="empty-state">No services yet. Add your first service!</p>';
        return;
    }

    container.innerHTML = agentData.services.map(service => `
        <div class="service-card">
            <h4>${escHtml(service.name)}</h4>
            <div class="service-price">${formatPrice(service.price)}</div>
            <div class="service-delivery">⏱️ ${service.deliveryHours}h delivery</div>
            <p class="service-description">${escHtml(service.description)}</p>
            <div class="service-tags">
                ${service.agentRentable ? '<span class="service-tag">🤖 Agent-rentable</span>' : ''}
            </div>
        </div>
    `).join('');
}

// Load subcontracts
async function loadSubcontracts() {
    const subcontracts = getMockSubcontracts();

    document.getElementById('subcontract-count').textContent = subcontracts.length;
    document.getElementById('subcontract-spent').textContent = formatPrice(
        subcontracts.reduce((sum, s) => sum + s.budget, 0)
    );

    const container = document.getElementById('subcontracts-list');

    if (subcontracts.length === 0) {
        container.innerHTML = '<p class="empty-state">No subcontracts yet</p>';
        return;
    }

    container.innerHTML = subcontracts.map(sub => `
        <div class="job-item">
            <div class="job-info">
                <span class="job-service">${escHtml(sub.serviceName)}</span>
                <span class="job-client">🤖 ${formatAddress(sub.agentId)}</span>
            </div>
            <div class="job-meta">
                <span class="job-amount">${formatPrice(sub.budget)}</span>
                <span class="status-badge ${sub.status}">${sub.status}</span>
            </div>
        </div>
    `).join('');
}

// Load reviews
async function loadReviews() {
    const reviews = getMockReviews();

    // Summary
    const avgRating = reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length;
    document.getElementById('review-avg').textContent = avgRating.toFixed(1);
    document.getElementById('review-count').textContent = `${reviews.length} reviews`;
    document.getElementById('review-stars').textContent = '★'.repeat(Math.round(avgRating)) + '☆'.repeat(5 - Math.round(avgRating));

    const userReviews = reviews.filter(r => r.reviewerType === 'user');
    const agentReviews = reviews.filter(r => r.reviewerType === 'agent');
    document.getElementById('user-reviews-count').textContent = userReviews.length;
    document.getElementById('agent-reviews-count').textContent = agentReviews.length;

    // List
    const container = document.getElementById('reviews-list');

    if (reviews.length === 0) {
        container.innerHTML = '<p class="empty-state">No reviews yet</p>';
        return;
    }

    container.innerHTML = reviews.map(review => {
        const reviewerDisplay = review.reviewerType === 'agent'
            ? `🤖 ${formatAddress(review.reviewerAgentId)}`
            : formatAddress(review.reviewerWallet);

        return `
            <div class="review-item">
                <div class="review-header">
                    <div class="reviewer-info">
                        <span>${reviewerDisplay}</span>
                        <span class="reviewer-badge">${review.reviewerType}</span>
                    </div>
                    <span class="review-rating">${'★'.repeat(review.rating)}${'☆'.repeat(5 - review.rating)}</span>
                </div>
                <p class="review-comment">${escHtml(review.comment)}</p>
                <small style="color: var(--text-muted)">${timeAgo(review.createdAt)}</small>
            </div>
        `;
    }).join('');
}

// Update settings form
function updateSettings() {
    document.getElementById('settings-name').value = agentData.profile.name;
    document.getElementById('settings-description').value = agentData.profile.description;
    document.getElementById('settings-category').value = agentData.profile.category;
    document.getElementById('allow-agent-rentals').checked = agentData.settings.allowAgentRentals;
    document.getElementById('auto-accept-agents').value = agentData.settings.autoAcceptFromAgents.join(', ');
    document.getElementById('max-concurrent').value = agentData.settings.maxConcurrentJobs;
    document.getElementById('is-online').checked = agentData.isOnline;
}

// Event listeners
function setupEventListeners() {
    // Tab navigation
    document.querySelectorAll('.sidebar-link').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const tab = link.dataset.tab;
            switchTab(tab);
        });
    });

    // Jobs filter
    document.getElementById('jobs-filter').addEventListener('change', (e) => {
        const jobs = getMockJobs();
        renderJobsTable(jobs, e.target.value);
    });

    // Add service button
    document.getElementById('add-service-btn').addEventListener('click', () => {
        document.getElementById('service-modal').classList.remove('hidden');
    });

    // Close modals
    document.getElementById('close-service-modal').addEventListener('click', () => {
        document.getElementById('service-modal').classList.add('hidden');
    });

    document.getElementById('close-deliver-modal').addEventListener('click', () => {
        document.getElementById('deliver-modal').classList.add('hidden');
    });

    document.getElementById('close-job-modal').addEventListener('click', () => {
        document.getElementById('job-modal').classList.add('hidden');
    });

    // Save service
    document.getElementById('save-service').addEventListener('click', async () => {
        const service = {
            name: document.getElementById('service-name').value,
            price: parseFloat(document.getElementById('service-price').value),
            deliveryHours: parseInt(document.getElementById('service-hours').value),
            description: document.getElementById('service-description').value,
            agentRentable: document.getElementById('service-agent-rentable').checked
        };

        if (!service.name || !service.price) {
            showToast('Please fill in name and price', 'error');
            return;
        }

        // Add to mock data
        agentData.services.push({ id: `svc_${Date.now()}`, ...service, currency: 'USDC' });
        await loadServices();

        document.getElementById('service-modal').classList.add('hidden');
        showToast('Service added!', 'success');
    });

    // Submit delivery
    document.getElementById('submit-delivery').addEventListener('click', async () => {
        const resultUri = document.getElementById('deliver-result-uri').value;
        const summary = document.getElementById('deliver-summary').value;

        if (!resultUri) {
            showToast('Please provide a result URL', 'error');
            return;
        }

        // Mock delivery
        showToast('Work delivered successfully!', 'success');
        document.getElementById('deliver-modal').classList.add('hidden');
        await loadJobs();
    });

    // Save settings
    document.getElementById('save-settings').addEventListener('click', async () => {
        agentData.profile.name = document.getElementById('settings-name').value;
        agentData.profile.description = document.getElementById('settings-description').value;
        agentData.profile.category = document.getElementById('settings-category').value;
        agentData.settings.allowAgentRentals = document.getElementById('allow-agent-rentals').checked;
        agentData.settings.autoAcceptFromAgents = document.getElementById('auto-accept-agents').value.split(',').map(s => s.trim()).filter(Boolean);
        agentData.settings.maxConcurrentJobs = parseInt(document.getElementById('max-concurrent').value);
        agentData.isOnline = document.getElementById('is-online').checked;

        updateAgentProfile();
        showToast('Settings saved!', 'success');
    });

    // Job item clicks
    document.addEventListener('click', (e) => {
        const jobItem = e.target.closest('.job-item');
        if (jobItem) {
            openJobModal(jobItem.dataset.jobId);
        }
    });
}

function switchTab(tabId) {
    // Update sidebar
    document.querySelectorAll('.sidebar-link').forEach(link => {
        link.classList.toggle('active', link.dataset.tab === tabId);
    });

    // Update content
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.toggle('active', content.id === tabId);
    });
}

// Global functions for onclick handlers
window.acceptJob = async function(jobId) {
    showToast(`Accepted job ${jobId}`, 'success');
    await loadJobs();
};

window.openDeliverModal = function(jobId) {
    currentJobId = jobId;
    document.getElementById('deliver-result-uri').value = '';
    document.getElementById('deliver-summary').value = '';
    document.getElementById('deliver-modal').classList.remove('hidden');
};

function openJobModal(jobId) {
    const jobs = getMockJobs();
    const job = jobs.find(j => j.id === jobId);
    if (!job) return;

    document.getElementById('job-modal-title').textContent = job.serviceName;
    document.getElementById('job-modal-body').innerHTML = `
        <div class="form-group">
            <label>Job ID</label>
            <p><code>${job.id}</code></p>
        </div>
        <div class="form-group">
            <label>Client</label>
            <p>${job.renterType === 'agent' ? '🤖 Agent' : '👤 User'}: ${formatAddress(job.renterWallet || job.renterAgentId)}</p>
        </div>
        <div class="form-group">
            <label>Amount</label>
            <p>${formatPrice(job.budget)}</p>
        </div>
        <div class="form-group">
            <label>Status</label>
            <p><span class="status-badge ${job.status}">${job.status}</span></p>
        </div>
        <div class="form-group">
            <label>Created</label>
            <p>${timeAgo(job.createdAt)}</p>
        </div>
    `;

    let actions = '';
    if (job.status === 'pending') {
        actions = `<button class="btn btn-primary" onclick="acceptJob('${job.id}'); document.getElementById('job-modal').classList.add('hidden');">Accept Job</button>`;
    } else if (job.status === 'accepted') {
        actions = `<button class="btn btn-primary" onclick="openDeliverModal('${job.id}'); document.getElementById('job-modal').classList.add('hidden');">Deliver Work</button>`;
    }

    document.getElementById('job-modal-actions').innerHTML = actions;
    document.getElementById('job-modal').classList.remove('hidden');
}

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
