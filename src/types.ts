export class APIError extends Error {
	constructor(message: string, public status: number) {
		super(message);
		this.name = 'APIError';
	}
}

export interface Env {
	AI_SENTIMENT_TWEETS: KVNamespace;
	TWITTER_BEARER_TOKEN: string;
	MISTRAL_KEY: string;
}

export interface RateLimitConfig {
	maxRequests: number;
	timeWindow: number;
	retryAttempts: number;
	retryDelay: number;
}

export type SentimentLabel = 'VERY_POSITIVE' | 'POSITIVE' | 'NEUTRAL' | 'NEGATIVE' | 'VERY_NEGATIVE';

export interface SentimentScore {
	label: string;
	score: number;
}

export interface AspectSentiment {
	sentiment: string;
	score: number;
}

export interface SentimentAnalysis {
	primary_sentiment: SentimentScore;
	aspects: Record<string, AspectSentiment>;
	overall_confidence: number;
}

export interface TwitterUser {
	id: string;
	username: string;
	name?: string;
}

export interface TwitterTweet {
	id: string;
	text: string;
	created_at: string;
	author_id: string;
	processed?: boolean;
}

export interface TwitterApiResponse {
	data: TwitterTweet[];
	includes?: {
		users: TwitterUser[];
	};
	meta?: {
		newest_id?: string;
		oldest_id?: string;
		result_count: number;
		next_token?: string;
	};
}

export interface ProcessedTweet {
	id: string;
	text: string;
	created_at: string;
	author?: TwitterUser;
	sentiment_analysis: SentimentAnalysis;
	timestamp: string;
}

export interface SentimentTrends {
	total_tweets: number;
	sentiment_distribution: Record<SentimentLabel, number>;
	aspect_analysis: Record<string, Record<string, number>>;
	average_confidence: number;
}

export interface CollectionResponse {
	processed_count: number;
	new_tweets: number;
	errors?: string[];
	status?: 'active' | 'cancelled';
}

export interface DateRangeParams {
	startDate: string;
	endDate: string;
	metric?: string;
}

export interface CollectionStatus {
	timestamp: number;
	status: 'active' | 'cancelled' | 'none';
	processId?: string;
} 