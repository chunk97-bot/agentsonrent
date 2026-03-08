/**
 * AgentRent - Cloudflare Worker API
 * AI Agent Rental Marketplace
 * 
 * - Agents register with profile + services
 * - Users rent agents via escrow payments
 * - Revenue split: 85% Agent / 10% Protocol / 5% DAO
 * - Supports USDC, SOL, or any SPL token
 */

// CORS configuration
const ALLOWED_ORIGINS = [
    'https://agentsonrent.org',
    'https://www.agentsonrent.org',
    'http://localhost:3000',
    'http://localhost:5173',
    'http://127.0.0.1:5500'
];

function getCorsHeaders(request) {
    const origin = request.headers.get('Origin');
    const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
    
    return {
        'Access-Control-Allow-Origin': allowedOrigin,
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, X-Wallet-Address, X-Signature',
        'Access-Control-Allow-Credentials': 'true',
        'Content-Type': 'application/json'
    };
}

// Helper: JSON response
function jsonResponse(data, status, headers) {
    return new Response(JSON.stringify(data), { status, headers });
}

// Helper: Generate ID
function generateId(prefix) {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// ============================================
// KV Storage Helpers
// ============================================

async function getAgent(agentId, env) {
    return await env.AGENTS.get(agentId, 'json');
}

async function putAgent(agentId, agent, env) {
    await env.AGENTS.put(agentId, JSON.stringify(agent));
}

async function getJob(jobId, env) {
    return await env.JOBS.get(jobId, 'json');
}

async function putJob(jobId, job, env) {
    await env.JOBS.put(jobId, JSON.stringify(job));
}

async function getReviews(agentId, env) {
    return await env.REVIEWS.get(agentId, 'json') || [];
}

async function putReviews(agentId, reviews, env) {
    await env.REVIEWS.put(agentId, JSON.stringify(reviews));
}

async function listAllAgents(env, limit = 100) {
    const agents = [];
    let cursor = null;
    
    do {
        const result = await env.AGENTS.list({ limit: Math.min(limit, 1000), cursor });
        
        for (const key of result.keys) {
            const agent = await env.AGENTS.get(key.name, 'json');
            if (agent) agents.push(agent);
        }
        
        cursor = result.list_complete ? null : result.cursor;
    } while (cursor && agents.length < limit);
    
    return agents;
}

async function listAllJobs(env, limit = 500) {
    const jobs = [];
    let cursor = null;
    
    do {
        const result = await env.JOBS.list({ limit: Math.min(limit, 1000), cursor });
        
        for (const key of result.keys) {
            const job = await env.JOBS.get(key.name, 'json');
            if (job) jobs.push(job);
        }
        
        cursor = result.list_complete ? null : result.cursor;
    } while (cursor && jobs.length < limit);
    
    return jobs;
}

// ============================================
// Main Router
// ============================================

export default {
    async fetch(request, env, ctx) {
        const corsHeaders = getCorsHeaders(request);
        
        // Handle CORS preflight
        if (request.method === 'OPTIONS') {
            return new Response(null, { headers: corsHeaders });
        }

        const url = new URL(request.url);
        const path = url.pathname;
        const method = request.method;

        try {
            // Health check
            if (path === '/health') {
                return jsonResponse({ status: 'ok', timestamp: Date.now() }, 200, corsHeaders);
            }

            // Agent routes
            if (path === '/api/v1/agents' && method === 'GET') {
                return await handleListAgents(request, env, corsHeaders);
            }
            if (path === '/api/v1/agents' && method === 'POST') {
                return await handleRegisterAgent(request, env, corsHeaders);
            }
            
            const agentMatch = path.match(/^\/api\/v1\/agents\/([^\/]+)$/);
            if (agentMatch && method === 'GET') {
                return await handleGetAgent(agentMatch[1], env, corsHeaders);
            }
            if (agentMatch && method === 'PUT') {
                return await handleUpdateAgent(agentMatch[1], request, env, corsHeaders);
            }
            if (agentMatch && method === 'DELETE') {
                return await handleDeleteAgent(agentMatch[1], request, env, corsHeaders);
            }

            // Agent reviews
            const reviewsMatch = path.match(/^\/api\/v1\/agents\/([^\/]+)\/reviews$/);
            if (reviewsMatch && method === 'GET') {
                return await handleGetReviews(reviewsMatch[1], env, corsHeaders);
            }

            // Job routes
            if (path === '/api/v1/jobs' && method === 'POST') {
                return await handleCreateJob(request, env, corsHeaders);
            }
            
            const jobMatch = path.match(/^\/api\/v1\/jobs\/([^\/]+)$/);
            if (jobMatch && method === 'GET') {
                return await handleGetJob(jobMatch[1], env, corsHeaders);
            }

            // Jobs by user wallet
            const userJobsMatch = path.match(/^\/api\/v1\/jobs\/user\/([^\/]+)$/);
            if (userJobsMatch && method === 'GET') {
                return await handleUserJobs(userJobsMatch[1], env, corsHeaders);
            }

            // Jobs by agent
            const agentJobsMatch = path.match(/^\/api\/v1\/jobs\/agent\/([^\/]+)$/);
            if (agentJobsMatch && method === 'GET') {
                return await handleAgentJobs(agentJobsMatch[1], env, corsHeaders);
            }

            // Job actions
            const acceptMatch = path.match(/^\/api\/v1\/jobs\/([^\/]+)\/accept$/);
            if (acceptMatch && method === 'POST') {
                return await handleAcceptJob(acceptMatch[1], request, env, corsHeaders);
            }

            const deliverMatch = path.match(/^\/api\/v1\/jobs\/([^\/]+)\/deliver$/);
            if (deliverMatch && method === 'POST') {
                return await handleDeliverJob(deliverMatch[1], request, env, corsHeaders);
            }

            const completeMatch = path.match(/^\/api\/v1\/jobs\/([^\/]+)\/complete$/);
            if (completeMatch && method === 'POST') {
                return await handleCompleteJob(completeMatch[1], request, env, corsHeaders);
            }

            const reviewJobMatch = path.match(/^\/api\/v1\/jobs\/([^\/]+)\/review$/);
            if (reviewJobMatch && method === 'POST') {
                return await handleReviewJob(reviewJobMatch[1], request, env, corsHeaders);
            }

            // Stats
            if (path === '/api/v1/stats' && method === 'GET') {
                return await handleStats(env, corsHeaders);
            }

            // Protocol config
            if (path === '/api/v1/config' && method === 'GET') {
                return await handleConfig(env, corsHeaders);
            }

            // Waitlist
            if (path === '/api/v1/waitlist' && method === 'POST') {
                return await handleWaitlist(request, env, corsHeaders);
            }

            return jsonResponse({ error: 'Not found' }, 404, corsHeaders);
        } catch (error) {
            console.error('API Error:', error);
            return jsonResponse({ error: error.message }, 500, corsHeaders);
        }
    }
};

// ============================================
// Agent Handlers
// ============================================

/**
 * POST /api/v1/agents - Register new agent
 */
async function handleRegisterAgent(request, env, corsHeaders) {
    const body = await request.json();
    const { wallet, name, description, avatar, category, services } = body;

    // Validate required fields
    if (!wallet || !name) {
        return jsonResponse({ error: 'Required: wallet, name' }, 400, corsHeaders);
    }

    // Check if agent already exists for this wallet
    const existingAgents = await listAllAgents(env, 1000);
    const existing = existingAgents.find(a => a.wallet === wallet);
    if (existing) {
        return jsonResponse({ error: 'Agent already exists for this wallet', agentId: existing.id }, 400, corsHeaders);
    }

    const agentId = generateId('agent');

    const agent = {
        id: agentId,
        wallet,
        name,
        description: description || '',
        avatar: avatar || '🤖',
        category: category || 'general',
        services: (services || []).map((s, i) => ({
            id: generateId('svc'),
            name: s.name,
            description: s.description || '',
            price: parseFloat(s.price) || 0,
            currency: s.currency || 'USDC', // USDC, SOL, or any mint address
            deliveryHours: parseInt(s.deliveryHours) || 24
        })),
        stats: {
            rating: 0,
            reviewCount: 0,
            jobsCompleted: 0,
            totalEarnings: 0
        },
        isOnline: true,
        createdAt: Date.now(),
        updatedAt: Date.now()
    };

    await putAgent(agentId, agent, env);

    return jsonResponse({
        success: true,
        agent: {
            id: agent.id,
            wallet: agent.wallet,
            name: agent.name,
            services: agent.services
        }
    }, 201, corsHeaders);
}

/**
 * GET /api/v1/agents - List all agents
 */
async function handleListAgents(request, env, corsHeaders) {
    const url = new URL(request.url);
    const category = url.searchParams.get('category');
    const search = url.searchParams.get('search');
    const limit = parseInt(url.searchParams.get('limit') || '50');
    const offset = parseInt(url.searchParams.get('offset') || '0');

    let agents = await listAllAgents(env, 500);

    // Filter by category
    if (category) {
        agents = agents.filter(a => a.category === category);
    }

    // Filter by search
    if (search) {
        const q = search.toLowerCase();
        agents = agents.filter(a =>
            a.name.toLowerCase().includes(q) ||
            a.description?.toLowerCase().includes(q) ||
            a.services?.some(s => s.name.toLowerCase().includes(q))
        );
    }

    // Sort by rating (descending)
    agents.sort((a, b) => (b.stats?.rating || 0) - (a.stats?.rating || 0));

    const total = agents.length;
    agents = agents.slice(offset, offset + limit);

    return jsonResponse({
        agents: agents.map(a => ({
            id: a.id,
            name: a.name,
            description: a.description,
            avatar: a.avatar,
            category: a.category,
            services: a.services,
            stats: a.stats,
            isOnline: a.isOnline
        })),
        total,
        limit,
        offset
    }, 200, corsHeaders);
}

/**
 * GET /api/v1/agents/:id - Get single agent
 */
async function handleGetAgent(agentId, env, corsHeaders) {
    const agent = await getAgent(agentId, env);
    
    if (!agent) {
        return jsonResponse({ error: 'Agent not found' }, 404, corsHeaders);
    }

    return jsonResponse({
        agent: {
            id: agent.id,
            wallet: agent.wallet,
            name: agent.name,
            description: agent.description,
            avatar: agent.avatar,
            category: agent.category,
            services: agent.services,
            stats: agent.stats,
            isOnline: agent.isOnline,
            createdAt: agent.createdAt
        }
    }, 200, corsHeaders);
}

/**
 * PUT /api/v1/agents/:id - Update agent
 */
async function handleUpdateAgent(agentId, request, env, corsHeaders) {
    const walletAddress = request.headers.get('X-Wallet-Address');
    const body = await request.json();

    const agent = await getAgent(agentId, env);
    if (!agent) {
        return jsonResponse({ error: 'Agent not found' }, 404, corsHeaders);
    }

    // Verify ownership
    if (agent.wallet !== walletAddress) {
        return jsonResponse({ error: 'Unauthorized' }, 403, corsHeaders);
    }

    // Update allowed fields
    if (body.name) agent.name = body.name;
    if (body.description !== undefined) agent.description = body.description;
    if (body.avatar) agent.avatar = body.avatar;
    if (body.category) agent.category = body.category;
    if (typeof body.isOnline === 'boolean') agent.isOnline = body.isOnline;

    // Update services
    if (body.services) {
        agent.services = body.services.map((s, i) => ({
            id: s.id || generateId('svc'),
            name: s.name,
            description: s.description || '',
            price: parseFloat(s.price) || 0,
            currency: s.currency || 'USDC',
            deliveryHours: parseInt(s.deliveryHours) || 24
        }));
    }

    agent.updatedAt = Date.now();
    await putAgent(agentId, agent, env);

    return jsonResponse({ success: true, agent }, 200, corsHeaders);
}

/**
 * DELETE /api/v1/agents/:id - Delete agent
 */
async function handleDeleteAgent(agentId, request, env, corsHeaders) {
    const walletAddress = request.headers.get('X-Wallet-Address');

    const agent = await getAgent(agentId, env);
    if (!agent) {
        return jsonResponse({ error: 'Agent not found' }, 404, corsHeaders);
    }

    if (agent.wallet !== walletAddress) {
        return jsonResponse({ error: 'Unauthorized' }, 403, corsHeaders);
    }

    await env.AGENTS.delete(agentId);

    return jsonResponse({ success: true, message: 'Agent deleted' }, 200, corsHeaders);
}

/**
 * GET /api/v1/agents/:id/reviews - Get agent reviews
 */
async function handleGetReviews(agentId, env, corsHeaders) {
    const reviews = await getReviews(agentId, env);
    return jsonResponse({ reviews }, 200, corsHeaders);
}

// ============================================
// Job Handlers
// ============================================

/**
 * POST /api/v1/jobs - Create a rental job
 */
async function handleCreateJob(request, env, corsHeaders) {
    const body = await request.json();
    const { agentId, serviceId, userWallet, requirements, paymentTx } = body;

    // Validate
    if (!agentId || !serviceId || !userWallet) {
        return jsonResponse({ error: 'Required: agentId, serviceId, userWallet' }, 400, corsHeaders);
    }

    const agent = await getAgent(agentId, env);
    if (!agent) {
        return jsonResponse({ error: 'Agent not found' }, 404, corsHeaders);
    }

    const service = agent.services.find(s => s.id === serviceId);
    if (!service) {
        return jsonResponse({ error: 'Service not found' }, 404, corsHeaders);
    }

    const jobId = generateId('job');

    const job = {
        id: jobId,
        agentId,
        serviceId,
        service: {
            name: service.name,
            price: service.price,
            currency: service.currency
        },
        userWallet,
        agentWallet: agent.wallet,
        requirements: requirements || '',
        paymentTx: paymentTx || null, // Solana transaction signature
        status: 'pending', // pending, accepted, in_progress, delivered, completed, cancelled
        createdAt: Date.now(),
        updatedAt: Date.now(),
        deliveredAt: null,
        completedAt: null,
        delivery: null,
        review: null
    };

    await putJob(jobId, job, env);

    return jsonResponse({
        success: true,
        job: {
            id: job.id,
            agentId: job.agentId,
            service: job.service,
            status: job.status,
            agentWallet: job.agentWallet // User pays to this wallet
        }
    }, 201, corsHeaders);
}

/**
 * GET /api/v1/jobs/:id - Get single job
 */
async function handleGetJob(jobId, env, corsHeaders) {
    const job = await getJob(jobId, env);
    
    if (!job) {
        return jsonResponse({ error: 'Job not found' }, 404, corsHeaders);
    }

    return jsonResponse({ job }, 200, corsHeaders);
}

/**
 * GET /api/v1/jobs/user/:wallet - Get user's jobs
 */
async function handleUserJobs(userWallet, env, corsHeaders) {
    const allJobs = await listAllJobs(env);
    const userJobs = allJobs
        .filter(j => j.userWallet === userWallet)
        .sort((a, b) => b.createdAt - a.createdAt);

    return jsonResponse({ jobs: userJobs }, 200, corsHeaders);
}

/**
 * GET /api/v1/jobs/agent/:id - Get agent's jobs
 */
async function handleAgentJobs(agentId, env, corsHeaders) {
    const allJobs = await listAllJobs(env);
    const agentJobs = allJobs
        .filter(j => j.agentId === agentId)
        .sort((a, b) => b.createdAt - a.createdAt);

    return jsonResponse({ jobs: agentJobs }, 200, corsHeaders);
}

/**
 * POST /api/v1/jobs/:id/accept - Agent accepts job
 */
async function handleAcceptJob(jobId, request, env, corsHeaders) {
    const walletAddress = request.headers.get('X-Wallet-Address');

    const job = await getJob(jobId, env);
    if (!job) {
        return jsonResponse({ error: 'Job not found' }, 404, corsHeaders);
    }

    if (job.agentWallet !== walletAddress) {
        return jsonResponse({ error: 'Unauthorized' }, 403, corsHeaders);
    }

    if (job.status !== 'pending') {
        return jsonResponse({ error: 'Job cannot be accepted' }, 400, corsHeaders);
    }

    job.status = 'in_progress';
    job.acceptedAt = Date.now();
    job.updatedAt = Date.now();

    await putJob(jobId, job, env);

    return jsonResponse({ success: true, job }, 200, corsHeaders);
}

/**
 * POST /api/v1/jobs/:id/deliver - Agent delivers work
 */
async function handleDeliverJob(jobId, request, env, corsHeaders) {
    const walletAddress = request.headers.get('X-Wallet-Address');
    const body = await request.json();

    const job = await getJob(jobId, env);
    if (!job) {
        return jsonResponse({ error: 'Job not found' }, 404, corsHeaders);
    }

    if (job.agentWallet !== walletAddress) {
        return jsonResponse({ error: 'Unauthorized' }, 403, corsHeaders);
    }

    if (job.status !== 'in_progress' && job.status !== 'accepted') {
        return jsonResponse({ error: 'Job not in progress' }, 400, corsHeaders);
    }

    job.status = 'delivered';
    job.delivery = {
        content: body.content || body.result,
        files: body.files || [],
        notes: body.notes || ''
    };
    job.deliveredAt = Date.now();
    job.updatedAt = Date.now();

    await putJob(jobId, job, env);

    return jsonResponse({ success: true, job }, 200, corsHeaders);
}

/**
 * POST /api/v1/jobs/:id/complete - User marks job complete
 */
async function handleCompleteJob(jobId, request, env, corsHeaders) {
    const walletAddress = request.headers.get('X-Wallet-Address');

    const job = await getJob(jobId, env);
    if (!job) {
        return jsonResponse({ error: 'Job not found' }, 404, corsHeaders);
    }

    if (job.userWallet !== walletAddress) {
        return jsonResponse({ error: 'Unauthorized' }, 403, corsHeaders);
    }

    if (job.status !== 'delivered') {
        return jsonResponse({ error: 'Job not delivered yet' }, 400, corsHeaders);
    }

    job.status = 'completed';
    job.completedAt = Date.now();
    job.updatedAt = Date.now();

    await putJob(jobId, job, env);

    // Update agent stats
    const agent = await getAgent(job.agentId, env);
    if (agent) {
        agent.stats.jobsCompleted = (agent.stats.jobsCompleted || 0) + 1;
        agent.stats.totalEarnings = (agent.stats.totalEarnings || 0) + job.service.price;
        await putAgent(job.agentId, agent, env);
    }

    return jsonResponse({ success: true, job }, 200, corsHeaders);
}

/**
 * POST /api/v1/jobs/:id/review - Submit review
 */
async function handleReviewJob(jobId, request, env, corsHeaders) {
    const walletAddress = request.headers.get('X-Wallet-Address');
    const body = await request.json();

    const job = await getJob(jobId, env);
    if (!job) {
        return jsonResponse({ error: 'Job not found' }, 404, corsHeaders);
    }

    if (job.userWallet !== walletAddress) {
        return jsonResponse({ error: 'Unauthorized' }, 403, corsHeaders);
    }

    if (job.status !== 'completed') {
        return jsonResponse({ error: 'Job not completed' }, 400, corsHeaders);
    }

    if (job.review) {
        return jsonResponse({ error: 'Already reviewed' }, 400, corsHeaders);
    }

    const rating = Math.min(5, Math.max(1, parseInt(body.rating) || 5));
    const comment = body.comment || '';

    job.review = {
        rating,
        comment,
        createdAt: Date.now()
    };
    job.updatedAt = Date.now();

    await putJob(jobId, job, env);

    // Update agent reviews and rating
    const agent = await getAgent(job.agentId, env);
    if (agent) {
        const reviews = await getReviews(job.agentId, env);
        reviews.push({
            jobId,
            userWallet: walletAddress,
            rating,
            comment,
            createdAt: Date.now()
        });
        await putReviews(job.agentId, reviews, env);

        // Recalculate average rating
        const totalRating = reviews.reduce((sum, r) => sum + r.rating, 0);
        agent.stats.rating = parseFloat((totalRating / reviews.length).toFixed(2));
        agent.stats.reviewCount = reviews.length;
        await putAgent(job.agentId, agent, env);
    }

    return jsonResponse({ success: true, review: job.review }, 200, corsHeaders);
}

// ============================================
// Stats
// ============================================

async function handleStats(env, corsHeaders) {
    const agents = await listAllAgents(env, 1000);
    const jobs = await listAllJobs(env, 2000);

    const completedJobs = jobs.filter(j => j.status === 'completed');
    const totalEarnings = completedJobs.reduce((sum, j) => sum + (j.service?.price || 0), 0);

    // Get waitlist count
    let waitlistCount = 0;
    try {
        const waitlistResult = await env.WAITLIST.list({ limit: 1000 });
        waitlistCount = waitlistResult.keys.length;
    } catch (e) {
        // WAITLIST KV may not exist
    }

    return jsonResponse({
        agentCount: agents.length,
        jobsCompleted: completedJobs.length,
        totalEarnings,
        activeJobs: jobs.filter(j => ['pending', 'in_progress', 'delivered'].includes(j.status)).length,
        waitlistCount
    }, 200, corsHeaders);
}

// ============================================
// Protocol Config
// ============================================

async function handleConfig(env, corsHeaders) {
    return jsonResponse({
        protocol: {
            name: 'AgentRent',
            version: '1.0.0'
        },
        escrow: {
            programId: env.ESCROW_PROGRAM_ID || null,
            deployed: !!env.ESCROW_PROGRAM_ID
        },
        wallets: {
            protocol: env.PROTOCOL_WALLET || null,
            dao: env.DAO_WALLET || null,
            configured: !!(env.PROTOCOL_WALLET && env.DAO_WALLET)
        },
        tokens: {
            usdc: env.USDC_MINT || 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
        },
        fees: {
            agent: 85,
            protocol: 10,
            dao: 5
        }
    }, 200, corsHeaders);
}

// ============================================
// Waitlist
// ============================================

async function handleWaitlist(request, env, corsHeaders) {
    const { email } = await request.json();

    if (!email || !email.includes('@')) {
        return jsonResponse({ error: 'Invalid email' }, 400, corsHeaders);
    }

    // Store in KV
    await env.WAITLIST.put(email, JSON.stringify({ joined: Date.now() }));

    // Get position
    const listResult = await env.WAITLIST.list({ limit: 1000 });
    const position = listResult.keys.length;

    return jsonResponse({
        success: true,
        message: 'Added to waitlist',
        position
    }, 200, corsHeaders);
}
