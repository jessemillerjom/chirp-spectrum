/**
 * AI Sentiment Analysis Dashboard
 *
 * This worker collects tweets from Twitter, analyzes their sentiment, and stores the results in a KV namespace.
 * It also provides an API endpoint to fetch sentiment data for a given date range.
 *
 * The dashboard is built with HTML, JavaScript, and Chart.js.
 *
 */

import { getAssetFromKV } from '@cloudflare/kv-asset-handler';
import type {
	RateLimitConfig,
	SentimentTrends,
	CollectionResponse,
	DateRangeParams,
	ProcessedTweet,
	TwitterApiResponse,
	TwitterTweet,
	SentimentAnalysis,
	CollectionStatus,
	Env as EnvType
} from './types';

// Define the KV namespace interface for TypeScript support
export interface Env {
	AI_SENTIMENT_TWEETS: KVNamespace;
	TWITTER_BEARER_TOKEN: string;
	MISTRAL_KEY: string;
}

// Rate limiting configuration
const RATE_LIMIT: RateLimitConfig = {
	maxRequests: 10,
	timeWindow: 60000,
	retryAttempts: 3,
	retryDelay: 2000
};

// Token bucket rate limiter for Mistral API
class TokenBucketRateLimiter {
	private tokens: number;
	private lastRefill: number;
	private readonly maxTokens: number;
	private readonly refillRate: number; // tokens per millisecond

	constructor(maxTokens: number, refillTimeMs: number) {
		this.maxTokens = maxTokens;
		this.tokens = maxTokens;
		this.lastRefill = Date.now();
		this.refillRate = maxTokens / refillTimeMs;
	}

	async waitForToken(): Promise<void> {
		this.refillTokens();
		if (this.tokens < 1) {
			const waitTime = Math.ceil((1 - this.tokens) / this.refillRate);
			await sleep(waitTime);
			this.refillTokens();
		}
		this.tokens -= 1;
	}

	private refillTokens(): void {
		const now = Date.now();
		const timePassed = now - this.lastRefill;
		this.tokens = Math.min(
			this.maxTokens,
			this.tokens + timePassed * this.refillRate
		);
		this.lastRefill = now;
	}
}

// Create a global rate limiter instance
const mistralRateLimiter = new TokenBucketRateLimiter(10, 60000); // 10 requests per minute

// Fix requestTimestamps type with proper initialization
const requestTimestamps: number[] = [];

async function sleep(ms: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, ms));
}

// Store HTML content as a string
const HTML_CONTENT = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>AI Sentiment Analysis Dashboard</title>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/luxon"></script>
    <script src="https://cdn.jsdelivr.net/npm/chartjs-adapter-luxon"></script>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
            margin: 0;
            padding: 20px;
            background: #f5f5f5;
        }
        .container {
            max-width: 1600px;
            margin: 0 auto;
            background: white;
            padding: 20px;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            display: flex;
            gap: 20px;
        }
        .main-content {
            flex: 1;
            min-width: 0;
        }
        .side-panel {
            width: 300px;
            border-left: 1px solid #eee;
            padding-left: 20px;
            display: none;
            position: relative;
            max-height: calc(100vh - 40px);
            overflow-y: auto;
        }
        .side-panel.visible {
            display: block;
        }
        .close-button {
            position: absolute;
            top: 10px;
            right: 10px;
            background: none;
            border: none;
            font-size: 18px;
            cursor: pointer;
            padding: 5px 10px;
            color: #666;
            transition: color 0.2s;
        }
        .close-button:hover {
            color: #333;
        }
        h1, h2 {
            color: #333;
            margin-bottom: 20px;
        }
        h2 {
            font-size: 1.2em;
        }
        .controls {
            display: flex;
            gap: 20px;
            margin-bottom: 20px;
            align-items: center;
            flex-wrap: wrap;
        }
        .control-group {
            display: flex;
            gap: 10px;
            align-items: center;
        }
        select, input {
            padding: 8px;
            border: 1px solid #ddd;
            border-radius: 4px;
            font-size: 14px;
        }
        button {
            background: #007bff;
            color: white;
            border: none;
            padding: 8px 16px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 14px;
        }
        button:hover {
            background: #0056b3;
        }
        .chart-container {
            position: relative;
            height: 60vh;
            width: 100%;
        }
        .tweet-list {
            list-style: none;
            padding: 0;
            margin: 0;
        }
        .tweet-list li {
            margin-bottom: 15px;
            padding: 10px;
            border: 1px solid #eee;
            border-radius: 4px;
        }
        .tweet-list a {
            color: #007bff;
            text-decoration: none;
            display: block;
            overflow-wrap: break-word;
        }
        .tweet-list a:hover {
            text-decoration: underline;
        }
        .tweet-meta {
            font-size: 0.9em;
            color: #666;
            margin-top: 5px;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="main-content">
            <h1>AI Sentiment Analysis Dashboard</h1>
            <div class="controls">
                <div class="control-group">
                    <label for="startDate">Start Date:</label>
                    <input type="date" id="startDate">
                </div>
                <div class="control-group">
                    <label for="endDate">End Date:</label>
                    <input type="date" id="endDate">
                </div>
                <div class="control-group">
                    <label for="metricType">Metric:</label>
                    <select id="metricType">
                        <option value="sentiment">Overall Sentiment</option>
                        <option value="technological">Technological Impact</option>
                        <option value="societal">Societal Impact</option>
                        <option value="ethical">Ethical Impact</option>
                    </select>
                </div>
                <button onclick="updateChart()">Update Chart</button>
            </div>
            <div class="chart-container">
                <canvas id="sentimentChart"></canvas>
            </div>
        </div>
        <div class="side-panel" id="tweetPanel">
            <button class="close-button" onclick="closeSidePanel()">×</button>
            <h2>Tweets</h2>
            <ul class="tweet-list" id="tweetList"></ul>
        </div>
    </div>

    <script>
        let chart;
        let chartData = [];
        
        // Initialize date inputs
        const today = new Date();
        const oneWeekAgo = new Date();
        oneWeekAgo.setDate(today.getDate() - 7);
        
        document.getElementById('startDate').value = oneWeekAgo.toISOString().split('T')[0];
        document.getElementById('endDate').value = today.toISOString().split('T')[0];

        // Initialize chart
        function initChart() {
            const ctx = document.getElementById('sentimentChart').getContext('2d');
            chart = new Chart(ctx, {
                type: 'line',
                data: {
                    datasets: []
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: {
                        x: {
                            type: 'time',
                            time: {
                                unit: 'day'
                            },
                            title: {
                                display: true,
                                text: 'Date'
                            }
                        },
                        y: {
                            beginAtZero: true,
                            title: {
                                display: true,
                                text: 'Count'
                            }
                        }
                    },
                    plugins: {
                        legend: {
                            position: 'top'
                        }
                    },
                    onClick: handleChartClick
                }
            });
        }

        async function handleChartClick(event, elements) {
            if (!elements || elements.length === 0) return;
            
            const element = elements[0];
            const datasetIndex = element.datasetIndex;
            const index = element.index;
            
            const date = chartData[index].date;
            const dataset = chart.data.datasets[datasetIndex];
            const label = dataset.label;
            
            try {
                const response = await fetch(\`/tweets?date=\${date}&sentiment=\${label}\`);
                const tweets = await response.json();
                
                displayTweets(tweets, date, label);
            } catch (error) {
                console.error('Error fetching tweets:', error);
                alert('Error fetching tweets. Please try again.');
            }
        }

        function displayTweets(tweets, date, sentiment) {
            const panel = document.getElementById('tweetPanel');
            const list = document.getElementById('tweetList');
            const formattedDate = new Date(date).toLocaleDateString();
            
            // Clear previous tweets
            list.innerHTML = '';
            
            // Update panel title
            panel.querySelector('h2').textContent = \`\${sentiment} Tweets - \${formattedDate}\`;
            
            // Add tweets to list
            tweets.forEach(tweet => {
                const li = document.createElement('li');
                const link = document.createElement('a');
                link.href = \`https://twitter.com/i/web/status/\${tweet.id}\`;
                link.target = '_blank';
                link.textContent = tweet.text;
                
                const meta = document.createElement('div');
                meta.className = 'tweet-meta';
                meta.textContent = new Date(tweet.created_at).toLocaleString();
                
                li.appendChild(link);
                li.appendChild(meta);
                list.appendChild(li);
            });
            
            // Show the panel
            panel.classList.add('visible');
        }

        async function updateChart() {
            const startDate = document.getElementById('startDate').value;
            const endDate = document.getElementById('endDate').value;
            const metricType = document.getElementById('metricType').value;

            try {
                const response = await fetch(\`/sentiment?startDate=\${startDate}&endDate=\${endDate}&metric=\${metricType}\`);
                const data = await response.json();
                
                // Store the data for click handling
                chartData = data;

                // Clear existing datasets
                chart.data.datasets = [];

                if (metricType === 'sentiment') {
                    // Create datasets for each sentiment
                    const sentiments = ['VERY_POSITIVE', 'POSITIVE', 'NEUTRAL', 'NEGATIVE', 'VERY_NEGATIVE'];
                    const colors = ['#2ecc71', '#3498db', '#95a5a6', '#e74c3c', '#c0392b'];

                    sentiments.forEach((sentiment, index) => {
                        chart.data.datasets.push({
                            label: sentiment,
                            data: data.map(d => ({
                                x: d.date,
                                y: d.sentiment_distribution[sentiment]
                            })),
                            borderColor: colors[index],
                            fill: false
                        });
                    });
                } else {
                    // Create datasets for aspect analysis
                    const aspects = ['positive', 'neutral', 'negative'];
                    const colors = ['#2ecc71', '#95a5a6', '#e74c3c'];

                    aspects.forEach((aspect, index) => {
                        chart.data.datasets.push({
                            label: aspect.charAt(0).toUpperCase() + aspect.slice(1),
                            data: data.map(d => ({
                                x: d.date,
                                y: d.aspect_analysis[metricType] ? d.aspect_analysis[metricType][aspect] || 0 : 0
                            })),
                            borderColor: colors[index],
                            fill: false
                        });
                    });
                }

                chart.update();
            } catch (error) {
                console.error('Error fetching data:', error);
                alert('Error fetching data. Please try again.');
            }
        }

        function closeSidePanel() {
            document.getElementById('tweetPanel').classList.remove('visible');
        }

        // Initialize chart on load
        initChart();
        // Load initial data
        updateChart();
    </script>
</body>
</html>`;

// Add to the top of the file after imports
interface CancellationStatus {
    timestamp: number;
    status: 'active' | 'cancelled';
}

export default {
	async fetch(request: Request, env: EnvType, ctx: ExecutionContext): Promise<Response> {
		try {
			return await handleRequest(request, env);
		} catch (e) {
			return new Response(`Error: ${e instanceof Error ? e.message : 'Unknown error'}`, { status: 500 });
		}
	}
};

async function handleRequest(request: Request, env: EnvType): Promise<Response> {
	const url = new URL(request.url);
	
	// Add CORS headers to all responses
	const corsHeaders = {
		'Access-Control-Allow-Origin': '*',
		'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
		'Access-Control-Allow-Headers': 'Content-Type',
	};

	// Handle OPTIONS request for CORS
	if (request.method === 'OPTIONS') {
		return new Response(null, { headers: corsHeaders });
	}

	try {
		let responseData: unknown;

		if (url.pathname === '/collect') {
			// Start new collection process with unique ID
			const processId = Date.now().toString();
			await env.AI_SENTIMENT_TWEETS.put('collection_status', JSON.stringify({
				timestamp: Date.now(),
				status: 'active',
				processId
			}));
			responseData = await collectTweets(request, env, processId);
		} else if (url.pathname === '/cancel-collection') {
			// Cancel ongoing collection
			const status = await env.AI_SENTIMENT_TWEETS.get('collection_status', 'json') as CollectionStatus | null;
			if (status && status.status === 'active') {
				await env.AI_SENTIMENT_TWEETS.put('collection_status', JSON.stringify({
					...status,
					status: 'cancelled'
				}));
				responseData = { message: 'Collection process cancelled' };
			} else {
				responseData = { message: 'No active collection process found' };
			}
		} else if (url.pathname === '/collection-status') {
			// Get current collection status
			const status = await env.AI_SENTIMENT_TWEETS.get('collection_status', 'json') as CollectionStatus | null;
			responseData = status || { status: 'none' };
		} else if (url.pathname === '/process') {
			responseData = await processTweets(request, env);
		} else if (url.pathname === '/sentiment') {
			responseData = await getSentimentData(url.searchParams, env);
		} else if (url.pathname === '/tweets') {
			responseData = await getTweetsForDateAndSentiment(url.searchParams, env);
		} else if (url.pathname === '/daily') {
			responseData = await getDailySentimentAnalysis(env);
		} else if (url.pathname === '/weekly') {
			responseData = await getWeeklySentimentAnalysis(env);
		} else {
			// Serve static assets
			try {
				return await getAssetFromKV(request as any);
			} catch {
				return new Response(HTML_CONTENT, {
					headers: {
						'Content-Type': 'text/html',
						...corsHeaders
					}
				});
			}
		}

		return new Response(JSON.stringify(responseData), {
			headers: {
				'Content-Type': 'application/json',
				...corsHeaders
			}
		});
	} catch (e) {
		const error = e instanceof Error ? e.message : 'Unknown error';
		return new Response(JSON.stringify({ error }), {
			status: 500,
			headers: {
				'Content-Type': 'application/json',
				...corsHeaders
			}
		});
	}
}

async function getSentimentData(params: URLSearchParams, env: EnvType): Promise<any[]> {
	const startDate = params.get('startDate') || new Date().toISOString().split('T')[0];
	const endDate = params.get('endDate') || startDate;
	const metric = params.get('metric') || 'sentiment';

	// Create an array of dates between start and end
	const dates: string[] = [];
	const start = new Date(startDate);
	const end = new Date(endDate);
	for (let date = new Date(start); date <= end; date.setDate(date.getDate() + 1)) {
		dates.push(date.toISOString().split('T')[0]);
	}

	// Get data for each date
	const dailyData = await Promise.all(dates.map(async (date) => {
		const tweets = await getDateRangeData(env, { startDate: date, endDate: date, metric });
		const trends = analyzeSentimentTrends(tweets);
		return {
			date,
			...trends
		};
	}));

	return dailyData;
}

interface UnprocessedTweet extends TwitterTweet {
    processed?: boolean;
}

async function collectTweets(request: Request, env: EnvType, processId: string): Promise<CollectionResponse> {
	const TWITTER_BEARER_TOKEN = env.TWITTER_BEARER_TOKEN;
	const WINDOW_SIZE = 12 * 60 * 60 * 1000;

	console.log('Starting tweet collection process...');

	if (!TWITTER_BEARER_TOKEN) {
		console.error('Missing Twitter API token');
		return {
			processed_count: 0,
			new_tweets: 0,
			errors: ['Twitter API token not configured']
		};
	}

	// Add cancellation check function
	async function checkIfCancelled(): Promise<boolean> {
		const status = await env.AI_SENTIMENT_TWEETS.get('collection_status', 'json') as CollectionStatus | null;
		return status?.status === 'cancelled' && status?.processId === processId;
	}

	const keywords = [
		'OpenAI', 'ChatGPT', '"GPT-4"', '"Google AI"', '"Gemini AI"',
		'"Microsoft AI"', 'Anthropic', 'Mistral', 'Mistral AI'
	];
	const query = `(${keywords.map(k => `(${k})`).join(' OR ')}) -is:retweet`;

	// Calculate the full date range
	const endDate = new Date('2025-05-16T00:00:00Z');  // End of May 15th UTC
	const startDate = new Date('2025-05-15T00:00:00Z'); // Start of May 15th UTC

	console.log(`Total date range: ${startDate.toISOString()} to ${endDate.toISOString()}`);

	let allTweets: UnprocessedTweet[] = [];
	let totalRequests = 0;
	const errors: string[] = [];
	let newTweetsCount = 0;

	// Process in 12-hour windows
	for (let windowStart = startDate.getTime(); windowStart < endDate.getTime(); windowStart += WINDOW_SIZE) {
		// Check for cancellation at the start of each window
		if (await checkIfCancelled()) {
			console.log('Collection process cancelled');
			return {
				processed_count: allTweets.length,
				new_tweets: newTweetsCount,
				errors: ['Collection process cancelled'],
				status: 'cancelled'
			};
		}

		const windowEnd = Math.min(windowStart + WINDOW_SIZE, endDate.getTime());
		const windowStartDate = new Date(windowStart).toISOString();
		const windowEndDate = new Date(windowEnd).toISOString();

		console.log(`Processing time window: ${windowStartDate} to ${windowEndDate}`);

		let nextToken: string | undefined;
		let windowTweets: UnprocessedTweet[] = [];

		do {
			// Check for cancellation before each API request
			if (await checkIfCancelled()) {
				console.log('Collection process cancelled');
				return {
					processed_count: allTweets.length,
					new_tweets: newTweetsCount,
					errors: ['Collection process cancelled'],
					status: 'cancelled'
				};
			}

			// Check if we're approaching Twitter's rate limit
			if (totalRequests >= 175) {
				console.log('Approaching rate limit, waiting 15 minutes...');
				await sleep(15 * 60 * 1000);
				totalRequests = 0;
			}

			const paginationParam = nextToken ? `&next_token=${nextToken}` : '';
			const twitterApiUrl = `https://api.twitter.com/2/tweets/search/recent?query=${encodeURIComponent(query)}&max_results=100${paginationParam}&start_time=${windowStartDate}&end_time=${windowEndDate}&tweet.fields=created_at,text&expansions=author_id&user.fields=username`;

			try {
				console.log(`Making Twitter API request for window (page ${nextToken ? 'with token' : '1'})`);
				const response = await fetch(twitterApiUrl, {
					headers: {
						'Authorization': `Bearer ${TWITTER_BEARER_TOKEN}`,
						'Content-Type': 'application/json'
					},
				});

				totalRequests++;

				if (!response.ok) {
					const errorData = await response.json().catch(() => ({}));
					console.error(`Twitter API error: ${response.status} - ${response.statusText}`, errorData);
					
					if (response.status === 429) {
						console.log('Rate limit hit, waiting 15 minutes...');
						await sleep(15 * 60 * 1000);
						totalRequests = 0;
						continue;
					}
					
					break;
				}

				const data = await response.json() as TwitterApiResponse;
				if (!data.data || !Array.isArray(data.data)) {
					console.error('Invalid response format from Twitter API:', data);
					break;
				}

				// Check each tweet if it exists and mark as unprocessed if new
				for (const tweet of data.data) {
					const exists = await env.AI_SENTIMENT_TWEETS.get(`tweet:${tweet.id}`);
					if (!exists) {
						tweet.processed = false;
						newTweetsCount++;
						// Store the unprocessed tweet
						await env.AI_SENTIMENT_TWEETS.put(`unprocessed:${tweet.id}`, JSON.stringify(tweet));
					}
				}

				windowTweets = windowTweets.concat(data.data);
				console.log(`Received ${data.data.length} tweets from Twitter API (window total: ${windowTweets.length})`);

				nextToken = data.meta?.next_token;
				
				if (data.meta?.result_count && data.meta.result_count < 100) {
					console.log('Reached end of results for this window');
					break;
				}

				if (nextToken) {
					console.log('Waiting 1 second before next page request...');
					await sleep(1000);
				}
			} catch (error) {
				const errorMessage = error instanceof Error ? error.message : 'Unknown error';
				console.error(`Error fetching tweets: ${errorMessage}`);
				errors.push(`Error fetching tweets: ${errorMessage}`);
				break;
			}
		} while (nextToken);

		allTweets = allTweets.concat(windowTweets);
		console.log(`Window complete. Total tweets so far: ${allTweets.length}`);

		if (windowEnd < endDate.getTime()) {
			console.log('Waiting 5 seconds before next window...');
			await sleep(5000);
		}
	}

	console.log(`Collection complete. Found ${allTweets.length} total tweets, ${newTweetsCount} new.`);
	
	return {
		processed_count: allTweets.length,
		new_tweets: newTweetsCount,
		errors: errors.length > 0 ? errors : undefined
	};
}

async function processTweets(request: Request, env: EnvType): Promise<CollectionResponse> {
	const MISTRAL_KEY = env.MISTRAL_KEY;
	const CHUNK_SIZE = 3;
	const CHUNK_DELAY = 45000;
	const TWEET_DELAY = 8000;

	console.log('Starting tweet processing...');

	if (!MISTRAL_KEY) {
		console.error('Missing Mistral API token');
		return {
			processed_count: 0,
			new_tweets: 0,
			errors: ['Mistral API token not configured']
		};
	}

	const errors: string[] = [];
	let processedCount = 0;
	let subrequestErrors = 0;

	// List all unprocessed tweets
	const unprocessedTweets: UnprocessedTweet[] = [];
	const { keys } = await env.AI_SENTIMENT_TWEETS.list({ prefix: 'unprocessed:' });
	
	for (const key of keys) {
		const tweetData = await env.AI_SENTIMENT_TWEETS.get(key.name, 'json');
		if (tweetData) {
			unprocessedTweets.push(tweetData as UnprocessedTweet);
		}
	}

	console.log(`Found ${unprocessedTweets.length} unprocessed tweets`);

	// Process tweets in chunks
	for (let i = 0; i < unprocessedTweets.length; i += CHUNK_SIZE) {
		if (subrequestErrors >= 3) {
			console.log('Too many subrequest errors, pausing processing');
			await sleep(60000);
			subrequestErrors = 0;
		}

		const chunk = unprocessedTweets.slice(i, i + CHUNK_SIZE);
		console.log(`Processing chunk ${Math.floor(i/CHUNK_SIZE) + 1} of ${Math.ceil(unprocessedTweets.length/CHUNK_SIZE)} (${chunk.length} tweets)`);
		
		if (i > 0) {
			console.log(`Waiting ${CHUNK_DELAY}ms between chunks...`);
			await sleep(CHUNK_DELAY);
		}

		for (const tweet of chunk) {
			try {
				console.log(`Processing tweet ${tweet.id}...`);

				console.log(`Analyzing sentiment for tweet ${tweet.id}...`);
				const sentimentAnalysis = await analyzeDetailedSentiment(tweet.text, MISTRAL_KEY);
				console.log(`Successfully analyzed sentiment for tweet ${tweet.id}`);

				const processedTweet: ProcessedTweet = {
					id: tweet.id,
					text: tweet.text,
					created_at: tweet.created_at,
					sentiment_analysis: sentimentAnalysis,
					timestamp: new Date().toISOString()
				};
				
				console.log(`Storing tweet ${tweet.id} in KV...`);
				await env.AI_SENTIMENT_TWEETS.put(`tweet:${tweet.id}`, JSON.stringify(processedTweet));
				console.log(`Successfully stored tweet ${tweet.id}`);
				
				// Delete the unprocessed version
				await env.AI_SENTIMENT_TWEETS.delete(`unprocessed:${tweet.id}`);
				
				const tweetDate = new Date(tweet.created_at);
				const dateKey = tweetDate.toISOString().split('T')[0];
				console.log(`Updating daily index for ${dateKey}...`);
				const dailyIndex = await env.AI_SENTIMENT_TWEETS.get(`daily:${dateKey}`, 'json') || [];
				if (Array.isArray(dailyIndex) && !dailyIndex.includes(tweet.id)) {
					dailyIndex.push(tweet.id);
					await env.AI_SENTIMENT_TWEETS.put(`daily:${dateKey}`, JSON.stringify(dailyIndex));
					console.log(`Successfully updated daily index for ${dateKey}`);
				}

				processedCount++;

				console.log(`Waiting ${TWEET_DELAY}ms before next tweet...`);
				await sleep(TWEET_DELAY);
			} catch (error) {
				const errorMessage = error instanceof Error ? error.message : 'Unknown error';
				console.error(`Error processing tweet ${tweet.id}:`, error);
				errors.push(`Error processing tweet ${tweet.id}: ${errorMessage}`);
				
				if (errorMessage.includes('Too many subrequests')) {
					subrequestErrors++;
					await sleep(15000);
				}
			}
		}
	}

	console.log(`Processing complete. Processed ${processedCount} tweets.`);
	if (errors.length > 0) {
		console.log(`Encountered ${errors.length} errors during processing.`);
	}

	return {
		processed_count: processedCount,
		new_tweets: processedCount,
		errors: errors.length > 0 ? errors : undefined
	};
}

async function getDailySentimentAnalysis(env: EnvType): Promise<SentimentTrends> {
	const today = new Date().toISOString().split('T')[0];
	const tweets = await getDateRangeData(env, { startDate: today, endDate: today });
	return analyzeSentimentTrends(tweets);
}

async function getWeeklySentimentAnalysis(env: EnvType): Promise<SentimentTrends> {
	const endDate = new Date();
	const startDate = new Date();
	startDate.setDate(endDate.getDate() - 7);
	
	const tweets = await getDateRangeData(env, {
		startDate: startDate.toISOString().split('T')[0],
		endDate: endDate.toISOString().split('T')[0]
	});
	return analyzeSentimentTrends(tweets);
}

function analyzeSentimentTrends(tweets: ProcessedTweet[]): SentimentTrends {
	const sentimentCounts: Record<string, number> = {
		VERY_POSITIVE: 0,
		POSITIVE: 0,
		NEUTRAL: 0,
		NEGATIVE: 0,
		VERY_NEGATIVE: 0
	};

	const aspectAnalysis: Record<string, Record<string, number>> = {};
	let totalConfidence = 0;

	for (const tweet of tweets) {
		const sentiment = tweet.sentiment_analysis.primary_sentiment.label;
		if (sentiment in sentimentCounts) {
			sentimentCounts[sentiment]++;
		}
		totalConfidence += tweet.sentiment_analysis.overall_confidence;

		// Process aspects
		for (const [aspect, analysis] of Object.entries(tweet.sentiment_analysis.aspects)) {
			if (!aspectAnalysis[aspect]) {
				aspectAnalysis[aspect] = { positive: 0, negative: 0, neutral: 0 };
			}
			const sentimentKey = analysis.sentiment.toLowerCase();
			if (sentimentKey in aspectAnalysis[aspect]) {
				aspectAnalysis[aspect][sentimentKey]++;
			}
		}
	}

	return {
		total_tweets: tweets.length,
		sentiment_distribution: sentimentCounts as Record<string, number>,
		aspect_analysis: aspectAnalysis,
		average_confidence: tweets.length > 0 ? totalConfidence / tweets.length : 0
	};
}

async function analyzeDetailedSentiment(text: string, apiKey: string): Promise<SentimentAnalysis> {
	const MAX_RETRIES = 5;
	const BASE_DELAY = 8000; // Increased from 5s to 8s
	const MAX_DELAY = 120000; // Increased from 60s to 120s
	
	let retryCount = 0;
	
	while (retryCount < MAX_RETRIES) {
		try {
			// Wait for rate limiter token before proceeding
			await mistralRateLimiter.waitForToken();

			// Add exponential backoff delay
			if (retryCount > 0) {
				const delay = Math.min(BASE_DELAY * Math.pow(2, retryCount), MAX_DELAY);
				console.log(`Retry ${retryCount + 1}/${MAX_RETRIES} after ${delay}ms delay...`);
				await sleep(delay);
			} else {
				// Initial delay between requests
				await sleep(BASE_DELAY);
			}

			const response = await fetch('https://api.mistral.ai/v1/chat/completions', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Authorization': `Bearer ${apiKey}`
				},
				body: JSON.stringify({
					model: 'mistral-small',
					messages: [{
						role: 'system',
						content: 'You are a sentiment analysis expert. You must ONLY return valid JSON in the exact format specified, with no additional text or explanation.'
					}, {
						role: 'user',
						content: `Analyze this tweet and return ONLY a JSON object (no other text): "${text}"
						{
							"primary_sentiment": {
								"label": "POSITIVE",
								"score": 0.8
							},
							"aspects": {
								"technological": {
									"sentiment": "positive",
									"score": 0.8
								},
								"societal": {
									"sentiment": "positive",
									"score": 0.8
								},
								"ethical": {
									"sentiment": "positive",
									"score": 0.8
								}
							},
							"overall_confidence": 0.8
						}`
					}],
					temperature: 0.1,
					max_tokens: 500,
					response_format: { type: "json_object" }
				})
			});

			if (!response.ok) {
				if (response.status === 429 || response.status === 409) {
					const errorText = await response.text().catch(() => 'Failed to get error text');
					console.error(`API rate limit or concurrency error (${response.status}):`, errorText);
					retryCount++;
					continue;
				}
				
				const errorText = await response.text().catch(() => 'Failed to get error text');
				console.error('Mistral API error:', response.status, response.statusText, errorText);
				throw new APIError('Failed to analyze sentiment', response.status);
			}

			interface MistralResponse {
				choices: Array<{
					message: {
						content: string;
					};
				}>;
			}

			const result = await response.json() as MistralResponse;
			
			if (!result.choices?.[0]?.message?.content) {
				console.error('Invalid Mistral API response format:', result);
				throw new Error('Invalid API response format');
			}

			const content = result.choices[0].message.content.trim();
			console.log('Raw Mistral API response:', content);

			// Ensure we have valid JSON
			let parsed: SentimentAnalysis;
			try {
				parsed = JSON.parse(content);
			} catch (parseError) {
				console.error('JSON parse error:', parseError);
				// Try to clean the response if needed
				const cleanedContent = content.replace(/\n/g, '').replace(/\t/g, '').trim();
				parsed = JSON.parse(cleanedContent);
			}
			
			// Validate the parsed response
			if (!parsed.primary_sentiment?.label || !parsed.aspects || !('overall_confidence' in parsed)) {
				console.error('Invalid sentiment analysis format:', parsed);
				throw new Error('Invalid sentiment analysis format');
			}

			// Normalize sentiment values
			parsed.primary_sentiment.label = parsed.primary_sentiment.label.toUpperCase();
			
			// Ensure all required fields are present and normalize sentiments
			const defaultAspect = { sentiment: "neutral", score: 0.5 };
			for (const aspect of ['technological', 'societal', 'ethical']) {
				if (!parsed.aspects[aspect]) {
					parsed.aspects[aspect] = { ...defaultAspect };
				} else {
					parsed.aspects[aspect].sentiment = parsed.aspects[aspect].sentiment.toLowerCase();
				}
			}

			// Remove any extra aspects that aren't in our standard set
			const validAspects = ['technological', 'societal', 'ethical'];
			parsed.aspects = Object.fromEntries(
				Object.entries(parsed.aspects).filter(([key]) => validAspects.includes(key))
			);

			return parsed;
		} catch (e) {
			if (e instanceof APIError) {
				if (retryCount < MAX_RETRIES - 1) {
					retryCount++;
					// Add additional delay for rate limit errors
					if (e.status === 429 || e.status === 409) {
						const extraDelay = BASE_DELAY * Math.pow(2, retryCount + 2);
						console.log(`Rate limit hit, adding ${extraDelay}ms extra delay...`);
						await sleep(extraDelay);
					}
					continue;
				}
				throw e;
			}
			console.error('Failed to parse sentiment analysis:', e);
			throw new APIError('Failed to parse sentiment analysis result', 500);
		}
	}

	throw new APIError('Maximum retries exceeded', 429);
}

// Add type-safe helper functions
async function getDateRangeData(env: EnvType, params: DateRangeParams): Promise<ProcessedTweet[]> {
	const startDate = new Date(params.startDate);
	const endDate = new Date(params.endDate);
	const allTweets: ProcessedTweet[] = [];

	// Iterate through each day in the range
	for (let date = new Date(startDate); date <= endDate; date.setDate(date.getDate() + 1)) {
		const dateKey = date.toISOString().split('T')[0];
		try {
			// Get tweet IDs for this day
			const dailyIndex = await env.AI_SENTIMENT_TWEETS.get(`daily:${dateKey}`, 'json') as string[] || [];
			
			// Fetch each tweet's data
			for (const tweetId of dailyIndex) {
				const tweetData = await env.AI_SENTIMENT_TWEETS.get(`tweet:${tweetId}`, 'json') as ProcessedTweet;
				if (tweetData) {
					allTweets.push(tweetData);
				}
			}
		} catch (error) {
			console.error(`Error fetching data for ${dateKey}:`, error);
			// Continue with next date even if one fails
		}
	}

	return allTweets;
}

// Add error handling utilities
class APIError extends Error {
	constructor(
		message: string,
		public status: number = 500,
		public details?: unknown
	) {
		super(message);
		this.name = 'APIError';
	}
}

function handleError(error: unknown): Response {
	if (error instanceof APIError) {
		return new Response(
			JSON.stringify({
				error: error.message,
				details: error.details
			}),
			{
				status: error.status,
				headers: {
					'Content-Type': 'application/json'
				}
			}
		);
	}

	const message = error instanceof Error ? error.message : 'Unknown error';
	return new Response(
		JSON.stringify({ error: message }),
		{
			status: 500,
			headers: {
				'Content-Type': 'application/json'
			}
		}
	);
}

async function getTweetsForDateAndSentiment(params: URLSearchParams, env: EnvType): Promise<ProcessedTweet[]> {
	const date = params.get('date');
	const sentiment = params.get('sentiment');

	if (!date || !sentiment) {
		throw new APIError('Missing required parameters: date and sentiment', 400);
	}

	// Get all tweets for the specified date
	const tweets = await getDateRangeData(env, { startDate: date, endDate: date });

	// Filter tweets by sentiment
	let filteredTweets: ProcessedTweet[];
	
	if (sentiment === 'positive' || sentiment === 'neutral' || sentiment === 'negative') {
		// For aspect analysis
		const metricType = params.get('metric') || '';
		filteredTweets = tweets.filter(tweet => {
			const aspectSentiment = tweet.sentiment_analysis.aspects[metricType]?.sentiment.toLowerCase();
			return aspectSentiment === sentiment.toLowerCase();
		});
	} else {
		// For overall sentiment
		filteredTweets = tweets.filter(tweet => 
			tweet.sentiment_analysis.primary_sentiment.label === sentiment
		);
	}

	return filteredTweets;
}


	
	

