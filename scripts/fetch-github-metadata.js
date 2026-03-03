#!/usr/bin/env node
/**
 * fetch-github-metadata.js
 * 
 * Automatically fetches stars and last_commit from the GitHub API
 * for every tool in tools.json that has a `github_repo` field.
 *
 * Usage:
 *   node scripts/fetch-github-metadata.js              # uses unauthenticated API (60 req/hr)
 *   GITHUB_TOKEN=ghp_xxx node scripts/fetch-github-metadata.js  # authenticated (5000 req/hr)
 *
 * What it updates in tools.json:
 *   - stars         → repo.stargazers_count
 *   - last_commit   → default branch's latest commit date (ISO 8601)
 */

const fs = require('fs');
const path = require('path');

const TOOLS_PATH = path.join(__dirname, '../data/tools.json');
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';

// Rate-limit: small delay between requests to stay within limits
const DELAY_MS = GITHUB_TOKEN ? 100 : 1200; // faster when authenticated

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function githubFetch(url) {
    const headers = {
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'altstack-metadata-fetcher',
    };
    if (GITHUB_TOKEN) {
        headers['Authorization'] = `Bearer ${GITHUB_TOKEN}`;
    }

    const response = await fetch(url, { headers });

    if (response.status === 403 || response.status === 429) {
        const resetHeader = response.headers.get('x-ratelimit-reset');
        const resetTime = resetHeader ? new Date(parseInt(resetHeader) * 1000).toLocaleTimeString() : 'unknown';
        console.error(`⚠️  Rate limited. Resets at ${resetTime}. Use GITHUB_TOKEN for higher limits.`);
        return null;
    }

    if (!response.ok) {
        return null;
    }

    return response.json();
}

async function fetchRepoMetadata(githubRepo) {
    // Fetch repo info (stars, default branch)
    const repoData = await githubFetch(`https://api.github.com/repos/${githubRepo}`);
    if (!repoData) return null;

    const stars = repoData.stargazers_count;
    const defaultBranch = repoData.default_branch || 'main';

    // Fetch latest commit on default branch
    const commitsData = await githubFetch(
        `https://api.github.com/repos/${githubRepo}/commits?sha=${defaultBranch}&per_page=1`
    );

    let lastCommit = null;
    if (commitsData && commitsData.length > 0) {
        lastCommit = commitsData[0].commit?.committer?.date || commitsData[0].commit?.author?.date || null;
    }

    return { stars, lastCommit };
}

async function main() {
    if (!fs.existsSync(TOOLS_PATH)) {
        console.error('❌ tools.json not found at:', TOOLS_PATH);
        process.exit(1);
    }

    const tools = JSON.parse(fs.readFileSync(TOOLS_PATH, 'utf8'));

    const reposToFetch = tools.filter(t => t.github_repo);
    console.log(`📦 Found ${reposToFetch.length} tools with GitHub repos out of ${tools.length} total.`);
    console.log(`🔑 Auth: ${GITHUB_TOKEN ? 'Token provided (5000 req/hr)' : 'No token (60 req/hr — set GITHUB_TOKEN for more)'}\n`);

    let updated = 0;
    let failed = 0;
    let unchanged = 0;

    for (const tool of tools) {
        if (!tool.github_repo) continue;

        process.stdout.write(`  ${tool.name} (${tool.github_repo}) ... `);

        const metadata = await fetchRepoMetadata(tool.github_repo);
        if (!metadata) {
            console.log('❌ failed');
            failed++;
            await sleep(DELAY_MS);
            continue;
        }

        let changed = false;

        // Update stars
        if (metadata.stars !== undefined && metadata.stars !== tool.stars) {
            const oldStars = tool.stars || 0;
            tool.stars = metadata.stars;
            process.stdout.write(`★ ${oldStars}→${metadata.stars} `);
            changed = true;
        }

        // Update last_commit
        if (metadata.lastCommit && metadata.lastCommit !== tool.last_commit) {
            const oldDate = tool.last_commit ? tool.last_commit.slice(0, 10) : 'none';
            const newDate = metadata.lastCommit.slice(0, 10);
            tool.last_commit = metadata.lastCommit;
            process.stdout.write(`📅 ${oldDate}→${newDate} `);
            changed = true;
        }

        if (changed) {
            console.log('✅ updated');
            updated++;
        } else {
            console.log('— no change');
            unchanged++;
        }

        await sleep(DELAY_MS);
    }

    // Write updated tools back
    fs.writeFileSync(TOOLS_PATH, JSON.stringify(tools, null, 2) + '\n');

    console.log(`\n✨ Done! ${updated} updated, ${unchanged} unchanged, ${failed} failed.`);
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
